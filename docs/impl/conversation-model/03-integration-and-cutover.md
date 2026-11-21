# Task 03：集成、清理与验收

> 后续内容过滤、Skills 标识与详细错误合同以 [05](./05-owner-filter-removal-and-simplification.md) 为准；本文旧安全投影约束与结果不再代表 05 完成后的行为。

## 状态与依赖

- Automated implementation and checks complete；依赖 [00 领域合同](./00-conversation-contract.md)、[01 Owner Server](./01-owner-server.md) 和 [02 App](./02-app.md)。真实 Codex capture 与隔离浏览器人工验收待执行。
- 父规格：[development-spec.md](./development-spec.md)。

## 目标

验证 Codex runtime 经 server adapter 到前端 presentation 的完整数据路径，在允许删除旧 Owner 数据的前提下切换到新 store/wire model，并证明第二种 adapter 可复用共享领域合同。

## 集成验收

- 逐项执行 schema matrix 对 Conversation candidates 的 coverage disposition；所有 schema item/request/notification 均为 mapped、明确不属于 Conversation、或安全 diagnostic，不允许静默 drop。
- 用官方 schema-derived fixtures 验证未被真实 capture 触发的 plan、file change、user input、MCP elicitation、permissions approval、realtime item 等结构；将 fixtures 标记为 synthetic。
- 用本地真实采集样本验证 assistant stream、approval、read/resume、多轮和 compaction。样本 prompt/output/path 仅本地使用；不进入 Git、测试快照、普通日志或共享 task artifact。
- 第二种 fake adapter 产出同一领域 event/snapshot/command contract；至少覆盖 assistant message、activity、interaction、agent relation，不增加 reducer 的 runtime 分支。
- 端到端覆盖 open snapshot/watermark、buffered event、live subscribe、disconnect resume、cursor reset、server restart、duplicate delivery 和 Conversation/thread ownership。
- 安全验收同时检查持久化 DTO、Owner WS frame、browser state、日志与 test output；领域模型映射后才执行最终 safe projection，projection 未通过则拒绝 emit/store。
- Chat parity 验收对同一 snapshot/event fixture 比较迁移前后的消息顺序、activity grouping、状态、Composer interaction 和错误/加载反馈；差异必须归零，除非父规格后续显式接受。

## Cutover 与数据边界

- 新 Owner SQLite schema 从空库创建；不实现旧 owner.sqlite/event envelope/domain_events migration，也不保留旧 wire event alias。
- 因全库可重建，测试及开发切换以全新 Owner 初始化为前提；清除旧库意味着 Owner/Passkey/device/session/credential/project 等 Owner 数据需重新配置。
- 不删除 Codex Home 或 App Server 原生 conversation transcript；重建 Owner store 后通过 App Server `thread/read` 重新读取原生对话。
- 此任务文档不授权执行实际删库；若实现需要命令操作用户数据，仍按当时明确授权与仓库安全约束执行。

## 验证和手工验收

- 自动化已通过：`pnpm test`、`pnpm test:frontend`、`pnpm --filter @codex-web/conversation test`、`pnpm typecheck`、触及 server 文件的 `oxfmt --check` 与 `git diff --check`。
- 仍需在隔离 Owner 环境执行真实 Codex capture 和浏览器工作流；不得使用或重置真实 Owner SQLite、Codex Home 或私有采集数据。
- 提交前只 stage 本次预期文件并运行 `pnpm lint:staged`；不提交 `.data` capture 或未审查 prompt/output。
- 手工回归：Owner 全新初始化；打开已有 Codex thread；连续接收 assistant delta；执行并展示现有 command/file interaction；回答或拒绝现有审批/user-input；验证子 Agent 关系数据可保留但不要求新增 UI；断线后恢复且无重复/丢失；SQLite 重建后原生 transcript 可重读。所有既有可见行为保持不变。
