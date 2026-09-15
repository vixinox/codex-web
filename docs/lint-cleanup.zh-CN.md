# oxlint 全量告警清偿计划

最后审阅：2026-09-14

本文档汇总当前仓库 `oxlint` 的**全量**诊断（不使用 `--quiet`），按规则分类，并给出分阶段清偿计划与验收标准。目标：`pnpm exec oxlint .` 退出码为 0，即告警清零。

当前任务范围见 [`../AGENTS.md`](../AGENTS.md)。

## 1. 现状

采集命令：

```text
pnpm exec oxlint .                      # 人类可读
pnpm exec oxlint . --format=json        # 机器可读，用于生成附录 A
```

原始基线结果：**366 warning + 1 error = 367 条，命中 56 个文件**（`server/` 279 条、`src/` 87 条、`scripts/` 1 条），只涉及 145 条生效规则中的 5 条。

| 规则                                        | 级别      | 条数 | 文件数 |
| ------------------------------------------- | --------- | ---- | ------ |
| `typescript(no-unsafe-type-assertion)`      | warning   | 177  | 48     |
| `typescript(consistent-return)`             | warning   | 136  | 22     |
| `eslint(no-await-in-loop)`                  | warning   | 39   | 8      |
| `eslint(no-shadow)`                         | warning   | 14   | 2      |
| `typescript(restrict-template-expressions)` | **error** | 1    | 1      |

### 1.1 门禁真相（决定验收口径）

`.oxlintrc.json` 设置 `options.maxWarnings: 0`，`options.typeAware: true`。实测退出码：

| 命令（对只含 1 条 warning 的文件） | 退出码                      |
| ---------------------------------- | --------------------------- |
| `oxlint <file>`                    | 1                           |
| `oxlint <file> --quiet`            | 1（仅隐藏输出，不改退出码） |
| `oxlint <file> --max-warnings=5`   | 0                           |
| `oxlint .`（本仓库现状）           | 1                           |

结论：

- `pnpm lint`（`oxlint . --quiet`）**今天已经是红灯**：`--quiet` 只隐藏 warning 文本，不豁免其退出码；仓库里那 1 条 error 也必然致命。
- 因此「全部清除」与「`pnpm lint` 变绿」是同一件事，**不需要放宽 `maxWarnings`**，也不是把基线上调。
- `pnpm lint:staged` 以 `HEAD` 为基线只报新增项（`scripts/lint-staged-warnings.mjs`），与本次清偿正交；清零后仍可继续使用，但需要它为**唯一 error**（`restrict-template-expressions`）放行时不必改脚本 —— 清掉即可。

## 2. 分类总览

| 规则                            | 子类                                                                                      | 条数 | 文件数 |
| ------------------------------- | ----------------------------------------------------------------------------------------- | ---- | ------ |
| `no-unsafe-type-assertion`      | A 双跳 `as unknown as X`                                                                  | 4    | 3      |
|                                 | B1 请求部件 `request.query/params/body`                                                   | 37   | 8      |
|                                 | B2 内层消息 `params as Record<string, unknown>`                                           | 5    | 3      |
|                                 | C `JSON.parse` / `response.json()`                                                        | 23   | 11     |
|                                 | D DOM 事件适配                                                                            | 2    | 2      |
|                                 | E `as Record<string, unknown>`                                                            | 32   | 11     |
|                                 | F `as { 字段?: unknown }`                                                                 | 37   | 18     |
|                                 | G 泛型辅助函数 `as T`                                                                     | 1    | 1      |
|                                 | H 领域模型 / 原始类型                                                                     | 36   | 23     |
| `consistent-return`             | 1 `return reply`（send 后返回 reply 对象）                                                | 20   | 6      |
|                                 | 2 `return reply.send/status(...)`                                                         | 46   | 8      |
|                                 | 3 `return XFailure(reply, ...)`                                                           | 31   | 6      |
|                                 | 4 `return { ... }`                                                                        | 16   | 6      |
|                                 | 5 useEffect 清理函数 `return () => {...}`                                                 | 13   | 12     |
|                                 | 6 其他表达式（`return session` / `result` / `reduce(...)` / `subscribeToEvents(...)` 等） | 10   | 7      |
| `no-await-in-loop`              | 见 3.3，按文件给出逐点处置                                                                | 39   | 8      |
| `no-shadow`                     | 外层 `record` 被同名局部变量遮蔽                                                          | 14   | 2      |
| `restrict-template-expressions` | `Buffer` 进入模板字面量                                                                   | 1    | 1      |

