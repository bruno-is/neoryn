import { LIBRARY_LIMITS, validateLibrary, type DocumentRecord, type LibraryState } from './library'
import { createSeedLibrary } from './seed'
import { migrateBrandContent, migrateStarterContent } from './starterContent'

export type { DocumentRecord, FolderRecord, LibraryState } from './library'

// Compatibility contract: keep database, draft, backup and writer-lock identifiers.
// Older tabs and exported snapshots must continue to share this library.
const DATABASE_NAME = 'lume-library'
const STORE_NAME = 'library'
const CURRENT_KEY = 'current'
const PREVIOUS_KEY = 'previous'
const BACKUP_FORMAT = 'lume-backup'
const BACKUP_VERSION = 1
const DRAFT_KEY = 'lume-pending-drafts-v1'
const MAX_DRAFT_CHARACTERS = 2_000_000
const MAX_PENDING_DOCUMENTS = 12

export type PendingDraft = Pick<DocumentRecord, 'id' | 'content' | 'updatedAt'>

function readPendingDrafts(): PendingDraft[] {
  if (typeof localStorage === 'undefined') return []
  let raw: string | null
  try { raw = localStorage.getItem(DRAFT_KEY) } catch (cause) {
    throw new LibraryStorageError('Não foi possível acessar a cópia de emergência das alterações.', cause)
  }
  if (!raw) return []
  try {
    if (raw.length > MAX_DRAFT_CHARACTERS) throw new Error('A cópia de emergência excede o limite.')
    const payload = JSON.parse(raw) as { version?: unknown; drafts?: unknown }
    if (payload?.version !== 1 || !Array.isArray(payload.drafts) || payload.drafts.length > MAX_PENDING_DOCUMENTS) throw new Error('Formato de rascunho inválido.')
    const ids = new Set<string>()
    return payload.drafts.map((value: unknown) => {
      const draft = validateDraft(value)
      if (ids.has(draft.id)) throw new Error('Rascunho repetido.')
      ids.add(draft.id)
      return draft
    })
  } catch (cause) {
    throw new LibraryStorageError('A cópia de emergência está inválida e foi preservada. Exporte um backup antes de limpar os dados do site.', cause)
  }
}

function validateDraft(value: unknown): PendingDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Rascunho inválido.')
  const draft = value as Record<string, unknown>
  if (typeof draft.id !== 'string' || !draft.id.trim() || draft.id.length > 128 || typeof draft.content !== 'string' || draft.content.length > MAX_DRAFT_CHARACTERS || typeof draft.updatedAt !== 'number' || !Number.isSafeInteger(draft.updatedAt) || draft.updatedAt < 0) throw new Error('Rascunho inválido.')
  return { id: draft.id, content: draft.content, updatedAt: draft.updatedAt }
}

/** Synchronous last-chance protection; the durable library remains in IndexedDB. */
export function savePendingDraft(value: PendingDraft): void {
  if (typeof localStorage === 'undefined') throw new LibraryStorageError('A cópia de emergência não está disponível neste navegador.')
  try {
    const draft = validateDraft(value)
    const existing = readPendingDrafts()
    const previous = existing.find(item => item.id === draft.id)
    if (previous && previous.updatedAt > draft.updatedAt) return
    const drafts = [...existing.filter(item => item.id !== draft.id), draft]
    const serialized = JSON.stringify({ version: 1, drafts })
    if (drafts.length > MAX_PENDING_DOCUMENTS || serialized.length > MAX_DRAFT_CHARACTERS) throw new Error('A cópia de emergência está cheia. Aguarde o salvamento dos documentos.')
    localStorage.setItem(DRAFT_KEY, serialized)
  } catch (cause) {
    throw new LibraryStorageError('Não foi possível criar a cópia de emergência. Aguarde a indicação de salvamento antes de fechar a página.', cause)
  }
}

