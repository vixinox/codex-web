# Conversation 领域模型重构开发规格

## Task 05 后续决策

[05 Owner 内容过滤删除与链路简化](./05-owner-filter-removal-and-simplification.md) 是当前实施合同：删除整个 Owner 业务内容链路的保密性投影，保留领域/UI 转换、认证授权与恢复。旧安全投影、路径保密、问答答案清空和 Skills handle 说明仅为历史基线，由 05 取代；详细 Owner 错误与 Skills 标识接口以 05 为准。

05 实现及开发检查已完成：454 项测试、全仓 typecheck、85 个待提交 TS/TSX 格式检查与 lint:staged 通过；登录后的人工工作流验收仍待执行，详见 05 实施结果。

## 状态与启动说明

- 状态：**Implementation complete; manual acceptance pending**。共享模型、Owner server、App 接入与自动化集成检查已落地；隔离环境真实 Codex capture 和浏览器回归仍待执行。领域模型方向、前后端职责、数据切换和首轮 UI 行为范围已确定；schema 覆盖矩阵中的 UI 缺口作为后续 backlog。
- 目标：以 runtime-neutral 的 Conversation 领域模型取代跨层 Codex `method + params` 状态模型，为后续多 Agent runtime 和多 adapter 建立共享基础。
- 交付状态：规格、任务包和实现均已落地；前端 presentation/renderer 结构保持独立，后续重构不属于本轮。
- 唯一决策源：本文件。任务包不得另行定义共享领域词汇、事件生命周期、快照恢复或存储切换规则。
- 阅读顺序：本规格、[schema-coverage.md](./schema-coverage.md)、[docs/app-server/README.md](../../app-server/README.md)、[docs/app-server-thread-event-boundary-spec.md](../../app-server-thread-event-boundary-spec.md)、[Owner API](../../api/README.zh-CN.md)、[Frontend boundaries](../../frontend/README.zh-CN.md)。

## 问题与用户/系统模型

当前 Chat 以 Codex 的 thread/read DTO 和 JSON-RPC method 为运行状态模型。Fastify 先按 Codex item 类型做白名单投影，EventHub 存储通用 envelope；前端把 envelope 还原成 Codex notification，由 Codex reducer 协调 snapshot/history/live，再生成 Chat blocks。多 Agent 关系、interaction 生命周期、不同 runtime 的共通事实无法稳定表达。

目标路径：

```text
Runtime DTO -> runtime Adapter -> Conversation facts/state -> Owner WS -> App state -> Chat presentation
                                         |                         |
                                         +-> snapshot/event store   +-> Owner WS
```

Conversation 模型表达业务语义，不复刻 Codex schema，也不复用 UI `ChatBlock`。Codex adapter 是首个生产 adapter；第二个纯测试 adapter 用于证明核心 reducer 和前端 presentation 不依赖 Codex 名称。

## 当前实现事实与基线

基线为当前 workspace 源码；没有把 staged/unstaged diff 意图当作决策或扩展规格范围。

- `packages/protocol/src/owner/index.ts` 的 `DomainEventEnvelope` 为 `type: string`、`payload: Record<string, unknown>` 加相关 ID/时间的传输信封，不验证每种事件的语义 payload。
- `packages/server/src/codex/native-protocol.ts` 同时承担输入安全投影与协议字段筛选；未知 ThreadItem 仅保留 id/type，`hookPrompt` 被丢弃，collab agent 只留下数量，多个 item 字段/时间不向下游传递。
- `packages/server/src/codex/domain-events.ts` 把 Codex method 编为 `codex.<method>`，未知事件进入 extension envelope。
- `packages/server/src/owner/application-services.ts` 的 `threadsRead` 先读取事件历史/生成 cursor，再请求 App Server snapshot；这两次读取间的事件可能造成 snapshot、history 与 cursor 不一致。
- `packages/app/src/app/chat/native/codex-thread.ts` 把 domain event 还原为 Codex method，reducer 依赖 Codex method 分支及 snapshot-owned method 清单。未知 extension 只产生方法名错误摘要。
- `packages/app/src/app/chat/projection/thread-presentation.ts` 把多种工作项压缩成通用 activity；呈现模型是 UI 结构，不应成为跨 runtime 的领域合同。
- 已有真实 capture 的 runtime/schema 版本均为 0.167.0；覆盖普通流式回复、审批请求、read/resume、多轮和 compaction，未触发 plan、user-input、file-change 场景。真实 JSONL 仅作运行行为 fixture，不作为 schema 的替代。

## 决策与不变量

