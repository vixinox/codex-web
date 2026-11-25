# Task 04：健康验收与维护基线

## 状态与依赖

- 状态：**Complete**。
- 主规格：[Project Health](./README.md)。在 Task 00–03 已完成或决定不做、Task 05 验证结束后复核。

## 目标

让维护者能分辨生产逻辑、测试、生成资产、开发工具的变化，并在大规模整理后知道哪些现行行为仍受保护。此任务整理现有机制，不新建泛化质量平台。

## 范围

- 核实根命令 `pnpm test`、recursive typecheck、App build、`lint` 与 `lint:staged` 的实际职责；Task 05 修复并验证当前 lint 诊断差异。
- 遵守 `docs/testing.md` 的测试分层与准入规则，盘点本工作包触及的测试为保留/合并改写/删除，不追求覆盖率阈值。
- 主题资产继续由 `themes:generate` 维护，以 `themes:check` 验证确定性；统计时独立于业务源码。
- 每个代码任务补一段结果记录：完成的边界变化、移除的旧路径、生产/测试/生成/开发文件行数变化、实际运行的开发检查；耗时用同一工作站温缓存三次中位数，避免把单次结果泛化成跨机器承诺。
- 用户确认曾完成但未记录的浏览器/Relay验收时，记录确认范围和日期；不把缺失旧记录转为必须重跑的工作。
- 记录当前 lint warning baseline 处理方式；不把本工作包扩展为全仓 warning 清零、CI 平台迁移或普遍覆盖率项目。

## 完成条件

- 维护者能运行并理解既有验证入口；无空的集成命令或误导性通过信号。
- 清理后的测试没有保护已删除行为，也没有为抽取函数重复写实现细节测试。
- 生成主题资产通过 check，统计报告区分生成物和生产逻辑。
- 文档陈述与用户确认/开发命令结果匹配；未执行项标为未执行，不从缺文档推断失败。

## 验证

- `pnpm test`
- `pnpm typecheck`
- `pnpm --filter @codex-web/app themes:check`
- `pnpm lint:staged`（仅当 intended 文件 staged，依仓库提交规则）
- 检查 `docs/testing.md` 与包脚本实际一致；若代码/脚本未改，优先只更新本工作包结果记录，不扩写 PROJECT.md。

## 实施结果

- 根 `pnpm test` 以最大 3 个 workspace package 并行执行，随后运行三项 `scripts/lint-staged-warnings.test.mjs` 回归测试；包级命令保持独立可用。`test:core` 同样限制为 3 个 package 并行。
- 串行参考顺序 `server → protocol → relay → conversation → telemetry → frontend → tools` 三次温缓存中位数为 20.07 秒；最终 `pnpm test` 三次中位数为 15.55 秒，改善 22.5%。每次最终运行均有 241 个 Node 测试与 272 个 App 测试通过。
- Task 05 行数分类（相对任务开始时已有 index；只计本轮工作区增量）：生产 TS tracked 文件新增 28 行、删除 38 行，另新增 7 行 Owner guard；测试 tracked 文件新增 35 行、删除 29 行，新增 26 行 SQLite fixture 和 127 行 lint 脚本回归测试；工具脚本新增 80 行、删除 37 行，根 package scripts 新增 4 行、删除 3 行。主题生成资产未改。Task 00–03 的边界变化分别记录在对应任务包；行数用于解释改动类别，不以净删行数作为验收标准。
- 全仓 typecheck、lint、staged lint、触及 TS/TSX `oxfmt --check`、42 个主题检查、App production build 均通过。Build 保留现有大 chunk 提示（约 1.6 MB minified），不属于本任务范围。
- 未新增 GitHub Actions。项目由用户单人维护且几乎不使用 PR，本轮把投入放在更快的本地反馈；若出现协作者、PR/release 门槛或跨操作系统要求，再单独评估托管 CI。
- 未执行服务启动后的浏览器/Relay手工回归；本次工作改变检查工具、测试 fixture 与既有函数接口的静态类型，不报告未执行的人工验收为已完成。
