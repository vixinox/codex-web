# Paseo Daemon 持久化如何支撑业务

调研时间：2026-10-23。依据本机 `C:\Users\Hello\Desktop\paseo` checkout 的 daemon 文档、实现和 E2E 测试；该 checkout 的具体提交以 `git -C C:\Users\Hello\Desktop\paseo rev-parse HEAD` 为准。

## 结论

Paseo daemon 不依赖服务端关系数据库，但它并非无状态，也不是把所有东西都写入 JSON。它把数据按权威来源拆开：Paseo 自己的控制面状态写在 `$PASEO_HOME` 的 JSON/小文件中；Agent 会话正文和可恢复上下文由各 provider 原生存储负责；运行时连接、Agent session 和 timeline 投影主要驻留内存，并可从 provider history 重建。客户端缓存另存在 IndexedDB 或原生客户端存储，不是 daemon 的权威数据。

所以它能支撑业务的关键不是 JSON 特别强，而是数据所有权清楚、核心列表规模以单机为主、Agent provider 暴露稳定的恢复/历史接口，并且 daemon 接受启动时扫描文件、重新连接 provider、重新投影历史的成本与限制。

## 持久化分层

### 1. Paseo 控制面元数据：本机文件

`docs/data-model.md` 明确说明 daemon stores 位于 `$PASEO_HOME`（默认 `~/.paseo`），使用 JSON 文件而非传统数据库，并通过 Zod 在读入时校验。多数写入采用临时文件后 rename 的原子替换；文档也明确承认没有统一 schema migration 框架，主要靠可选字段默认值与少量内联归一化兼容历史格式。[Paseo `docs/data-model.md`](C:/Users/Hello/Desktop/paseo/docs/data-model.md#L33)

Agent 每个一个 JSON 记录，包含 provider、cwd/workspace、标题、配置、状态、归档/attention 元数据和 `persistence` handle；handle 记录 provider、session ID、provider 原生句柄及 metadata，不承载完整对话正文。记录启动时扫描并通过 schema 解析，写入按 Agent 排队、原子替换。[Paseo `docs/data-model.md`](C:/Users/Hello/Desktop/paseo/docs/data-model.md#L77) [Paseo `agent-storage.ts`](C:/Users/Hello/Desktop/paseo/packages/server/src/server/agent/agent-storage.ts#L20)

其他本机文件承载 daemon config、稳定 server ID、Relay E2EE keypair、项目/Workspace 注册表、schedule、push token、plugin 安装信息和运行期 managed-process 记录。Terminal session 则是运行时状态，不作为持久 JSON 记录。[Paseo `docs/data-model.md`](C:/Users/Hello/Desktop/paseo/docs/data-model.md#L43) [Paseo `docs/data-model.md`](C:/Users/Hello/Desktop/paseo/docs/data-model.md#L170) [Paseo `docs/data-model.md`](C:/Users/Hello/Desktop/paseo/docs/data-model.md#L443)

文件实现提供类似数据库的一些局部保障，而非完整数据库语义：Zod 校验、按记录串行写、临时文件 rename，以及少数涉及多文件的显式事务协议和启动恢复。例如 Workspace label catalog 与 assignments 使用 transaction journal 标记提交点；启动恢复会回滚未提交状态或完成已提交清理。[Paseo `docs/data-model.md`](C:/Users/Hello/Desktop/paseo/docs/data-model.md#L507)

### 2. 对话正文：provider 是会话权威

Paseo Agent 记录只保存 provider 的恢复 handle。daemon 重启或首次访问 Agent 时，从文件加载记录，调用对应 provider 的 `resumeSession`/`resumeAgentFromPersistence`；随后 `hydrateTimelineFromProvider` 遍历 provider 的 history stream，将可投影事件重新生成 daemon API 使用的 timeline。[Paseo `agent-loading.ts`](C:/Users/Hello/Desktop/paseo/packages/server/src/server/agent/agent-loading.ts#L65) [Paseo `agent-manager.ts`](C:/Users/Hello/Desktop/paseo/packages/server/src/server/agent/agent-manager.ts#L3247)

Codex adapter 运行 `codex app-server`，通过 Codex App Server 的 thread/history 能力恢复原生 session；其 import 流程也通过 `thread/list` 发现已有 Codex threads。因此 Codex 对话能在 Paseo 与官方 Codex 产品间共享的条件，是二者实际使用同一 Codex home/provider 存储和同一个 thread，而不是 Paseo 把每个 agent 的所有消息复制进自有数据库。[Paseo `codex-app-server-agent.ts`](C:/Users/Hello/Desktop/paseo/packages/server/src/server/agent/providers/codex-app-server-agent.ts#L1380)

此结论不能推广成“任何 Agent 产品的数据都自动互通”。每个 provider 的持久化格式、导入发现、恢复、历史流和能力不同；Paseo 通过 adapter/handle 接口统一调用，但 provider 负责它自己的原生持久层。Paseo 的 agent JSON 是管理投影与恢复索引，不是各 provider 原生 transcript 的替代品。[Paseo `agent-storage.ts`](C:/Users/Hello/Desktop/paseo/packages/server/src/server/agent/agent-storage.ts#L20) [Paseo `codex-app-server-agent.ts`](C:/Users/Hello/Desktop/paseo/packages/server/src/server/agent/providers/codex-app-server-agent.ts#L1380)

### 3. Timeline：运行时投影可重建，durable store 是可选注入

AgentManager 默认使用 `InMemoryAgentTimelineStore`；接口支持按序号分页、cursor epoch 和 gap 检测。管理器另外接受可选 `durableTimelineStore`，但在本 checkout 的非测试生产源码中没有该接口的实现/注入点。生产 restart 后 timeline 的 E2E 能通过，依赖 Agent provider 的历史被重新读取并 hydrate，而非一个默认 SQLite/PostgreSQL timeline store。[Paseo `agent-manager.ts`](C:/Users/Hello/Desktop/paseo/packages/server/src/server/agent/agent-manager.ts#L329) [Paseo `agent-timeline-store.ts`](C:/Users/Hello/Desktop/paseo/packages/server/src/server/agent/agent-timeline-store.ts#L33) [Paseo `agent-timeline-store-types.ts`](C:/Users/Hello/Desktop/paseo/packages/server/src/server/agent/agent-timeline-store-types.ts#L50) [Paseo `persistence.e2e.test.ts`](C:/Users/Hello/Desktop/paseo/packages/server/src/server/daemon-e2e/persistence.e2e.test.ts#L64)

因此“重启后能看到消息”依赖 provider 对历史的可恢复性和 Paseo 对其历史格式的 adapter 支持。Paseo 文档把 provider history 作为 transcript 持久化来源；客户端 timeline cache 用于快速显示及断线期间的本地体验，之后向 daemon catch-up，并非服务端历史的权威副本。[Paseo `docs/timeline-sync.md`](C:/Users/Hello/Desktop/paseo/docs/timeline-sync.md)

### 4. Relay 和连接态：内存即可

Relay 只处理在线连接路由；daemon 保存长期 identity key 和 node/server identity 在本机文件，连接及 session key 是运行态。Relay 或 daemon 重启会令连接中断，由 daemon 重连和客户端重新 attach。无需为了在线路由建立业务数据库，也不应把 Relay 误认为历史存储。[Paseo `docs/data-model.md`](C:/Users/Hello/Desktop/paseo/docs/data-model.md#L554) [Paseo Relay 类型与 daemon transport](https://github.com/getpaseo/paseo/tree/main/packages/relay/src)

## 它支撑了哪些业务，又留下什么边界

本机 JSON registries 支撑项目、Workspace、Agent 列表、配置、归档、标题、定时任务和 daemon 设置；provider persistence 支撑对话恢复和 Agent 原生 transcript；运行时内存负责活动 session、权限请求、实时消息和连接。Agent 列表可以通过目录扫描建立内存索引，单机、单写者模型避免了数据库多副本并发问题。

代价是：跨文件查询和关系约束要由 store/service 自己实现；写入并发、复合修改、崩溃恢复、schema演进和坏文件隔离都需要逐项处理；目录扫描、provider 不可用、provider history 不完整时会影响启动/恢复/历史体验。没有统一 migration 机制，也意味着兼容策略需要落在各 store 的 schema 和归一化逻辑里。[Paseo `docs/data-model.md`](C:/Users/Hello/Desktop/paseo/docs/data-model.md#L33) [Paseo `agent-storage.ts`](C:/Users/Hello/Desktop/paseo/packages/server/src/server/agent/agent-storage.ts#L192)

此外，provider transcript 不一定覆盖 daemon 自己生成的所有产品事件。权限审批、Paseo 工具结果、调度运行记录、设备状态等若需要重启后完整复原，就必须有自己的 durable source 或明确接受不恢复；不能仅因为 provider 对话存在就推断所有 UI 事件都存在。Paseo 会把一部分业务 timeline 事件写入 provider/history 或独立 store，具体能力需逐 provider 检查。[Paseo `agent-manager.ts`](C:/Users/Hello/Desktop/paseo/packages/server/src/server/agent/agent-manager.ts#L4190) [Paseo `docs/data-model.md`](C:/Users/Hello/Desktop/paseo/docs/data-model.md#L395)

## 对 Codex Web 的启示

Codex Web 的 Thread 正文已经由 Codex App Server / 用户 Codex home 持久化，PostgreSQL `codex_event` 的独特职责是保存 bridge 安全投影事件，支持断线游标恢复和问答/命令等未完全物化到 Thread snapshot 的事件。这意味着“对话都需要 PostgreSQL”不是准确表述：需要决定的是 bridge 自有事件是否要求跨 Fastify 重启恢复、需要保存哪些事件、由什么轻量持久层承载。

当前 PostgreSQL 还承载 Better Auth user/session/account、credential、project 元数据和 current credential 选择。去掉 PostgreSQL 并不等于直接删除用户模型：仍需替代本地启动/解锁授权、Credential 加密保存与轮换、Project 元数据约束、远程配对后 Owner 会话、事件游标与恢复等职责。若产品确定单 Owner 单机，嵌入式 SQLite 或分域文件 store 都可评估；选型取决于事务/查询需求、恢复语义、密钥保护和运维体验，而非 Relay 是否使用数据库。

## 一手源码

- [Paseo `docs/data-model.md`](C:/Users/Hello/Desktop/paseo/docs/data-model.md)
- [Paseo `docs/agent-lifecycle.md`](C:/Users/Hello/Desktop/paseo/docs/agent-lifecycle.md)
- [Paseo `docs/timeline-sync.md`](C:/Users/Hello/Desktop/paseo/docs/timeline-sync.md)
- [Paseo `packages/server/src/server/agent/agent-storage.ts`](C:/Users/Hello/Desktop/paseo/packages/server/src/server/agent/agent-storage.ts)
- [Paseo `packages/server/src/server/agent/agent-loading.ts`](C:/Users/Hello/Desktop/paseo/packages/server/src/server/agent/agent-loading.ts)
- [Paseo `packages/server/src/server/agent/agent-manager.ts`](C:/Users/Hello/Desktop/paseo/packages/server/src/server/agent/agent-manager.ts)
- [Paseo `packages/server/src/server/agent/providers/codex-app-server-agent.ts`](C:/Users/Hello/Desktop/paseo/packages/server/src/server/agent/providers/codex-app-server-agent.ts)
- [Paseo `packages/server/src/server/daemon-e2e/persistence.e2e.test.ts`](C:/Users/Hello/Desktop/paseo/packages/server/src/server/daemon-e2e/persistence.e2e.test.ts)
