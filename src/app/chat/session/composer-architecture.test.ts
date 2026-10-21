import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { ownerComposerAdapter } from './adapters/owner-composer-adapter'
import { ownerThreadClient } from '@/lib/bridge/thread-adapters'

const source = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), { encoding: 'utf8' })

describe('Composer architecture boundaries', () => {
  it('keeps shared Composer and Thread lifecycle modules transport agnostic', () => {
    const shared = [
      '../composer/model/composer-view-model.ts',
      '../composer/state/model-selection-sync.ts',
      './controllers/use-composer-controller.ts',
      './controllers/use-thread-detail-controller.ts',
      './presentation/use-pending-thread-presentation.ts',
      './state/thread-pending-reconciliation.ts',
      './state/thread-session-store.ts',
    ].map(source)

    for (const contents of shared) {
      expect(contents).not.toMatch(/lib\/bridge\/http\/(threads|configuration)/)
      expect(contents).not.toMatch(/['"]\/api\//)
    }
  })

  it('wires the Owner adapter to the Owner Thread client', () => {
    expect(ownerComposerAdapter.threads).toBe(ownerThreadClient)
    expect(ownerComposerAdapter.capabilities.availableModels).toEqual([])
  })
})
