# Owner 远程架构

状态：当前架构基线。本文是 Owner 远程控制、Relay、认证和设备信任的唯一总览入口。

## 适用范围与边界

Codex Web 是单 Owner、本地优先的 Codex 工作台。Owner Gateway 运行在 Owner 机器上，远程控制端必须经过一次性 bootstrap、账号认证、TOTP 或本机管理页批准，并登记为受信任设备。

本文覆盖本地 Owner、远程浏览器、Relay、E2EE transport、认证、设备生命周期和安全边界。产品不支持 Guest 运行时、Relay 账户、多 Owner 节点、离线业务队列或 `remote.device.invite`。Chat、Workspace、Settings 的全量 Owner WS 迁移属于后续工作。

## 系统拓扑

```text
Local Client  -> Owner Gateway -> Application Services -> Codex App Server

Remote Client -> Relay -> Owner RelayTransport -> Owner Gateway
```

本地客户端直接连接 Owner Gateway。远程客户端通过 Relay 建立 E2EE channel 后，进入同一个 Owner session runtime 和 Application Services。Relay 只维护连接路由、连接生命周期、协议版本、心跳和背压；它只转发 opaque encrypted payload，不保存或解析账户、session、设备、Owner method、Thread、事件或业务正文。

## 职责边界

- **App**：提供本地工作台、官方远程入口、登录/TOTP、设备密钥存储和 `/owner/manage` 管理页。页面只使用 UI-facing model，不接触私钥、宿主路径、API key 或原始 runtime payload。
- **Owner Gateway / Server**：负责 Better Auth、Owner session、资源归属、Application Services、Owner WebSocket、RelayTransport、trust store 和安全 DTO。身份、授权、设备身份和业务权限以 Owner 的验证结果为准。
- **Application Services**：是 Owner session、Credential、Project、Thread/Turn、事件、配对、设备批准、撤销和 trust reset 的业务入口，不依赖 Fastify request/reply、Relay socket 或具体数据库类型。
- **Relay**：只处理经过 admission 验证的 Owner/client attach、路由、替换、断开、重连和 opaque encrypted payload，不建立账户体系或业务持久化。
- **Protocol**：`@codex-web/protocol/owner` 定义 Owner request/response/notification/stream/cancel/close；`@codex-web/protocol/relay` 定义 attach、pairing、handshake、encrypted 和连接生命周期 frame；`relay/crypto` 定义 ECDH 与 AES-GCM channel。
- **Codex App Server**：是 Agent、Thread、Turn 和 Codex 原生历史的执行权威。它不负责 Owner session、设备信任或 Relay 权限。

本地 WebSocket 与 Relay data socket 都实现 transport-neutral `OwnerTransport`，统一进入 `OwnerSessionRuntime`。Gateway 不复制业务规则，只调用 Application Services 并投影安全 DTO。

## 认证与设备生命周期

远程入口使用 Owner 终端生成的一次性 HTTPS bootstrap URL。bootstrap capability 绑定 `nodeId`、当前 `trustEpoch`、用途和过期时间，凭据放在 URL fragment 中。浏览器读取后立即清除 fragment，避免进入 HTTP 日志、Referer 或后续链接；capability 本身不等于 Owner session。

远程登录先建立受限 pending/provisional session。该 session 只能查看自身绑定状态、打开认证 session、提交 TOTP 或请求设备信任，不能访问 threads、credentials、projects、Codex、events 或其他 Owner 业务。Better Auth 启用 TOTP twoFactor；recovery code 单次消费，轮换后旧 code 失效。临时 session 最长 30 分钟，不能通过普通续期延长。

新设备绑定有两条路径：

1. 密码登录后提交 TOTP；
2. 密码登录后，由本机 Owner 管理页显式批准当前一次性绑定请求。

两条路径都必须登记浏览器公钥并完成 paired admission。浏览器使用 Web Crypto 生成 ECDH P-256 密钥对，优先把不可导出的 `CryptoKey` 持久化到 IndexedDB，只提交公钥。私钥丢失、IndexedDB 被清除、记录损坏或浏览器不支持该持久化时，设备必须重新走 bootstrap，不降级为明文 localStorage 或 URL 存储。

