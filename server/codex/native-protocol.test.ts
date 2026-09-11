import assert from 'node:assert/strict'
import test from 'node:test'

import { projectNativeMessage, projectNativeThread } from './native-protocol.js'

test('keeps native item lifecycle nesting', () => {
  const result = projectNativeMessage({
    method: 'item/completed',
    params: {
      threadId: 'thread-1',
      turnId: 'turn-1',
      item: { id: 'item-1', type: 'agentMessage', text: 'done', phase: 'final_answer' },
    },
  })
  assert.equal(result.ok, true)
  if (result.ok)
    assert.deepEqual(result.value.params!.item, {
      id: 'item-1',
      type: 'agentMessage',
      text: 'done',
      phase: 'final_answer',
    })
})

test('rejects unknown events instead of passing opaque payloads to the browser', () => {
  assert.deepEqual(
    projectNativeMessage({ method: 'future/method', params: { apiKey: 'secret' } }),
    {
      ok: false,
      code: 'INVALID_MESSAGE',
    },
  )
})

test('projects only supported Thread model and reasoning settings', () => {
  assert.deepEqual(
    projectNativeThread({
      id: 'thread-1',
      model: 'gpt-5.6-terra',
      reasoningEffort: 'high',
      modelProvider: 'openai',
      cwd: 'C:/private',
      turns: [],
    }),
    {
      id: 'thread-1',
      model: 'gpt-5.6-terra',
      reasoningEffort: 'high',
      modelProvider: 'openai',
      turns: [],
    },
  )
  assert.deepEqual(
    projectNativeThread({
      id: 'thread-2',
      model: 'future-model',
      reasoningEffort: 'extreme',
      turns: [],
    }),
    { id: 'thread-2', turns: [] },
  )
})

test('projects Thread settings updates without runtime or filesystem fields', () => {
  assert.deepEqual(
    projectNativeMessage({
      method: 'thread/settings/updated',
      params: {
        threadId: 'thread-1',
        threadSettings: {
          model: 'gpt-5.6-luna',
          effort: 'low',
          cwd: 'C:/private',
          modelProvider: 'secret-provider',
          sandboxPolicy: { type: 'dangerFullAccess' },
          apiKey: 'secret',
        },
      },
    }),
    {
      ok: true,
      value: {
        method: 'thread/settings/updated',
        params: {
          threadId: 'thread-1',
          model: 'gpt-5.6-luna',
          reasoningEffort: 'low',
        },
      },
    },
  )
  assert.deepEqual(
    projectNativeMessage({
      method: 'thread/settings/updated',
      params: {
        threadId: 'thread-1',
        threadSettings: { model: 'x'.repeat(65), effort: 'extreme' },
      },
    }),
    {
      ok: true,
      value: { method: 'thread/settings/updated', params: { threadId: 'thread-1' } },
    },
  )
})

test('preserves safe token usage on completed and failed turns', () => {
  for (const method of ['turn/completed', 'turn/failed']) {
    const result = projectNativeMessage({
      method,
      params: {
        threadId: 'thread-1',
        turn: { id: 'turn-1', status: 'completed', items: [] },
        tokenUsage: {
          modelContextWindow: 128000,
          last: { inputTokens: 10, outputTokens: 4, reasoningOutputTokens: 2, totalTokens: 14 },
          total: {
            inputTokens: 100,
            outputTokens: 40,
            reasoningOutputTokens: 20,
            totalTokens: 140,
            apiKey: 'secret',
          },
        },
      },
    })
    assert.deepEqual(result, {
      ok: true,
      value: {
        method,
        params: {
          threadId: 'thread-1',
          turn: { id: 'turn-1', status: 'completed', items: [] },
          tokenUsage: {
            modelContextWindow: 128000,
            last: { inputTokens: 10, outputTokens: 4, reasoningOutputTokens: 2, totalTokens: 14 },
            total: {
              inputTokens: 100,
              outputTokens: 40,
              reasoningOutputTokens: 20,
              totalTokens: 140,
            },
          },
        },
      },
    })
  }
})

test('allows completed turns without token usage', () => {
  assert.deepEqual(
    projectNativeMessage({
      method: 'turn/completed',
      params: {
        threadId: 'thread-1',
        turn: { id: 'turn-1', status: 'completed', items: [] },
      },
    }),
    {
      ok: true,
      value: {
        method: 'turn/completed',
        params: {
          threadId: 'thread-1',
          turn: { id: 'turn-1', status: 'completed', items: [] },
        },
      },
    },
  )
})

test('projects bridge questionnaire answers through the same safe event boundary', () => {
  assert.deepEqual(
    projectNativeMessage({
      method: 'webcodex/userInput/answered',
      params: {
        threadId: 'thread-1',
        requestId: 42,
        answers: {
          choice: { answers: ['First', 'api_key=secret'] },
          invalid: { answers: [false] },
        },
      },
    }),
    {
      ok: true,
      value: {
        method: 'webcodex/userInput/answered',
        params: {
          threadId: 'thread-1',
          requestId: 42,
          answers: {
            choice: { answers: ['First', 'api_key=[redacted]'] },
            invalid: { answers: [] },
          },
        },
      },
    },
  )
})

