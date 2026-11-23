# Current behavior

状态快照：2026-11-23（本机直连与统一 Passkey 实施）。下方历史验收记录保留其当时范围；本节描述最新源码与本轮验证，不把未运行的用户服务或浏览器流程写成已验收。

## 已实现的 Owner 和设备行为

- Owner 是单一本地身份。本机浏览器只从精确的 `http://localhost:5173` / `http://127.0.0.1:5173` 访问工作台；Owner 同时校验实际 loopback socket peer、Host 和 Origin，并为连接注入不持久化的内存 admission。本机没有 Passkey、bearer 或持久 session。
- WebAuthn 仅使用配置的远程 App HTTPS origin 和由其 hostname 推导的 RP ID。远程 Passkey 只用于已登记设备重新认证；远程 session 必须绑定有效配对设备。未配置远程 origin 时，本机工作台和 CLI 仍可用，远程 invitation/Passkey 不可用。
- 浏览器使用 Owner 签发的五分钟、单次 enrollment reference 登录。Owner 校验 invitation、当前 Owner/node/trust epoch 和 E2EE 浏览器公钥；首次创建设备，已登记公钥复用 deviceId，再签发配对凭据和新 session。Passkey 可选，同一浏览器重复链接登录不再重复登记。
- invitation 可由 Owner 本机管理、CLI 或已认证配对设备签发。远程 Passkey 已配置时，配对设备签发前必须在当前 session 完成五分钟内的 Passkey step-up；Owner 本机和 CLI 保持全设备丢失后的恢复能力。邀请链接使用服务端配置的 `appOrigin`。
- invitation 支持替换、状态查询和取消；成功消费、过期、Owner/Relay 重连失效、设备撤销会清除有效 reference。Relay 只保存在线 reference 路由，不执行 Owner 授权。
- Remote Relay 协议不再接受 Owner-code login candidate、first-session grant 或 bootstrap reference 旧分支。Owner code 只留作 Owner/Relay 内部在线节点冲突路由；Relay 不提供 HTTP 查询接口，Owner 管理/CLI 不提供显示或轮换操作。
- Owner recovery-code 表、认证域、方法、CLI/IPC 命令和 UI 已删除。普通 management login QR 及其 capability store 已删除。
- 浏览器使用独立、多条目的 IndexedDB connection profile。每个 profile 有独立的不可导出设备私钥、Owner public-key pin、node/Owner identity、配对 token、trust epoch 和 AES-GCM 加密 session。旧 `device-key` 表在 schema 升级时删除，不会自动迁移成可信 profile。
- 远程登录支持逐 profile 连接、连接测试、logout 与移除。logout 只清当前 profile session；移除尝试通过当前 session 撤销设备，并始终清理本地 profile secrets。Passkey 只用于身份匹配的已知 profile 重新认证。
- Profile 的 Owner key、node ID 或 trust epoch 不匹配时连接失败关闭；profile session 失效、可信 device_revoked 关闭或本地解密失败只影响该 profile。

## 仍需完成的验收

- 已完成自动化：完整 `pnpm test`、`pnpm typecheck` 和本任务触及 TypeScript 文件 `oxfmt --check`；本机 peer/Host/Origin 拒绝、内存 admission、远程设备 session/Passkey、旧 schema 拒绝及临时 reset fixture 均有覆盖。实现最终计数以本轮运行结果为准。
- 未执行真实 `.data/codex` 数据库重建：用户运行的 Owner 服务仍占用 3000 端口。`pnpm db:reset` 会清除 Owner SQLite 控制面数据、Passkey 和已配对设备；运行 Owner 停止后由用户执行，保留 Codex Home、工作区文件及 Owner node identity。
- 未能完成新代码的浏览器/Relay 手工验收：现有 5173/3000/8787 用户服务已运行，其中 Fastify 进程不会热加载本次源码，页面显示 Owner connection failed。切换到新代码后需验证本机刷新/深链接/Connection、远程邀请/Passkey/session 恢复/设备撤销与 Owner/Relay 重连。真实 Bitwarden 操作仍为用户后续验收。
- Enrollment UI 默认使用已配置的可信 Relay profile；本次不实现邀请自带自定义 Relay URL。

## 文档边界

本机直连实现规格见 [`impl/local-owner-access/README.md`](impl/local-owner-access/README.md)；架构、API 和前端现行契约已同步本机免交互与远程单一 Passkey 边界。

Server 的 Conversation 事件链由 runtime adapter 转换为共享 Conversation facts/state，Owner WS 和历史回放使用统一领域正文。已认证 Owner 的业务内容与路径不经过保密性过滤；不再提供递归脱敏或 `runtime.extension` 原生消息降级。未映射方法仅作诊断，不作为任意原始 RPC 透传。单事件 128,000 UTF-8 字节及 frame 1 MiB 上限保留，超限明确失败。

