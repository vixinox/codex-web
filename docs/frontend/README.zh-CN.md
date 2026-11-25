# 前端边界与数据流

本文定义浏览器入口、connection profile、Conversation 消费和 UI-facing 状态的边界。系统全景见[系统架构](../architecture.md)，认证契约见[Owner 远程架构](../owner-remote-architecture.md)。

## 登录入口

前端按 origin 和设备状态选择本地直连或远程连接，不在一个页面里混合认证模式：

- **本机 localhost / 127.0.0.1**：直接连接本机 Owner Gateway；服务端来源校验才是授权依据，浏览器检测仅用于选择入口；
- **远程 App origin**：只展示浏览器本地保存的远程 connection profiles；
- **一次性登录 deep link**：现有登录页自动处理短期、单次 invitation，首次登记浏览器，重复登录复用设备身份；
- **无本地连接记录的远程环境**：不展示 Owner code、fingerprint、普通登录 QR 或手工候选登录表单，只提示打开设备邀请。

Relay URL 对标准部署来自受信任的应用 profile。自定义 Relay 只在“添加连接”或高级设置中配置，不能成为普通登录页上要求用户理解的认证字段。

## Connection profile

浏览器成功加入 Owner 后保存一个本地 connection profile，并将它呈现为类似连接管理器的列表。列表只展示用户可理解的信息：连接名称、最近连接时间、在线/离线状态、session 状态和操作入口。

选择连接后的顺序是：

1. 使用已登记设备密钥和加密 session 尝试静默恢复；
2. session 失效时，在该已知连接上调用 remote Passkey；
3. 没有 remote Passkey 时，使用 Owner 本机或 CLI 签发的新登录链接，复用原设备身份；
4. 连接失败时保留可读错误和 `Test connection`，不显示内部 Owner code 或 fingerprint。

`Test connection` 只执行 Relay 可达、Owner 在线、E2EE handshake、设备授权和 session 状态检查，不登记设备、不替代 Passkey、不批准新设备。

## 一次性登录链接

一次性登录链接可由 Owner 本机、CLI 或已认证设备生成，原 /app/enroll 地址直接渲染既有 LoginScreen，不提供独立 enrollment 页面；加载、失败和重试都在登录页展示。链接只在远程 App origin 消费；localhost 收到旧链接时进入本机工作台，不兑换远程 grant。单 Owner 模型下，浏览器复用当前 Relay 下最近使用的已配对 profile（含已退出或过期 session），保留密钥与 Owner identity pin；无记录才生成新密钥。Owner 根据 E2EE 公钥登记或复用设备，返回配对凭据和新 session。既有重复 profile 不自动删除。

链接页面展示“正在登录”及成功/失败状态，不要求用户阅读 fingerprint、填写 Owner code 或理解 Relay 路由。已保存的 nodeId、Owner public key 或 trust epoch 不匹配时失败关闭，不静默生成新身份；失败保留旧 profile/session，只删除本次新 draft。链接过期、取消、重复使用或 Owner 离线时提示重新获取链接。已移除设备须有新的 Owner 链接才能重新登记，更新原 profile。

Relay adapter 串行解密已收到的加密帧。原生 socket close 到达时，Owner runtime 先等待该 socket 的已收消息交付，再处理关闭；避免成功登录响应被正常的 paired 收尾抢先判为失败。解密失败后不交付排队的后续消息，旧 socket 的延迟消息/关闭不得影响替代连接。

已登记设备可以从管理面生成登录链接。生成链接需要当前有效的已配对 session；如果 remote Passkey 已配置，还需要一次 step-up。首次消费登记设备，重复登录不增加设备条目。

## Connection 设置页面

Settings → Connection 只显示一项远程 Passkey 配置，其余管理能力为生成登录链接、设备列表/当前设备标记、移除设备和危险区的移除所有远程设备。本机用户可通过生成登录链接打开远程设置完成 Passkey 配置。前端功能位于 app/settings/connection，页面/client/model 采用 connection-* 命名；路由仍为 /app/settings/connection。不提供独立的批量 session 撤销或 trust reset。对话事件以类型化 Conversation change 进入前端状态，未知 runtime 事件由 adapter 给出诊断，不建立任意 raw extension 外发通道。页面不展示私钥、session token、Owner public key 原文、Owner code 或 fingerprint 字符串。

