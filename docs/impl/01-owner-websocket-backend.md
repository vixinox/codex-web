# Owner 后端 WebSocket 核心工作包

## 1. 状态与启动指令

- 状态：Milestone 5 complete; package/protocol consolidation complete
- 目标：完成本机 Owner 的统一 WebSocket 业务入口、单 Owner 认证与 Application Services，使数据库替换能作为下一独立迭代开始。
- 范围：Owner protocol、session runtime、本地 `/ws`、业务 service 抽取、旧 REST/SSE 业务入口删除；PG 暂留。
- 启动前先读：本文件、`PROJECT.md`、`packages/server/src/owner/app.ts`、`packages/server/src/owner/server.ts`、`packages/server/src/http/types.ts`、`packages/server/src/http/`、`packages/server/src/codex/event-hub.ts`、`packages/server/src/codex/event-store.ts`、`packages/server/src/auth.ts`、`packages/server/src/workspace.ts`、`docs/api/README.zh-CN.md`、`docs/frontend/README.zh-CN.md`。
- 不需要重做 Codex App Server 协议。遵循 `AGENTS.md` 中的服务管理、TypeScript 格式化、PG 和验证约束。

## 2. 问题与目标行为

当前 Owner 业务经统一 WebSocket 进入 Gateway；本地与未来远程 transport 共享 Owner session runtime 和 Application Services。Relay 只提供 transport adapter，不模拟 HTTP。

单 Owner 仍由本机 Owner 验证身份。首次 Owner 创建只能从本地连接发起；本地与远程都通过 Owner 的 email/password 建立有效期七天的 session，session 更新周期沿用一天。远程 session 还必须来自配对设备和有效 E2EE channel。Relay 接入留待后续工作包。

## 3. 当前实现事实与冲突处理

### 已实现事实

- `packages/server/src/owner/app.ts` 注册必要外围 HTTP 与 Owner WS；`packages/server/src/owner/server.ts` 初始化 Better Auth、Workspace、Codex、PG EventStore 和 `OwnerConnector`。
- `packages/server/src/auth.ts` 使用 Better Auth Drizzle PostgreSQL adapter；当前首个账户注册后禁止再次注册。`user/account/session` 数据位于 PG，session 有效期为 7 天、更新周期为 1 天。
- `packages/server/src/codex/event-store.ts` 持久化安全投影事件；`EventHub` 为 Owner WS events stream 提供实时订阅和历史回放。Thread 原文仍由 Codex App Server 负责。
- `packages/server/src/remote/connector.ts` 只负责 Relay transport 和 E2EE，不再转换 HTTP/SSE；`packages/protocol` 通过 owner/relay subpath 隔离两层协议。
- 前端旧 HTTP/SSE bridge 已删除；`packages/app` 的 Owner WS client 留待后续工作包，当前页面引用可能暂时悬空。
- `packages/relay`、`packages/protocol` 和相关架构文档属于当前 workspace 迁移范围。

### 冻结的文档优先级

本工作包是第一阶段 Owner WS 实现范围的权威来源；`owner-remote-final-architecture.md` 是最终分层方向的依据。下列既有描述被本工作包覆盖：

| 文档 | 被覆盖的描述 | 当前处理 |
| --- | --- | --- |
| `PROJECT.md` | Owner 通过旧 REST/SSE bridge 访问 | 已更新为 Owner WS 和 packages workspace 基线 |
| `docs/product/owner-remote-paseo-architecture.md` | Relay 复用 REST/SSE tunnel | 已收敛为 Relay/E2EE transport 专题 |
| `docs/product/owner-sqlite-refactor-plan.md` | SQLite 阶段继续依赖 REST/SSE | 已收敛为 Owner WS 之后的 SQLite 控制面迁移 |
| `docs/product/owner-remote-final-architecture.md` | 旧路由最后才删除 | 已收敛为当前 Owner WS 总架构 |

## 4. 冻结决策与不变量