`consistent-return` 的消息分布（同一规则，两种方向）：`Async function expected no return value.` 112、`Function expected no return value.` 15、`Async function 'lifecycle' expected no return value.` 7、`Function expected a return value.` 1、`Async function 'before' expected a return value.` 1。

## 3. 逐规则修复配方（均已探针验证）

以下口径来自对 oxlint 1.82.0 的最小复现文件实测，不是推断。

### 3.1 `typescript(consistent-return)` — 136 条

**触发条件**：同一函数同时存在「带值 `return`」与「不带值 `return`（裸 `return` 或结尾隐式返回 `undefined`）」。报错方向由**先出现**的分支决定：先带值则报 `expected no return value`，先裸返回则报 `expected a return value`。

实测判定表：

| 函数形状                                   | 结果 |
| ------------------------------------------ | ---- |
| 裸 `return` 提前退出 + 语句体 + 结尾不返回 | 干净 |
| 带值 `return` + 裸 `return`                | 触发 |
| 带值 `return` + `return undefined`         | 干净 |
| `return undefined` + `return () => {}`     | 干净 |
| 裸 `return` + `return () => {}`            | 触发 |

**配方 1 · Fastify 路由**（`server/http/*`，119 条）：保持 `reply.send(...)` 语义不变，把「带值 return」改成语句，所有出口统一为 `return undefined`。

```ts
// 改写前
if (!value) return reply.status(400).send(apiError('INVALID_X', 'x'))
return { value }
// 改写后
if (!value) {
  reply.status(400).send(apiError('INVALID_X', 'x'))
  return undefined
}
return { value }
```

安全性已实测（Fastify 5.12.4）：`reply.status(204).send(); return reply`、`...; return undefined`、`...`（不返回）三种写法响应均为 204，且无 `FST_ERR_REP_ALREADY_SENT`；只有显式二次 `reply.send()` 才会产生该错误日志（`lib/reply.js:162`）。Fastify 的 `wrap-thenable` 对 `payload === undefined` 且 `reply.sent === true` 的情况不重复发送，改写方向不会引入二次发送。

**配方 2 · React effect**（`src/app/**`，12 个文件 13 条）：保留清理函数返回值，把前置空 `return` 改为 `return undefined`。

```ts
if (!ready) return undefined
return () => {
  disposed = true
}
```

**特例 2 条**（`expected a return value`）：`src/app/workspace/sidebar/use-workspace-sidebar-controller.ts:426` 的 `operations.reduce` 回调与 `server/auth.ts:35` 的 better-auth `before` hook，需要按实际分支补齐或删除某条 `return`，不能套用上述机械配方。

### 3.2 `typescript(no-unsafe-type-assertion)` — 177 条

断言方向是「目标类型比源类型更窄」或「从 `any` 断言」。可复用的现成守卫共 6 处（同一形状重复定义）：`server/codex/native-protocol.ts:472` 的 `record()`（唯一导出版本）、`server/skills.ts:136`、`server/http/thread-routes.ts:12`、`src/app/chat/session/use-thread-detail-controller.ts:240`、`src/lib/theme/theme.ts:127`、`src/app/chat/native/codex-thread.ts:584`（返回 `CodexRecord`）。是否抽公共模块在阶段 3 开工时一并决定，本计划不预设。

