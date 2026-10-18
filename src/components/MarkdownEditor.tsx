import { useEffect, useRef, useState } from 'react'
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { callCommand, insert, replaceAll, $prose, $remark } from '@milkdown/kit/utils'
import { Plugin } from '@milkdown/kit/prose/state'
import {
  createCodeBlockCommand,
  insertHrCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark'
import { toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm'
import { undoCommand, redoCommand } from '@milkdown/kit/plugin/history'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import './editor.css'
import { splitFrontMatter } from '../lib/markdown'
import { codeTheme } from './codeTheme'

export interface EditorApi {
  insert: (text: string) => void
  command: (name: string) => void
  focus: () => void
  getMarkdown: () => string
}

export interface MarkdownEditorProps {
  documentId: string
  value: string
  onChange: (markdown: string) => void
  onReady?: (api: EditorApi) => void
  onError?: (message: string) => void
}

function isSafeUrl(url: string, image = false) {
  const cleaned = url.replace(/[\u0000-\u0020\u007f]/g, '')
  if (image && /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z\d+/=]+$/i.test(cleaned)) return true
  const scheme = cleaned.match(/^([a-z][a-z\d+.-]*):/i)?.[1]?.toLowerCase()
  return !scheme || (image ? ['https', 'http'].includes(scheme) : ['https', 'http', 'mailto', 'tel'].includes(scheme))
}

type MarkdownNode = { type: string; url?: string; value?: string; children?: MarkdownNode[] }

// Imported HTML remains text; unsafe URLs are stripped before ProseMirror creates DOM.
const safeMarkdown = $remark('neorynSafeMarkdown', () => () => (tree: MarkdownNode) => {
  const visit = (node: MarkdownNode) => {
    if (node.type === 'html') node.type = 'text'
    if (node.url && !isSafeUrl(node.url, node.type === 'image')) node.url = ''
    node.children?.forEach(visit)
  }
  visit(tree)
})

const safeLinks = $prose(() => new Plugin({
  props: {
    handleDOMEvents: {
      click: (_view, event) => {
        const link = (event.target as HTMLElement).closest?.('a')
        if (link && !isSafeUrl(link.getAttribute('href') ?? '')) {
          event.preventDefault()
          return true
        }
        return false
      },
    },
  },
  appendTransaction: (_transactions, _previousState, state) => {
    const transaction = state.tr
    state.doc.descendants((node, position) => {
      if (typeof node.attrs.src === 'string' && !isSafeUrl(node.attrs.src, true)) {
        transaction.setNodeMarkup(position, undefined, { ...node.attrs, src: '' })
      }
      for (const mark of node.marks) {
        if (typeof mark.attrs.href === 'string' && !isSafeUrl(mark.attrs.href)) {
          transaction.removeMark(position, position + node.nodeSize, mark)
        }
      }
    })
    return transaction.docChanged ? transaction : null
  },
}))

function readImage(file: File): Promise<string> {
  if (!/^image\/(png|jpe?g|gif|webp|avif)$/i.test(file.type)) {
    return Promise.reject(new Error('Escolha uma imagem PNG, JPG, GIF, WebP ou AVIF.'))
  }
  if (file.size > 8 * 1024 * 1024) return Promise.reject(new Error('A imagem deve ter até 8 MB.'))
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Não foi possível abrir esta imagem.'))
    reader.readAsDataURL(file)
  })
}

type ActiveEditor = { crepe: Crepe; documentId: string; lastMarkdown: string; lastValue: string; applyingExternal: boolean }

