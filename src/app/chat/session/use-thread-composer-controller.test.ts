import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => ({
  fetchSkills: vi.fn(),
  subscribeToEvents: vi.fn(),
  startThread: vi.fn(),
  startTurn: vi.fn(),
  fetchThread: vi.fn(),
  cancelTurn: vi.fn(),
  compactThread: vi.fn(),
  answerUserInput: vi.fn(),
}))

vi.mock('@/lib/bridge/http/skills', () => ({ fetchSkills: bridge.fetchSkills }))
vi.mock('@/lib/bridge/events/event-source', () => ({
  subscribeToEvents: bridge.subscribeToEvents,
}))
vi.mock('@/lib/bridge/http/threads', () => ({
  startThread: bridge.startThread,
  startTurn: bridge.startTurn,
  fetchThread: bridge.fetchThread,
  cancelTurn: bridge.cancelTurn,
  compactThread: bridge.compactThread,
  answerUserInput: bridge.answerUserInput,
}))
vi.mock('./chat-selection-storage', () => ({
  readNewChatSelection: () => ({ model: 'gpt-5.6-sol', effort: 'medium' }),
  readThreadSelection: () => ({ model: 'gpt-5.6-sol', effort: 'medium' }),
  writeNewChatSelection: vi.fn(),
  writeThreadSelection: vi.fn(),
}))

import { composerStore } from '@/app/chat/composer/composer-store'
import { useThreadComposerController } from './use-thread-composer-controller'

const skill = {
  handle: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  name: 'pdf',
  displayName: 'PDF',
  description: 'Create PDFs',
  scope: 'system' as const,
}

describe('thread composer skills controller', () => {
  beforeEach(() => {
    composerStore.scopes = {}
    vi.clearAllMocks()
    bridge.fetchSkills.mockResolvedValue([skill])
    bridge.subscribeToEvents.mockReturnValue(() => undefined)
    bridge.startThread.mockResolvedValue({
      projectId: null,
      threadId: 'thread-1',
      turnId: 'turn-1',
    })
    bridge.fetchThread.mockResolvedValue({
      thread: { id: 'thread-1', turns: [] },
      eventCursor: 0,
    })
  })

  it('loads Skills, refreshes after skills/changed, and clears a successful selection', async () => {
    let onSkillsChanged: ((event: Event) => void) | undefined
    bridge.subscribeToEvents.mockImplementation(({ onEvent }) => {
      onSkillsChanged = onEvent
      return () => undefined
    })
    const host = {
      target: { projectId: null, threadId: null },
      followTurn: vi.fn(),
      retry: vi.fn(),
      navigateToThread: vi.fn(),
      onTurnAccepted: vi.fn(),
    }
    const { result } = renderHook(() =>
      useThreadComposerController({ userId: 'user-1', host, runtimeReady: true, working: false }),
    )

    await waitFor(() => expect(result.current.viewModel.skills.status).toBe('ready'))
    act(() => result.current.actions.setDraft('Create a report.', [skill]))
    await waitFor(() => expect(result.current.viewModel.selectedSkills).toEqual([skill]))

    act(() => onSkillsChanged?.(new Event('skills/changed')))
    await waitFor(() => expect(bridge.fetchSkills).toHaveBeenCalledTimes(2))

    await act(async () => result.current.actions.submit('Create a report.'))
    expect(bridge.startThread).toHaveBeenCalledWith(
      expect.objectContaining({ skillHandles: [skill.handle] }),
      expect.any(AbortSignal),
    )
    await waitFor(() => expect(result.current.viewModel.selectedSkills).toEqual([]))
  })

  it('keeps the draft and Skill snapshot when submission is rejected', async () => {
    bridge.startThread.mockRejectedValue(new Error('Selected skills are no longer available'))
    const host = {
      target: { projectId: null, threadId: null },
      followTurn: vi.fn(),
      retry: vi.fn(),
      navigateToThread: vi.fn(),
      onTurnAccepted: vi.fn(),
    }
    const { result } = renderHook(() =>
      useThreadComposerController({ userId: 'user-1', host, runtimeReady: true, working: false }),
    )

    await waitFor(() => expect(result.current.viewModel.skills.status).toBe('ready'))
    act(() => result.current.actions.setDraft('Create a report.', [skill]))
    await act(async () => result.current.actions.submit('Create a report.', [skill]))

    expect(result.current.viewModel.draft).toBe('Create a report.')
    expect(result.current.viewModel.selectedSkills).toEqual([skill])
    expect(host.onTurnAccepted).not.toHaveBeenCalled()
  })

  it('reports an accepted turn exactly once before following it', async () => {
    bridge.startTurn.mockResolvedValue({ turnId: 'turn-2' })
    const calls: string[] = []
    const host = {
      target: { projectId: 'project-1', threadId: 'thread-1' },
      followTurn: vi.fn(() => calls.push('follow')),
      retry: vi.fn(),
      navigateToThread: vi.fn(),
      onTurnAccepted: vi.fn(() => calls.push('accepted')),
    }
    const { result } = renderHook(() =>
      useThreadComposerController({ userId: 'user-1', host, runtimeReady: true, working: false }),
    )

    await act(async () => result.current.actions.submit('Continue.'))

    expect(host.onTurnAccepted).toHaveBeenCalledOnce()
    expect(host.onTurnAccepted).toHaveBeenCalledWith({
      projectId: 'project-1',
      threadId: 'thread-1',
      turnId: 'turn-2',
    })
    expect(calls).toEqual(['accepted', 'follow'])
  })

  it('waits for a newly created thread before navigating to it', async () => {
    bridge.fetchThread
      .mockRejectedValueOnce({ status: 404 })
      .mockResolvedValueOnce({ thread: { id: 'thread-1', turns: [] }, eventCursor: 0 })
    const host = {
      target: { projectId: null, threadId: null },
      followTurn: vi.fn(),
      retry: vi.fn(),
      navigateToThread: vi.fn(),
      onTurnAccepted: vi.fn(),
    }
    const { result } = renderHook(() =>
      useThreadComposerController({ userId: 'user-1', host, runtimeReady: true, working: false }),
    )

    await act(async () => result.current.actions.submit('Create a report.'))

    expect(bridge.fetchThread).toHaveBeenCalledTimes(2)
    expect(host.onTurnAccepted).toHaveBeenCalledWith({
      projectId: null,
      threadId: 'thread-1',
      turnId: 'turn-1',
    })
    expect(host.navigateToThread).toHaveBeenCalledWith({
      projectId: null,
      threadId: 'thread-1',
      turnId: 'turn-1',
    })
  })

  it('does not load Skills until Codex is ready', async () => {
    const host = {
      target: { projectId: null, threadId: null },
      followTurn: vi.fn(),
      retry: vi.fn(),
      navigateToThread: vi.fn(),
      onTurnAccepted: vi.fn(),
    }
    const { result, rerender } = renderHook(
      ({ runtimeReady }) =>
        useThreadComposerController({ userId: 'user-1', host, runtimeReady, working: false }),
      { initialProps: { runtimeReady: false } },
    )

    expect(bridge.fetchSkills).not.toHaveBeenCalled()
    expect(result.current.viewModel.skills).toEqual({ status: 'ready', items: [] })

    rerender({ runtimeReady: true })
    await waitFor(() => expect(bridge.fetchSkills).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(result.current.viewModel.skills.status).toBe('ready'))
  })
})
