# 当前行为：认证与远程接入

本文记录当前实现中 Owner 认证、Owner/Relay 远程接入和本地管理 CLI 的行为。它是实现现状快照，不是产品目标、协议合同或验收通过声明。架构与 API 合同仍分别以对应文档为准。文末的 2026-10-28 验证注记只记录当次自动化结果和未完成的手工验收。

证据标记：

- **代码/测试：** 行为可在所引实现或定向自动化测试中确认；这不代表已通过浏览器或真实服务验收。
- **手工记录：** 既有验收记录报告了实际命令或环境检查。
- **未验证：** 既有记录说明用户可见流程或真实服务行为尚未实际运行。不能仅凭代码存在推断成功。

## 本机 Owner 创建与安全设置

应用通过本地登录/设置流程提供 Owner 账户创建。服务端只接受来自已配置可信来源的首次邮箱注册，拒绝标记为远程的请求，串行处理注册请求，并在已有 Owner 时拒绝再次创建。TOTP 设置、TOTP 验证和恢复码确认端点也要求可信本机请求。设置界面展示 TOTP 配置信息和恢复码，并要求用户确认已保存。若会话的 `twoFactorEnabled` 为 false，受保护路由会将其送回登录/设置流程；Owner WebSocket 也只允许这类未完成设置的会话调用安全设置方法。

**证据：** `packages/server/src/http/auth-routes.ts`、`packages/app/src/app/composition/screens/login-screen.tsx`、`packages/app/src/app/entry/route-components.tsx`、`packages/server/src/owner/session-runtime.ts`；定向覆盖见 `packages/server/src/http/auth-routes.test.ts`、`packages/server/src/owner/session-runtime.test.ts` 和 `packages/server/src/owner/application-services.test.ts`。

**未验证：** 完整的首次 Owner 浏览器流程和真实浏览器中的刷新恢复尚未实测。

## 远程登录与 Owner 指纹

远程登录界面接受 Relay 地址和 9 位 Owner code，查询 Relay 可用性，并区分在线、离线和不可达状态。发现 Owner 后，界面显示其公钥指纹输入框。用户把从本机 Owner 管理页取得的指纹填入并选择“验证并保存”；应用将其与远程指纹检查观察到的值比较，匹配后按 Relay 地址和节点 ID 保存到本地存储。指纹获确认前不能提交登录凭据。账号登录通过 login-candidate E2EE 连接提交邮箱、密码以及 TOTP 或恢复码。认证成功后，客户端以 paired device 身份重新连接；远程连接成功后才导航到工作区并保存最近使用的目标。

**证据：** `packages/app/src/app/composition/screens/login-screen.tsx`、`packages/app/src/lib/remote/owner-code-preference.ts`、`packages/app/src/lib/remote/relay-owner-socket.ts`、`packages/app/src/lib/remote/admission.ts`、`packages/server/src/owner/session-runtime.ts`；定向覆盖见 `packages/app/src/lib/remote/relay-owner-socket.test.ts`、`packages/app/src/lib/remote/admission.test.ts`、`packages/app/src/lib/remote/owner-code-preference.test.ts` 和服务端 application/session tests。

**未验证：** 尚无真实浏览器或在线 Owner/Relay 验收记录。Owner 管理页会显示指纹，但人工比对流程尚未在浏览器中验收。

## 远程会话恢复与注销

浏览器在 IndexedDB 中保存设备密钥和远程会话记录。会话 token 由不可导出的 AES-GCM key 加密；加密记录绑定 Relay 地址、Owner code、节点 ID、设备 ID、Owner ID 和过期时间。应用启动时读取配对设备与加密会话，检查元数据和过期时间，解密 token，再通过远程 runtime 恢复 Owner session。无效、过期或无法解密的记录会被清除。本机 Owner 路径使用 Better Auth session cookie。显式远程注销和凭据清理由远程 runtime/设备存储路径处理。

**证据：** `packages/app/src/lib/remote/device-key-store.ts`、`packages/app/src/app/entry/route-components.tsx`、`packages/app/src/lib/owner-ws/use-owner-runtime.ts`、`packages/app/src/lib/owner-ws/owner-runtime.ts`；定向覆盖见 `packages/app/src/lib/remote/device-key-store.test.ts`、runtime tests 和服务端 session tests。

