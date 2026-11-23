# 01 本机授权边界与远程认证收敛

状态：完成并验证。先读 [主规格](README.md)，其中接口、默认与不变量是权威。

目标：本机连接直接获得连接作用域 Owner；Passkey/数据库 session 只服务远程。范围是 server、共享 Owner protocol、Vite listener/proxy 配置；不修改页面或新增 CLI 能力。

## 入口与责任

- `packages/server/src/owner/websocket.ts`：升级前本机 peer/Host/Origin 检查，注入 localAdmission。
- `session-runtime.ts`：hello 的 localAdmission、带 ownerId 的 authenticated ready；业务仍走认证守卫。
- `application-services.ts`、`auth-domain.ts`、`methods.ts`：只剩单远程 RP、Passkey 状态、appOrigin 返回、远程 session；删除 localEnrollment/ticket/profile 分支。step-up 只约束远程签发邀请。
- `packages/protocol/src/owner/`：在现有 ready frame 定义/parser 增加受约束 ownerId，更新协议测试，不扩展 Relay grant。
- `config.ts`、`.env.example`、`packages/app/vite.config.ts`：区分固定本机 origins 与远程配置；RP 由远程 origin 推导，纯本地可无远程配置，Relay 配置要求远程 HTTPS origin；dev/preview loopback。
- `db/schema.ts`、`database.ts`、`scripts/reset-local-database.ts`：删除本地认证 schema/冗余标记，session.deviceId 非空，旧结构检测与显式重建。复用 trust-store.clearPeers；不迁移、不执行真实重建作为单元测试。

## 接口与依赖

可先独立实施；对 02 交付 authenticated ready.ownerId、`passkeyAvailable`、`appOrigin`，以及 enrollment issue/status 的 origin。主规格已冻结字段，不保留旧字段别名。为 session-runtime 增加的 localAdmission 是服务器内部 options，只在 local transport 生效。

本机 admission 的 sessionId 维持订阅归属；断线新连接重新订阅。远程 session 必须有有效 deviceId，local transport 不用 bearer恢复，也不执行 Passkey认证。保持现有 IPC/CLI管理接口。

## 验收与验证

- 最小聚焦：`pnpm --filter @codex-web/server exec tsx --test src/owner/websocket.test.ts src/owner/session-runtime.test.ts src/owner/auth-domain.test.ts src/owner/application-services.test.ts src/database.test.ts src/config.test.ts`；必要的 reset fixture 放在 server 现有测试目录，加入实际命令。
- `pnpm test:protocol`、`pnpm typecheck`、触及文件 oxfmt；全仓测试由 03 统一结束前执行。
- 本机无需 token即可调用 authenticated 方法；拒绝主规格完整来源矩阵与 forwarded 伪装。使用真实 WebSocket adapter测试，含 Vite代理保留 Host 的合同；不是只测试辅助谓词。
- 远程无认证不可调用业务；localAdmission + relay 必须失败；旧本地 session不可恢复为远程。Passkey注册/签名/重新连接恢复通过。
- 新库无旧结构；旧库启动失败且字节/行不被改写。临时 reset 同时清 SQLite与peers，保留node identity和无关Codex文件，锁冲突安全失败，所有句柄finally关闭。

可自行决定私有 helper 命名、测试 fixture 组织；不能放宽origin/Host、修改数据保留决策或另建授权协议。真实数据库重建/服务重启归03，需遵守服务所有权与现有交互命令。