- 统一 workspace 包 `packages/protocol`，包名 `@codex-web/protocol`；Owner 帧和 Relay frame 分别从 `/owner` 与 `/relay` subpath 导出，不互相导入。
- Owner protocol v1 使用 UTF-8 JSON 文本帧；不支持二进制文件或终端流。协议常量为 `OWNER_PROTOCOL_VERSION = 1`。
- Owner WebSocket 仅作为核心业务入口。HTTP 只保留 health/readiness、静态资源、metadata，以及首次 bootstrap/配对发现所需的本地外围入口。
- 当前实现暂保留 PG、现有 Drizzle schema、Better Auth、credential encryption 和 `PostgresEventStore`；SQLite 是下一阶段固定持久层，不在本次 package 重排中实现数据切换。
- 单 Owner 用户模型与现有 email/password 标识保留；利用 Better Auth 公共 API 创建/验证账户及 session，并通过其公开 `bearer()` plugin 为 WS 客户端提供 opaque bearer token。禁止读取或推断 Better Auth 私有表字段、Cookie 编码或密码 hash 格式。
- Owner email 是现有 Better Auth 所需的唯一账户标识；Owner 密码是本地和远程共同使用的解锁凭据。`owner.session.open` 使用 email/password，返回 session DTO 和 Better Auth bearer plugin 公共接口暴露的 opaque token；不得自行从 `Set-Cookie` 或数据库中解析 token。
- 只有 `transport.kind === 'local'` 且 Origin 精确命中 `trustedOrigins` 的连接可执行首次 Owner bootstrap。缺失或不匹配的 Origin 拒绝握手。未来 relay transport 必须由服务端适配器标记，不能信任客户端帧自报 transport。
- `OwnerContext` 由 admission 层构造，至少包含 `ownerId`、`sessionId`、`clientId`、`connectionId`、`transport.kind` 和可选的已验证 `pairedDeviceId`。业务服务不得从任意 params 读取身份。
- 每个请求持续执行 Owner 归属校验和现有 Thread/Project 受控路径检查；仅因产品单 Owner 不得省略资源归属检查。
- Credential secret、API key、绝对路径、Codex Home、rollout 路径、App Server 进程信息、raw Codex payload 和 stack 不得出现在 WS 响应、事件、日志或错误中。
- PG、Codex App Server/Codex Home 和本地 remote-trust 文件分别继续作为其当前数据权威；Relay 不接入本阶段。

## 5. 协议合同

### 建议的基础帧

```ts
type OwnerFrame =
  | { type: 'hello'; version: number; clientId: string; capabilities: string[]; sessionToken?: string }
  | { type: 'ready'; version: number; connectionId: string; authenticated: boolean; capabilities: string[] }
  | { type: 'request'; requestId: string; method: string; params?: unknown }
  | { type: 'response'; requestId: string; result?: unknown; error?: OwnerError }
  | { type: 'notification'; method: string; params?: unknown }
  | { type: 'stream.open'; streamId: string; requestId: string; meta?: unknown }
  | { type: 'stream.event'; streamId: string; event: unknown }
  | { type: 'stream.close'; streamId: string; reason?: string }
  | { type: 'cancel'; requestId?: string; streamId?: string }
  | { type: 'close'; code: string; message?: string }

type OwnerError = { code: string; message: string; retryable: boolean }
```

Runtime boundary:

```ts
type OwnerTransport = {
  kind: 'local' | 'relay'
  send(frame: string | Uint8Array): Promise<void> | void
  close(code?: number, reason?: string): void
  onMessage(listener: (frame: string | Uint8Array) => void): () => void
  onClose(listener: (reason?: string) => void): () => void
}

type OwnerMethodContext = {
  owner: OwnerContext | null
  transport: OwnerTransport
  signal: AbortSignal
  authenticate(admission: OwnerAdmission): void
}

type OwnerStream = {
  meta?: unknown
  run(emit: (event: unknown) => void, signal: AbortSignal): Promise<void> | void
}
```

`OwnerSessionRuntime` receives one `OwnerTransport`, the immutable method registry, connection ID and a session-resume callback. A registered method declares `access: 'public' | 'local' | 'authenticated'` and implements `handle(params, context)`. Its result is either a unary value or `{ result?, stream? }`; the runtime owns frame validation, IDs, timeout, cancellation, stream framing, serialization, backpressure and connection cleanup. Application methods return safe DTOs only. A `relay` transport implementation is not part of this work package; the kind and optional paired device identity exist so admission/service policy has a stable future boundary.

