import {
  createConversationSnapshot,
  type ConversationId,
  type TurnId,
  type MessageId,
  type MessagePartId,
  type ActivityId,
  type InteractionId,
  type InteractionDetails,
  type SourceId,
  type SourceEventId,
  type Activity,
  type ConversationChange,
  type ConversationSnapshot,
} from '@codex-web/conversation'
import type { Scenario, ScenarioStep } from './replay'

const cid = 'demo-conversation' as ConversationId
const tid = 'demo-turn' as TurnId
const mid = 'demo-answer' as MessageId
const pid = 'demo-text' as MessagePartId
const aid = 'demo-command' as ActivityId
const secondAid = 'demo-command-2' as ActivityId
const compactTurnId = 'demo-compaction-turn' as TurnId
const compactActivityId = 'demo-compaction' as ActivityId
const iid = 'demo-question' as InteractionId
const initial = (): ConversationSnapshot => ({
  ...createConversationSnapshot(cid),
  title: 'UI 场景工作台',
  turns: {
    [tid]: {
      id: tid,
      status: 'inProgress',
      messageIds: ['demo-user' as MessageId, mid],
      activityIds: [],
      itemOrder: [
        { type: 'message', id: 'demo-user' as MessageId },
        { type: 'message', id: mid },
      ],
    },
  },
  messages: {
    'demo-user': {
      id: 'demo-user' as MessageId,
      turnId: tid,
      role: 'user',
      status: 'completed',
      parts: [
        {
          id: 'user-text' as MessagePartId,
          type: 'text',
          text: '分析前端行为，展示本场景的结果。',
        },
      ],
    },
    [mid]: {
      id: mid,
      turnId: tid,
      role: 'assistant',
      status: 'inProgress',
      parts: [{ id: pid, type: 'text', text: '' }],
    },
  },
})
function sequence(changes: Omit<ConversationChange, 'identity'>[]): ScenarioStep[] {
  return changes.map((change, index) => ({
    at: (index + 1) * 800,
    kind: 'change',
    change: {
      ...change,
      identity: {
        sourceId: 'demo' as SourceId,
        sourceEventId: `event-${index}` as SourceEventId,
        receivedAt: '2026-01-01T00:00:00Z',
        applicationSequence: index + 1,
      },
    } as ConversationChange,
  }))
}
// Preserve discriminated input types rather than accepting arbitrary raw payloads.
const changes = (
  ...values: Array<
    ConversationChange extends infer C
      ? C extends ConversationChange
        ? Omit<C, 'identity'>
        : never
      : never
  >
) => sequence(values)
const text = (value: string) => ({
  type: 'message.textDelta' as const,
  messageId: mid,
  partId: pid,
  delta: value,
})
const end = (
  status: 'completed' | 'failed' | 'cancelled' = 'completed',
  failure?: { message: string; details?: string },
) => ({
  type: 'turn.statusChanged' as const,
  turnId: tid,
  status,
  ...(failure ? { failure } : {}),
})
const question = (
  blocking: boolean,
  id = iid,
  questions: Extract<InteractionDetails, { kind: 'userInput' }>['questions'] = [
    {
      id: 'scope',
      prompt: '先检查哪个部分？',
      options: [
        {
          id: 'chat',
          label: '会话与输入区',
          description: '检查消息顺序、问卷状态和输入区是否正确联动。',
        },
        {
          id: 'motion',
          label: '动画与滚动',
          description: '检查状态切换动画、滚动位置和动态内容布局。',
        },
      ],
    },
  ],
) => ({
  type: 'interaction.opened' as const,
  interaction: {
    id,
    turnId: tid,
    kind: 'userInput' as const,
    status: 'pending' as const,
    details: {
      kind: 'userInput' as const,
      blocking,
      questions,
    },
  },
})
function scenario(id: string, name: string, steps: ScenarioStep[], description: string): Scenario {
  return {
    id,
    name,
    initial: initial(),
    steps,
    description,
    source: 'packages/app/src/app/chat/transcript/thread-assets.tsx',
  }
}
function initialWithoutAssistant() {
  const snapshot = initial()
  const turn = snapshot.turns[tid]
  if (turn) {
    turn.messageIds = turn.messageIds.filter((id) => id !== mid)
    turn.itemOrder = turn.itemOrder?.filter((item) => item.id !== mid)
  }
  delete snapshot.messages[mid]
  return snapshot
}
const assistantMessage = (id: string, partId: string, value: string) => ({
  type: 'message.upserted' as const,
  message: {
    id: id as MessageId,
    turnId: tid,
    role: 'assistant' as const,
    status: 'inProgress' as const,
    parts: [{ id: partId as MessagePartId, type: 'text' as const, text: value }],
  },
})
const toolCall = (id: string, activity: Omit<Activity, 'id' | 'turnId'>) => ({
  type: 'activity.upserted' as const,
  activity: { ...activity, id: id as ActivityId, turnId: tid },
})
const toolStatus = (id: string, status: Activity['status']) => ({
  type: 'activity.statusChanged' as const,
  activityId: id as ActivityId,
  status,
})
export const scenarios: Scenario[] = [
  scenario(
    'streaming-markdown',
    '流式文字与 Markdown',
    changes(
      text('多行文本先展示第一段。\n\n第二段与前一段分开呈现。\n\n'),
      text('# 一级标题\n\n## 二级标题\n\n### 三级标题\n\n#### 四级标题\n\n'),
      text(
        '行内支持 **粗体**、*斜体*、~~删除线~~、`代码` 和 [安全链接](https://example.com)。\n\n',
      ),
      text('- 无序列表第一项\n- 第二项\n  - 嵌套项目\n\n1. 有序列表第一项\n2. 第二项\n\n'),
      text('- [x] 已完成任务\n- [ ] 待处理任务\n\n'),
      text('> 多行引用的第一行\n>\n> 第二行引用\n\n'),
      text('| 格式 | 展示 |\n| --- | --- |\n| 表格 | 支持 |\n| 多行 | 渲染 |\n\n'),
      text('---\n\n'),
      text('```ts\nconst state = '),
      text('reduce(snapshot, change)\n```\n\n'),
      text('自动链接也支持：https://example.com。\n\n'),
      end(),
    ),
    '逐步观察多行文本、GFM 格式和代码围栏的流式渲染。',
  ),
  scenario(
    'no-final',
    '完成但无 final phase',
    changes(text('这条回复没有 final phase，也应始终可读。'), end()),
    '终态最后一条回复进入主要答复区。',
  ),
  scenario(
    'interrupted',
    '中断后保留部分回答',
    changes(text('这是停止前已经收到的部分内容。'), end('cancelled')),
    '停止后保留正文与过程。',
  ),
  scenario(
    'failed',
    '失败与已有输出',
    changes(
      text('已分析一部分内容。'),
      end('failed', {
        message: 'Provider returned an error while generating the response.',
        details: JSON.stringify(
          {
            codexErrorInfo: { type: 'HttpConnectionFailed', httpStatusCode: 502 },
            additionalDetails:
              'upstream provider response: 502 Bad Gateway\\nrequest_id=req_demo_failed_01\\nbody={"error":{"message":"temporary upstream overload"}}',
          },
          null,
          2,
        ),
      }),
    ),
    '显示失败状态，保留可用输出。',
  ),
  {
    ...scenario(
      'command-files',
      '正文与多类工具批次交错',
      changes(
        {
          type: 'activity.upserted',
          activity: {
            id: aid,
            turnId: tid,
            kind: 'commandExecution',
            status: 'inProgress',
            command: 'rg -n "showThinking" packages/app/src/app/chat',
          },
        },
        { type: 'activity.outputDelta', activityId: aid, delta: 'thread-assets.tsx: showThinking' },
        assistantMessage(
          'assistant-intro',
          'assistant-intro-text',
          '已定位到流式回答的展示条件，接着确认类型检查和工具输出的布局。\n\n',
        ),
        {
          type: 'activity.upserted',
          activity: {
            id: secondAid,
            turnId: tid,
            kind: 'commandExecution',
            status: 'inProgress',
            command: 'pnpm --filter @codex-web/app typecheck',
          },
        },
        { type: 'activity.outputDelta', activityId: secondAid, delta: 'Typecheck passed.' },
        { type: 'activity.statusChanged', activityId: aid, status: 'completed' },
        assistantMessage(
          'assistant-middle',
          'assistant-middle-text',
          '第一项检查完成，第二项仍在运行。\n\n',
        ),
        { type: 'activity.statusChanged', activityId: secondAid, status: 'completed' },
        {
          type: 'activity.upserted',
          activity: {
            id: 'file' as ActivityId,
            turnId: tid,
            kind: 'fileChange',
            status: 'completed',
            changes: [
              {
                path: 'src/app/chat/transcript/thread-assets.tsx',
                kind: 'update',
                diff: '@@ -1 +1 @@\n-old\n+new',
              },
            ],
          },
        },
        assistantMessage(
          'assistant-batch-intro',
          'assistant-batch-intro-text',
          '第一轮检查结束。接下来追加四次命令调用，包含两次相同的命令，再交叉查询资料、读取资源和委派任务。\n\n',
        ),
        toolCall('batch-command-1', {
          kind: 'commandExecution',
          status: 'inProgress',
          command: 'rg -n "StreamingAssistant" packages/app/src',
        }),
        toolCall('batch-command-2', {
          kind: 'commandExecution',
          status: 'inProgress',
          command: 'rg -n "TranscriptCollapsibleContent" packages/app/src',
        }),
        toolCall('batch-command-3', {
          kind: 'commandExecution',
          status: 'inProgress',
          command: 'rg -n "LegacyAnimation" packages/app/src',
        }),
        toolCall('batch-command-4', {
          kind: 'commandExecution',
          status: 'inProgress',
          command: 'rg -n "LegacyAnimation" packages/app/src',
        }),
        {
          type: 'activity.outputDelta',
          activityId: 'batch-command-2' as ActivityId,
          delta:
            'thread-assets.tsx: TranscriptCollapsibleContent\nthread-block.tsx: TranscriptCollapsibleContent',
        },
        toolStatus('batch-command-2', 'completed'),
        toolCall('batch-command-3', {
          kind: 'commandExecution',
          status: 'failed',
          command: 'rg -n "LegacyAnimation" packages/app/src',
          output: 'No matches found.',
          exitCode: 1,
        }),
        toolCall('batch-search-1', {
          kind: 'webSearch',
          status: 'inProgress',
          title: 'React keyed list component identity',
        }),
        toolCall('batch-search-2', {
          kind: 'webSearch',
          status: 'inProgress',
          title: 'CSS animation prefers-reduced-motion',
        }),
        toolCall('batch-tool-1', {
          kind: 'mcpToolCall',
          status: 'inProgress',
          title: 'docs.read · React reconciliation',
        }),
        toolCall('batch-tool-2', {
          kind: 'dynamicToolCall',
          status: 'inProgress',
          title: 'resources.inspect · animation tokens',
        }),
        assistantMessage(
          'assistant-batch-progress',
          'assistant-batch-progress-text',
          '命令批次已有两项结束，两项仍在运行；资料搜索和资源读取也在并行。\n\n- 保留现有正文的位置与透明度。\n- 新的工具组应按到达顺序追加。\n\n',
        ),
        toolCall('batch-agent-1', { kind: 'collabAgentToolCall', status: 'inProgress' }),
        {
          type: 'agentLink.upserted',
          link: {
            id: 'batch-agent-link-1',
            parentConversationId: cid,
            activityId: 'batch-agent-1' as ActivityId,
            turnId: tid,
            task: '检查正文与工具分组顺序',
            status: 'running',
          },
        },
        toolCall('batch-agent-2', { kind: 'collabAgentToolCall', status: 'inProgress' }),
        {
          type: 'agentLink.upserted',
          link: {
            id: 'batch-agent-link-2',
            parentConversationId: cid,
            activityId: 'batch-agent-2' as ActivityId,
            turnId: tid,
            task: '检查折叠区与动画状态',
            status: 'running',
          },
        },
        toolCall('batch-search-2', {
          kind: 'webSearch',
          status: 'completed',
          title: 'CSS animation prefers-reduced-motion',
          output: '找到 reduced-motion 的样式示例与说明。',
        }),
        toolCall('batch-tool-1', {
          kind: 'mcpToolCall',
          status: 'completed',
          title: 'docs.read · React reconciliation',
          output: '组件身份由父节点、类型和 key 共同决定。',
        }),
        toolStatus('batch-command-1', 'completed'),
        toolStatus('batch-command-4', 'completed'),
        toolStatus('batch-search-1', 'completed'),
        toolCall('batch-tool-2', {
          kind: 'dynamicToolCall',
          status: 'failed',
          title: 'resources.inspect · animation tokens',
          output: 'Resource unavailable: animation-tokens',
        }),
        assistantMessage(
          'assistant-batch-result',
          'assistant-batch-result-text',
          '搜索和命令检查完成，资源读取有一项失败，两项委派仍在运行。继续提交文件变更，并追加一次独立检查。\n\n',
        ),
        toolCall('batch-file-1', {
          kind: 'fileChange',
          status: 'inProgress',
          changes: [
            {
              path: 'src/app/chat/transcript/streaming-assistant.tsx',
              kind: 'update',
              diff: '@@ -1 +1 @@\n-const localHistory = new Set<string>()\n+const history = animatedBlocks ?? localHistory',
            },
          ],
        }),
        toolCall('batch-file-2', {
          kind: 'fileChange',
          status: 'completed',
          changes: [
            {
              path: 'src/app/chat/transcript/animation-notes.md',
              kind: 'add',
              diff: '@@ -0,0 +1,2 @@\n+# Animation notes\n+Keep animation history across message moves.',
            },
          ],
        }),
        toolStatus('batch-file-1', 'completed'),
        toolCall('followup-command', {
          kind: 'commandExecution',
          status: 'inProgress',
          command:
            'pnpm exec oxfmt --check packages/app/src/app/chat/transcript/streaming-assistant.tsx',
        }),
        {
          type: 'agentLink.upserted',
          link: {
            id: 'batch-agent-link-2',
            parentConversationId: cid,
            activityId: 'batch-agent-2' as ActivityId,
            turnId: tid,
            task: '检查折叠区与动画状态',
            status: 'completed',
          },
        },
        toolStatus('batch-agent-2', 'completed'),
        {
          type: 'agentLink.upserted',
          link: {
            id: 'batch-agent-link-1',
            parentConversationId: cid,
            activityId: 'batch-agent-1' as ActivityId,
            turnId: tid,
            task: '检查正文与工具分组顺序',
            status: 'completed',
          },
        },
        toolStatus('batch-agent-1', 'completed'),
        {
          type: 'activity.outputDelta',
          activityId: 'followup-command' as ActivityId,
          delta: 'All matched files use the correct format.',
        },
        toolStatus('followup-command', 'completed'),
        assistantMessage(
          'assistant-summary',
          'assistant-summary-text',
          '本轮模拟完成。\n\n已覆盖 **命令、搜索、通用工具、Agent 和文件变更**，包括同类批次、不同类型连续追加、正文打断分组，以及乱序结束和部分失败。',
        ),
        end(),
      ),
      '观察命令、搜索、MCP/动态工具、Agent、文件变更的批次与混合排列，以及正文穿插、部分失败和乱序结束时的阅读节奏。所有调用均为本地模拟。',
    ),
    initial: initialWithoutAssistant(),
  },
  {
    ...scenario(
      'compaction',
      '上下文压缩',
      [
        {
          at: 800,
          kind: 'change',
          change: {
            type: 'activity.upserted',
            activity: {
              id: compactActivityId,
              turnId: compactTurnId,
              kind: 'contextCompaction',
              status: 'inProgress',
            },
            identity: {
              sourceId: 'demo' as SourceId,
              sourceEventId: 'compaction-start' as SourceEventId,
              receivedAt: '2026-01-01T00:00:00Z',
              applicationSequence: 1,
            },
          },
        },
        {
          at: 800,
          kind: 'change',
          change: {
            type: 'turn.upserted',
            turn: {
              id: compactTurnId,
              status: 'inProgress',
              messageIds: [],
              activityIds: [],
              itemOrder: [],
            },
            identity: {
              sourceId: 'demo' as SourceId,
              sourceEventId: 'compaction-turn-start' as SourceEventId,
              receivedAt: '2026-01-01T00:00:00Z',
              applicationSequence: 2,
            },
          },
        },
        {
          at: 1600,
          kind: 'change',
          change: {
            type: 'activity.statusChanged',
            activityId: compactActivityId,
            status: 'completed',
            identity: {
              sourceId: 'demo' as SourceId,
              sourceEventId: 'compaction-complete' as SourceEventId,
              receivedAt: '2026-01-01T00:00:00Z',
              applicationSequence: 3,
            },
          },
        },
        {
          at: 2400,
          kind: 'change',
          change: {
            type: 'turn.statusChanged',
            turnId: compactTurnId,
            status: 'completed',
            identity: {
              sourceId: 'demo' as SourceId,
              sourceEventId: 'compaction-turn-complete' as SourceEventId,
              receivedAt: '2026-01-01T00:00:00Z',
              applicationSequence: 4,
            },
          },
        },
      ],
      '先展示已有对话，再创建独立的上下文压缩 turn。',
    ),
    initial: (() => {
      const snapshot = initial()
      const turn = snapshot.turns[tid]
      if (turn) {
        turn.status = 'completed'
        turn.messageIds = ['demo-user' as MessageId, mid]
        turn.itemOrder = [
          { type: 'message', id: 'demo-user' as MessageId },
          { type: 'message', id: mid },
        ]
      }
      const answer = snapshot.messages[mid]
      if (answer) {
        answer.status = 'completed'
        answer.phase = 'final_answer'
        answer.parts = [{ id: pid, type: 'text', text: '这是压缩前已经存在的一段对话。' }]
      }
      return snapshot
    })(),
  },
  scenario(
    'question-blocking',
    '阻塞问卷',
    changes(
      question(true),
      question(true, 'demo-question-2' as InteractionId, [
        {
          id: 'priority',
          prompt: '本次检查更关注什么？',
          options: [
            {
              id: 'behavior',
              label: '交互行为',
              description: '关注作答、提交和多轮切换时的操作反馈。',
            },
            {
              id: 'layout',
              label: '布局与可读性',
              description: '关注文字层级、间距以及不同长度内容的排版。',
            },
          ],
        },
        {
          id: 'theme',
          prompt: '优先检查哪种主题？',
          options: [
            { id: 'light', label: '浅色主题', description: '检查明亮背景下的对比度和层次。' },
            { id: 'dark', label: '深色主题', description: '检查深色背景下的文字和边界辨识度。' },
            { id: 'both', label: '两种都检查', description: '对照检查两种主题下的一致性。' },
          ],
        },
      ]),
      question(true, 'demo-question-3' as InteractionId, [
        {
          id: 'history',
          prompt: '已提交的问答记录应如何检查？',
          options: [
            {
              id: 'expand',
              label: '展开核对每轮答案',
              description: '逐条查看问题原文和已提交的回答。',
            },
            {
              id: 'collapse',
              label: '保持折叠，检查摘要',
              description: '确认折叠状态保留清晰的轮次摘要。',
            },
          ],
        },
        {
          id: 'input',
          prompt: '本轮使用哪种回答方式？',
          options: [
            {
              id: 'options',
              label: '使用预设选项',
              description: '从上方提供的回答中选择一项。',
            },
            {
              id: 'custom',
              label: '补充自定义回答',
              description: '输入选项之外的具体说明或观察结果。',
            },
          ],
        },
        { id: 'notes', prompt: '还有哪些需要特别留意的细节？' },
      ]),
      text(
        '三轮询问已完成：首轮 1 个问题，第二轮 2 个问题，第三轮 3 个问题。可展开问答记录核对每轮提交的答案。',
      ),
      end(),
    ).map((step, index) => ({
      ...step,
      ...(index > 0 && index < 4
        ? { afterAnswer: [iid, 'demo-question-2', 'demo-question-3'][index - 1] }
        : {}),
    })),
    '三轮阻塞询问（1 → 2 → 3 个问题），提交当前轮后继续；关闭操作表示停止本轮。',
  ),
  scenario(
    'question-optional',
    '非阻塞问卷与输入',
    changes(question(false)),
    '问卷显示时普通输入仍存在。',
  ),
  scenario(
    'question-history',
    '多次问答与过期',
    changes(
      question(false),
      {
        type: 'interaction.resolved',
        interactionId: iid,
        outcome: { kind: 'answers', answers: { scope: ['会话与输入区'] } },
      },
      {
        type: 'interaction.opened',
        interaction: { ...question(false).interaction, id: 'question-2' as InteractionId },
      },
      {
        type: 'interaction.cancelled',
        interactionId: 'question-2' as InteractionId,
        status: 'expired',
      },
      text('保留两次问答记录。'),
      end(),
    ),
    '展开过程查看回答和过期状态。',
  ),
  scenario(
    'plan',
    '计划交付与执行入口',
    changes(
      {
        type: 'turn.planUpdated',
        turnId: tid,
        plan: {
          steps: [
            { step: '收敛状态', status: 'pending' },
            { step: '验证展示', status: 'pending' },
          ],
        },
      },
      {
        type: 'activity.upserted',
        activity: {
          id: aid,
          turnId: tid,
          kind: 'plan',
          status: 'completed',
          output: '先收敛状态，再验证展示。',
        },
      },
      end(),
    ),
    '计划确认是本地演示操作，不调用真实命令。',
  ),
  scenario(
    'recovery',
    '重连错误与快照恢复',
    [
      { at: 500, kind: 'error', message: '连接中断；保留已接收内容。' },
      { at: 1500, kind: 'snapshot', snapshot: { ...initial(), title: '已重新同步' } },
    ],
    '重新读取快照，不重复播放历史内容。',
  ),
  {
    ...scenario(
      'loading-error',
      '首次加载失败',
      [{ at: 800, kind: 'error', message: '无法读取会话。可以重置并重试。' }],
      '加载错误可达，不被 runtime 占位吞掉。',
    ),
    loading: true,
  },
  scenario(
    'pending',
    '发送事务精确关联',
    [
      {
        at: 300,
        kind: 'pending',
        pending: {
          clientTurnId: 'local-submit',
          optimisticThreadId: cid,
          nativeThreadId: cid,
          projectId: null,
          text: '本地消息',
          startedAt: 0,
        },
      },
      {
        at: 1000,
        kind: 'pending',
        pending: {
          clientTurnId: 'local-submit',
          optimisticThreadId: cid,
          nativeThreadId: cid,
          nativeTurnId: tid,
          accepted: true,
          projectId: null,
          text: '本地消息',
          startedAt: 0,
        },
      },
      ...changes(text('已按 Turn ID 关联。'), end()).map((step) => ({
        ...step,
        at: step.at + 1500,
      })),
    ],
    '接受前独立显示；仅用明确返回的 Turn ID 关联。',
  ),
  scenario(
    'resources-agents',
    '资源与 Agent 摘要',
    changes(
      {
        type: 'message.partAdded',
        messageId: mid,
        part: { id: 'image' as MessagePartId, type: 'image', resourceId: 'demo-image' },
      },
      {
        type: 'activity.upserted',
        activity: { id: aid, turnId: tid, kind: 'collabAgentToolCall', status: 'completed' },
      },
      {
        type: 'agentLink.upserted',
        link: {
          id: 'agent-link',
          parentConversationId: cid,
          activityId: aid,
          turnId: tid,
          task: '检查状态流',
          status: 'completed',
        },
      },
      text('资源身份和 Agent 任务已保留。'),
      end(),
    ),
    '首版仅摘要，不加载远程资源或提供 Agent 详情页。',
  ),
]
