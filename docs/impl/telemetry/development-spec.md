# Telemetry 全面重构开发规格

## 状态与启动说明

- 状态：Verified。
- 目标：让 App、Owner Server/Fastify、Relay 和 Owner Protocol 使用一个共享的安全错误模型与一致的结构化日志语义，同时保留运行时适配差异。
- 本轮目标：完成 telemetry/Owner Protocol 契约冻结、App、Owner Server/Fastify、Relay 迁移及集成验收；开发文档随里程碑维护。
- 唯一决策源：本文件。各任务包不得重新定义共享错误 DTO、错误码、日志字段或跨边界策略。
- 基线：以当前 workspace 源码为准。工作区已有未提交 telemetry 包实现；没有把 staged/unstaged diff 意图当作设计决定，也没有检查或依赖其提交意图。

## 问题与用户/系统模型

系统有三类消费者：浏览器 App 消费可展示的安全错误；Owner Server 将领域失败映射为 Owner wire error，并通过 HTTP/Fastify、App Server 与业务服务记录诊断事件；Relay 记录连接生命周期和拒绝原因，但只路由 opaque E2EE 业务 payload。共享包提供稳定错误标识、公开错误 DTO、内部诊断错误和跨运行时 logger API，不接管 transport 语义。

数据流：

```text
domain operation -> DiagnosticError/domain code -> explicit boundary projection
     |                                         ├─ Owner WS PublicErrorDto -> App localized presentation
     └─ structured log event                  ├─ HTTP status + safe HTTP body
                                               └─ Relay close code/reason (coarse, anti-probing)
```

公开错误与日志错误是两个不同投影。公开 DTO 不包含 cause/stack；内部日志不记录任意业务 payload。前端不导入 Node/Bun logger 子路径。

## 已验证实现基线

- `packages/telemetry` 已存在，导出 `./errors`、`./logger`、`./diagnostic-error`、`./node`、`./bun`；包含 primitive 参数 DTO、脱敏/校验、结构化 log record、`LOG_LEVEL`、错误 cause 归一化、Pino structural adapter 和 Node/Bun sinks。基础测试、类型检查已通过，但本次重构规划视其当前 API 为起点，任务 00 可在不改变已确认行为的前提下发现契约缺口并先更新本规格。
- `packages/protocol/src/owner/index.ts` 将 Owner response error 校验委托给 telemetry 的 `PublicErrorDto`；frame/parser issue 使用独立 `OwnerProtocolIssue` 类型和 parser-only codes。
- `packages/app/src/lib/owner-ws/owner-runtime.ts` 定义 `OwnerRequestError` 并保留 `code/retryable`；其他管理客户端和 UI 仍将多个错误转换成普通 `Error.message`，若干 controller/UI 直接展示 `.message`。
- `packages/server/src/owner/session-runtime.ts` 定义 `OwnerMethodError` 和 `SAFE_ERROR_MESSAGES` 投影；`auth-domain.ts` 另有 `AuthDomainError`。`http/server-base.ts` 启用了 Fastify Pino error logger，但请求/异常 hook 走自定义 logger，当前将所有 `>=300` 状态记为 error。server 多个 Codex/Owner 模块调用旧 `log`/`safeError`。
- `packages/relay/src/app.ts` 使用本地 `console.error` 格式；`relay-router.ts` 返回字符串 reason，并把字符串 reason 映射到 close frame。attach reject 对外统一 `attach_rejected`，Owner code 冲突是刻意保留的专用内部路由冲突。
- 本次重构不扩展 Guest、认证流程或 Relay 业务职责；Relay 不解析 Owner 错误或 E2EE 正文。

## 已确认决策与不变量

