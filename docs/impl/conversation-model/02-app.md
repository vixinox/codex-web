# Task 02：App Conversation state 与 presentation

> 后续内容过滤、Skills 标识与详细错误合同以 [05](./05-owner-filter-removal-and-simplification.md) 为准；本文旧安全投影约束与结果不再代表 05 完成后的行为。

## 状态与依赖

- Implementation complete；自动化验证通过，详见 [03 集成与清理](./03-integration-and-cutover.md)。领域消费依赖 [00 领域合同](./00-conversation-contract.md)，server open/watch wire 集成依赖 [01 Owner Server](./01-owner-server.md)。首轮 presentation 保持现有可见行为，schema gap 不引入新 UI。
- 父规格：[development-spec.md](./development-spec.md)。

## 目标

使 App Chat application/reducer 消费共享 Conversation model，不重建 Codex `method + params`，不在 renderer 或 session controller 内保存 runtime-specific recovery semantics。保留现有体验和可见行为，不在本次增加 UI。

## 实施范围

- 用 ConversationClient/application interface 读取 snapshot + watermark、订阅后续 changes、发送 typed command；Owner transport adapter 只处理 Owner wire DTO/cursor/resume/reset。
- 以共享 reducer/validated state 作为 Chat domain state；Controller 管理请求生命周期，renderer 不接触 Runtime DTO 或 DomainEventEnvelope payload。
- 将 Conversation state 投影成 UI-facing presentation model；允许 presentation 组合/折叠 activity，但不能反写领域状态，也不能丢失 domain identity、interaction status 或 parent-child links。
- 为矩阵中尚未展示的模型语义建立 UI backlog 条目；不在本次添加 visible state、action、layout 或 copy。
- 移除 snapshot-owned Codex method sets、method reconstruction 和 `runtime.extension` -> 通用 Chat error 作为主要 reducer 路径。

## 行为不变量

- App 打开会话只获取 server 权威 snapshot/watermark，之后应用 watermark 之后变化；重复、旧 epoch/reset、重连由 adapter/client contract 处理，不重复追加 transcript。
- Presentation 重建不能改变领域 cursor 或重复触发 mutation。
- unknown safe domain extension 显示受限诊断/摘要；renderer 不收到 raw runtime payload。
- 所有 UI-specific grouping、文字和 interaction controls 属于 presentation/UI 层，不污染 Conversation package。

## 验收与验证

- App domain tests 覆盖 open snapshot、live changes、resume/reset、重复 identity、agent child relation 和每个已确认 Interaction 状态。
- Presentation projection tests 覆盖当前已展示的行为，并证明迁移前后输出一致；未展示语义保留于领域 state 作为 backlog，不增加 renderer behavior。
- 运行 frontend focused tests、`pnpm typecheck`、触及 TS/TSX 文件的 `pnpm exec oxfmt --check`。
- UI acceptance 使用手工 browser regression；除用户另行要求，不增加 React DOM、Playwright、截图或视觉自动测试。

## 排除

- 不由 App 读取 App Server schema/native DTO。
- 不在 UI 层解决快照与事件切面、owner event persistence 或 runtime command mapping。
- 本次不承诺音视频、agent dashboard、完整 MCP elicitation 或 review panels 的交互形态；相关语义进入领域模型并记录在 UI backlog。