目标架构和安全边界见 [`owner-remote-architecture.md`](./owner-remote-architecture.md)，Owner 与前端契约见 [`api/README.zh-CN.md`](./api/README.zh-CN.md) 和 [`frontend/README.zh-CN.md`](./frontend/README.zh-CN.md)，server 事件实现规格见 [`impl/archived/server-event-architecture/readme.md`](./impl/archived/server-event-architecture/readme.md)。

## Server event architecture 收尾（2026-11-04）

本节记录 2026-11-04 的验收基线；其中 native reducer、安全 projection 和 runtime.extension 已由下方 Conversation 实施结果取代。Owner 应用协议和 domain event 已移除版本字段、版本专用错误与事件表 schema_version 列，前后端共同更新；Relay、IPC、runtime manifest 保持独立。共享 envelope parser 和 cursor 保留；分页依据原始扫描位置，不因非法记录提前结束；历史补全不重复已物化 plan/reasoning 文本。

事件 epoch 每次进程启动变化，旧 epoch 通过 reset 恢复快照；契约失败停止消费及后台自动恢复、保留 transcript。事件表直接使用当前结构，不提供旧结构迁移命令或专用启动检查；本次没有修改真实本地数据库。

开发验证：server 121、protocol 20、Relay 23、App 261 项测试通过；全仓类型检查、35 个暂存 TS/TSX 格式检查和 lint:staged 通过。用户浏览器回归待执行，见 [事件验证记录](impl/archived/server-event-architecture/04-verification.md)。本节不改变上文设备 enrollment 手工验收状态。

## Conversation 与 Owner 内容链路收尾（2026-11-21）

共享 Conversation 模型、Owner adapter/快照/事件存储与 App 状态消费已接入；前端 presentation 和 renderer 结构保留。内容安全出口、过滤专用缓冲和通用原生投影已删除，问答结果保留答案。Skills 使用稳定 name/path，执行前重新核对当前 cwd 的 enabled 技能；已认证业务错误返回原始 message 和显式字符串 details，公开方法与 Relay 错误合同保持原约束。认证、设备信任、目录归属、容量限制、持久化及 gap/reset 恢复继续保留；未操作真实数据库或 Codex Home。

自动化检查通过：使用根 `pnpm test` 运行全部 workspace 测试，并通过全仓 `pnpm typecheck` 和触及 TypeScript 文件格式检查。提交前 staged lint 结果见 [05 实施记录](impl/conversation-model/05-owner-filter-removal-and-simplification.md)。浏览器只确认 localhost 登录页可达；登录后的聊天、历史、Skills、问答/审批和断线恢复仍待持有 Passkey 的用户验收，不改变设备 enrollment 的待验收状态。

## Connection 管理收敛（2026-11-23）

Settings → Connection 保留 Passkey 配置；设备管理只保留生成、查看、取消登录链接、移除单个/所有设备。Web/CLI 共用串行设备管理模块；邀请仅暴露有效/无效状态。移除同步清理设备/session/连接，全部移除不轮换 Owner identity、密钥或 trust epoch，不撤销本地 session。

CLI 仅通过 IPC 连接运行中的 Owner，停机先执行 `pnpm server`；移除了临时 runtime、auth status、auth sessions revoke-all、enrollment recover、trust reset。保留 devices list、enrollment issue、devices revoke/revoke-all，撤销需交互确认。enrollment issue 显示“生成登录链接”；CLI/IPC 独立取消入口已删除，Web 保留取消。CLI 退出后链接仍由 Owner 持有。

一次性登录复用当前 Relay 下最近使用的已配对浏览器 profile，保留密钥及 Owner identity pin；无记录才创建。既有重复记录不自动删除。链接登录失败不删除已有 profile 或撤销原设备；已移除设备须拿到新链接重新登记。没有有效 session、Passkey 或新链接时，设备密钥本身不构成登录授权。

URL 登录直接复用既有登录页（保留 /app/enroll 链接地址），自动兑换并在同页显示错误/重试，已删除独立 EnrollmentRoute 页面。Relay 入站解密串行，原生 close 等待已收到消息交付，防止成功响应解密前 paired 收尾将其误判为 Owner 不可用；解密失败停止后续交付，延迟旧连接回调不影响新连接。

前端目录迁到 app/settings/connection，明确撤销停止重连并清当前 profile session；普通断连不当作撤销成功。存储结构不变、未操作真实数据库。实施与实际验证结果以 [本轮规格](impl/connection-management/README.md) 为准；历史记录不构成本轮浏览器/Relay 验收。