| 子类                                 | 修复手法                                                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| A 双跳 `as unknown as X`（4）        | 两侧类型本就对不上（presentation 与 native model 的差异）。必须对齐类型定义，**不能**用守卫掩盖                                   |
| B1 请求部件（37）                    | 服务端改用 Fastify 路由泛型（`app.post<{ Body: ... }>`）或先落到 `unknown` 再守卫；客户端 `requestJson` 调用方传校验函数          |
| B2 内层消息（5）                     | 收到 `NativeCodexMessage` 后 `record(params)` 守卫，替代 `params as Record<string, unknown>`                                      |
| C 解析型（23）                       | `JSON.parse` / `response.json()` 结果落到 `unknown`，交给已有校验函数（如 `isCredentialSummary`、`isAvailableSkill`、`isRecord`） |
| D DOM 事件（2）                      | 回调签名与 `EventListener` 对齐，或 `instanceof MessageEvent` 判定后再取 `lastEventId`                                            |
| E `as Record<string, unknown>`（32） | 换成 `isRecord(value)` 守卫后再取字段（探针已验证守卫路径干净）                                                                   |
| F `as { 字段?: unknown }`（37）      | 守卫 + `typeof` / `Number.isSafeInteger` 判定后取值                                                                               |
| G 泛型 `as T`（1）                   | `src/lib/bridge/http/configuration.ts:62`：让 `requestJson<T>` 接收 `parse: (value: unknown) => T`，或在调用点校验                |
| H 领域模型 / 原始类型（36）          | 为枚举、模型、错误对象写类型谓词（`Set` + 谓词函数），替换 `as ChatModel`、`as NativeCodexMessage`、`as JsonRpcMessage` 等        |

注意：`options.typeAware: true` 下这些规则依赖类型信息，每批改完必须跑 `pnpm typecheck` —— 守卫化会让类型更严，可能出现「oxlint 干净但 `tsc` 报错」或反之。

### 3.3 `eslint(no-await-in-loop)` — 39 条

规则本身是性能建议，不是正确性要求。处置分两类：**可并行化**（迭代相互独立）与**必须串行**（游标、重试、槽位、顺序发布）。串行点按仓库既有先例加带理由的禁用注释，先例见 `src/lib/bridge/http/threads.ts:285`、`src/lib/bridge/thread-client.ts:124`、`:134`：

```ts
// oxlint-disable-next-line no-await-in-loop -- pagination cursors are inherently sequential
```

