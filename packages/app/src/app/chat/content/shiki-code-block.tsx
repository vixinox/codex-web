import * as React from 'react'

import { CopyButton } from '@/components/shared/copy-button'
import { useTheme } from '@/components/shared/theme-provider'
import { cn } from '@/lib/utils'
import { highlightCode, normalizeLanguage } from './shiki-highlighter'

export function ShikiCodeBlock({
  code,
  language,
  label,
  copy = true,
  highlight = true,
  className,
  contentClassName,
  footer,
}: {
  code: string
  language: string
  label?: string
  copy?: boolean
  highlight?: boolean
  className?: string
  contentClassName?: string
  footer?: React.ReactNode
}) {
  const { resolvedVariant } = useTheme()
  const normalizedLanguage = normalizeLanguage(language)
  const highlightKey = `${resolvedVariant}:${normalizedLanguage}:${code}`
  const [highlightedCode, setHighlightedCode] = React.useState<
    { key: string; html: string } | undefined
  >()

  React.useEffect(() => {
    let cancelled = false
    if (!highlight) return
    void highlightCode(code, normalizedLanguage, resolvedVariant)
      .then((html) => {
        if (!cancelled && html !== undefined) setHighlightedCode({ key: highlightKey, html })
        return undefined
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [code, highlight, highlightKey, normalizedLanguage, resolvedVariant])

  return (
    <div
      className={cn(
        'relative my-3 overflow-hidden rounded-lg border border-app-border bg-app-surface-raised',
        className,
      )}
    >
      <div className="flex min-h-8 w-full items-center justify-between bg-app-surface-raised py-1.5 pr-2 pl-4">
        <p className="min-w-0 truncate font-mono text-sm text-app-text-muted select-none">
          {label ?? normalizedLanguage}
        </p>
        {copy ? (
          <CopyButton
            variant="ghost"
            size="icon"
            text={code}
            className="h-7 w-7"
            aria-label="Copy code"
            title="Copy code"
          />
        ) : null}
      </div>
      <div
        className={cn(
          'w-full scrollbar-thin scrollbar-thumb-app-border overflow-auto bg-app-surface-raised font-mono text-xs leading-6 text-app-text [&_pre]:bg-transparent [&_pre]:px-4 [&_pre]:pt-1 [&_pre]:whitespace-pre [&_pre]:text-inherit',
          footer ? 'pb-8' : undefined,
          contentClassName,
        )}
        {...(highlightedCode?.key === highlightKey
          ? {
              // Shiki generates this HTML from the code string; it is not user-authored HTML.
              dangerouslySetInnerHTML: { __html: highlightedCode.html },
            }
          : {})}
      >
        {highlightedCode?.key !== highlightKey ? (
          <pre>
            <code className="block">{code}</code>
          </pre>
        ) : null}
      </div>
      {footer ? <div className="absolute right-2 bottom-2 z-10">{footer}</div> : null}
    </div>
  )
}
