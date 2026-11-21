# App Server Schema 覆盖与缺口

> 后续内容过滤、Skills 标识与详细错误合同以 [05](./05-owner-filter-removal-and-simplification.md) 为准；本文旧安全投影约束与结果不再代表 05 完成后的行为。

## 范围与计数

本矩阵对照仓库 [App Server schema 0.167.0](../../vendor/codex-app-server/0.167.0/)，不是对所有官方协议领域提出 UI 需求。统计包括 19 种持久 ThreadItem、4 种 ThreadRealtimeItem、86 种 ServerNotification、10 种 ServerRequest。运行时 manifest 可安装更高 stable 版本；需要 schema 差异检查，不能假设运行时永久等于快照。

状态含义：

- **Mapped**：当前 Fastify `native-protocol.ts` 对结构有显式字段分支；不代表字段完整或已在 UI 呈现。
- **Partial**：类型可进入 snapshot/extension，但关键语义字段没有完整领域表达。
- **Dropped**：投影明确忽略，或类型信息只剩无法恢复语义的最小壳。
- **UI backlog**：领域模型保留该语义；本次前端重构不新增对应视觉或交互行为。
- 真实 capture 只用于已观察行为；`report.json` 中未触发项不得标成实测。

## ThreadItem（19）

| App Server item | 现有 Server 投影 | 现有 Chat 处理 | 主要语义缺口 | UI 状态 |
|---|---|---|---|---|
| `userMessage` | 部分投影 content/clientId | User block；多模态只成标签 | typed content/resource identity、client correlation | UI backlog |
| `hookPrompt` | 丢弃 | 无 | hook fragments 和来源 | UI backlog |
| `agentMessage` | text/phase；忽略 delivery、memoryCitation、questions | assistant text；questionnaire 只由部分事件路径建模 | delivery/citation/question 与消息生命周期关联 | UI backlog |
| `functionCallOutput` | 仅 id/type | 无专门映射 | name、namespace、output | UI backlog |
| `plan` | text/phase | plan presentation | 与 plan steps/turn lifecycle 的统一关系 | UI backlog |
| `reasoning` | 仅 summary；丢 content | summary activity | 多段 content/index 和可见策略 | UI backlog |
| `commandExecution` | command/output/status 等部分字段；遗漏 commandActions、pluginId、scriptPath、processId、source、cwd | command activity | process identity、actions、完整生命周期时间 | UI backlog |
| `fileChange` | changes/status；安全转换路径 | file activity | patch/output 生命周期与原始资源引用 | UI backlog |
| `mcpToolCall` | 部分 server/tool/result/status | generic tool activity | arguments、appContext/resource/UI、完整结果结构 | UI backlog |
| `dynamicToolCall` | 部分 tool/namespace/content/status | generic tool activity | arguments、多 content items、调用身份 | UI backlog |
| `collabAgentToolCall` | model/status/agentCount | “Used agents” activity | senderThreadId、receiverThreadIds、agentsStates、prompt | UI backlog |
| `subAgentActivity` | 仅 kind | generic agent activity | agentThreadId/agentPath、model、reasoning effort | UI backlog |
| `webSearch` | query/action；遗漏 results | search activity | 结果引用与查询生命周期 | UI backlog |
| `imageView` | 仅 id/type；path 不应原样外发 | image activity 标题 | 受控资源引用与显示 metadata | UI backlog |
| `sleep` | duration | system activity | 开始/结束时间与状态 | UI backlog |
| `imageGeneration` | 部分 result/prompt/status | image activity | failure、generationId、input images、保存资源引用 | UI backlog |
| `enteredReviewMode` | review | system activity | 与 review run/target 关联 | UI backlog |
| `exitedReviewMode` | review | system activity | review 结果及生命周期 | UI backlog |
| `contextCompaction` | status | article；能区分 compacting/completed/error | compaction 原因、前后 context/turn 关联若 schema 提供 | UI backlog |

全部 item 的 `startedAtMs` / `completedAtMs` 位于外层生命周期 DTO；当前 `item()` 投影不统一保留这两个时间。新领域模型应为 item/activity 保留可用的开始、结束时间；首轮 UI 维持当前展示。

## ThreadRealtimeItem（4）

