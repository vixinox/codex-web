# Task 04：旧代码与兼容入口清理

> 后续内容过滤、Skills 标识与详细错误合同以 [05](./05-owner-filter-removal-and-simplification.md) 为准；本文旧安全投影约束与结果不再代表 05 完成后的行为。

## 状态与依赖

- 代码清理与自动化验证完成；人工浏览器验收待执行。依赖 00–02 已切换的主流程和 03 自动化基础。
- 父规格：[development-spec.md](./development-spec.md)。不要求旧 API 兼容，不操作真实 Owner 数据或 Codex Home。

## 目标与范围

- 移除前端旧 Codex reducer、历史重放、notification 重建和旧 presentation。有效行为断言迁移到 Conversation 测试，固定预期结果取代旧实现作为 parity oracle。
- 删除 `threads.send`、`threads.cancel`、`userInput.respond`、`approvals.resolve` 的公开注册和专属解析。新命令仍需使用的发送、取消业务提取为内部 application 操作，保留授权、模型/skill 校验、队列和一次性回复。另删除无调用的旧 `threads.status` 轮询入口和专属 EventHub 状态推导。
- 新增 typed `conversation.compact` command，经 `conversation.command` 发送；迁移 App 后删除 `threads.compact` RPC，不改变现有行为。
- 删除无生产引用的旧事件转换、runtime status 分支、helper、exports 与 fixtures。workspace 事件投影按实际消费者保留，不按 Codex/Thread/DomainEvent 名称一概删除。
- 保留 `threads.read` 的 Conversation snapshot/watermark 合同、Owner stream/resume/reset、workspace 订阅、原生 Codex adapter、安全投影和新 store。
- 不扩展至采集工具拆分、新 UI、无关架构整理或实际删库；不自动提交。

## 验收与验证

- 生产代码与保留测试不再引用旧 reducer、旧历史重放或旧 presentation；旧模型不再作为测试 oracle。
- 六个旧 RPC 不再注册，调用返回现有 method-not-found 错误；App 发送、取消、compact 和 Interaction reply 走有效接口。
- 验证 Owner/thread 授权、模型/skill 校验、队列取消、Interaction 一次性回复、workspace sidebar/skills 更新。
- 运行受影响 App/Server/Protocol/Conversation 测试、`pnpm typecheck`、触及文件 `oxfmt --check` 和 `git diff --check`。提交前按根指令运行 `pnpm lint:staged`。
- 用户在隔离环境运行 `pnpm server`、`pnpm dev`，回归聊天、command/file、审批/问答、compact、断线恢复。人工验收未完成不得标记全量通过。
- 完成报告列出删除的模块与入口、保留项及理由、行数变化；不设置删行配额。

## 实施结果

- 删除前端旧 Codex reducer/presentation、旧重放测试与专用 protocol 类型、无调用的 bridge re-export；不再保留旧实现作为 parity oracle。
- Conversation presentation 的固定预期覆盖 interleaved order、final answer、command/file/plan、usage、compaction、问答终态/秘密回答、取消正文和时间。旧模型的历史水合/通知解析测试由现行 adapter、共享 reducer、Owner cut/store 和 client resume/reset 测试承担；旧问答答案广播与 ID 字符串/数字兼容测试删除。
- 删除旧 RPC、原生 `webcodex/userInput/answered` 投影、无生产调用的 EventHub raw ingress/指定 ID 写入、事件反转工具和旧 fixture。保留原生 request ID 类型、workspace 投影和 Owner envelope，分别用于 RPC correlation、sidebar/skills 更新和现行 transport。
- 通过 `pnpm test`、App 226 项测试、Conversation 7 项测试、全仓 typecheck；新增 Owner frame 测试验证六个旧入口返回 `owner.request.method-not-found`，compact 验证授权及原生请求。
- 全仓 `pnpm lint` 仍报告本轮未改文件中的 7 个错误（telemetry/rpc-message-summary 的 no-control-regex、conversation-egress 的 no-useless-escape、event-store 的 unbound-method）；本任务不修改无关规则或代码。
- 触及的 22 个 TS 文件格式检查与 `git diff --check` 通过；针对触及文件的 lint 无 error，但仍报告类型断言等 warning，未声称 lint 全绿。相对实施前暂存区，包含本任务文档和替代测试后净减少约 3,000 行。
- 这里的自动化结果不代表全部旧 UI parity 已获人工确认；model/skill/search 等行为的完整验收仍受 03 验收约束，不能仅凭旧测试删除认定对应能力已通过。
- 不创建提交、不调整既有暂存区。03 的真实 Codex capture 和隔离浏览器人工验收继续待执行。
