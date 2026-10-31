import * as React from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const DEFAULT_SIDEBAR_WIDTH = 312
export const MIN_SIDEBAR_WIDTH = 240
export const MAX_SIDEBAR_WIDTH = 520

export function clampSidebarWidth(width: number) {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width))
}

export const sidebarSectionHeadingClassName =
  'flex items-center px-2 py-2 text-sm font-medium text-muted-foreground select-none'

export const Sidebar = React.forwardRef<
  HTMLElement,
  React.ComponentPropsWithoutRef<'aside'> & {
    width: number
    onWidthChange: (width: number) => void
  }
>(function Sidebar({ children, className, style, width, onWidthChange, ...props }, ref) {
  return (
    <aside
      ref={ref}
      className={cn(
        'relative flex h-full min-h-0 w-full min-w-0 flex-col border-r border-border/70 bg-sidebar text-sidebar-foreground xl:w-(--sidebar-width) xl:shrink-0',
        className,
      )}
      style={{ ...style, '--sidebar-width': `${width}px` } as React.CSSProperties}
      {...props}
    >
      <SidebarResizeHandle width={width} onWidthChange={onWidthChange} />
      {children}
    </aside>
  )
})

export function SidebarResizeHandle({
  width,
  onWidthChange,
}: {
  width: number
  onWidthChange: (width: number) => void
}) {
  const resizeRef = React.useRef<{ startX: number; startWidth: number } | null>(null)
  const stopResizing = React.useCallback(() => {
    resizeRef.current = null
    document.body.style.removeProperty('cursor')
    document.body.style.removeProperty('user-select')
  }, [])

  React.useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!resizeRef.current) return
      onWidthChange(
        clampSidebarWidth(resizeRef.current.startWidth + event.clientX - resizeRef.current.startX),
      )
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResizing)
    window.addEventListener('pointercancel', stopResizing)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResizing)
      window.removeEventListener('pointercancel', stopResizing)
      stopResizing()
    }
  }, [onWidthChange, stopResizing])

  const startResizing = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || window.matchMedia('(max-width: 1279px)').matches) return
    event.preventDefault()
    resizeRef.current = { startX: event.clientX, startWidth: width }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const resizeWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 32 : 16
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      onWidthChange(clampSidebarWidth(width - step))
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      onWidthChange(clampSidebarWidth(width + step))
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuemax={MAX_SIDEBAR_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      className="group/resize absolute top-0 -right-0.75 z-20 hidden h-full w-1 cursor-col-resize touch-none xl:block focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring before:absolute before:top-0 before:left-1/2 before:h-full before:w-px before:-translate-x-1/2 before:bg-ring/0 before:transition-colors hover:before:bg-ring/70 focus-visible:before:bg-ring/70 [&:active]:before:bg-ring"
      onPointerDown={startResizing}
      onKeyDown={resizeWithKeyboard}
    />
  )
}

export function SidebarHeader({ children, className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('flex flex-col pt-3 pb-2', className)} {...props}>
      {children}
    </div>
  )
}

export function SidebarContent({ children, className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('min-h-0 flex-1 overflow-y-auto px-3 pb-3', className)} {...props}>
      {children}
    </div>
  )
}

export function SidebarSection({ children, className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('flex flex-col', className)} {...props}>
      {children}
    </div>
  )
}

export function SidebarSectionItems({
  children,
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div className={cn('flex flex-col gap-0.5', className)} {...props}>
      {children}
    </div>
  )
}

export function SidebarSectionHeading({
  children,
  className,
  render,
}: {
  children: React.ReactNode
  className?: string
  render?: React.ReactElement<{ className?: string; children?: React.ReactNode }>
}) {
  const headingClassName = cn(sidebarSectionHeadingClassName, className)
  if (render) {
    return React.cloneElement(render, {
      className: cn(render.props.className, headingClassName),
      children,
    })
  }
  return <div className={headingClassName}>{children}</div>
}

export function SidebarItem({
  children,
  className,
  icon,
  active = false,
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'aria-current' | 'variant'> & {
  icon?: React.ReactNode
  active?: boolean
}) {
  return (
    <Button
      variant="ghost"
      className={cn('w-full justify-start', className)}
      {...props}
      aria-current={active ? 'page' : undefined}
    >
      {icon}
      {children}
    </Button>
  )
}

export function SidebarFooter({ children, className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('mb-2 shrink-0 px-2', className)} {...props}>
      {children}
    </div>
  )
}
