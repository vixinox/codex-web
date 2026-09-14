import type { ComposerActions, ComposerViewModel } from '@/app/chat/model/composer-types'
import type { ChatActivity, ChatBlock, ChatThreadPresentation } from '@/app/chat/model/types'
import type {
  WorkspaceProject,
  WorkspaceSidebarModel,
  WorkspaceThread,
} from '@/app/workspace/model/types'

import {
  COMMAND_FIXTURES,
  DIFF_FIXTURES,
  EDIT_ACTIVITY_FIXTURES,
  REAL_CHAT_ASSISTANT_STEPS,
  type MockPlaybackStep,
} from './fixtures/real-chat-fixtures'

export const MOCK_THREAD_ID = 'mock-real-chat'

const makeThreads = (prefix: string, titles: readonly string[]): WorkspaceThread[] =>
  titles.map((title, index) => ({
    id: `${prefix}-${index + 1}`,
    title,
    status: 'idle',
    updatedAt: Date.now() - (index + 1) * 1000 * 60 * 36,
  }))

export const MOCK_THREADS: readonly WorkspaceThread[] = [
  {
    id: MOCK_THREAD_ID,
    title: '实现白板离线同步模块',
    status: 'active',
    updatedAt: Date.now(),
  },
  ...makeThreads('root', ['协作事件协议兼容层', '断线恢复与冲突处理']),
]

const MOCK_PROJECT_FIXTURES = [
  {
    id: 'project-codex-web',
    name: 'codex-web',
    threads: makeThreads('codex-web', [
      '实现白板离线同步模块',
      '离线操作队列持久化',
      '白板事件流重连',
    ]),
  },
  {
    id: 'project-sandbox',
    name: 'guest-sandbox',
    threads: makeThreads('guest-sandbox', [
      '事件排序与幂等 middleware',
      '旧客户端快照降级',
      '同步协议集成测试',
    ]),
  },
  {
    id: 'project-protocol',
    name: 'protocol-lab',
    threads: makeThreads('protocol-lab', [
      '协作事件版本协商',
      '客户端 reducer 状态机',
      '跨部门事件投影',
    ]),
  },
] as const

export function createMockSidebarModel(): WorkspaceSidebarModel {
  return {
    status: 'ready',
    projects: MOCK_PROJECT_FIXTURES.map((project): WorkspaceProject => {
      const threads: WorkspaceProject['threads'] = { status: 'ready', items: project.threads }
      return Object.assign({}, project, { threads })
    }),
    rootThreads: {
      status: 'ready',
      items: MOCK_THREADS,
    },
  }
}

export const MOCK_COMPOSER: ComposerViewModel = {
  draft: '',
  model: 'gpt-5.6-sol',
  effort: 'medium',
  collaborationMode: 'plan',
  submitting: false,
  working: false,
  error: null,
  skills: { status: 'ready', items: [] },
  selectedSkills: [],
}

export function createMockComposerActions(
  setDraft: (value: string) => void,
  submit: (value: string) => Promise<void>,
  setModel: (value: ComposerViewModel['model']) => void,
  setEffort: (value: ComposerViewModel['effort']) => void,
  setCollaborationMode: (value: ComposerViewModel['collaborationMode']) => void,
): ComposerActions {
  return {
    setDraft,
    submit,
    setModel,
    setEffort,
    setCollaborationMode,
    retrySkills: () => undefined,
    onCommand: () => undefined,
  }
}

export function createMockBlocks(): ChatBlock[] {
  const finalSummary = REAL_CHAT_ASSISTANT_STEPS.at(-1)
  const initialBlocks: ChatBlock[] = [
    {
      id: 'mock-user-request',
      type: 'user',
      content: [
        {
          type: 'text',
          text: '把白板同步模块做完，按文档规范。',
        },
      ],
    },
    {
      id: REAL_CHAT_ASSISTANT_STEPS[0].id,
      type: 'assistant',
      text: REAL_CHAT_ASSISTANT_STEPS[0].text ?? '',
    },
  ]
  return initialBlocks.concat(MOCK_PLAYBACK_STEPS.map(createPlaybackBlock)).concat(
    finalSummary?.text
      ? [
          {
            id: finalSummary.id,
            type: 'assistant' as const,
            text: finalSummary.text,
            final: true,
          },
        ]
      : [],
  )
}

export function createMockThread(): ChatThreadPresentation {
  const blocks = createMockBlocks()
  const completedAt = Date.now()
  return {
    id: MOCK_THREAD_ID,
    projectId: null,
    title: '实现白板离线同步模块',
    modelProvider: 'gpt-5.6-sol',
    updatedAt: Date.now(),
    isBusy: false,
    turns: [
      {
        id: 'mock-turn-1',
        status: 'completed',
        blocks,
        startedAt: completedAt - 13 * 60 * 1000 - 42 * 1000,
        completedAt,
        durationMs: 13 * 60 * 1000 + 42 * 1000,
      },
    ],
  }
}

export function createPlaybackBlock(step: MockPlaybackStep): ChatBlock {
  if (step.kind === 'assistant') return { id: step.id, type: 'assistant', text: step.text ?? '' }
  const activity: ChatActivity = {
    id: step.id,
    sourceType: step.kind,
    kind: step.kind,
    title: step.title,
    detail: step.detail,
    status: step.status ?? 'completed',
    command: step.command,
    commandStatus: step.commandStatus,
    exitCode: step.exitCode,
    durationMs: step.durationMs,
    output: step.output,
    changes: step.changes,
    aggregatedDiff: step.aggregatedDiff,
    meta: step.meta,
  }
  return { id: `activity-${step.id}`, type: 'activity', kind: step.kind, activities: [activity] }
}

export const MOCK_PLAYBACK_STEPS: readonly MockPlaybackStep[] = [
  REAL_CHAT_ASSISTANT_STEPS[1],
  COMMAND_FIXTURES[0],
  COMMAND_FIXTURES[1],
  COMMAND_FIXTURES[2],
  EDIT_ACTIVITY_FIXTURES[0],
  DIFF_FIXTURES[0],
  REAL_CHAT_ASSISTANT_STEPS[2],
  EDIT_ACTIVITY_FIXTURES[1],
  EDIT_ACTIVITY_FIXTURES[2],
  DIFF_FIXTURES[1],
  EDIT_ACTIVITY_FIXTURES[3],
  EDIT_ACTIVITY_FIXTURES[4],
  EDIT_ACTIVITY_FIXTURES[5],
  REAL_CHAT_ASSISTANT_STEPS[3],
  DIFF_FIXTURES[2],
  EDIT_ACTIVITY_FIXTURES[6],
  EDIT_ACTIVITY_FIXTURES[7],
  EDIT_ACTIVITY_FIXTURES[8],
  EDIT_ACTIVITY_FIXTURES[9],
  EDIT_ACTIVITY_FIXTURES[10],
  EDIT_ACTIVITY_FIXTURES[11],
  EDIT_ACTIVITY_FIXTURES[12],
  COMMAND_FIXTURES[3],
  COMMAND_FIXTURES[4],
  REAL_CHAT_ASSISTANT_STEPS[4],
  COMMAND_FIXTURES[5],
  COMMAND_FIXTURES[6],
  COMMAND_FIXTURES[7],
  EDIT_ACTIVITY_FIXTURES[13],
  COMMAND_FIXTURES[8],
]