- **Confirmed**：共享 package 为 `@codex-web/telemetry`；它拥有稳定小写 namespaced error code 常量和类型，域层负责内部错误到公开 DTO 的映射及文案。
- **Confirmed**：code 格式为 `<domain>.<subdomain>.<reason>`，全小写点分层级，例如 `owner.auth.passkey-invalid`、`owner.request.timeout`、`relay.attach.unauthorized`。使用语义稳定的原因，不把字段名、动态 ID、异常文本嵌入 code。
- **Confirmed**：公开 DTO 为 `code`、可选 `params`、`retryable`、可选安全 `message`。参数只允许有限 primitive 值，不允许任意对象、stack、cause、宿主路径、credential、session token 或原始异常文本。`message` 是受限安全 fallback，不是内部异常 message。
- **Confirmed**：已知 code 由 App 本地化；未知 code 只有在 DTO parser/安全校验通过时才允许使用服务端安全 `message`，否则显示通用本地化文案。
- **Confirmed**：允许破坏现有 Owner error DTO，无长期旧格式兼容层；Owner App 与 Server 必须作为同一个 wire migration 发布。
- **Confirmed**：执行顺序为 00 契约/Protocol 前置任务，然后 App、Owner Server、Relay 三任务并行，最后 04 集成验收。
- **Confirmed**：App 迁移错误 DTO 和呈现，并清理少量 console 诊断；不新增 browser logger，也不把 UI 业务状态字符串强行改成 telemetry error。
- **Confirmed**：统一 `LOG_LEVEL`，默认 `info`，支持 `debug/info/warn/error`；逐条 App Server RPC trace 保持 INFO 并受阈值控制。
- **Confirmed**：TTY 输出人类可读文本，非 TTY 输出 JSON Lines。Owner Node adapter 使用 Fastify/Pino；TTY 采用 Pino pretty transport。Relay 使用 Bun 原生 sink，不把 Pino 引入 Bun。
- **Confirmed**：HTTP 响应状态日志级别：`5xx -> error`，`4xx -> info`，其他状态（含 3xx）-> `info`。异常 hook 的 error 事件可额外记录一次，但请求完成 hook 不重复升为 error。
- **Invariant**：共享 telemetry 不拥有 HTTP 状态码、Owner WS frame、WebSocket close code 或 Relay 协议版本；这些属于边界映射。
- **Invariant**：Relay attach 拒绝面向未认证对端必须维持一致的拒绝帧/close reason，不能通过日志之外的响应区分 node 不存在、token 错误、容量或其他授权结果。owner-code conflict 的既有内部冲突语义按当前产品规则保留。
- **Invariant**：日志字段必须有限、结构化、原始 primitive；每条日志只记录审计所需字段。不得记录 access/refresh/session/client/owner token、Passkey challenge/response、credential 值、host path、请求/响应正文、E2EE payload、原始 JSON-RPC params/result、stack。
- **Invariant**：日志 error normalization 可保留安全错误 class/code 和有限 cause 链，但要先过共享脱敏/长度/深度限制；公共错误投影绝不调用日志序列化器，也不复制内部 cause。
- **Invariant**：未知/无映射的内部错误统一投影到各自边界的 generic internal failure，不将原始 message 泄露给 App 或 Relay peer。

## 错误目录与旧码迁移

任务 00 必须把以下迁移表实现为 telemetry 常量/类型，并在 `development-spec.md` 维护；枚举完成前不得开始消费者并行迁移。Protocol framing/parser issue 不作为可呈现业务错误码：parser 保留独立有限的 `OwnerProtocolIssueCode`（内部解析诊断），只在必要的 close/frame 边界映射为粗粒度 public code。

