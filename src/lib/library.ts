export interface DocumentRecord {
  id: string
  name: string
  content: string
  folderId: string | null
  favorite: boolean
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export interface FolderRecord {
  id: string
  name: string
  parentId: string | null
  createdAt: number
}

export interface LibraryState {
  /** Present after the original sample collection has been retired. */
  starterContentVersion?: 2
  documents: DocumentRecord[]
  folders: FolderRecord[]
  activeId: string | null
  openTabIds: string[]
  settings: {
    theme: 'light' | 'dark' | 'system'
    fontSize: number
    editorMode: 'live' | 'source' | 'split'
    focusMode: boolean
    sidebarVisible: boolean
    folderDeletionMode: 'keep' | 'trash'
  }
}

export interface OutlineEntry {
  id: string
  text: string
  level: number
  /** One-based source line, including any leading front matter. */
  line: number
}

export const DEFAULT_SETTINGS: LibraryState['settings'] = {
  theme: 'light',
  fontSize: 17,
  editorMode: 'live',
  focusMode: false,
  sidebarVisible: true,
  folderDeletionMode: 'keep',
}

export const LIBRARY_LIMITS = {
  documents: 10_000,
  folders: 2_000,
  documentCharacters: 10_000_000,
  totalCharacters: 25_000_000,
  backupCharacters: 60_000_000,
} as const

export class LibraryValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LibraryValidationError'
  }
}

export function openDocumentTab(tabs: string[], id: string): string[] {
  return tabs.includes(id) ? tabs : [...tabs, id].slice(-6)
}

function invalid(message: string): never {
  throw new LibraryValidationError(message)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(`${label} deve ser um objeto.`)
  }
  return value as Record<string, unknown>
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) {
    invalid(`${label} contém um identificador inválido.`)
  }
  return value
}

function nullableId(value: unknown, label: string): string | null {
  return value === null ? null : identifier(value, label)
}

function name(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 180 || /[\u0000-\u001f]/.test(value)) {
    invalid(`${label} deve ter um nome de até 180 caracteres.`)
  }
  return value
}

function timestamp(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    invalid(`${label} contém uma data inválida.`)
  }
  return value
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') invalid(`${label} deve ser verdadeiro ou falso.`)
  return value
}

