# Owner 远程架构

状态：当前架构基线。本文是 Owner 远程控制、Relay、认证和设备信任的唯一总览入口。

认证、Owner/Relay 远程接入和 CLI 的当前实现快照见 [`current-behavior.md`](./current-behavior.md)。本文继续作为 Owner 远程控制、Relay、认证和设备信任的架构总览。

## 适用范围与边界

Codex Web 是单 Owner、本地优先的 Codex 工作台。Owner Gateway 运行在 Owner 机器上，远程控制端通过 Relay 的 E2EE transport 接入同一 Owner runtime。当前认证和新设备 onboarding 的实现情况见 [`current-behavior.md`](./current-behavior.md)；本文中的架构与安全边界仍以本文内容为准。

本文覆盖本地 Owner、远程浏览器、Relay、E2EE transport、认证、设备生命周期和安全边界。产品不支持 Guest 运行时、Relay 账户、多 Owner 节点、离线业务队列或 `remote.device.invite`。Chat、Workspace、Settings 的全量 Owner WS 迁移属于后续工作。

## 系统拓扑

```text
Local Client  -> Owner Gateway -> Application Services -> Codex App Server

Remote Client -> Relay -> Owner RelayTransport -> Owner Gateway
```

本地客户端直接连接 Owner Gateway。远程客户端通过 Relay 建立 E2EE channel 后，进入同一个 Owner session runtime 和 Application Services。Relay 只维护连接路由、连接生命周期、协议版本、心跳和背压；它只转发 opaque encrypted payload，不保存或解析账户、session、设备、Owner method、Thread、事件或业务正文。

## 职责边界

- **App**：提供本地工作台、官方远程入口、Passkey/recovery 登录、设备密钥存储和 `/app/settings/connection` 管理页。页面只使用 UI-facing model，不接触私钥、宿主路径、API key 或原始 runtime payload。
- **Owner Gateway / Server**：负责 Owner-only Passkey/recovery/session、资源归属、Application Services、Owner WebSocket、RelayTransport、trust store 和安全 DTO。身份、授权、设备身份和业务权限以 Owner 的验证结果为准。
- **Application Services**：是 Owner session、Credential、Project、Thread/Turn、事件、登录 QR、设备登记/撤销和 trust reset 的业务入口，不依赖 Fastify request/reply、Relay socket 或具体数据库类型。
- **Relay**：只处理经过 admission 验证的 Owner/client attach、路由、替换、断开、重连和 opaque encrypted payload，不建立账户体系或业务持久化。
- **Protocol**：`@codex-web/protocol/owner` 定义 Owner request/response/notification/stream/cancel/close；`@codex-web/protocol/relay` 定义 attach、handshake、encrypted 和连接生命周期 frame；`relay/crypto` 定义 ECDH 与 AES-GCM channel。
- **Codex App Server**：是 Agent、Thread、Turn 和 Codex 原生历史的执行权威。它不负责 Owner session、设备信任或 Relay 权限。

本地 WebSocket 与 Relay data socket 都实现 transport-neutral `OwnerTransport`，统一进入 `OwnerSessionRuntime`。Gateway 不复制业务规则，只调用 Application Services 并投影安全 DTO。

## Owner 身份与远程接入

Owner 是单一本地身份，不需要用户名、邮箱、密码或 TOTP 即可启动。WebAuthn 远程 profile 使用经过校验的 `CODEX_APP_ORIGIN` / `CODEX_APP_RP_ID`，本地 profile 固定为 `http://localhost:5173` / `localhost`，不能跨 profile 使用。Owner-code 是 Relay 范围内 9 位在线路由标识，不承担授权。Relay 仅在内存中维护 Owner-code 在线映射；远程 Passkey/recovery 使用 `admission: 'login'`，首次 bootstrap 使用单独的 `bootstrap_reference` admission。

Owner-code 可由已认证的本机管理页查看或轮换。在线冲突会拒绝注册；Relay 不持久化目录，离线 Owner 不保留号码预约。

首次远程接入通过 Owner 监听就绪后输出的一次性 five-minute bootstrap reference。Relay 只在 Owner 在线时维护 reference-to-node 路由；grant 和授权材料留在 Owner 的受保护交换中。兑换前校验 Owner、node、trust epoch、origin 和首次 E2EE client key；兑换创建唯一首台设备/session，不注册 Passkey，也不授予设备管理或 trust-reset 权限。普通管理 QR 是短时单次 request reference，不独立创建 session。内存 grant 在 Owner 重启后失效。

远程 Passkey 可用于后续登录；十个高熵 recovery code 只持久化哈希、单次消费。Recovery 必须完成新 Passkey 注册、轮换整批 recovery code 并撤销既有远程 session。Session token 仅返回一次，数据库存哈希；会话受 30 天 idle / 90 天 absolute TTL、device revocation 和 trust epoch 约束。

