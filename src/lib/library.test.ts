import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canMoveFolder, getFolderDescendants, parseOutline, removeFolder, uniqueName, validateLibrary } from './library'
import { createSeedLibrary } from './seed'
import { createLegacySeedLibrary } from './legacySeed'
import { migrateBrandContent, migrateStarterContent } from './starterContent'
import { legacyWelcome } from './legacyWelcome'
import { exportBackup, importBackup, loadLibrary, loadPreviousLibrary, restoreLibrary, saveLibrary, savePendingDraft } from './storage'

const createPopulatedLibrary = (now: number) => ({ ...createLegacySeedLibrary(now), starterContentVersion: 2 as const })

beforeEach(async () => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  })
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('lume-library')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('An earlier test left the database open.'))
  })
})

afterEach(() => { vi.unstubAllGlobals() })

describe('folder deletion', () => {
  function nestedLibrary() {
    const state = createPopulatedLibrary(100)
    state.folders.push({ id: 'child', name: 'Filha', parentId: 'pessoal', createdAt: 100 })
    state.documents.push(
      { ...state.documents[1], id: 'nested', folderId: 'child', favorite: true },
      { ...state.documents[1], id: 'trashed', folderId: 'child', deletedAt: 150 },
    )
    state.activeId = 'nested'
    state.openTabIds = ['welcome', 'nested']
    return state
  }

  it('keeps nested documents, their contents and existing trash while removing only the chosen tree', () => {
    const state = nestedLibrary()
    const result = removeFolder(state, 'pessoal', 'keep', 200)
    expect(result.folders.map(folder => folder.id)).toEqual(['projetos', 'referencias'])
    expect(result.documents).toEqual(state.documents.map(doc => ['pessoal', 'child'].includes(doc.folderId ?? '') ? { ...doc, folderId: null } : doc))
    expect(result.settings.folderDeletionMode).toBe('keep')
    expect(validateLibrary(result)).toEqual(result)
    expect(state.folders).toHaveLength(4)
  })

  it('trashes only live documents in the tree and persists the choice with valid active tabs and backups', async () => {
    const state = nestedLibrary()
    const result = removeFolder(state, 'pessoal', 'trash', 200)
    expect(result.documents).toEqual(state.documents.map(doc => ['pessoal', 'child'].includes(doc.folderId ?? '')
      ? { ...doc, folderId: null, ...(doc.deletedAt === null ? { deletedAt: 200, updatedAt: 200 } : {}) }
      : doc))
    expect(result.activeId).toBe('nested')
    expect(result.openTabIds).toEqual(['welcome', 'nested'])
    expect(result.settings.folderDeletionMode).toBe('trash')
    await saveLibrary(result)
    expect(await loadLibrary()).toEqual(result)
    expect(importBackup(exportBackup(result))).toEqual(result)
  })

  it('removes an empty folder and can switch the saved choice back to keep', () => {
    const state = nestedLibrary()
    state.settings.folderDeletionMode = 'trash'
    const result = removeFolder(state, 'projetos', 'keep', 200)
    expect(result.documents).toEqual(state.documents)
    expect(result.settings.folderDeletionMode).toBe('keep')
    expect(result.folders.some(folder => folder.id === 'projetos')).toBe(false)
    expect(removeFolder(state, 'missing', 'keep')).toBe(state)
  })

  it('defaults old libraries and backups to keep and rejects invalid choices', () => {
    const old = JSON.parse(exportBackup(createPopulatedLibrary(100)))
    delete old.library.settings.folderDeletionMode
    expect(importBackup(JSON.stringify(old)).settings.folderDeletionMode).toBe('keep')
    old.library.settings.folderDeletionMode = 'unexpected'
    expect(() => importBackup(JSON.stringify(old))).toThrow('opção de exclusão de pastas')
  })
})

