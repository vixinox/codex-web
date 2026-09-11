import * as React from 'react'
import { gsap } from 'gsap'

type Entry<T> = { key: string; item: T; present: boolean }

function reducedMotion() {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export function FadePresenceList<T>({
  items,
  getKey,
  children,
}: {
  items: readonly T[]
  getKey: (item: T) => string
  children: (item: T, exiting: boolean) => React.ReactNode
}) {
  const [entries, setEntries] = React.useState<readonly Entry<T>[]>(() =>
    items.map((item) => ({ key: getKey(item), item, present: true })),
  )

  React.useLayoutEffect(() => {
    const nextByKey = new Map(items.map((item) => [getKey(item), item]))
    // Presence reconciliation intentionally synchronizes local DOM presence state after render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntries((current) => {
      const currentByKey = new Map(current.map((entry) => [entry.key, entry]))
      const next = items.map((item) => {
        const key = getKey(item)
        return { key, item, present: true }
      })
      for (const entry of current) {
        if (!nextByKey.has(entry.key)) next.push({ ...entry, present: false })
      }
      const unchanged =
        next.length === current.length &&
        next.every((entry, index) => {
          const previous = current[index]
          return (
            previous?.key === entry.key &&
            previous.item === entry.item &&
            previous.present === entry.present
          )
        })
      if (unchanged) return current
      return next.map((entry) => {
        const previous = currentByKey.get(entry.key)
        return previous && entry.present ? Object.assign({}, entry, { item: entry.item }) : entry
      })
    })
  }, [getKey, items])

  const remove = React.useCallback((key: string) => {
    setEntries((current) => current.filter((entry) => entry.key !== key))
  }, [])

  return entries.map((entry) => (
    <FadePresenceItem key={entry.key} present={entry.present} onExited={() => remove(entry.key)}>
      {children(entry.item, !entry.present)}
    </FadePresenceItem>
  ))
}

function FadePresenceItem({
  present,
  onExited,
  children,
}: {
  present: boolean
  onExited: () => void
  children: React.ReactNode
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const onExitedRef = React.useRef(onExited)
  React.useEffect(() => {
    onExitedRef.current = onExited
  }, [onExited])
  React.useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    if (reducedMotion()) {
      if (!present) onExitedRef.current()
      return
    }
    const context = gsap.context(() => {
      if (present) {
        gsap.fromTo(
          element,
          { autoAlpha: 0 },
          { autoAlpha: 1, duration: 0.18, ease: 'power2.out', overwrite: 'auto' },
        )
        return
      }
      gsap.to(element, {
        autoAlpha: 0,
        duration: 0.16,
        ease: 'power1.out',
        overwrite: 'auto',
        onComplete: () => onExitedRef.current(),
      })
    }, element)
    return () => context.revert()
  }, [present])

  return (
    <div
      ref={ref}
      aria-hidden={present ? undefined : true}
      className={present ? undefined : 'pointer-events-none'}
    >
      {children}
    </div>
  )
}
