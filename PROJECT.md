# Codex Web

最后审阅：2026-09-07

本文档只记录稳定的架构基线、跨模块约束、安全边界、架构风险和难以逆转的决策。当前任务范围由 `AGENTS.md` 维护。

## 架构基线

- Codex Web 是本地单用户 Codex 浏览器客户端：React 只访问 Fastify bridge；Fastify 管理 Better Auth、Credential、受控 Project、Codex App Server 和 REST/SSE。Fastify 只绑定 loopback，不支持多副本或多租户部署。
- Codex runtime 由受管 manifest 和锁定的 `codex-cli 0.153.0` 管理。active runtime 完整时支持离线启动；没有可运行 runtime 时，Fastify 不监听端口并以脱敏错误退出。
- 浏览器不会接收 API key、宿主机路径、`CODEX_HOME`、rollout 路径、Git remote 或 App Server 进程信息。敏感数据不得进入日志、错误、SSE、前端缓存或测试产物。
- Project 是 bridge 层的逻辑分组。Project/Thread/文件访问和写操作必须执行当前用户及受控根目录归属校验。
- 用户级 `currentCredentialId` 是持久化的默认 Credential；runtime 的 `activeCredentialId` 只表示当前进程实际使用项。Credential 不绑定 Thread 或 Turn。
- Thread 详情读取 Codex 原生 `thread/read { includeTurns: true }`；服务端按锁定版本白名单投影后才返回浏览器。EventHub 发布和回放使用同一 SSE 投影。
- Thread model/reasoning effort 只通过固定产品白名单投影到浏览器；`thread/settings/updated` 不透传原始 settings、路径、sandbox 或 provider 字段，并作为可回放 Thread 事件保持 Composer 真值同步。
- 前端遵循“原生 DTO → native reducer → presentation model → renderer”的单向路径。页面和 renderer 只依赖 UI-facing model；原生 DTO 只存在于 transport、reducer 和 adapter。
- Owner 与 Guest 的 Thread/Turn 前端生命周期通过共享 Thread client interface 和独立 adapter 收敛；availability、snapshot/status 与事件同步语义位于共享 seam，Owner `/api/*` 与 Guest `/guest-api/*`、认证、runtime 和权限策略仍严格隔离。
- Guest accepted Turn ID 是 queue/job 取消句柄，不是 App Server native transcript Turn ID；共享 pending lifecycle 通过 adapter capability 区分两类 identity，避免 job ID 污染 transcript reconciliation。
- App Server 未物化到 Thread 快照的命令与用户问答由 EventHub 安全投影后持久化并通过 `historyEvents` 重放；问答答案使用 bridge 自有事件补足 `serverRequest/resolved`，由 native reducer 统一生成 transcript summary。
- 前端目录按 `app + lib` 组织：组合层位于 `src/app/composition`，Chat/Workspace/Settings 位于 `src/app`，跨运行时基础设施位于 `src/lib`，`src/components/ui` 保持 shadcn primitives。
- `/app/*` 是唯一真实应用入口；不提供旧 `/ui/*`、`/preview/*` 或离线工作台兼容路由。
- Owner 与 Guest 共用单一 Vite 入口：`/startup` 为静态启动页，`/` 和 `/login` 按 Better Auth session 分流到 `/app` 或 Guest profile 下的 `/admin`。Guest 使用 Better Auth anonymous user/session/cookie，并通过独立的 24 小时 lease 管理 workspace、quota、任务和 reset；lease 不是浏览器身份凭据。
- Guest runtime 在 Fastify 监听前自动启动、以独立环境变量 Credential 和 `CODEX_HOME` 运行；API-key 验证或 Windows sandbox readiness 不是 `ready` 时服务必须退出。Owner runtime 仍保持显式启动。
- 每个 Guest lease 分配一个从空目录创建的私有临时 workspace，不再内置示例文件。skills 镜像拒绝 symlink/reparse point、路径逃逸和非普通文件；Guest Thread 固定 `workspace-write`，Guest Turn 固定协议 `workspaceWrite` writable root 与 `networkAccess: false`，Guest 子进程不继承 Owner 进程环境。Guest runtime contract 额外公开经过正整数校验的 `modelContextWindow`（来自 `GUEST_MODEL_CONTEXT_WINDOW`，默认 256000），仅作为 Composer context window 的 Guest fallback，不与每日 quota 或 `maxTokensPerTurn` 混用。锁定的 App Server 0.153.0 schema 没有 `readOnlyAccess` 参数，因此 bridge 不发送未验证的 read-root 格式；Windows 仅在对应平台额外要求 `windowsSandbox/readiness=ready`，Linux 使用受管 runtime 自带的 `bwrap` sandbox，均以 fail-closed 方式启动。Reset/到期撤销 lease、停止任务、软删除记录并删除该临时 workspace。浏览器不接收 native Thread ID、Credential、宿主路径或通用命令/文件系统接口。
- Owner 与 Guest 使用固定独立进程入口 `pnpm server:owner` 和 `pnpm server:guest`，不设置运行模式变量，也不存在 combined server。Owner 只注册 Owner API/workspace/runtime；Guest 只注册 Guest API、Admin API、Guest workspace 和 Guest runtime，后端 profile 强制执行隔离。
- 前端只有一个 `index.html` 和一个构建产物。Guest 页面复用共享聊天、线程、侧边栏和设置组件，通过 capability/view-model 隐藏 Owner-only 操作；Guest workspace 使用 `/app` 路径，不再使用 `/guest`。

## 架构风险

- 超大 Thread 当前使用完整 `thread/read`；规模增长前需要评估分页或二次读取。
- App Server 持久 ThreadItems 对部分 agent interaction 有损；项目不解析内部 rollout JSONL，历史可展示范围以上游 materialize 的安全投影为限。

## 不可逆决策

- 锁定版本的 App Server schema 和原始资料位于 [`docs/vendor/`](docs/vendor/)。