Owner event envelope 由 `@codex-web/protocol/owner` 共享 parser 校验，应用协议不维护版本号。线程详情由 `threads.read` 的 Conversation snapshot 初始化，从同一响应的 watermark 订阅类型化 `conversation.change`，用共享 reducer 更新后再投影给 renderer。无需重建 Codex 通知；游标失效时重新读取，不能在已物化内容上重复追加历史增量。

## 本地数据边界

线程详情遵循 Conversation snapshot/change → 共享 reducer → presentation model → renderer。connection profile 和设备密钥只进入浏览器安全存储；session bearer 使用不可导出的 AES-GCM key 加密保存。已认证业务状态可保留原始正文与路径；正文中出现凭据样式文本不触发内容过滤。认证凭据、设备私钥和 session token 仍只进入专用受保护存储；日志、URL 和普通遥测不因此增加业务内容或凭据。

可信 E2EE device_revoked 关闭必须保留撤销原因、停止自动/手工重连，只清理当前 profile session 并回到登录。普通网络失败不认定撤销成功；session 过期和本地存储损坏继续按既有认证流程处理。所有远程设备丢失时，页面提示通过 Owner 本机或 CLI 生成新的登录链接。

## Owner 内容与接口边界

Conversation → presentation → renderer 保留，展示模型重构另开任务。展示转换不再清空秘密问答答案；输入控件的 isSecret 行为保留。Skills 使用稳定 name/path，前端不保存临时授权 handle；发送时服务端重新校验当前 cwd 目录。Skills scope 直接使用 user/repo/system/admin，不保留 project→repo 兼容转换。

Owner 详细错误保持本地化操作提示，同时按文本显示原始 message/details；不解释 HTML，也不自动记录到遥测。浏览器收到的 frame、Conversation snapshot/change 和 cursor 仍执行结构检查。

## 开发场景工作台

Vite 开发入口 `/__dev/ui` 使用合成 Conversation 数据并复用正式 reducer、展示投影和聊天 renderer。它共用 ThemeProvider、纯 WorkspaceLayout 与 Sidebar 基础组件，控制侧栏替换业务导航；不初始化 Owner 认证、runtime 或正式草稿存储。仅面向桌面，生产构建不包含入口与场景。主题选择共用正式偏好存储，回放、草稿和侧栏宽度保存在内存。

## UI 主题

内置主题采用开发期颜色生成，浏览器只消费静态语义色表；输入、生成策略、检查命令与验收边界见 [UI 主题生成](theme-generation.md)。

## Composer Queue 与 Steer

运行中发送默认进入当前线程单条内存 Queue，保存完整草稿、skills、代码卡片和发送配置；新输入不覆盖已有 Queue。手动 compact 请求受理前后均视为运行中；在 Turn/item 事件到达前先将 Queue 保持为待绑定，识别 `contextCompaction` 所属 Turn 后绑定，等待整个 Turn 结束才自动发送。压缩 item 完成不代表 Turn 完成，压缩期间不可 Steer。Queue 经 `ComposerInput.leadingContent` 展示，与新对话 ProjectPicker 互斥。Edit 仅在草稿为空时恢复内容，Delete 删除，Steer 向可 steer 的绑定 active Turn 追加输入。

仅当前线程已同步、无活动或待处理 Interaction，且绑定 Turn 正常完成后自动调用一次 `turn.start`。Queue 保留并发/投递锁，但不展示独立 sending 阶段；成功复用普通发送的 pending transcript，失败经 Composer 显示并保留消息。失败、停止和提交异常保留并暂停，Edit 取回重发；结果不确定不自动重试。切换线程保留但不后台调度；刷新、关闭或退出 Owner 清空。

有效邀请展示期间每三秒查询状态；页面隐藏暂停、恢复可见立即查询，卸载清理 timer/listener。消费成功收起二维码并刷新列表；邀请结束时收起二维码并刷新设备列表。网络查询失败不表示邀请结束。复制链接是辅助动作，默认不展示长 URL。移除操作须确认；全部移除明确包括当前远程设备，之后可在运行 Owner 的本机使用 CLI 生成新登录链接。设备友好命名不在本轮范围。