| 旧 Owner code | 新共享 code |
|---|---|
| `INVALID_JSON`, `INVALID_FRAME`, `UNSUPPORTED_FRAME` | `owner.protocol.invalid-frame` |
| `FRAME_TOO_LARGE` | `owner.protocol.frame-too-large` |
| `NON_TEXT_FRAME` | `owner.protocol.text-frame-required` |
| `INVALID_HELLO`, `HELLO_REQUIRED`, `HELLO_ALREADY_RECEIVED` | `owner.protocol.invalid-handshake` |
| `UNAUTHORIZED`, `AUTH_FAILURE` | `owner.auth.unauthorized` |
| `AUTH_UNAVAILABLE` | `owner.auth.unavailable` |
| `AUTH_UNAVAILABLE` | `owner.auth.unavailable` |
| `LOCAL_TRANSPORT_REQUIRED` | `owner.auth.local-transport-required` |
| `WEBAUTHN_ORIGIN_NOT_ALLOWED` | `owner.auth.origin-not-allowed` |
| `PASSKEY_INVALID` | `owner.auth.passkey-invalid` |
| `PASSKEY_REQUIRED` | `owner.auth.passkey-required` |
| `ENROLLMENT_TICKET_REQUIRED`, `ENROLLMENT_TICKET_INVALID` | `owner.enrollment.ticket-invalid` (可用安全 `reason` param 区分 required/expired；不暴露 ticket) |
| `CHALLENGE_EXPIRED` | `owner.auth.challenge-expired` |
| `DUPLICATE_REQUEST_ID` | `owner.request.duplicate-id` |
| `REQUEST_LIMIT_EXCEEDED` | `owner.request.limit-exceeded` |
| `REQUEST_TIMEOUT` | `owner.request.timeout` |
| `REQUEST_CANCELLED` | `owner.request.cancelled` |
| `METHOD_NOT_FOUND` | `owner.request.method-not-found` |
| `INVALID_PARAMS` | `owner.request.invalid-params` |
| `INTERNAL_ERROR` | `owner.internal.unavailable` |
| `BACKPRESSURE_LIMIT_EXCEEDED` | `owner.stream.backpressure-limit` |
| `SUBSCRIPTION_EXPIRED` | `owner.events.subscription-expired` |
| `INVALID_EVENT_CURSOR` | `owner.events.invalid-cursor` |
| `INVALID_EVENT_ENVELOPE`, `INVALID_STREAM_EVENT`, `EVENT_CURSOR_MISMATCH`, `EVENT_IDENTITY_MISMATCH` | `owner.events.invalid-stream` |
| `OWNER_ALREADY_EXISTS` | `owner.setup.already-initialized` |
| `INVALID_CREDENTIAL` | `owner.credential.invalid` |
| `CREDENTIAL_NOT_FOUND` | `owner.credential.not-found` |
| `PROJECT_NOT_FOUND` | `owner.project.not-found` |
| `PROJECT_EXISTS` | `owner.project.already-exists` |
| `THREAD_NOT_FOUND`, `INVALID_THREAD` | `owner.thread.not-found` / `owner.thread.invalid-id` respectively |
| `INVALID_THREAD_QUERY` | `owner.thread.invalid-query` |
| `CODEX_START_REQUIRED` | `owner.runtime.start-required` |
| `CODEX_PROTOCOL_ERROR` | `owner.runtime.invalid-response` |
| `INVALID_TURN_REQUEST` | `owner.turn.invalid-request` |
| `CODEX_UNAVAILABLE` | `owner.runtime.unavailable` |
| `RESOURCE_NOT_FOUND` | `owner.resource.not-found` |
| `REMOTE_UNAVAILABLE` | `owner.remote.unavailable` |
| `REMOTE_RELAY_REQUIRED` | `owner.remote.relay-required` |
| `DEVICE_NOT_FOUND` | `owner.device.not-found` |

Auth domain codes `SESSION_REVOKED`, `SESSION_EXPIRED`, `STEP_UP_REQUIRED`, and `ENROLLMENT_TICKET_*` map to `owner.auth.session-revoked`, `owner.auth.session-expired`, `owner.auth.step-up-required`, and `owner.enrollment.ticket-invalid` respectively. The task 00 source audit found no additional OwnerMethodError/AuthDomainError literal beyond the table and these auth codes; the catalog is exhaustive against those current call sites. Legacy uppercase aliases are never valid on the wire.

Relay internal codes use the `relay.*` namespace, covering `relay.attach.invalid-frame`, `.unauthorized`, `.capacity`, `.duplicate`, `.owner-conflict`; `relay.enrollment.reference-invalid`; `relay.connection.peer-disconnected`, `.replaced`, `.slow-consumer`, `.closed-by-owner`; and `relay.frame.invalid` / `.too-large`. Relay peer close reasons remain a small safe mapping, not the complete internal code catalog.

## Interfaces and data flow