describe('starter content', () => {
  it('starts with one introduction at the root and no folders', async () => {
    const initial = createSeedLibrary(100)
    expect(initial.documents).toHaveLength(1)
    expect(initial.documents[0]).toMatchObject({ id: 'welcome', folderId: null })
    expect(initial.folders).toEqual([])
    expect((await loadLibrary()).documents).toHaveLength(1)
    expect(validateLibrary(initial)).toEqual(initial)
  })

  it('retires untouched legacy samples and keeps a recoverable previous snapshot', async () => {
    const legacy = createLegacySeedLibrary(100)
    legacy.activeId = 'markdown-guide'
    legacy.openTabIds = ['welcome', 'markdown-guide']
    await saveLibrary(legacy)
    const migrated = await loadLibrary()
    expect(migrated.documents).toEqual([legacy.documents[0]])
    expect(migrated.folders).toEqual([])
    expect(migrated.activeId).toBe('welcome')
    await saveLibrary(migrated)
    expect(await loadPreviousLibrary()).toEqual(legacy)
    expect(await loadLibrary()).toEqual(migrated)
  })

  it.each([
    { content: '# Minhas próprias notas' },
    { name: 'Guia personalizado' },
    { folderId: null },
    { favorite: true },
    { deletedAt: 200 },
    { updatedAt: 200 },
  ])('preserves a sample the user has changed: %j', changes => {
    const legacy = createLegacySeedLibrary(100)
    Object.assign(legacy.documents[1], changes)
    const migrated = migrateStarterContent(legacy)
    expect(migrated.documents).toContainEqual(legacy.documents[1])
    if (legacy.documents[1].folderId) expect(migrated.folders).toContainEqual(legacy.folders[0])
  })

  it('keeps renamed folders, nested folders and personal documents, and runs only once', () => {
    const legacy = createLegacySeedLibrary(100)
    legacy.folders[0].name = 'Minha pasta'
    legacy.folders.push({ id: 'child', name: 'Filha', parentId: 'projetos', createdAt: 200 })
    legacy.documents.push({ ...legacy.documents[0], id: 'mine', name: 'Minhas notas', folderId: 'referencias' })
    const migrated = migrateStarterContent(legacy)
    expect(migrated.folders).toEqual(legacy.folders)
    expect(migrated.documents.map(doc => doc.id)).toEqual(['welcome', 'mine'])
    migrated.documents = migrated.documents.filter(doc => doc.id !== 'mine')
    expect(migrateStarterContent(migrated).folders).toEqual(legacy.folders)
  })

  it('recovers last-minute edits before deciding whether an example is untouched', async () => {
    await saveLibrary(createLegacySeedLibrary(100))
    savePendingDraft({ id: 'workspace-guide', content: '# Última edição', updatedAt: 200 })
    const loaded = await loadLibrary()
    expect(loaded.documents.find(doc => doc.id === 'workspace-guide')?.content).toBe('# Última edição')
    expect(loaded.folders.map(folder => folder.id)).toContain('pessoal')
  })
})

describe('brand compatibility', () => {
  it('rebrands only an untouched welcome and retains the original recovery snapshot', async () => {
    const old = createSeedLibrary(100)
    old.documents[0].content = legacyWelcome
    await writeRawSnapshot({ format: 'lume-backup', version: 1, exportedAt: new Date(100).toISOString(), library: old })
    const updated = await loadLibrary()
    expect(updated).toEqual(createSeedLibrary(100))
    expect(migrateBrandContent(updated)).toBe(updated)
    await saveLibrary(updated)
    expect(await loadPreviousLibrary()).toEqual(old)
    expect(await loadLibrary()).toEqual(updated)
  })

  it.each([
    { content: legacyWelcome + '\nMinha ideia no Lume.' },
    { name: 'Minha introdução' },
    { updatedAt: 200 },
    { deletedAt: 200 },
    { id: 'personal-document' },
  ])('never rewrites an edited, renamed, deleted or copied welcome: %j', changes => {
    const state = createSeedLibrary(100)
    Object.assign(state.documents[0], { content: legacyWelcome }, changes)
    expect(migrateBrandContent(state)).toBe(state)
  })

  it('loads old snapshots with folders, tabs, preferences, favorites, trash and emergency drafts', async () => {
    const old = createPopulatedLibrary(100)
    old.documents[1].deletedAt = 150
    old.settings.theme = 'dark'
    old.settings.fontSize = 21
    old.openTabIds = [old.documents[0].id, old.documents[2].id]
    const backup = JSON.stringify({ format: 'lume-backup', version: 1, exportedAt: new Date(100).toISOString(), library: old })
    expect(importBackup(backup)).toEqual(old)
    await writeRawSnapshot(JSON.parse(backup))
    localStorage.setItem('lume-pending-drafts-v1', JSON.stringify({ version: 1, drafts: [{ id: old.documents[0].id, content: '# Rascunho anterior', updatedAt: 200 }] }))
    const expected = structuredClone(old)
    Object.assign(expected.documents[0], { content: '# Rascunho anterior', updatedAt: 200 })
    expect(await loadLibrary()).toEqual(expected)
    await saveLibrary(expected)
    expect(await loadPreviousLibrary()).toEqual(old)
    expect(localStorage.getItem('lume-pending-drafts-v1')).toBeNull()
    expect(importBackup(exportBackup(expected))).toEqual(expected)
  })
})

