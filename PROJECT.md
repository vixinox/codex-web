# Codex Web

远程 Owner、Relay、认证和设备信任的统一架构入口见 [`docs/owner-remote-architecture.md`](docs/owner-remote-architecture.md)。

最后审阅：2026-10-22

本文档只记录稳定的架构基线、跨模块约束、安全边界、架构风险和难以逆转的决策。当前任务范围由 `AGENTS.md` 维护。

## 架构基线

- Codex Web 是本地单 Owner Codex 客户端：App 通过 Owner WebSocket 访问 Gateway；Gateway 管理 Passkey/session、Credential、受控 Project、Codex App Server 和安全事件。Owner 无凭据即可启动，远程首次接入使用短时、单次的设备 enrollment invitation；远程与 localhost Passkey 使用隔离的 WebAuthn origins/RP IDs。Owner 只绑定 loopback，不支持多副本或多租户部署。
- Codex runtime 由受管 manifest 管理，默认获取最新 stable release。active runtime 完整时支持离线启动；新 runtime 必须通过完整性和 JSON-RPC smoke test；没有可运行 runtime 时，Fastify 不监听端口并以脱敏错误退出。
- 已认证 Owner 可接收完整业务内容与路径，不经过内容安全投影。凭据库、服务端密钥及认证内部对象不新增读取入口；日志继续遵守现有策略。Owner 详细错误不携带 stack 或任意内部对象。
- Project 是 Owner application 层的逻辑分组。Project/Thread/文件访问和写操作必须执行当前用户及受控根目录归属校验。
- 用户级 `currentCredentialId` 是持久化的默认 Credential；runtime 的 `activeCredentialId` 只表示当前进程实际使用项。Credential 不绑定 Thread 或 Turn。
- Thread 详情由 Owner 读取 Codex `thread/read { includeTurns: true }` 并投影为 Conversation snapshot。Owner 返回快照及对应游标；后续 `conversation.change` 通过 Owner WS 交付。SQLite `conversation_events` 保存类型化 change，而非原始 RPC 或 Owner envelope。Owner 应用协议和事件不维护版本号；共享 parser 校验结构与 cursor，Relay 等基础设施契约保持独立。
- Thread model/reasoning effort 仅在满足安全标识符格式时投影到浏览器；创建 Thread 或 Turn 时按当前 App Server 模型目录校验支持的组合。`thread/settings/updated` 不透传原始 settings、路径、sandbox 或 provider 字段，并作为可回放 Thread 事件保持 Composer 真值同步。
- 前端线程详情遵循“Conversation snapshot/change → 共享 reducer → presentation model → renderer”的单向路径。页面和 renderer 只依赖 UI-facing model；原生 Codex DTO 保留在 Owner runtime adapter 边界。
- Owner 用游标前的已存储 Interaction change 补充原生快照。请求关联绑定线程和运行时实例；回复结果作为类型化 Interaction outcome 保存，不清空答案正文。
- 前端目录按 `app + lib` 组织：启动与路由位于 `packages/app/src/app/entry`，组合层位于 `packages/app/src/app/composition`，Chat/Workspace/Settings 按领域分别维护 application、domain 与 UI modules，跨运行时基础设施位于 `packages/app/src/lib`，`packages/app/src/components/ui` 保持 shadcn primitives。
- 开发场景工具通过独立 Vite dev bootstrap `/__dev/ui` 提供，仅使用合成 Conversation 与本地内存操作；复用主题、无业务依赖的 WorkspaceLayout、Sidebar 和聊天展示链路，不初始化认证或 Owner runtime，生产构建排除该入口。
- `/app/*` 是唯一真实应用入口；不提供旧 `/ui/*`、`/preview/*` 或离线工作台兼容路由。
- Owner 是唯一执行环境和用户工作区；浏览器通过 loopback Fastify Owner WebSocket 访问本地 Gateway。Guest 匿名执行、lease、quota 和管理工作流已完全移除，不作为兼容模式。
- Owner 控制面使用 `CODEX_DATA_ROOT/owner.sqlite` 持久化 Owner、Passkey 公钥凭据、设备/session、Project、Credential 和安全事件；Thread transcript 由 Codex App Server/Codex Home 管理，remote trust 与加密密钥保持独立本地 secret 边界。CLI 管理仅通过本机 IPC 连接运行中的 Owner，不启动临时 runtime。设备管理模块统一编排邀请、登记、撤销和连接清理；移除所有远程设备保留 Owner 身份与本机认证入口。
- 远程能力采用 Paseo 基准的 pnpm monorepo：`packages/app`、`packages/server`、`packages/relay` 和 `packages/protocol`。Owner Gateway 是身份、业务、Agent、Thread、事件和历史的唯一边界；远程端通过 Relay 的 E2EE transport 接入同一个 Owner session runtime。`@codex-web/protocol/owner` 与 `@codex-web/protocol/relay` 在同一 package 内保持显式职责隔离。Relay 只维护内存连接路由、协议版本和连接生命周期，不保存账户、设备、事件或业务正文；设备 enrollment invitation 负责远程浏览器的路由和登录；首次使用登记设备，已登记设备复用身份，Owner attach 使用 Owner 与 Relay 共享的部署 admission secret，设备身份仍由 Owner trust store 和 E2EE 握手验证。产品限定为单个 Owner 节点及其远程控制端，不建立 Relay 账户体系或多节点管理体系。
- `@codex-web/telemetry` 提供跨运行时日志接口和错误模型；浏览器仅依赖显式 browser-safe error export，Node/Bun logger adapters 与内部诊断错误不属于 Owner/Relay wire protocol。各 transport 边界负责将内部错误显式映射为公开错误 DTO。

## 不可逆决策

- App Server schema 和原始资料位于 [`docs/vendor/`](docs/vendor/)；当前仓库审阅快照为 `0.167.0`（`rust-v0.167.0`），旧快照保留用于对照，运行时仍按受管 manifest 获取最新 stable release。