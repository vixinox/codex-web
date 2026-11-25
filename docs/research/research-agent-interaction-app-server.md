# Agent 交互、UI 工作与 App Server 能力核查

审阅日期：2026-11-24。范围：仓库现存官方文档、`0.167.0` schema，以及当前 Conversation adapter / presentation / renderer。本文是研究记录，不是新增产品范围或实施计划。

## 结论与证据边界

App Server 已经提供多 agent 协作的结构化可观测数据：协作工具调用、子 agent 活动、线程亲缘关系、线程/Turn 状态、消息流与历史读取。由这些数据可以做 agent 卡片、任务摘要、消息往来、状态总览、子线程阅读和执行结果展示。

**模型使用的协作工具，不等于客户端可以直接调用的 JSON-RPC 方法。** 当前 schema 中九种 `CollabAgentTool` 是 ThreadItem 内的枚举；`ClientRequest.json` 没有 `agent/spawn`、`agent/sendMessage`、`agent/wait`、`agent/close` 这一组独立控制 RPC。客户端具有通用 Thread/Turn 操作，不能据此宣称已经获得与模型内部 AgentControl 完全相同的控制面。

**UI 工作量的主体是状态、关系、内容和交互的投影，不能只做九种图标。** 当前项目保留了通用 activity 和简化 AgentLink，但尚未保留足够的协作语义；某些信息已在 adapter 丢失，单独改 renderer 无法恢复。

来源与限制：

- [协议入口](../app-server/README.md) 指定已审阅 schema 为 `0.167.0`，但受管 runtime 使用动态 stable release。本文不把 schema 快照等同于实际运行中的版本。
- [官方文档存档](../vendor/codex-app-server.md) 是文档依据；[0.167.0 schema](../vendor/codex-app-server/0.167.0/) 是字段、枚举及请求联合的依据。没有运行 live runtime，本次没有验证实际模型、账号与 feature flag 是否启用某个工具。
- 文档和导出 schema 有可见差异。例如文档第 1301 行仍使用 `collabToolCall` 简写及单个 receiver，schema 的实际 tag 是 `collabAgentToolCall`，使用 `receiverThreadIds[]` / `agentsStates`，并增加 `subAgentActivity`。消费数据应以已验证 schema 和 runtime 响应为准。
- 某些类型出现在 `definitions` 中，却不在请求的顶层 `properties` 中。不能因为存在类型就自行发送对应参数。

## 1. Agent 之间有什么交互

### 1.1 九种协作工具调用

`ThreadReadResponse.json` 的 `definitions.CollabAgentTool`（第 236 行）列出以下九项。下表 UI 文案是产品投影建议；除 schema 的描述外，不推断调度、抢占、投递或唤醒的具体实现。

| schema 工具值 | 可以呈现的事件 | 可派生的 UI 工作 | 不能仅凭枚举确认的行为 |
| --- | --- | --- | --- |
| `spawnAgent` | 发起创建子 agent | 创建活动、目标 agent 卡片、初始任务、请求模型/effort、进入子线程 | 并发上限、上下文继承、worktree 隔离、资源分配、完整 spawn 参数 |
| `sendInput` | 向目标 agent 发送输入 | 发送方/接收方、输入内容、调用结果 | 是否中断运行中 Turn、是否启动新 Turn、与 sendMessage 的精确差异 |
| `resumeAgent` | 发起恢复 agent | 恢复活动、目标状态、错误提示 | 是否恢复同一进程/上下文、与 thread/resume 的等价性 |
| `wait` | 等待一个或多个目标 | 等待中状态、多目标列表、每个目标的最近已知状态 | wait 的成功条件、超时、是否等待任一或全部、是否代表子任务最终成功 |
| `closeAgent` | 发起关闭 agent | 关闭活动、结果、关闭后的阅读入口 | 是否递归关闭后代、与 interrupt / unsubscribe / archive 的等价性 |
| `sendMessage` | 向目标 agent 发消息 | 消息方向、正文、目标、发送状态 | 是否有投递/已读回执，是否唤醒空闲目标，是否允许广播 |
| `followupTask` | 向目标 agent 追加任务 | 追加任务记录、正文、关联 agent、执行状态入口 | 是否创建 Turn、排队与抢占规则、与 sendInput 的精确差异 |
| `interruptAgent` | 发起中断 agent | 中断活动、目标及结果、中断原因的可用信息 | 是否仅中断当前 Turn、是否关闭目标、是否递归作用于后代 |
| `listAgents` | 请求查看 agent 列表 | 参与者列表、最近已知状态、导航入口 | 是否包含完整树、过滤/分页规则、是否可视为持续在线状态订阅 |

