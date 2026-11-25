# Owner 远程架构

本文是 Owner 远程控制、设备信任和登录入口的现行规范性总览。实现位置可从[系统架构](architecture.md)进入；方法和 wire shape 以[API 契约](api/README.zh-CN.md)为准。

## 适用范围与边界

Codex Web 是单 Owner、本地优先的 Codex 工作台。Owner Gateway 运行在 Owner 机器上，远程浏览器通过 Relay 的 E2EE transport 接入同一个 Owner runtime。产品不支持 Guest 运行时、Relay 账户、多 Owner 节点、离线业务队列或匿名远程工作区。

Owner 是唯一的身份和业务权威。浏览器不直接连接 Codex App Server；已认证 Owner 通过应用接口接收业务正文、路径、命令、diff 和交互结果，内容不再经过保密性过滤。凭据库、私钥、服务端密钥和认证内部对象不新增读取入口，也不提供任意原始 RPC 透传。

## 系统拓扑

```text
Local browser -> Owner Gateway -> Application Services -> Codex App Server

Remote browser -> Relay -> Owner RelayTransport -> Owner Gateway
```

Relay 只负责 opaque E2EE payload 的路由、连接生命周期、协议版本、心跳和背压。它不解析 Owner method、session、设备、Passkey、Thread、事件或业务正文，也不建立账户体系和业务持久化。

## 设备信任模型

远程访问只有两类用户可见状态：已保存的 connection profile，以及一次性登录链接（enrollment invitation）。

- **已保存 connection profile**：由浏览器在成功加入后保存，包含连接所需的 `relayUrl`、`nodeId`、`deviceId`、配对 client token、trust epoch 和受保护的 Owner identity 绑定。私钥和 session bearer 只放在浏览器的安全存储中，session bearer 以不可导出的 AES-GCM key 加密。
- **一次性登录链接（enrollment invitation）**：由已登录设备、CLI 或 Owner 本机生成，是短期、单次的 URL/QR。消费时验证浏览器设备公钥；首次登记设备，已知公钥复用 deviceId，并签发新 session。Passkey 可选；失败只清本次授权，不撤销已有设备。Web 可取消待使用链接；CLI 仅生成，过期和替换自动失效。

首次干净启动和后续新增或重新登录浏览器都使用一次性登录链接。首次启动时链接由 Owner 本机或 CLI 生成；之后可由当前有效的已配对设备批准新浏览器或重新登录。已配对设备生成邀请属于高风险操作：已有 remote Passkey 时执行 step-up；没有 Passkey 时必须依赖当前有效的已配对设备 session。

Owner code 和 fingerprint 不再是用户认证概念。Relay 可能仍需要内部路由标识，E2EE handshake 仍必须验证 Owner public key；这些字段由 enrollment 或 connection profile 自动携带和校验，不进入普通登录 UI，也不要求用户抄写或确认随机字符串。首次 enrollment 建立 Owner identity 绑定；后续连接发现 identity 变化时必须失败并要求重新加入，不能静默接受新 Owner。

## 登录与会话生命周期

### 陌生环境

浏览器没有本地 connection profile 时，远程登录页不提供 Owner code、fingerprint、普通管理 QR 或手工候选登录表单。用户只能打开来自已登录设备、CLI 或 Owner 本机的 enrollment URL/QR；有效链接自动完成设备登记或身份复用、session 建立和 connection profile 保存。

### 已知环境

浏览器读取本地 connection profiles，展示连接名称、最近状态和 `Test connection`。用户选择连接后，客户端优先使用配对设备密钥和加密 session 恢复；session 过期或失效时，可使用 remote Passkey 或新的 Owner 一次性登录链接。链接登录复用当前 Relay 下最近使用的 profile 及其设备密钥；nodeId、Owner public-key pin、trust epoch 不匹配时失败关闭，不静默创建替代身份。历史重复记录不自动合并。

`Test connection` 只检查 Relay 可达、Owner 在线、E2EE handshake、设备授权和 session 状态；它不能登记设备、替代 Passkey 或自动提升权限。

### 本地环境

本机入口仅接受 `http://localhost:5173` 与 `http://127.0.0.1:5173`，并由 Owner 验证 loopback socket peer、精确 Host 与 Origin。每个 WebSocket 连接获得短期内存 Owner admission；本机访问不使用 Passkey、bearer 或持久 session。Vite dev/preview 仅绑定 loopback。远程 App origin 仍只负责已保存的远程连接和 enrollment deep link，不能借本机代理获得本机授权。

### 恢复与撤销

设备管理模块统一执行邀请和设备生命周期。管理面只提供设备查询、添加/取消添加、移除单个或所有设备；移除同步废止关联远程 session、使邀请失效并关闭连接。全部移除保留 Owner node identity、公钥和 trust epoch，不提供独立的 session 批量撤销、trust reset 或特殊 recovery 命令。所有远程设备丢失时，先在本机启动 Owner，再通过 CLI 生成普通 enrollment invitation；不存在远程 recovery code 登录路径。CLI 只通过本机 IPC 操作运行中的 Owner，不拥有临时 runtime。

## 安全边界

- enrollment invitation 必须随机、短时、单次消费、可取消、重放失败，并在成功消费、过期、撤销、Owner/Relay 重启和设备撤销时失效。
- 新设备公钥必须在 Owner 侧原子绑定到设备记录；设备身份不能信任浏览器自报的 `deviceId`。
- paired session 受 idle/absolute TTL、设备撤销和 trust epoch 约束；session token 只返回一次并只保存服务端哈希。
- Passkey 私钥永不离开浏览器。Passkey 只验证用户持有凭据；Owner 仍负责会话签发、设备登记和权限控制。
- Owner public key 的自动校验必须保留，但 fingerprint 只作为内部 identity pinning 数据，不作为每次登录的人工步骤。

## 组件职责

- **App**：管理本地 connection profiles、设备邀请 deep link、配对恢复、remote Passkey、设备测试和用户可见的设备状态；消费 Owner 业务模型及其原始内容和路径，保留独立 presentation 模型。
- **Owner Gateway / Server**：负责 Owner 身份、Passkey/session、设备 enrollment、设备撤销、应用服务和协议结构校验；Conversation adapter 负责领域转换。
- **Application Services**：提供设备邀请、认证、会话、设备生命周期和 Owner 管理操作；不依赖具体 HTTP 或 Relay socket 实现。
- **Relay**：只处理已验证的 Owner/client attach、enrollment reference 路由、E2EE payload 和连接生命周期。
- **Protocol**：分别定义 Owner WebSocket 和 Relay attach/handshake/encrypted frame；用户可见的连接配置不等同于 Relay 内部身份字段。

## 当前迁移边界

旧 Owner code、fingerprint、first-session 和普通 login QR 不属于当前设备 enrollment 与多 connection profile 模型。不得重新扩展旧的管理 QR 或 Owner code 登录流程。

## 设备生命周期实现约束

Web 与本机 CLI 分别校验权限，随后委托同一个设备管理模块。邀请兑换与撤销串行执行，排队的远程变更重新检查设备授权；撤销期间开始的握手不得恢复授权。trust store peers 与 SQLite remoteDevice/session 保持现有存储结构，集中写入与失败清理，不增加迁移。跨存储失败不宣称原子事务：清理失败必须断开访问、返回错误并允许幂等重试；成功全部移除不轮换 Owner 身份。

握手/每个远程请求继续校验设备授权。客户端收到可信 E2EE device_revoked 关闭后停止重连，只清理受影响 profile 的 session，回到登录；普通网络失败不得推断撤销成功。
