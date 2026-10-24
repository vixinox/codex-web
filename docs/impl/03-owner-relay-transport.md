# Owner Relay transport 工作包

## 目标与前置

- 前置：Owner WebSocket/Application Services 已完成，Owner 控制面使用 SQLite；产品和安全边界见 [`../product/owner-remote-final-architecture.md`](../product/owner-remote-final-architecture.md) 与 [`../product/owner-remote-paseo-architecture.md`](../product/owner-remote-paseo-architecture.md)。
- 目标：完成公共 Relay 可部署的端到端远程控制链路。已配对控制设备通过 Relay 的 E2EE channel 进入本地 Owner 的同一个 `OwnerSessionRuntime` 和 Application Services。
- Owner 与 Relay 分别作为独立服务部署；Owner 主动建立到配置 Relay 的出站连接。公共服务地址、TLS 终止和部署凭据由环境配置提供，不写死在协议或源码中。
- Relay 是无业务状态的连接转发层。Relay 不持久化账户、设备、事件或密文队列；Relay 重启或不可用会中断远程连接，恢复后客户端重新连接并从 Owner 恢复安全 snapshot/cursor。

## 冻结边界

- 本地 Owner loopback WebSocket 保持现有行为；Relay transport 只增加远程入口，不改变 Owner protocol、Application Services、Codex adapter 或 SQLite 数据合同。
- Relay 只验证并路由连接层 admission，不解密、不解释、不记录 Owner frame、账户身份或业务内容。业务身份与授权仍由 Owner 验证。
- Relay attach 不得信任客户端自报的 `nodeId`、`role` 或 `connectionId`。Owner 端和 client 端均须以可验证的连接凭据证明路由角色和节点控制权；未经认证的连接不能占用、替换或探测路由槽位。部署 admission secret 只存在于 Owner 与 Relay，配对 offer 和设备 admission token 按 node、role、trust epoch 与有效期签名。
- E2EE 使用 `@codex-web/protocol/relay` 的版本化协议；Owner 的明文 Owner frame 只存在于 Owner 和已配对客户端，Relay 只接触不可读密文及最小路由元数据。
- 控制设备逐设备配对和撤销。信任状态与节点私钥继续保存在 Owner 的本地 trust store，不放进 SQLite 或 Relay；信任重置仍支持一次撤销全部设备并轮换信任代次。
- 禁止 Relay HTTP/SSE tunnel、Relay 业务数据库、离线事件缓存、Guest/Relay 账户、多 Owner 节点管理，以及为该工作包迁移前端页面或新增旧 REST/SSE 兼容入口。

## 从 Paseo 对照吸收的决策

本节记录本工作包采用、或明确拒绝的 Paseo 做法，作为后续实现的取舍依据。

采纳：

1. **双向握手确认。** E2EE 握手必须是双向的：客户端提交设备公钥后，Owner 由会话密钥加密回一帧 `handshake.ok`，其 AAD 绑定 node、trust epoch、协议版本与双方公钥摘要。客户端收到该帧并通过 AEAD 验证后，才认为通道建立；未收到前不得发送业务帧。只做单向（客户端发送公钥后直接切密文）不满足“双方身份确认和密钥确认”。
2. **握手期间的入站排队。** 派生密钥是异步操作；握手窗口内到达的后续帧必须按序缓冲并在通道打开后回放，不能因为“密钥尚未就绪”被解析失败或丢弃。同一 relay socket 的入站处理天然串行。
3. **全零共享值拒绝。** 派生前校验 ECDH 共享值非全零，防止无效曲线点把会话密钥退化为已知常量。
4. **协议级心跳与半开检测。** 控制连接使用 WebSocket 协议级 ping（不是应用层 JSON ping），并有 stale 上限；Owner 侧一旦判定半开就主动断开并重连，而不是等待永远不会到达的 `close` 事件。
5. **帧大小只测量一次。** 入站与出站帧的字节数在同一处计算一次并复用，背压判断把当前帧字节数计入队列上界。

拒绝：

