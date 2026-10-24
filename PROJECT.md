# Codex Web

最后审阅：2026-10-22

本文档只记录稳定的架构基线、跨模块约束、安全边界、架构风险和难以逆转的决策。当前任务范围由 `AGENTS.md` 维护。

## 架构基线

- Codex Web 是本地单用户 Codex 客户端：App 通过 Owner WebSocket 访问 Gateway；Gateway 管理 Better Auth、Credential、受控 Project、Codex App Server 和安全事件。HTTP 只承担 health、metadata、bootstrap、配对发现和明确的外围能力。Owner 只绑定 loopback，不支持多副本或多租户部署。
- Codex runtime 由受管 manifest 管理，默认获取最新 stable release。active runtime 完整时支持离线启动；新 runtime 必须通过完整性和 JSON-RPC smoke test；没有可运行 runtime 时，Fastify 不监听端口并以脱敏错误退出。
- 浏览器不会接收 API key、宿主机路径、`CODEX_HOME`、rollout 路径、Git remote 或 App Server 进程信息。敏感数据不得进入日志、错误、Owner WS、前端缓存或测试产物。
- Project 是 Owner application 层的逻辑分组。Project/Thread/文件访问和写操作必须执行当前用户及受控根目录归属校验。
- 用户级 `currentCredentialId` 是持久化的默认 Credential；runtime 的 `activeCredentialId` 只表示当前进程实际使用项。Credential 不绑定 Thread 或 Turn。
- Thread 详情读取 Codex 原生 `thread/read { includeTurns: true }`；服务端按锁定版本白名单投影后才返回浏览器。EventHub 发布和回放使用同一 Owner WS stream 投影。
- Thread model/reasoning effort 仅在满足安全标识符格式时投影到浏览器；创建 Thread 或 Turn 时按当前 App Server 模型目录校验支持的组合。`thread/settings/updated` 不透传原始 settings、路径、sandbox 或 provider 字段，并作为可回放 Thread 事件保持 Composer 真值同步。
- 前端遵循“原生 DTO → native reducer → presentation model → renderer”的单向路径。页面和 renderer 只依赖 UI-facing model；原生 DTO 只存在于 transport、reducer 和 adapter。
- App Server 未物化到 Thread 快照的命令与用户问答由 EventHub 安全投影后持久化并通过 `historyEvents` 重放；问答答案使用 bridge 自有事件补足 `serverRequest/resolved`，由 native reducer 统一生成 transcript summary。
- 前端目录按 `app + lib` 组织：启动与路由位于 `packages/app/src/app/entry`，组合层位于 `packages/app/src/app/composition`，Chat/Workspace/Settings 按领域分别维护 application、domain 与 UI modules，跨运行时基础设施位于 `packages/app/src/lib`，`packages/app/src/components/ui` 保持 shadcn primitives。
- `/app/*` 是唯一真实应用入口；不提供旧 `/ui/*`、`/preview/*` 或离线工作台兼容路由。
- Owner 是唯一执行环境和用户工作区；浏览器通过 loopback Fastify Owner WebSocket 访问本地 Gateway。Guest 匿名执行、lease、quota 和管理工作流已完全移除，不作为兼容模式。
- 远程能力采用 Paseo 基准的 pnpm monorepo：`packages/app`、`packages/server`、`packages/relay` 和 `packages/protocol`。Owner Gateway 是身份、业务、Agent、Thread、事件和历史的唯一边界；远程端通过 Relay 的 E2EE transport 接入同一个 Owner session runtime。`@codex-web/protocol/owner` 与 `@codex-web/protocol/relay` 在同一 package 内保持显式职责隔离。Relay 只维护内存连接路由、协议版本和连接生命周期，不保存账户、设备、事件或业务正文。产品限定为单个 Owner 节点及其远程控制端，不建立 Relay 账户体系或多节点管理体系。

## 架构风险

- 超大 Thread 当前使用完整 `thread/read`；规模增长前需要评估分页或二次读取。
- App Server 持久 ThreadItems 对部分 agent interaction 有损；项目不解析内部 rollout JSONL，历史可展示范围以上游 materialize 的安全投影为限。

## 不可逆决策

- 产品前期只维护一个认证 Owner 用户模型；Guest 匿名工作区及其限时试用能力已干净删除，不保留双运行时、双 API、lease/quota 或兼容入口。公开展示和试用方式待产品稳定后另行决定。
- 锁定版本的 App Server schema 和原始资料位于 [`docs/vendor/`](docs/vendor/)。
- 当前 bridge 不发送未验证的 `readOnlyAccess` 或 read-root 格式；runtime 协议能力以下载后的 JSON-RPC smoke test 为准。
