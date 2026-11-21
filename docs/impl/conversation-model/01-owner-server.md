# Task 01：Owner Server Conversation adapter

> 后续内容过滤、Skills 标识与详细错误合同以 [05](./05-owner-filter-removal-and-simplification.md) 为准；本文旧安全投影约束与结果不再代表 05 完成后的行为。

## 状态与依赖

- Implementation complete；自动化验证通过，详见 [03 集成与清理](./03-integration-and-cutover.md)。依赖 [00 领域合同](./00-conversation-contract.md) 的共享 package 接口。
- 父规格：[development-spec.md](./development-spec.md)。

## 目标

由 Fastify Owner application 层成为 Conversation snapshot/state 的权威组装方。将 Codex 协议解释集中到 Codex adapter，将领域状态存储和 Owner WS 交付与具体 runtime 分离。

## 实施范围

- 新建 Codex adapter，将 App Server `thread/read` snapshot、86 notification catalog 中 Conversation candidate、thread-scoped server request/response 映射为 Task 00 领域类型；保留字段由 [schema-coverage.md](./schema-coverage.md) 逐项决定。
- 将 runtime command 转换集中在同一 adapter，包含 turn start/cancel、approval/user input response 和已有 Conversation 操作；适配错误转为有界 typed diagnostic。
- 实现 server Conversation application/port orchestration：授权/ownership 检查、snapshot + watermark cut、history/store 协调、subscribe/resume/reset、Interaction correlation 和一次性 RPC response。
- 将领域 store 与 SQLite adapter 使用全新 Owner DB 数据结构；不写旧 envelope 迁移。由此允许数据库从空库初始化，Owner、设备、credential、project 配置需重新建立。
- 保留 Owner stream transport 与 cursor 语义；新增领域 DTO parser/validator，不让旧 `codex.<method>` 事件成为公共模型。
- 最后执行 server egress projection：领域映射之后、对外落库和 WS emit 之前。只输出经审查的 safe DTO；不把原始 JSON-RPC、未审查 extension、绝对路径、cwd、secret、credential 或任意 prompt 字段复制到 event store/wire/log。

## 一致快照与失败语义

- `openConversation` 返回的 snapshot 和 watermark 必须是同一逻辑切面。Owner runtime ingress 必须可序列化地协调 event ingest 与 snapshot response barrier；切面后变化先缓冲，再按顺序交给订阅者。
- 若 App Server snapshot 失败，不返回新 watermark；若 store 写入失败，不声称事件已持久化。流恢复/reset 通过重新 open 取得权威 snapshot。
- 相同 source event 重复只提交一次；迟到事件不得倒退 terminal 状态；Interaction response 成功后重复 response 不再写给 runtime。
- runtime 不支持/版本 drift 的合法消息形成安全 adapter diagnostic；不将不明 payload 透传客户端。

## 验收与验证

- Codex adapter 每类 schema fixture 有 map/ignore/diagnostic 的显式决策；真实 capture fixtures 覆盖实际观察行为且不提交敏感原始 capture。
- 并发测试证明 snapshot 切面前事件进入 snapshot 或 history，切面后事件进入 buffered/live，不能两边皆漏；重复事件、reset、重启和 cursor expiry 有确定结果。
- Interaction 测试覆盖 server request routing、wrong thread、duplicate resolution、cancelled turn、runtime disconnect。
- Security projection 测试包含 nested secret/path 新字段、超大 payload 和未知 event，断言 SQLite/Owner WS/log 只得到批准 DTO。
- Server focused tests、`pnpm typecheck`、触及文件 `oxfmt --check` 通过。

## 排除

- 不更换 Relay/E2EE 职责，不把 Conversation 内容送到 Relay 存储。
- 不迁移或读取 Codex 私有 rollout JSONL。
- 不实现旧 Owner SQLite 内容迁移。
