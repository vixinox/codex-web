# Task 03：App orchestration 收敛

## 状态与依赖

- 状态：**Audit complete; further extraction skipped**。
- 主规格：[Project Health](./README.md)。可与 Server 任务并行；范围限于 App。

## 目标与入口

审查发现目标选择、runtime controller、Composer queue transition 已有独立模块。剩余 hook 共同拥有 React 与连接资源 cleanup 次序，当前无更窄单一 owner seam，因此本阶段记录结论并跳过进一步提取。候选入口如下：

- `packages/app/src/lib/owner-ws/use-owner-runtime.ts`：连接 profile/目标选择、Owner runtime reuse、transport 生命周期和 React hook 生命周期。
- `packages/app/src/app/chat/session/controllers/use-composer-controller.ts`：Composer draft/selection、Turn submit、失败重试、Queue、Steer 的交互编排。

## 设计约束

- React hooks 只负责订阅、effect 生命周期和用户事件绑定；目标解析、transition、队列 claim/retry 等可独立定义的不含 React 状态逻辑可以下沉。
- 每份状态有唯一 owner；不让 hook state、外部 store 与 controller 同步保存相同生命周期真值。
- 连接转换保留 local/remote admission 区分、profile pinning、认证失效、明确 revoke 停止重连、普通断连恢复等现行行为。
- Composer 保留当前单线程 Queue、Steer 条件、停止/失败/不确定提交时不自动重试、切换线程不后台调度等合同。
- 只有能提供更清晰的行为 seam 才提取；大 hook 可以保留，若拆分只是搬代码就不执行。

## 验收与验证

- 用当前 transport/controller public boundary 验证生命周期；新增测试只保护当前状态转换，不新增 renderer/DOM/截图测试。
- 既有 profile 隔离、连接恢复/revoke、Composer/Queue/Steer 状态测试保持有效且无重复 fixture。
- 运行 `pnpm test:frontend`、`pnpm typecheck`、触及 TS/TSX 的 `oxfmt --check`；涉及 UI 展示或连接手工行为时执行对应浏览器回归。已有验收可由用户确认后记为已完成，不要求无故重跑。

## 非目标

不改 UX、Owner wire methods、IndexedDB 格式、设备信任协议或 Chat renderer。