共同 payload 是 `ThreadItem` 中的 `collabAgentToolCall` 分支（[schema](../vendor/codex-app-server/0.167.0/v2/ThreadReadResponse.json)，第 1924–2006 行）：

- 必需：`id`、`type`、`tool`、`status`、`senderThreadId`、`receiverThreadIds`、`agentsStates`。
- 可选/可空：`prompt`、`model`、`reasoningEffort`。
- `receiverThreadIds` 是数组；spawn 时对应新生成的 agent 线程 ID。不能把所有 receiver 关系都当作父子关系。
- `agentsStates` 是以目标为键的状态字典，值为 `{ status, message? }`；描述明确为“last known status”，不是持续在线保证。
- `CollabAgentToolCallStatus` 是 `inProgress | completed | failed | interrupted`。
- `CollabAgentStatus` 是 `pendingInit | running | interrupted | completed | errored | shutdown | notFound`。
- `CollabAgentState.message` 是可选字符串，schema 没有承诺它总是完整最终答复、异常详情或投递回执。完整子线程内容应通过该线程历史读取。

需要分开三个真值：**工具调用结果、目标 agent 最近已知状态、目标当前 Turn 状态**。例如 `spawnAgent` 调用 completed 可以只是创建完成，目标仍然 running；`wait` 调用完成也不能被 UI 自动解释成所有目标成功完成。

### 1.2 四种子 agent 活动

`SubAgentActivityKind` 是 `started | interacted | interrupted | completed`（同一 [schema](../vendor/codex-app-server/0.167.0/v2/ThreadReadResponse.json)，第 1038 行）。`subAgentActivity` ThreadItem 提供：

- 必需：`id`、`agentPath`、`agentThreadId`、`kind`、`type`。
- 可选：`model`、`reasoningEffort`；描述明确：创建活动中的 model 是**已解析模型**，旧记录及其他活动可能不含该字段。
- 可做父线程内的生命周期记录、子 agent 身份路径、进入子线程、模型信息；它本身不包含任务正文和完整返回结果。

`collabAgentToolCall.model` 是请求使用的模型；`subAgentActivity.model` 在创建活动中是解析后的模型；`Thread.model` 是当前或最近持久化配置，明确不是每 Turn 实际执行遥测。UI 应避免将这三种来源混为“实际消耗所用模型”。

### 1.3 树状亲缘与交互关系是两套关系

`Thread` 包含 `parentThreadId`、`sessionId`、`agentNickname`、`agentRole`，`source.subAgent.thread_spawn` 包含 `parent_thread_id`、`depth`、可选 `agent_path` / `agent_nickname` / `agent_role`（同一 [schema](../vendor/codex-app-server/0.167.0/v2/ThreadReadResponse.json)，第 1047–1365 行）。

- `parentThreadId` 只在子 agent 线程设置；`sessionId` 用于属于同一 session tree 的线程。
- `forkedFromId` 表示 fork 来源，不能直接当作 agent 委派父节点。
- `source.subAgent` 还包括 `review`、`compact`、`memory_consolidation`、`other`。系统内部辅助线程不一定是用户显式委派的工作 agent。
- `sendMessage` / `sendInput` / `wait` / `resumeAgent` 等形成的是交互边；发送方未必是接收方的父节点。
- `Turn.rootTurnId` 可以归因到原始工作；`turn/start` 的 `parentTurnId` 与 `rootTurnId` 可以表达调用者启动的委派工作因果链。响应中的 Turn 本身只保证可有 `rootTurnId`，没有提供对称的 `parentTurnId` 字段，不能宣称可还原完整 Turn 因果图。
- `ephemeral` 线程明确不应落盘；UI 必须容忍“曾经存在且有活动记录，但现在无法读取历史”。

以上数据足以支持树导航与消息往来图的基础，但没有完整工作流 DAG、依赖调度、资源调度和文件合并的专门契约。

