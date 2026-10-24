import type { ChatActivity, ChatFileChange } from '@/app/chat/model/types'

export type MockPlaybackStep = {
  id: string
  kind: ChatActivity['kind'] | 'assistant'
  title: string
  text?: string
  detail?: string
  meta?: string
  command?: string
  output?: string
  commandStatus?: ChatActivity['commandStatus']
  exitCode?: number
  durationMs?: number
  status?: ChatActivity['status']
  changes?: ChatFileChange[]
  aggregatedDiff?: string
}

export const REAL_CHAT_ASSISTANT_STEPS: readonly MockPlaybackStep[] = [
  {
    id: 'assistant-intro',
    kind: 'assistant',
    title: 'Read the constraints first',
    text: '我先不改代码。先读取当前目录和 packages/board-sync 下的 AGENTS.md、开发文档与协议说明，再沿着现有事件流、操作模型和持久化边界追进去。这个任务的关键是兼容已有客户端，而不是单独造一个同步 demo。',
  },
  {
    id: 'assistant-discovery',
    kind: 'assistant',
    title: 'Map the existing sync path',
    text: '文档要求服务端排序、客户端可重放队列和旧客户端快照降级。现有实现已经有画布操作事件和 workspace 版本号，但重连只拉最新快照，且 middleware 会丢掉 clientOperationId。我会先补共享协议类型，再把服务端和客户端接到同一个游标模型上。',
  },
  {
    id: 'assistant-implementation',
    kind: 'assistant',
    title: 'Implement the end-to-end loop',
    text: '共享事件类型、服务端去重/排序和客户端离线队列已完成第一轮接线。现在的重连流程是：客户端发送最后确认游标，服务端返回缺失事件或稳定快照；每个确认都按 clientOperationId 出队，冲突则保留本地操作并显示可解释状态。',
  },
  {
    id: 'assistant-repair',
    kind: 'assistant',
    title: 'Repair the compatibility edge',
    text: 'focused test 暴露了两个边界：重复确认会让队列提前出队，乱序事件会把游标回退。修正 reducer 后，集成测试又发现旧客户端事件投影缺少 snapshotReason 字段；我会在 middleware 的兼容分支补齐它，并保留旧事件名。',
  },
  {
    id: 'assistant-verification',
    kind: 'assistant',
    title: 'Verification',
    text: '模块测试、协议兼容测试和完整类型检查已经跑完。三次失败都来自真实边界：协议字段 lint、乱序/重复操作 reducer、旧客户端快照降级。修复后新模块通过，剩余输出里没有把无关仓库问题伪装成本次改动。',
  },
  {
    id: 'assistant-summary',
    kind: 'assistant',
    title: 'Final summary',
    text: `已完成 packages/board-sync 的端到端离线同步模块。

实现内容：

- 新增共享协作事件 v2 类型，包含 clientOperationId、baseCursor、capabilities、conflict 和 snapshotReason；保留 v1 事件投影。
- 服务端 middleware 按 workspace 版本排序操作，以 clientOperationId 做幂等去重，并为过期游标返回缺失事件或稳定快照。
- 客户端新增持久化 pending queue 和 sync reducer，断线期间继续本地应用操作，重连后按游标重放并只在确认后出队。
- 冲突不会静默覆盖：服务端返回 conflict 状态，客户端保留待处理操作并显示需要重新应用或刷新提示。
- 旧客户端协商不到增量能力时收到稳定快照，并带有 snapshotReason=capability-mismatch；旧事件名称和只读行为保持兼容。
- 增加乱序事件、重复提交、断线重连、游标过期、快照降级和跨部门事件投影测试。

验证结果：

- pnpm exec oxfmt --check packages/board-sync/...：首次因协议字段排列失败，修正后通过。
- pnpm exec tsx --test packages/board-sync/client/sync-reducer.test.ts packages/board-sync/server/operation-order.test.ts：首次 2 项失败，修正重复确认和游标单调性后 18 项通过。
- pnpm exec tsx --test packages/board-sync/integration/legacy-client.test.ts：首次发现旧客户端快照缺少 snapshotReason，补齐兼容投影后 11 项通过。
- pnpm typecheck：通过；模块完整测试共 47 项通过。

后续维护需要继续保持 v1 投影、游标单调递增和 clientOperationId 幂等约束；新增事件字段必须先更新能力协商和旧客户端快照路径。`,
  },
]

