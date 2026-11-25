# Task 05：本地质量反馈与检查可靠性

## 状态与依赖

- 状态：**Complete**。
- 主规格：[Project Health](./README.md)。依赖 Task 00–03 已完成或已记录跳过的审查结论；完成后由 Task 04 记录全仓收尾。
- 实施基线为当前 workspace source；不根据 staged/unstaged diff 意图扩展任务。

## 目标

让单人本地 Agent 开发在短时间内获得可信质量反馈，减少全仓检查的不必要等待，同时收窄 Owner runtime 的调用接口。保持 Owner/Relay 协议、SQLite 持久化合同和 UI 行为不变。

## 当前观测

- 本机 `pnpm lint` 约 2 秒，报告 6 个 lint error：`rpc-message-summary.ts`、Telemetry `logger.ts`、`thread-session-store.ts` 两处、`thread-assets.tsx` 和 Owner `runtime.ts`。
- `pnpm lint:staged` 最初约 99 秒并退出成功。逐对象执行 `git cat-file -e` / `git show` 是主要开销；脚本仍复制完整 index/HEAD 快照并只 lint 暂存 TypeScript 文件，以保留精确类型上下文。
- 根 `pnpm test` 顺序执行六个 package。一次观测中 Server suite 约 13 秒，App suite 约 11 秒。Server event-store 测试的 fixture 多次调用 `prepareOwnerDatabase()`，触发 Drizzle Kit schema 初始化；App Vitest 48 个文件累计 jsdom 环境时间约 121 秒，该数值为累计 worker 时间。
- 仓库没有托管 CI workflow。本任务不新增 GitHub Actions；若后续维护模式变化，重新评估。

## 决策与不变量

- 修复当前六个 lint error，不通过清空既有 warning baseline 达成通过。`pnpm lint` 配置 `--max-warnings=10000`，使 `--quiet` 退出行为符合仅以 errors 阻断的项目约定；新增 warning 仍由 staged 门禁检查。
- `lint:staged` 继续拒绝错误和 HEAD 中不存在的新增 warning；批量读取完整 Git 对象，保留 index 与 HEAD 快照语义。若 staged 文件与工作区不同，输出明确说明检查的是 Git index snapshot。
- SQLite event-store 行为测试使用轻量 schema fixture；当前真实 Owner schema 初始化与 legacy rejection 仍由 `database.test.ts` 专门覆盖。不得删减持久化、重启、gap/replay 行为测试。
- App 测试采用保持隔离的 `vmThreads` pool。根全仓测试采用最大 3 个并行 package，避免无限并行造成 SQLite、Vitest 或进程 fixture 争用。
- Owner 授权检查只有一个共享 `requireOwner()` 实现。Owner runtime 只暴露 transport/IPC 所需能力；完整 `OwnerApplicationServices` 不再从 runtime 或 Fastify 实例泄露。WebSocket 使用注入的 runtime，不在 transport 注册器内部另行组合完整 application runtime。
- 不为提高测试数新增镜像实现测试；测试观察公开 module interface 或持久化/协议行为。

## 实施范围

1. 修复六个 lint error。控制字符替换是日志/诊断脱敏的有意行为，应采用仓库已有的局部 lint disable 注释并解释意图；Thread session external-store 回调保持稳定且正确绑定；未知错误值使用有界、明确的 scalar 格式化，不盲目调用对象默认字符串化；runtime 回调使用不依赖 `this` 的安全函数引用。
2. 重构 `scripts/lint-staged-warnings.mjs`，保留 staged-vs-HEAD 的新增 warning 比较和错误阻断语义；以 Git 批量对象读取取代逐文件子进程，并保留完整快照。增加脚本回归验证新增、删除、重命名、纯文档 staged 变化、既有 warning、新增 error/warning 及工作区与 index 内容不同时的版本提示。温缓存目标：当前工作站完整 lint:staged 在 20 秒内完成。
3. 给 `event-store.test.ts` 与 `conversation-delivery.test.ts` 建立共享轻量 SQLite fixture，只创建其实际需要的 owner/event 表和索引；保留数据库 reopen 和 event replay 断言。生产 `prepareOwnerDatabase()` 行为不变。
4. 在 App Vitest 配置采用隔离的 `vmThreads`，实测 frontend suite。根 `pnpm test` 和 `pnpm test:core` 使用 workspace 并行执行且最大并发为 3；包级命令保持可用。
5. 将 Owner context authorization guard 提取为共享小 module。缩窄 `OwnerApplicationRuntime`，删除未使用的 `ownerServices` Fastify 装饰属性，并要求 WebSocket 注册路径接收已组合 runtime；测试使用显式 runtime/fake，不在 transport module 内隐式构造整套 application services。

