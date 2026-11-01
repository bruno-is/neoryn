import { useEffect, useRef, useState } from 'react'
import { Cloud, CloudOff, RefreshCw, X, Upload, Download, FolderOpen, Check } from 'lucide-react'
import type { DocumentRecord, LibraryState } from '../lib/library'
import { authorize, defaultDrivePreferences, DriveClient, driveConfigured, DriveError, fingerprint, pickFiles, prepareGoogle, syncDecision, type DriveAccount, type DrivePreferences } from '../lib/drive'

type Props = { library: LibraryState; getLibrary: () => LibraryState; commit: (change: (state: LibraryState) => LibraryState) => Promise<void>; disabled: boolean }
type Conflict = { id: string; name: string }
const same = (a: DocumentRecord, b: DocumentRecord) => a.name === b.name && a.content === b.content && a.deletedAt === b.deletedAt
const preferencesKey = (account: string) => `neoryn-drive-preferences-v1:${account}`
function readPreferences(account: string): DrivePreferences {
  const raw = localStorage.getItem(preferencesKey(account))
  if (!raw) return { ...defaultDrivePreferences }
  const value = JSON.parse(raw)
  if (!value || typeof value !== 'object') throw new Error('As preferências do Drive não puderam ser carregadas.')
  return { autosave: value.autosave === true, autoUpload: value.autoUpload === true, uploadSince: typeof value.uploadSince === 'number' && Number.isFinite(value.uploadSince) ? value.uploadSince : Date.now(), autoImport: value.autoImport === true, autoPull: value.autoPull !== false,
    folderId: typeof value.folderId === 'string' ? value.folderId : '', folderName: typeof value.folderName === 'string' ? value.folderName : '',
    excluded: Array.isArray(value.excluded) ? value.excluded.filter((id: unknown) => typeof id === 'string') : [], ignored: Array.isArray(value.ignored) ? value.ignored.filter((id: unknown) => typeof id === 'string') : [] }
}

