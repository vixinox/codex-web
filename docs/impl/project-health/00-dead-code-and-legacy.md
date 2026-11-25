# Task 00：死代码与旧路径清理

## 状态与依赖

- 状态：**Implemented; focused verification passed**。
- 主规格：[Project Health](./README.md)。本任务不能覆盖或重定义主规格的不变量。
- 已按确认的兼容政策完成清理；Owner 旧错误码与 trust-store 仍按具体证据审查。

## 目标与范围

删除不再产生行为或只为已退休 REST/SSE bridge 服务的测试代码，减少维护者误以为旧 `/api/*` 仍可用的风险。

### 高置信度范围

- `packages/app/src/lib/bridge/owner-runtime.ts`：移除 `MODE === 'test'` 时的 `testBridge` fallback 及其 `/api/codex/*`、`/api/credentials*` fetch mapping。测试如需 Owner 行为必须显式安装 fake bridge 或 mock `getOwnerBridge`。
- `packages/app/src/app/chat/transcript/transcript-debug.ts`：删除 no-op `transcriptDebug`、仅服务该函数的 payload 类型及两个调用模块中的调用。
- 搜索被删除符号、退休 API 字符串与调用方，修正仍依赖 fallback 的测试 harness。

### 已确认清理范围

- `device-key-store.ts` 旧单 profile `current` 数据读写路径与仅供其使用的验证/加密 helper 已删除。旧 store 继续由 schema v3 升级删除；清理的是其单 profile API/helpers，不新增迁移。
- `relay-owner-socket.ts` 仅用于旧测试 Relay 的 `relay.client.connected` 握手 fallback 已删除；client 握手只由 `relay.ready` 触发。
- `/owner/manage`、`/app/manage` redirects 已删除。
- `owner/errors.ts` 旧错误码 mapping：迁移现行 throw sites 后再删。
- SQLite/trust-store legacy handling：不属于可直接清理项，除非另有已确认的数据兼容决策。

## 排除项

- 不重引入任何 `/api/*` 服务或 Guest/preview/旧登录兼容流程。
- 不删除 Relay 内部 ownerCode route/conflict 标识。
- 不删除有入口的启动页 mock preview、`/__dev/ui` 或其场景 fixture。
- 不顺手批量清理 lint warning、重命名无关模块或改业务行为。

## 完成条件

- `getOwnerBridge()` 在未连接时明确失败，不会发起 HTTP 请求；所有 App 测试仍显式注入 bridge。
- transcript rendering 不再调用无副作用调试钩子。
- 清理后的测试只覆盖仍存当前行为；没有保留用于旧 API fallback 的重复测试。
- 已确认的旧存储、Relay fallback 与 URL alias 清理均纳入；不恢复旧存储或旧 API。

## 验证

已验证：全仓 `pnpm test`、`pnpm typecheck`、触及文件 `oxfmt --check`、themes:check 通过。Schema coverage test 使用 Server 包内版本化 JSON fixture，与归档工作包文档解耦。

- `pnpm test:frontend`
- `pnpm typecheck`
- `pnpm exec oxfmt --check <touched-ts-files>`
- 搜索确认生产/测试源码无被删旧入口引用；运行 `pnpm --filter @codex-web/app themes:check` 若资产受触及（通常不需要）。