## 验收与验证

- `pnpm lint` 对当前 workspace 零 error；新增 lint 结果可由 `pnpm lint:staged` 可靠阻断。
- `pnpm lint:staged` 保持与 index 快照一致的诊断结果，不再复制整个 tracked repo；温缓存运行在当前工作站目标不超过 20 秒。
- Server event-store 与 conversation delivery 测试通过；普通 event 行为测试不再启动 Drizzle Kit，真实 schema 初始化仍由专门数据库测试验证。
- App frontend tests 在 `vmThreads` 下通过且保持文件隔离。
- 全仓测试串行基线与有界并行实现各测三次温缓存运行，中位墙钟时间至少改善 20%；若机器资源或文件间状态导致 flaky，则不接受该并行配置。
- 运行 `pnpm test:server`、`pnpm test:frontend`、`pnpm test`、`pnpm typecheck`、本任务触及 TS/TSX 的 `oxfmt --check`、`pnpm --filter @codex-web/app themes:check`、`pnpm --filter @codex-web/app build`。
- 核实本机/远程 WebSocket 仍用同一 registry，IPC 仍只拿 `localManagement`；Owner admission、设备授权、会话恢复和事件 resume 行为不变。
- 记录各 package 的生产/测试/fixture/脚本行数变化及真实耗时，交给 Task 04 汇总。

## 非目标

- 不新增 GitHub Actions、其他托管 CI、Git hooks、依赖或 coverage threshold。
- 不清空历史 lint warnings，不重写测试 runner，不改变 Codex RPC/Turn/Interaction、Owner/Relay 协议、数据库 schema 或用户数据。
- 不为缩短文件机械拆分 CodexManager process lifecycle 或 Interaction 状态；后续是否提取仍由 Task 02 审计依据决定。

## 完成后置事项

Task 05 验证通过后更新 [Task 04](./04-health-validation.md)，填写实际耗时、lint 状态、测试分类处置、行数变化和未执行的用户手工验收。复杂浏览器/Relay 验收按 `AGENTS.md` 标记为实现后人工验收，不将其伪报为本地自动验证。

## 实施结果

- `pnpm lint` 通过，当前 workspace 为 0 errors；既有 warning 仍保留。原 `--quiet` 在 `maxWarnings: 0` 下会因 warning baseline 非零而失败，根命令现显式允许 warning baseline，新增 warning 阻断由 `pnpm lint:staged` 承担。
- `lint:staged` 保留完整 index/HEAD 快照及 warning 多重集差异算法，Git blob 从逐文件子进程改为批量读取。当前工作站温缓存实测 2.83 秒，复测约 6.4 秒，均低于 20 秒；三项临时 Git 仓库回归测试通过。
- Server suite 163 项通过。共享轻量 SQLite fixture 移除 event-store 与 conversation-delivery 普通行为测试中的 Drizzle Kit 初始化；真实 schema 创建与 legacy rejection 仍由 `database.test.ts` 覆盖。
- App suite 272 项通过；`vmThreads` 从约 11 秒降至约 4.1 秒，并在 setup 中显式提供 Node Web Crypto。
- 原串行全仓命令三次温缓存：20.57 / 20.07 / 19.92 秒，中位数 20.07 秒。最终最大三并发根命令（含三项 lint 工具回归）三次：16.96 / 15.55 / 15.28 秒，中位数 15.55 秒，改善 22.5%；每次 241 个 Node 测试与 272 个 App 测试通过。
- `pnpm typecheck`、`pnpm --filter @codex-web/app themes:check`（42 themes）、App build、`pnpm lint`、`pnpm lint:staged` 与触及文件 `oxfmt --check` 通过。一次与 lint/typecheck 同时执行的 Server suite 遇到 Windows 临时目录 `EBUSY`；空载复跑通过，三次全仓回归均通过，未观察到可复现的并行争用。
- 未新增 CI、Git hooks、依赖或生成资产。没有执行需要启动用户服务的浏览器/Relay 手工验收；本任务改动不改变协议或用户流程。
