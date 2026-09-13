import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { composerStore, type ComposerPreferences } from '@/app/chat/composer/composer-store'
import { GUEST_COMPOSER_CAPABILITIES } from '@/app/chat/composer/composer-capabilities'
import { useComposerController } from './use-composer-controller'
import type { ComposerRuntimeAdapter } from './composer-adapter'

const skill = {
  handle: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  name: 'pdf',
  displayName: 'PDF',
  description: 'Create PDFs',
  scope: 'system' as const,
}

function createAdapter(overrides: Partial<ComposerRuntimeAdapter> = {}): ComposerRuntimeAdapter {
  return {
    capabilities: GUEST_COMPOSER_CAPABILITIES,
    selection: {
      read: () => ({ model: 'gpt-5.6-sol', effort: 'medium', collaborationMode: 'default' }),
      write: vi.fn(),
    },
    listSkills: vi.fn(async () => [skill]),
    threads: {
      listThreads: vi.fn(async () => []),
      createThread: vi.fn(async () => ({
        threadId: 'thread-1',
        turnId: 'turn-1',
        projectId: null,
      })),
      readThread: vi.fn(async () => ({
        thread: { id: 'thread-1', turns: [] },
        eventCursor: 0,
      })),
      readThreadStatus: vi.fn(),
      startTurn: vi.fn(async () => ({ turnId: 'turn-2' })),
      cancelTurn: vi.fn(async () => undefined),
      compactThread: vi.fn(async () => undefined),
      subscribe: vi.fn(() => () => undefined),
    },
    ...overrides,
  }
}