- **Confirmed**：Fastify application 层拥有 Conversation 聚合状态、snapshot/history/live 协调和恢复水位；前端消费安全领域 snapshot/changes 并持有可丢弃的呈现状态。
- **Confirmed**：以官方 0.167.0 schema 完整盘点所有 ThreadItem、thread realtime item、thread-scoped notification 和 server request。每项必须有 adapter 处理策略；未展示语义进入 UI backlog，不改变本次 UI 行为范围。
- **Confirmed**：本次实现范围接入一个真实 Codex runtime，并以第二个测试 adapter 执行同一领域契约；不接入第二个真实 runtime。
- **Confirmed**：允许清理/重建全部 Owner SQLite 数据，不要求迁移旧 event envelope、Owner 数据库或旧 schema 版本。Codex Home 原生 transcript 不属于 Owner SQLite，不由该清理策略删除。
- **Confirmed**：前端首轮接入新领域模型但不改变现有可见行为或交互。新模型可携带更完整语义，presentation projection 暂时维持当前 Chat 行为。
- **Confirmed**：schema 覆盖矩阵中的未展示能力保留为后续 UI backlog；本次不据此增加控件、布局、操作、文案或新视觉状态。
- **Recommended default**：新增 browser-safe `@codex-web/conversation` package，存放领域类型、纯 reducer、状态不变量及 conformance test helpers；`@codex-web/protocol/owner` 继续管理 Owner frame、stream envelope 和 cursor。该包不依赖 React、Fastify、Codex DTO、SQLite 或 Owner transport。
- **Recommended default**：领域核心采用显式 discriminated unions；禁止用任意 `type + payload` 作为 reducer 输入。runtime-specific、安全保留的 extension 只在带 adapter identity 的独立扩展分支中出现，且不得携带原始未知 payload。
- **Confirmed**：语义归一化应先保留经审查的字段、身份和关系；安全 projection 是最后的 server-side 出站投影，位于领域处理之后、对外持久化/Owner WS 输出之前。未投影敏感字段不得进入浏览器、Owner WS、普通日志或测试产物。
- **Recommended default**：不维护长期旧数据兼容路径；全量 cutover 使用新 Owner 数据库 schema / store，不实现旧 event rows 转换器。Codex 原生 transcript 仍通过 App Server snapshot/read 提供。

## 领域模型、状态所有权与接口

领域语言和关系：

- **Conversation**：一个可读取、恢复和订阅的对话上下文；Codex thread 是一种 adapter-specific identity 映射。
- **Turn**：Conversation 内一次用户/agent 工作周期，具有明确生命周期、执行者和输出。
- **Message / Part**：按顺序排列、带角色及 typed content 的消息；文本、图片/音频引用、skill/mention reference 是不同 part。
- **Activity**：Turn 中可独立追踪的工作，例如 command、tool call、file change、reasoning summary 或 compaction；有稳定身份、来源、状态和时间。
- **Interaction**：需外部参与者回应的 pending 操作，例如 approval、user input、MCP elicitation；保存 request identity、目标、状态和结果关联，不伪装为普通 activity 文案。
- **AgentLink**：parent agent/turn、child agent/conversation、任务身份及执行状态之间的关系；数量不能替代具体关联。
- **ConversationChange**：作用于上述实体的有类型变化。事件身份、adapter/source identity、可用的 runtime occurredAt 和 Owner receivedAt 与语义变化分开表达。

预期调用模型（最终命名由 00 任务落实并回写本规格）：

```ts
interface ConversationClient {
  open(id: ConversationId): Promise<ConversationSession>
  send(id: ConversationId, command: ConversationCommand): Promise<CommandResult>
  watch(session: ConversationSession, listener: (change: ConversationChange) => void): Unsubscribe
}
type ConversationSession = { snapshot: ConversationSnapshot; watermark: EventCursor }
```

`open` 的 snapshot 与 watermark 必须形成一致切面。Server 捕获切面后缓冲并按 watermark 之后的顺序交付 live changes；同一 event identity 只应用一次。失败时不前移 cursor，不覆盖已可用的 transcript。`watch` 隐藏 Owner WS resume/reset 细节，reset 后通过 server 重新打开权威 snapshot。

Codex adapter 的职责是验证/解释 App Server message、snapshot 和 server request/response，将其映射成领域 command/change；领域 reducer 不分支检查 Codex method。SQLite 存领域状态/变化，Owner WS 发领域 DTO；frontend 只投影 UI presentation。具体事件 union 与 command result 由 00 任务根据 schema 矩阵冻结。

## 行为与生命周期

- Turn 生命周期、Activity 生命周期和 Interaction 生命周期独立；消息 delta 更新有序 content part，不产生新的 message。已知 ended 状态不得被迟到的 started/update 覆盖。
- Approval/user-input request 以 adapter correlation identity 关联到 Conversation/Turn/Activity；回答、拒绝、取消/失效和 runtime resolved 可幂等合并，server request response 只发一次。
- 子 Agent 启动/完成保持父子链接和 child conversation identity；事件顺序到达前允许创建待关联引用，解析失败形成安全诊断而不是丢弃其他 Conversation 状态。
- Snapshot 是某个 watermark 的权威状态；其后的变化只应用一次。Snapshot 读取与事件接收并发时需测试跨越切面前后、重复、乱序、retention reset 和 runtime restart。
- App Server schema 版本变化由 Codex adapter 覆盖矩阵和 contract test 捕获；未知类型不会被伪装成成功完成或无意义空对象。
- UI 对新增 item/interaction 的具体可见性和操作方式不属于本次实现；已有审批和问答流程保持原行为，尚无 UI 的能力由矩阵记录为 backlog。