`hello` 必须是首帧；版本不匹配时发送 `close(UNSUPPORTED_VERSION)` 后关闭。未带有效 session token 的连接仍可收到 `ready(authenticated:false)`，但只能调用 bootstrap/session-open 允许的 auth methods。`sessionToken` 是 Better Auth bearer plugin 签发/接受的 opaque session token；runtime 通过 `auth.api.getSession` 和 `Authorization: Bearer <token>` 验证，不自行解码 token。成功 bootstrap/session-open 后当前连接立即绑定 session。未来 relay transport 必须先完成配对、信任代次和 E2EE admission，再进入同一个 session runtime。

### ID、重试与资源限制

- `requestId`、`streamId` 在单条 WebSocket connection 内唯一；`requestId` 重用返回 `DUPLICATE_REQUEST_ID`，不得重复执行副作用。连接最多接受 4096 个不同 request ID，达到上限后以 `REQUEST_LIMIT` 关闭，防止无限 ID 缓存。
- ID 检查在 auth、method lookup 与 service invocation 之前执行；被拒绝的首次请求 ID 同样消耗该 ID，防止同一 ID 在认证后重放。
- `streamId` 由服务端生成，属于创建它的 connection；断线立即关闭 stream 并清理实时 EventHub listener。Turn 本身不因断线取消。
- `subscriptionId` 绑定 Owner session 和订阅范围。断线后保留最多 10 分钟的恢复描述，不保留离线事件队列；过期或进程重启后返回 `SUBSCRIPTION_EXPIRED`，客户端携最近 cursor 重新 subscribe。
- 单帧上限 1 MiB；每 connection 最大 128 个并行 unary request；默认 unary 处理超时 30 秒。stream 开启后不受 unary 超时限制。
- outbound 慢消费者队列上限为 1000 帧或 8 MiB（任一先到即关闭为 `SLOW_CONSUMER`）；不丢弃队列前部事件继续运行。
- WS 层通过 `cancel.requestId` 取消支持 AbortSignal 的单个未完成请求；`cancel.streamId` 只关闭对应 stream。Turn 只由 `threads.cancel` 显式取消，transport disconnect 不隐式取消。
- 重试语义只保证同一 connection 内 request ID 不重复执行；跨 connection 的断线重试不作 exactly-once 保证。客户端必须先恢复 Thread/status/cursor，不能盲重发非幂等命令。

### Cursor 与恢复

- v1 公共 cursor 为 `{ epoch: string; sequence: number }`。`epoch` 在同一个 PG Owner 数据 lineage 内稳定（由已认证 Owner 身份确定）；PG 事件 ID 映射为递增 `sequence`。Thread 过滤下序号可有间隙，间隙本身不表示丢事件。
- `events.subscribe` 接受 `scope: 'thread' | 'workspace'`、可选 `threadId` 和可选 cursor，返回 `subscriptionId` 并打开 event stream。`thread` scope 必须提供归属有效的 `threadId`。
- 首次 subscribe 未提供 cursor 时从订阅建立时的最新 sequence 开始，只接收新事件；打开既有 Thread 时客户端先读安全 snapshot，再传 snapshot 的 cursor。带 cursor subscribe 或 resume 则先补回游标后的事件，再切换到 live events。
- `events.resume` 接受当前 session 已知的 `subscriptionId` 和 cursor，先回放可用历史，再接入实时流。未知/过期订阅返回 `SUBSCRIPTION_EXPIRED`；epoch 不匹配、cursor 超出保留窗口或历史 gap 时发送 `events.reset`，携当前 cursor 与重置原因，客户端随后调用 `threads.read` 获取安全 snapshot，再用新 cursor subscribe。
- cursor 查询、历史回放与实时订阅之间必须无竞态；新增 EventStore 的按 Owner/scope/cursor 有序分页读取能力，沿用 EventHub 的持久 append-before-publish 和安全事件投影。超过当前 per-Thread 保留窗口则发送 `notification(method: 'events.reset')` 并关闭旧 stream，不把原始 runtime 消息写入 event store。