export function DrivePanel({ library, getLibrary, commit, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [ready, setReady] = useState(false)
  const [session, setSession] = useState<{ client: DriveClient; token: string; account: DriveAccount } | null>(null)
  const [preferences, setPreferences] = useState<DrivePreferences>({ ...defaultDrivePreferences })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('Conecte sua conta para sincronizar seus documentos.')
  const [error, setError] = useState('')
  const [conflicts, setConflicts] = useState<Conflict[]>([])
  const [pendingIds, setPendingIds] = useState<string[]>([])
  const [lastSync, setLastSync] = useState<number | null>(null)
  const [online, setOnline] = useState(navigator.onLine)
  const [importMode, setImportMode] = useState<'linked' | 'copy'>('linked')
  const [confirmTrash, setConfirmTrash] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const lock = useRef(false)
  const refs = useRef({ session, preferences, disabled, getLibrary, commit }); refs.current = { session, preferences, disabled, getLibrary, commit }
  const trigger = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const activeDocs = library.documents.filter(doc => !doc.deletedAt)
  const linked = library.documents.filter(doc => doc.drive?.account === session?.account.id)
  const pending = linked.filter(doc => !doc.deletedAt).length

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])
  useEffect(() => {
    if (!open) return
    dialog.current?.focus()
    const key = (event: KeyboardEvent) => {
      if (document.querySelector('.picker-dialog')) return
      if (event.key === 'Escape') { event.stopImmediatePropagation(); if (!lock.current) setOpen(false) }
      if (document.querySelector('.picker-dialog')) return
      if (event.key !== 'Tab') return
      const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]') || [])
      if (!items.length) return
      if (event.shiftKey && (document.activeElement === items[0] || document.activeElement === dialog.current)) { event.preventDefault(); items.at(-1)?.focus() }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus() }
    }
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('keydown', key, true); trigger.current?.focus() }
  }, [open])
  useEffect(() => {
    if (open && driveConfigured && !ready) void prepareGoogle().then(() => setReady(true)).catch(err => setError(err.message))
  }, [open, ready])

  function savePreferences(value: DrivePreferences) {
    const current = refs.current.session
    if (!current) return
    localStorage.setItem(preferencesKey(current.account.id), JSON.stringify(value))
    refs.current.preferences = value; setPreferences(value)
  }
  async function run(work: () => Promise<void>, network = true) {
    if (lock.current || refs.current.disabled) return
    lock.current = true; setBusy(true); setError('')
    try {
      if (network && !navigator.onLine) throw new Error('Você está offline. As alterações permanecem salvas neste navegador.')
      await work()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível concluir a operação.')
      if (err instanceof DriveError && err.status === 401) { setSession(null); refs.current.session = null }
    } finally { lock.current = false; setBusy(false) }
  }
  function requireSession() {
    const current = refs.current.session
    if (!current) throw new Error('Conecte sua conta do Google Drive.')
    return current
  }
  async function connect() {
    // Called directly from the click, preserving the user gesture required by Google.
    const authorization = authorize()
    await run(async () => {
      const auth = await authorization
      const account = await auth.client.account()
      const prefs = readPreferences(account.id)
      const next = { ...auth, account }
      refs.current.session = next; refs.current.preferences = prefs
      setSession(next); setPreferences(prefs); setConflicts([]); setSelected([]); setLastSync(null)
      setMessage('Conta conectada. Escolha uma pasta e importe ou envie seus documentos.')
    })
  }
  async function patch(expected: DocumentRecord, change: Partial<DocumentRecord>) {
    await refs.current.commit(state => {
      const current = state.documents.find(doc => doc.id === expected.id)
      if (!current || !same(current, expected) || JSON.stringify(current.drive) !== JSON.stringify(expected.drive)) throw new Error('O documento foi editado durante a sincronização. Suas alterações foram preservadas; sincronize novamente.')
      return { ...state, documents: state.documents.map(doc => doc.id === expected.id ? { ...doc, ...change } : doc) }
    })
  }
  async function importFile(id: string, copy: boolean) {
    const { client, account } = requireSession()
    if (!copy && refs.current.getLibrary().documents.some(doc => doc.drive?.account === account.id && doc.drive.fileId === id)) return
    const remote = await client.read(id)
    const base = await fingerprint(remote)
    const now = Date.now()
    const doc: DocumentRecord = { id: crypto.randomUUID(), name: remote.name, content: remote.content, createdAt: now, updatedAt: now, deletedAt: null, folderId: null, favorite: false, ...(copy ? { localOnly: true } : {}),
      ...(!copy ? { drive: { account: account.id, fileId: id, base } } : {}) }
    await refs.current.commit(state => ({ ...state, documents: [...state.documents, doc] }))
    savePreferences({ ...refs.current.preferences, excluded: copy ? [...refs.current.preferences.excluded, doc.id] : refs.current.preferences.excluded, ignored: copy ? [...refs.current.preferences.ignored, id] : refs.current.preferences.ignored.filter(fileId => fileId !== id) })
  }
  async function send(doc: DocumentRecord) {
    const { client, account } = requireSession()
    if (doc.drive && doc.drive.account !== account.id) return
    let snapshot = doc
    if (!snapshot.drive) {
      if (!refs.current.preferences.folderId) throw new Error('Escolha a pasta de destino antes de enviar novos documentos.')
      await client.folder(refs.current.preferences.folderId)
      const id = await client.generateId()
      const drive = { account: account.id, fileId: id, base: '', pending: true }
      await patch(snapshot, { drive }); snapshot = { ...snapshot, drive }
    }
    if (snapshot.drive?.pending) {
      // Persist a generated ID before sending: retries cannot create duplicate files.
      try { await client.metadata(snapshot.drive.fileId) }
      catch (err) {
        if (!(err instanceof DriveError) || err.status !== 404) throw err
        await client.write(snapshot.drive.fileId, snapshot, undefined, refs.current.preferences.folderId)
        await patch(snapshot, { drive: { ...snapshot.drive, base: await fingerprint(snapshot), pending: undefined } })
        return
      }
      // A previous upload may have completed even if its response was lost.
    }
    await syncDocument(snapshot, true, true)
  }
  async function syncDocument(doc: DocumentRecord, push: boolean, pull: boolean) {
    const { client } = requireSession()
    if (!doc.drive || doc.deletedAt) return
    const remote = await client.read(doc.drive.fileId)
    const localHash = await fingerprint(doc), remoteHash = await fingerprint(remote)
    const decision = syncDecision(localHash, remoteHash, doc.drive.base)
    if (decision === 'conflict') {
      setConflicts(items => [...items.filter(item => item.id !== doc.id), { id: doc.id, name: doc.name }]); return
    }
    if (decision === 'push' && push) {
      if (!remote.file.etag) throw new Error('O Drive não retornou uma versão segura para salvar.')
      await client.write(remote.file.id, doc, remote.file.etag)
      // Content edited during upload remains pending against the uploaded snapshot.
      await refs.current.commit(state => ({ ...state, documents: state.documents.map(current => current.id === doc.id && current.drive?.fileId === doc.drive?.fileId ? { ...current, drive: { ...doc.drive!, base: localHash, pending: undefined } } : current) }))
    } else if (decision === 'pull' && pull) {
      await patch(doc, { content: remote.content, name: remote.name, updatedAt: Math.max(Date.now(), doc.updatedAt), drive: { ...doc.drive, base: remoteHash, pending: undefined } })
    } else if (decision === 'equal' && (doc.drive.base !== remoteHash || doc.drive.pending)) await patch(doc, { drive: { ...doc.drive, base: remoteHash, pending: undefined } })
    if (decision === 'equal' || (decision === 'push' && push) || (decision === 'pull' && pull)) setConflicts(items => items.filter(item => item.id !== doc.id))
  }
  async function sync(manual: boolean) {
    const { account, client } = requireSession()
    const prefs = refs.current.preferences
    const failures: string[] = []
    for (const doc of refs.current.getLibrary().documents) {
      if (doc.deletedAt || (doc.localOnly && !doc.drive) || refs.current.preferences.excluded.includes(doc.id)) continue
      try {
        if (doc.drive?.account === account.id) {
          if (doc.drive.pending && (manual || prefs.autosave)) await send(doc)
          else if (!doc.drive.pending) await syncDocument(doc, manual || prefs.autosave, manual || prefs.autoPull)
        } else if (!doc.drive && prefs.autoUpload && doc.createdAt >= prefs.uploadSince && prefs.folderId) await send(doc)
      } catch (err) {
        if (err instanceof DriveError && err.status === 401) throw err
        failures.push(`${doc.name}: ${err instanceof Error ? err.message : 'Falha ao sincronizar.'}`)
      }
    }
    if (prefs.autoImport && prefs.folderId) {
      for (const file of await client.list(prefs.folderId)) {
        if (refs.current.preferences.ignored.includes(file.id)) continue
        try { await importFile(file.id, false) } catch (err) { if (err instanceof DriveError && err.status === 401) throw err; failures.push(`${file.title}: ${err instanceof Error ? err.message : 'Falha na importação.'}`) }
      }
    }
    if (failures.length) throw new Error(failures.slice(0, 5).join('\n'))
    setLastSync(Date.now()); setMessage('Verificação concluída. Confira os conflitos e as preferências de envio abaixo.')
  }
  const syncRef = useRef(sync); syncRef.current = sync
  useEffect(() => {
    if (!session || disabled) return
    const automatic = () => {
      const p = refs.current.preferences
      if (document.visibilityState === 'visible' && navigator.onLine && (p.autosave || p.autoPull || p.autoImport || p.autoUpload)) void run(() => syncRef.current(false))
    }
    const timer = setInterval(automatic, 60000)
    window.addEventListener('online', automatic); document.addEventListener('visibilitychange', automatic)
    return () => { clearInterval(timer); window.removeEventListener('online', automatic); document.removeEventListener('visibilitychange', automatic) }
  }, [session, disabled])
  // Debounce edits; changes only to synchronization metadata must not cause an upload loop.
  const contentSignature = JSON.stringify(library.documents.map(doc => [doc.id, doc.name, doc.content, doc.deletedAt]))
  const linkSignature = JSON.stringify(library.documents.map(doc => doc.drive))
  useEffect(() => {
    let cancelled = false
    void Promise.all(library.documents.filter(doc => !doc.deletedAt && doc.drive?.account === session?.account.id).map(async doc => (doc.drive?.pending || await fingerprint(doc) !== doc.drive?.base) ? doc.id : null)).then(ids => { if (!cancelled) setPendingIds(ids.filter((id): id is string => id !== null)) }).catch(() => { if (!cancelled) setError('Não foi possível verificar as versões locais.') })
    return () => { cancelled = true }
  }, [contentSignature, linkSignature, session])
  useEffect(() => {
    if (!session || disabled || (!preferences.autosave && !preferences.autoUpload)) return
    const timer = setTimeout(() => { if (navigator.onLine && document.visibilityState === 'visible') void run(() => syncRef.current(false)) }, 2500)
    return () => clearTimeout(timer)
  }, [contentSignature, session, disabled, preferences.autosave, preferences.autoUpload])

  async function resolveConflict(id: string, choice: 'local' | 'remote' | 'both') {
    const { client } = requireSession()
    const doc = refs.current.getLibrary().documents.find(item => item.id === id)
    if (!doc?.drive || doc.deletedAt) return
    const remote = await client.read(doc.drive.fileId)
    const now = Date.now()
    // Every resolution keeps the displaced content as an independent local document.
    const copy: DocumentRecord = { ...doc, id: crypto.randomUUID(), drive: undefined, localOnly: true, name: `${choice === 'local' ? remote.name : doc.name} (${choice === 'local' ? 'versão do Drive' : 'cópia local'})`.slice(0, 180), content: choice === 'local' ? remote.content : doc.content, createdAt: now, updatedAt: now }
    savePreferences({ ...refs.current.preferences, excluded: [...refs.current.preferences.excluded, copy.id] })
    await refs.current.commit(state => ({ ...state, documents: [...state.documents, copy] }))
    if (choice === 'local') {
      await client.write(remote.file.id, doc, remote.file.etag || '')
      await patch(doc, { drive: { ...doc.drive, base: await fingerprint(doc), pending: undefined } })
    } else await patch(doc, { name: remote.name, content: remote.content, updatedAt: Math.max(now, doc.updatedAt), drive: { ...doc.drive, base: await fingerprint(remote), pending: undefined } })
    setConflicts(items => items.filter(item => item.id !== id)); setMessage('Conflito resolvido. A outra versão foi preservada como documento local.')
  }

  return <>
    <button ref={trigger} className="drive-trigger" onClick={() => setOpen(true)} aria-label="Google Drive"><Cloud size={16} /><span>Google Drive</span><small>{!online ? 'Offline' : busy ? 'Sincronizando' : conflicts.length ? 'Conflito' : error ? 'Atenção' : session && pendingIds.length ? 'Pendente' : session ? 'Conectado' : 'Conectar'}</small></button>
    {open && <div className="drive-overlay"><div ref={dialog} className="drive-panel" role="dialog" aria-modal="true" aria-labelledby="drive-title" tabIndex={-1}>
      <header><div className="drive-heading"><Cloud size={26} /><div><h2 id="drive-title">Seu espaço, em qualquer lugar</h2><p>Google Drive · documentos Markdown</p></div></div><button className="icon-button" aria-label="Fechar Google Drive" disabled={busy} onClick={() => setOpen(false)}><X size={20} /></button></header>
      <div className="drive-body">
        <section className="drive-account"><div><strong>{session?.account.email || 'Conecte seu Google Drive'}</strong><p>{session ? `${pending} documento(s) vinculado(s) · ${lastSync ? `Última verificação às ${new Date(lastSync).toLocaleTimeString('pt-BR')}` : 'Aguardando primeira sincronização'}` : 'Escolha seus arquivos e leve sua escrita para outros dispositivos.'}</p></div>
          {session ? <button className="secondary-button" disabled={busy} onClick={() => { setSession(null); refs.current.session = null; setConflicts([]); setSelected([]); setMessage('Desconectado. Seus documentos continuam disponíveis neste navegador.') }}>Desconectar</button> : <button className="primary-button" disabled={!ready || busy || disabled || !online} onClick={() => void connect()}>Conectar ao Google Drive</button>}
        </section>
        {!driveConfigured && <p className="drive-notice">A conexão com o Google Drive está aguardando configuração pelo responsável pelo Neoryn. Sua biblioteca local continua disponível.</p>}
        {driveConfigured && !ready && error && <button className="secondary-button" onClick={() => { setError(''); void prepareGoogle().then(() => setReady(true)).catch(err => setError(err.message)) }}>Tentar carregar conexão novamente</button>}
        {!online && <p className="drive-notice"><CloudOff size={16} /> Você está offline. As alterações ficam salvas no navegador.</p>}
        {error && <p className="drive-error" role="alert">{error}</p>}
        <p className="drive-status" role="status">{busy ? 'Sincronizando com o Google Drive…' : message}</p>
        {session && <>
          <section className="drive-section"><h3>Organize sua conexão</h3><div className="drive-actions">
            <button className="secondary-button" disabled={busy || disabled} onClick={() => void run(async () => { const chosen = await pickFiles(requireSession().token, true); if (!chosen[0]) return; const folder = await requireSession().client.folder(chosen[0].id); savePreferences({ ...refs.current.preferences, folderId: folder.id, folderName: folder.title }) })}><FolderOpen size={16} />{preferences.folderName || 'Escolher pasta de destino'}</button>
            <button className="primary-button" disabled={busy || disabled || !online} onClick={() => void run(() => sync(true))}><RefreshCw size={16} />Sincronizar agora</button>
          </div><p>Novos arquivos são enviados à pasta escolhida. Os documentos já vinculados continuam em suas pastas atuais.</p></section>
          <section className="drive-section"><h3>Do seu jeito</h3>
            {([['autosave', 'Salvar automaticamente no Drive', 'Envia as edições após uma pausa na escrita. Desligado, use “Sincronizar agora”.'], ['autoUpload', 'Enviar novos documentos automaticamente', 'Envia documentos criados após ativar esta opção. Use o envio manual para os anteriores.'], ['autoPull', 'Buscar alterações automaticamente', 'Verifica os arquivos vinculados durante o uso e ao voltar à aba.'], ['autoImport', 'Importar novos arquivos automaticamente', 'Busca arquivos autorizados diretamente na pasta escolhida. Subpastas não são percorridas.']] as const).map(([key, title, description]) => <label className="drive-toggle" key={key}><span><strong>{title}</strong><small>{description}</small></span><input type="checkbox" role="switch" checked={preferences[key]} disabled={busy || disabled || ((key === 'autoUpload' || key === 'autoImport') && !preferences.folderId)} onChange={event => { try { savePreferences({ ...refs.current.preferences, [key]: event.target.checked, ...(key === 'autoUpload' && event.target.checked ? { uploadSince: Date.now() } : {}) }) } catch { setError('Não foi possível salvar a preferência neste navegador.') } }} /></label>)}
            <p className="drive-caption">O salvamento local continua ativo. O Drive só sincroniza com o aplicativo aberto e autorizado; ao expirar o acesso, será necessário reconectar.</p>
          </section>
          <section className="drive-section"><h3>Traga seus documentos</h3><div className="drive-actions"><select aria-label="Modo de importação do Drive" value={importMode} disabled={busy} onChange={event => setImportMode(event.target.value as 'linked' | 'copy')}><option value="linked">Manter sincronizado com o Drive</option><option value="copy">Criar cópia local independente</option></select><button className="secondary-button" disabled={busy || disabled} onClick={() => void run(async () => { const files = await pickFiles(requireSession().token); for (const file of files) await importFile(file.id, importMode === 'copy'); setMessage(`${files.length} arquivo(s) selecionado(s). Documentos já vinculados não são duplicados.`) })}><Download size={16} />Importar do Drive</button></div><p>Selecione arquivos .md, .markdown ou .txt. Apenas arquivos criados pelo Neoryn ou autorizados no seletor ficam disponíveis à sincronização.</p></section>
          {!!conflicts.length && <section className="drive-section drive-conflicts"><h3>Versões que precisam da sua escolha</h3><p>O documento mudou nos dois lugares. A versão substituída será preservada como cópia local.</p>{conflicts.map(item => <div key={item.id}><strong>{item.name}</strong><div className="drive-actions"><button disabled={busy} onClick={() => void run(() => resolveConflict(item.id, 'local'))}>Usar versão local</button><button disabled={busy} onClick={() => void run(() => resolveConflict(item.id, 'remote'))}>Usar versão do Drive</button><button disabled={busy} onClick={() => void run(() => resolveConflict(item.id, 'both'))}>Manter ambas</button></div></div>)}</section>}
          <section className="drive-section"><h3>Seus documentos</h3><p>Escolha quais documentos enviar. “Somente local” interrompe o vínculo e mantém o arquivo no Drive.</p>
            <div className="drive-documents">{library.documents.map(doc => {
              const belongs = doc.drive?.account === session.account.id
              return <div className="drive-document" key={doc.id}><label><input type="checkbox" aria-label={`Enviar ${doc.name}`} disabled={busy || !!doc.deletedAt || (!!doc.drive && !belongs)} checked={selected.includes(doc.id)} onChange={event => setSelected(ids => event.target.checked ? [...ids, doc.id] : ids.filter(id => id !== doc.id))} /><span><strong>{doc.name}</strong><small>{doc.deletedAt ? 'Na lixeira local' : belongs ? pendingIds.includes(doc.id) ? 'Alterações pendentes de envio' : 'Sincronizado com o Drive' : doc.drive ? 'Vinculado a outra conta' : 'Somente neste navegador'}</small></span></label>
                <div className="drive-actions">{belongs && <><button disabled={busy} onClick={() => void run(async () => { savePreferences({ ...refs.current.preferences, excluded: [...refs.current.preferences.excluded, doc.id], ignored: [...refs.current.preferences.ignored, doc.drive!.fileId] }); await patch(doc, { drive: undefined, localOnly: true }) }, false)}>Somente local</button><button disabled={busy} onClick={() => setConfirmTrash(doc.id)}>Lixeira do Drive</button></>}{!doc.drive && <label className="drive-local"><input type="checkbox" aria-label={`Manter ${doc.name} somente local`} checked={!!doc.localOnly || preferences.excluded.includes(doc.id)} disabled={busy} onChange={event => { const checked = event.target.checked; void run(async () => { savePreferences({ ...refs.current.preferences, excluded: checked ? [...refs.current.preferences.excluded, doc.id] : refs.current.preferences.excluded.filter(id => id !== doc.id) }); await patch(doc, { localOnly: checked }) }, false) }} />Manter local</label>}</div>
              </div>
            })}</div>
            {confirmTrash && <div className="drive-notice"><strong>Mover “{library.documents.find(doc => doc.id === confirmTrash)?.name}” para a lixeira do Drive?</strong><p>A cópia local será mantida e desvinculada.</p><div className="drive-actions"><button disabled={busy} onClick={() => setConfirmTrash(null)}>Cancelar</button><button className="danger" disabled={busy} onClick={() => void run(async () => { const doc = refs.current.getLibrary().documents.find(item => item.id === confirmTrash); if (!doc?.drive || doc.drive.account !== requireSession().account.id) return; const file = await requireSession().client.metadata(doc.drive.fileId); await requireSession().client.trash(file); savePreferences({ ...refs.current.preferences, excluded: [...refs.current.preferences.excluded, doc.id], ignored: [...refs.current.preferences.ignored, doc.drive.fileId] }); await patch(doc, { drive: undefined, localOnly: true }); setConfirmTrash(null) })}>Confirmar envio à lixeira</button></div></div>}
            <button className="secondary-button" disabled={busy || disabled || !selected.length} onClick={() => void run(async () => { for (const id of selected) { const doc = refs.current.getLibrary().documents.find(item => item.id === id); if (doc && !doc.deletedAt) { await send(doc); const sent = refs.current.getLibrary().documents.find(item => item.id === id); if (sent?.localOnly) await patch(sent, { localOnly: false }); savePreferences({ ...refs.current.preferences, excluded: refs.current.preferences.excluded.filter(value => value !== id) }) } } setSelected([]); setMessage('Documentos enviados. Confira eventuais conflitos acima.') })}><Upload size={16} />Enviar selecionados ({selected.length})</button>
            {!activeDocs.length && <p>Crie ou importe um documento para começar.</p>}
          </section>
        </>}
        <footer><Check size={15} /> Sua biblioteca local permanece disponível, mesmo sem conexão. <a href={`${import.meta.env.BASE_URL}privacy.html`} target="_blank" rel="noreferrer">Privacidade</a></footer>
      </div>
    </div></div>}
  </>
}