配对凭据只建立设备传输身份，不单独创建 Owner session。浏览器将 Owner session bearer 通过 IndexedDB 中不可导出的 AES-GCM key 加密保存，并与 Relay、ownerCode、nodeId、deviceId 和 expiresAt 做认证绑定；token 只在 runtime 内存解密使用。设备撤销或 trust reset 关闭连接并清除本地会话/设备密钥。

## 协议合同

Owner protocol 使用版本化 `hello`、`ready`、`request`、`response`、`notification`、`stream.*`、`cancel` 和 `close` frame。Relay protocol 使用：

- Owner/client `relay.attach`，分别携带 Owner admission、paired admission 或受限 login-candidate admission；
- `relay.ready`、`relay.client.connected`、`relay.client.disconnected` 和 `relay.forward`；
- 双向 ECDH `handshake` 与加密确认 `handshake.ok`；
- 带唯一 sequence/nonce 的 AES-GCM `encrypted` payload。

Relay attach 必须绑定节点、角色、连接 ID、trust epoch 和部署 admission secret。设备身份最终由 Owner 从 E2EE 握手中的客户端公钥推出，不能信任客户端自报的 `deviceId`。连接状态依次经过 `awaiting_handshake`、`handshaking`、`open`；重复握手、握手窗口内错误类型的密文、未知版本、畸形或超限 frame 都必须拒绝并关闭连接。

E2EE 派生上下文绑定协议版本、node、trust epoch、双方公钥和连接角色；共享值为全零、AEAD 标签错误、序列重放或错序都必须失败。Owner 只有在设备授权和 `handshake.ok` 验证完成后才把远程连接交给 Owner session runtime。Relay 永远不读取 Owner method、session、账号、设备公钥或业务正文。

## 持久化与安全边界

- Owner 控制面使用 `CODEX_DATA_ROOT/owner.sqlite`，保存认证 session、Project、Credential、current credential 和安全投影后的 Owner event journal。
- Remote trust、节点密钥和 Credential 加密密钥保持在独立的本地文件或 OS secret 边界，不放入 Relay 或业务数据库。
- Codex Thread transcript 由 Codex Home/App Server 管理；SQLite 不保存原始 runtime payload、API key 明文或宿主路径。
- 浏览器私钥不得进入 URL、localStorage、日志、错误、React state 序列化结果、缓存或服务端请求。
- 浏览器只接收安全投影，不接收 API key、`CODEX_HOME`、rollout 路径、Git remote、宿主路径或 App Server 进程信息。
- Relay 无业务持久化。Relay 重启会中断远程连接；客户端重新连接后由 Owner snapshot/cursor 恢复状态，不从 Relay 补取业务事件。

## 当前实现状态

当前实现包含 Owner-only SQLite schema、无凭据启动、Passkey/recovery domain、first-session bootstrap、受限 bootstrap session、Relay 在线 owner-code 映射、加密 IndexedDB Owner session、设备撤销与 trust reset、CLI IPC 和显式数据库 reset。实现快照见 [current behavior baseline](./current-behavior.md)。

已知限制和后续工作：

- CLI 在 Owner 运行时走 allowlisted 本机 IPC，Owner 停止时才获取 instance lock 并启动短生命周期 runtime。当前部署模型限定为单个本地操作系统用户；不额外承诺共享 Windows 主机上的自定义 named-pipe ACL 隔离。
- Relay/Vite/Owner 的真实浏览器链路尚未手工验收。须覆盖首次 grant 单次兑换、指纹拒绝、Passkey/recovery、QR 扫码和上传、session 恢复、注销、撤销、trust reset、Owner/Relay 重启与离线重连。
- Chat、Workspace、Settings 的全量 Owner WS 迁移不属于本远程入口基线。

## 验证要求

服务端、协议和 Relay 变更至少运行：

```text
pnpm --filter @codex-web/server test
pnpm --filter @codex-web/protocol test
pnpm --filter @codex-web/relay test
pnpm typecheck
pnpm exec oxfmt --check <修改的 TypeScript 文件>
pnpm lint:staged
```

后续验证范围按具体变更和当前项目约束确定；自动化不得依赖真实公共 Relay 或真实用户凭据。

## Acceptance status (2026-10-30)

The current implementation has passed the server suite, typecheck, focused protocol/Relay checks, formatting, and diff checks. It has not passed live browser/Relay acceptance. The next implementation session must begin with [`docs/acceptance-findings.md`](acceptance-findings.md), especially the bootstrap-reference routing seam: the current Relay routes by owner code, so a reference-only URL requires Owner-to-Relay registration and revocation before the printed URL can be shortened. Local/production App origin and WebAuthn RP ID are also not yet environment-configurable; local startup currently prints the production origin and embeds the full payload, producing an oversized terminal QR.
