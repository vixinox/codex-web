# Task 05：Owner 内容过滤删除与链路简化

## 状态与启动

- 状态：**Verified (development checks); manual acceptance pending**。实现、自动化测试与提交前检查已完成；人工浏览器验收单独交接。
- 父规格：[development-spec.md](./development-spec.md)。当前 workspace 源码是基线，不推断暂存或未暂存改动的意图。
- 本任务取代 00–04 中的内容安全投影、路径保密、问答答案清空及 Skills handle 决策；其他领域、恢复、授权与 UI 行为合同继续有效。

## 确认决策与边界

- 已认证 Owner 可以接收自己的业务正文、路径、命令、diff、工具输出与交互结果；不因出现 token/secret 等文本而改写内容。
- 盘点整个 Owner API。删除保密性过滤及附属状态；保留领域转换、Thread 摘要、模型目录和配置接口的数据组织职责。前端 Conversation → presentation → renderer 不重构。
- 保留认证、设备信任、线程/受控目录归属、参数及协议结构校验、容量限制。凭据库、私钥与服务端加密密钥不新增读取入口，日志策略不变。
- 不增加第二个 runtime、新 UI、任意配置/数据库直读、旧合同兼容或数据库重建。实施期间保留现有 WIP；用户在收尾时明确要求 add 全部并提交，本次提交范围包含工作区已有 Conversation 改动及本任务实现。

## 实施顺序与接口

1. 删除 Conversation egress 与其流式敏感前缀缓冲。adapter 保留模型已有字段原值；不复制未知原生对象。delta 直接交付，完成事件缺正文时由 reducer 保留已有内容。快照仍按 watermark 补齐进行中条目和 Interaction，避免重复 delta。
2. Conversation 通知直接路由 adapter；workspace 仅转换一次。删除无用原生投影、递归脱敏、JSON 往返复制；边界校验保留，内部不重复深度检查。保留持久化后交付、gap/reset、终态保护和一次性回复。超限明确失败，不静默清空/截断。
3. 删除 SkillHandleStore/TTL/cache。列表提供 name/path，发送参数改为 skills: {name,path}[]；最多 32 项，不允许重复。执行前按当前 cwd forceReload 技能列表并精确匹配 enabled 项，不信任客户端路径。
4. 已认证 Owner 错误保留稳定 code/retryable/params，增加 details?: string，message/details 保留原值。业务层捕获错误保留 cause；仅提取 Error.message 和显式字符串 details/additionalDetails，不递归序列化异常、stack、请求或凭据对象。Owner 专用类型与 parser 不放宽 Relay/未认证错误。前端同时展示稳定提示与详细文本。
5. 审视 workspace/管理数据；删除保密性业务过滤和纯重复搬运，保留产品列表规则、凭据管理边界和接口组织。没有实际收益的抽象不为删而删。

## 验收与验证

- 合成正文含凭据样式、Windows/POSIX 路径、URL、命令/diff：live/store/reload/resume 保真；原始 capture 不提交。
- 覆盖跨 delta、完成事件空正文、发送中刷新、重复/迟到事件、reset、写入失败、超限和 Interaction 回复/取消/失效。
- Skills 覆盖无需 TTL、刷新、目录切换、移除/禁用、重复/伪造选择。
- 已认证详细错误有 message/details、无 stack/任意对象；未认证和 Relay 合同不变。
- 受影响 Server/Protocol/Conversation/App/Telemetry/Relay tests；pnpm typecheck；触及文件 pnpm exec oxfmt --check；git diff --check。
- 用户启动 pnpm server 与 pnpm dev 后验收聊天、历史、command/file、问答/审批、Skills、管理错误、断线恢复。不新增 React DOM/Playwright/视觉测试。
- 旧内容已被删减则不能凭空恢复；不主动改变数据库 schema，不操作真实 Owner 数据或 Codex Home。

## 实施结果

- 已删除 Conversation egress、过滤专用流式缓冲、native protocol 通用安全投影和 runtime.extension 链路；Conversation 与已知 workspace 通知分别转换一次。adapter 保留领域模型已支持字段的原值，不增加未知字段透传。
- EventHub 在事件边界校验，内部 Store append 不再重复深度 parse；数据库读取仍校验。保留先持久化后交付、gap/reset、容量上限和 Interaction 生命周期。快照避免重复应用已有正文的 delta，空完成事件保留已积累正文/输出，已回答问答不清空答案。
- Skills 删除 handle/TTL/cache，改用稳定 name/path；执行前重新加载当前 cwd 技能目录并校验 enabled、重复与数量限制。Owner 专用错误支持原始 message 和显式字符串 details；未认证/公开方法与 Relay 合同不放宽，不返回 stack 或任意异常对象。
- 前端继续使用独立 presentation 模型和现有 renderer；未扩展为展示模型重构。认证、设备信任、受控目录与 Thread 归属、凭据管理边界、日志策略均保留。未重建数据库，未操作 Codex Home。
- 自动化测试全部通过：Server 153、App 227、Protocol 25、Conversation 8、Telemetry 14、Relay 27，共 454 项；`pnpm typecheck`、全部 85 个待提交 TS/TSX 的 `pnpm exec oxfmt --check`、`git diff --cached --check` 通过。提交前局部 lint 修正后重新运行 Server、Conversation、App 测试及全仓 typecheck，均通过。
- 初次触及文件 oxlint 检查为 0 errors / 102 warnings，因 maxWarnings=0 返回非零。用户授权全部提交后，`pnpm lint:staged` 检出 9 条新增警告；修正对象复制、Promise 返回值、循环条件，并为保留串行设备撤销顺序添加局部说明后，`pnpm lint:staged` 通过（无新增错误或警告）。这不代表清除了仓库既有 warning 基线。
- 人工浏览器验收：已有 localhost 服务登录页可达；后续流程需 Owner Passkey，尚未验证聊天、历史、command/file、问答/审批、Skills、管理错误及断线恢复。未启停用户现有服务；这是实施后的用户验收项。

## Owner API 盘点与保留理由

| 区域 | 05 处理 |
| --- | --- |
| Conversation egress/native protocol/domain extension | 删除安全出口、流式过滤状态及通用原生投影；已知 workspace 通知直接转换，Conversation 单独映射 |
| Thread 列表 | 保留摘要与隐藏 ephemeral/child 的产品规则；sanitizeThreadSummary 更名为 toThreadSummary |
| Skills | 删除 handle/TTL/cache 与 project→repo 冗余转换，列表直接提供可选技能的 name/path |
| 模型与配置 | 保留 Composer 所需目录及 model/effort 支持检查；不把领域适配当作内容过滤删除 |
| Project 与 Credential | 保留业务结果和凭据管理专用接口；不增加凭据库读出功能 |
| runtime 状态 | 已认证 codex.status.error 返回原始错误文本，不再替换为 CODEX_UNAVAILABLE |
| Owner 错误 | 单独 Owner DTO 支持 message/details；公开/Relay DTO 不放宽，业务 catch 保留 cause |
| 前端 presentation | 保留层结构，仅删除问答答案清空规则；isSecret 输入行为不变 |
| EventHub/Store | 入口与读取边界校验保留，内部 append 不再重复深度 parse；持久化、gap、reset 保留 |

补充默认：快照对有正文的已物化消息保持权威，只用历史补齐缺失或空的进行中消息。128,000 字节事件/1 MiB frame 容量限制保留，超限失败并触发 gap 或明确错误，不静默丢内容。