## 2. App Server 对客户端提供什么能力

### 2.1 已在请求联合中可见的通用能力

依据 [ClientRequest.json](../vendor/codex-app-server/0.167.0/ClientRequest.json) 的 `oneOf[].properties.method`：

| 能力 | RPC / 通知 | 对 UI 的意义与边界 |
| --- | --- | --- |
| 发现线程 | `thread/list`、`thread/loaded/list` | 按来源、cwd、归档、分页查询；loaded 只表示已加载，不代表正在运行 |
| 阅读线程 | `thread/read`，可选 `includeTurns` | 不订阅、不启动任务；可以读目标子线程，但项目 Gateway 仍须授权 |
| 恢复/加入线程 | `thread/resume` | 文档说明对 running thread 可 rejoin；不可直接等同内部 resumeAgent |
| 创建与 fork | `thread/start`、`thread/fork` | 创建通用会话；stable schema 没有传入子 agent 父关系的标准顶层参数，不等于 spawnAgent |
| 启动工作 | `turn/start` | 向指定线程提交输入；支持 parentTurnId/rootTurnId 因果归因，不提供 agent 集群调度器 |
| 修改运行中输入 | `turn/steer` | 必须给 expectedTurnId，避免误改另一 Turn；不是 agent-to-agent 专用消息 RPC |
| 中断 Turn | `turn/interrupt` | 作用于指定 threadId/turnId；不要标成“关闭 agent”或“关闭整棵树” |
| 实时活动 | `item/started`、`item/completed`、消息/工具输出 delta | 协作工具和子活动沿 item 通道出现，不需要虚构单独 collab SSE 方法 |
| 线程状态 | `thread/status/changed` | 线程状态与 activeFlags，可显示运行/等待用户输入等 |
| Turn 状态 | `turn/started`、`turn/completed` | 完成、失败、中断及错误；与 agent lifetime 分开 |
| 辅助执行内容 | `turn/plan/updated`、`turn/diff/updated`、command/file/MCP items | 子线程复用聊天渲染，可看计划、命令、文件变化和工具输出 |
| 用量 | `thread/tokenUsage/updated` | 有 threadId/turnId 与 last/total token breakdown；没有现成的 session tree 成本汇总 |
| 生命周期管理 | `thread/unsubscribe`、`thread/archive`、`thread/delete` | unsubscribe 是当前连接退订；归档/删除有持久化与后代影响，不能混为 closeAgent |
| 能力发现 | `model/list`、`experimentalFeature/list` | 模型 multiAgentVersion 可为 disabled/v1/v2 或缺失；flag 列表用于识别实际可用能力 |

`ThreadStatus` 为 `notLoaded | idle | systemError | active`；active 附 `waitingOnApproval` / `waitingOnUserInput` flags（[schema](../vendor/codex-app-server/0.167.0/v2/ThreadStatusChangedNotification.json)）。这又是独立于 collab 状态和 Turn 状态的一层。`notLoaded` 不是 agent 已失败/已删除。

`thread/read` 不订阅；start/resume 后读取 transport 上的生命周期事件（官方文档第 480 行、1245 行）。所以“点开子线程并实时看输出”不仅是渲染一个嵌套 transcript，还涉及加载/订阅生命周期、授权、快照与增量衔接。

### 2.2 文档有描述，但须实验能力或进一步验证

官方文档明确要求初始化 `capabilities.experimentalApi: true` 才能使用实验方法/字段，未开启时会拒绝（第 270–294 行）。

- `thread/list.parentThreadId`：查直接子线程；`ancestorThreadId`：查全部后代，两者不能同时使用（第 696–697 行）。当前 `v2/ThreadListParams.json` 的顶层 properties 没有这两个实验字段。可把它们视为文档中的实验能力，不能把它们写成当前 stable schema 保证。
- `collaborationMode/list`：文档第 343 行描述为实验 preset 列表；当前 `ClientRequest.json` 的 method 联合不含此方法。
- `turn/start.collaborationMode`：文档第 322、922 行说明 mode instructions 语义；当前 `TurnStartParams.json` 顶层没有这个字段。
- `MultiAgentMode` 定义包含 `explicitRequestOnly`、`proactive`、`{ custom: string }`，说明用于有效 delegation instructions；但当前 `TurnStartParams.json` 顶层也没有 `multiAgentMode`。不能以类型存在为依据擅自增加请求字段，亦不能断言它是一个实际调度强制开关。
- `thread/turns/list`、`thread/items/list`：请求联合与参数 schema 可见；文档仍称实验，且 items pagination 依赖 active thread store 支持，可能返回 unsupported-method（第 481、675 行）。对大量子线程的历史分页有价值，但需实际 runtime 能力验证。

