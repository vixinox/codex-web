import * as React from 'react'

export const ToolCallAnimationContext = React.createContext<{
  animate: boolean
  seen: Set<string>
} | null>(null)

/** History belongs to the turn, so regrouping or reopening cannot replay a title. */
export function ToolCallTitle({
  id,
  running = false,
  children,
}: {
  id: string
  running?: boolean
  children: React.ReactNode
}) {
  const animation = React.useContext(ToolCallAnimationContext)
  const ref = React.useRef<HTMLSpanElement>(null)
  React.useLayoutEffect(() => {
    const root = ref.current
    if (!root || !animation || animation.seen.has(id)) return
    if (!animation.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      animation.seen.add(id)
      return
    }
    root.classList.add('tool-call-title-pending')
    // Collapsible panels may keep hidden children mounted. Animate only when shown.
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      root.classList.remove('tool-call-title-pending')
      if (animation.seen.has(id)) return
      animation.seen.add(id)
      root.classList.add('tool-call-title-enter')
    })
    observer.observe(root)
    return () => {
      observer.disconnect()
      root.classList.remove('tool-call-title-pending')
    }
  }, [animation, id])
  return (
    <span ref={ref} className="min-w-0 truncate">
      <span className={running ? 'thinking-shimmer' : undefined}>{children}</span>
    </span>
  )
}
