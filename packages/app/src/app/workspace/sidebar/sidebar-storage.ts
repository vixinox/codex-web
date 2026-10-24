import * as React from 'react'

export function useStoredBoolean(key: string, fallback: boolean, persist = true) {
  const [value, setValue] = React.useState(() => {
    if (!persist) return fallback
    try {
      const stored = window.localStorage.getItem(key)
      return stored === null ? fallback : stored === 'true'
    } catch {
      return fallback
    }
  })
  React.useEffect(() => {
    if (!persist) return
    try {
      window.localStorage.setItem(key, String(value))
    } catch {
      // Storage may be unavailable.
    }
  }, [key, persist, value])
  return [value, setValue] as const
}

export function removeStoredValue(key: string) {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Storage may be unavailable.
  }
}
