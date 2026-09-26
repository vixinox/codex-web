# Plan mode UI/UX TODO

## 目标

补齐 Codex Web 的 Plan mode 用户体验，使用户能够清楚地区分规划、提问、计划审阅和执行阶段，并在刷新、历史重放、失败或中断后保持一致的状态表达。

本 TODO 针对产品内的结构化 plan 数据流。`<proposed_plan>...</proposed_plan>` 是 Codex 对话层用于标识正式计划的外层标记，不是 App Server 的稳定 XML 协议；前端不得依赖 XML 正则解析作为主要数据源。

## 当前已有能力

- Composer 已支持 `default` / `plan` 模式切换。
- 命令面板已有 `Plan mode` 入口。
- questionnaire 已支持 Codex 按需提问、逐题填写、提交和关闭。
- bridge/client 已接收 `turn/plan/updated` 与 `item/plan/delta`。
- native reducer 和 presentation adapter 已生成 `ChatPlanPresentation`。
- 活动计划已有 `PlanPanel`，能够展示步骤进度和 diff 统计。
- final plan 已能展示 explanation、markdown text 或结构化 steps。
- 计划状态已有完成、失败和中断的基础投影及测试覆盖。

## 待完成事项

### 1. 最终计划卡片

- 将 transcript 中 final plan 的普通内容渲染替换为明确的计划卡片。
- 卡片至少包含标题/状态、说明文本、步骤列表和可选 diff 统计。
- 统一 `explanation`、`text`、结构化 `steps` 的展示优先级和空值降级行为。
- 长计划支持折叠/展开；移动端不能溢出或遮挡 composer。
- 历史重放和实时生成使用同一套 presentation model 与 renderer。

### 2. 计划生命周期状态

统一表达以下阶段：

```text
default
  -> planning
  -> questionnaire
  -> plan-ready
  -> executing
  -> completed / failed / interrupted
```

- `planning`：显示正在分析或生成计划的状态。
- `questionnaire`：显示现有 questionnaire，不能被普通计划内容覆盖。
- `plan-ready`：显示最终计划审阅卡片，明确等待用户决定。
- `executing`：显示现有活动计划步骤进度。
- `completed`：保留最终计划和执行结果。
- `failed` / `interrupted`：显示原因，不提供不安全或无效的继续执行入口。

### 3. 计划操作

根据当前 bridge/controller 能力实现并验证：

- 继续执行计划。
- 重新规划或修改计划。
- 取消/关闭计划。
- 计划执行期间禁用冲突操作。
- 从 Plan mode 切回 Default mode 时保留已生成计划和当前 draft。

操作必须复用现有 submit/controller/adapter 路径，不能在 UI 层猜测新的 App Server 方法或 XML wire format。

### 4. Composer 和快捷入口

- 确认 `/plan` 命令和 `Shift + Tab` 是否都已实现并行为一致。
- Plan 按钮提供 `aria-pressed`、明确 label 和切换后的状态反馈。
- 发送中、等待问题回答、计划待审阅时，明确按钮 disabled/可用规则。
- 移动端提供与桌面端等价的 Plan mode 入口。

### 5. 错误、恢复和安全边界

- questionnaire pending、final plan 和 active plan 的优先级保持稳定。
- Turn 刷新、SSE 重放、恢复历史时不能重复渲染计划或问答。
- Guest 仍固定在自己的 workspace、`workspaceWrite` 和无通用网络访问约束内。
- Plan mode 不得暴露 native Thread ID、宿主路径、Credential 或未投影的 runtime 字段。
- Owner 与 Guest 复用共享 presentation/renderer，但继续使用各自 adapter 和 bridge endpoint。

## 建议涉及的代码区域

- `src/app/chat/composer/ui/plan-panel.tsx`
- `src/app/chat/transcript/thread-assets.tsx`
- `src/app/chat/model/types.ts`
- `src/app/chat/session/presentation/thread-composer-slot.ts`
- `src/app/chat/session/controllers/use-composer-controller.ts`
- `src/app/chat/projection/thread-presentation.ts`
- 现有 plan、questionnaire、composer controller 测试

## 验收标准

- 用户可以从 default 进入 Plan mode，并在 UI 中持续看到当前模式。
- Codex 提问时只显示 questionnaire；回答完成后能够继续进入计划阶段。
- 结构化 final plan 显示为特殊计划卡片，而不是未区分的普通文本块。
- 活动计划和最终计划的状态、步骤、错误和中断状态可区分。
- 页面刷新、历史重放和 SSE 事件回放不会重复或丢失计划内容。
- 计划卡片在桌面和移动宽度下不产生溢出、重排抖动或内容遮挡。
- 计划操作经过 controller/adapter，并保持 Owner/Guest 安全边界。
- 相关纯逻辑测试覆盖状态优先级、计划终态、操作可用性和重放；完成后运行 `pnpm typecheck` 与 touched-file `oxfmt --check`，UI 变化再进行手动浏览器回归。

## 非目标

- 不把 `<proposed_plan>` 实现为应用内部 XML 协议。
- 不解析 rollout JSONL 或未验证的内部计划格式。
- 不修改 Owner/Guest 的运行时隔离、权限模型或 App Server 协议，除非后续任务明确要求且有官方/仓库协议依据。

