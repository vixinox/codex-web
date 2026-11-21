import { expect, it, vi } from 'vitest'
import { ownerThreadDomainAdapter } from './owner-thread-adapter'

const ownerBridge = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/lib/bridge/owner-runtime', () => ({ getOwnerBridge: () => ownerBridge }))

it('sends compact through the typed Conversation command', async () => {
  ownerBridge.request.mockResolvedValueOnce({ accepted: true })
  await ownerThreadDomainAdapter.compactThread('thread-1')
  expect(ownerBridge.request).toHaveBeenCalledExactlyOnceWith(
    'conversation.command',
    { type: 'conversation.compact', conversationId: 'thread-1' },
    { mutation: true },
  )
})