- `PublicErrorDto` is the only displayable request error crossing Owner wire: `code: TelemetryErrorCode` (known catalog code or syntactically valid unknown namespaced code), optional `params: Record<string, string | number | boolean>`, `retryable: boolean`, optional safe `message`. Protocol parser imports the browser-safe DTO guard/type from `@codex-web/telemetry/errors`; browser and server use the same definition. Known-code membership is separate from DTO shape validation so forward-compatible unknown codes can use the confirmed safe-message fallback.
- `DiagnosticError` carries stable internal code, `LogLevel`, `retryable`, and `cause`. Owner domain subclasses may add domain-safe primitive params. Relay operation results use typed discriminated internal failure codes rather than ad-hoc strings.
- Logger API exposes `debug/info/warn/error(event, fields?, error?)` and `child(fields)`. Event is a stable dotted string; fields include `service`, optional `component`, `requestId`/`connectionId`, duration, status, role, and stable code where appropriate. No interpolated free-form message is the event key.
- Node/Fastify logger is created once at server composition/startup with `LOG_LEVEL`; requests use child context with request id, method, route template, response status and duration. `request.url` query is never logged. Pino serializers must only receive normalized telemetry errors, never raw Fastify request/response objects.
- Relay logger is created once at Bun startup and passed into app/router. Connection/session identifiers may be logged only if non-secret and bounded; avoid ownerCode, tokens, enrollment reference, raw close reason, encrypted frames.
- Error mapping ownership: Server maps domain diagnostics into Owner `PublicErrorDto`; Protocol validates shape only; App localizes known code and safe params; Relay maps router failure into internal diagnostic log and coarse transport close reason; HTTP maps classified errors to status plus safe DTO/body. No layer infers display copy from `cause.message`.

### Task 00 frozen API

- `@codex-web/telemetry/errors` exports `TelemetryErrorCode` (known Owner displayable and Relay internal codes), `KnownTelemetryErrorCode`, `isKnownTelemetryErrorCode`, `PublicErrorParameter`, `PublicErrorDto`, `PublicErrorProjection`, `createPublicError`, and `isPublicErrorDto`.
- The shared logger contains sink exceptions. `CreateLoggerOptions.onSinkFailure` is called without the original error; Node/Bun adapters use a fixed `telemetry.logger.sink-failed` stderr fallback and contain fallback failures. Telemetry now passes 13 tests.
- `PublicErrorDto.code` accepts catalog entries or a future lowercase namespaced code matching `<domain>.<subdomain>.<reason>`. The generic guard allows syntactically valid Owner and Relay codes; Owner response parsing separately requires the `owner.*` namespace.
- `@codex-web/protocol/owner` exports `OwnerProtocolIssueCode`, `OwnerProtocolIssue`, and event parser issue types separately from the response DTO. Parser issue messages are fixed, bounded diagnostics and never include rejected input.
- No `OwnerError`/`OwnerErrorCode` compatibility aliases remain after tasks 01/02; `OwnerResponseFrame.error` directly references telemetry `PublicErrorDto`.

## Failure and lifecycle behavior

- Invalid `LOG_LEVEL` fails startup with a short safe configuration error before opening listeners; it must not print arbitrary env-derived text.
- Logger sink failure must not crash request/connection business flow; adapter failures are contained through a minimal emergency stderr fallback that emits only a fixed event and safe code. No recursive logger call.
- Unknown Owner errors produce `owner.internal.unavailable`, retryable only according to explicit boundary policy; default is retryable true for transient infrastructure, false for programmer/protocol misuse. Task 00/02 must explicitly classify current catches before setting final metadata.
- App receiving malformed error frame fails protocol parsing. A syntactically valid unknown code is accepted only as a validated DTO and uses the safe-message/generic fallback policy; it must not display unvalidated message/params.
- Relay rejects remain indistinguishable externally as defined above; internal logs can use typed reason and role without logging credentials or route secrets.
- Shutdown and startup failures log one lifecycle event with bounded safe error context; cleanup errors must not mask the primary error. Startup config errors are sanitized before process exit.

## 非目标与兼容策略

