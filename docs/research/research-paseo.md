# Paseo 架构思路调研

调研时间：2026-10-22。依据本机 `C:\Users\Hello\Desktop\paseo` checkout 中的 README、官方文档、协议与实现源码；检查到的提交为 `9d908d678b117e2cde6329cfe197502ad4c156ef`。Paseo 正在快速迭代，以下描述针对该提交的代码状态。

## 核心结论

Paseo 的中心不是 Relay，而是运行在用户机器上的 **daemon**。Daemon 管理 Agent、工具、会话、持久化和权限；桌面、手机、Web、CLI 都是 daemon 的客户端。Relay 是可选传输层：daemon 主动连出去，客户端通过 Relay 找到 daemon，双方随后建立端到端加密通道。也可以不使用 Relay，改走 SSH、TCP 或 Tailscale。

因此 Paseo 的模型不是“前端登录 Relay，Relay 判断用户是否合法，再通知后端”，而是“客户端直接建立到本机 daemon 的逻辑会话；Relay 只转发连接；daemon 自己认证和授权”。Paseo 的普通客户端没有中心用户账户，Relay 也不维护应用用户数据库。

## 组件职责

| 组件 | Paseo 中的职责 |
| --- | --- |
| 客户端 | 使用统一 daemon WebSocket 协议查看和控制远端 Agent；保存连接配置。 |
| 本机 daemon | Agent 生命周期、工具执行、会话状态、持久化、协议处理与权限判定的权威边界。 |
| Relay | 按 `serverId` 和连接 ID 配对两端 WebSocket 并双向转发；不承担业务身份、Agent 执行或会话历史存储。 |
| 端到端加密 | 保护客户端与 daemon 之间的应用流量，使 Relay 无法读取或伪造应用消息。 |

