import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORKSPACE_SIDEBAR_WIDTH,
  MAX_WORKSPACE_SIDEBAR_WIDTH,
  MIN_WORKSPACE_SIDEBAR_WIDTH,
  parseWorkspaceSidebarWidth,
} from './sidebar-storage'

describe('workspace sidebar width storage', () => {
  it('uses the default width when storage is missing or invalid', () => {
    expect(parseWorkspaceSidebarWidth(null)).toBe(DEFAULT_WORKSPACE_SIDEBAR_WIDTH)
    expect(parseWorkspaceSidebarWidth('not-a-number')).toBe(DEFAULT_WORKSPACE_SIDEBAR_WIDTH)
    expect(parseWorkspaceSidebarWidth('Infinity')).toBe(DEFAULT_WORKSPACE_SIDEBAR_WIDTH)
  })

  it('clamps stored widths to the supported range', () => {
    expect(parseWorkspaceSidebarWidth('120')).toBe(MIN_WORKSPACE_SIDEBAR_WIDTH)
    expect(parseWorkspaceSidebarWidth('900')).toBe(MAX_WORKSPACE_SIDEBAR_WIDTH)
    expect(parseWorkspaceSidebarWidth('360')).toBe(360)
  })
})
