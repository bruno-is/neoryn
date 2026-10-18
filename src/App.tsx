import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArrowLeft, ArrowRight, Bold, BookOpen, Check, CheckCheck, ChevronDown, ChevronRight, Clock3, Code2, Columns2, Copy, Download, Ellipsis, Eye, FileText, Folder, FolderOpen, FolderPlus, HardDrive, Heading2, HelpCircle, ImagePlus, Italic, Keyboard, Link2, List, ListOrdered, Maximize2, Moon, PanelLeftClose, PanelLeftOpen, Plus, Quote, Search, Settings2, ShieldCheck, Sparkles, Star, Sun, Table2, Trash2, Upload, X } from 'lucide-react'
import { MarkdownEditor, type EditorApi } from './components/MarkdownEditor'
import { MarkdownView } from './components/MarkdownView'
import { loadLibrary, saveLibrary, exportBackup, importBackup, requestPersistentStorage, savePendingDraft, restoreLibrary, loadPreviousLibrary } from './lib/storage'
import { openDocumentTab, parseOutline, validateLibrary, type LibraryState, type DocumentRecord, type FolderRecord } from './lib/library'
import { getWriterAccess } from './lib/session'

type Filter = 'all' | 'recent' | 'favorites' | 'trash' | string
type Modal = { type: 'new-doc' | 'new-folder' | 'rename-doc' | 'rename-folder' | 'move-doc' | 'move-folder' | 'delete-folder' | 'delete-doc' | 'search' | 'settings' | 'help'; id?: string } | null
type DirectoryImportItem = { file: File; relativePath: string }
type DirectoryImportEntry = DirectoryImportFileHandle | DirectoryImportFolderHandle
type DirectoryImportFileHandle = { kind: 'file'; name: string; getFile: () => Promise<File> }
type DirectoryImportFolderHandle = { kind: 'directory'; name: string; values: () => AsyncIterableIterator<DirectoryImportEntry> }
type DirectoryPickerWindow = Window & { showDirectoryPicker?: () => Promise<DirectoryImportFolderHandle> }
const uid = () => crypto.randomUUID()
const withoutExtension = (name: string) => name.replace(/\.(md|markdown|txt)$/i, '')
const fileName = (name: string) => withoutExtension(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '-') || 'Sem título'
const escapeHTML = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
function download(name: string, content: string, type = 'text/markdown;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function Logo({ onClick }: { onClick?: () => void }) {
  const content = <><span className="brand-icon"><span /><Sparkles size={15} strokeWidth={1.5} /></span><span>lume<span className="brand-dot">.</span></span></>
  return onClick ? <button type="button" className="brand brand-home" aria-label="Lume — voltar ao início" onClick={onClick}>{content}</button> : <div className="brand">{content}</div>
}
function IconButton({ label, children, onClick, active = false, disabled = false }: { label: string; children: React.ReactNode; onClick?: () => void; active?: boolean; disabled?: boolean }) {
  return <button type="button" className={`icon-button ${active ? 'active' : ''}`} title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>
}
export default function App() {
  const [library, setLibrary] = useState<LibraryState | null>(null)
  const [loadError, setLoadError] = useState('')
  const [saveStatus, setSaveStatus] = useState<'saving' | 'saved' | 'error'>('saved')
  const [saveError, setSaveError] = useState('')
  const [otherTab, setOtherTab] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [reading, setReading] = useState(false)
  const [outlineVisible, setOutlineVisible] = useState(true)
  const [modal, setModal] = useState<Modal>(null)
  const [modalValue, setModalValue] = useState('')
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState('')
  const [menu, setMenu] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [dragOver, setDragOver] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const editor = useRef<EditorApi | null>(null)
  const source = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const backupInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const latest = useRef<LibraryState | null>(null)
  const pendingSaves = useRef(0)
  const saveVersion = useRef(0)
  const readyToSave = useRef(false)
  const initialTitle = useRef(document.title)
  latest.current = library

  useEffect(() => {
    let disposed = false
    async function boot() {
      const writable = await getWriterAccess()
      if (disposed) return
      setOtherTab(!writable)
      try {
        const data = await loadLibrary()
        if (disposed) return
        if (window.innerWidth < 760) data.settings.sidebarVisible = false
        readyToSave.current = true; setLibrary(data)
      } catch (error) { if (!disposed) setLoadError(error instanceof Error ? error.message : 'Não foi possível abrir a biblioteca.') }
    }
    void boot()
    return () => { disposed = true }
  }, [])

  useEffect(() => {
    if (!library || !readyToSave.current || otherTab) return
    const version = ++saveVersion.current
    pendingSaves.current++; setSaveStatus('saving')
    void saveLibrary(library).then(() => {
      if (version === saveVersion.current) { setSaveStatus('saved'); setSaveError('') }
    }).catch(error => { setSaveStatus('error'); setSaveError(error instanceof Error ? error.message : 'Não foi possível salvar suas alterações.') }).finally(() => pendingSaves.current--)
  }, [library, otherTab])

  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => { if (pendingSaves.current || saveStatus === 'error') { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [saveStatus])
  useEffect(() => { if (!toast) return; const timeout = setTimeout(() => setToast(''), 4200); return () => clearTimeout(timeout) }, [toast])
  useEffect(() => {
    const theme = library?.settings.theme ?? 'light'
    const media = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => document.documentElement.dataset.theme = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
    apply(); media.addEventListener('change', apply); return () => media.removeEventListener('change', apply)
  }, [library?.settings.theme])
  useEffect(() => {
    if (!menu) return
    const close = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest('.popup-menu')) setMenu(null)
    }
    window.addEventListener('pointerdown', close); return () => window.removeEventListener('pointerdown', close)
  }, [menu])
  useEffect(() => {
    if (!modal) return
    const previousFocus = document.activeElement as HTMLElement | null
    const timeout = setTimeout(() => document.querySelector<HTMLElement>('.modal input, .modal button')?.focus(), 50)
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const items = [...document.querySelectorAll<HTMLElement>('.modal button:not(:disabled), .modal input, .modal select, .modal a[href]')]
      if (!items.length) return
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus() }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus() }
    }
    document.addEventListener('keydown', trap)
    return () => { clearTimeout(timeout); document.removeEventListener('keydown', trap); previousFocus?.focus() }
  }, [modal])

  const update = useCallback((change: (state: LibraryState) => LibraryState) => {
    if (otherTab) { setToast('Esta biblioteca está aberta em outra aba. Feche a outra aba e recarregue.'); return }
    setLibrary(state => {
      if (!state) return state
      const next = change(state)
      try { return validateLibrary(next) }
      catch (error) { queueMicrotask(() => setToast(error instanceof Error ? error.message : 'Não foi possível aplicar esta alteração.')); return state }
    })
  }, [otherTab])
  const settings = (changes: Partial<LibraryState['settings']>) => setLibrary(state => state ? { ...state, settings: { ...state.settings, ...changes } } : state)
  const active = library?.documents.find(doc => doc.id === library.activeId)
  const documents = library?.documents ?? []
  const folders = library?.folders ?? []
  const openTabs = library?.openTabIds ?? []
  const visibleDocs = useMemo(() => documents.filter(doc => filter === 'trash' ? !!doc.deletedAt : !doc.deletedAt && (filter === 'favorites' ? doc.favorite : ['all', 'recent'].includes(filter) || doc.folderId === filter)).sort((a, b) => b.updatedAt - a.updatedAt), [documents, filter])
  const searchResults = useMemo(() => documents.filter(doc => !doc.deletedAt && `${doc.name}\n${doc.content}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'))).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 40), [documents, query])
  const headings = useMemo(() => parseOutline(active?.content ?? ''), [active?.content])
  const words = active?.content.trim().split(/\s+/).filter(Boolean).length ?? 0
  const currentFolder = folders.find(folder => folder.id === active?.folderId)
  const canEdit = !!active && !active.deletedAt && !otherTab
  const focus = library?.settings.focusMode ?? false
  const sidebar = library?.settings.sidebarVisible ?? true
  const mode = library?.settings.editorMode ?? 'live'

  useEffect(() => { document.title = active ? `${withoutExtension(active.name)} — Lume` : initialTitle.current }, [active?.name])
  useEffect(() => {
    document.querySelector('.document-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active?.id, reading, focus])
  function openDoc(id: string) {
    setLibrary(state => state ? { ...state, activeId: id, openTabIds: openDocumentTab(state.openTabIds, id) } : state)
    if (id !== active?.id) editor.current = null
    if (window.innerWidth < 760) settings({ sidebarVisible: false })
  }
  function closeDoc(id: string) {
    setLibrary(state => {
      if (!state) return state
      const openTabIds = state.openTabIds.filter(tab => tab !== id)
      return { ...state, openTabIds, activeId: state.activeId === id ? openTabIds.at(-1) ?? null : state.activeId }
    })
    if (id === active?.id) editor.current = null
  }
  function goHome() {
    setFilter('all'); setReading(false); setMenu(null); setModal(null); setFindOpen(false)
    setLibrary(state => state ? { ...state, activeId: null, settings: { ...state.settings, focusMode: false, sidebarVisible: window.innerWidth >= 760 } } : state)
    editor.current = null
  }
  function toggleFolder(id: string) {
    setFilter(id)
    setCollapsed(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  async function copyMarkdown(id: string) {
    const doc = latest.current?.documents.find(item => item.id === id)
    if (!doc) return
    setMenu(null)
    try {
      await navigator.clipboard.writeText(doc.content)
      setToast('Markdown completo copiado.')
    } catch {
      setToast('Não foi possível copiar. Permita o acesso à área de transferência ou use Exportar → Markdown (.md).')
    }
  }
  function changeContent(content: string) {
    if (!active || !canEdit || content === active.content) return
    const id = active.id
    const updatedAt = Date.now()
    try { savePendingDraft({ id, content, updatedAt }) }
    catch { /* IndexedDB remains primary; beforeunload protects pending writes. */ }
    update(state => ({ ...state, documents: state.documents.map(doc => doc.id === id ? { ...doc, content, updatedAt } : doc) }))
  }
  function newDocument(name = 'Sem título', content = '', folderId?: string | null) {
    const id = uid(), now = Date.now()
    update(state => ({ ...state, activeId: id, documents: [...state.documents, { id, name: fileName(name), content, folderId: folderId === undefined ? (folders.some(f => f.id === filter) ? filter : null) : folderId, favorite: false, createdAt: now, updatedAt: now, deletedAt: null }] }))
    setReading(false); editor.current = null
    return id
  }
  function patchDoc(id: string, changes: Partial<DocumentRecord>) {
    update(state => ({ ...state, documents: state.documents.map(doc => doc.id === id ? { ...doc, ...changes, updatedAt: Date.now() } : doc) }))
  }
  function showModal(type: NonNullable<Modal>['type'], id?: string) {
    const doc = documents.find(d => d.id === id), folder = folders.find(f => f.id === id)
    setModalValue(type === 'rename-doc' ? doc?.name ?? '' : type === 'rename-folder' ? folder?.name ?? '' : type === 'move-doc' ? doc?.folderId ?? '' : type === 'move-folder' ? folder?.parentId ?? '' : '')
    if (type === 'search') setQuery('')
    setMenu(null); setModal({ type, id })
  }
  function descendantIds(id: string): Set<string> {
    const ids = new Set([id]); let changed = true
    while (changed) { changed = false; folders.forEach(folder => { if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) { ids.add(folder.id); changed = true } }) }
    return ids
  }
  function submitModal(event: React.FormEvent) {
    event.preventDefault(); if (!modal) return
    const value = modalValue.trim()
    if (['new-doc', 'new-folder', 'rename-doc', 'rename-folder'].includes(modal.type) && !value) return
    if (modal.type === 'new-doc') newDocument(value)
    if (modal.type === 'new-folder') {
      const id = uid(); update(state => ({ ...state, folders: [...state.folders, { id, name: value, parentId: folders.some(f => f.id === filter) ? filter : null, createdAt: Date.now() }] })); setFilter(id)
    }
    if (modal.type === 'rename-doc') patchDoc(modal.id!, { name: fileName(value) })
    if (modal.type === 'rename-folder') update(state => ({ ...state, folders: state.folders.map(folder => folder.id === modal.id ? { ...folder, name: value } : folder) }))
    if (modal.type === 'move-doc') patchDoc(modal.id!, { folderId: value || null })
    if (modal.type === 'move-folder') {
      if (descendantIds(modal.id!).has(value)) return
      update(state => ({ ...state, folders: state.folders.map(folder => folder.id === modal.id ? { ...folder, parentId: value || null } : folder) }))
    }
    if (modal.type === 'delete-folder') {
      const ids = descendantIds(modal.id!)
      update(state => ({ ...state, folders: state.folders.filter(folder => !ids.has(folder.id)), documents: state.documents.map(doc => doc.folderId && ids.has(doc.folderId) ? { ...doc, folderId: null } : doc) })); setFilter('all'); setToast('Pasta removida. Seus documentos foram mantidos.')
    }
    if (modal.type === 'delete-doc') {
      update(state => ({ ...state, documents: state.documents.filter(doc => doc.id !== modal.id), activeId: state.activeId === modal.id ? null : state.activeId })); setToast('Documento excluído permanentemente.')
    }
    setModal(null)
  }
  async function importFiles(files: FileList | File[] | DirectoryImportItem[], directory = false) {
    if (!latest.current || otherTab) return
    const selected: DirectoryImportItem[] = Array.from(files as ArrayLike<File | DirectoryImportItem>, item => item instanceof File
      ? { file: item, relativePath: directory ? item.webkitRelativePath : '' }
      : item as DirectoryImportItem)
    const valid = selected.filter(item => /\.(md|markdown|txt)$/i.test(item.file.name))
    if (!valid.length) { setToast(directory ? 'A pasta escolhida não contém arquivos .md, .markdown ou .txt.' : 'Escolha arquivos .md, .markdown ou .txt.'); return }
    if (valid.some(item => item.file.size > 9 * 1024 * 1024)) { setToast('Cada documento pode ter até 9 MB.'); return }
    try {
      const newFolders: FolderRecord[] = [], newDocs: DocumentRecord[] = [], paths = new Map<string, string>()
      const baseFolder = folders.some(f => f.id === filter) ? filter : null
      for (const item of valid) {
        const { file, relativePath } = item
        let folderId = baseFolder
        if (directory && relativePath) {
          // The selected root name is part of the relative path, so it is recreated too.
          const parts = relativePath.split('/').slice(0, -1)
          for (let i = 0; i < parts.length; i++) {
            const key = parts.slice(0, i + 1).join('/')
            if (!paths.has(key)) {
              const folder = { id: uid(), name: parts[i].replace(/[\u0000-\u001f]/g, '').slice(0, 180) || 'Pasta sem nome', parentId: folderId, createdAt: Date.now() }
              newFolders.push(folder)
              paths.set(key, folder.id)
            }
            folderId = paths.get(key)!
          }
        }
        newDocs.push({ id: uid(), name: withoutExtension(file.name), content: await file.text(), folderId, favorite: false, createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null })
      }
      update(state => ({ ...state, documents: [...state.documents, ...newDocs], folders: [...state.folders, ...newFolders], activeId: newDocs[0].id }))
      setReading(false)
      setToast(directory
        ? `${newDocs.length} documento${newDocs.length === 1 ? '' : 's'} importado${newDocs.length === 1 ? '' : 's'} e organizado${newDocs.length === 1 ? '' : 's'} em ${newFolders.length} pasta${newFolders.length === 1 ? '' : 's'}.`
        : `${newDocs.length} documento${newDocs.length === 1 ? '' : 's'} importado${newDocs.length === 1 ? '' : 's'} para sua biblioteca.`)
    } catch { setToast('Não foi possível importar. Seus documentos existentes foram mantidos.') }
  }
  async function chooseFolder() {
    if (!latest.current || otherTab) return
    const pickerWindow = window as DirectoryPickerWindow
    if (!pickerWindow.showDirectoryPicker) {
      folderInput.current?.click()
      return
    }
    try {
      const root = await pickerWindow.showDirectoryPicker()
      const files: DirectoryImportItem[] = []
      const visit = async (folder: DirectoryImportFolderHandle, parentPath = ''): Promise<void> => {
        for await (const entry of folder.values()) {
          const path = parentPath ? `${parentPath}/${entry.name}` : entry.name
          if (entry.kind === 'directory') await visit(entry, path)
          else if (/\.(md|markdown|txt)$/i.test(entry.name)) {
            files.push({ file: await entry.getFile(), relativePath: `${root.name}/${path}` })
          }
        }
      }
      await visit(root)
      await importFiles(files, true)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setToast('Não foi possível acessar a pasta escolhida. Tente novamente.')
    }
  }
  async function restoreBackup(file?: File) {
    if (!file) return
    if (otherTab) { setToast('Feche a outra aba e recarregue antes de importar um backup.'); return }
    try {
      const imported = importBackup(await file.text())
      // Import as a separate collection; an existing library is never overwritten.
      const folderMap = new Map(imported.folders.map(folder => [folder.id, uid()]))
      const importedFolders = imported.folders.map(folder => ({ ...folder, id: folderMap.get(folder.id)!, parentId: folder.parentId ? folderMap.get(folder.parentId)! : null }))
      const documentMap = new Map(imported.documents.map(doc => [doc.id, uid()]))
      const importedDocs = imported.documents.map(doc => ({ ...doc, id: documentMap.get(doc.id)!, folderId: doc.folderId ? folderMap.get(doc.folderId)! : null }))
      if (!library) {
        const recovered = { ...imported, documents: importedDocs, folders: importedFolders, activeId: imported.activeId ? documentMap.get(imported.activeId)! : null, openTabIds: imported.openTabIds.map(id => documentMap.get(id)!) }
        await restoreLibrary(recovered); readyToSave.current = true; setLibrary(recovered); setLoadError('')
      } else update(state => ({ ...state, folders: [...state.folders, ...importedFolders], documents: [...state.documents, ...importedDocs], activeId: importedDocs[0]?.id ?? state.activeId }))
      setToast(`Backup importado: ${importedDocs.length} documentos adicionados.`)
    } catch (error) { setToast(error instanceof Error ? error.message : 'Backup inválido.') }
  }
  async function recoverPrevious() {
    if (otherTab) { setToast('Feche a outra aba e recarregue antes de recuperar a biblioteca.'); return }
    try {
      const previous = await loadPreviousLibrary()
      if (!previous) { setToast('Não há uma cópia anterior. Importe um backup da biblioteca.'); return }
      await restoreLibrary(previous)
      readyToSave.current = true; setLibrary(previous); setLoadError('')
      setToast('Cópia anterior recuperada. Os dados originais foram preservados.')
    } catch (error) { setToast(error instanceof Error ? error.message : 'Não foi possível recuperar a cópia anterior.') }
  }
  function insert(text: string, wrap?: string) {
    if (!canEdit || !active) return
    if (mode === 'live') { editor.current?.insert(text); editor.current?.focus(); return }
    const element = source.current; if (!element) return
    const start = element.selectionStart, end = element.selectionEnd
    const selected = active.content.slice(start, end)
    const replacement = wrap ? `${text}${selected || 'texto'}${wrap}` : text
    changeContent(active.content.slice(0, start) + replacement + active.content.slice(end))
    requestAnimationFrame(() => { element.focus(); element.setSelectionRange(start + replacement.length, start + replacement.length) })
  }
  function command(name: string, snippet: string, wrap?: string) {
    if (mode === 'live') { editor.current?.command(name); editor.current?.focus() } else insert(snippet, wrap)
  }
  function exportDoc(kind: 'md' | 'html' | 'pdf') {
    if (!active) return
    if (kind === 'md') download(`${fileName(active.name)}.md`, active.content)
    if (kind === 'html') {
      const body = renderToStaticMarkup(<MarkdownView content={active.content} staticExport />)
      download(`${fileName(active.name)}.html`, `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHTML(active.name)}</title><style>body{max-width:800px;margin:60px auto;padding:24px;color:#27352f;font:18px/1.8 Georgia,serif}h1,h2,h3{line-height:1.25}img,svg{max-width:100%}pre{padding:20px;background:#f2f4f1;overflow:auto}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:10px}blockquote{border-left:3px solid #537e69;margin-left:0;padding-left:24px}a{color:#2c6b53}</style><body>${body}</body></html>`, 'text/html;charset=utf-8')
    }
    if (kind === 'pdf') { setReading(true); setTimeout(() => window.print(), 500) }
    setMenu(null)
  }
  function scrollHeading(index: number) {
    if (!reading && mode === 'source' && source.current && headings[index]) {
      const start = active!.content.split('\n').slice(0, headings[index].line - 1).join('\n').length + (headings[index].line > 1 ? 1 : 0)
      source.current.focus(); source.current.setSelectionRange(start, start)
      source.current.scrollTop = (headings[index].line - 1) * 25
      return
    }
    const container = document.querySelector('.document-scroll')
    const elements = container?.querySelectorAll('.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6, .ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6')
    elements?.[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey
      if (event.key === 'Escape') { setModal(null); setMenu(null); setReading(false); setFindOpen(false); if (focus) settings({ focusMode: false }) }
      if (!mod) return
      if (event.key.toLowerCase() === 'k') { event.preventDefault(); showModal('search') }
      if (event.key.toLowerCase() === 's') { event.preventDefault(); if (active) exportDoc('md') }
      if (event.key.toLowerCase() === 'n' && event.altKey) { event.preventDefault(); showModal('new-doc') }
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); setFindOpen(true); setReading(false); settings({ editorMode: 'source' }) }
      if (event.key === '/') { event.preventDefault(); settings({ editorMode: mode === 'live' ? 'source' : 'live' }) }
      if (event.key.toLowerCase() === 'l' && event.shiftKey) { event.preventDefault(); setReading(value => !value) }
    }
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown)
  })

  const menus = (id: string, kind: 'doc' | 'folder') => <div className="popup-menu" onClick={event => event.stopPropagation()}>
    {kind === 'doc' && <button onClick={() => void copyMarkdown(id)}><Copy size={15} />Copiar Markdown</button>}
    <button onClick={() => showModal(kind === 'doc' ? 'rename-doc' : 'rename-folder', id)}><FileText size={15} />Renomear</button>
    <button onClick={() => showModal(kind === 'doc' ? 'move-doc' : 'move-folder', id)}><FolderOpen size={15} />Mover para pasta</button>
    {kind === 'doc' && <button onClick={() => { const doc = documents.find(d => d.id === id)!; newDocument(`${doc.name} — cópia`, doc.content, doc.folderId); setMenu(null) }}><Copy size={15} />Duplicar</button>}
    <div className="menu-separator" />
    <button className="danger" onClick={() => { if (kind === 'folder') showModal('delete-folder', id); else { patchDoc(id, { deletedAt: Date.now() }); setMenu(null); setToast('Documento movido para a lixeira.') } }}><Trash2 size={15} />{kind === 'folder' ? 'Remover pasta' : 'Mover para a lixeira'}</button>
  </div>

  function renderFolder(folder: FolderRecord, depth = 0): React.ReactNode {
    const children = folders.filter(f => f.parentId === folder.id)
    const folderDocs = documents.filter(doc => doc.folderId === folder.id && !doc.deletedAt)
    const closed = collapsed.has(folder.id)
    return <div key={folder.id} className="folder-branch">
      <div className={`folder-row ${filter === folder.id ? 'selected' : ''}`} style={{ paddingLeft: 7 + depth * 13 }} onDragOver={event => { event.preventDefault(); event.stopPropagation(); event.currentTarget.classList.add('drop-target') }} onDragLeave={event => event.currentTarget.classList.remove('drop-target')} onDrop={event => { event.preventDefault(); event.stopPropagation(); event.currentTarget.classList.remove('drop-target'); const id = event.dataTransfer.getData('application/lume-document'); if (id) { patchDoc(id, { folderId: folder.id }); setToast('Documento movido.') } }}>
        <button className="folder-label" aria-label={`${closed ? 'Expandir' : 'Recolher'} ${folder.name}`} aria-expanded={!closed} onClick={() => toggleFolder(folder.id)}><span className="folder-chevron" aria-hidden="true">{closed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}</span><Folder size={16} /><span>{folder.name}</span><small>{folderDocs.length}</small></button>
        <div className="relative"><button className="row-more" aria-label={`Opções da pasta ${folder.name}`} onClick={event => { event.stopPropagation(); setMenu(menu === folder.id ? null : folder.id) }}><Ellipsis size={15} /></button>{menu === folder.id && menus(folder.id, 'folder')}</div>
      </div>
      {!closed && <div className="folder-children">{children.map(child => renderFolder(child, depth + 1))}{folderDocs.map(doc => <button key={doc.id} className={`tree-document ${active?.id === doc.id ? 'active' : ''}`} style={{ paddingLeft: 38 + depth * 13 }} onClick={() => openDoc(doc.id)} draggable onDragStart={event => event.dataTransfer.setData('application/lume-document', doc.id)}><FileText size={14} /><span>{withoutExtension(doc.name)}</span>{doc.favorite && <Star size={11} className="favorite-star" />}</button>)}</div>}
    </div>
  }

  if (!library) return <div className="boot-screen"><Logo /><h1>{loadError ? 'Sua biblioteca precisa de atenção' : 'Abrindo seu espaço…'}</h1>{loadError && <><p>{loadError}</p><p>Os dados existentes foram preservados. Você pode tentar novamente, recuperar a cópia anterior ou importar um backup.</p><button className="primary-button" onClick={() => location.reload()}>Tentar novamente</button><button className="secondary-button" onClick={() => void recoverPrevious()}>Recuperar cópia anterior</button><label className="secondary-button">Importar backup<input type="file" accept=".json" hidden onChange={event => void restoreBackup(event.target.files?.[0])} /></label></>}{toast && <p role="alert">{toast}</p>}</div>

  return <div className={`app-shell ${reading ? 'reading-mode' : ''} ${focus ? 'focus-mode' : ''} ${!sidebar ? 'sidebar-hidden' : ''}`} style={{ '--document-font-size': `${library.settings.fontSize}px` } as React.CSSProperties} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragOver(true) } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver(false) }} onDrop={event => { event.preventDefault(); setDragOver(false); if (event.dataTransfer.files.length) void importFiles(event.dataTransfer.files) }}>
    <input ref={fileInput} type="file" accept=".md,.markdown,.txt" multiple hidden onChange={event => { if (event.target.files) void importFiles(event.target.files); event.target.value = '' }} />
    <input ref={backupInput} type="file" accept=".json" hidden onChange={event => { void restoreBackup(event.target.files?.[0]); event.target.value = '' }} />
    <input ref={folderInput} type="file" aria-label="Selecionar pasta para importar" multiple hidden {...{ webkitdirectory: '', directory: '' }} onChange={event => { if (event.target.files) void importFiles(event.target.files, true); event.target.value = '' }} />
    <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={event => { const file = event.target.files?.[0]; if (file) { if (file.size > 8 * 1024 * 1024) setToast('A imagem pode ter até 8 MB.'); else { const reader = new FileReader(); reader.onload = () => insert(`![${file.name.replace(/[\[\]]/g, '')}](${reader.result})`); reader.readAsDataURL(file) } } event.target.value = '' }} />
    {sidebar && !focus && <aside className="sidebar">
      <div className="brand-row"><Logo onClick={goHome} /><IconButton label="Recolher biblioteca" onClick={() => settings({ sidebarVisible: false })}><PanelLeftClose size={17} /></IconButton></div>
      <div className="workspace-label"><span className="workspace-avatar">M</span><div><strong>Meu espaço</strong><span>Biblioteca pessoal</span></div><span className="local-badge">LOCAL</span></div>
      <button className="search-trigger" onClick={() => showModal('search')}><Search size={16} /><span>Buscar documentos</span><kbd>Ctrl K</kbd></button>
      <button className="new-document primary-button" onClick={() => showModal('new-doc')}><Plus size={17} />Novo documento<span>↗</span></button>
      <nav className="library-navigation" aria-label="Biblioteca">
        {([{ id: 'all', label: 'Todos os documentos', icon: FileText, count: documents.filter(d => !d.deletedAt).length }, { id: 'recent', label: 'Recentes', icon: Clock3 }, { id: 'favorites', label: 'Favoritos', icon: Star, count: documents.filter(d => d.favorite && !d.deletedAt).length }] as const).map(item => <button key={item.id} className={filter === item.id ? 'active' : ''} onClick={() => setFilter(item.id)}><item.icon size={17} /><span>{item.label}</span>{'count' in item && <small>{item.count}</small>}</button>)}
      </nav>
      <div className="sidebar-scroll">
        <div className="section-label"><span>PASTAS</span><IconButton label="Nova pasta" onClick={() => showModal('new-folder')}><FolderPlus size={15} /></IconButton></div>
        <div className="folder-tree">{folders.filter(f => !f.parentId).map(folder => renderFolder(folder))}{!folders.length && <span className="sidebar-empty">Organize suas ideias em pastas.</span>}</div>
        <div className="section-label documents-label"><span>{filter === 'favorites' ? 'FAVORITOS' : filter === 'trash' ? 'NA LIXEIRA' : filter === 'recent' ? 'EDITADOS RECENTEMENTE' : folders.find(f => f.id === filter)?.name.toLocaleUpperCase('pt-BR') ?? 'DOCUMENTOS'}</span><span>{visibleDocs.length.toString().padStart(2, '0')}</span></div>
        <div className="document-list">{visibleDocs.map(doc => <div key={doc.id} className={`document-item ${active?.id === doc.id ? 'active' : ''}`} draggable={!doc.deletedAt} onDragStart={event => event.dataTransfer.setData('application/lume-document', doc.id)}>
          <button className="document-select" onClick={() => openDoc(doc.id)}><FileText size={17} /><div><strong>{withoutExtension(doc.name)}</strong><span>{doc.deletedAt ? 'Na lixeira' : new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(doc.updatedAt)}<i />{doc.content.trim().split(/\s+/).filter(Boolean).length} palavras</span></div></button>
          {!doc.deletedAt && <div className="relative"><button className="row-more" aria-label={`Opções de ${doc.name}`} onClick={event => { event.stopPropagation(); setMenu(menu === doc.id ? null : doc.id) }}><Ellipsis size={15} /></button>{menu === doc.id && menus(doc.id, 'doc')}</div>}
        </div>)}{!visibleDocs.length && <div className="sidebar-empty"><FileText size={24} /><p>{filter === 'trash' ? 'Lixeira vazia. Tudo em seu lugar.' : filter === 'favorites' ? 'Use a estrela para guardar seus favoritos aqui.' : 'Uma página em branco é um bom começo.'}</p></div>}</div>
      </div>
      <div className="sidebar-bottom"><div className="import-actions"><button className="import-button" onClick={() => fileInput.current?.click()}><Upload size={15} /><span>Arquivos .md</span></button><button className="import-button" onClick={() => void chooseFolder()}><FolderPlus size={15} /><span>Pasta inteira</span></button></div><div className="sidebar-bottom-row"><button className={filter === 'trash' ? 'active' : ''} onClick={() => setFilter('trash')}><Trash2 size={15} />Lixeira</button><IconButton label="Preferências" onClick={() => showModal('settings')}><Settings2 size={16} /></IconButton><IconButton label="Ajuda e atalhos" onClick={() => showModal('help')}><HelpCircle size={16} /></IconButton></div><div className="privacy-note"><span className="status-dot" />Seu espaço. Só seu.</div></div>
    </aside>}
    {sidebar && <button className="mobile-backdrop" aria-label="Fechar biblioteca" onClick={() => settings({ sidebarVisible: false })} />}
    <main className="main-workspace">
      <header className="topbar"><div className="breadcrumbs">{(!sidebar || focus) && <IconButton label="Abrir biblioteca" onClick={() => { settings({ sidebarVisible: true, focusMode: false }) }}><PanelLeftOpen size={18} /></IconButton>}<span className="desktop-text">Meu espaço</span><ChevronRight size={13} /><span>{currentFolder?.name ?? 'Documentos'}</span><ChevronRight size={13} /><strong>{active ? withoutExtension(active.name) : 'Sua biblioteca'}</strong></div><div className="topbar-actions"><span className={`save-indicator ${saveStatus === 'error' ? 'error' : ''}`}>{saveStatus === 'saving' ? <Clock3 size={14} /> : saveStatus === 'error' ? <HelpCircle size={14} /> : <CheckCheck size={15} />}<span>{saveStatus === 'saving' ? 'Salvando…' : saveStatus === 'error' ? 'Falha ao salvar' : 'Tudo salvo'}</span></span><span className="vertical-divider" /><IconButton label={document.documentElement.dataset.theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'} onClick={() => settings({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' })}>{document.documentElement.dataset.theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</IconButton><button className={`reading-button ${reading ? 'active' : ''}`} disabled={!active} onClick={() => setReading(value => !value)}>{reading ? <ArrowLeft size={16} /> : <Eye size={16} />}<span>{reading ? 'Voltar à edição' : 'Modo leitura'}</span></button></div></header>
      {otherTab && <div className="warning-banner">Esta biblioteca está aberta em outra aba. Para editar aqui, feche a outra aba e <button onClick={() => location.reload()}>recarregue</button>.</div>}
      {saveStatus === 'error' && <div className="warning-banner" role="alert">{saveError} <button onClick={() => download('lume-backup.json', exportBackup(library), 'application/json')}>Baixar backup agora</button></div>}
      {!reading && !focus && <div className="document-tabs"><div className="tabs-scroll">{openTabs.map(id => documents.find(d => d.id === id)).filter((doc): doc is DocumentRecord => !!doc).map(doc => <div key={doc.id} className={`document-tab ${doc.id === active?.id ? 'active' : ''}`}><button onClick={() => openDoc(doc.id)}><FileText size={14} /><span>{withoutExtension(doc.name)}<small>.md</small></span></button><button className="tab-close" aria-label={`Fechar aba ${doc.name}`} onClick={() => closeDoc(doc.id)}><X size={12} /></button></div>)}</div><IconButton label="Criar documento" onClick={() => showModal('new-doc')}><Plus size={17} /></IconButton><div className="tabs-spacer" /><span className="workspace-caption">UM POUCO DE CLAREZA, TODOS OS DIAS.</span></div>}
      {active ? <>
        {!reading && <div className="editor-toolbar"><div className="mode-switch" aria-label="Modo do editor">{([{ id: 'live', icon: FileText, label: 'Escrever' }, { id: 'source', icon: Code2, label: 'Markdown' }, { id: 'split', icon: Columns2, label: 'Dividido' }] as const).map(item => <button key={item.id} className={mode === item.id ? 'active' : ''} onClick={() => settings({ editorMode: item.id })} title={item.label}><item.icon size={14} /><span>{item.label}</span></button>)}</div><span className="vertical-divider" /><div className="formatting-tools"><IconButton label="Título" disabled={!canEdit} onClick={() => command('h2', '\n## ')}><Heading2 size={17} /></IconButton><IconButton label="Negrito" disabled={!canEdit} onClick={() => command('bold', '**', '**')}><Bold size={16} /></IconButton><IconButton label="Itálico" disabled={!canEdit} onClick={() => command('italic', '*', '*')}><Italic size={16} /></IconButton><span className="vertical-divider" /><IconButton label="Inserir link" disabled={!canEdit} onClick={() => insert('[texto do link](https://exemplo.com)')}><Link2 size={16} /></IconButton><IconButton label="Inserir imagem" disabled={!canEdit} onClick={() => imageInput.current?.click()}><ImagePlus size={17} /></IconButton><IconButton label="Citação" disabled={!canEdit} onClick={() => command('quote', '\n> ')}><Quote size={16} /></IconButton><IconButton label="Lista" disabled={!canEdit} onClick={() => command('bullet-list', '\n- ')}><List size={17} /></IconButton><IconButton label="Tabela" disabled={!canEdit} onClick={() => command('table', '\n| Coluna 1 | Coluna 2 |\n| --- | --- |\n| Texto | Texto |\n')}><Table2 size={16} /></IconButton><IconButton label="Bloco de código" disabled={!canEdit} onClick={() => command('code-block', '\n```javascript\n\n```\n')}><Code2 size={17} /></IconButton></div><div className="toolbar-right"><IconButton label={focus ? 'Sair do modo foco' : 'Modo foco'} active={focus} onClick={() => settings({ focusMode: !focus })}><Maximize2 size={16} /></IconButton><IconButton label="Mostrar ou ocultar sumário" active={outlineVisible} onClick={() => setOutlineVisible(value => !value)}><ListOrdered size={18} /></IconButton></div></div>}
        {active.deletedAt && <div className="warning-banner">Este documento está na lixeira.<button onClick={() => patchDoc(active.id, { deletedAt: null })}>Restaurar documento</button><button onClick={() => showModal('delete-doc', active.id)}>Excluir permanentemente</button></div>}
        {findOpen && <form className="find-bar" onSubmit={event => { event.preventDefault(); if (!findText || !active) return; const start = active.content.indexOf(findText, (source.current?.selectionEnd ?? 0)); const index = start >= 0 ? start : active.content.indexOf(findText); if (index >= 0) { source.current?.focus(); source.current?.setSelectionRange(index, index + findText.length) } else setToast('Nenhum resultado neste documento.') }}><Search size={16} /><input aria-label="Localizar no documento" placeholder="Localizar texto…" value={findText} onChange={event => setFindText(event.target.value)} autoFocus /><input aria-label="Substituir por" placeholder="Substituir por…" value={replaceText} onChange={event => setReplaceText(event.target.value)} /><button type="submit">Próximo</button><button type="button" disabled={!findText || !canEdit} onClick={() => { const count = active.content.split(findText).length - 1; changeContent(active.content.split(findText).join(replaceText)); setToast(`${count} ocorrência(s) substituída(s).`) }}>Substituir todas</button><IconButton label="Fechar busca no documento" onClick={() => setFindOpen(false)}><X size={16} /></IconButton></form>}
        <div className={`editor-layout ${!outlineVisible || focus ? 'no-outline' : ''}`}>
          <div className="document-scroll" key={active.id}>
            <div className="document-meta"><span className="document-eyebrow"><span className="tiny-spark">✦</span>{reading ? 'TEMPO PARA LER' : 'ESPAÇO PARA SUAS IDEIAS'}</span><div><IconButton label={active.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'} active={active.favorite} onClick={() => patchDoc(active.id, { favorite: !active.favorite })}><Star size={17} fill={active.favorite ? 'currentColor' : 'none'} /></IconButton><div className="relative"><IconButton label="Mais opções do documento" onClick={() => setMenu(menu === 'active' ? null : 'active')}><Ellipsis size={19} /></IconButton>{menu === 'active' && <div className="popup-menu align-right" onClick={event => event.stopPropagation()}><button onClick={() => void copyMarkdown(active.id)}><Copy size={15} />Copiar Markdown</button><button onClick={() => showModal('rename-doc', active.id)}><FileText size={15} />Renomear documento</button><button onClick={() => showModal('move-doc', active.id)}><Folder size={15} />Mover para pasta</button><button onClick={() => { newDocument(`${active.name} — cópia`, active.content, active.folderId); setMenu(null) }}><Copy size={15} />Duplicar documento</button><button className="danger" onClick={() => { patchDoc(active.id, { deletedAt: Date.now() }); setMenu(null) }}><Trash2 size={15} />Mover para a lixeira</button></div>}</div></div></div>
            <div className="document-file-label"><button onClick={() => showModal('rename-doc', active.id)} title="Renomear documento">{withoutExtension(active.name)}<span>.md</span></button><span>·</span><span>{Math.max(1, Math.ceil(words / 220))} min de leitura</span></div>
            {reading || active.deletedAt || otherTab ? <article className="reader"><MarkdownView content={active.content || '# Uma página em branco\n\nEste documento ainda não tem conteúdo.'} /></article> : <div className={`writing-area ${mode === 'split' ? 'split-editor' : ''}`}>{mode === 'live' ? <MarkdownEditor documentId={active.id} value={active.content} onChange={changeContent} onReady={api => { editor.current = api }} /> : <textarea ref={source} className="source-editor" aria-label="Conteúdo Markdown" spellCheck={false} value={active.content} placeholder="# Sua próxima ideia começa aqui…" onChange={event => changeContent(event.target.value)} onKeyDown={event => { if (event.key === 'Tab') { event.preventDefault(); insert('  ') } }} />}{mode === 'split' && <div className="split-preview"><MarkdownView content={active.content} /></div>}</div>}
            <div className="document-end"><span /><Sparkles size={16} /><span /></div>
          </div>
          {outlineVisible && !focus && <aside className="outline-panel"><div className="outline-label">NESTE DOCUMENTO<IconButton label="Ocultar sumário" onClick={() => setOutlineVisible(false)}><X size={13} /></IconButton></div><nav aria-label="Sumário">{headings.length ? headings.map((heading, index) => <button key={heading.id} className={`${index === 0 ? 'outline-first' : ''} level-${heading.level}`} style={{ paddingLeft: Math.min(heading.level - 1, 3) * 10 + 13 }} onClick={() => scrollHeading(index)}>{heading.text}</button>) : <p className="outline-empty">Seus títulos aparecem aqui. Use # para criar o primeiro.</p>}</nav><div className="outline-divider" /><div className="quiet-note"><BookOpen size={22} strokeWidth={1.3} /><h3>Menos distração.<br />Mais espaço para pensar.</h3><p>{reading ? 'Ajuste o tamanho do texto e encontre seu ritmo.' : 'Dê uma pausa na edição e veja suas ideias com outros olhos.'}</p>{reading ? <div className="font-adjust"><button aria-label="Diminuir fonte" onClick={() => settings({ fontSize: Math.max(14, library.settings.fontSize - 1) })}>A−</button><span>{library.settings.fontSize}</span><button aria-label="Aumentar fonte" onClick={() => settings({ fontSize: Math.min(24, library.settings.fontSize + 1) })}>A+</button></div> : <button onClick={() => setReading(true)}>Entrar no modo leitura<ArrowRight size={14} /></button>}</div><div className="local-note"><ShieldCheck size={15} /><span>Salvo neste navegador.<br />Disponível quando você voltar.</span></div></aside>}
        </div>
        <footer className="statusbar"><div><span className="status-dot" /><span>{reading ? 'Modo leitura' : mode === 'source' ? 'Markdown' : 'Edição ao vivo'}</span><span className="footer-separator" /><span>{words.toLocaleString('pt-BR')} palavras</span><span className="desktop-text">{active.content.length.toLocaleString('pt-BR')} caracteres</span></div><div><button onClick={() => showModal('help')} className="keyboard-button" aria-label="Atalhos de teclado"><Keyboard size={14} /><span>Atalhos</span></button><span className="footer-separator" /><span className="desktop-text">Markdown</span><span className="desktop-text">UTF-8</span><div className="relative"><button className="export-button" onClick={event => { event.stopPropagation(); setMenu(menu === 'export' ? null : 'export') }}><Download size={14} />Exportar<ChevronDown size={12} /></button>{menu === 'export' && <div className="popup-menu popup-up align-right" onClick={event => event.stopPropagation()}><button onClick={() => exportDoc('md')}><FileText size={15} />Markdown (.md)</button><button onClick={() => exportDoc('html')}><Code2 size={15} />Página HTML</button><button onClick={() => exportDoc('pdf')}><BookOpen size={15} />Imprimir / Salvar PDF</button></div>}</div></div></footer>
      </> : <div className="empty-workspace"><div className="empty-illustration"><FileText size={42} strokeWidth={1} /><Sparkles size={21} /></div><span className="document-eyebrow">O PRÓXIMO CAPÍTULO É SEU</span><h1>Uma ideia merece<br />um lugar para crescer.</h1><p>Abra um documento da biblioteca, importe arquivos ou comece com uma página em branco.</p><div className="empty-import-actions"><button className="primary-button" onClick={() => showModal('new-doc')}><Plus size={16} />Novo documento</button><button className="secondary-button" onClick={() => fileInput.current?.click()}><Upload size={16} />Importar arquivo</button><button className="secondary-button" onClick={() => void chooseFolder()}><FolderPlus size={16} />Importar pasta</button></div></div>}
    </main>
    {modal && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setModal(null) }}><section className={`modal ${modal.type === 'search' ? 'search-modal' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-header"><h2 id="modal-title">{{ 'new-doc': 'Uma nova página', 'new-folder': 'Organize suas ideias', 'rename-doc': 'Renomear documento', 'rename-folder': 'Renomear pasta', 'move-doc': 'Mover documento', 'move-folder': 'Mover pasta', 'delete-folder': 'Remover pasta', 'delete-doc': 'Excluir permanentemente?', search: 'Encontre uma ideia', settings: 'Do seu jeito', help: 'Um pouco de ajuda' }[modal.type]}</h2><IconButton label="Fechar diálogo" onClick={() => setModal(null)}><X size={19} /></IconButton></div>
      {modal.type === 'search' ? <><div className="search-input-wrap"><Search size={19} /><input aria-label="Buscar na biblioteca" placeholder="Busque por título ou conteúdo…" value={query} onChange={event => setQuery(event.target.value)} autoFocus /></div><div className="search-results">{searchResults.map(doc => <button key={doc.id} onClick={() => { openDoc(doc.id); setModal(null) }}><FileText size={20} /><div><strong>{doc.name}</strong><span>{doc.content.replace(/[#*`>]/g, '').replace(/\n/g, ' ').slice(0, 110)}</span></div><ArrowRight size={16} /></button>)}{!searchResults.length && <div className="search-empty">Nenhum documento encontrado. Tente outra palavra.</div>}</div><div className="modal-footnote"><span>{searchResults.length} resultado(s)</span><span><kbd>Esc</kbd> para fechar</span></div></> : modal.type === 'settings' ? <div className="settings-content"><p>Pequenos ajustes para o seu espaço de escrita.</p><div className="setting-row"><div><strong>Aparência</strong><span>Encontre a luz certa para suas ideias.</span></div><select aria-label="Aparência" value={library.settings.theme} onChange={event => settings({ theme: event.target.value as LibraryState['settings']['theme'] })}><option value="light">Claro</option><option value="dark">Escuro</option><option value="system">Sistema</option></select></div><div className="setting-row"><div><strong>Tamanho do texto</strong><span>Na edição e no modo leitura.</span></div><div className="font-adjust"><button aria-label="Diminuir fonte" onClick={() => settings({ fontSize: Math.max(14, library.settings.fontSize - 1) })}>A−</button><span>{library.settings.fontSize}</span><button aria-label="Aumentar fonte" onClick={() => settings({ fontSize: Math.min(24, library.settings.fontSize + 1) })}>A+</button></div></div><div className="settings-section"><HardDrive size={19} /><h3>Seu conteúdo, com você</h3><p>Os documentos são salvos automaticamente neste navegador. Limpar os dados do site remove a biblioteca; mantenha um backup para levar tudo a outro dispositivo.</p><div className="settings-actions"><button className="secondary-button" onClick={() => download('lume-backup.json', exportBackup(library), 'application/json')}><Download size={15} />Baixar backup</button><button className="secondary-button" onClick={() => backupInput.current?.click()}><Upload size={15} />Importar backup</button></div><button className="text-button" onClick={() => void requestPersistentStorage().then(granted => setToast(granted ? 'Armazenamento persistente ativado.' : 'O navegador administra a retenção. Mantenha um backup.'))}>Solicitar armazenamento persistente<ArrowRight size={14} /></button><button className="text-button" onClick={() => void chooseFolder()}>Importar uma pasta de documentos<FolderPlus size={14} /></button></div></div> : modal.type === 'help' ? <div className="help-content"><p>Um lugar tranquilo para escrever em Markdown. Digite <code>/</code> em uma linha vazia no editor para inserir blocos.</p><div className="shortcut-list">{[['Buscar documentos', 'Ctrl K'], ['Localizar e substituir', 'Ctrl F'], ['Exportar Markdown', 'Ctrl S'], ['Alternar código e edição', 'Ctrl /'], ['Modo leitura', 'Ctrl Shift L'], ['Novo documento', 'Ctrl Alt N'], ['Negrito / Itálico', 'Ctrl B / I'], ['Sair do modo leitura ou foco', 'Esc']].map(([label, shortcut]) => <div key={label}><span>{label}</span><kbd>{shortcut}</kbd></div>)}</div><div className="help-tip"><Sparkles size={18} /><p>Use “Importar pasta” para trazer arquivos Markdown de uma pasta e de todas as suas subpastas, preservando a estrutura.</p></div><p className="fine-print">No macOS, use ⌘ no lugar de Ctrl. O Lume funciona offline após o primeiro carregamento completo.</p></div> : <form onSubmit={submitModal}>{modal.type.startsWith('delete') ? <p>{modal.type === 'delete-folder' ? 'A pasta e suas subpastas serão removidas. Os documentos serão preservados na raiz da biblioteca.' : 'Este documento será apagado da biblioteca. Esta ação não pode ser desfeita; exporte uma cópia se quiser mantê-lo.'}</p> : modal.type.startsWith('move') ? <><label htmlFor="modal-value">Pasta de destino</label><select id="modal-value" value={modalValue} onChange={event => setModalValue(event.target.value)}><option value="">Documentos (raiz)</option>{folders.filter(folder => modal.type !== 'move-folder' || !descendantIds(modal.id!).has(folder.id)).map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></> : <><p>{modal.type === 'new-doc' ? 'Dê um nome à sua próxima ideia. Você pode mudar depois.' : modal.type === 'new-folder' ? 'Um novo lugar para reunir o que faz sentido junto.' : 'Escolha um nome fácil de encontrar.'}</p><label htmlFor="modal-value">{modal.type.includes('folder') ? 'Nome da pasta' : 'Nome do documento'}</label><input id="modal-value" value={modalValue} onChange={event => setModalValue(event.target.value)} placeholder={modal.type.includes('folder') ? 'Ex.: Meu próximo projeto' : 'Ex.: Uma boa ideia'} maxLength={160} autoFocus required /></>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancelar</button><button className={`primary-button ${modal.type.startsWith('delete') ? 'danger-button' : ''}`} type="submit">{modal.type.startsWith('delete') ? 'Confirmar remoção' : modal.type.startsWith('new') ? 'Criar' : modal.type.startsWith('move') ? 'Mover' : 'Salvar nome'}<ArrowRight size={15} /></button></div></form>}
    </section></div>}
    {toast && <div className="toast" role="status"><Check size={17} /><span>{toast}</span><button aria-label="Fechar aviso" onClick={() => setToast('')}><X size={15} /></button></div>}
    {dragOver && <div className="drop-overlay"><div><Upload size={38} /><h2>Suas ideias são bem-vindas.</h2><p>Solte seus arquivos Markdown para importar.</p></div></div>}
  </div>
}