describe('portable backups', () => {
  it('round-trips documents, folders, preferences, favorites and deleted documents', () => {
    const library = createPopulatedLibrary(100)
    library.documents[1].deletedAt = 200
    library.settings.theme = 'dark'
    expect(importBackup(exportBackup(library))).toEqual(library)
  })

  it('rejects an unsupported version without accepting its data', () => {
    const backup = JSON.parse(exportBackup(createPopulatedLibrary(100)))
    backup.version = 999
    expect(() => importBackup(JSON.stringify(backup))).toThrow('versão')
    expect(() => importBackup('{broken')).toThrow('JSON')
  })

  it('rejects duplicated ids, missing folders and invalid active document pointers', () => {
    const duplicate = createPopulatedLibrary(100)
    duplicate.documents[1].id = duplicate.documents[0].id
    expect(() => validateLibrary(duplicate)).toThrow('repetidos')
    const missing = createPopulatedLibrary(100)
    missing.documents[0].folderId = 'absent'
    expect(() => validateLibrary(missing)).toThrow('não foi encontrada')
    const dangling = createPopulatedLibrary(100)
    dangling.activeId = 'absent'
    expect(() => validateLibrary(dangling)).toThrow('não foi encontrado')
    const deleted = createPopulatedLibrary(100)
    deleted.documents[0].deletedAt = 200
    expect(validateLibrary(deleted).activeId).toBe(deleted.documents[0].id)
  })

  it('rejects folder cycles and broken parent references', () => {
    const cyclic = createPopulatedLibrary(100)
    cyclic.folders[0].parentId = cyclic.folders[1].id
    cyclic.folders[1].parentId = cyclic.folders[0].id
    expect(() => validateLibrary(cyclic)).toThrow('ciclo')
    const orphan = createPopulatedLibrary(100)
    orphan.folders[0].parentId = 'missing'
    expect(() => validateLibrary(orphan)).toThrow('superior')
  })

  it('rejects oversized content and malformed preferences', () => {
    const huge = createPopulatedLibrary(100)
    huge.documents[0].content = 'a'.repeat(10_000_001)
    expect(() => validateLibrary(huge)).toThrow('limite')
    const invalid = createPopulatedLibrary(100)
    invalid.settings.fontSize = Infinity
    expect(() => validateLibrary(invalid)).toThrow('fonte')
  })
})

describe('saved document tabs', () => {
  it('restores tab order and the active document through storage and backup', async () => {
    const library = createPopulatedLibrary(100)
    library.openTabIds = ['markdown-guide', 'welcome', 'workspace-guide']
    await saveLibrary(library)
    expect(await loadLibrary()).toEqual(library)
    expect(importBackup(exportBackup(library))).toEqual(library)
    library.openTabIds = ['markdown-guide', 'workspace-guide']
    library.activeId = null
    await saveLibrary(library)
    expect(await loadLibrary()).toEqual(library)
    library.openTabIds = []
    await saveLibrary(library)
    expect((await loadLibrary()).openTabIds).toEqual([])
  })

  it('accepts older libraries without tabs and restores their active document', () => {
    const { openTabIds: _tabs, ...legacy } = createPopulatedLibrary(100)
    expect(validateLibrary(legacy).openTabIds).toEqual(['welcome'])
    expect(validateLibrary({ ...legacy, activeId: null }).openTabIds).toEqual([])
  })

  it('drops stale or duplicated tabs and keeps the active document visible', () => {
    const library = createPopulatedLibrary(100)
    library.openTabIds = ['markdown-guide', 'missing', 'markdown-guide']
    expect(validateLibrary(library).openTabIds).toEqual(['markdown-guide', 'welcome'])
    expect(() => validateLibrary({ ...library, openTabIds: 'welcome' })).toThrow('abas')
    expect(() => validateLibrary({ ...library, openTabIds: [null] })).toThrow('abas')
  })
})

