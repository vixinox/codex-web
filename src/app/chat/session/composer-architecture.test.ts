import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  GUEST_COMPOSER_CAPABILITIES,
  OWNER_THREAD_COMPOSER_CAPABILITIES,
} from '../composer/composer-capabilities'
import { guestComposerAdapter } from './guest-composer-adapter'
import { ownerComposerAdapter } from './owner-composer-adapter'
import { guestThreadClient, ownerThreadClient } from '@/lib/bridge/thread-adapters'

const source = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), { encoding: 'utf8' })

describe('Composer architecture boundaries', () => {
  it('keeps shared Composer and Thread lifecycle modules transport agnostic', () => {
    const shared = [
      '../composer/composer-view-model.ts',
      '../composer/model-selection-sync.ts',
      './use-composer-controller.ts',
      './use-thread-detail-controller.ts',
      './use-pending-thread-presentation.ts',
      './thread-pending-reconciliation.ts',
      './thread-session-store.ts',
    ].map(source)

    for (const contents of shared) {
      expect(contents).not.toMatch(/lib\/bridge\/http\/(guest|threads|configuration)/)
      expect(contents).not.toMatch(/['"]\/(guest-api|api)\//)
      expect(contents).not.toContain('isGuest')
    }
  })

  it('wires each runtime to its own Thread client and capability contract', () => {
    expect(ownerComposerAdapter.threads).toBe(ownerThreadClient)
    expect(ownerComposerAdapter.capabilities).toBe(OWNER_THREAD_COMPOSER_CAPABILITIES)
    expect(ownerComposerAdapter.acceptedTurnIdIsNative).toBe(true)
    expect(guestComposerAdapter.threads).toBe(guestThreadClient)
    expect(guestComposerAdapter.capabilities).toBe(GUEST_COMPOSER_CAPABILITIES)
    expect(guestComposerAdapter.acceptedTurnIdIsNative).toBe(false)
  })

  it('prevents runtime adapters from importing the other runtime transport', () => {
    const owner = source('./owner-composer-adapter.ts')
    const guest = source('./guest-composer-adapter.ts')

    expect(owner).not.toMatch(/http\/guest|guestThreadClient|\/guest-api\//)
    expect(guest).not.toMatch(/http\/threads|http\/configuration|ownerThreadClient|['"]\/api\//)
  })
})
