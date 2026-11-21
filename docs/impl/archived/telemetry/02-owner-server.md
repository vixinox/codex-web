# 任务 02：Owner Server、Fastify 与业务日志

## 状态和依赖

- 状态：Complete。
- 决策源：[主规格](./development-spec.md)；契约：[任务 00](./00-contract-and-protocol.md)。
- 可并行：与任务 01/03 并行。修改 Owner response wire error 时必须直接采用任务 00 的新 DTO；不提供兼容格式。

## 目标与 ownership

让 Owner domain error、Auth error、HTTP error、Owner WS error 和全 Server 日志使用 telemetry 分类/日志 API；移除自定义 logger 与 Fastify Pino 双轨输出。任务范围为 `packages/server/**` 与必要的 server package dependencies/config/tests；不得修改 App、Protocol schema 或 Relay。

## 当前入口

- `owner/session-runtime.ts`: `OwnerMethodError`、`projectError()`、`SAFE_ERROR_MESSAGES`、Owner response error。
- `owner/auth-domain.ts` 和 `application-services.ts`: AuthDomainError 到 OwnerMethodError 的映射与大量旧 code throw sites。
- `http/server-base.ts`: Fastify 初始化、request timing、onResponse、setErrorHandler。
- `server/src/logger.ts`: 自定义 console logger 与 `safeError()`。
- 业务 logger callsites: Codex manager/RPC/runtime manager/stdio, event hub/store, remote connector, Owner app services/session runtime/server startup。
- RPC 逐消息摘要在 `codex/rpc-client.ts`；保留 INFO 级事件，但禁止恢复原始 params/result logging。

## 实施要求

- OwnerMethodError/AuthDomainError 改为共享 `DiagnosticError` 或薄领域子类，包含稳定 telemetry code、cause、明确 retryable 和安全 params。每个旧 throw site 都要分类；未知 code 不可默默把内部 message 填入 DTO。
- 新增唯一 Owner projection 将内部诊断转成 telemetry PublicErrorDto；message 只从 server-side allowlist/参数化安全文案生成。不要把 telemetry 通用 sanitize regex 当作文案 allowlist。
- HTTP error handler 返回安全 HTTP error DTO，并按定义映射 status。`onResponse`: 5xx error、4xx info、其他 info；异常事件不得在 response hook 再重复记录为 error。origin rejection、health 503、redirect 及 Fastify validation/sensible errors 覆盖测试。
- Fastify 使用 Pino transport 和 telemetry Pino adapter；`LOG_LEVEL` 默认 info。TTY 使用显式 pretty transport；非 TTY JSON Lines。pretty dependency/configuration 要明确锁定，配置错误必须早于 listener 启动并产生安全 startup diagnostic。
- request child context 仅记录 request id、method、route template、status、elapsedMs；不记录 query、headers、body、origin、IP 或 response payload。未知 route 的 path 需按安全策略裁剪/归一化。
- 迁移全部旧 `log.*`/`safeError()` 调用到稳定 dotted event + primitive fields。消除 string interpolation 事件；事件字段采用 allowlist；不输出 credential endpoints 含潜在 userinfo/query、Codex executable host path 或 raw subprocess stderr。
- stderr tail 仅用于有界诊断；必须共享 sanitize 且不能转录任意原始行。RPC INFO event 可记录 direction/sequence/method、安全 id 摘要和 shape 摘要，不含正文；达到 LOG_LEVEL threshold 才输出。
- 日志 sink 失败不改变 Owner 请求结果、不跳过 shutdown cleanup，也不遮蔽 startup root cause。

## 验收与验证

- Focused tests: every Owner/Auth old code maps to a namespaced code; unknown exception maps generic; retryability; no cause/message leakage; HTTP level table incl 3xx/4xx/5xx; error hook + response no duplicate error; route/query privacy; Pino fields and TTY/non-TTY transport; invalid LOG_LEVEL startup; sink failure containment; RPC summary remains bounded and payload-free.
- Focused tests: owner application/auth/session runtime, HTTP/server base, Codex RPC/stdio/runtime and event-store/hub suites.
- Run `pnpm --filter @codex-web/server test`, root `pnpm typecheck`, and touched TS `oxfmt --check`. If a Pino transport dependency is added, pnpm lockfile must be updated and startup tests must cover actual adapter configuration.
- Manual post-implementation acceptance: start Owner with TTY and piped output; confirm readable vs valid JSON Lines, run successful/4xx/5xx requests, verify request correlation and absence of URL query, body, host path, credentials, Passkey material, raw RPC payload.

## 排除项

不修改 DB/schema、Owner business method semantics、App rendering、Protocol parser rules、Relay sink 或 runtime startup topology。

## 完成结果

- Owner/auth 诊断错误统一继承 `DiagnosticError`，通过单一 allowlist 映射为 namespaced `PublicErrorDto`；未知错误不泄露异常文本。
- Fastify 使用同一个 Pino 实例和 telemetry adapter；TTY pretty、非 TTY JSON Lines；请求日志禁用 Fastify 默认重复输出，显式 HTTP 事件按 5xx/error、4xx/info、其他/info 记录。异常已记录的请求不会在 response hook 再重复记 error。
- Server 业务日志已迁移为 dotted event 与受限字段；RPC trace 保持 INFO 且只包含 shape 摘要。日志不记录 query、正文、凭据、host path 或原始运行时错误 message。
- 验证通过：Server tests 138 passed、全仓 typecheck；Server 触及 TS 文件格式检查通过。HTTP 捕获 sink 验证 query 隐私、status level 与错误不重复。