## 6. Domain、服务与方法范围

新增 `OwnerApplicationServices` 聚合入口，放在 `packages/server/src/owner/application-services.ts`；方法按域分组于同目录，接收显式 `OwnerContext` 和已验证参数。内部可委托现有 `WorkspaceService`、`CodexBridge`、`EventHub`、`SkillHandleStore`、`RemoteTrustStore`。Service 不导入 Fastify request/reply/socket、`Database` 或 Drizzle 类型。WS method registry 是唯一业务入口；health/bootstrap discovery/pairing offer HTTP adapter 只映射输入输出并调用同一服务，不复制领域规则。

WS v1 必须覆盖现有 Owner 业务功能：

| Domain | 方法 |
| --- | --- |
| Owner/auth | `owner.status`、`owner.bootstrap.create`、`owner.session.open`、`owner.session.close` |
| Credentials | `credentials.list`、`credentials.create`、`credentials.test`、`credentials.select`、`credentials.delete` |
| Projects/workspace | `projects.list`、`projects.create`、`projects.rename`、`projects.delete` |
| Runtime/config | `codex.status`、`codex.start`、`codex.restart`、`configuration.contextWindow.read`、`configuration.contextWindow.write`、`capabilities.list` |
| Skills | `skills.list` |
| Threads/turns | `threads.list`、`threads.create`、`threads.read`、`threads.status`、`threads.archive`、`threads.unarchive`、`threads.delete`、`threads.deleteAll`、`threads.send`、`threads.cancel`、`threads.compact`、`userInput.respond`、`approvals.resolve` |
| Events | `events.subscribe`、`events.resume` |
| Local remote administration | `remote.status`、`remote.trust.reset` |

方法参数/结果按现有 route validation、DTO、`docs/api/README.zh-CN.md` 和既有测试保留语义；HTTP status 转为稳定 `OwnerError.code`，错误不得带 HTTP body、stack 或原始 Codex payload。`threads.send` 返回已接受的 Turn 标识并可打开 stream；完整 Turn 生命周期由 Codex runtime 管理，stream disconnect 不取消 Turn。审批和用户问答响应通过同一条 WS 连接上的普通 request 完成。

### 外围 HTTP

- 保留 `/health`、`/ready`、`/metadata`、静态资源和 `GET /api/auth/bootstrap`（或等价本地 bootstrap discovery）。
- 保留本机一次性配对 offer discovery；只返回现有安全 offer DTO。配对 offer 与 trust reset 操作调用 Application Service，不依赖 `OwnerConnector.forwardHttp`。远程状态/配对管理 WS method 只能在本地 transport 使用。
- 删除 `/api/auth/*` 代理、`/api/me` 和所有 credential/project/configuration/codex/skills/thread/event/remote REST/SSE 业务路由。移除 remote Connector 的 loopback HTTP/SSE forwarding、SSE reader/writer 和过时的 client HTTP/SSE tunnel handlers；Relay transport 和信任 store 实现留给后续工作包。
- 删除 `packages/app/src/lib/bridge/http/*`、`packages/app/src/lib/bridge/events/event-source.ts` 和旧 Owner HTTP adapters；不迁移前端页面/controllers。其余现有前端源码可能保留对这些模块的悬空 imports，且本阶段明确接受因此导致的全仓 `pnpm typecheck` 失败；不增加 stub、兼容模块或 SSE fallback。前端 WS client 与引用更新在 Relay 后续迭代进行。

## 7. 生命周期与失败行为

