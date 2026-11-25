# API 边界

本文定义 Owner WebSocket 与 Relay 相关的应用契约。本机与远程访问边界见[Owner 远程架构](../owner-remote-architecture.md)；这里不复述实现计划或历史验收状态。

## Owner WebSocket

Owner 控制使用经过认证的 Owner WebSocket protocol。所有 workspace、Project、Thread、Turn、事件和 Owner 管理方法都在 Owner Gateway 内执行，并按各领域接口返回浏览器；已认证 Owner 的业务内容不经过保密性投影。

远程 admission 只有两类；Owner 本机/CLI 是受限的本地管理入口，不是远程登录凭据：

1. **一次性链接登录（enrollment）**：消费短期、单次 invitation，验证浏览器设备公钥；首次登记设备，已登记公钥复用 deviceId，为本次登录创建 session。无需配置 Passkey。
2. **remote Passkey**：针对已知 connection profile 建立候选连接，执行 challenge/verify，成功后签发该设备的 Owner session。

在所有远程设备丢失时，Owner 本机或 CLI 生成新的 enrollment invitation；不提供远程 recovery code admission。

已配对设备使用设备 token 和 session token 恢复，不需要再次经过 enrollment。所有已认证方法必须绑定 Owner、device、trust epoch 和当前 session。

## 设备邀请契约

设备邀请由 Owner 本机、CLI 或已认证的已配对设备生成。它必须具备以下行为：

- 随机、短时、单次消费、可取消；
- 消费时绑定经过 E2EE 持有证明的浏览器设备公钥，不接受自报 deviceId；
- 成功消费后登记或复用 remote device 并签发 session；失败清理本次授权，不撤销已有设备或其其他 session；
- 替换、过期、取消、重放、Owner/Relay 重启和设备撤销后失效；
- 不把 Relay URL、Owner code、fingerprint、session token、私钥或其他长期凭据放进用户可读 payload。

邀请 URL/QR 是 deep link 的传输形式，不是普通登录表单字段。Relay 只根据短期 reference 路由到在线 Owner，Owner 才验证 invitation、设备公钥、trust epoch 和权限。

## 已保存连接与会话

浏览器成功加入后保存 connection profile。profile 至少需要支持 `relayUrl`、`nodeId`、`deviceId`、配对 client token、trust epoch 和 Owner identity 绑定；具体秘密值必须进入浏览器受保护存储，不进入普通 UI DTO。

session token 只返回一次，服务端只保存哈希。session 受 idle/absolute TTL、设备撤销和 trust epoch 约束。连接测试只能报告 Relay、Owner、E2EE、设备授权和 session 状态，不能改变授权状态。

## 本机 admission 与 WebAuthn origin

本机 Owner WebSocket 只接受通过 loopback peer、精确本地 Host 和 `http://localhost:5173` / `http://127.0.0.1:5173` Origin 检查的连接。服务端为每条通过检查的连接创建短期内存 Owner admission；它不签发 bearer、不写入 session 表，连接关闭即失效。业务方法仍按 Owner 上下文授权。远程 App origin 和 forwarded headers 不扩大本机授权边界。

WebAuthn 只为远程 HTTPS App origin 配置一个 `{ origin, rpId }`：

- RP ID 从已配置的 `CODEX_APP_ORIGIN` hostname 推导；纯本机运行可不配置远程 origin；
- Relay 只提供 transport，不改变 WebAuthn origin；
- Passkey 只用于已知远程设备的重新认证，不能替代首次设备 enrollment。

`owner.passkey.authentication.verify` 成功返回 `{ ownerId, token, expiresAt }`；登录入口校验 Owner 身份后保存 session，远程登录还须匹配已保存 profile 的 Owner。身份字段为必需，不以缺失身份的响应完成登录。

## 设备与恢复管理

已认证管理方法只覆盖设备列表、单设备/全部设备撤销、生成/查询/取消 enrollment invitation 和 Passkey 配置。`owner.security.status` 返回 `passkeyAvailable`、服务端配置的 `appOrigin: string | null`、`devices` 与 `currentDeviceId`；`owner.enrollment.issue/status` 使用该可信 origin 构造链接。全部撤销只清理远程设备及关联 session，保留 Owner identity 与 trust epoch。没有 remote Passkey 时，新增远程设备依赖当前有效的已配对设备 session 或 Owner 本机/CLI 恢复入口。

