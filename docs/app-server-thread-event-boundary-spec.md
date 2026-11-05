# App Server Thread Event 边界规格

## 状态与启动说明

- 状态：**Verified**。
- 目标：收窄事件持久化到 thread 领域，保留 App Server thread 事件的完整可恢复历史，并让非 thread 业务只消费内存实时事件。
- 范围：Codex App Server 入站摘要日志、domain event 适配、EventHub/SQLite 读写边界、Owner thread/workspace 订阅、thread 历史回放。
- 本文件是本次工作唯一新增文档，位于 `docs/` 根目录；不新增目录。本文件属于可删除的开发辅助规格。
- 本规格本身不修改代码、数据库或既有文档。按本规格实施时，不修改 archived 历史记录；只有实现后需要同步当前行为说明时，才另行处理。
- 实施前先阅读本规格、`docs/app-server/README.md`、相关 `docs/vendor/codex-app-server/` schema 和 `docs/api/README.zh-CN.md`。

本轮实现已完成：EventHub 仅对有 threadId 的事件调用 EventStore；SQLite 启动恢复只解析 thread 行并以全表 `MAX(id)` 维护序列高水位；workspace scope 不调用 SQLite replay/cursor；`threadsRead` 返回完整保留历史；known event 与 runtime extension 共用嵌套 thread 关联解析；正常 domain publish info 日志已移除。既有数据库行未迁移或删除。

## 问题与用户模型

App Server 的 JSON-RPC 入站消息是事件来源；Owner adapter 将它安全投影成 domain event，Owner WS 将 domain event 实时传给前端。只有归属到 thread 的事件属于可恢复的 thread 历史，应进入 SQLite。workspace、skills 等其它订阅是实时通知，不拥有可查询的事件历史。

`thread/read { includeTurns: true }` 仍是打开 thread 时的快照来源。thread event history 保存 App Server thread 事件流，供重连、恢复及补足 App Server 快照未物化的交互；它不替代 App Server transcript，也不要求每条事件都改变界面。前端 reducer 是快照与历史事件的协调者。

## 基线与当前实现事实

本规格以当前工作区源码行为为基线；没有依据 staged/unstaged diff 的意图作推断。

- `CodexRpcClient.receive` 为每条已解析的 App Server 入站 JSON-RPC response、notification、server request 和无法分类消息打印 `[app-server-rpc]` 结构摘要。摘要包含方向、序号、method、脱敏 ID 标识和有界字段结构，不含参数值或聊天正文。
- `CodexManager` 将通知和 server request 适配成 domain event，并发布到 EventHub。已适配的通知会打印正常 `phase=published` info 日志；这是冗余的逐事件终端日志。
- `EventHub.publishDomain` 当前只要挂有 store，就先写 SQLite，再提交到内存并广播；没有按 thread 关联过滤。
- `SqliteEventStore.append` 接受 `threadId: null`，非 thread 事件也会进入 `domain_events`。只有非空 thread 行执行每 thread retention；非 thread 记录没有对应的 thread 上限。
- `SqliteEventStore.load` 当前读取全表最新 500 行并把有效记录恢复到 EventHub。`loadAfter` 可不带 thread filter；`subscribeFrom` 会在任何 scope 下调用 store 的 `loadAfter`。
- `threadsRead` 读取 thread history，但使用 `isReplayableThreadEvent` 白名单筛选返回给前端的历史事件。
- 前端 `applyHistoryEvents` 已实现 event ID 去重、快照权威、终态 sparse turn 补全和 active sparse turn 交给实时流继续恢复。
- workspace sidebar 和 composer skills 订阅使用 `scope: 'workspace'`，当前从最新事件位置开始，产品上消费实时变化而非历史回放。
- App Server 入站的合法未知消息会变成 `runtime.extension`。其扩展 payload 会提取关联 ID，但扩展 envelope 顶层 `threadId` 目前只读取 `params.threadId`；例如嵌套 `params.thread.id` 没有被提升到顶层。
- 本地保留的 vendor schema 是 0.153；当前受管 runtime 可更新到更高版本。持久化规则必须基于 thread 关联而非固定 method 清单。

## 决策与不变量

以下决策已确认：