| 类型 | 当前专门领域表示 | UI 状态 |
|---|---|---|
| `realtimeSessionStarted` | 无 | UI backlog |
| `transcriptSegment` | 无独立 realtime session 模型 | UI backlog |
| `bemItemPromoted` | 无 | UI backlog |
| `realtimeSessionClosed` | 无 | UI backlog |

## ServerRequest（10）

| Method | 当前处理概况 | 领域模型要求 | UI 状态 |
|---|---|---|---|
| `item/commandExecution/requestApproval` | manager 可关联 request；server 投影只保留有限字段；回答由 Owner method 转发 | Approval Interaction 与 command/activity/turn 关联，允许决策集与 pending/resolved lifecycle | 保持当前 approval UI |
| `item/fileChange/requestApproval` | 可走 runtime extension；无完整 typed projection | file-change Approval Interaction | UI backlog |
| `item/tool/requestUserInput` | projection + reducer questionnaire state | UserInput Interaction、question/options/secret flags、answer correlation | 保持当前 questionnaire UI |
| `mcpServer/elicitation/request` | 无完整 Chat interaction mapping | Elicitation Interaction，保留 server/request identity | UI backlog |
| `item/permissions/requestApproval` | 无完整 typed mapping | Permissions Interaction；权限原文须 server-only projection | UI backlog |
| `item/tool/call` | 无完整 typed mapping | Tool call command/result correlation；不误作用户确认 UI | UI backlog |
| `account/chatgptAuthTokens/refresh` | account/auth 子域 | 排除 Conversation UI，归 account/runtime adapter | 不属 Chat UI |
| `attestation/generate` | security/runtime 子域 | 不属 Conversation UI | 不属 Chat UI |
| `applyPatchApproval` | 无完整 typed mapping；需按 runtime/API surface 确认实际启用 | 若纳入 runtime adapter，映射为 file/patch Approval Interaction | UI backlog |
| `execCommandApproval` | 无完整 typed mapping；需按 runtime/API surface 确认实际启用 | 若纳入 runtime adapter，映射为 command Approval Interaction | UI backlog |

Server request 的 RPC request id 与领域 Interaction ID 分开保存；response 必须以 adapter correlation key 路由且只发送一次。

## ServerNotification（86）

下表列出 0.167.0 所有 notification method，以免把 schema 全面盘点误读为所有功能都进入 Chat UI。标记 **Conversation candidate** 的消息必须由新 adapter 给出模型映射、明确忽略理由或安全诊断；其他方法由对应 account/workspace/runtime 子域处理，不进入 Conversation 聚合。

| 子域 | Methods | 当前 Chat 模型状态 |
|---|---|---|
| Conversation error/status | `error`, `thread/started`, `thread/status/changed`, `thread/readState/changed`, `thread/archived`, `thread/deleted`, `thread/unarchived`, `thread/closed`, `thread/reverted`, `thread/name/updated`, `thread/section/changed`, `thread/attachment/updated`, `thread/goal/updated`, `thread/prediction/updated`, `thread/goal/cleared`, `thread/queue/changed`, `thread/project/updated`, `thread/environment/connected`, `thread/environment/disconnected`, `thread/settings/updated`, `thread/tokenUsage/updated` | 部分 mapped；new domain mapping required；UI pending |
| Turn / hooks | `turn/started`, `turn/completed`, `hook/started`, `hook/completed`, `turn/diff/updated`, `turn/plan/updated`, `thread/compacted` | 部分 reducer 分支；hook 与 compacted 语义不完整；UI pending |
| Item lifecycle / output | `item/started`, `item/completed`, `item/agentMessage/delta`, `item/plan/delta`, `command/exec/outputDelta`, `process/outputDelta`, `process/exited`, `item/commandExecution/outputDelta`, `item/commandExecution/terminalInteraction`, `item/fileChange/outputDelta`, `item/fileChange/patchUpdated`, `item/mcpToolCall/progress`, `serverRequest/resolved`, `item/reasoning/summaryTextDelta`, `item/reasoning/summaryPartAdded`, `item/reasoning/textDelta` | 部分 mapped；`command/exec`、process、terminal interaction、file output/reasoning content coverage incomplete |
| Review / model / guardrail | `item/autoApprovalReview/started`, `item/autoApprovalReview/completed`, `autoApprovalReview/strictReviewRequired`, `model/rerouted`, `model/verification`, `modelProvider/authRecoveryStarted`, `modelProvider/authRecoveryCompleted`, `guardianWarning`, `turn/moderationMetadata`, `model/safetyBuffering/updated` | mostly extension/diagnostic or partially ignored; UI pending |
| MCP runtime | `mcpServer/oauthLogin/completed`, `mcpServer/startupStatus/updated`, `mcpServer/event/stream/notification` | MCP configuration/runtime domain, not Conversation UI by default |
| Thread realtime/audio | `thread/realtime/started`, `thread/realtime/itemAdded`, `thread/realtime/item/started`, `thread/realtime/item/transcript/delta`, `thread/realtime/item/completed`, `thread/realtime/transcript/delta`, `thread/realtime/transcript/done`, `thread/realtime/outputAudio/delta`, `thread/realtime/sdp`, `thread/realtime/error`, `thread/realtime/closed` | no complete Chat domain handling; payload/resource and transport safety require explicit design; UI pending |
| Account/runtime/workspace | `skills/changed`, `project/changed`, `account/updated`, `account/gatewayOAuth/changed`, `account/rateLimits/updated`, `app/list/updated`, `remoteControl/status/changed`, `externalAgentConfig/import/progress`, `externalAgentConfig/import/completed`, `fs/changed`, `windowsSandbox/setupCompleted`, `account/login/completed` | outside Conversation aggregate; route to current owning subsystem |
| Runtime notices | `warning`, `deprecationNotice`, `configWarning`, `windows/worldWritableWarning`, `fuzzyFileSearch/sessionUpdated`, `fuzzyFileSearch/sessionCompleted` | diagnostics/workspace tool domain; do not silently turn into Chat blocks |