function clearCommittedDrafts(state: LibraryState): void {
  if (typeof localStorage === 'undefined') return
  const drafts = readPendingDrafts()
  if (!drafts.length) return
  const committed = new Map(state.documents.map(document => [document.id, document.content]))
  const remaining = drafts.filter(draft => committed.get(draft.id) !== draft.content)
  if (remaining.length === drafts.length) return
  try {
    if (remaining.length) localStorage.setItem(DRAFT_KEY, JSON.stringify({ version: 1, drafts: remaining }))
    else localStorage.removeItem(DRAFT_KEY)
  } catch (cause) {
    throw new LibraryStorageError('O documento foi salvo, mas a cópia de emergência não pôde ser atualizada.', cause)
  }
}

function mergePendingDrafts(state: LibraryState): LibraryState {
  const drafts = new Map(readPendingDrafts().map(draft => [draft.id, draft]))
  if (!drafts.size) return state
  const documents = state.documents.map(document => {
    const draft = drafts.get(document.id)
    return draft && document.deletedAt === null && draft.updatedAt >= document.updatedAt && draft.content !== document.content
      ? { ...document, content: draft.content, updatedAt: draft.updatedAt }
      : document
  })
  return validateLibrary({ ...state, documents })
}

interface BackupEnvelope {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  exportedAt: string
  library: LibraryState
}

export class LibraryStorageError extends Error {
  readonly cause: unknown
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'LibraryStorageError'
    this.cause = cause
  }
}

function envelope(state: LibraryState): BackupEnvelope {
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), library: validateLibrary(state) }
}

function decodeEnvelope(value: unknown): LibraryState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('O backup não é um objeto válido.')
  const backup = value as Record<string, unknown>
  if (backup.format !== BACKUP_FORMAT) throw new Error('Este arquivo não é um backup do Neoryn.')
  if (backup.version !== BACKUP_VERSION) throw new Error('A versão deste backup ainda não é compatível.')
  if (typeof backup.exportedAt !== 'string' || !Number.isFinite(Date.parse(backup.exportedAt))) throw new Error('A data do backup é inválida.')
  return validateLibrary(backup.library)
}

export function exportBackup(state: LibraryState): string {
  return JSON.stringify(envelope(state), null, 2)
}

export function importBackup(json: string): LibraryState {
  if (json.length > LIBRARY_LIMITS.backupCharacters) throw new Error('O backup ultrapassa o tamanho permitido.')
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('Não foi possível ler o backup. Escolha um arquivo JSON válido.')
  }
  return decodeEnvelope(parsed)
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new LibraryStorageError('O armazenamento local está indisponível neste navegador. Exporte seus documentos antes de fechar a página.'))
      return
    }
    let request: IDBOpenDBRequest
    try {
      request = globalThis.indexedDB.open(DATABASE_NAME, 1)
    } catch (cause) {
      reject(new LibraryStorageError('Não foi possível acessar a biblioteca local.', cause))
      return
    }
    let failed = false
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => {
      const database = request.result
      if (failed) { database.close(); return }
      database.onversionchange = () => database.close()
      resolve(database)
    }
    request.onerror = () => reject(new LibraryStorageError('Não foi possível abrir a biblioteca local.', request.error))
    request.onblocked = () => {
      failed = true
      reject(new LibraryStorageError('Outra aba está impedindo a abertura da biblioteca. Feche as outras abas do Neoryn e tente novamente.'))
    }
  })
}

async function readSnapshot(key: string): Promise<unknown> {
  const database = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const request = transaction.objectStore(STORE_NAME).get(key)
      transaction.oncomplete = () => resolve(request.result)
      transaction.onerror = () => reject(new LibraryStorageError('Não foi possível ler os documentos salvos.', transaction.error))
      transaction.onabort = () => reject(new LibraryStorageError('A leitura dos documentos foi interrompida.', transaction.error))
    })
  } finally {
    database.close()
  }
}

let pendingLoad: Promise<LibraryState> | null = null