1. **持久化边界按 thread 关联判定。** 所有成功适配且能可靠解析出顶层 `threadId` 的 thread 关联 domain event 都持久化，不按 event method、前端当前支持能力或 `thread/read` 当前是否物化该字段建立存储白名单。
2. **存储范围不包含非 thread 事件。** 无法解析出 thread 归属的事件仍可实时发布到 Owner WS，但不得写入 SQLite、从 SQLite 恢复或作为 SQLite 历史回放。
3. **事件 method 不作为归属判断。** `thread/started` 的 thread ID 可来自 `params.thread.id`；turn/item 通知或请求依协议 payload 提供的 thread 关联提取。不能从 UI 当前 thread、最近一次事件或不相关 session 猜测归属。
4. **扩展事件共用关联提取。** `runtime.extension` 的顶层 `threadId` 必须使用同一 correlation resolver 提取；嵌套关联只存在于 payload 不算完成 thread 关联。
5. **thread 持久化不依赖 replay 白名单。** 一个已持久化 thread 事件是否最终改变呈现状态，由前端 native reducer 根据快照、event ID、turn 生命周期和事件语义决定。
6. **历史窗口保持 bounded。** 每个 thread 最多保留最近 1,000 条 thread domain event；EventHub 进程内窗口保持 500 条。按事件条数而非事件 method 进行 retention。
7. **workspace scope 是内存实时流。** workspace/skills 订阅不能调用 SQLite `loadAfter`、`loadThread`、`cursorExpired` 或历史恢复接口。cursor gap/expiry 只按 EventHub 内存窗口判断；reset 需要恢复时，通过重取对应 Owner 业务快照。
8. **Owner envelope、epoch/cursor、Relay 和 wire protocol 不变。** 不增加公开 Owner/Relay method，不增加 envelope 字段，不改 eventId 与 cursor 的契约。
9. **不迁移或删除既有数据。** 不自动修改 SQLite，不添加旧 `schemaVersion` envelope 兼容。旧格式 thread 行继续按当前 parser 拒绝并汇总诊断；旧非 thread 行保留在文件中，但不再加载或回放。
10. **App Server 日志与 domain event 分责。** 终端逐条打印入站 RPC 结构摘要作为适配参考；正常 domain event 不逐条打印。异常、适配拒绝、SQLite 写入失败仍可输出脱敏 warning/error。

## 数据流与实现边界

### 入站观察与适配

1. `CodexRpcClient.receive` 在分派前记录每条已解析 JSON-RPC 消息：方向、接收序号、method、请求 ID 的安全标识和 bounded shape summary。
2. 摘要显示 object key、值类型、字符串长度、array 长度与有限样例形状；不记录任何 string/number/boolean 实际值、聊天正文、路径、token 或 API key。
3. 已有 `[app-server-rpc]` logger 是入站观察的唯一逐消息 info 日志。删除 `CodexManager` 对成功 domain event 的 `phase=published` info 行；保留适配拒绝和发布/存储失败诊断。
4. adapter 继续负责安全投影、payload 上限和 extension 降级。SQLite 持久化的是通过该 adapter 的 domain envelope，不是原始 JSON-RPC；原始 JSON-RPC 摘要不持久化，也不作为 Owner WS payload。

### EventHub 与 SQLite

1. EventHub 先分配全局 eventId，并在内存中维护同一条实时事件流。
2. 若投影后的 envelope 顶层 `threadId` 存在，则按现有 thread 写入顺序持久化成功后提交到内存并广播；持久化失败时保持当前写入失败语义并输出脱敏错误，不能伪装成已成功持久化。
3. 若 envelope 没有 threadId，则只提交到内存并广播，不调用 EventStore。非 thread 持久化失败状态不能阻断 workspace 实时事件。
4. `SqliteEventStore.append` 对新写入施加非空 threadId invariant。数据库表可保留 nullable `thread_id` 以读取既有文件，但不得新增 null-thread 行。
5. 启动恢复只把 `thread_id IS NOT NULL` 的合法事件载入 EventHub；thread payload 按 parser 校验，非法记录逐批汇总告警。
6. 为避免历史 non-thread 行的主键与新 thread eventId 冲突，允许启动时单独读取全表 `MAX(id)` 作为 sequence high-water metadata；该查询不得载入、解析、返回或重放任何非 thread event payload。
7. 新 thread rows 仍使用全局 eventId 主键与每 thread 最近 1,000 条 retention。SQLite 的 thread history/replay/cursor-expiry 查询必须带 threadId。
8. Owner event epoch 每次进程启动变化；旧 cursor 继续走现有 reset 语义。跨 epoch 的非 thread ID 不持久化，不能通过历史恢复。

