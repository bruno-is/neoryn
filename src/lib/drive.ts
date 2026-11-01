import type { DocumentRecord } from './library'

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
export const driveConfig = {
  clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
  apiKey: import.meta.env.VITE_GOOGLE_API_KEY || '',
  appId: import.meta.env.VITE_GOOGLE_APP_ID || '',
}
export const driveConfigured = Object.values(driveConfig).every(Boolean)
export interface DriveFile { id: string; title: string; etag: string; version: string; mimeType: string; fileSize?: string; labels?: { trashed?: boolean }; userPermission?: { role: string } }
export interface DriveLink { account: string; fileId: string; base: string; pending?: boolean }
export interface DrivePreferences { autosave: boolean; autoUpload: boolean; uploadSince: number; autoImport: boolean; autoPull: boolean; folderId: string; folderName: string; excluded: string[]; ignored: string[] }
export interface DriveAccount { id: string; email: string }
export const defaultDrivePreferences: DrivePreferences = { autosave: false, autoUpload: false, uploadSince: 0, autoImport: false, autoPull: true, folderId: '', folderName: '', excluded: [], ignored: [] }

export class DriveError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
export async function fingerprint(doc: Pick<DocumentRecord, 'name' | 'content'>) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([markdownName(doc.name), doc.content])))
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('')
}
export function syncDecision(local: string, remote: string, base: string): 'equal' | 'push' | 'pull' | 'conflict' {
  if (local === remote) return 'equal'
  if (remote === base) return 'push'
  if (local === base) return 'pull'
  return 'conflict'
}
export const markdownName = (title: string) => title.replace(/\.(md|markdown|txt)$/i, '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 180) || 'Sem título'
export const isMarkdown = (file: DriveFile) => /\.(md|markdown|txt)$/i.test(file.title) && !file.mimeType.startsWith('application/vnd.google-apps.')

// Tokens stay in memory. No credentials are written to the library, backups or browser storage.
export class DriveClient {
  constructor(private token: string, private expires: number) {}
  private async request(path: string, init: RequestInit = {}, upload = false): Promise<Response> {
    if (Date.now() >= this.expires) throw new DriveError(401, 'Reconecte ao Google Drive para continuar. Suas alterações estão salvas neste navegador.')
    const response = await fetch(`https://www.googleapis.com/${upload ? 'upload/' : ''}drive/v2/${path}`, {
      ...init, cache: 'no-store', signal: AbortSignal.timeout(45000),
      headers: { Authorization: `Bearer ${this.token}`, ...init.headers },
    })
    if (!response.ok) {
      const messages: Record<number, string> = { 401: 'Reconecte ao Google Drive para continuar.', 403: 'O Drive recusou a operação. Confira a permissão do arquivo e a cota da conta.', 404: 'Arquivo indisponível no Drive. Sua cópia local foi preservada.', 409: 'O arquivo já existe. Sincronize novamente.', 412: 'O arquivo mudou no Drive durante o salvamento. Sincronize novamente para comparar as versões.', 429: 'Limite temporário do Drive. Aguarde antes de sincronizar novamente.' }
      throw new DriveError(response.status, messages[response.status] || 'O Google Drive está indisponível. Tente novamente; suas alterações locais foram preservadas.')
    }
    return response
  }
  async account(): Promise<DriveAccount> {
    const data = await (await this.request('about?fields=user(permissionId,emailAddress)')).json()
    if (!data.user?.permissionId) throw new Error('Não foi possível identificar a conta do Drive.')
    return { id: data.user.permissionId, email: data.user.emailAddress }
  }
  async metadata(id: string): Promise<DriveFile> {
    return (await this.request(`files/${encodeURIComponent(id)}?fields=id,title,etag,version,mimeType,fileSize,labels/trashed,userPermission/role`)).json()
  }
  async read(id: string): Promise<{ file: DriveFile; name: string; content: string }> {
    const file = await this.metadata(id)
    if (file.labels?.trashed) throw new DriveError(404, 'Este arquivo está na lixeira do Drive. Sua cópia local foi preservada.')
    if (!isMarkdown(file)) throw new Error('Selecione arquivos .md, .markdown ou .txt. Documentos Google nativos não são Markdown.')
    if (Number(file.fileSize || 0) > 10_000_000) throw new Error('O arquivo ultrapassa o limite de 10 MB.')
    const content = await (await this.request(`files/${encodeURIComponent(id)}?alt=media`)).text()
    if (content.length > 10_000_000) throw new Error('O arquivo ultrapassa o limite de tamanho.')
    const after = await this.metadata(id)
    if (after.etag !== file.etag) throw new DriveError(412, 'O arquivo mudou durante a leitura. Tente novamente.')
    return { file, name: markdownName(file.title), content }
  }
  async list(folderId?: string): Promise<DriveFile[]> {
    const result: DriveFile[] = []
    let pageToken = ''
    do {
      const q = `trashed = false${folderId ? ` and '${folderId.replace(/['\\]/g, '')}' in parents` : ''}`
      const params = new URLSearchParams({ q, maxResults: '100', fields: 'items(id,title,mimeType),nextPageToken', ...(pageToken ? { pageToken } : {}) })
      const data = await (await this.request(`files?${params}`)).json()
      result.push(...(data.items || [])); pageToken = data.nextPageToken || ''
      if (result.length > 10000) throw new Error('Selecione uma pasta menor para sincronizar.')
    } while (pageToken)
    return result.filter(isMarkdown)
  }
  async generateId(): Promise<string> { return (await (await this.request('files/generateIds?maxResults=1&space=drive')).json()).ids[0] }
  async folder(id: string): Promise<DriveFile> {
    const file = await this.metadata(id)
    if (file.mimeType !== 'application/vnd.google-apps.folder' || file.labels?.trashed) throw new Error('Selecione uma pasta disponível no Drive.')
    if (!['owner', 'writer', 'organizer', 'fileOrganizer'].includes(file.userPermission?.role || '')) throw new Error('Escolha uma pasta onde você possa criar arquivos.')
    return file
  }
  async write(id: string, doc: Pick<DocumentRecord, 'name' | 'content'>, etag?: string, folderId?: string) {
    if (new TextEncoder().encode(doc.content).byteLength > 10_000_000) throw new Error('O documento ultrapassa o limite de 10 MB para o Drive.')
    if (etag === '') throw new Error('O Drive não forneceu uma versão segura para atualizar este arquivo.')
    const boundary = `neoryn_${crypto.randomUUID()}`
    const metadata = { title: `${markdownName(doc.name)}.md`, mimeType: 'text/markdown', ...(!etag ? { id, parents: folderId ? [{ id: folderId }] : undefined } : {}) }
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n${doc.content}\r\n--${boundary}--`
    return (await this.request(`files${etag ? `/${encodeURIComponent(id)}` : ''}?uploadType=multipart`, { method: etag ? 'PUT' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}`, ...(etag ? { 'If-Match': etag } : {}) }, body }, true)).json()
  }
  async trash(file: DriveFile) {
    if (!file.etag) throw new Error('Não foi possível confirmar a versão do arquivo.')
    await this.request(`files/${encodeURIComponent(file.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match': file.etag }, body: JSON.stringify({ labels: { trashed: true } }) })
  }
}

const scripts = new Map<string, Promise<void>>()
function loadScript(url: string) {
  if (!scripts.has(url)) scripts.set(url, new Promise<void>((resolve, reject) => {
    const script = document.createElement('script'); script.src = url; script.async = true
    const timeout = setTimeout(() => { script.remove(); scripts.delete(url); reject(new Error('O Google demorou para responder. Verifique a conexão e tente novamente.')) }, 20000)
    script.onload = () => { clearTimeout(timeout); resolve() }
    script.onerror = () => { clearTimeout(timeout); scripts.delete(url); script.remove(); reject(new Error('Não foi possível carregar o Google. Verifique a conexão.')) }
    document.head.append(script)
  }))
  return scripts.get(url)!
}
// Google ships these browser SDKs as globals without official TypeScript declarations.
type GoogleWindow = Window & { google: any; gapi: any }
const googleWindow = () => window as unknown as GoogleWindow
export async function prepareGoogle() {
  if (!driveConfigured) throw new Error('A conexão com o Google Drive ainda está sendo configurada.')
  await Promise.all([loadScript('https://accounts.google.com/gsi/client'), loadScript('https://apis.google.com/js/api.js')])
  await new Promise<void>((resolve, reject) => googleWindow().gapi.load('picker', { callback: resolve, onerror: () => reject(new Error('Não foi possível carregar o seletor do Drive.')), timeout: 20000, ontimeout: () => reject(new Error('O seletor do Drive não respondeu.')) }))
}
export function authorize(): Promise<{ client: DriveClient; token: string }> {
  return new Promise((resolve, reject) => {
    googleWindow().google.accounts.oauth2.initTokenClient({ client_id: driveConfig.clientId, scope: DRIVE_SCOPE, include_granted_scopes: false,
      callback: (result: { access_token: string; expires_in: number; error?: string; scope: string }) => {
        if (result.error || !result.access_token || !result.scope?.split(' ').includes(DRIVE_SCOPE)) return reject(new Error('Autorize o acesso aos arquivos selecionados para conectar o Drive.'))
        resolve({ client: new DriveClient(result.access_token, Date.now() + Number(result.expires_in) * 1000 - 30000), token: result.access_token })
      }, error_callback: () => reject(new Error('A conexão foi cancelada ou o navegador bloqueou a janela do Google.')),
    }).requestAccessToken({ prompt: 'select_account' })
  })
}
export function pickFiles(token: string, folder = false): Promise<{ id: string; name: string }[]> {
  return new Promise(resolve => {
    const p = googleWindow().google.picker
    const view = new p.DocsView(folder ? p.ViewId.FOLDERS : p.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(folder)
    if (folder) view.setMimeTypes('application/vnd.google-apps.folder')
    else view.setMimeTypes('text/markdown,text/x-markdown,text/plain,application/octet-stream')
    let builder = new p.PickerBuilder().addView(view).setOAuthToken(token).setDeveloperKey(driveConfig.apiKey).setAppId(driveConfig.appId).setOrigin(location.origin).setLocale('pt-BR').setTitle(folder ? 'Pasta de destino do Neoryn' : 'Selecionar documentos Markdown').setCallback((data: any) => {
      if (data.action === p.Action.PICKED) resolve(data.docs.map((doc: any) => ({ id: doc.id, name: doc.name })))
      if (data.action === p.Action.CANCEL) resolve([])
    })
    if (!folder) builder = builder.enableFeature(p.Feature.MULTISELECT_ENABLED)
    builder.build().setVisible(true)
  })
}