describe('durable library', () => {
  it('initializes once and preserves edits across fresh loads', async () => {
    const initial = await loadLibrary()
    initial.documents[0].content = '# Uma ideia persistente'
    await saveLibrary(initial)
    const restored = await loadLibrary()
    expect(restored.documents[0].content).toBe('# Uma ideia persistente')
    expect(restored.folders).toEqual(initial.folders)
  })

  it('serializes overlapping writes and captures data at invocation time', async () => {
    const library = createPopulatedLibrary(100)
    library.documents[0].content = 'first'
    const first = saveLibrary(library)
    library.documents[0].content = 'second'
    const second = saveLibrary(library)
    library.documents[0].content = 'not saved'
    await Promise.all([first, second])
    expect((await loadLibrary()).documents[0].content).toBe('second')
    expect((await loadPreviousLibrary())?.documents[0].content).toBe('first')
  })

  it('rejects invalid writes without poisoning the queue or overwriting the library', async () => {
    const valid = createPopulatedLibrary(100)
    await saveLibrary(valid)
    const invalid = createPopulatedLibrary(100)
    invalid.documents[0].folderId = 'missing'
    await expect(saveLibrary(invalid)).rejects.toThrow('inválidos')
    expect(await loadLibrary()).toEqual(valid)
    valid.documents[0].content = 'next valid update'
    await saveLibrary(valid)
    expect((await loadLibrary()).documents[0].content).toBe('next valid update')
  })

  it('preserves corrupt data instead of silently resetting it or overwriting it', async () => {
    const original = createPopulatedLibrary(100)
    await saveLibrary(original)
    original.documents[0].content = 'new version'
    await saveLibrary(original)
    await writeRawSnapshot({ broken: true })
    await expect(loadLibrary()).rejects.toThrow('preservados')
    await expect(saveLibrary(createPopulatedLibrary(100))).rejects.toThrow('preservada')
    expect((await loadPreviousLibrary())?.documents[0].content).not.toBe('new version')
    await expect(loadLibrary()).rejects.toThrow('preservados')
  })

  it('allows explicit recovery while archiving the original corrupt snapshot', async () => {
    await saveLibrary(createPopulatedLibrary(100))
    await writeRawSnapshot({ broken: true })
    const recovered = createPopulatedLibrary(200)
    recovered.documents[0].content = 'recovered'
    await restoreLibrary(recovered)
    expect(await loadLibrary()).toEqual(recovered)
    expect(await readRawSnapshots()).toContainEqual({ broken: true })
  })
})

