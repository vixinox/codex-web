import { createContext, useContext } from 'react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import type { Components, ExtraProps } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { parseCodeFenceInfo, remarkCodeFenceInfo } from './code-fence-info'
import { ShikiCodeBlock } from './shiki-code-block'

type MarkdownCodeProps = ComponentPropsWithoutRef<'code'> &
  ExtraProps & { 'data-code-title'?: string }

const allowedProtocols = new Set(['http:', 'https:', 'mailto:'])
const CodeBlockContext = createContext(false)

function isAllowedUrl(value: string) {
  try {
    const protocol = new URL(value).protocol
    return allowedProtocols.has(protocol)
  } catch {
    return false
  }
}

function codeText(value: ReactNode): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(codeText).join('')
  return ''
}

const CodeBlock = ({
  children,
  className,
  'data-code-title': title,
  ...props
}: MarkdownCodeProps) => {
  const isCodeBlock = useContext(CodeBlockContext)
  const classLanguage = /(?:^|\s)language-([^\s]+)/.exec(className || '')?.[1]
  const info = parseCodeFenceInfo(typeof title === 'string' ? title : classLanguage)
  const rawCode = codeText(children).replace(/\n$/, '')

  if (!isCodeBlock) {
    return (
      <code
        className="rounded bg-app-surface-raised px-1.5 py-0.5 font-mono text-[13px] text-foreground"
        {...props}
      >
        {children}
      </code>
    )
  }

  return <ShikiCodeBlock code={rawCode} language={info.language} label={info.label} />
}

const markdownComponents: Components = {
  h1: ({ children }) => <h2 className="text-base font-semibold text-foreground">{children}</h2>,
  h2: ({ children }) => <h3 className="text-base font-semibold text-foreground">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-2 text-sm font-semibold text-foreground">{children}</h4>,
  p: ({ children }) => <p className="last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
  blockquote: ({ children }) => (
    <blockquote className="relative mb-3 pl-6 text-app-text-muted before:absolute before:inset-y-0 before:left-0 before:w-0.75 before:rounded-full before:bg-app-border-strong last:mb-0">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="mb-4 overflow-hidden rounded-xl border border-app-border bg-app-surface shadow-sm last:mb-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-md border-separate border-spacing-0 text-left text-sm [&_tbody_tr:last-child_td]:border-b-0">
          {children}
        </table>
      </div>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-app-border bg-app-surface-subtle px-4 py-2.5 text-xs font-semibold tracking-wide whitespace-nowrap text-app-text-muted first:pl-5 last:pr-5">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-app-border px-4 py-2.5 align-top text-foreground transition-colors first:pl-5 last:pr-5">
      {children}
    </td>
  ),
  tr: ({ children }) => <tr className="hover:bg-app-selection transition-colors">{children}</tr>,
  code: (props) => <CodeBlock {...props} />,
  pre: ({ children }) => <CodeBlockContext.Provider value>{children}</CodeBlockContext.Provider>,
  a: ({ href, children }) => {
    if (!href || !isAllowedUrl(href)) return <span>{children}</span>
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="text-primary underline-offset-3 hover:underline"
      >
        {children}
      </a>
    )
  },
}

export function MessageContent({ text, markdown = true }: { text: string; markdown?: boolean }) {
  if (!markdown) {
    return <span className="wrap-break-word whitespace-pre-wrap">{text}</span>
  }
  return (
    <div className="space-y-2 text-sm leading-6 wrap-break-word text-foreground">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm, remarkCodeFenceInfo]}
        components={markdownComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