function CoreMarkdownEditor({ documentId, value, onChange, onReady, onError }: MarkdownEditorProps) {
  const root = useRef<HTMLDivElement>(null)
  const active = useRef<ActiveEditor | null>(null)
  const callbacks = useRef({ documentId, onChange, onReady, onError })
  const latestValue = useRef(value)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  callbacks.current = { documentId, onChange, onReady, onError }
  latestValue.current = value

  useEffect(() => {
    if (!root.current) return
    let disposed = false
    let created = false
    const initialCallback = callbacks.current.onChange
    const host = document.createElement('div')
    root.current.replaceChildren(host)
    setLoading(true)
    setError(null)

    const notify = (markdown: string) => {
      const callback = callbacks.current.documentId === documentId ? callbacks.current.onChange : initialCallback
      callback(markdown)
    }
    const reportError = (cause: unknown) => {
      if (disposed) return
      console.error('Não foi possível iniciar o editor visual.', cause)
      const message = 'Não foi possível iniciar o editor visual.'
      setError(message)
      callbacks.current.onError?.(message)
    }
    const uploadImage = async (file: File) => {
      try { return await readImage(file) }
      catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Não foi possível abrir a imagem.'
        callbacks.current.onError?.(message)
        throw cause
      }
    }
    const crepe = new Crepe({
      root: host,
      defaultValue: latestValue.current,
      featureConfigs: {
        [Crepe.Feature.Placeholder]: { text: 'Comece a escrever ou digite / para explorar…', mode: 'block' },
        [Crepe.Feature.LinkTooltip]: { inputPlaceholder: 'Cole ou digite um link…' },
        [Crepe.Feature.Toolbar]: {
          boldLabel: 'Negrito', italicLabel: 'Itálico', strikethroughLabel: 'Tachado',
          codeLabel: 'Código', linkLabel: 'Link', latexLabel: 'Fórmula',
        },
        [Crepe.Feature.CodeMirror]: {
          theme: codeTheme,
          searchPlaceholder: 'Buscar linguagem…', noResultText: 'Nenhuma linguagem encontrada',
          copyText: 'Copiar', previewLabel: 'Prévia',
          previewToggleText: (previewOnly) => previewOnly ? 'Editar código' : 'Ver prévia',
        },
        [Crepe.Feature.BlockEdit]: {
          textGroup: {
            label: 'Texto', text: { label: 'Parágrafo' },
            h1: { label: 'Título 1' }, h2: { label: 'Título 2' }, h3: { label: 'Título 3' },
            h4: { label: 'Título 4' }, h5: { label: 'Título 5' }, h6: { label: 'Título 6' },
            quote: { label: 'Citação' }, divider: { label: 'Divisória' },
          },
          listGroup: {
            label: 'Listas', bulletList: { label: 'Lista com marcadores' },
            orderedList: { label: 'Lista numerada' }, taskList: { label: 'Lista de tarefas' },
          },
          advancedGroup: {
            label: 'Blocos', image: { label: 'Imagem' }, codeBlock: { label: 'Bloco de código' },
            table: { label: 'Tabela' }, math: { label: 'Fórmula matemática' },
          },
        },
        [Crepe.Feature.ImageBlock]: {
          onUpload: uploadImage,
          inlineOnUpload: uploadImage,
          blockOnUpload: uploadImage,
          inlineUploadButton: 'Escolher imagem',
          blockUploadButton: 'Escolher imagem',
          inlineUploadPlaceholderText: 'ou cole o endereço de uma imagem',
          blockUploadPlaceholderText: 'ou cole o endereço de uma imagem',
          blockCaptionPlaceholderText: 'Adicione uma legenda…',
        },
        [Crepe.Feature.Latex]: { katexOptions: { trust: false, throwOnError: false, maxExpand: 1000 } },
      },
    })
    const instance: ActiveEditor = { crepe, documentId, lastMarkdown: '', lastValue: latestValue.current, applyingExternal: false }
    // Observe committed ProseMirror updates directly. The default Markdown listener
    // waits 200 ms, which can lose the last keystroke on a quick tab/document close.
    const immediateChanges = $prose(() => new Plugin({
      view: () => ({
        update: (view, previous) => {
          if (!created || disposed || instance.applyingExternal || view.state.doc.eq(previous.doc)) return
          const markdown = crepe.getMarkdown()
          if (markdown === instance.lastMarkdown) return
          instance.lastMarkdown = markdown
          instance.lastValue = markdown
          notify(markdown)
        },
      }),
    }))
    crepe.editor.use(safeMarkdown).use(safeLinks).use(immediateChanges)

    const focus = () => {
      if (!created || disposed) return
      crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus())
    }
    const insertMarkdown = (text: string) => {
      if (!created || disposed) return
      crepe.editor.action(insert(text))
      focus()
    }
    const api: EditorApi = {
      focus,
      insert: insertMarkdown,
      getMarkdown: () => created && !disposed ? crepe.getMarkdown() : instance.lastValue,
      command: (name) => {
        if (!created || disposed) return
        switch (name) {
          case 'bold': crepe.editor.action(callCommand(toggleStrongCommand.key)); break
          case 'italic': crepe.editor.action(callCommand(toggleEmphasisCommand.key)); break
          case 'strike': crepe.editor.action(callCommand(toggleStrikethroughCommand.key)); break
          case 'code': crepe.editor.action(callCommand(toggleInlineCodeCommand.key)); break
          case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
            crepe.editor.action(callCommand(wrapInHeadingCommand.key, Number(name.slice(1)))); break
          case 'paragraph': crepe.editor.action(callCommand(turnIntoTextCommand.key)); break
          case 'bullet-list': crepe.editor.action(callCommand(wrapInBulletListCommand.key)); break
          case 'ordered-list': crepe.editor.action(callCommand(wrapInOrderedListCommand.key)); break
          case 'quote': crepe.editor.action(callCommand(wrapInBlockquoteCommand.key)); break
          case 'code-block': crepe.editor.action(callCommand(createCodeBlockCommand.key)); break
          case 'hr': crepe.editor.action(callCommand(insertHrCommand.key)); break
          case 'undo': crepe.editor.action(callCommand(undoCommand.key)); break
          case 'redo': crepe.editor.action(callCommand(redoCommand.key)); break
          case 'task-list': insertMarkdown('- [ ] Nova tarefa'); break
          case 'table': insertMarkdown('| Coluna 1 | Coluna 2 |\n| --- | --- |\n| Conteúdo | Conteúdo |\n| Conteúdo | Conteúdo |'); break
          default: return
        }
        focus()
      },
    }

    const createPromise = crepe.create().then(() => {
      if (disposed) return
      created = true
      active.current = instance
      // Keep source changes that arrived during editor initialization.
      if (instance.lastValue !== latestValue.current) {
        instance.applyingExternal = true
        crepe.editor.action(replaceAll(latestValue.current))
        instance.lastValue = latestValue.current
        instance.applyingExternal = false
      }
      instance.lastMarkdown = crepe.getMarkdown()
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        view.dom.setAttribute('aria-label', 'Conteúdo do documento')
        view.dom.setAttribute('role', 'textbox')
        view.dom.setAttribute('aria-multiline', 'true')
        view.dom.setAttribute('spellcheck', 'true')
      })
      setLoading(false)
      callbacks.current.onReady?.(api)
    }).catch(reportError)

    return () => {
      // Flush any pending composition before leaving this document.
      if (created) {
        const markdown = crepe.getMarkdown()
        if (markdown !== instance.lastMarkdown) notify(markdown)
      }
      disposed = true
      if (active.current === instance) active.current = null
      void createPromise.then(() => crepe.destroy()).catch(() => undefined)
      host.remove()
    }
  }, [documentId])

  useEffect(() => {
    const instance = active.current
    if (!instance || instance.documentId !== documentId || instance.lastValue === value) return
    instance.lastValue = value
    instance.applyingExternal = true
    if (instance.crepe.getMarkdown() !== value) instance.crepe.editor.action(replaceAll(value))
    instance.lastMarkdown = instance.crepe.getMarkdown()
    instance.applyingExternal = false
  }, [documentId, value])

  return <div className="neoryn-editor" aria-busy={loading && !error}>
    {loading && !error && <div className="editor-loading" role="status">Preparando seu espaço de escrita…</div>}
    {error && <div className="editor-error" role="alert">{error}<br />Seu documento continua salvo. Abra o modo código para continuar.</div>}
    <div ref={root} />
  </div>
}

export function MarkdownEditor(props: MarkdownEditorProps) {
  const { prefix, body } = splitFrontMatter(props.value)
  return <>{prefix && <div className="frontmatter-note">Metadados preservados · edite-os no modo Markdown</div>}
    <CoreMarkdownEditor {...props} value={body} onChange={markdown => props.onChange(prefix + markdown)} onReady={api => props.onReady?.({ ...api, getMarkdown: () => prefix + api.getMarkdown() })} />
  </>
}

export default MarkdownEditor
