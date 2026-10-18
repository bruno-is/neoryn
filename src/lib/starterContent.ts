import { openDocumentTab, type LibraryState } from './library'
import { createLegacySeedLibrary } from './legacySeed'
import { legacyWelcome } from './legacyWelcome'
import { createSeedLibrary } from './seed'

/** Rebrand only the exact, unedited shipped welcome; preserve all user changes. */
export function migrateBrandContent(state: LibraryState): LibraryState {
  const current = createSeedLibrary(0).documents[0]
  let changed = false
  const documents = state.documents.map(doc => {
    if (doc.id !== current.id || doc.name !== current.name || doc.content !== legacyWelcome
      || doc.updatedAt !== doc.createdAt || doc.deletedAt !== null) return doc
    changed = true
    return { ...doc, content: current.content }
  })
  return changed ? { ...state, documents } : state
}

/** Remove only untouched, identifiable samples, once per library. */
export function migrateStarterContent(state: LibraryState): LibraryState {
  if (state.starterContentVersion === 2) return state
  const legacy = createLegacySeedLibrary(0)
  const removed = new Set<string>()
  const documents = state.documents.filter(doc => {
    const sample = legacy.documents.find(item => item.id === doc.id && item.id !== 'welcome')
    const untouched = sample && doc.name === sample.name && doc.content === sample.content
      && doc.folderId === sample.folderId && doc.favorite === sample.favorite
      && doc.deletedAt === null && doc.updatedAt === doc.createdAt
    if (untouched) removed.add(doc.id)
    return !untouched
  })
  const folders = state.folders.filter(folder => {
    const sample = legacy.folders.find(item => item.id === folder.id)
    return !sample || folder.name !== sample.name || folder.parentId !== sample.parentId
      || documents.some(doc => doc.folderId === folder.id)
      || state.folders.some(child => child.parentId === folder.id)
  })
  const activeId = state.activeId && removed.has(state.activeId)
    ? documents.find(doc => doc.id === 'welcome' && !doc.deletedAt)?.id ?? null
    : state.activeId
  const remainingTabs = state.openTabIds.filter(id => !removed.has(id))
  const openTabIds = activeId ? openDocumentTab(remainingTabs, activeId) : remainingTabs
  return { ...state, starterContentVersion: 2, documents, folders, activeId, openTabIds }
}
