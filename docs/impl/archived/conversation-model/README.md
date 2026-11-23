# Conversation 模型重构

本目录记录 Chat 数据模型从 Codex 协议绑定形态迁移到共享 Conversation 领域模型的决策、实现任务和验收状态。

## 文档

- [主开发规格](./development-spec.md)：当前基线、领域模型、数据流、决策和验收合同。
- [App Server schema 覆盖与缺口](./schema-coverage.md)：基于仓库 App Server 0.167.0 schema 的协议面清单、当前映射和后续 UI backlog。
- [00 领域合同](./00-conversation-contract.md)：共享模型、状态变化、身份、恢复和安全投影。
- [01 Owner Server](./01-owner-server.md)：Codex adapter、Fastify 状态组装、持久化和 Owner WS。
- [02 App](./02-app.md)：前端领域状态消费、presentation 投影和 UI 决策边界。
- [03 集成与清理](./03-integration-and-cutover.md)：跨 runtime 契约验证、数据重建和验收。
- [04 旧代码清理](./04-legacy-cleanup.md)：移除旧 reducer、presentation、RPC 兼容入口与遗留测试依赖。
- [05 Owner 内容过滤删除与简化](./05-owner-filter-removal-and-simplification.md)：取消内容安全出口，简化 Skills 与详细错误；取代前述内容过滤约定。

## 依赖顺序

```text
schema 覆盖盘点 + 00 领域合同
                 ├── 01 Owner Server
                 └── 02 App (保持现有 UI 行为)
                           └── 03 集成与清理 → 04 旧代码清理
```

00 冻结领域合同后，01 和 02 可并行。02 必须保持当前可见行为，不实现 schema-coverage 中未要求的新 UI。03 依赖 server/app 合并结果。

## 状态

- 实现：00–03 的共享模型、Owner server、App 接入与自动化集成检查已落地。
- 自动化验证：Conversation、Server、Protocol、Relay、App 测试及全仓 typecheck 通过。
- 待验收：隔离环境真实 Codex capture 与浏览器工作流回归，详见 [03 集成与清理](./03-integration-and-cutover.md)。
- 主流程已切换；04 旧代码清理与自动化验证完成，人工验收仍待完成。
- schema 覆盖率用于约束领域模型完整性，不等同于本次新增 UI 验收范围；UI gap 是后续 backlog。
- 05 实现及自动化测试、typecheck、全部待提交 TS/TSX 格式检查、lint:staged 已通过；人工验收状态见任务文档。