- 本次不改变认证、enrollment、设备信任、E2EE、opaque frame forwarding、Owner business methods、事件持久化或 frontend routing。
- 本次允许破坏 Owner response error DTO；不增加双格式兼容，不改变 Relay/IPC/runtime manifest 协议版本，不把 telemetry 内部码表加入 Relay wire protocol。
- 不增加 metrics/tracing/remote log storage/外部服务、不新增浏览器 logger、不记录业务 payload、不让 Relay 解释 Owner DTO。
- Protocol parser 的 frame grammar 和 frame-level parser diagnostics 仍由 `@codex-web/protocol/owner` 实现；仅共享 displayable DTO/code 来源移入 telemetry。

## 里程碑和依赖

1. `00-contract-and-protocol.md`：完整 code catalog、错误参数/文案规则、Protocol parser/wire DTO、冻结 API。它是其余任务的硬前置。
2. 完成后并行：`01-app.md`、`02-owner-server.md`、`03-relay.md`。App 与 Server 必须在同一变更集/同一开发分支验证新 Owner DTO；不通过旧格式兼容过渡。
3. `04-integration-and-acceptance.md`：合并回归、静态安全扫描、手工用户验收与最终文档关闭。

### 实施结果

- Task 00: Complete. Shared catalog/DTO and Owner Protocol boundary frozen; telemetry 13 tests and Protocol 22 tests pass.
- Task 01: Complete. App presents all 42 Owner codes in English/Chinese, preserves DTO/cause, and handles validated unknown-code fallback; App 270 tests pass.
- Task 02: Complete. Owner diagnostics, HTTP mappings, Pino/telemetry integration, and business logging migrated; Server 138 tests pass.
- Task 03: Complete. Relay typed codes, close mapping, Bun logger and anti-probing tests migrated; Relay 27 tests pass.
- Task 04: Verified. Full checks and static migration audit are recorded in the [integration task](./04-integration-and-acceptance.md). Manual TTY/JSONL and live local/remote acceptance remains a post-implementation user check, not a development blocker.

## 验收与必需验证

- 任务 00 的 DTO parser 正反例、旧码全量映射覆盖、无未知 legacy code、类型/API 导出检查。任务 00 已冻结 telemetry exports、Owner DTO 和 parser issue boundary；具体验证结果见 `00-contract-and-protocol.md`。
- App 错误处理单测覆盖已知本地化、未知安全 message、未知不安全 message、非法 params、取消/timeout、WS 断线与 Relay handshake 失败；不添加 React DOM/Playwright 测试，除非用户另行要求。
- Server focused tests 覆盖错误 code projection、retryable、HTTP 级别映射、Pino 字段/pretty vs JSON、请求 query 不进入日志、日志 sink 故障 containment、事件/RPC 摘要日志。
- Relay focused tests 覆盖每种 attach/enrollment/connection 失败分类、外部 close reason 不泄漏内部 auth/capacity 差异、日志无 credential/reference/frame 正文。
- 所有任务执行关联包测试、`pnpm typecheck`、触及 TS 文件 `pnpm exec oxfmt --check ...`。整合阶段执行 `pnpm test` 与 `pnpm test:frontend`；必要时执行项目已有完整构建，不要求新增 UI e2e。
- 日志安全验证以捕获 sink 测试为主：注入 token、Unix/Windows path、Passkey/RPC payload、control chars、超长 cause、对象字段，断言 secret/正文/stack 不出现在 serialized output。
- 手工验收在开发验证后由用户执行：本地和远程请求已知业务错误显示正确本地化；未知安全 message fallback 生效；未知无效 message 落到通用文案；Relay 拒绝和重连外部行为保持一致；终端 TTY 可读、管道输出每行有效 JSON。该验收不阻塞实现完成，除非用户另行定义发布门槛。

## 风险与开放项

- 已确认决策无阻塞项。任务 00 实现阶段如发现旧错误码无法一对一映射或所需参数会泄漏敏感标识，必须先提出主规格变更，再并行迁移。
- Pino pretty transport 在当前依赖图中尚未确认为直接依赖；Server 任务需选定并锁定实现。默认优先显式 `pino-pretty`，若 Fastify 版本已有内置 transport 能力则需验证后记录，不得在不同环境静默改变格式。
- “message 安全”由 producer 可控的静态或参数化文案保证，不能仅凭 regex 脱敏。App 的 guard 用于结构/长度/危险字符检查，不替代 Server 的 allowlist projection。