### Thread 快照与历史

1. `threadsRead` 继续取得 `thread/read includeTurns:true` 投影快照与 thread event cursor。
2. `historyEvents` 返回 retention 窗口内所有合法 thread domain event，不再通过 `isReplayableThreadEvent` method 白名单筛选。
3. 前端 native reducer 继续执行 event ID 去重、快照字段权威、sparse terminal turn 补全、active sparse turn 走实时流、未知扩展摘要等既有协调。
4. thread 实时订阅/断线 resume 可以从持久化 thread cursor 查询 `loadAfter(threadId, afterId)` 和 `cursorExpired(threadId, afterId)`；这些查询不能用于 workspace scope。

### Workspace 实时流

1. workspace subscription 注册 EventHub 内存 listener，从当前 watermark 开始接收实时事件，不扫描 SQLite 历史，也不查 SQLite cursor expiry。
2. `events.reset`、epoch 变化、cursor gap 或 stream 关闭后，sidebar 重新请求 projects/root threads/project threads；skills consumer 重新请求 skills。完成快照刷新后建立新的 workspace live subscription。
3. 同一 consumer 同时只能有一个 workspace stream；关闭旧流和刷新请求后再建立新流，避免断线/重置造成重复 listener 或并发重复刷新。
4. workspace 的事件消费继续依赖业务快照接口；禁止把 workspace reset 改成 SQLite event replay。

## 生命周期、错误与边界情况

- threadId 从协议字段可靠解析时，事件进入 thread store；关联缺失或结构异常时，事件可以走安全 extension/diagnostic 实时路径，但不能落入 SQLite null-thread history。
- 对 App Server server request，保留原有 request ID response routing 与 thread ownership；无可验证 thread ID 的请求仍按既有协议错误策略拒绝，并且入站摘要已经先行记录。
- SQLite 写入失败时，thread event 不得被标成已持久化；记录健康错误并遵守当前 persist-before-broadcast 语义。非 thread 事件不受 SQLite 健康状态影响。
- thread retention 淘汰最旧记录后，过期 thread cursor 触发 reset；客户端重新读取 snapshot/history，不尝试跨过无法补齐的 event gap。
- `thread/started` 及未知 extension 的关联 ID 进入 envelope 顶层后，history、thread filter、retention 和 cursor 查询都应使用同一个 threadId。
- 旧非 thread 行不清除、不解析、不产生逐行告警；旧格式 thread 行按当前 parser 拒绝并汇总原因。不得为它们引入自动兼容或迁移。
- 未知合法 App Server 消息继续先产生 RPC 结构日志，再按当前 extension 安全投影；它有可靠 threadId 则持久化，无 threadId 则仅实时传递。

## 非目标与兼容性

- 不重新设计 Owner/Relay 协议、event envelope、cursor wire shape 或 JSON-RPC transport。
- 不对旧 domain event schema 做兼容迁移，不清理或重写用户数据库。
- 不持久化 App Server response body、全局 account/config/skills 通知或其他无 thread 关联 payload。
- 不把原始 App Server message 或聊天内容写入终端、SQLite、Owner WS、测试产物或遥测。
- 不建立按 event method 的持久化白名单，不新增通用 runtime/plugin event store。
- 不改 archived server event architecture 文档；本规格仅定义后续实现方向，并在实施时作为当前任务合同。

## 实施里程碑

