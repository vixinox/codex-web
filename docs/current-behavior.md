# Current behavior

状态快照：2026-10-31。旧 Owner 远程访问验收基线来自 `1ea0e1c`；设备 enrollment 迁移已接入源码。本文描述工作区当前真实行为，不把未验证的流程写成已验收。

## 已实现的 Owner 和设备行为

- Owner 是单一本地身份。认证代码仍通过 localhost 与 remote 两种 WebAuthn profile 管理 Passkey；本地入口只显示本地 Passkey，远程入口显示保存的 connection profile。
- 未知浏览器使用 Owner 签发的五分钟、单次 enrollment reference。Owner 原子校验 invitation、当前 Owner/node/trust epoch 和 E2EE 浏览器公钥，再创建设备、配对凭据和首个 session。
- invitation 可由 Owner 本机管理、CLI 或已认证配对设备签发。远程 Passkey 已配置时，配对设备签发前必须在当前 session 完成五分钟内的 Passkey step-up；Owner 本机和 CLI 保持全设备丢失后的恢复能力。
- invitation 支持替换、状态查询和取消；成功消费、过期、Owner/Relay 重连失效、设备撤销和 trust reset 会清除有效 reference。Relay 只保存在线 reference 路由，不执行 Owner 授权。
- Remote Relay 协议不再接受 Owner-code login candidate、first-session grant 或 bootstrap reference 旧分支。Owner code 只留作 Owner/Relay 内部在线节点冲突路由；Relay 不提供 HTTP 查询接口，Owner 管理/CLI 不提供显示或轮换操作。
- Owner recovery-code 表、认证域、方法、CLI/IPC 命令和 UI 已删除。普通 management login QR 及其 capability store 已删除。
- 浏览器使用独立、多条目的 IndexedDB connection profile。每个 profile 有独立的不可导出设备私钥、Owner public-key pin、node/Owner identity、配对 token、trust epoch 和 AES-GCM 加密 session。旧 `device-key` 表在 schema 升级时删除，不会自动迁移成可信 profile。
- 远程登录支持逐 profile 连接、连接测试、logout 与移除。logout 只清当前 profile session；移除尝试通过当前 session 撤销设备，并始终清理本地 profile secrets。Passkey 只用于身份匹配的已知 profile 重新认证。
- Profile 的 Owner key、node ID 或 trust epoch 不匹配时连接失败关闭；profile session 失效、撤销通知或本地解密失败只影响该 profile。

## 仍需完成的验收

- 自动化检查通过：服务端 118 项、协议 17 项、Relay 23 项、前端 252 项测试；全仓 TypeScript 类型检查和本任务目标 TypeScript 文件格式检查通过。
- `pnpm lint` 未通过：本轮 lint 结果报告 warning 并返回非零；没有 error 诊断。warning 包含仓库已有代码和迁移触及代码，提交前应通过 `pnpm lint:staged` 对 staged delta 判断是否引入新 warning。
- 尚未执行实际浏览器/Relay 手工验收：local 与 remote origin 分离、发出邀请、陌生浏览器一次兑换、paired session 恢复/Passkey step-up、profile test/logout/remove、取消/过期/replay、Owner/Relay restart、trust reset 和设备撤销。
- Enrollment UI 默认使用已配置的可信 Relay profile；本次不实现邀请自带自定义 Relay URL。

## 文档边界

Server 的 Conversation 事件链由 runtime adapter 转换为共享 Conversation facts/state，Owner WS 和历史回放使用统一领域正文。已认证 Owner 的业务内容与路径不经过保密性过滤；不再提供递归脱敏或 `runtime.extension` 原生消息降级。未映射方法仅作诊断，不作为任意原始 RPC 透传。单事件 128,000 UTF-8 字节及 frame 1 MiB 上限保留，超限明确失败。

目标架构和安全边界见 [`owner-remote-architecture.md`](./owner-remote-architecture.md)，Owner 与前端契约见 [`api/README.zh-CN.md`](./api/README.zh-CN.md) 和 [`frontend/README.zh-CN.md`](./frontend/README.zh-CN.md)，server 事件实现规格见 [`impl/archived/server-event-architecture/readme.md`](./impl/archived/server-event-architecture/readme.md)。

## Server event architecture 收尾（2026-11-04）

本节记录 2026-11-04 的验收基线；其中 native reducer、安全 projection 和 runtime.extension 已由下方 Conversation 实施结果取代。Owner 应用协议和 domain event 已移除版本字段、版本专用错误与事件表 schema_version 列，前后端共同更新；Relay、IPC、runtime manifest 保持独立。共享 envelope parser 和 cursor 保留；分页依据原始扫描位置，不因非法记录提前结束；历史补全不重复已物化 plan/reasoning 文本。

事件 epoch 每次进程启动变化，旧 epoch 通过 reset 恢复快照；契约失败停止消费及后台自动恢复、保留 transcript。事件表直接使用当前结构，不提供旧结构迁移命令或专用启动检查；本次没有修改真实本地数据库。

开发验证：server 121、protocol 20、Relay 23、App 261 项测试通过；全仓类型检查、35 个暂存 TS/TSX 格式检查和 lint:staged 通过。用户浏览器回归待执行，见 [事件验证记录](impl/archived/server-event-architecture/04-verification.md)。本节不改变上文设备 enrollment 手工验收状态。

## Conversation 与 Owner 内容链路收尾（2026-11-21）

共享 Conversation 模型、Owner adapter/快照/事件存储与 App 状态消费已接入；前端 presentation 和 renderer 结构保留。内容安全出口、过滤专用缓冲和通用原生投影已删除，问答结果保留答案。Skills 使用稳定 name/path，执行前重新核对当前 cwd 的 enabled 技能；已认证业务错误返回原始 message 和显式字符串 details，公开方法与 Relay 错误合同保持原约束。认证、设备信任、目录归属、容量限制、持久化及 gap/reset 恢复继续保留；未操作真实数据库或 Codex Home。

自动化检查：Server 153、App 227、Protocol 25、Conversation 8、Telemetry 14、Relay 27 项测试通过，全仓 typecheck 和触及 TypeScript 文件格式检查通过。提交前 staged lint 结果见 [05 实施记录](impl/conversation-model/05-owner-filter-removal-and-simplification.md)。浏览器只确认 localhost 登录页可达；登录后的聊天、历史、Skills、问答/审批和断线恢复仍待持有 Passkey 的用户验收，不改变设备 enrollment 的待验收状态。