const diff = (path: string, oldLines: string, newLines: string, oldStart = 1, newStart = 1) => {
  const oldCount = oldLines.split('\n').length
  const newCount = newLines.split('\n').length
  const oldHeader = oldLines === '/dev/null' ? '--- /dev/null' : `--- a/${path}`
  return `diff --git a/${path} b/${path}
index 4c2b91a..a91dd42 100644
${oldHeader}
+++ b/${path}
@@ -${oldStart},${oldCount} +${newStart},${newCount} @@
${
  oldLines === '/dev/null'
    ? ''
    : oldLines
        .split('\n')
        .map((line) => `-${line}`)
        .join('\n')
}
${newLines
  .split('\n')
  .map((line) => `+${line}`)
  .join('\n')}`
}

export const DIFF_FIXTURES: readonly MockPlaybackStep[] = [
  {
    id: 'diff-protocol',
    kind: 'file',
    title: 'Updated sync protocol and capability types',
    changes: [
      {
        path: 'packages/board-sync/protocol/events.ts',
        kind: 'update',
        diff: diff(
          'packages/board-sync/protocol/events.ts',
          "export type SyncEvent = { type: 'operation'; workspaceId: string; version: number }",
          "export type SyncEvent = {\n  type: 'operation' | 'snapshot'\n  workspaceId: string\n  version: number\n  clientOperationId?: string\n  baseCursor?: number\n  snapshotReason?: 'cursor-expired' | 'capability-mismatch'\n}",
          12,
          12,
        ),
      },
      {
        path: 'packages/board-sync/protocol/capabilities.ts',
        kind: 'add',
        diff: diff(
          'packages/board-sync/protocol/capabilities.ts',
          '/dev/null',
          "export const SYNC_PROTOCOL_V2 = 'board-sync.v2'\n\nexport type SyncCapabilities = {\n  protocol: typeof SYNC_PROTOCOL_V2\n  incrementalEvents: boolean\n  stableSnapshots: boolean\n}",
          0,
          1,
        ),
      },
    ],
  },
  {
    id: 'diff-server-sync',
    kind: 'file',
    title: 'Added ordered operation middleware',
    changes: [
      {
        path: 'packages/board-sync/server/operation-middleware.ts',
        kind: 'update',
        diff: diff(
          'packages/board-sync/server/operation-middleware.ts',
          "const version = await store.append(operation)\nevents.publish({ type: 'operation', version, operation })",
          'const duplicate = await store.findByClientOperationId(operation.clientOperationId)\nif (duplicate) return duplicate.ack\n\nconst current = await store.cursor(operation.workspaceId)\nif (operation.baseCursor !== current) {\n  return buildSyncConflict({ currentCursor: current, operation })\n}\n\nconst version = await store.append(operation)\nevents.publish(toProtocolEvent(operation, version))',
          38,
          38,
        ),
      },
      {
        path: 'packages/board-sync/server/replay.ts',
        kind: 'add',
        diff: diff(
          'packages/board-sync/server/replay.ts',
          '/dev/null',
          "export async function replayFromCursor(input: ReplayInput) {\n  const events = await input.store.after(input.workspaceId, input.cursor)\n  if (events.length <= input.limit) return { kind: 'events', events }\n  return {\n    kind: 'snapshot',\n    snapshot: await input.store.snapshot(input.workspaceId),\n    reason: 'cursor-expired',\n  }\n}",
          0,
          1,
        ),
      },
    ],
  },
  {
    id: 'diff-client-queue',
    kind: 'file',
    title: 'Added durable client queue and reducer',
    changes: [
      {
        path: 'packages/board-sync/client/pending-queue.ts',
        kind: 'add',
        diff: diff(
          'packages/board-sync/client/pending-queue.ts',
          '/dev/null',
          'export class PendingOperationQueue {\n  private readonly pending = new Map<string, BoardOperation>()\n\n  enqueue(operation: BoardOperation) {\n    this.pending.set(operation.clientOperationId, operation)\n    return this.persist()\n  }\n\n  acknowledge(clientOperationId: string) {\n    this.pending.delete(clientOperationId)\n    return this.persist()\n  }\n}',
          0,
          1,
        ),
      },
      {
        path: 'packages/board-sync/client/sync-reducer.ts',
        kind: 'update',
        diff: diff(
          'packages/board-sync/client/sync-reducer.ts',
          "case 'operation':\n  return applyOperation(state, event.operation)",
          "case 'operation':\n  if (event.version <= state.cursor) return state\n  return { ...applyOperation(state, event.operation), cursor: event.version }\ncase 'snapshot':\n  return { ...state, document: event.snapshot, cursor: event.version, needsRefresh: true }",
          71,
          71,
        ),
      },
    ],
  },
  {
    id: 'diff-compat-tests',
    kind: 'file',
    title: 'Added reconnect and legacy compatibility coverage',
    changes: [
      {
        path: 'packages/board-sync/integration/legacy-client.test.ts',
        kind: 'add',
        diff: diff(
          'packages/board-sync/integration/legacy-client.test.ts',
          '/dev/null',
          "test('falls back to a stable snapshot for v1 clients', async () => {\n  const response = await connect({ protocol: 'board-sync.v1', cursor: 14 })\n\n  expect(response.type).toBe('snapshot')\n  expect(response.snapshotReason).toBe('capability-mismatch')\n  expect(response.document.version).toBeGreaterThan(14)\n})\n\ntest('replays pending operations after reconnect', async () => {\n  await expect(reconnect({ cursor: 22 })).resolves.toMatchObject({ acknowledged: 3 })\n})",
          0,
          1,
        ),
      },
      {
        path: 'packages/board-sync/protocol/legacy-projection.ts',
        kind: 'update',
        diff: diff(
          'packages/board-sync/protocol/legacy-projection.ts',
          "return { type: 'snapshot', document: snapshot }",
          "return {\n  type: 'snapshot',\n  document: snapshot,\n  snapshotReason: 'capability-mismatch',\n}",
          24,
          24,
        ),
      },
    ],
  },
]

