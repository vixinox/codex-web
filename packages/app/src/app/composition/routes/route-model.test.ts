import { describe, expect, it } from 'vitest'

import { isKnownAppRoute } from './route-model'

describe('workspace route model', () => {
  it('recognizes the supported workspace paths', () => {
    expect(isKnownAppRoute('/app')).toBe(true)
    expect(isKnownAppRoute('/app/')).toBe(true)
    expect(isKnownAppRoute('/app/settings')).toBe(true)
    expect(isKnownAppRoute('/app/settings/archived-chats')).toBe(true)
    expect(isKnownAppRoute('/app/settings/connection')).toBe(true)
    expect(isKnownAppRoute('/app/threads/thread-1')).toBe(true)
    expect(isKnownAppRoute('/app/projects/project-1/threads/thread-1')).toBe(true)
  })

  it('rejects management and unknown paths from the workspace wildcard', () => {
    expect(isKnownAppRoute('/app/manage')).toBe(false)
    expect(isKnownAppRoute('/app/settings/unknown')).toBe(false)
    expect(isKnownAppRoute('/app/unknown')).toBe(false)
    expect(isKnownAppRoute('/owner/manage')).toBe(false)
  })
})
