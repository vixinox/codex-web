import * as React from 'react'
import { gsap } from 'gsap'

type EnterOptions = {
  delay?: number
  duration?: number
  stagger?: number
  y?: number
  onComplete?: () => void
}

function reducedMotion() {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export function useGsapEnter<T extends HTMLElement>(
  dependencies: React.DependencyList,
  options: EnterOptions = {},
) {
  const ref = React.useRef<T>(null)
  React.useLayoutEffect(() => {
    const element = ref.current
    if (!element) return undefined
    if (reducedMotion()) {
      options.onComplete?.()
      return undefined
    }
    const context = gsap.context(() => {
      gsap.fromTo(
        element,
        { autoAlpha: 0, y: options.y ?? 6 },
        {
          autoAlpha: 1,
          y: 0,
          duration: options.duration ?? 0.24,
          delay: options.delay ?? 0,
          ease: 'power2.out',
          overwrite: 'auto',
          onComplete: options.onComplete,
        },
      )
    }, element)
    return () => context.revert()
    // The caller owns this dynamic dependency list; options are read when the animation runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies)
  return ref
}

type FadeOptions = Pick<EnterOptions, 'delay' | 'duration' | 'onComplete'>

export function useGsapFadeEnter<T extends HTMLElement>(
  dependencies: React.DependencyList,
  options: FadeOptions = {},
) {
  const ref = React.useRef<T>(null)
  React.useLayoutEffect(() => {
    const element = ref.current
    if (!element) return undefined
    if (reducedMotion()) {
      options.onComplete?.()
      return undefined
    }
    const context = gsap.context(() => {
      gsap.fromTo(
        element,
        { autoAlpha: 0 },
        {
          autoAlpha: 1,
          duration: options.duration ?? 0.22,
          delay: options.delay ?? 0,
          ease: 'power2.out',
          overwrite: 'auto',
          onComplete: options.onComplete,
        },
      )
    }, element)
    return () => context.revert()
    // The caller owns this dynamic dependency list; options are read when the animation runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies)
  return ref
}

export function useGsapFadePulse<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  dependencies: React.DependencyList,
) {
  const initialized = React.useRef(false)
  React.useLayoutEffect(() => {
    const element = ref.current
    if (!element) return undefined
    if (!initialized.current) {
      initialized.current = true
      return undefined
    }
    if (reducedMotion()) return undefined
    const context = gsap.context(() => {
      gsap.fromTo(
        element,
        { autoAlpha: 0.55 },
        { autoAlpha: 1, duration: 0.2, ease: 'power2.out', overwrite: 'auto' },
      )
    }, element)
    return () => context.revert()
    // The caller owns this dynamic dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies)
}
