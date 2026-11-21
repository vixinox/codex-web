# Telemetry 重构

状态：Verified。Task 00–04 已完成，开发时自动化验收通过。本文档目录是本次 telemetry 全面重构的唯一规划文档位置；任何范围、契约或验收变更都应先更新主规格，再更新受影响的任务包。

## 文档

- [主规格](./development-spec.md)：共同决策源、当前基线、契约、端到端错误与日志行为、验收门槛。
- [契约与 Owner Protocol](./00-contract-and-protocol.md)：第一阶段前置任务，冻结共享错误目录并迁移 wire/parser。
- [App](./01-app.md)：浏览器错误类型、展示、本地化和 Owner 请求集成。
- [Owner Server](./02-owner-server.md)：错误产生与映射、Fastify/Pino 和业务日志迁移。
- [Relay](./03-relay.md)：Bun 日志、内部连接分类与安全 close reason。
- [集成与验收](./04-integration-and-acceptance.md)：跨包回归、日志安全审查和手工验收。

## 执行顺序

```text
00 契约与 Protocol
       ├── 01 App
       ├── 02 Owner Server
       └── 03 Relay
              └── 04 集成验收
```

任务 00 完成并冻结 telemetry 导出和 Owner wire DTO 后，01/02/03 可并行实施。三端均通过各自验收后进入 04。任务包只描述可委派工作，不代表已启动子代理。

## 状态与变更规则

- 主规格状态：Verified。
- 任务包状态：任务 00/01/02/03 Complete；任务 04 Verified。
- 新证据若改变错误载荷、日志字段或安全边界，先更新主规格和受影响任务包，再继续实现。
- 实施期间维护主规格和任务包状态、验证结果及已接受偏差；不得仅因并行工作而提前解除契约依赖。

## 变更记录

- 2026-11-05：建立完整 telemetry 重构规划；旧的包基础设施规格标记为 superseded。
- 2026-11-05：完成任务 00–04 的实现与集成验证，状态更新为 Verified。