export const EDIT_ACTIVITY_FIXTURES: readonly MockPlaybackStep[] = [
  {
    id: 'read-root-agents',
    kind: 'agent',
    title: 'Read root AGENTS.md',
    detail: 'Read AGENTS.md+42-0',
  },
  {
    id: 'read-module-agents',
    kind: 'agent',
    title: 'Read board-sync AGENTS.md',
    detail: 'Read packages/board-sync/AGENTS.md+31-0',
  },
  {
    id: 'read-sync-spec',
    kind: 'agent',
    title: 'Read offline-sync.md',
    detail: 'Read offline-sync.md+118-0',
  },
  {
    id: 'read-protocol-doc',
    kind: 'agent',
    title: 'Read collaboration-events.md',
    detail: 'Read collaboration-events.md+96-0',
  },
  {
    id: 'edit-protocol-types',
    kind: 'agent',
    title: 'Edited protocol/events.ts',
    detail: 'Edited events.ts+16-4',
  },
  {
    id: 'create-capabilities',
    kind: 'agent',
    title: 'Created capabilities.ts',
    detail: 'Created capabilities.ts+12-0',
  },
  {
    id: 'edit-operation-middleware',
    kind: 'agent',
    title: 'Edited operation-middleware.ts',
    detail: 'Edited operation-middleware.ts+18-3',
  },
  {
    id: 'create-replay',
    kind: 'agent',
    title: 'Created replay.ts',
    detail: 'Created replay.ts+13-0',
  },
  {
    id: 'create-pending-queue',
    kind: 'agent',
    title: 'Created pending-queue.ts',
    detail: 'Created pending-queue.ts+12-0',
  },
  {
    id: 'edit-sync-reducer',
    kind: 'agent',
    title: 'Edited sync-reducer.ts',
    detail: 'Edited sync-reducer.ts+7-2',
  },
  {
    id: 'create-compat-tests',
    kind: 'agent',
    title: 'Created legacy-client.test.ts',
    detail: 'Created legacy-client.test.ts+12-0',
  },
  {
    id: 'edit-legacy-projection',
    kind: 'agent',
    title: 'Edited legacy-projection.ts',
    detail: 'Edited legacy-projection.ts+6-1',
  },
  {
    id: 'fix-reducer-boundary',
    kind: 'agent',
    title: 'Fixed sync-reducer.ts',
    detail: 'Edited sync-reducer.ts+9-3',
  },
  {
    id: 'fix-legacy-middleware',
    kind: 'agent',
    title: 'Fixed legacy-projection.ts',
    detail: 'Edited legacy-projection.ts+5-1',
  },
]

const command = (
  id: string,
  value: string,
  output: string,
  commandStatus: ChatActivity['commandStatus'],
  exitCode: number | undefined,
  durationMs: number,
): MockPlaybackStep => ({
  id,
  kind: 'command',
  title: value,
  command: value,
  output,
  commandStatus,
  exitCode,
  durationMs,
})

