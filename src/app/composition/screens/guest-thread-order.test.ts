import { describe, expect, it } from 'vitest'

import type { ChatThreadPresentation } from '@/app/chat/model/types'
import type { ThreadSummary } from '@/lib/bridge/thread-client'
import { promoteGuestThread, reconcileGuestThreads, replaceGuestThread } from './guest-thread-order'

const thread = (id: string): ChatThreadPresentation => ({
  id,
  projectId: null,
  title: id,
  updatedAt: 1,
  isBusy: false,
  turns: [],
})

const summary = (id: string, updatedAt: number): ThreadSummary => ({
  id,
  projectId: null,
  title: id,
  updatedAt,
  status: 'idle',
})

describe('guest thread order', () => {
  it('replaces a selected thread detail without moving it', () => {
    const current = [thread('first'), thread('second'), thread('third')]

    const result = replaceGuestThread(current, { ...thread('second'), title: 'Selected' })

    expect(result.map(({ id }) => id)).toEqual(['first', 'second', 'third'])
    expect(result[1]?.title).toBe('Selected')
  })

  it('refreshes summaries without reordering existing threads', () => {
    const current = [thread('first'), thread('second')]

    const result = reconcileGuestThreads(current, [summary('second', 30), summary('first', 20)])

    expect(result.map(({ id }) => id)).toEqual(['first', 'second'])
  })

  it('inserts a new summary according to the server order', () => {
    const current = [thread('first'), thread('second')]

    const result = reconcileGuestThreads(current, [
      summary('new', 30),
      summary('second', 20),
      summary('first', 10),
    ])

    expect(result.map(({ id }) => id)).toEqual(['new', 'first', 'second'])
  })

  it('moves a thread only through explicit promotion', () => {
    const result = promoteGuestThread([thread('first'), thread('second')], 'second')

    expect(result.map(({ id }) => id)).toEqual(['second', 'first'])
  })
})