Owner code、普通 `remote.loginQr` management request 和 fingerprint 人工确认不属于新 API 契约。协议内部可以保留节点路由和 Owner public key 绑定，但不能把它们重新暴露为远程登录输入。

已认证 Owner 可接收业务正文、宿主路径、命令、diff、工具输出和 Interaction 结果；服务端不按内容特征脱敏、替换路径或静默截断。凭据库、私钥和服务端密钥不新增读取入口，认证授权、受控目录检查与资源容量限制继续有效。未知 runtime 通知不建立任意 raw extension 外发通道：Conversation adapter 明确映射或产生诊断，workspace 事件按实际消费者路由。

已认证业务方法的错误使用 Owner 专用 DTO：稳定 `code`、`retryable`、可选 `params`，以及原始 `message?: string`、`details?: string`。仅提取显式 Error/cause 的消息及字符串详情，不返回 stack、请求对象或凭据对象。未认证、握手、admission 和 Relay 错误维持原公开合同；Owner 详细错误不自动进入日志。

`skills.list` 返回 `{ name, path, displayName, description, scope }[]`，scope 为 user/repo/system/admin。创建线程和 `turn.start` 使用 `skills?: { name, path }[]`（最多 32 项、不可重复），不再接受临时 handle；执行前按目标 cwd 重新读取 enabled 技能目录并精确匹配 name/path。没有缓存 TTL，也不保留旧 handle 别名。

Owner 应用协议与 domain event 不维护版本号，前后端共同调整。事件正文包含 `eventId`、`type`、`runtime`、可选关联 ID、`createdAt` 和 object `payload`，由 `@codex-web/protocol/owner` 统一校验。`events.subscribe`/`events.resume` 保留 epoch + sequence cursor；epoch 在进程重启时变化，旧 epoch、过期或超前 cursor 触发 `events.reset`。实时 eventId 必须等于 cursor sequence；非法契约或同 cursor 内容冲突停止消费。事件表直接使用当前结构，不提供旧结构迁移或兼容入口。Relay、IPC 和 runtime manifest 的版本不属于本契约。

`threads.read({ threadId, projectId? })` 校验线程归属后返回 `{ snapshot, watermark }`，其中 `snapshot.watermark` 等于 `watermark.sequence`。线程详情从该游标订阅；后续变化使用 `conversation.change`（`payload: { change }`），不返回原生 Thread DTO 或 `historyEvents`。收到 `events.reset` 时重新读取快照，再从新游标订阅。SQLite 的 `conversation_events` 保存类型化 change，内容保持原值；不读取或迁移旧 `domain_events` 表。

发送、取消、compact 和 Interaction reply 经 `conversation.command` 的 `turn.start`、`turn.cancel`、`conversation.compact`、`interaction.respond` 执行。旧 `threads.send`、`threads.cancel`、`threads.compact`、`threads.status`、`userInput.respond`、`approvals.resolve` 已移除，不提供别名；调用返回 `owner.request.method-not-found`。Workspace 通知仍使用现有 envelope，供 sidebar 和 skills 刷新。

事件 payload 继续受 128,000 UTF-8 字节限制，Owner frame 上限为 1 MiB。超限事件被明确拒绝并记录交付缺口，使订阅 reset；超限响应返回 `owner.protocol.frame-too-large`，不发送截断结果。

## Steer 与本地 Queue

`conversation.command` 新增 `turn.steer`：`conversationId`、`expectedTurnId`、单条 text `input` 及可选 `skills`。Owner 校验线程归属和 skills 后直接调用 App Server `turn/steer`，不进入任务调度队列；返回 `{ turnId }`，必须匹配预期 Turn。请求拒绝为不可自动重试的 Turn 错误，传输失败或无效响应不能推断未执行。没有 Queue RPC。

## 本机管理 CLI

CLI 只通过本机 IPC 连接正在运行的 Owner。未运行时提示先执行 `pnpm server`，不会启动临时 runtime、接管数据库或连接 Relay。仅就绪探测可在五秒内重试；变更请求不自动重试。

支持 `pnpm manage devices list`、`pnpm manage enrollment issue`、`pnpm manage devices revoke <device-id>`、`pnpm manage devices revoke-all`。enrollment issue 显示为“生成登录链接”；不提供 CLI/IPC enrollment cancel。撤销要求交互确认。链接由 Owner 持有，CLI 退出不取消；五分钟过期，生成新链接替换旧链接，Web 仍可取消当前链接。不再提供 auth status、auth sessions revoke-all、enrollment recover、trust reset 或对应 IPC 别名。