export const COMMAND_FIXTURES: readonly MockPlaybackStep[] = [
  command(
    'cmd-inventory',
    'rg --files -g "AGENTS.md" -g "*.md" -g "packages/board-sync/**" .',
    `AGENTS.md
packages/AGENTS.md
packages/board-sync/AGENTS.md
packages/board-sync/README.md
packages/board-sync/docs/offline-sync.md
packages/board-sync/docs/collaboration-events.md
packages/board-sync/protocol/events.ts
packages/board-sync/protocol/legacy-projection.ts
packages/board-sync/client/pending-queue.ts
packages/board-sync/client/sync-reducer.ts
packages/board-sync/server/operation-middleware.ts
packages/board-sync/server/replay.ts
packages/board-sync/integration/legacy-client.test.ts
packages/board-sync/integration/reconnect.test.ts`,
    'completed',
    0,
    226,
  ),
  command(
    'cmd-read-docs',
    'Get-Content AGENTS.md; Get-Content packages/AGENTS.md; Get-Content packages/board-sync/AGENTS.md; Get-Content packages/board-sync/docs/offline-sync.md; Get-Content packages/board-sync/docs/collaboration-events.md',
    `# packages/board-sync/AGENTS.md
All protocol changes require a v1 projection and a replay test.
Do not acknowledge a client operation before durable append succeeds.
Use the workspace cursor as the only ordering authority.

# offline-sync.md
Offline edits remain visible locally while disconnected. The client persists
pending operations and sends the last acknowledged cursor on reconnect.
Duplicate clientOperationId values are idempotent. Cursor gaps request replay;
expired gaps return a stable snapshot with a reason code.

# collaboration-events.md
Event names are owned by the Collaboration Platform team. v2 adds capabilities
and snapshotReason without removing v1 fields. Legacy clients are read-only
when they cannot apply incremental events.`,
    'completed',
    0,
    742,
  ),
  command(
    'cmd-map-existing',
    'rg -n "operationId|workspaceCursor|eventMiddleware|reconnect|snapshot|capabilit|append\\(" packages/board-sync apps web server',
    `packages/board-sync/client/operations.ts:18:export type BoardOperation = { clientOperationId: string; baseCursor: number }
packages/board-sync/client/connection.ts:44:const cursor = state.workspaceCursor
packages/board-sync/client/connection.ts:71:socket.on('reconnect', () => requestReplay(cursor))
packages/board-sync/server/operation-middleware.ts:22:const version = await store.append(operation)
packages/board-sync/server/event-middleware.ts:39:return legacyProjection(event, client.capabilities)
packages/board-sync/server/snapshot-store.ts:57:async snapshot(workspaceId: string)
apps/board/src/state/board-reducer.ts:112:case 'operation':
apps/board/src/state/board-reducer.ts:139:case 'snapshot':
apps/board/src/board-connection.ts:88:connection.on('reconnect', replayPending)
web/src/collaboration/capabilities.ts:9:export const supportsIncrementalEvents = clientVersion >= 2`,
    'completed',
    0,
    534,
  ),
  command(
    'cmd-lint-first',
    'pnpm exec oxfmt --check packages/board-sync/protocol packages/board-sync/client packages/board-sync/server',
    `packages/board-sync/protocol/events.ts:19:7 error sort-keys: expected "baseCursor" before "clientOperationId"
packages/board-sync/protocol/events.ts:21:3 error object-curly-newline: multiline object must have trailing comma

Found 2 errors in 6 files.`,
    'failed',
    1,
    842,
  ),
  command(
    'cmd-focused-tests',
    'pnpm exec tsx --test packages/board-sync/client/sync-reducer.test.ts packages/board-sync/server/operation-order.test.ts',
    `TAP version 13
not ok 1 - ignores a duplicate acknowledgement after reconnect
  error: expected pending.length === 2, received 1
not ok 2 - keeps the cursor monotonic when events arrive out of order
  error: expected cursor === 42, received 41
ok 3 - rejects an operation with an expired base cursor
ok 4 - orders accepted operations by server version
ok 5 - publishes a single event for a duplicate clientOperationId
1..18
# tests 18
# pass 16
# fail 2
# duration_ms 1284`,
    'failed',
    1,
    3810,
  ),
  command(
    'cmd-compat-integration',
    'pnpm exec tsx --test packages/board-sync/integration/legacy-client.test.ts packages/board-sync/integration/reconnect.test.ts',
    `TAP version 13
ok 1 - replays pending operations after reconnect
ok 2 - returns a stable snapshot for an expired cursor
not ok 3 - projects v2 snapshot for a v1 client
  error: expected snapshotReason, received undefined
  client: board-web/1.18 capabilities={incrementalEvents:false}
  response: { type: "snapshot", version: 88, document: [Object] }
ok 4 - preserves the v1 operation event name
1..11
# tests 11
# pass 10
# fail 1
# duration_ms 2240`,
    'failed',
    1,
    4890,
  ),
  command(
    'cmd-format-fixed',
    'pnpm exec oxfmt --write packages/board-sync/protocol packages/board-sync/client packages/board-sync/server packages/board-sync/integration',
    `Formatted packages/board-sync/protocol/events.ts
Formatted packages/board-sync/protocol/capabilities.ts
Formatted packages/board-sync/server/operation-middleware.ts
Formatted packages/board-sync/server/replay.ts
Formatted packages/board-sync/client/pending-queue.ts
Formatted packages/board-sync/client/sync-reducer.ts
Formatted packages/board-sync/integration/legacy-client.test.ts
Formatted 7 files.`,
    'completed',
    0,
    914,
  ),
  command(
    'cmd-full-verification',
    'pnpm exec tsx --test packages/board-sync/**/*.test.ts; pnpm typecheck',
    `TAP version 13
ok 1 - persists operations while disconnected
ok 2 - restores pending queue after reload
ok 3 - replays from the last acknowledged cursor
ok 4 - ignores duplicate acknowledgements
ok 5 - applies ordered remote operations
ok 6 - keeps cursor monotonic for out-of-order events
ok 7 - reports a version conflict without dropping local work
ok 8 - returns a stable snapshot after cursor expiry
ok 9 - projects snapshotReason for legacy clients
ok 10 - preserves v1 event names
1..47
# tests 47
# pass 47
# fail 0
# duration_ms 8421

> pnpm typecheck
tsc -p tsconfig.json --noEmit
Found 0 errors.`,
    'completed',
    0,
    10320,
  ),
  command(
    'cmd-final-status',
    'git diff --stat -- packages/board-sync; git status --short -- packages/board-sync',
    ` packages/board-sync/client/pending-queue.ts          |  48 +++++++++++
 packages/board-sync/client/sync-reducer.ts            |  31 +++++-
 packages/board-sync/integration/legacy-client.test.ts |  64 +++++++++++++
 packages/board-sync/protocol/capabilities.ts         |  18 ++++
 packages/board-sync/protocol/events.ts               |  27 +++++-
 packages/board-sync/protocol/legacy-projection.ts    |   9 +-
 packages/board-sync/server/operation-middleware.ts   |  42 +++++++--
 packages/board-sync/server/replay.ts                 |  35 +++++++
 8 files changed, 248 insertions(+), 26 deletions(-)
 M packages/board-sync/client/sync-reducer.ts
 M packages/board-sync/protocol/events.ts
 M packages/board-sync/protocol/legacy-projection.ts
 M packages/board-sync/server/operation-middleware.ts
?? packages/board-sync/client/pending-queue.ts
?? packages/board-sync/integration/legacy-client.test.ts
?? packages/board-sync/protocol/capabilities.ts
?? packages/board-sync/server/replay.ts`,
    'completed',
    0,
    176,
  ),
]