- Paseo 的 control socket + per-connection data socket 双平面（v2）与其边缘 Durable Object tag 路由。本产品是单进程 Relay，一张路由表即可。
- Paseo 的 `e2ee.ts` 子路径 shim、`dist-handshake-parity` 构建期校验、以及带日期的 `COMPAT(...)` 兼容分支。本工作包只有一个 Owner、一个 Relay 和单一协议版本，版本不符即拒绝。
- Paseo 用 relay 元数据（`relayConnectionId`、`externalSessionKey`）参与身份判定的做法。本产品中 Relay 元数据只用于路由，设备身份一律由 E2EE 握手推出的 `clientPublicKey` 决定。

## 实施内容

1. **Relay admission 与公共服务防护。** 为 Owner 与控制端定义认证过的 attach 生命周期，安全绑定角色、node、连接 ID 和已认证 socket session；定义协议版本拒绝、重复/替换连接、关闭清理和脱敏原因。实施明确的帧大小、连接数、待配对连接、发送队列/背压和速率限制；默认拒绝无效、超限及未认证流量。健康端点只暴露运行状态、协议版本和必要的聚合连接指标，不泄露 node/device 标识。
   - client attach 必须声明 `deviceId`，且必须与其 admission token 中的 `deviceId` claim 一致；未声明即拒绝。Relay 不把自报的 `deviceId` 当作身份，只把它作为路由元数据透传给 Owner，身份仍由 Owner 的 E2EE 握手推导。
   - 所有 attach 失败一律返回同一个脱敏原因，不得通过 close reason 区分“node 不存在”“token 无效”“容量已满”，避免 node 枚举与容量探测。
   - 替换与断开清理必须幂等：已被替换或已关闭的 session 不能二次触发关闭、二次通知对端或残留节点条目。
2. **端到端虚拟 transport。** 将 OwnerConnector 解密后的 Owner frames 交给每个远程客户端独立的 `OwnerTransport`，把反向发送的 Owner frames 加密后转发。relay socket、pairing、handshake、加密 session、Owner runtime 的创建/关闭必须有单一明确生命周期。远端 admission 在完成当前 trust epoch、设备授权和 E2EE 校验后构造 `pairedDeviceId` 与 `e2eeVerified`，再进入 session runtime；客户端断线关闭其 transport/runtime streams，但不取消已经接受的 Turn。
   - 每个 relay connection 有显式握手状态机（`awaiting_handshake` → `handshaking` → `open`）；重复的 `handshake`、握手窗口内的密文、以及握手完成后的明文配对帧都必须被拒绝并关闭该连接，不得覆盖已有会话。
   - 明文 Owner `close` 帧不得被静默丢弃：Owner 要终止某个远程连接时，先加密下发 `close`，随后关闭该 connection 的 relay 通道并清理 runtime。
3. **设备配对和撤销。** 沿用有期限、一次性 challenge 的 Owner 本地配对 offer；配对结果需能让客户端验证目标 node/key。新增本地认证的逐设备列表/撤销 Application Service 与 Owner method，使用稳定且不泄密的设备标识及 last-seen 状态；撤销立即关闭该设备现有通道并使其后续握手失败。`remote.trust.reset` 继续轮换 trust epoch/key 并关闭全部远程连接。所有管理操作仅允许 local transport。
   - trust store 按固定 schema 严格解析，任何字段缺失或类型错误都视为损坏状态；同一公钥不得登记为两个设备。
4. **恢复与运行配置。** Owner 对 Relay 断连采用有上限的指数退避重连；禁止启动竞态导致的重复连接或旧 socket 事件污染新连接。远程客户端重连后用现有 session token、Thread snapshot 和 event cursor 恢复状态；过期 cursor 使用既有 reset/snapshot 流程，不向 Relay 补取事件。Relay 暂不可用不影响本地 Owner 服务。
5. **文档与部署入口。** 更新配置样例和 README 中的 Relay 地址、公共 HTTPS/WSS/TLS 入口及 Owner 出站连接要求；记录公共 Relay 部署、健康检查、优雅关闭与限制配置。不得启动或接管用户服务进程进行手工验收。

## 协议与安全要求