| 文件                                                        | 条数 | 拟定处置                                                                                                                                                               |
| ----------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/guest-service.ts`                                   | 13   | 682–716 为队列槽位准入调度（`dispatchNext`），**必须串行**；64 / 139 / 155 的 settle、interrupt 循环逐条独立，**可 `Promise.all`**；733 事件按 id 顺序发布，需保持顺序 |
| `server/codex/runtime-manager.ts`                           | 11   | 140–153 安装重试**必须串行**；522 / 528 流式读取**必须串行**；398–407 tar 条目解包**必须串行**；592 必需文件探测**可并行化**                                           |
| `server/guest-manager.ts`                                   | 5    | 402 skills 镜像复制**可并行化**；473–486 递归遍历需保留递归结构，按目录层级 `Promise.all` 或保留串行                                                                   |
| `server/http/thread-routes.ts`                              | 3    | 281 项目扫描可短路 / 并行；387 / 398 分页 + 删除游标**必须串行**                                                                                                       |
| `server/thread-ownership.ts`                                | 1    | 29 分页游标**必须串行**                                                                                                                                                |
| `server/codex/manager.ts`                                   | 1    | 313 停止全部实例**可并行化**                                                                                                                                           |
| `src/app/chat/session/use-composer-controller.ts`           | 3    | 313 / 324 / 330 重试退避循环**必须串行**                                                                                                                               |
| `src/app/workspace/runtime/use-codex-runtime-controller.ts` | 2    | 60 / 61 轮询循环**必须串行**                                                                                                                                           |

每点在动手时以当前代码为准复核：并行的前提是迭代之间无共享状态、无顺序依赖、无单写者约束（DB 事务、事件顺序、队列槽位）。

### 3.4 `eslint(no-shadow)` — 14 条（✅ 本次已完成）

全部是 `record` 被同名局部变量遮蔽：`server/codex/event-hub.ts` 从 `./native-protocol.js` 导入了守卫函数 `record`；`server/guest-service.ts` 多处存在外层 `record`（局部常量、解构、方法签名参数 `record: GuestThreadRecord`）。

修复已完成：将两个文件中的守卫导入统一改为别名（`record as isRecord`），保留业务局部变量命名不变。零语义风险。

### 3.5 `typescript(restrict-template-expressions)` — 1 条（唯一 error，✅ 本次已完成）

`scripts/lint-staged-warnings.mjs:147`：

```js
throw new Error(`Unable to read staged file ${revision}: ${String(result.stderr)}`)
```

`spawnSync(..., { encoding: null })` 使 `stderr` 为 `NonSharedBuffer`。修复已完成：改为 `${String(result.stderr)}`。同一文件 `readGitBlob` 是唯一使用 `encoding: null` 的位置，改动不会外溢。

## 4. 热点文件

| 文件                                              | 合计 | 断言 | 返回 | 循环 | 遮蔽 | 模板 |
| ------------------------------------------------- | ---- | ---- | ---- | ---- | ---- | ---- |
| `server/http/thread-routes.ts`                    | 83   | 25   | 55   | 3    |      |      |
| `server/guest-service.ts`                         | 39   | 13   |      | 13   | 13   |      |
| `server/http/guest-routes.ts`                     | 29   | 12   | 17   |      |      |      |
| `server/guest-manager.ts`                         | 20   | 15   |      | 5    |      |      |
| `server/codex/runtime-manager.ts`                 | 19   | 8    |      | 11   |      |      |
| `server/http/configuration-routes.ts`             | 15   | 2    | 13   |      |      |      |
| `server/http/credentials-routes.ts`               | 15   | 4    | 11   |      |      |      |
| `server/http/projects-routes.ts`                  | 14   | 4    | 10   |      |      |      |
| `src/app/chat/session/use-composer-controller.ts` | 7    | 2    | 2    | 3    |      |      |
| `server/http/event-routes.ts`                     | 6    | 2    | 4    |      |      |      |
| 其余 46 个文件                                    | 120  |      |      |      |      |      |

前 8 个文件占 254 / 367 条（69%），且几乎全部落在 `server/http` 与 `server/guest-*`。清偿顺序按文件推进比按规则推进更省上下文。

## 5. 阶段与验收

| 阶段 | 内容                                                                                  | 条数 | 验收                                                                                                  |
| ---- | ------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------- |
| 1    | ✅ 已完成：遮蔽 14 条 + 唯一 error 1 条                                               | 15   | `pnpm typecheck`；`pnpm exec oxlint scripts server/codex/event-hub.ts server/guest-service.ts`        |
| 2    | `consistent-return`：先生成 server/http 路由（119 条），再前端 effect 与特例（17 条） | 136  | `pnpm test:bridge`；`pnpm test:frontend`；UI 改动手动浏览器回归                                       |
| 3    | 断言 177 条，按子类分 8 批：E/F/H（105）→ B（42）→ C/G（24）→ A/D（6）                | 177  | 每批 `pnpm typecheck` + 全量 `pnpm exec oxlint .` 计数递减；`pnpm test:bridge` / `pnpm test:frontend` |
| 4    | `no-await-in-loop` 39 条，逐点判定后并行化或按先例禁用                                | 39   | `pnpm test:bridge`（并发语义相关：队列、事件顺序）；`pnpm test:frontend`                              |
| 5    | 收口：全量退出码 0；确认 `pnpm lint` / `pnpm lint:staged` 行为                        | —    | `pnpm exec oxlint .` 退出 0；`pnpm lint` 退出 0                                                       |

阶段 1 → 2 → 3 → 4 按风险递增排序：形状改写先做，需要逐点语义判断的循环放最后。阶段间不强制阻塞，但**同一文件不要跨阶段并行改**。

本次复测：`pnpm exec oxlint .` 为 **353 warning、0 error**。原附录中的 14 条 `no-shadow` 与 1 条 `restrict-template-expressions` 已清除；当前工作树另有 1 条位于 `src/app/chat/session/use-composer-controller.ts` 的 `no-shadow`，不在本计划原始清单中，留待后续纳入处理。

## 6. 风险

- `consistent-return` 的改写是纯形状改写，已实测不改变 Fastify 行为；但 `return XFailure(reply, ...)` 类（31 条）改写后必须确认 `reply.send` 仍被调用且只调用一次。
- 断言清除若以「放宽目标类型」代替守卫，只是把问题推给 `tsc`；`typeAware` 下两者会互相拉扯，必须成对验证。
- `Promise.all` 化会改变并发与顺序语义（DB 事务、事件发布顺序、队列槽位准入），只对确认无共享状态、无顺序依赖的循环执行。
- 禁用注释是最后手段：只在证明循环必须串行时使用，且必须带 `-- 理由`，与既有三处先例格式一致。

## 附录 A：全量清单（规则 → 文件 → 行号）

共 367 条，覆盖 56 个文件（`server/` 279、`src/` 87、`scripts/` 1）。行号为 1 基。

### typescript(restrict-template-expressions)（1 条 / 1 文件，✅ 本批已完成）

| 文件                               | 条数 | 行号 |
| ---------------------------------- | ---- | ---- |
| `scripts/lint-staged-warnings.mjs` | 1    | 147  |

### typescript(consistent-return)（136 条 / 22 文件）

| 文件                                                            | 条数 | 行号                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `server/http/thread-routes.ts`                                  | 55   | 53, 58, 97, 103, 131, 143, 150, 160, 176, 207, 210, 232, 239, 242, 249, 259, 265, 287, 292, 301, 311, 319, 321, 324, 334, 343, 345, 348, 358, 367, 369, 372, 381, 402, 405, 433, 446, 451, 465, 478, 499, 502, 516, 523, 546, 548, 558, 564, 566, 569, 582, 586, 592, 597, 600 |
| `server/http/guest-routes.ts`                                   | 17   | 93, 107, 109, 116, 118, 120, 132, 138, 145, 147, 154, 164, 176, 186, 189, 198, 200                                                                                                                                                                                             |
| `server/http/configuration-routes.ts`                           | 13   | 17, 45, 50, 59, 71, 73, 89, 98, 103, 107, 111, 117, 131                                                                                                                                                                                                                        |
| `server/http/credentials-routes.ts`                             | 11   | 13, 24, 27, 28, 50, 52, 68, 71, 73, 84, 86                                                                                                                                                                                                                                     |
| `server/http/projects-routes.ts`                                | 10   | 11, 20, 25, 26, 39, 40, 43, 44, 53, 54                                                                                                                                                                                                                                         |
| `server/http/event-routes.ts`                                   | 4    | 23, 28, 57, 60                                                                                                                                                                                                                                                                 |
| `server/http/admin-routes.ts`                                   | 4    | 59, 117, 127, 131                                                                                                                                                                                                                                                              |
| `server/http/skills-routes.ts`                                  | 4    | 18, 23, 30, 37                                                                                                                                                                                                                                                                 |
| `src/app/workspace/sidebar/use-workspace-sidebar-controller.ts` | 3    | 271, 309, 426                                                                                                                                                                                                                                                                  |
| `src/app/chat/session/use-thread-detail-controller.ts`          | 2    | 113, 168                                                                                                                                                                                                                                                                       |
| `src/app/chat/session/use-composer-controller.ts`               | 2    | 236, 262                                                                                                                                                                                                                                                                       |
| `src/app/composition/screens/login-screen.tsx`                  | 1    | 80                                                                                                                                                                                                                                                                             |
| `src/app/workspace/runtime/use-codex-runtime-controller.ts`     | 1    | 222                                                                                                                                                                                                                                                                            |
| `src/app/workspace/sidebar/fade-presence-list.tsx`              | 1    | 105                                                                                                                                                                                                                                                                            |
| `src/app/chat/composer/composer-input.tsx`                      | 1    | 59                                                                                                                                                                                                                                                                             |
| `src/app/chat/content/shiki-code-block.tsx`                     | 1    | 43                                                                                                                                                                                                                                                                             |
| `src/app/chat/transcript/thread-assets-parts.tsx`               | 1    | 92                                                                                                                                                                                                                                                                             |
| `src/app/chat/transcript/thread-assets.tsx`                     | 1    | 88                                                                                                                                                                                                                                                                             |
| `src/app/composition/screens/guest-workspace-screen.tsx`        | 1    | 104                                                                                                                                                                                                                                                                            |
| `src/app/settings/configuration/configuration-section.tsx`      | 1    | 59                                                                                                                                                                                                                                                                             |
| `server/auth.ts`                                                | 1    | 35                                                                                                                                                                                                                                                                             |
| `server/http/auth-routes.ts`                                    | 1    | 39                                                                                                                                                                                                                                                                             |

### typescript(no-unsafe-type-assertion)（177 条 / 48 文件）

| 文件                                                            | 条数 | 行号                                                                                                                     |
| --------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------ |
| `server/http/thread-routes.ts`                                  | 25   | 40, 81, 88, 110, 185, 203, 217, 218, 256, 257, 308, 309, 331, 332, 355, 356, 379, 387, 395, 396, 413, 495, 510, 556, 577 |
| `server/guest-manager.ts`                                       | 15   | 137, 182, 224, 234, 309, 344, 346, 348, 349, 367, 376, 419, 424, 447, 452                                                |
| `server/guest-service.ts`                                       | 13   | 216, 626, 743, 815, 816, 816, 823, 824, 824, 840, 842, 846, 848                                                          |
| `server/http/guest-routes.ts`                                   | 12   | 15, 36, 58, 72, 115, 128, 137, 153, 163, 171, 175, 184                                                                   |
| `server/codex/runtime-manager.ts`                               | 8    | 424, 425, 426, 427, 428, 449, 737, 743                                                                                   |
| `src/lib/bridge/http/guest.ts`                                  | 5    | 92, 100, 100, 206, 213                                                                                                   |
| `src/lib/bridge/http/credentials.ts`                            | 5    | 32, 77, 87, 163, 173                                                                                                     |
| `src/app/chat/session/chat-selection-storage.ts`                | 5    | 27, 28, 28, 31, 32                                                                                                       |
| `src/lib/bridge/http/skills.ts`                                 | 4    | 13, 44, 69, 72                                                                                                           |
| `src/lib/bridge/http/configuration.ts`                          | 4    | 44, 48, 49, 62                                                                                                           |
| `src/lib/bridge/http/codex.ts`                                  | 4    | 57, 59, 60, 70                                                                                                           |
| `src/lib/bridge/http/projects.ts`                               | 4    | 14, 54, 64, 125                                                                                                          |
| `src/app/main.tsx`                                              | 4    | 57, 67, 75, 99                                                                                                           |
| `server/codex/event-hub.ts`                                     | 4    | 177, 178, 178, 190                                                                                                       |
| `server/codex/manager.ts`                                       | 4    | 490, 492, 523, 552                                                                                                       |
| `server/http/credentials-routes.ts`                             | 4    | 22, 35, 66, 82                                                                                                           |
| `server/http/projects-routes.ts`                                | 4    | 18, 33, 35, 51                                                                                                           |
| `src/app/chat/session/thread-session-store.ts`                  | 3    | 167, 171, 441                                                                                                            |
| `src/lib/bridge/thread-adapters.ts`                             | 3    | 33, 33, 37                                                                                                               |
| `src/app/chat/session/use-thread-page-controller.ts`            | 3    | 96, 101, 106                                                                                                             |
| `server/thread-ownership.ts`                                    | 3    | 29, 43, 44                                                                                                               |
| `src/lib/theme/storage.ts`                                      | 2    | 52, 82                                                                                                                   |
| `src/app/composition/screens/login-screen.tsx`                  | 2    | 36, 53                                                                                                                   |
| `src/app/chat/session/use-thread-detail-controller.ts`          | 2    | 84, 245                                                                                                                  |
| `src/app/chat/session/use-composer-controller.ts`               | 2    | 494, 502                                                                                                                 |
| `src/app/settings/guest-capacity/guest-capacity-section.tsx`    | 2    | 43, 47                                                                                                                   |
| `src/app/chat/transcript/streaming-assistant.tsx`               | 2    | 35, 93                                                                                                                   |
| `src/app/chat/transcript/thread-assets.tsx`                     | 2    | 128, 216                                                                                                                 |
| `src/app/composition/screens/admin-screen.tsx`                  | 2    | 35, 38                                                                                                                   |
| `server/thread-access.ts`                                       | 2    | 44, 74                                                                                                                   |
| `server/thread-collection.ts`                                   | 2    | 49, 56                                                                                                                   |
| `server/codex/event-store.ts`                                   | 2    | 101, 106                                                                                                                 |
| `server/http/common.ts`                                         | 2    | 30, 35                                                                                                                   |
| `server/http/configuration-routes.ts`                           | 2    | 42, 57                                                                                                                   |
| `server/http/event-routes.ts`                                   | 2    | 21, 33                                                                                                                   |
| `src/app/composition/routes/use-workspace-route-controller.ts`  | 1    | 38                                                                                                                       |
| `src/app/workspace/sidebar/use-workspace-sidebar-controller.ts` | 1    | 551                                                                                                                      |
| `src/app/chat/composer/chat-input-markdown.ts`                  | 1    | 80                                                                                                                       |
| `src/app/chat/composer/paste-code-detection.ts`                 | 1    | 35                                                                                                                       |
| `src/app/chat/transcript/markdown-repair.ts`                    | 1    | 9                                                                                                                        |
| `src/app/composition/screens/guest-workspace-screen.tsx`        | 1    | 243                                                                                                                      |
| `server/codex/stdio-transport.ts`                               | 1    | 14                                                                                                                       |
| `server/skills.ts`                                              | 1    | 128                                                                                                                      |
| `server/auth.ts`                                                | 1    | 44                                                                                                                       |
| `server/workspace.ts`                                           | 1    | 74                                                                                                                       |
| `server/http/skill-selection.ts`                                | 1    | 11                                                                                                                       |
| `server/http/skills-routes.ts`                                  | 1    | 15                                                                                                                       |
| `server/http/admin-routes.ts`                                   | 1    | 124                                                                                                                      |

### eslint(no-await-in-loop)（39 条 / 8 文件）

| 文件                                                        | 条数 | 行号                                                           |
| ----------------------------------------------------------- | ---- | -------------------------------------------------------------- |
| `server/guest-service.ts`                                   | 13   | 64, 139, 155, 682, 687, 692, 695, 699, 701, 703, 711, 716, 733 |
| `server/codex/runtime-manager.ts`                           | 11   | 140, 142, 143, 153, 398, 402, 403, 407, 522, 528, 592          |
| `server/guest-manager.ts`                                   | 5    | 402, 473, 483, 484, 486                                        |
| `src/app/chat/session/use-composer-controller.ts`           | 3    | 313, 324, 330                                                  |
| `server/http/thread-routes.ts`                              | 3    | 281, 387, 398                                                  |
| `src/app/workspace/runtime/use-codex-runtime-controller.ts` | 2    | 60, 61                                                         |
| `server/thread-ownership.ts`                                | 1    | 29                                                             |
| `server/codex/manager.ts`                                   | 1    | 313                                                            |

### eslint(no-shadow)（14 条 / 2 文件，✅ 本批已完成）

| 文件                        | 条数 | 行号                                                           |
| --------------------------- | ---- | -------------------------------------------------------------- |
| `server/guest-service.ts`   | 13   | 89, 208, 229, 260, 267, 289, 302, 401, 462, 482, 614, 682, 761 |
| `server/codex/event-hub.ts` | 1    | 171                                                            |