export const MOCK_PLAYBACK_STEPS: readonly MockPlaybackStep[] = [
  REAL_CHAT_ASSISTANT_STEPS[1],
  COMMAND_FIXTURES[0],
  COMMAND_FIXTURES[1],
  COMMAND_FIXTURES[2],
  EDIT_ACTIVITY_FIXTURES[0],
  EDIT_ACTIVITY_FIXTURES[1],
  EDIT_ACTIVITY_FIXTURES[2],
  EDIT_ACTIVITY_FIXTURES[3],
  REAL_CHAT_ASSISTANT_STEPS[2],
  EDIT_ACTIVITY_FIXTURES[4],
  EDIT_ACTIVITY_FIXTURES[5],
  DIFF_FIXTURES[0],
  EDIT_ACTIVITY_FIXTURES[6],
  EDIT_ACTIVITY_FIXTURES[7],
  DIFF_FIXTURES[1],
  COMMAND_FIXTURES[3],
  EDIT_ACTIVITY_FIXTURES[8],
  EDIT_ACTIVITY_FIXTURES[9],
  DIFF_FIXTURES[2],
  REAL_CHAT_ASSISTANT_STEPS[3],
  COMMAND_FIXTURES[4],
  COMMAND_FIXTURES[5],
  EDIT_ACTIVITY_FIXTURES[10],
  EDIT_ACTIVITY_FIXTURES[11],
  DIFF_FIXTURES[3],
  EDIT_ACTIVITY_FIXTURES[12],
  COMMAND_FIXTURES[6],
  REAL_CHAT_ASSISTANT_STEPS[4],
  COMMAND_FIXTURES[7],
  EDIT_ACTIVITY_FIXTURES[13],
  COMMAND_FIXTURES[8],
  REAL_CHAT_ASSISTANT_STEPS[5],
]
