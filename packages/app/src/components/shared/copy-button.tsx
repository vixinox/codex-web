import * as React from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type CopyButtonProps = Omit<
  React.ComponentProps<typeof Button>,
  'children' | 'onClick' | 'type'
> & {
  text: string
  copiedLabel?: string
  iconClassName?: string
  copiedIconClassName?: string
  delay?: number
}

export function CopyButton({
  text,
  copiedLabel = 'Copied to clipboard',
  iconClassName,
  copiedIconClassName,
  delay = 1500,
  'aria-label': ariaLabel = 'Copy to clipboard',
  className,
  title,
  disabled,
  ...props
}: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false)
  const resetTimerRef = React.useRef<number | undefined>(undefined)

  const canCopy = typeof window !== 'undefined' && !!navigator?.clipboard

  React.useEffect(() => {
    return () => {
      if (resetTimerRef.current !== undefined) {
        window.clearTimeout(resetTimerRef.current)
      }
    }
  }, [])

  const handleCopy = React.useCallback(async () => {
    if (!canCopy || !text || copied) return

    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)

      if (resetTimerRef.current !== undefined) {
        window.clearTimeout(resetTimerRef.current)
      }

      resetTimerRef.current = window.setTimeout(() => {
        setCopied(false)
      }, delay)
    } catch (error) {
      console.error('Failed to copy text: ', error)
      setCopied(false)
    }
  }, [text, canCopy, copied, delay])

  return (
    <Button
      type="button"
      size="icon"
      disabled={disabled || !canCopy}
      onClick={handleCopy}
      aria-label={copied ? copiedLabel : ariaLabel}
      title={title ?? (copied ? copiedLabel : ariaLabel)}
      className={cn(
        'relative text-app-text-muted hover:text-foreground active:scale-95',
        className,
      )}
      {...props}
    >
      <span className="grid place-items-center">
        <CopyIcon
          className={cn(
            'col-start-1 row-start-1 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
            copied ? 'scale-0 rotate-90 opacity-0' : 'scale-100 rotate-0 opacity-100',
            'size-4',
            iconClassName,
          )}
        />
        <CheckIcon
          className={cn(
            'col-start-1 row-start-1 text-success transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
            copied ? 'scale-100 rotate-0 opacity-100' : 'scale-0 -rotate-90 opacity-0',
            'size-4',
            copiedIconClassName,
          )}
        />
      </span>
    </Button>
  )
}
