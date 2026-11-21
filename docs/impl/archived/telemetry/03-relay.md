# 任务 03：Relay 日志与连接错误

## 状态和依赖

- 状态：Complete。
- 决策源：[主规格](./development-spec.md)；契约：[任务 00](./00-contract-and-protocol.md)。
- 可并行：与任务 01/02 并行。不得在 Relay wire 中引入 Owner public error DTO。

## 目标与 ownership

使用 `@codex-web/telemetry/bun` 建立 Relay 结构化日志；将 router/app 的 string reasons 改为有类型、稳定 `relay.*` 错误分类；在 WebSocket 边界集中映射安全 close status/reason。范围为 `packages/relay/**`，不得修改 App/Owner/Protocol，不解析 encrypted payload。

## 当前入口

- `relay-router.ts`: `RelayAttachResult` string union、多个 attach rejection、removeSession(reason:string)、close frame reason 和连接通知。
- `app.ts`: `relayLog()` 与 attach/enrollment/parser/forward 日志、WebSocket close reason。
- `main.ts`: Bun.serve startup/config，是 logger 初始化与 dependency injection 入口。
- 现有 tests 在 `relay-router.test.ts`、`app.test.ts`。

## 实施要求

- router 输出 discriminated typed internal errors，不暴露未经校验的自由字符串；每种 attach、reference、frame、capacity、peer lifecycle failure 都能生成稳定 code。
- logger 在 startup 构建并注入 app/router；所有事件为 dotted stable name，至少包含 `service=relay` 和必要 role/reason/connection metadata。只记录 allowlisted, bounded identifiers；从不记录 ownerToken、clientToken、ownerCode、reference、session secret、frame payload/encrypted body。
- 对未认证 attach caller 统一拒绝外观：相同 close code/reason 与 frame 语义，不能借 code/message 差异探测在线节点、错误 token、capacity 或 paired/enrollment 授权差异。允许仅在可信 Relay 内部日志记录细分原因。
- 现有 owner code conflict 的已知内部路由冲突行为按主规格保留；日志只记录 stable conflict event，不记录 ownerCode。任何外部差异须保持已有 route contract 并由测试证明。
- enrollment register/unregister failure、invalid frame、oversized/non-text、session missing、invalid forwarding、slow consumer、peer disconnect、replaced、closed by owner 均集中映射到粗粒度 close code/reason，并记录内部 code（必要时按 level 限流）。
- 连接生命周期日志应成对可追踪但不过量：attach accepted/rejected、connection closed/replaced、enrollment reference state；close/reconnect 不对每个 opaque forwarded frame 产生日志。
- Bun adapter 输出遵守 `LOG_LEVEL`，TTY human readable、non-TTY JSONL；sink failure 不能导致 WebSocket callback 抛出或影响 router cleanup。

## 验收与验证

- Router tests: typed failure for invalid/unauthorized/capacity/duplicate/conflict; close mapping for replace/disconnect/slow consumer/owner close; identifiers sanitized.
- App tests: all unauthenticated attach rejects externally indistinguishable; enrollment/reference/frame failure close mapping; successful lifecycle logs are structured; captured logs contain no tokens, ownerCode, reference or payload; no log per forwarded encrypted frame.
- Run `pnpm --filter @codex-web/relay test`, relay typecheck, root `pnpm typecheck`, and touched TS `oxfmt --check`.
- Manual post-implementation acceptance: exercise valid owner/client attach, bad auth and capacity failures, enrollment register/revoke and reconnect; confirm same externally visible rejection policy and readable/JSON Lines log output.

## 排除项

不改 Relay protocol version/frames、HTTP health contract、routing/auth algorithm、E2EE、Relay account model 或 Owner UI errors。

## 完成结果

- Router attach、enrollment、frame forwarding 与连接生命周期失败改为 telemetry `relay.*` code；WebSocket close frame 由 `close-policy.ts` 集中投影。
- Bun startup 创建并注入共享 logger；日志使用有界字段，不包含 token、ownerCode、enrollment reference 或 opaque forwarded payload。未认证 attach 拒绝保持相同 `1008 attach_rejected` 外观，已有 owner-code conflict 行为保留。
- 验证通过：Relay tests 27 passed、Relay typecheck、触及 TS 文件的 `oxfmt --check`。并行期间根 typecheck 的失败来自 App/Server 临时状态，已由各包检查覆盖并将在集成阶段重跑。
