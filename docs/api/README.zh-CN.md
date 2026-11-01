# API 边界

状态：本文是 Owner 设备邀请认证契约；代码迁移已接入，自动化与手工验收状态见 [`../current-behavior.md`](../current-behavior.md)。

## Owner WebSocket

Owner 控制使用经过认证的 Owner WebSocket protocol。所有 workspace、Project、Thread、Turn、事件和 Owner 管理方法都在 Owner Gateway 内执行，并通过安全投影返回浏览器。

远程 admission 只有两类；Owner 本机/CLI 恢复属于本地管理入口，不是远程登录凭据：

1. **设备 enrollment**：消费短期、单次 invitation，绑定当前浏览器生成的设备公钥，登记设备并创建第一个 session。
2. **remote Passkey**：针对已知 connection profile 建立候选连接，执行 challenge/verify，成功后签发该设备的 Owner session。

在所有远程设备丢失时，Owner 本机或 CLI 生成新的 enrollment invitation；不提供远程 recovery code admission。

已配对设备使用设备 token 和 session token 恢复，不需要再次经过 enrollment。所有已认证方法必须绑定 Owner、device、trust epoch 和当前 session。

## 设备邀请契约

设备邀请由 Owner 本机、CLI 或已认证的已配对设备生成。它必须具备以下行为：

- 随机、短时、单次消费、可取消；
- 消费时绑定新浏览器的设备公钥；
- 成功消费后原子创建 remote device 和 session；
- 替换、过期、取消、重放、Owner/Relay 重启和 trust reset 后失效；
- 不把 Relay URL、Owner code、fingerprint、session token、私钥或其他长期凭据放进用户可读 payload。

邀请 URL/QR 是 deep link 的传输形式，不是普通登录表单字段。Relay 只根据短期 reference 路由到在线 Owner，Owner 才验证 invitation、设备公钥、trust epoch 和权限。

## 已保存连接与会话

浏览器成功加入后保存 connection profile。profile 至少需要支持 `relayUrl`、`nodeId`、`deviceId`、配对 client token、trust epoch 和 Owner identity 绑定；具体秘密值必须进入浏览器受保护存储，不进入普通 UI DTO。

session token 只返回一次，服务端只保存哈希。session 受 idle/absolute TTL、设备撤销和 trust epoch 约束。连接测试只能报告 Relay、Owner、E2EE、设备授权和 session 状态，不能改变授权状态。

## WebAuthn origins

localhost 与远程 App origin 是独立的 WebAuthn profile：

- 本地默认 `http://localhost:5173` / RP ID `localhost`；
- 远程使用经过校验的 HTTPS App origin 和匹配 RP ID；
- Relay 只提供 transport，不改变 WebAuthn origin；
- 本地 Passkey 只在 localhost 入口使用，remote Passkey 只在已知远程 connection profile 上使用。

## 设备与恢复管理

已认证管理方法覆盖设备列表、单设备撤销、撤销全部设备、撤销全部远程 session、trust reset、生成/取消 enrollment invitation 和 Passkey 配置。没有 remote Passkey 时，新增远程设备依赖当前有效的已配对设备 session 或 Owner 本机/CLI 恢复入口。

Owner code、普通 `remote.loginQr` management request 和 fingerprint 人工确认不属于新 API 契约。协议内部可以保留节点路由和 Owner public key 绑定，但不能把它们重新暴露为远程登录输入。

浏览器不会收到 API key、未脱敏的宿主路径、未限制大小的 runtime payload、Passkey 私钥或未投影的 Owner/Relay 内部状态。合法但尚未归一化的 runtime 事件以版本化 `runtime.extension` event envelope 发送；字段名递归过滤凭据和路径，payload 限制为 128,000 UTF-8 字节。

事件正文使用 `schemaVersion`、`eventId`、`type`、runtime 关联 ID、`createdAt` 和 `payload`。`events.subscribe`/`events.resume` 的 cursor 生命周期保持不变。