describe('shared composer controller', () => {
  beforeEach(() => {
    composerStore.scopes = {}
  })

  it('creates a Thread through the injected adapter and never a fixed endpoint', async () => {
    const adapter = createAdapter()
    const onThreadCreated = vi.fn()
    const { result } = renderHook(() =>
      useComposerController({
        userId: 'user-1',
        adapter,
        host: {
          target: { projectId: null, threadId: null },
          onTurnAccepted: vi.fn(),
          onThreadCreated,
        },
        runtimeReady: true,
        working: false,
      }),
    )

    await waitFor(() => expect(result.current.viewModel.skills.status).toBe('ready'))
    await act(async () => result.current.actions.submit('Create a report.'))

    expect(adapter.threads.createThread).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Create a report.', skillHandles: [] }),
      expect.any(AbortSignal),
    )
    expect(onThreadCreated).toHaveBeenCalledWith({
      projectId: null,
      threadId: 'thread-1',
      turnId: 'turn-1',
    })
    expect(result.current.viewModel.draft).toBe('')
  })

  it('carries the New Chat model and effort into the newly created Thread before navigation', async () => {
    let stored: ComposerPreferences = {
      model: 'gpt-5.6-sol',
      effort: 'medium',
      collaborationMode: 'default',
    }
    const adapter = createAdapter({
      selection: {
        read: () => ({ ...stored }),
        write: vi.fn((_userId, target, preferences) => {
          if (target.threadId) stored = { ...preferences }
        }),
      },
    })
    let rerender:
      | ((props: { threadId: string | null; model: 'gpt-5.6-sol'; effort: 'low' }) => void)
      | undefined
    const { result, rerender: rerenderHook } = renderHook(
      ({
        threadId,
        model,
        effort,
      }: {
        threadId: string | null
        model: 'gpt-5.6-sol'
        effort: 'low'
      }) => {
        rerender = (next) => rerenderHook(next)
        return useComposerController({
          userId: 'user-1',
          adapter,
          host: {
            target: { projectId: null, threadId },
            onTurnAccepted: vi.fn(),
            onThreadCreated: () =>
              rerender?.({ threadId: 'thread-1', model: 'gpt-5.6-sol', effort: 'low' }),
          },
          runtimeReady: true,
          working: false,
          threadSelection: threadId ? { model, reasoningEffort: effort } : undefined,
        })
      },
      { initialProps: { threadId: null, model: 'gpt-5.6-sol', effort: 'low' } },
    )

    act(() => {
      result.current.actions.setModel('gpt-5.6-terra')
      result.current.actions.setEffort('medium')
    })
    await waitFor(() => expect(result.current.viewModel.model).toBe('gpt-5.6-terra'))
    await act(async () => result.current.actions.submit('Use Terra.'))

    expect(adapter.threads.createThread).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-5.6-terra', reasoningEffort: 'medium' }),
      expect.any(AbortSignal),
    )
    await waitFor(() => expect(result.current.viewModel.model).toBe('gpt-5.6-terra'))
    expect(result.current.viewModel.effort).toBe('medium')
  })

  it('starts a Turn on an existing Thread and clears the submitted draft and skills', async () => {
    const adapter = createAdapter()
    const onTurnFollowed = vi.fn()
    const { result } = renderHook(() =>
      useComposerController({
        userId: 'user-1',
        adapter,
        host: {
          target: { projectId: null, threadId: 'thread-1' },
          activeTurnId: 'turn-1',
          onTurnAccepted: vi.fn(),
          onTurnFollowed,
        },
        runtimeReady: true,
        working: true,
      }),
    )

    await waitFor(() => expect(result.current.viewModel.skills.status).toBe('ready'))
    act(() => result.current.actions.setDraft('Continue.', [skill]))
    await waitFor(() => expect(result.current.viewModel.selectedSkills).toEqual([skill]))
    await act(async () => result.current.actions.submit('Continue.'))

    expect(adapter.threads.startTurn).toHaveBeenCalledWith(
      'thread-1',
      expect.objectContaining({ skillHandles: [skill.handle] }),
      expect.any(AbortSignal),
    )
    expect(onTurnFollowed).toHaveBeenCalledWith({
      projectId: null,
      threadId: 'thread-1',
      turnId: 'turn-2',
    })
    await waitFor(() => expect(result.current.viewModel.selectedSkills).toEqual([]))
  })

  it('does not treat an opaque accepted Turn handle as a native transcript id', async () => {
    const adapter = createAdapter({ acceptedTurnIdIsNative: false })
    const onPendingChange = vi.fn()
    const { result } = renderHook(() =>
      useComposerController({
        userId: 'user-1',
        adapter,
        host: {
          target: { projectId: null, threadId: 'thread-1' },
          onTurnAccepted: vi.fn(),
        },
        runtimeReady: true,
        working: false,
        onPendingChange,
      }),
    )

    await act(async () => result.current.actions.submit('Continue.'))

    expect(onPendingChange).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ nativeTurnId: expect.anything() }),
      'user:user-1\0thread:<root>\0thread-1',
    )
  })

  it('cancels the working Turn through the composition when it owns the active Turn', async () => {
    const adapter = createAdapter()
    const cancelActiveTurn = vi.fn(async () => undefined)
    const onTurnCancelled = vi.fn()
    const { result } = renderHook(() =>
      useComposerController({
        userId: 'user-1',
        adapter,
        host: {
          target: { projectId: null, threadId: 'thread-1' },
          activeTurnId: 'turn-1',
          cancelActiveTurn,
          onTurnAccepted: vi.fn(),
          onTurnCancelled,
        },
        runtimeReady: true,
        working: true,
      }),
    )

    await act(async () => result.current.actions.stop?.())

    expect(cancelActiveTurn).toHaveBeenCalledOnce()
    expect(adapter.threads.cancelTurn).not.toHaveBeenCalled()
    expect(onTurnCancelled).toHaveBeenCalledOnce()
  })

  it('exposes the adapter capability config to the renderer unchanged', async () => {
    const adapter = createAdapter({
      capabilities: { ...GUEST_COMPOSER_CAPABILITIES, contextUsage: false },
    })
    const { result } = renderHook(() =>
      useComposerController({
        userId: 'user-1',
        adapter,
        host: { target: { projectId: null, threadId: null }, onTurnAccepted: vi.fn() },
        runtimeReady: true,
        working: false,
      }),
    )

    expect(result.current.capabilities).toBe(adapter.capabilities)
  })

  it('keeps New Chat and Thread state isolated per scope', async () => {
    const adapter = createAdapter()
    const { result, rerender } = renderHook(
      ({ threadId }: { threadId: string | null }) =>
        useComposerController({
          userId: 'user-1',
          adapter,
          host: { target: { projectId: null, threadId }, onTurnAccepted: vi.fn() },
          runtimeReady: true,
          working: false,
        }),
      { initialProps: { threadId: null as string | null } },
    )

    await waitFor(() => expect(result.current.viewModel.skills.status).toBe('ready'))
    act(() => result.current.actions.setDraft('new chat draft'))
    await waitFor(() => expect(result.current.viewModel.draft).toBe('new chat draft'))

    rerender({ threadId: 'thread-1' })
    await waitFor(() => expect(result.current.viewModel.draft).toBe(''))
    act(() => result.current.actions.setDraft('thread draft'))
    await waitFor(() => expect(result.current.viewModel.draft).toBe('thread draft'))

    rerender({ threadId: null })
    await waitFor(() => expect(result.current.viewModel.draft).toBe('new chat draft'))
  })

  it('syncs each Thread truth without overwriting a later manual selection from a stale snapshot', async () => {
    const adapter = createAdapter()
    const { result, rerender } = renderHook(
      ({ threadId, model, effort }) =>
        useComposerController({
          userId: 'user-1',
          adapter,
          host: { target: { projectId: null, threadId }, onTurnAccepted: vi.fn() },
          runtimeReady: true,
          working: false,
          threadSelection: { model, reasoningEffort: effort },
        }),
      {
        initialProps: {
          threadId: 'thread-a',
          model: 'gpt-5.6-terra' as const,
          effort: 'low' as const,
        },
      },
    )

    await waitFor(() => expect(result.current.viewModel.model).toBe('gpt-5.6-terra'))
    expect(result.current.viewModel.effort).toBe('low')

    act(() => result.current.actions.setModel('gpt-5.5'))
    await waitFor(() => expect(result.current.viewModel.model).toBe('gpt-5.5'))
    rerender({ threadId: 'thread-a', model: 'gpt-5.6-terra', effort: 'low' })
    expect(result.current.viewModel.model).toBe('gpt-5.5')

    rerender({ threadId: 'thread-b', model: 'gpt-5.6-terra', effort: 'medium' })
    await waitFor(() => expect(result.current.viewModel.model).toBe('gpt-5.6-terra'))
    expect(result.current.viewModel.effort).toBe('medium')

    rerender({ threadId: 'thread-a', model: 'gpt-5.6-terra', effort: 'low' })
    await waitFor(() => expect(result.current.viewModel.model).toBe('gpt-5.5'))
    expect(result.current.viewModel.effort).toBe('low')
  })

  it('keeps a manual Thread selection after visiting the New Chat scope', async () => {
    const adapter = createAdapter()
    const { result, rerender } = renderHook(
      ({ threadId, model }: { threadId: string | null; model?: 'gpt-5.6-terra' }) =>
        useComposerController({
          userId: 'user-1',
          adapter,
          host: { target: { projectId: null, threadId }, onTurnAccepted: vi.fn() },
          runtimeReady: true,
          working: false,
          threadSelection: model ? { model } : undefined,
        }),
      { initialProps: { threadId: 'thread-a', model: 'gpt-5.6-terra' as const } },
    )

    await waitFor(() => expect(result.current.viewModel.model).toBe('gpt-5.6-terra'))
    act(() => result.current.actions.setModel('gpt-5.5'))
    await waitFor(() => expect(result.current.viewModel.model).toBe('gpt-5.5'))

    rerender({ threadId: null })
    await waitFor(() => expect(result.current.viewModel.model).toBe('gpt-5.6-sol'))
    rerender({ threadId: 'thread-a', model: 'gpt-5.6-terra' })

    await waitFor(() => expect(result.current.viewModel.model).toBe('gpt-5.5'))
  })

  it('persists model and effort together after consecutive preference changes', async () => {
    const adapter = createAdapter()
    const { result } = renderHook(() =>
      useComposerController({
        userId: 'user-1',
        adapter,
        host: { target: { projectId: null, threadId: 'thread-1' }, onTurnAccepted: vi.fn() },
        runtimeReady: true,
        working: false,
      }),
    )

    act(() => {
      result.current.actions.setModel('gpt-5.5')
      result.current.actions.setEffort('high')
    })

    expect(adapter.selection?.write).toHaveBeenLastCalledWith(
      'user-1',
      { projectId: null, threadId: 'thread-1' },
      { model: 'gpt-5.5', effort: 'high', collaborationMode: 'default' },
    )
  })

  it('applies a settings event update without changing the other Thread preference', async () => {
    const adapter = createAdapter({
      capabilities: { ...GUEST_COMPOSER_CAPABILITIES, disabledEfforts: [] },
    })
    const { result, rerender } = renderHook(
      ({ model, effort }) =>
        useComposerController({
          userId: 'user-1',
          adapter,
          host: {
            target: { projectId: null, threadId: 'thread-1' },
            onTurnAccepted: vi.fn(),
          },
          runtimeReady: true,
          working: false,
          threadSelection: { model, reasoningEffort: effort },
        }),
      {
        initialProps: {
          model: 'gpt-5.6-sol' as const,
          effort: 'medium' as const,
        },
      },
    )

    await waitFor(() => expect(result.current.viewModel.effort).toBe('medium'))
    act(() => result.current.actions.setModel('gpt-5.5'))
    await waitFor(() => expect(result.current.viewModel.model).toBe('gpt-5.5'))
    rerender({ model: 'gpt-5.6-sol', effort: 'high' })
    await waitFor(() => expect(result.current.viewModel.effort).toBe('high'))
    expect(result.current.viewModel.model).toBe('gpt-5.5')
  })

  it('persists a changed server model for the current Thread', async () => {
    const adapter = createAdapter()
    const { result, rerender } = renderHook(
      ({ model }) =>
        useComposerController({
          userId: 'user-1',
          adapter,
          host: {
            target: { projectId: null, threadId: 'thread-1' },
            onTurnAccepted: vi.fn(),
          },
          runtimeReady: true,
          working: false,
          threadSelection: { model, reasoningEffort: 'medium' },
        }),
      { initialProps: { model: 'gpt-5.6-sol' as const } },
    )

    await waitFor(() => expect(result.current.viewModel.model).toBe('gpt-5.6-sol'))
    rerender({ model: 'gpt-5.6-terra' as const })

    await waitFor(() => expect(result.current.viewModel.model).toBe('gpt-5.6-terra'))
    expect(adapter.selection?.write).toHaveBeenLastCalledWith(
      'user-1',
      { projectId: null, threadId: 'thread-1' },
      { model: 'gpt-5.6-terra', effort: 'medium', collaborationMode: 'default' },
    )
  })

  it('reports a rejected submission without clearing the draft', async () => {
    const failure = new Error('Selected skills are no longer available')
    const adapter = createAdapter({
      threads: {
        ...createAdapter().threads,
        createThread: vi.fn(async () => {
          throw failure
        }),
      },
    })
    const onError = vi.fn()
    const { result } = renderHook(() =>
      useComposerController({
        userId: 'user-1',
        adapter,
        host: {
          target: { projectId: null, threadId: null },
          onTurnAccepted: vi.fn(),
          onError,
        },
        runtimeReady: true,
        working: false,
      }),
    )

    await waitFor(() => expect(result.current.viewModel.skills.status).toBe('ready'))
    act(() => result.current.actions.setDraft('Create a report.', [skill]))
    await act(async () => result.current.actions.submit('Create a report.'))

    expect(result.current.viewModel.draft).toBe('Create a report.')
    expect(result.current.viewModel.error).toBe('Selected skills are no longer available')
    expect(onError).toHaveBeenCalledWith('Selected skills are no longer available')
  })
})
