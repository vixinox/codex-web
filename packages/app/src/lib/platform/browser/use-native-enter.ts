import * as React from 'react'

type EnterOptions = {
  delay?: number
  duration?: number
  y?: number
  onComplete?: () => void
}

function reducedMotion() {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function useNativeAnimation<T extends HTMLElement>(
  dependencies: React.DependencyList,
  options: EnterOptions,
  className: string,
) {
  const ref = React.useRef<T>(null)
  const onCompleteRef = React.useRef(options.onComplete)
  onCompleteRef.current = options.onComplete
  React.useLayoutEffect(() => {
    const element = ref.current
    if (!element) return undefined
    if (reducedMotion()) {
      onCompleteRef.current?.()
      return undefined
    }
    element.style.setProperty('--native-animation-delay', `${options.delay ?? 0}s`)
    element.style.setProperty('--native-animation-duration', `${options.duration ?? 0.24}s`)
    element.style.setProperty('--native-animation-y', `${options.y ?? 6}px`)
    element.classList.remove(className)
    void element.offsetWidth
    element.classList.add(className)
    const handleEnd = () => {
      element.classList.remove(className)
      onCompleteRef.current?.()
    }
    element.addEventListener('animationend', handleEnd)
    return () => {
      element.removeEventListener('animationend', handleEnd)
      element.classList.remove(className)
    }
    // The caller owns this dynamic dependency list; options are read when the animation runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies)
  return ref
}

export function useNativeEnter<T extends HTMLElement>(
  dependencies: React.DependencyList,
  options: EnterOptions = {},
) {
  return useNativeAnimation<T>(dependencies, options, 'native-enter')
}

export function useNativeFadeEnter<T extends HTMLElement>(
  dependencies: React.DependencyList,
  options: Omit<EnterOptions, 'y'> = {},
) {
  return useNativeAnimation<T>(dependencies, options, 'native-fade-enter')
}

export function useNativeFadePulse<T extends HTMLElement>(
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
    element.classList.remove('native-fade-pulse')
    void element.offsetWidth
    element.classList.add('native-fade-pulse')
    const handleEnd = () => element.classList.remove('native-fade-pulse')
    element.addEventListener('animationend', handleEnd)
    return () => {
      element.removeEventListener('animationend', handleEnd)
      element.classList.remove('native-fade-pulse')
    }
    // The caller owns this dynamic dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies)
}