- Fastify upgrade 只在成功协议 hello 后建立 `OwnerSessionRuntime`。认证方法返回通用登录失败，不区分 owner email 是否存在；密码校验调用 Better Auth 公共接口并沿用现有 rate limiting。
- Bootstrap 使用 PG 原有 Owner 唯一性检查，在 Owner 进程内用单一 async mutex 串行化检查与 Better Auth sign-up；并发 bootstrap 只能有一个成功，第二个得到 `OWNER_ALREADY_EXISTS`。服务维持单进程 Owner 拓扑，不承诺多个 Owner 进程同时 bootstrap 的分布式锁。只有当前本地 Origin/transport 可 bootstrap。
- `owner.session.open` 成功时由 Better Auth bearer plugin 的公开 response header 提供 opaque token，并在 WS response 中一次性返回；token 是客户端 secret，不进入 logs/diagnostics。后续连接在 `hello.sessionToken` 携带 token，runtime 通过 Better Auth session API 验证，并应用七天 expiry/一天 refresh 语义。`owner.session.close` 通过 Better Auth public sign-out API 撤销当前 session 后关闭当前连接。
- 每个 connection close 时取消仍未完成的可取消 request、关闭 stream、解绑 EventHub listener、清理计时器与队列；不取消已经接受的 Turn。
- PG/event-store 初始化失败时 Owner 不监听；WS method service 失败时返回脱敏稳定错误，单次 method failure 不使整个 Owner 进程退出。
- 旧数据库行保留；不删除 PG 表、不更改 Better Auth 数据、不导入/导出数据。后续数据库工作包负责明确新 schema、密钥保护和破坏性切换策略。

## 8. 明确不做

- 不实现 Relay 或 Owner Relay transport，不改 E2EE handshake/crypto 和信任协议。
- 不改前端、不添加兼容 HTTP client 或 SSE fallback，不要求页面回归通过；前端使用后续独立工作包迁移。
- 不替换 PostgreSQL/Better Auth，不新增 migration、表或第二套数据库；仅允许 PG 现有模型承载本阶段 Owner/session 数据。
- 不重写 Codex App Server adapter、JSON-RPC、Thread ownership、安全投影、credential encryption 或 provider 校验。
- 不做文件/终端二进制流，不引入团队、多 Owner、多节点、Guest 或 Relay 账户。
- 不删除/覆盖仓库中已有未提交用户改动；改动范围限于完成本工作包所需实现与其必要测试/协议文档。

## 9. 实施里程碑

1. **Owner protocol package。** 新增 workspace 包、v1 帧/错误/capability 类型、严格 parser/encoder、1 MiB 大小限制和协议测试。更新 workspace/lockfile 时只用 pnpm。
2. **Session runtime。** 在 `packages/server/src/owner/session-runtime.ts` 新增 `OwnerTransport`、`OwnerSessionRuntime`、method registry 和 stream/subscription registry；fake transport/service 测试覆盖 hello/version、auth gate、重复 ID、并行限额、取消、断开、超时、背压和错误投影。
3. **Authentication + services。** 抽出 auth/credential/project/runtime/config/skills/thread/event/remote-trust Application Services；将 WS method handler 接至显式 OwnerContext；先把 `packages/server/src` 中的认证、资源归属、路径、安全投影与 secret redaction 用例迁移为 service/WS 测试，再移除 REST route tests。
4. **本地 WebSocket + vertical slice。** 用 `@fastify/websocket` 注册本地 `/ws`，校验 Origin、payload、关闭清理；先打通 bootstrap/session open/session token resume、`owner.status`、`credentials.list`、`threads.send` stream 和 `threads.cancel`，再把其余方法接入同一 registry。Bearer auth 配置在 `packages/server/src/auth.ts` 使用 Better Auth 公共 `bearer()` plugin；`owner.session.open` 通过 `auth.api.signInEmail` 的公开 response headers 读取 `set-auth-token`，hello admission 使用 `auth.api.getSession` + `Authorization` header。
5. **外围入口与清理。** 将 pairing offer discovery 接到 service；删除旧业务 REST/SSE route registration、Connector HTTP/SSE bridge、`packages/app/src/lib/bridge/http/*` 和 `packages/app/src/lib/bridge/events/event-source.ts` 等旧前端 transport API；保留必要外围 HTTP 与 PG。不要为仍引用这些模块的页面增加兼容 stub，已接受该阶段的全仓前端 typecheck 失败。**已完成：** 保留 health/ready/metadata、bootstrap discovery 和本地 pairing offer；旧业务 routes、REST/SSE helper、前端 HTTP/SSE bridge、Owner HTTP adapter 及旧 REST 测试已移除。
6. **冷启动 handoff。** 对照本文件验收表确认下一阶段数据库替换入口：PG 依赖仅由 auth/session adapter、`packages/server/src/database.ts`/schema、Workspace stores 和 `PostgresEventStore` 承担；Owner protocol、runtime、Application Services 与 transport ports 不得依赖 Drizzle/PG 类型。更新本工作包状态与实际差异；稳定架构基线需要时再单独更新 `PROJECT.md`。