`remote.device.trust` 成功后返回稳定 `deviceId` 和新的 paired client token。浏览器主动断开 bootstrap connection，再使用 paired admission 重连；不得在同一连接上原地升权。设备撤销立即关闭对应连接并拒绝后续握手。`remote.trust.reset` 轮换 trust epoch 和 Owner trust key、关闭全部远程连接并使旧凭据失效。临时 session 过期、登出、撤销或 trust epoch 变化时，客户端清理 session、密钥引用和连接状态。

## 协议合同

Owner protocol 使用版本化 `hello`、`ready`、`request`、`response`、`notification`、`stream.*`、`cancel` 和 `close` frame。Relay protocol 使用：

- Owner/client `relay.attach`，分别携带 Owner admission 或 paired/bootstrap client admission；
- `relay.ready`、`relay.client.connected`、`relay.client.disconnected` 和 `relay.forward`；
- pairing offer/accept/result；
- 双向 ECDH `handshake` 与加密确认 `handshake.ok`；
- 带唯一 sequence/nonce 的 AES-GCM `encrypted` payload。

Relay attach 必须绑定节点、角色、连接 ID、trust epoch、有效期和部署 admission secret。设备身份最终由 Owner 从 E2EE 握手中的客户端公钥推出，不能信任客户端自报的 `deviceId`。连接状态依次经过 `awaiting_handshake`、`handshaking`、`open`；重复握手、握手窗口内错误类型的密文、握手完成后的明文配对帧、未知版本、畸形或超限 frame 都必须拒绝并关闭连接。

E2EE 派生上下文绑定协议版本、node、trust epoch、双方公钥和连接角色；共享值为全零、AEAD 标签错误、序列重放或错序都必须失败。Owner 只有在设备授权和 `handshake.ok` 验证完成后才把远程连接交给 Owner session runtime。Relay 永远不读取 Owner method、session、账号、设备公钥或业务正文。

## 持久化与安全边界

- Owner 控制面使用 `CODEX_DATA_ROOT/owner.sqlite`，保存认证 session、Project、Credential、current credential 和安全投影后的 Owner event journal。
- Remote trust、节点密钥和 Credential 加密密钥保持在独立的本地文件或 OS secret 边界，不放入 Relay 或业务数据库。
- Codex Thread transcript 由 Codex Home/App Server 管理；SQLite 不保存原始 runtime payload、API key 明文或宿主路径。
- 浏览器私钥不得进入 URL、localStorage、日志、错误、React state 序列化结果、缓存或服务端请求。
- 浏览器只接收安全投影，不接收 API key、`CODEX_HOME`、rollout 路径、Git remote、宿主路径或 App Server 进程信息。
- Relay 无业务持久化。Relay 重启会中断远程连接；客户端重新连接后由 Owner snapshot/cursor 恢复状态，不从 Relay 补取业务事件。

## 当前实现状态

已实现并纳入当前代码基线：

- Better Auth twoFactor、recovery/pending binding 合同和 provisional remote session 权限限制；
- 官方 bootstrap fragment 消费与地址栏清理；
- 浏览器 ECDH P-256 设备密钥和 IndexedDB 存储接口；
- 本机受保护的 `/owner/manage` 页面；
- 绑定请求状态、TOTP/管理页批准、设备列表、单设备撤销和 trust reset；
- Relay bootstrap/paired admission、E2EE handshake、`handshake.ok` 和 Owner remote transport；
- `remote.device.invite` 已移除，不保留受信任设备创建新设备邀请的产品路径。

已知限制和后续工作：

- 完整 app typecheck 仍受仓库中既有缺失 bridge adapter 模块影响；这不是远程架构文档迁移引入的问题。
- Relay/Vite/Owner 的真实浏览器链路仍需要由用户启动服务后手工验收，包括 bootstrap 清理、登录、TOTP、管理页批准、paired 重连、临时 session 过期、撤销、trust reset、Relay 断线和 IndexedDB 清除后的重新配对。
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

远程链路的自动化和手工验收应覆盖：协议非法输入、attach 冒认、pairing 过期/重放、双向握手确认、Owner status、临时 session 权限、设备批准、单设备撤销、全部 trust reset、Relay 重启重连、事件 cursor 恢复、慢消费者和本地 Owner 回归。自动化不得依赖真实公共 Relay 或真实用户凭据。