**Collaboration mode 与 multi-agent 是不同轴。** 前者 schema 的 `ModeKind` 是 `plan | default`，控制交互/工作模式；后者描述委派策略和多 agent runtime。单 agent 也能 plan，多 agent 也可处于 default。不能把“打开 plan mode”实现为“打开多 agent”。

### 2.3 本次没有证据证明的产品能力

以下应作为新设计或待验证内容，而不是宣称 App Server 原生已提供：

- UI 直接调用与内部 AgentControl 等价的 spawn/sendMessage/followup/wait/close 九件套。
- agent 的可靠消息队列、已读回执、可见 mailbox、全量跨线程消息历史和 delivery guarantee。
- 服务端统一 agent 团队/任务板/可编辑工作流 DAG、优先级、依赖调度与重试策略。
- 自动共享工作区隔离、每个 agent 的独立 worktree、变更冲突检测和结果自动合并。
- 一键停止整棵树、恢复整棵树、重跑整个委派链，除非另有明确协议与运行时验证。
- 全树准确 token/金额/资源预算汇总；parent usage 是否含 child 不可猜测，需要核对记账语义。
- 将 auto-review、review、compact 等内部 helper 全部展示成用户可控同事。

`approvalsReviewer: auto_review` 确实在 schema 中描述为子 agent 做风险审阅，另有 autoApprovalReview 通知；这是审批路由能力。当前项目固定 approvalPolicy never，不应为了本问题引入新的审批工作流。

## 3. 会衍生哪些 UI 任务

下面按用户能完成的事情组织；P0/P1/P2 是研究建议，不是承诺实施范围。

### P0：让现有交互准确、可读、可追踪

1. **协作活动行/卡片**：区分九种 tool，显示准确动词、调用状态、发送方、多个目标，支持展开 prompt 与可用状态消息。空 receiver 的 listAgents 不应被错误隐藏。
2. **agent 身份**：稳定 ID 与 nickname/role/agentPath 展示；未知名字、旧记录缺字段、同名与长路径回退。模型“请求值/解析值/线程配置”来源清晰。
3. **多层状态**：工具 inProgress/completed/failed/interrupted、agent 最近已知状态、Thread active/idle/notLoaded、Turn 状态分开；等待输入/审批给出准确提示。
4. **任务与结果**：初始 prompt、追加任务、消息正文、可用 summary/message；不拿缺失 message 当空结果，不将 collab message 假定为完整子线程答复。
5. **子线程阅读**：从卡片进入 drawer、详情页或同类会话视图；保留父线程返回位置、项目归属；读取中/无权限/未落盘/已归档/已删除/不存在分别处理。
6. **列表和分组**：一次 spawn 多个、wait 多目标、批量消息、嵌套子任务的折叠；计数按 agent 去重，避免同一 agent 的多次工具调用被算成多个 agent。
7. **历史与实时一致**：刷新能复原活动与关系；item completed 覆盖 started；去重；丢游标重取快照；历史没有可选字段仍可阅读。
8. **错误与不确定状态**：失败工具调用、目标 errored/notFound/shutdown、不完整状态/断线分别展示；不可把连接中断当作任务已停止。

### P1：观察并行工作与消息往来

9. **参与 agent 面板**：当前 session 的树状层级、角色、最近活动、运行/完成/异常计数；系统 helper 与委派工作按产品需求区分。
10. **消息流与定向关系**：谁给谁分配/追加/发送什么，显示交互边；树亲缘关系独立；多目标呈现不假造点对点顺序。
11. **子线程实时预览**：复用正式 Conversation reducer → presentation → renderer；按需展开，管理多个订阅与快照，避免将所有子线程输出塞进主 transcript。
12. **结果回收**：完成后的可用摘要、打开完整输出/计划/命令/diff、回到主 agent 的整合答复；不把 agent 工具状态当作任务验收结论。
13. **等待与阻塞总览**：哪个 agent 在等谁、哪个线程等用户、已完成但父线程仍在运行；无 dependency 数据时仅陈述可见的 wait 关系。
14. **大量活动的性能与易读性**：按需加载、折叠历史、列表分页、订阅清理、未读标记策略；这些是 UI/应用层工作，schema 不会自动提供。