test('projects thread history without paths, git metadata, or opaque tool payloads', () => {
  const thread = projectNativeThread(
    {
      id: 'thread-1',
      cwd: 'C:/workspace/project/src',
      path: 'C:/private/rollout.jsonl',
      gitInfo: { originUrl: 'https://private.example/repo' },
      preview: 'C:/workspace/project/private.txt',
      modelProvider: 'openai',
      turns: [],
    },
    'C:/workspace/project',
  )
  assert.deepEqual(thread, {
    id: 'thread-1',
    preview: '<path>',
    modelProvider: 'openai',
    turns: [],
  })
})

test('rejects invalid envelope and thread shapes', () => {
  assert.equal(projectNativeMessage({ method: 'warning', params: [] }).ok, false)
  assert.equal(projectNativeMessage({ params: {} }).ok, false)
  assert.equal(projectNativeThread(null), undefined)
})

test('projects complete 0.147.0 thread metadata and user messages', () => {
  const thread = projectNativeThread(
    {
      id: 'thread-1',
      cwd: 'C:/workspace/project',
      preview: 'Hello',
      cliVersion: '0.147.0',
      createdAt: 1,
      updatedAt: 2,
      modelProvider: 'openai',
      ephemeral: false,
      sessionId: 'thread-1',
      source: 'appServer',
      status: { type: 'idle' },
      gitInfo: { branch: 'main', originUrl: null, sha: 'abc' },
      section: { id: 'section-1', name: 'Main' },
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              id: 'item-1',
              type: 'userMessage',
              clientId: null,
              content: [{ type: 'text', text: 'Hello' }],
            },
          ],
        },
      ],
    },
    'C:/workspace/project',
  )
  assert.ok(thread)
  assert.equal(thread.cwd, undefined)
  assert.equal(thread.path, undefined)
  assert.equal(thread.gitInfo, undefined)
  const turns = thread.turns as Array<{ items: unknown[] }>
  assert.deepEqual(turns[0]?.items[0], {
    id: 'item-1',
    type: 'userMessage',
    content: [{ type: 'text', text: 'Hello' }],
  })
})

test('keeps command output and file diffs readable while redacting paths and bounding content', () => {
  const result = projectNativeThread(
    {
      id: 'thread-1',
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              id: 'command',
              type: 'commandExecution',
              command: '"C:/Program Files/PowerShell/pwsh.exe" -Command "Get-ChildItem"',
              aggregatedOutput: 'C:/workspace/private.txt',
              cwd: 'C:/workspace',
              status: 'completed',
              exitCode: 0,
            },
            {
              id: 'change',
              type: 'fileChange',
              status: 'completed',
              changes: [
                {
                  path: 'C:/workspace/src/a.ts',
                  kind: { type: 'update' },
                  diff: '--- C:/workspace/src/a.ts',
                },
              ],
            },
            { id: 'reasoning', type: 'reasoning', summary: ['safe'], encrypted_content: 'secret' },
            {
              id: 'tool',
              type: 'mcpToolCall',
              server: 'mcp',
              tool: 'read',
              status: 'completed',
              arguments: { secret: true },
              result: { text: 'done' },
              mcpAppResourceUri: 'file:///private',
            },
          ],
        },
      ],
    },
    'C:/workspace',
  )
  assert.ok(result)
  const turns = result.turns as Array<{ items: Array<Record<string, unknown>> }>
  const items = turns[0].items
  assert.deepEqual(items[0], {
    id: 'command',
    type: 'commandExecution',
    command: '"pwsh" -Command "Get-ChildItem"',
    aggregatedOutput: '<path>',
    status: 'completed',
    exitCode: 0,
  })
  assert.deepEqual(items[1], {
    id: 'change',
    type: 'fileChange',
    status: 'completed',
    changes: [{ path: 'src/a.ts', kind: { type: 'update' }, diff: '--- <path>' }],
  })
  assert.deepEqual(items[2], { id: 'reasoning', type: 'reasoning', summary: ['safe'] })
  assert.deepEqual(items[3], {
    id: 'tool',
    type: 'mcpToolCall',
    server: 'mcp',
    tool: 'read',
    status: 'completed',
    result: 'done',
  })
})

test('projects item lifecycle events with the same item allowlist', () => {
  const result = projectNativeMessage({
    method: 'item/completed',
    params: {
      threadId: 'thread-1',
      turnId: 'turn-1',
      item: {
        id: 'item-1',
        type: 'imageGeneration',
        result: 'done',
        savedPath: 'C:/private/image.png',
        status: 'completed',
      },
    },
  })
  assert.deepEqual(result, {
    ok: true,
    value: {
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: { id: 'item-1', type: 'imageGeneration', result: 'done', status: 'completed' },
      },
    },
  })
})