**未验证：** 真实浏览器重启后的持久化、完整注销行为以及 Relay 中断后的恢复尚未端到端验收。

## QR 登录

已认证的 Owner 管理页可以签发、显示和取消登录 QR，并显示服务端报告的状态与过期时间。服务端将短期 QR capability 保存在进程内存中，并在兑换时原子消费；兑换流程创建 session、登记设备，之后客户端建立 paired admission 并持久化远程会话。登录页提供摄像头扫描和图片上传入口，并共用 QR 解码路径。

**证据：** `packages/server/src/remote/login-qr-capability-store.ts`、`packages/server/src/qr-session-issuer.ts`、`packages/server/src/owner/application-services.ts`、`packages/app/src/app/owner/owner-manage-screen.tsx`、`packages/app/src/app/owner/login-qr-scanner.tsx`、`packages/app/src/lib/remote/admission.ts`；定向覆盖见 `packages/server/src/remote/login-qr-capability-store.test.ts`、服务端 application-service tests 和 `packages/app/src/app/owner/login-qr-scanner.test.ts`。

**未验证：** 摄像头权限与生命周期、浏览器/设备兼容性、图片上传恢复，以及从扫描 QR 到 paired session 的完整流程尚未手工验收。

## 设备、信任和 Owner code 管理

Owner 管理界面提供 Owner 公钥指纹、登录 QR 控件、安全状态和已登记设备管理。Owner 管理方法支持设备列表/撤销、Owner code 显示/轮换和 trust reset。Relay 在内存中维护活跃 Owner code 路由，只在 Owner 在线时解析 code，并拒绝在线冲突。设备撤销和 trust reset 通过 Owner services 与远程 trust store 实现。

**证据：** `packages/app/src/app/owner/owner-manage-screen.tsx`、`packages/app/src/app/owner/owner-management-model.ts`、`packages/server/src/owner/methods.ts`、`packages/server/src/owner/application-services.ts`、`packages/server/src/remote/trust-store.ts`、`packages/relay/src/relay-router.ts`；定向覆盖见 owner-management、trust-store 和 relay-router tests。

**未验证：** 在线远程连接遇到撤销/reset 时的实际效果，以及在线轮换 code 后的重连行为，尚未手工验收。

## 本地管理 CLI

仓库入口为 `pnpm owner:manage`，实现位于 `packages/server/scripts/owner-cli.ts`。支持命令包括 `auth status`、`auth totp reset`、`auth recovery rotate`、`auth sessions revoke-all`、`devices list`、`devices revoke <device-id>`、`devices revoke-all`、`owner-code show`、`owner-code rotate` 和 `trust reset`。CLI 使用与 Owner 相同的 data-root 单实例锁；Owner 正在运行时会拒绝执行。Owner 停止后，CLI 启动临时受管 runtime 并复用 Owner application services。TOTP reset 要求交互终端、明确确认，并以隐藏输入读取密码。破坏性操作要求确认；轮换生成的恢复码只显示一次。

**证据：** `package.json`、`packages/server/package.json`、`packages/server/scripts/owner-cli.ts`、`packages/server/src/owner/cli.ts`、`packages/server/src/owner/cli-runtime.ts`、`packages/server/src/owner/instance-lock.ts`；定向覆盖见 `packages/server/src/owner/cli.test.ts` 和 `packages/server/src/owner/instance-lock.test.ts`。

**手工记录/未验证：** 曾记录停止状态下的 `auth status` 和恢复码轮换检查；Owner 运行时的拒绝行为和完整 CLI 场景仍未全面实测。没有完整的在线 Owner/Relay CLI 验收记录。

## 验证注记：2026-10-28

当次记录显示 `pnpm typecheck`、定向 server、protocol、Relay、app 测试和格式检查通过。完整 app 测试记录为 257/265，其中 8 项既有 sidebar controller failures；`pnpm lint` 因仓库 warning baseline 失败。当次未进行真实浏览器或在线 Owner/Relay 验收。曾检查停止状态下的 CLI `auth status` 和恢复码轮换；Owner 运行时拒绝行为及其余 CLI 场景没有完成验证。上述结果仅描述当次运行，不证明之后的变更已通过验收。