describe('emergency drafts', () => {
  it('recovers newer text on load and only clears it after that text is committed', async () => {
    const original = createPopulatedLibrary(100)
    await saveLibrary(original)
    savePendingDraft({ id: 'welcome', content: 'last typed paragraph', updatedAt: 200 })
    // An already queued older write must not delete a newer emergency draft.
    await saveLibrary(original)
    expect(localStorage.getItem('lume-pending-drafts-v1')).not.toBeNull()
    const recovered = await loadLibrary()
    expect(recovered.documents[0].content).toBe('last typed paragraph')
    expect(recovered.documents[0].updatedAt).toBe(200)
    await saveLibrary(recovered)
    expect(localStorage.getItem('lume-pending-drafts-v1')).toBeNull()
    expect((await loadLibrary()).documents[0].content).toBe('last typed paragraph')
  })

  it('does not overwrite a newer saved document with an old draft or resurrect trash', async () => {
    const original = createPopulatedLibrary(200)
    original.documents[1].deletedAt = 300
    await saveLibrary(original)
    savePendingDraft({ id: 'welcome', content: 'obsolete text', updatedAt: 100 })
    savePendingDraft({ id: 'workspace-guide', content: 'discarded text', updatedAt: 400 })
    expect((await loadLibrary()).documents).toEqual(original.documents)
  })

  it('keeps a newer draft if a delayed handler tries to store an older value', () => {
    savePendingDraft({ id: 'welcome', content: 'new', updatedAt: 200 })
    savePendingDraft({ id: 'welcome', content: 'old', updatedAt: 100 })
    expect(JSON.parse(localStorage.getItem('lume-pending-drafts-v1')!).drafts[0].content).toBe('new')
  })

  it('bounds emergency storage without dropping the previous saved draft', () => {
    savePendingDraft({ id: 'welcome', content: 'keep me', updatedAt: 200 })
    expect(() => savePendingDraft({ id: 'welcome', content: 'a'.repeat(2_000_001), updatedAt: 300 })).toThrow('cópia de emergência')
    expect(JSON.parse(localStorage.getItem('lume-pending-drafts-v1')!).drafts[0].content).toBe('keep me')
  })

  it('explicit recovery archives a malformed emergency copy before removing it', async () => {
    const original = createPopulatedLibrary(100)
    await saveLibrary(original)
    localStorage.setItem('lume-pending-drafts-v1', '{broken')
    await expect(loadLibrary()).rejects.toThrow('preservados')
    await restoreLibrary(original)
    expect(localStorage.getItem('lume-pending-drafts-v1')).toBeNull()
    expect(await readRawSnapshots()).toContain('{broken')
    expect(await loadLibrary()).toEqual(original)
  })
})

describe('folder organization', () => {
  const folders = [
    { id: 'a', parentId: null, name: 'A', createdAt: 1 },
    { id: 'b', parentId: 'a', name: 'B', createdAt: 1 },
    { id: 'c', parentId: 'b', name: 'C', createdAt: 1 },
    { id: 'd', parentId: null, name: 'D', createdAt: 1 },
  ]

  it('prevents moving a folder into itself or a descendant', () => {
    expect(getFolderDescendants(folders, 'a')).toEqual(new Set(['a', 'b', 'c']))
    expect(canMoveFolder(folders, 'a', 'c')).toBe(false)
    expect(canMoveFolder(folders, 'a', 'a')).toBe(false)
    expect(canMoveFolder(folders, 'a', 'missing')).toBe(false)
    expect(canMoveFolder(folders, 'b', 'd')).toBe(true)
    expect(canMoveFolder(folders, 'b', null)).toBe(true)
  })

  it('finds readable unique names without exceeding the name limit', () => {
    expect(uniqueName('Ideia', ['ideia', 'Ideia (2)'])).toBe('Ideia (3)')
    expect(uniqueName('  ', [])).toBe('Sem título')
    expect(uniqueName('a'.repeat(180), ['a'.repeat(180)]).length).toBe(180)
  })
})

describe('document outline', () => {
  it('ignores front matter and fenced code, preserving source line positions', () => {
    const markdown = ['---', 'title: Example', '---', '# Intro', '```md', '# Not a heading', '```', '## Part **two**', '~~~', '# Not either', '~~~', 'Ending', '------'].join('\n')
    expect(parseOutline(markdown)).toEqual([
      { id: 'intro', text: 'Intro', level: 1, line: 4 },
      { id: 'part-two', text: 'Part two', level: 2, line: 8 },
      { id: 'ending', text: 'Ending', level: 2, line: 12 },
    ])
  })

  it('respects fence length and assigns unique ids to repeated headings', () => {
    const markdown = '# Começo\n####### no\n#not-a-heading\n````js\n```\n# hidden\n````\n## Começo\n  ### [Fim](https://example.org) ###'
    expect(parseOutline(markdown).map(({ id, level }) => ({ id, level }))).toEqual([
      { id: 'começo', level: 1 }, { id: 'começo-1', level: 2 }, { id: 'fim', level: 3 },
    ])
  })
})

async function writeRawSnapshot(value: unknown): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('lume-library', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('library')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('library', 'readwrite')
      transaction.objectStore('library').put(value, 'current')
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
}

async function readRawSnapshots(): Promise<unknown[]> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('lume-library', 1)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    return await new Promise<unknown[]>((resolve, reject) => {
      const transaction = database.transaction('library', 'readonly')
      const request = transaction.objectStore('library').getAll()
      transaction.oncomplete = () => resolve(request.result)
      transaction.onerror = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
}