## 10. 验收与验证

### 自动化

- 协议测试：合法/畸形 JSON、错误版本、未知 frame、缺字段、非文本帧和超限帧。
- runtime 测试：hello 必须为首帧；未认证只开放 auth/bootstrap methods；无效/过期 token、非本地 bootstrap、错误密码拒绝；重复/失败 request ID 不能重放；取消只影响目标 request/stream；断开释放订阅但不取消 Turn；超时要在期限到达时返回 `REQUEST_TIMEOUT` 并向 service 发送 abort；慢消费者超过 queue 上限关闭；敏感错误被映射为通用 `OwnerError`。
- service/security 测试：跨 Owner 的 Project/Thread/credential id 不能读取或修改；snapshot/event 使用既有安全投影；Credential API key 不进入响应、错误或日志；context-window、dangerous access confirmation、Credential 选择和 App Server model/effort 验证沿用原语义。
- events 测试：游标正确回放、过滤下允许序号间隙、过期/错误 epoch reset、历史 gap 回退、重连恢复不重放重复事件、实时订阅无回放竞态。
- 运行 `pnpm --filter @codex-web/protocol typecheck`、`pnpm --filter @codex-web/server typecheck`、`pnpm --filter @codex-web/relay typecheck`、focused backend tests 和所有 touched TypeScript 文件的 `pnpm exec oxfmt --check <files...>`。`packages/app` 在 Owner WS client 工作包完成前可能因旧页面引用而失败；server、protocol、relay 项目错误均阻断验收。提交前只暂存本次意图文件后运行 `pnpm lint:staged`。

### 手动验收

用户启动本地 Owner 后，使用 WS 客户端验证：本地首个 Owner bootstrap；email/password 登录、关闭后以 session token 恢复；Owner status；credential/project 操作；Thread snapshot、Turn streaming、审批/问答、显式取消；cursor replay 与 reset fallback；错误 Origin/密码及重复 bootstrap 拒绝。用 fake `relay` transport 单测确认未提供已验证 `pairedDeviceId` 的连接不能通过 remote admission；不做 live Relay 验收。服务依赖运行时由用户启动，不由实现者启动或接管。

### 完成条件

- 所有列出的业务能力只通过 Owner WS 暴露；旧 REST/SSE 业务路由不再注册，旧前端 bridge modules 已删除。
- WS auth、资源归属、Thread 投影、事件投影和 Credential secret 安全测试通过。
- 一次已接受的 Turn 在 WS 断开后继续；显式 cancel 能停止对应 Turn；事件可用 cursor 恢复。
- PG 与现有安全数据保持原样；relay 与前端迁移明确留待后续工作包。
- 全仓 `pnpm typecheck` 的失败仅来自已接受的前端悬空 imports；protocol package 与 server project 定向 typecheck 通过。
- 下一位实现者只需读本文件和列出的入口即可开始，不需重新决定协议边界、认证策略、WS 方法范围、兼容策略或 PG 留存策略。

## 11. 下一阶段数据库交接与 blockers

完成本工作包后，下一阶段从以下 PG 专属边界开始替换：Better Auth adapter/session persistence、`packages/server/src/database.ts`、`packages/server/src/db/schema.ts`、Workspace 的 Drizzle 查询和 `packages/server/src/codex/event-store.ts`。Owner protocol、SessionRuntime、Application Services、事件服务接口及 transport-neutral 接口必须保持稳定。Thread transcript 仍由 Codex App Server/Codex Home 管理。

数据库替换不得顺带恢复 REST/SSE、实现 Relay 或迁移前端；这些顺序固定为：Owner 后端 WS → 数据库切换 → Relay → 前端 WS client。