export function loadLibrary(): Promise<LibraryState> {
  if (pendingLoad) return pendingLoad
  pendingLoad = (async () => {
    // Complete saves already requested before reading a fresh snapshot.
    await saveQueue.catch(() => undefined)
    const stored = await readSnapshot(CURRENT_KEY)
    if (stored === undefined) {
      const initial = createSeedLibrary()
      await saveLibrary(initial)
      return initial
    }
    try {
      return migrateBrandContent(migrateStarterContent(mergePendingDrafts(decodeEnvelope(stored))))
    } catch (cause) {
      throw new LibraryStorageError('A biblioteca salva não pôde ser validada. Os dados originais foram preservados. Você pode recuperar a cópia anterior ou importar um backup.', cause)
    }
  })().finally(() => { pendingLoad = null })
  return pendingLoad
}

let saveQueue: Promise<void> = Promise.resolve()

/** Saves run in call order, preserving a complete previous snapshot atomically. */
export function saveLibrary(state: LibraryState): Promise<void> {
  return enqueueSave(state, false)
}

/** Explicit recovery archives the original snapshot, including corrupt data. */
export function restoreLibrary(state: LibraryState): Promise<void> {
  return enqueueSave(state, true)
}

function enqueueSave(state: LibraryState, recovering: boolean): Promise<void> {
  let next: BackupEnvelope
  try {
    // Capture now, not when an earlier asynchronous save finishes.
    next = envelope(state)
  } catch (cause) {
    return Promise.reject(new LibraryStorageError('A biblioteca não foi salva porque contém dados inválidos.', cause))
  }
  const task = saveQueue.catch(() => undefined).then(async () => {
    const database = await openDatabase()
    try {
      const recoveryDrafts = recovering && typeof localStorage !== 'undefined' ? localStorage.getItem(DRAFT_KEY) : null
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite')
        const store = transaction.objectStore(STORE_NAME)
        const request = store.get(CURRENT_KEY)
        let failure: unknown = null
        request.onsuccess = () => {
          try {
            if (request.result !== undefined) {
              if (recovering) {
                store.put(request.result, `recovery:${Date.now()}:${globalThis.crypto.randomUUID()}`)
              } else {
                decodeEnvelope(request.result)
                store.put(request.result, PREVIOUS_KEY)
              }
            }
            if (recoveryDrafts !== null) store.put(recoveryDrafts, `recovery-drafts:${Date.now()}:${globalThis.crypto.randomUUID()}`)
            store.put(next, CURRENT_KEY)
          } catch (cause) {
            failure = cause
            transaction.abort()
          }
        }
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(new LibraryStorageError('Não foi possível salvar. O armazenamento pode estar cheio ou bloqueado. Exporte um backup para proteger suas alterações.', failure ?? transaction.error))
        transaction.onabort = () => reject(new LibraryStorageError('O salvamento foi interrompido. A última biblioteca salva foi preservada; exporte um backup das alterações atuais.', failure ?? transaction.error))
      })
      // Recovery is explicit: preserve even malformed drafts in IndexedDB first.
      if (recoveryDrafts !== null && localStorage.getItem(DRAFT_KEY) === recoveryDrafts) localStorage.removeItem(DRAFT_KEY)
      clearCommittedDrafts(next.library)
    } finally {
      database.close()
    }
  })
  saveQueue = task
  return task
}

/** Read-only recovery: never replaces the original or silently discards it. */
export async function loadPreviousLibrary(): Promise<LibraryState | null> {
  const stored = await readSnapshot(PREVIOUS_KEY)
  return stored === undefined ? null : decodeEnvelope(stored)
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false
  if (navigator.storage.persisted && await navigator.storage.persisted()) return true
  return navigator.storage.persist()
}

/** Hold one writable tab per origin until release; null means another tab owns it. */
export function acquireLibraryLock(): Promise<(() => void) | null> {
  if (typeof navigator === 'undefined' || !navigator.locks?.request) {
    return Promise.reject(new LibraryStorageError('Este navegador não permite proteger a biblioteca contra edições em várias abas. Use uma versão atual do seu navegador.'))
  }
  return new Promise((resolve, reject) => {
    navigator.locks.request('lume-library-writer', { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock) { resolve(null); return }
      await new Promise<void>(release => { resolve(release) })
    }).catch(cause => reject(new LibraryStorageError('Não foi possível proteger a biblioteca para edição.', cause)))
  })
}