## Owner 内容与数据治理（05 当前决策）

已认证 Owner 直接消费领域 snapshot/change，取消独立内容安全出口。模型已支持的正文、文件路径、命令、diff、交互结果按原值落盘和交付；Codex adapter 保留语义转换，frontend 保留 UI presentation。认证、设备信任、受控目录/线程访问、协议结构检查、恢复一致性与容量限制继续生效。凭据库/服务端密钥不新增读取入口，日志策略不变。

Skills 采用 name/path，执行前匹配当前 cwd 的 enabled 目录，删除临时 handle 缓存。详细 Owner 错误只在已认证业务请求返回原始 message/details，稳定 code/retryable 不变；Relay、admission 与未认证错误合同独立。

05 不重建数据库或迁移历史。此前已丢失的内容不能从旧 change 恢复；Codex Home transcript 不受本任务操作。

## 非目标与兼容性

- 不接入第二个生产 runtime，不建设通用 adapter registry/capability negotiation。
- 不以 App Server JSON schema 直接作为跨 runtime 领域模型，不以 Chat UI blocks 作为共享模型。
- 不实现旧 Owner event/domain_events schema 兼容或数据迁移。
- 不解析 Codex 内部 rollout JSONL，不删除或迁移 Codex Home transcript。
- 不把 schema 覆盖要求推导为新增视觉/交互；未展示语义只记录到后续 UI backlog。
- Relay 不解析 Conversation 领域正文；Owner/Relay transport 只承载 Owner 安全 DTO。

## 实施里程碑与依赖

1. **Schema 缺口与领域合同**：核实覆盖矩阵、完成用户 UI 选择、冻结 Conversation types/change union/reducer/cursor semantics。对应 [00](./00-conversation-contract.md)。
2. **Owner server**：实现 Codex adapter、authoritative Conversation application、snapshot cut/watermark、全新 store、类型化事件出口（05 取消内容过滤）。依赖 1。对应 [01](./01-owner-server.md)。
3. **App**：迁移 Thread client/Composer/controllers/reducer 到 Conversation contract；将领域状态投影为与当前一致的 presentation；Codex-native presentation 不再进入核心 reducer。依赖 1。对应 [02](./02-app.md)。
4. **切换与集成**：跨 adapter conformance、snapshot/live/reset 测试、干净 DB 初始化回归、浏览器工作流验收。依赖 2、3。对应 [03](./03-integration-and-cutover.md)。
5. **旧代码清理**：移除旧 reducer/presentation、旧 RPC 和测试依赖，统一 compact 命令并重跑相关验收。对应 [04](./04-legacy-cleanup.md)。主流程切换不等同于旧代码已清理或人工验收已通过。

## 验收与验证

Ready for implementation 后，每个阶段至少要求：

- shared conversation package tests：状态机、身份、关联、幂等 reducer 和不变量；第二个测试 adapter 不引入 runtime-specific 分支。
- Codex adapter tests：基于官方 schema fixtures 覆盖所有 ThreadItem、thread realtime item、thread-scoped notification/request；基于本地真实 capture fixtures 覆盖已观测的事件顺序。敏感原始 capture 不进入 Git。
- Server tests：一致 snapshot/watermark、缓冲并发事件、只响应一次的 Interaction、store reset/restart、owner authorization、业务内容保真、授权边界及详细错误合同。
- App tests：领域 snapshot/change reducer、duplicate/reset/reconnect 和 presentation compatibility；证明消息顺序、activity grouping、状态及现有交互投影不变。不新增 React DOM/Playwright 测试，除非用户明确要求。
- `pnpm typecheck`、触及 TS/TSX 的 `pnpm exec oxfmt --check <files>`、focused protocol/server/app tests；提交前按仓库要求 stage intended files 后 `pnpm lint:staged`。
- 手工验收：server 和 Vite 下验证普通聊天流、历史打开、审批/用户输入、Agent 关联展示、断线 resume/reset、数据库重建后 Owner 初始化。此项在实现后由用户执行，不替代自动检查。

## 冷启动状态

- 已明确的方向、现状、冲突、schema 覆盖和首轮行为约束可由本文与矩阵独立理解。
- 实现者不得把 schema gap 转成未经要求的新 UI；矩阵中的 UI backlog 仅用于后续产品决策。
- 实现可按 00 -> 01/02 -> 03 顺序启动；集成 acceptance 要求现有可见行为兼容。