源码中的 `@getpaseo/relay` 类型注释明确说 Relay 在 server/client 两端之间转发消息且不修改；daemon 的 Relay 传输层为控制连接和每个客户端连接创建 WebSocket。Relay 协议的路由元数据是 `serverId`、`role`、协议版本和可选 `connectionId`。参见 [Relay types](https://github.com/getpaseo/paseo/blob/main/packages/relay/src/types.ts)、[daemon relay transport](https://github.com/getpaseo/paseo/blob/main/packages/server/src/server/relay-transport.ts)、[daemon endpoints](https://github.com/getpaseo/paseo/blob/main/packages/protocol/src/daemon-endpoints.ts)。

官方安全文档也把 direct connection 与 relay connection 视为到同一 daemon 的两种连接方式。见 [Security](https://github.com/getpaseo/paseo/blob/main/public-docs/security.md) 和 [Connectivity](https://github.com/getpaseo/paseo/blob/main/public-docs/connectivity.md)。

## 配对、身份和授权是三件不同的事

Paseo 普通 QR/链接包含 daemon 的 `serverId`、daemon 公钥和 Relay 地址。Daemon 的 ECDH 密钥对长期保存在 `$PASEO_HOME/daemon-keypair.json`；客户端连接时生成自己的临时密钥，与 daemon 公钥协商加密通道。这个设计让客户端确认自己连到了持有对应私钥的 daemon，并让 Relay 看不到应用消息。

但 daemon 公钥是公开放进二维码的，它**不是客户端身份凭据**。普通客户端连接没有逐设备注册的客户端公钥：客户端可生成临时密钥完成 E2EE 握手，然后在 daemon 的 `hello` 中提供可选的机器密码。Daemon 的会话准入代码在普通路径上将已准入客户端映射到统一的 `owner` principal 和 `OWNER_PERMISSIONS`；未配置机器密码时直接准入。换句话说，二维码/链接发现并加密到哪台机器，daemon 密码才是可选的访问认证；E2EE 本身不等于设备授权。

机器密码是**每个 daemon 的共享密码**，保存在 daemon 配置中并以 bcrypt hash 形式存储。普通 QR 配对路径不会在 daemon 端创建逐设备账号或可单独撤销的设备凭据；客户端保存 host connection profile。因而 Paseo 默认信任边界是机器级的 Owner 访问，不是账号下每台控制设备分别授权/撤销。安全文档建议把配对链接当作密码保管。当前 checkout 的 `session-admission-auth.ts` 还包含一段临时兼容：配置了机器密码但 Relay 客户端未提供密码时，仍准入 Owner；因此部署时需核对目标版本是否仍包含该兼容路径，不能只依据安全文档推断密码保护状态。参见 [pairing offer](https://github.com/getpaseo/paseo/blob/main/packages/server/src/server/pairing-offer.ts)、[daemon keypair](https://github.com/getpaseo/paseo/blob/main/packages/server/src/server/daemon-keypair.ts)、[session admission](https://github.com/getpaseo/paseo/blob/main/packages/server/src/server/session-admission-auth.ts)、[password auth](https://github.com/getpaseo/paseo/blob/main/packages/server/src/server/auth.ts)、[client host pairing](https://github.com/getpaseo/paseo/blob/main/packages/app/src/runtime/host-runtime.ts)。

有一个需要区分的扩展：Paseo daemon 代码还包含语义权限和 principal/credential/pairing invitation 模型，用于可授权的集成身份（例如 Hub）；这与普通移动端通过 QR 保存一个 Host 并以 Owner 身份连接，不是同一条身份流程。见 [Daemon permissions](https://github.com/getpaseo/paseo/blob/main/docs/permissions.md) 与 [session admission auth](https://github.com/getpaseo/paseo/blob/main/packages/server/src/server/session-admission-auth.ts)。

## 事件与离线恢复

Paseo 不靠 Relay 保存会话事件来恢复历史。Daemon 提供实时 Agent timeline 流及带序列范围的历史 catch-up；Provider history 是 transcript 的持久化权威，daemon 恢复 Agent 时重建投影。客户端也有本地 replica cache，重连后先显示缓存，再向 daemon 补齐缺口和确认当前状态。Relay 转发在线帧，不是离线事件数据库；daemon 不在线时客户端不能通过 Relay 读取机器上的最新权威历史。

关键同步语义包括序号、timeline epoch、分页 catch-up、明确区分完整范围与仅用于显示的缓存；获取事件不完整时继续翻页，不能仅凭 WebSocket 已连通就断定同步完成。详见 [Timeline sync](https://github.com/getpaseo/paseo/blob/main/docs/timeline-sync.md)、[Agent lifecycle](https://github.com/getpaseo/paseo/blob/main/docs/agent-lifecycle.md) 和 [Data model](https://github.com/getpaseo/paseo/blob/main/docs/data-model.md)。

## 对我们方案的启发

Paseo 证明了一个可行且边界清楚的选项：把本机 Owner/daemon 当作业务后端和数据权威；远程客户端仍直接使用本机协议；Relay 只做连接路由和不可信传输。连接路径可以是本地直连，也可以是 Relay 中继，业务语义无需改变。

它也帮助厘清之前讨论的身份边界：若采用 Paseo 的思路，就不是 Relay 给 Fastify 出具“用户合法”的判断，而是 Relay 不判断用户身份，Fastify/daemon 验证会话自身凭据。若我们的既定产品仍要求 Relay 账户登录、同一账户跨浏览器查看节点、Relay 管理账户到节点的归属，则这些是我们额外选择的账户/控制平面，不能说成 Paseo 的做法。

事件恢复方面，Paseo 的默认做法是本机保存权威历史、Relay 不持久化事件。如果产品要求 Owner 离线期间远程端仍可恢复 Relay 已收到的事件，才需要额外的 Relay 密文缓存；这属于不同的可用性承诺，并非 Relay 作为中继自然必须承担的职责。

Paseo 普通 QR 路径的 Owner 语义与单用户远程控制比较接近，但它不提供逐控制设备撤销；不能把它的端到端加密误当作设备权限管理。它的原则可以借鉴，设备和账户生命周期仍须依据我们自己已经确定的产品语义设计。

## 主要一手来源

- [Paseo README](https://github.com/getpaseo/paseo/blob/main/README.md)：产品拓扑、daemon 和客户端说明。
- [Architecture](https://github.com/getpaseo/paseo/blob/main/docs/architecture.md)：本机 daemon/client-server 模型。
- [Security](https://github.com/getpaseo/paseo/blob/main/public-docs/security.md)：Relay 不可信模型、配对密钥、机器密码。
- [Connectivity](https://github.com/getpaseo/paseo/blob/main/public-docs/connectivity.md)：Relay、SSH、Tailscale 连接方式。
- [Relay protocol implementation](https://github.com/getpaseo/paseo/tree/main/packages/relay/src)：E2EE 通道和 relay 数据类型。
- [Relay transport implementation](https://github.com/getpaseo/paseo/blob/main/packages/server/src/server/relay-transport.ts)：daemon 的出站 Relay 长连接、每客户端通道和加密 socket。
- [Session admission](https://github.com/getpaseo/paseo/blob/main/packages/server/src/server/session-admission-auth.ts)：daemon 内的认证和 Owner 会话准入。
- [Timeline sync](https://github.com/getpaseo/paseo/blob/main/docs/timeline-sync.md)：实时流、序号、catch-up 和客户端缓存恢复。
- [Data model](https://github.com/getpaseo/paseo/blob/main/docs/data-model.md)：daemon 的本地持久化位置。
- [Daemon permissions](https://github.com/getpaseo/paseo/blob/main/docs/permissions.md)：扩展 principal 与语义权限模型。