表中按主题分组共列 86 个 methods。Conversation candidate 对应所有带 Conversation/Turn/item/request 关联的事件；具体每 method 的 discriminated union 映射由 00 任务与 schema fixtures 一同冻结。收到合法但暂不支持的方法时保留受限 adapter diagnostic，不把任意 raw params 透传。

## Cross-cutting field gaps

- Schema 里多个字段含本机绝对路径、cwd、prompt、权限和内容数据。领域模型保留所需语义或受控 resource reference；安全投影再决定可持久化/对外字段，不把原始对象复制进通用 payload。
- App Server `emittedAtMs`/item `startedAtMs`/`completedAtMs` 与 Owner 接收时间不同；领域时间应分开记录，不以接收时刻冒充发生时刻。
- `receiverThreadIds`、`senderThreadId`、`agentThreadId` 等 relation 字段需变成明确 AgentLink，而不是计数或装饰性文本。
- Server request ID、App Server item ID、Owner event ID、Conversation/Turn ID 各自命名空间不同，不可只用裸 string/number 混为统一 identity。
- Schema 有结构不等于运行样本有行为证据。采集未覆盖的分支以 schema-derived fixture 验证结构，并标成合成 fixture。

## UI Backlog

| Capability | 领域模型需支持 | 当前 UI | 本次范围 |
|---|---:|---|---|
| 19 种持久 ThreadItem | 是，字段经逐项 review 与安全约束 | 部分类型有 activity/summary 展示 | 模型全量消费；保持现有 UI |
| 4 种 realtime item / audio | 是或给出 adapter-level exclusion reason | 无完整模型/UI | 模型消费；列入 UI backlog |
| 8 类 server Interaction | 是，按 approval/input/elicitation/tool-call 分类 | 仅部分 approval/questionnaire | 保持现有 UI；其余列入 backlog |
| model reroute/verification/guardrail/review | 领域事件可表达 | 未系统呈现 | 模型消费；列入 UI backlog |
| child agent 列表、状态、导航与结果 | 必须保留关系数据 | 目前只可概括为 agent activity/count | 保留关系；本次不新增 UI |
| 图片、音频、文件和工具结果引用 | typed part/resource reference | 多模态缩为 attachment 标签；工具结果局部文本化 | 模型保留安全引用；保持现有 UI |

上述 UI backlog 不是本次实施 blocker，也不要求用户在本次重构中逐项选择。未来要改变任一行的呈现时，再单独更新主规格/任务包，补充可见性、操作、空态、失败态和验收条件。
