import * as React from 'react'
import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  clampSidebarWidth,
} from '@/components/shared/sidebar'

export const WORKSPACE_SIDEBAR_WIDTH_STORAGE_KEY = 'workspace-sidebar:width'
export const DEFAULT_WORKSPACE_SIDEBAR_WIDTH = DEFAULT_SIDEBAR_WIDTH
export const MIN_WORKSPACE_SIDEBAR_WIDTH = MIN_SIDEBAR_WIDTH
export const MAX_WORKSPACE_SIDEBAR_WIDTH = MAX_SIDEBAR_WIDTH

export function parseWorkspaceSidebarWidth(value: string | null) {
  if (value === null) return DEFAULT_WORKSPACE_SIDEBAR_WIDTH

  const width = Number(value)
  if (!Number.isFinite(width)) return DEFAULT_WORKSPACE_SIDEBAR_WIDTH

  return clampWorkspaceSidebarWidth(width)
}

export function clampWorkspaceSidebarWidth(width: number) {
  return clampSidebarWidth(width)
}

export function readWorkspaceSidebarWidth() {
  try {
    return parseWorkspaceSidebarWidth(
      window.localStorage.getItem(WORKSPACE_SIDEBAR_WIDTH_STORAGE_KEY),
    )
  } catch {
    return DEFAULT_WORKSPACE_SIDEBAR_WIDTH
  }
}

export function storeWorkspaceSidebarWidth(width: number) {
  try {
    window.localStorage.setItem(
      WORKSPACE_SIDEBAR_WIDTH_STORAGE_KEY,
      String(clampWorkspaceSidebarWidth(width)),
    )
  } catch {
    // Storage can be unavailable; resizing must still work.
  }
}

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