/** Validate and copy the entire state before accepting a backup or saving data. */
export function validateLibrary(value: unknown): LibraryState {
  const source = record(value, 'Biblioteca')
  if (!Array.isArray(source.documents) || source.documents.length > LIBRARY_LIMITS.documents) {
    invalid(`A biblioteca deve conter até ${LIBRARY_LIMITS.documents} documentos.`)
  }
  if (!Array.isArray(source.folders) || source.folders.length > LIBRARY_LIMITS.folders) {
    invalid(`A biblioteca deve conter até ${LIBRARY_LIMITS.folders} pastas.`)
  }
  const ids = new Set<string>()
  const folders = source.folders.map((value, index): FolderRecord => {
    const folder = record(value, `Pasta ${index + 1}`)
    const id = identifier(folder.id, 'Pasta')
    if (ids.has(id)) invalid('O backup contém identificadores repetidos.')
    ids.add(id)
    return {
      id,
      name: name(folder.name, 'Pasta'),
      parentId: nullableId(folder.parentId, 'Pasta superior'),
      createdAt: timestamp(folder.createdAt, 'Pasta'),
    }
  })
  const folderMap = new Map(folders.map(folder => [folder.id, folder]))
  for (const folder of folders) {
    const ancestors = new Set([folder.id])
    let current = folder
    while (current.parentId !== null) {
      if (ancestors.has(current.parentId)) invalid('As pastas do backup formam um ciclo.')
      ancestors.add(current.parentId)
      const parent = folderMap.get(current.parentId)
      if (!parent) invalid('Uma pasta superior não foi encontrada no backup.')
      current = parent
    }
  }
  let totalCharacters = 0
  const documents = source.documents.map((value, index): DocumentRecord => {
    const document = record(value, `Documento ${index + 1}`)
    const id = identifier(document.id, 'Documento')
    if (ids.has(id)) invalid('O backup contém identificadores repetidos.')
    ids.add(id)
    if (typeof document.content !== 'string' || document.content.length > LIBRARY_LIMITS.documentCharacters) {
      invalid('Um documento ultrapassa o limite de 10 milhões de caracteres.')
    }
    totalCharacters += document.content.length
    if (totalCharacters > LIBRARY_LIMITS.totalCharacters) invalid('O conteúdo da biblioteca ultrapassa 25 milhões de caracteres.')
    const folderId = nullableId(document.folderId, 'Pasta do documento')
    if (folderId !== null && !folderMap.has(folderId)) invalid('A pasta de um documento não foi encontrada no backup.')
    const createdAt = timestamp(document.createdAt, 'Criação do documento')
    const updatedAt = timestamp(document.updatedAt, 'Alteração do documento')
    const deletedAt = document.deletedAt === null ? null : timestamp(document.deletedAt, 'Exclusão do documento')
    if (updatedAt < createdAt) invalid('A alteração de um documento é anterior à sua criação.')
    return {
      id,
      name: name(document.name, 'Documento'),
      content: document.content,
      folderId,
      favorite: boolean(document.favorite, 'Favorito'),
      createdAt,
      updatedAt,
      deletedAt,
    }
  })
  const activeId = nullableId(source.activeId, 'Documento aberto')
  if (activeId !== null && !documents.some(document => document.id === activeId)) {
    invalid('O documento aberto não foi encontrado na biblioteca.')
  }
  if (source.openTabIds !== undefined && (!Array.isArray(source.openTabIds) || source.openTabIds.some(id => typeof id !== 'string'))) {
    invalid('A lista de abas abertas é inválida.')
  }
  const documentIds = new Set(documents.map(document => document.id))
  const savedTabs = (source.openTabIds ?? []) as string[]
  const existingTabs = [...new Set(savedTabs)].filter(id => documentIds.has(id)).slice(-6)
  const openTabIds = activeId ? openDocumentTab(existingTabs, activeId) : existingTabs
  const settings = record(source.settings, 'Preferências')
  if (settings.folderDeletionMode !== undefined && settings.folderDeletionMode !== 'keep' && settings.folderDeletionMode !== 'trash') {
    invalid('A opção de exclusão de pastas é inválida.')
  }
  if (settings.theme !== 'light' && settings.theme !== 'dark' && settings.theme !== 'system') invalid('O tema selecionado é inválido.')
  if (settings.editorMode !== 'live' && settings.editorMode !== 'source' && settings.editorMode !== 'split') invalid('O modo do editor é inválido.')
  if (typeof settings.fontSize !== 'number' || !Number.isFinite(settings.fontSize) || settings.fontSize < 12 || settings.fontSize > 32) {
    invalid('O tamanho da fonte deve estar entre 12 e 32.')
  }
  return {
    ...(source.starterContentVersion === 2 ? { starterContentVersion: 2 as const } : {}),
    documents,
    folders,
    activeId,
    openTabIds,
    settings: {
      theme: settings.theme as LibraryState['settings']['theme'],
      fontSize: settings.fontSize,
      editorMode: settings.editorMode as LibraryState['settings']['editorMode'],
      focusMode: boolean(settings.focusMode, 'Modo foco'),
      sidebarVisible: boolean(settings.sidebarVisible, 'Barra lateral'),
      folderDeletionMode: settings.folderDeletionMode ?? DEFAULT_SETTINGS.folderDeletionMode,
    },
  }
}

/** Includes the requested folder. Traversal remains safe even with cyclic input. */
export function getFolderDescendants(folders: FolderRecord[], folderId: string): Set<string> {
  const descendants = new Set<string>()
  const pending = [folderId]
  const children = new Map<string, string[]>()
  for (const folder of folders) {
    if (folder.parentId === null) continue
    const siblings = children.get(folder.parentId) ?? []
    siblings.push(folder.id)
    children.set(folder.parentId, siblings)
  }
  while (pending.length) {
    const id = pending.pop()!
    if (descendants.has(id)) continue
    descendants.add(id)
    pending.push(...(children.get(id) ?? []))
  }
  return descendants
}

