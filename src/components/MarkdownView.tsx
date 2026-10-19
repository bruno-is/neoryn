import { useEffect, useId, useRef, useState } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import DOMPurify from 'dompurify'
import type { Element, Root, RootContent } from 'hast'
import 'katex/dist/katex.min.css'
import './editor.css'
import { splitFrontMatter } from '../lib/markdown'

export type OutlineItem = { id: string; text: string; level: number }

export interface MarkdownViewProps {
  content: string
  onOutline?: (items: OutlineItem[]) => void
  staticExport?: boolean
}

function nodeText(node: RootContent | Root): string {
  if ('value' in node) return node.value
  return 'children' in node ? node.children.map(nodeText).join('') : ''
}

function rehypeHeadingIds() {
  return (tree: Root) => {
    const counts = new Map<string, number>()
    const visit = (node: RootContent | Root) => {
      if (node.type === 'element' && /^h[1-6]$/.test(node.tagName)) {
        const slug = nodeText(node).toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-') || 'secao'
        const count = counts.get(slug) ?? 0
        counts.set(slug, count + 1)
        node.properties.id = count ? `${slug}-${count}` : slug
      }
      if ('children' in node) node.children.forEach(visit)
    }
    visit(tree)
  }
}

/** Only raster data images are allowed. Raw HTML is never interpreted. */
export function safeMarkdownUrl(url: string, key?: string): string {
  if (key === 'src' && /^data:image\/(png|jpe?g|gif|webp|avif);base64,[a-z\d+/=\s]+$/i.test(url)) {
    return url
  }
  return defaultUrlTransform(url)
}

let mermaidLoader: Promise<typeof import('mermaid')> | undefined

function MermaidBlock({ source }: { source: string }) {
  const id = `neoryn-diagram-${useId().replace(/[^a-z\d]/gi, '')}`
  const [svg, setSvg] = useState('')
  const [error, setError] = useState(false)
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme)

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.dataset.theme))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let active = true
    setError(false)
    setSvg('')
    const styles = getComputedStyle(document.documentElement)
    const color = (token: string) => styles.getPropertyValue(token).trim()
    mermaidLoader ??= import('mermaid')
    mermaidLoader.then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: 'base',
        htmlLabels: false,
        fontFamily: 'Inter, system-ui, sans-serif',
        flowchart: { htmlLabels: false, curve: 'basis' },
        themeVariables: {
          darkMode: theme === 'dark',
          useGradient: false,
          dropShadow: 'none',
          nodeShadow: false,
          background: color('--code-bg'),
          primaryColor: color('--diagram-node'),
          primaryTextColor: color('--text'),
          primaryBorderColor: color('--control-border'),
          lineColor: color('--muted'),
          secondaryColor: color('--diagram-secondary'),
          secondaryTextColor: color('--text'),
          secondaryBorderColor: color('--control-border'),
          tertiaryColor: color('--diagram-tertiary'),
          tertiaryTextColor: color('--text'),
          tertiaryBorderColor: color('--control-border'),
          textColor: color('--text'),
          edgeLabelBackground: color('--code-bg'),
        },
      })
      return mermaid.render(id, source)
    })
      .then(({ svg: result }) => {
        if (active) setSvg(DOMPurify.sanitize(result, { USE_PROFILES: { svg: true, svgFilters: true } }))
      })
      .catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [id, source, theme])

  if (error) return <div className="diagram-fallback"><p>Revise a sintaxe do diagrama Mermaid.</p><pre><code>{source}</code></pre></div>
  // Keep the source in static HTML exports, where effects never run.
  if (!svg) return <figure className="diagram-loading"><figcaption>Diagrama Mermaid</figcaption><pre><code>{source}</code></pre></figure>
  return <div className="mermaid-diagram" aria-label="Diagrama Mermaid" dangerouslySetInnerHTML={{ __html: svg }} />
}

function CodeBlock({ node, children, staticExport = false }: { node?: Element; children?: React.ReactNode; staticExport?: boolean }) {
  const [copied, setCopied] = useState(false)
  const code = node?.children.find((child) => child.type === 'element' && child.tagName === 'code') as Element | undefined
  const classes = code?.properties.className
  const language = (Array.isArray(classes) ? classes : []).find((value) => String(value).startsWith('language-'))?.toString().replace('language-', '') ?? ''
  const source = code ? nodeText(code).replace(/\n$/, '') : ''
  if (language === 'mermaid') return staticExport ? <figure><figcaption>Diagrama Mermaid</figcaption><pre><code>{source}</code></pre></figure> : <MermaidBlock source={source} />

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch { setCopied(false) }
  }

  return <div className="reading-code-block">
    <div className="reading-code-topbar"><span>{language || 'texto'}</span>{!staticExport && <button type="button" onClick={() => void copy()} aria-label="Copiar código">{copied ? 'Copiado' : 'Copiar'}</button>}</div>
    <pre>{children}</pre>
  </div>
}

export function MarkdownView({ content, onOutline, staticExport = false }: MarkdownViewProps) {
  const container = useRef<HTMLDivElement>(null)
  const outlineCallback = useRef(onOutline)
  outlineCallback.current = onOutline

  useEffect(() => {
    const items = Array.from(container.current?.querySelectorAll('h1, h2, h3, h4, h5, h6') ?? []).map((heading) => ({
      id: heading.id,
      text: heading.textContent ?? '',
      level: Number(heading.tagName.slice(1)),
    }))
    outlineCallback.current?.(items)
  }, [content])

  return <div className="markdown-body" ref={container}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[
        [rehypeHighlight, { detect: false, ignoreMissing: true }],
        [rehypeKatex, { throwOnError: false, trust: false, maxExpand: 1000, output: staticExport ? 'mathml' : 'htmlAndMathml' }],
        rehypeHeadingIds,
      ]}
      urlTransform={safeMarkdownUrl}
      skipHtml
      components={{
        pre: ({ node, children }) => <CodeBlock node={node} staticExport={staticExport}>{children}</CodeBlock>,
        a: ({ node: _node, href, children, ...props }) => <a {...props} href={href} target={href?.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer">{children}</a>,
        img: ({ node: _node, ...props }) => <img {...props} loading="lazy" alt={props.alt ?? ''} />,
      }}
    >{splitFrontMatter(content).body}</ReactMarkdown>
  </div>
}

export default MarkdownView