### P2：控制、调度与成本，先明确合同再做

15. **对子线程发输入/steer/中断**：可利用通用 Turn RPC，但必须先完成 Owner 对子线程授权与方法投影，明确“用户输入”和“父 agent 发消息”的语义差异。
16. **直接创建/关闭/恢复 agent**：没有已验证 AgentControl RPC，先验证实验表面或设计新的 Owner 层编排，不应让按钮调用猜测方法。
17. **委派策略/模型设置**：基于实际 model catalog 与 flags；实验 collaboration/multiAgentMode 参数必须单独验证；不凭 enum 假定某模型必定可委派。
18. **全树停止、重试、恢复**：定义范围、竞态、幂等/不确定结果、级联行为；不能用 thread/unsubscribe 伪装停止。
19. **token/成本面板**：先验证父子用量记账与去重，再按 rootTurnId/session 汇总；没有价格和记账合同不展示“准确费用”。
20. **文件冲突/产物合并/工作区管理**：属于超出已证实协议的工程能力，不能从子 agent schema 推导。

## 4. 当前仓库做到哪里

本节依据当前工作区代码，不以 archived schema coverage 的旧结论代替现状。

### 已存在的基础

- [conversation-adapter.ts](../../packages/server/src/codex/conversation-adapter.ts) 第 448–479 行已经识别 `collabAgentToolCall` 和 `subAgentActivity`，为 receiver/agentThreadId 产生 `agentLink.upserted`，并保留通用 activity。
- [conversation-presentation.ts](../../packages/app/src/app/chat/projection/conversation-presentation.ts) 第 285–317 行将 link 投影为 ChatActivity.agentLinks 与 meta；当前有 agent 类型活动标题、关联 ID/status 元信息。
- [thread-block.tsx](../../packages/app/src/app/chat/transcript/thread-block.tsx) 第 84–135、208–263 行通过通用 ActivityRow / ActivityBatch 展示 `Used agents` / `Agent activity`，详情中能显示 meta。
- [manager.ts](../../packages/server/src/codex/manager.ts) 第 615–694 行按 `params.threadId` 或 `params.thread.id` 将收到的通知投影到对应 Conversation。因此不是只认识主线程事件。

### 真实缺口

- adapter 不保留 collab 的 `tool`、`prompt`、`agentsStates`、`model`、`reasoningEffort`；subAgentActivity 的 kind/path/model 也没有对应完整语义投影。renderer 单独改 UI 拿不到这些内容。
- 任意 collab receiver 都映射为 `parentConversationId` / `childConversationId`，可能把 send/wait 等交互边错当树亲缘。必须用 Thread.parentThreadId / spawn 来源建立真实亲缘。
- link.status 仅按 `activity.status === completed ? completed : running` 得出。这会把 spawn 成功误表示为子 agent completed，也不能准确呈现 failed/interrupted/shutdown/notFound 等目标状态。
- renderer 没有消费 agentLinks 做独立 agent 卡片/可点击子线程导航；现有展示仍是通用 activity。meta 可见不等于 agent 工作台已实现。
- manager 只把 child 事件路由进 child Conversation，没有向 parent 聚合 child 状态、消息和结果。adapter 也未显式消费 `thread/status/changed` / `thread/started` 为完整 agent 状态，而是落到 unsupported diagnostic。
- [thread-collection.ts](../../packages/server/src/thread-collection.ts) 和 [thread-ownership.ts](../../packages/server/src/thread-ownership.ts) 调 `thread/list` 不提供 `sourceKinds`；文档默认 interactive 来源，不应期待默认列表发现全部子线程。
- [thread-contract.ts](../../packages/server/src/thread-contract.ts) 第 45 行排除 ephemeral 和 `parentThreadId != null` 的 summary，因此 sidebar 默认不显示子线程。
- [thread-access.ts](../../packages/server/src/thread-access.ts) 的 read/mutation 路径有差别：指定项目的 read 可在 cwd/项目归属验证后读取；根范围 read 与所有 mutation 还要做 `threadAppearsInCwd` membership 检查，而它使用默认 thread/list 来源。因此不能说“子线程完全不可读”，也不能说“现在所有子线程都可直接控制”。