export function canMoveFolder(folders: FolderRecord[], folderId: string, targetParentId: string | null): boolean {
  if (!folders.some(folder => folder.id === folderId)) return false
  if (targetParentId === null) return true
  if (!folders.some(folder => folder.id === targetParentId)) return false
  return !getFolderDescendants(folders, folderId).has(targetParentId)
}

/** Remove a folder tree and remember the confirmed choice in the same snapshot. */
export function removeFolder(state: LibraryState, folderId: string, mode: LibraryState['settings']['folderDeletionMode'], now = Date.now()): LibraryState {
  if (!state.folders.some(folder => folder.id === folderId)) return state
  const ids = getFolderDescendants(state.folders, folderId)
  return {
    ...state,
    folders: state.folders.filter(folder => !ids.has(folder.id)),
    documents: state.documents.map(doc => doc.folderId && ids.has(doc.folderId)
      ? { ...doc, folderId: null, ...(mode === 'trash' && doc.deletedAt === null ? { deletedAt: now, updatedAt: Math.max(now, doc.updatedAt) } : {}) }
      : doc),
    settings: { ...state.settings, folderDeletionMode: mode },
  }
}

export function uniqueName(desired: string, existingNames: Iterable<string>): string {
  const base = desired.trim().replace(/[\u0000-\u001f]/g, '').slice(0, 180) || 'Sem título'
  const occupied = new Set(Array.from(existingNames, value => value.trim().toLocaleLowerCase('pt-BR')))
  if (!occupied.has(base.toLocaleLowerCase('pt-BR'))) return base
  for (let index = 2; ; index++) {
    const suffix = ` (${index})`
    const candidate = `${base.slice(0, 180 - suffix.length)}${suffix}`
    if (!occupied.has(candidate.toLocaleLowerCase('pt-BR'))) return candidate
  }
}

export function createId(): string {
  return globalThis.crypto.randomUUID()
}

function headingText(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/[*_~`]/g, '')
    .replace(/\\([\\`*{}\[\]()#+\-.!_>])/g, '$1')
    .trim()
}

/** ATX and setext headings, excluding fenced code blocks and YAML front matter. */
export function parseOutline(markdown: string): OutlineEntry[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const outline: OutlineEntry[] = []
  let fence: { character: string; length: number } | null = null
  let frontMatter = lines[0]?.trim() === '---' && lines.slice(1).some(line => /^(---|\.\.\.)\s*$/.test(line))
  const slugCounts = new Map<string, number>()
  const append = (text: string, level: number, line: number) => {
    const clean = headingText(text)
    const slug = clean.toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-') || 'secao'
    const count = slugCounts.get(slug) ?? 0
    slugCounts.set(slug, count + 1)
    outline.push({ id: count ? `${slug}-${count}` : slug, text: clean || 'Sem título', level, line })
  }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (frontMatter) {
      if (index > 0 && /^(---|\.\.\.)\s*$/.test(line)) frontMatter = false
      continue
    }
    if (fence) {
      const close = line.match(/^ {0,3}(`+|~+)\s*$/)
      if (close && close[1][0] === fence.character && close[1].length >= fence.length) fence = null
      continue
    }
    const open = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
      fence = { character: open[1][0], length: open[1].length }
      continue
    }
    const atx = line.match(/^ {0,3}(#{1,6})(?:\s+|$)(.*)$/)
    if (atx) {
      append(atx[2].replace(/\s+#+\s*$/, ''), atx[1].length, index + 1)
      continue
    }
    const next = lines[index + 1]
    if (line.trim() && !/^\s*(>|[-+*]\s|\d+[.)]\s)/.test(line) && !/^ {4}|^\t/.test(line) && next && /^ {0,3}(=+|-+)\s*$/.test(next)) {
      append(line.trim(), next.trim()[0] === '=' ? 1 : 2, index + 1)
      index++
    }
  }
  return outline
}
