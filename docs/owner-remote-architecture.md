# Owner 远程架构

状态：2026-10-31 确定的新架构，设备 enrollment 迁移已接入。自动化与手工验收状态见 [`current-behavior.md`](./current-behavior.md)。本文是 Owner 远程控制、设备信任和登录入口的规范性总览。

## 适用范围与边界

Codex Web 是单 Owner、本地优先的 Codex 工作台。Owner Gateway 运行在 Owner 机器上，远程浏览器通过 Relay 的 E2EE transport 接入同一个 Owner runtime。产品不支持 Guest 运行时、Relay 账户、多 Owner 节点、离线业务队列或匿名远程工作区。

Owner 是唯一的身份和业务权威。浏览器不直接连接 Codex App Server，也不接收 API key、宿主路径、`CODEX_HOME`、rollout 路径、Git remote 或 App Server 进程信息。

## 系统拓扑

```text
Local browser -> Owner Gateway -> Application Services -> Codex App Server

Remote browser -> Relay -> Owner RelayTransport -> Owner Gateway
```

Relay 只负责 opaque E2EE payload 的路由、连接生命周期、协议版本、心跳和背压。它不解析 Owner method、session、设备、Passkey、Thread、事件或业务正文，也不建立账户体系和业务持久化。

## 设备信任模型

远程访问只有两类用户可见状态：已保存的 connection profile，以及设备 enrollment invitation。

- **已保存 connection profile**：由浏览器在成功加入后保存，包含连接所需的 `relayUrl`、`nodeId`、`deviceId`、配对 client token、trust epoch 和受保护的 Owner identity 绑定。私钥和 session bearer 只放在浏览器的安全存储中，session bearer 以不可导出的 AES-GCM key 加密。
- **设备 enrollment invitation**：用于没有本地 connection profile 的浏览器。它由已登录设备、CLI 或 Owner 本机生成，是短期、单次、可取消的 URL/QR。消费时绑定新浏览器的设备公钥，并由 Owner 原子登记设备和 session。它是新设备加入机制，不是普通登录页面上的输入项。

首次干净启动和后续新增设备都使用 enrollment invitation。首次启动时邀请由 Owner 本机或 CLI 生成；之后可由当前有效的已配对设备批准新浏览器。已配对设备生成邀请属于高风险操作：已有 remote Passkey 时执行 step-up；没有 Passkey 时必须依赖当前有效的已配对设备 session。

Owner code 和 fingerprint 不再是用户认证概念。Relay 可能仍需要内部路由标识，E2EE handshake 仍必须验证 Owner public key；这些字段由 enrollment 或 connection profile 自动携带和校验，不进入普通登录 UI，也不要求用户抄写或确认随机字符串。首次 enrollment 建立 Owner identity 绑定；后续连接发现 identity 变化时必须失败并要求重新加入，不能静默接受新 Owner。

## 登录与会话生命周期

### 陌生环境

浏览器没有本地 connection profile 时，远程登录页不提供 Owner code、fingerprint、普通管理 QR 或手工候选登录表单。用户只能打开来自已登录设备、CLI 或 Owner 本机的 enrollment URL/QR；有效邀请自动完成设备登记、session 建立和 connection profile 保存。

### 已知环境

浏览器读取本地 connection profiles，展示连接名称、最近状态和 `Test connection`。用户选择连接后，客户端优先使用配对设备密钥和加密 session 恢复；session 过期或失效时，才在该已知连接上调用 remote Passkey。没有 remote Passkey 时，界面回到“添加设备”邀请流程，不重新暴露 Owner code 或 fingerprint。

`Test connection` 只检查 Relay 可达、Owner 在线、E2EE handshake、设备授权和 session 状态；它不能登记设备、替代 Passkey 或自动提升权限。

### 本地环境

localhost 是独立的本地入口，使用 `http://localhost:5173` / `localhost` 的 WebAuthn profile。远程登录页不再提供 `This machine` 或 local/remote 模式切换；本地浏览器访问 localhost 时使用独立的 local Passkey 登录页面。远程 App origin 只负责已保存的远程连接和 enrollment deep link。

### 恢复与撤销

设备撤销、session 撤销和 trust reset 由 Owner 管理面执行。trust reset 使所有远程 session、待处理 invitation、设备密钥绑定和握手 trust epoch 失效。所有远程设备丢失时，Owner 本机或 CLI 是唯一恢复根，必须能生成新的 enrollment invitation；不存在远程 recovery code 登录路径。

## 安全边界

- enrollment invitation 必须随机、短时、单次消费、可取消、重放失败，并在成功消费、过期、撤销、Owner/Relay 重启和 trust reset 时失效。
- 新设备公钥必须在 Owner 侧原子绑定到设备记录；设备身份不能信任浏览器自报的 `deviceId`。
- paired session 受 idle/absolute TTL、设备撤销和 trust epoch 约束；session token 只返回一次并只保存服务端哈希。
- Passkey 私钥永不离开浏览器。Passkey 只验证用户持有凭据；Owner 仍负责会话签发、设备登记和权限控制。
- Owner public key 的自动校验必须保留，但 fingerprint 只作为内部 identity pinning 数据，不作为每次登录的人工步骤。

## 组件职责

- **App**：管理本地 connection profiles、设备邀请 deep link、配对恢复、remote Passkey、设备测试和用户可见的设备状态；不接触私钥明文、API key、宿主路径或原始 runtime payload。
- **Owner Gateway / Server**：负责 Owner 身份、Passkey/session、设备 enrollment、设备撤销、trust reset、应用服务和安全 DTO。
- **Application Services**：提供设备邀请、认证、会话、设备生命周期和 Owner 管理操作；不依赖具体 HTTP 或 Relay socket 实现。
- **Relay**：只处理已验证的 Owner/client attach、enrollment reference 路由、E2EE payload 和连接生命周期。
- **Protocol**：分别定义 Owner WebSocket 和 Relay attach/handshake/encrypted frame；用户可见的连接配置不等同于 Relay 内部身份字段。

## 当前迁移边界

旧 Owner code、fingerprint、first-session 和普通 login QR 实现只作为历史基线；当前源码已切换到设备 enrollment 与多 connection profile 模型。最终自动化和用户手工浏览器验收结果见 [`current-behavior.md`](./current-behavior.md)。不得重新扩展旧的管理 QR 或 Owner code 登录流程。