1. **关联合规。** 统一 known event 与 runtime extension 的 correlation extraction；覆盖 `params.threadId`、`params.thread.id`、`params.turn.threadId` 等 schema-backed 形状。
2. **持久化边界。** EventHub 只把有顶层 threadId 的事件写入 EventStore；Store append/load/loadAfter/loadThread/retention 明确 thread 条件；保留全表最大 ID 的 sequence 元数据读取。
3. **thread 历史回放。** 删除服务端 replay method 白名单，完整返回保留窗口内合法 thread history；保留前端 reducer 的 snapshot reconciliation 与 sparse turn 行为。
4. **workspace 实时订阅。** 为无 SQLite replay 的 workspace scope 提供内存订阅；reset/end 后重取业务快照并重订阅 sidebar 与 skills。
5. **日志边界。** 保留 `[app-server-rpc]` 结构摘要，移除正常 domain event publish info 行；保留失败诊断。
6. **文档核对。** 对照实际选定的 runtime 版本生成/检查 notification 与 server-request schema；确认 thread ID 关联路径，不把 vendor 0.153 的静态方法清单用作持久化白名单。

各里程碑可按模块分批实现，但最终验收必须覆盖完整跨层路径。该工作由当前实现者统一整合，不需要为这份规格拆分独立任务包。

## 验收标准

- 任何无 threadId 的新 domain event 都不新增 SQLite row，仍能经 EventHub/Owner WS 实时送达。
- thread scope 内所有成功适配的 notification/server request event 不受 method 白名单限制而持久化；每 thread 恰按最近 1,000 条 retention。
- `thread/started` 和 extension 的 nested thread reference 可写入 envelope 顶层，并能被 `threadHistory`、`loadAfter(threadId)` 和 retention 正确查询。
- workspace/skills initial subscribe、reset、cursor expiry 和 stream end 路径不会调用 SQLite 历史读取或游标查询；恢复依赖 Owner 当前业务快照和新的内存 live stream。
- `threadsRead` 返回完整的 thread event history；通过测试证明 materialized snapshot 内容不重复、sparse terminal turn 可补全、active sparse turn 保持实时节奏。
- 启动只加载 thread history；全局 `MAX(id)` 只用于不重用主键，旧非 thread payload 不被反序列化或重放。
- `[app-server-rpc]` 覆盖 response、notification、server request；摘要有界且不含参数值。正常 domain event 不再产生逐条 publish info 日志。
- 持久化失败、旧格式 thread rows、cursor gap/reset、未知 extension 和缺少关联 ID 均有确定且可测试的行为。

## 开发验证与用户验收

后续代码实现至少运行：

- EventHub/EventStore focused server tests：thread-only writes、no-thread live delivery、thread replay pagination、retention、max-ID collision protection、legacy row filtering 和 write failure。
- application-services server tests：thread history 全量返回、workspace subscription 不走 SQLite、reset 后 scope/cursor 行为。
- frontend focused tests：完整 history 与 snapshot reconciliation、unknown extension、active/sparse turn 和 workspace reset refresh。
- RPC logger tests：response/notification/server request 均有一行摘要，敏感值不出现，正常 domain publish 不打印 info。
- `pnpm typecheck`、涉及 TS/TSX 文件的 `pnpm exec oxfmt --check <touched-files>`；server/store/runtime boundary 变更需按仓库规则运行 `pnpm lint:staged`。
- 用户在实现后手工启动 `pnpm server` 与 `pnpm dev`，验证聊天历史打开、实时 delta、断线 resume/reset、命令输出/问答回放、workspace sidebar 和 skills 刷新。此项属于实现后的 UI 验收，不是本规格文档产出的验收条件。

本轮开发时验证结果：server focused test suite（包含 EventHub、EventStore、domain adapter、manager、RPC logger）127 项通过；`pnpm typecheck`（protocol、app、server、relay）通过；所有本轮触及的 TypeScript 文件已运行 `pnpm exec oxfmt`。待用户手工执行上述 server/dev 浏览器回归后，再确认实时聊天和 workspace 恢复体验。

## 本规格的文档验收

- 文件位于 `/docs` 根目录，不创建目录；其它已存在文档不修改。
- 核心决策、当前事实、旧数据约束、失败行为和测试命令均能脱离本次聊天独立理解。
- 冷启动审阅者无需重开“哪些事件持久化”“workspace 是否读 SQLite”“历史由谁筛选”或“如何处理旧数据”等已确认决策。
