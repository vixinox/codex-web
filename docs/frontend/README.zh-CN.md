# 前端边界与数据流

状态：本文是设备邀请和 connection profile 的前端契约；代码迁移已接入，自动化与手工验收状态见 [`../current-behavior.md`](../current-behavior.md)。

## 登录入口

前端按 origin 和设备状态拆分登录，不在一个页面里混合本地和远程模式：

- **localhost**：独立的 local Passkey 登录入口，只连接本机 Owner Gateway；
- **远程 App origin**：只展示浏览器本地保存的远程 connection profiles；
- **设备 enrollment deep link**：单独处理短期、单次 invitation，自动完成新设备加入；
- **无本地连接记录的远程环境**：不展示 Owner code、fingerprint、普通登录 QR 或手工候选登录表单，只提示打开设备邀请。

Relay URL 对标准部署来自受信任的应用 profile。自定义 Relay 只在“添加连接”或高级设置中配置，不能成为普通登录页上要求用户理解的认证字段。

## Connection profile

浏览器成功加入 Owner 后保存一个本地 connection profile，并将它呈现为类似连接管理器的列表。列表只展示用户可理解的信息：连接名称、最近连接时间、在线/离线状态、session 状态和操作入口。

选择连接后的顺序是：

1. 使用已登记设备密钥和加密 session 尝试静默恢复；
2. session 失效时，在该已知连接上调用 remote Passkey；
3. 没有 remote Passkey 时，回到“添加设备”邀请流程；
4. 连接失败时保留可读错误和 `Test connection`，不显示内部 Owner code 或 fingerprint。

`Test connection` 只执行 Relay 可达、Owner 在线、E2EE handshake、设备授权和 session 状态检查，不登记设备、不替代 Passkey、不批准新设备。

## 设备邀请

设备邀请可由 Owner 本机、CLI 或已认证设备生成。URL/QR 只负责把陌生浏览器带入 enrollment route；浏览器生成自己的设备密钥，Owner 原子登记该设备并返回一次性配对凭据和 session。

邀请页面应明确展示“正在添加此浏览器”及成功/失败状态，不要求用户阅读 fingerprint、填写 Owner code 或理解 Relay 路由。邀请过期、取消、重复使用、trust reset 或 Owner 离线时给出可操作的重新获取邀请提示。

已登记设备可以从管理面生成新设备邀请。生成邀请需要当前有效的已配对 session；如果 remote Passkey 已配置，还需要一次 step-up。邀请消费后应在 Owner 设备列表中显示新的设备事件。

## Owner 管理页面

管理页面只展示安全投影后的 Passkey presence、connection/device 状态、邀请生成、设备撤销、session 撤销和 trust reset。对话事件以类型化 Conversation change 进入前端状态，未知 runtime 事件由 adapter 给出诊断，不建立任意 raw extension 外发通道。页面不展示私钥、session token、Owner public key 原文、Owner code 或 fingerprint 字符串。

Owner event envelope 由 `@codex-web/protocol/owner` 共享 parser 校验，应用协议不维护版本号。线程详情由 `threads.read` 的 Conversation snapshot 初始化，从同一响应的 watermark 订阅类型化 `conversation.change`，用共享 reducer 更新后再投影给 renderer。无需重建 Codex 通知；游标失效时重新读取，不能在已物化内容上重复追加历史增量。

## 本地数据边界

线程详情遵循 Conversation snapshot/change → 共享 reducer → presentation model → renderer。connection profile 和设备密钥只进入浏览器安全存储；session bearer 使用不可导出的 AES-GCM key 加密保存。已认证业务状态可保留原始正文与路径；正文中出现凭据样式文本不触发内容过滤。认证凭据、设备私钥和 session token 仍只进入专用受保护存储；日志、URL 和普通遥测不因此增加业务内容或凭据。

设备撤销、trust reset、session 过期和本地存储损坏时，前端清理失效的 profile/session，并回到设备邀请入口。所有远程设备丢失时，页面提示通过 Owner 本机或 CLI 生成新的 invitation。

## Owner 内容与接口简化（Task 05）

Conversation → presentation → renderer 保留，展示模型重构另开任务。展示转换不再清空秘密问答答案；输入控件的 isSecret 行为保留。Skills 使用稳定 name/path，前端不保存临时授权 handle；发送时服务端重新校验当前 cwd 目录。Skills scope 直接使用 user/repo/system/admin，不保留 project→repo 兼容转换。

Owner 详细错误保持本地化操作提示，同时按文本显示原始 message/details；不解释 HTML，也不自动记录到遥测。浏览器收到的 frame、Conversation snapshot/change 和 cursor 仍执行结构检查。
