import type { ComponentProps } from 'react'
import { CollapsibleContent } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

type TranscriptCollapsibleContentProps = ComponentProps<typeof CollapsibleContent>

export function TranscriptCollapsibleContent({
  className,
  ...props
}: TranscriptCollapsibleContentProps) {
  return (
    <CollapsibleContent
      className={cn(
        'h-(--collapsible-panel-height) overflow-hidden transition-[height,opacity] duration-200',
        'data-ending-style:h-0 data-starting-style:h-0 data-open:opacity-100 data-closed:opacity-0',
        className,
      )}
      {...props}
    />
  )
}