- Relay 和 Owner 都拒绝不支持的协议版本、畸形帧、非文本控制帧及超限消息；解析时验证每种 frame 的完整字段和边界，不以 TypeScript 类型断言代替运行时校验。
- 认证必须绑定 Relay attachment 的路由身份，防止未授权 attach、node 枚举、冒充 Owner、连接替换攻击及任意 connection ID 转发。认证凭据可轮换/吊销，不能把公开 nodeId 或 E2EE 公钥本身当作 attach secret。
- E2EE 握手需绑定 nodeId、设备公钥、trust epoch、协议版本及双方角色/会话上下文，具备双方身份确认和密钥确认；加密记录具有唯一 nonce/序列语义，拒绝重放、错序及认证标签失败的消息。不得在日志或诊断中写入 key、pairing challenge、密文正文或 Owner frame。
- Owner 明文帧交付给 session runtime 前，必须在服务端验证 pairing 与 E2EE 状态并注入真实已配对设备身份；客户端不得通过 Owner frame 自报 transport 或 device identity。
- 单设备撤销、全部信任重置、Owner 断线、Relay 重启、连接替换和慢消费者均应立即清理对应 key/session/runtime/listener/timer/queue；一个设备的问题不得关闭其他已授权设备的连接。
- 公共 Relay 的限制必须可配置且有安全默认值；超过限制时拒绝/关闭对应连接，不丢弃事件后继续声称 cursor 连续。Relay 不缓存用于重放或恢复的业务数据。

## 验证

- Protocol 测试覆盖所有 frame 的合法/非法输入、未知版本、缺失/错误字段、消息大小边界、加密双方身份/上下文绑定、nonce/序列重放和篡改拒绝，以及 `handshake.ok` 的派生上下文绑定（不同 node/epoch/公钥组合不可互相验证）。
- Relay 测试覆盖未认证 Owner/client attach 拒绝、node/role/connection 冒认、缺少或错配 `deviceId` 的 client attach、路由槽位抢占、未配对转发、双向 opaque 转发、重复连接替换、断开清理幂等、失败原因不可区分、大小/速率/队列限制、慢消费者和重启后空状态。
- Server 测试覆盖配对成功/失败/过期/重放、各设备授权和单独撤销、撤销立即断连、全部 trust reset、E2EE admission 后绑定真实 device identity、每个设备独立 Owner runtime、Owner frame 双向加解密、握手状态机拒绝重复握手、Owner 下行 `close` 可被客户端观测、transport 断开清理且不取消已接受 Turn。
- 集成验收使用本地 Relay 进程及 fake Owner WS client 完成：Owner 出站连接、pairing offer、设备批准、E2EE 握手（含 `handshake.ok` 确认）、session token admission、`owner.status`、Thread/Turn/approval/question、events cursor 恢复、单设备撤销、全部 reset、Relay 重启重连。不得依赖外部公共 Relay 或真实用户凭据作为自动化测试前置。
- 检查本地 Owner loopback 功能不回归；Relay 故障时 Owner 仍可本地使用。项目级服务由用户启动，不由实现者启动或接管。
- 运行 `pnpm --filter @codex-web/protocol test`、`pnpm --filter @codex-web/server test`、`pnpm --filter @codex-web/relay test`，以及 server/protocol/relay typecheck；对所有修改的 TypeScript 文件运行 `pnpm exec oxfmt --check <files...>`。提交前只暂存预期文件并运行 `pnpm lint:staged`。

## 完成条件

- 公共 Relay 部署不能被未认证连接冒认节点/角色或抢占连接；Relay 不接触 Owner 明文协议与业务身份。
- 已配对设备能经 E2EE Relay channel 进入 Owner session runtime，完成远程业务操作；本地与远程执行相同 Owner 权限和资源归属检查。
- 握手是双向确认的：客户端只有在验证 Owner 用会话密钥发出的确认帧后才发送业务帧；错误的 node/epoch/公钥组合无法通过确认。
- 可列出并单独撤销配对设备；撤销后旧连接立即失效，其他设备继续可用；全部 reset 使旧 epoch 与旧密钥失效。
- Owner 主动终止的远程连接能被客户端观察到明确的关闭原因，而不是静默超时。
- Relay/Owner/client 任一侧重启或断线后资源能清理并重连；事件从 Owner snapshot/cursor 恢复，Relay 无持久化业务或离线队列。
- 自动化测试、focused typecheck、格式检查和 staged lint 通过；无需改变 Owner protocol 或前端页面合同。