### 最小推进顺序

先扩充类型化 Conversation 语义，保留协作 tool/prompt/states、子活动 kind、目标与身份信息，并区分亲缘和交互；修正状态来源。随后做可展开的 agent 活动卡片与受控子线程阅读，再决定参与者树、实时预览、用户对 agent 的直接控制。沿用现有 Owner Gateway → Conversation snapshot/change → reducer → presentation → renderer 边界，不向浏览器透传任意原生 DTO。

如果只想改善当前聊天可读性，可以先完成 P0 的活动语义和阅读入口；如果目标是多人团队式调度台，则需要额外的控制/授权/汇总合同，不是换一套组件能完成。

## 5. 待验证项目

1. 当前实际 runtime 版本、feature flags、模型 `multiAgentVersion`，以及九种协作工具在实际模型中的可用集合。
2. 文档中的实验 `collaborationMode/list`、`collaborationMode`、parent/ancestor filters 在当前 runtime 的参数及返回值；取得带实验字段的 schema 或官方源码验证，避免猜字段。
3. sendInput/sendMessage/followupTask 的唤醒、排队、打断、投递语义；wait 的完成条件与 listAgents 的范围。枚举足以命名活动，不足以定义操作承诺。
4. 子线程 start/resume 的订阅传播、ephemeral 历史可用性；父线程是否自动获得完整后代事件。
5. 父子 token 是否包含/重复、rootTurnId 对委派链的实际覆盖；不能直接叠加得出全树消耗。
6. Owner 子线程访问路径的明确政策，尤其 mutation 的 membership 验证应如何支持受控子线程，不能为了 UI 放松目录与 Owner 归属。

## 主要一手依据

- [App Server 协议入口](../app-server/README.md)。
- [官方 App Server 文档存档](../vendor/codex-app-server.md)：实验能力 270–294；threads 480 起；子线程过滤 696–697；事件 1245 起；items 1291–1315。
- [ThreadReadResponse schema](../vendor/codex-app-server/0.167.0/v2/ThreadReadResponse.json)：CollabAgentState/Status/Tool/CallStatus 207–258；SubAgentActivityKind/Source 1038–1120；Thread 1148–1365；collab 与 sub activity item 1924–2056；Turn 2530 起。
- [ClientRequest schema](../vendor/codex-app-server/0.167.0/ClientRequest.json)：以实际请求 method 联合确认直接可调用 RPC；内部 collab tool enum 不属于该联合。
- [ThreadListParams schema](../vendor/codex-app-server/0.167.0/v2/ThreadListParams.json)、[ThreadReadParams schema](../vendor/codex-app-server/0.167.0/v2/ThreadReadParams.json)、[ThreadResumeParams schema](../vendor/codex-app-server/0.167.0/v2/ThreadResumeParams.json)。
- [TurnStartParams schema](../vendor/codex-app-server/0.167.0/v2/TurnStartParams.json)、[TurnSteerParams schema](../vendor/codex-app-server/0.167.0/v2/TurnSteerParams.json)、[TurnInterruptParams schema](../vendor/codex-app-server/0.167.0/v2/TurnInterruptParams.json)。
- [ThreadStatusChangedNotification schema](../vendor/codex-app-server/0.167.0/v2/ThreadStatusChangedNotification.json)、[ThreadSettingsUpdatedNotification schema](../vendor/codex-app-server/0.167.0/v2/ThreadSettingsUpdatedNotification.json)。
- [ModelListResponse schema](../vendor/codex-app-server/0.167.0/v2/ModelListResponse.json)、[ThreadTokenUsageUpdatedNotification schema](../vendor/codex-app-server/0.167.0/v2/ThreadTokenUsageUpdatedNotification.json)。
- 当前项目架构：[PROJECT.md](../../PROJECT.md)、[API 边界](../api/README.zh-CN.md)、[前端边界](../frontend/README.zh-CN.md)。
