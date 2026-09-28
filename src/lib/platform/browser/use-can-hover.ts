import * as React from 'react'

const HOVER_QUERY = '(hover: hover)'

function subscribe(callback: () => void) {
  const mediaQuery = window.matchMedia(HOVER_QUERY)
  mediaQuery.addEventListener('change', callback)
  return () => mediaQuery.removeEventListener('change', callback)
}

function getSnapshot() {
  return window.matchMedia(HOVER_QUERY).matches
}

function getServerSnapshot() {
  return false
}

export function useCanHover() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
