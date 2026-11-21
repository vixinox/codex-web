import {
  createConversationSnapshot, type ConversationId, type TurnId, type MessageId,
  type MessagePartId, type ActivityId, type InteractionId, type SourceId, type SourceEventId,
  type ConversationChange, type ConversationSnapshot,
} from '@codex-web/conversation'
import type { Scenario, ScenarioStep } from './replay'

const cid = 'demo-conversation' as ConversationId
const tid = 'demo-turn' as TurnId
const mid = 'demo-answer' as MessageId
const pid = 'demo-text' as MessagePartId
const aid = 'demo-command' as ActivityId
const iid = 'demo-question' as InteractionId
const initial = (): ConversationSnapshot => ({
  ...createConversationSnapshot(cid), title: 'UI 场景工作台',
  turns: { [tid]: { id: tid, status: 'inProgress', messageIds: ['demo-user' as MessageId, mid], activityIds: [], itemOrder: [{ type: 'message', id: 'demo-user' as MessageId }, { type: 'message', id: mid }] } },
  messages: {
    'demo-user': { id: 'demo-user' as MessageId, turnId: tid, role: 'user', status: 'completed', parts: [{ id: 'user-text' as MessagePartId, type: 'text', text: '分析前端行为，展示本场景的结果。' }] },
    [mid]: { id: mid, turnId: tid, role: 'assistant', status: 'inProgress', parts: [{ id: pid, type: 'text', text: '' }] },
  },
})
function sequence(changes: Omit<ConversationChange, 'identity'>[]): ScenarioStep[] {
  return changes.map((change, index) => ({ at: (index + 1) * 800, kind: 'change', change: { ...change, identity: { sourceId: 'demo' as SourceId, sourceEventId: `event-${index}` as SourceEventId, receivedAt: '2026-01-01T00:00:00Z', applicationSequence: index + 1 } } as ConversationChange }))
}
// Preserve discriminated input types rather than accepting arbitrary raw payloads.
const changes = (...values: Array<ConversationChange extends infer C ? C extends ConversationChange ? Omit<C, 'identity'> : never : never>) => sequence(values)
const text = (value: string) => ({ type: 'message.textDelta' as const, messageId: mid, partId: pid, delta: value })
const end = (status: 'completed' | 'failed' | 'cancelled' = 'completed') => ({ type: 'turn.statusChanged' as const, turnId: tid, status })
const question = (blocking: boolean) => ({ type: 'interaction.opened' as const, interaction: { id: iid, turnId: tid, kind: 'userInput' as const, status: 'pending' as const, details: { kind: 'userInput' as const, blocking, questions: [{ id: 'scope', prompt: '先检查哪个部分？', options: [{ id: 'chat', label: '会话与输入区' }, { id: 'motion', label: '动画与滚动' }] }] } } })
function scenario(id: string, name: string, steps: ScenarioStep[], description: string): Scenario {
  return { id, name, initial: initial(), steps, description, source: 'packages/app/src/app/chat/transcript/thread-assets.tsx' }
}
export const scenarios: Scenario[] = [
  scenario('streaming-markdown', '流式文字与 Markdown', changes(text('我会先检查状态流。\n\n'), text('```ts\nconst state = '), text('reduce(snapshot, change)\n```\n\n'), text('然后检查 **UI 动画**。'), end()), '观察不完整代码块到完整 Markdown 的变化。'),
  scenario('no-final', '完成但无 final phase', changes(text('这条回复没有 final phase，也应始终可读。'), end()), '终态最后一条回复进入主要答复区。'),
  scenario('interrupted', '中断后保留部分回答', changes(text('这是停止前已经收到的部分内容。'), end('cancelled')), '停止后保留正文与过程。'),
  scenario('failed', '失败与已有输出', changes(text('已分析一部分内容。'), end('failed')), '显示失败状态，保留可用输出。'),
  scenario('command-files', '命令与文件变更', changes({ type: 'activity.upserted', activity: { id: aid, turnId: tid, kind: 'commandExecution', status: 'inProgress', command: 'pnpm typecheck' } }, { type: 'activity.outputDelta', activityId: aid, delta: 'Type check passed.' }, { type: 'activity.statusChanged', activityId: aid, status: 'completed' }, { type: 'activity.upserted', activity: { id: 'file' as ActivityId, turnId: tid, kind: 'fileChange', status: 'completed', changes: [{ path: 'src/example.ts', kind: 'update', diff: '@@ -1 +1 @@\n-old\n+new' }] } }, text('检查完成，修改了一个文件。'), end()), '折叠命令输出和文件 diff。'),
  scenario('compaction', '上下文压缩', changes({ type: 'activity.upserted', activity: { id: aid, turnId: tid, kind: 'contextCompaction', status: 'inProgress' } }, { type: 'activity.statusChanged', activityId: aid, status: 'completed' }, text('上下文已压缩。'), end()), '压缩生命周期与普通运行反馈互不重复。'),
  scenario('question-blocking', '阻塞问卷', changes(question(true)), '处理问卷后继续；关闭操作表示停止本轮。'),
  scenario('question-optional', '非阻塞问卷与输入', changes(question(false)), '问卷显示时普通输入仍存在。'),
  scenario('question-history', '多次问答与过期', changes(question(false), { type: 'interaction.resolved', interactionId: iid, outcome: { kind: 'answers', answers: { scope: ['会话与输入区'] } } }, { type: 'interaction.opened', interaction: { ...question(false).interaction, id: 'question-2' as InteractionId } }, { type: 'interaction.cancelled', interactionId: 'question-2' as InteractionId, status: 'expired' }, text('保留两次问答记录。'), end()), '展开过程查看回答和过期状态。'),
  scenario('plan', '计划交付与执行入口', changes({ type: 'turn.planUpdated', turnId: tid, plan: { steps: [{ step: '收敛状态', status: 'pending' }, { step: '验证展示', status: 'pending' }] } }, { type: 'activity.upserted', activity: { id: aid, turnId: tid, kind: 'plan', status: 'completed', output: '先收敛状态，再验证展示。' } }, end()), '计划确认是本地演示操作，不调用真实命令。'),
  scenario('recovery', '重连错误与快照恢复', [{ at: 500, kind: 'error', message: '连接中断；保留已接收内容。' }, { at: 1500, kind: 'snapshot', snapshot: { ...initial(), title: '已重新同步' } }], '重新读取快照，不重复播放历史内容。'),
  { ...scenario('loading-error', '首次加载失败', [{ at: 800, kind: 'error', message: '无法读取会话。可以重置并重试。' }], '加载错误可达，不被 runtime 占位吞掉。'), loading: true },
  scenario('pending', '发送事务精确关联', [{ at: 300, kind: 'pending', pending: { clientTurnId: 'local-submit', optimisticThreadId: cid, nativeThreadId: cid, projectId: null, text: '本地消息', startedAt: 0 } }, { at: 1000, kind: 'pending', pending: { clientTurnId: 'local-submit', optimisticThreadId: cid, nativeThreadId: cid, nativeTurnId: tid, accepted: true, projectId: null, text: '本地消息', startedAt: 0 } }, ...changes(text('已按 Turn ID 关联。'), end()).map((step) => ({ ...step, at: step.at + 1500 }))], '接受前独立显示；仅用明确返回的 Turn ID 关联。'),
  scenario('resources-agents', '资源与 Agent 摘要', changes({ type: 'message.partAdded', messageId: mid, part: { id: 'image' as MessagePartId, type: 'image', resourceId: 'demo-image' } }, { type: 'activity.upserted', activity: { id: aid, turnId: tid, kind: 'collabAgentToolCall', status: 'completed' } }, { type: 'agentLink.upserted', link: { id: 'agent-link', parentConversationId: cid, activityId: aid, turnId: tid, task: '检查状态流', status: 'completed' } }, text('资源身份和 Agent 任务已保留。'), end()), '首版仅摘要，不加载远程资源或提供 Agent 详情页。'),
]
