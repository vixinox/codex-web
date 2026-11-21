# 测试规范

本文档是当前测试的唯一规范入口。测试数量和历史实施文档中的通过数量不是质量目标；测试必须对应当前 Owner-only 产品的行为、模块边界或安全不变量。

## 测试分层

### Fast unit

用于纯函数、reducer、parser、projection、状态转换和错误映射。优先使用合成输入，不启动 Fastify、Relay、Codex runtime、浏览器或数据库 schema 工具。

### Contract

用于 Owner/Relay/Protocol wire parser、Conversation change、Codex adapter、已承诺的 App Server schema catalog 和 adapter conformance。每个跨模块不变量只指定一个主要归属边界，其他层只验证自己的转换责任。

### Boundary

用于 Owner authentication、device trust、ownership、security projection、Relay admission、错误 DTO 和公开日志约束。边界测试必须断言不会泄漏凭据、原始 payload、路径或内部对象。

### Persistence and lifecycle

用于 SQLite schema、event store、cursor/replay/reset、restart、runtime manager、WebSocket、Relay connection、timeout 和 cleanup。此类测试可以慢，但必须使用最小 fixture；不能让每个普通行为测试重复执行 schema 初始化或启动外部进程。

### Manual acceptance

用于登录、聊天流、历史打开、审批/用户输入、断线恢复、设备 enrollment、设备撤销和浏览器布局。手工验收不能替代协议、安全、持久化和纯逻辑自动化测试。

## 新增测试准入

新增测试前必须能回答：

1. 它保护哪个当前行为、边界或不变量？
2. 失败时会阻止哪一种真实回归？
3. 该行为是否已经在更便宜或更合适的边界验证？
4. 它是否能用纯函数、合成 adapter 或轻量 fixture 验证？
5. 生产行为删除或重构时，谁负责删除或改写它？

禁止以下测试：

- 只为提高测试数量或覆盖率数字；
- 只断言源码文本、import 写法、私有变量名或内部调用顺序；
- 只测试简单 getter/setter、类型系统已经保证的分支或重复 fixture；
- 为页面、renderer、截图、React DOM 流程新增自动化测试，除非任务明确要求；
- 恢复已移除的 Guest、旧 `/api/*`、preview、匿名或历史兼容流程；
- 把真实凭据、真实 workspace 路径、原始 Codex capture 或敏感日志写进测试产物。

行为断言优先于实现断言。测试应通过公开模块接口和 UI-facing model 验证行为；不得为了测试而导出生产私有实现。

## Fixture 与速度

- Fast unit 和 contract 测试默认不访问网络、不启动进程、不执行 `drizzle-kit`。
- SQLite 测试复用轻量临时数据库 fixture；真实 schema 初始化只在专门的 database/startup 测试中验证。
- 进程、socket、timer、临时目录和数据库必须在测试结束时关闭或删除；失败也必须 cleanup。
- 需要异步等待时优先使用可控 promise/事件，不使用无上限轮询或不必要的真实 sleep。
- 大型测试文件按单一边界拆分；一个文件同时验证状态机、React 生命周期、transport wiring 和页面展示时，应先下沉纯逻辑，再保留少量生命周期测试。

## 运行命令

`pnpm test` 是全仓入口，覆盖 Server、Protocol、Relay、Conversation、Telemetry 和 App。

日常开发运行受影响包的测试，例如 `pnpm test:server`、`pnpm test:protocol` 或 `pnpm test:frontend`。`pnpm test:core` 是核心 Server/Protocol/Relay 快速入口，不代表全仓通过。

提交里程碑前运行：

```text
pnpm test
pnpm typecheck
pnpm exec oxfmt --check <touched-ts-files>
pnpm lint:staged
```

没有实际 `.integration.ts` 测试文件时，不得保留空的 integration 命令或把命令成功当作集成验证。

## 清理与复核

功能删除、协议切换、架构迁移和大规模重构必须同时审查相关测试。测试只能归入以下结果之一：

- 保留：仍保护当前行为或安全边界；
- 合并/改写：行为有价值，但重复、过重或锁定实现细节；
- 删除：行为已移除、没有当前输入来源，或由更合适的测试完全覆盖。

名称包含 `legacy`、`removed` 或 `compat` 不是删除依据。必须先确认它是否保护当前仍会遇到的旧数据库拒绝、用户数据迁移或协议反探测行为。

测试代码量、测试项数量和覆盖率都不是单独的成功标准。清理后的验收重点是：关键边界仍有测试、定向反馈更快、重复 fixture 减少、失败能指出真实行为回归。
