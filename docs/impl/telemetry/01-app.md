# 任务 01：App 错误消费与呈现

## 状态和依赖

- 状态：Complete。
- 决策源：[主规格](./development-spec.md)；契约：[任务 00](./00-contract-and-protocol.md)。
- 可并行：与任务 02、03 并行；owner wire 联调必须使用任务 00 的 DTO，不维护 legacy 兼容。

## 目标与 ownership

让 App 使用 `@codex-web/telemetry/errors` 解析和保留结构化公共错误，并通过 code 本地化展示；把主要业务 UI 从原始 `.message` 改为统一错误呈现边界。任务拥有 `packages/app/**` 和需要的 `packages/telemetry` 浏览器安全契约修复；不得修改 Owner Server、Relay 或 Protocol。

## 当前入口与行为

- `packages/app/src/lib/owner-ws/owner-runtime.ts` 定义 `OwnerRequestError`，消费 protocol response error 并合成 `${code}: ${message}`。
- `owner-management-client.ts` 把 DTO 转成普通 Error。
- `remote/admission.ts` 通过 `instanceof OwnerRequestError` 与旧 uppercase code 分支。
- workspace/settings/chat/login/runtime controllers 和少量组件直接读取 `.message`。这些调用点需要分类：Owner remote error、local operation error、UI state message、transcript/runtime item message。只把 error object 迁移到 telemetry renderer，不能批量替换用户创建/运行输出或展示模型里的业务 message。
- `copy-button.tsx` 与 transcript debug 有少量 console 诊断；按主规格清理，不添加 browser logger。

## 实施要求

- `OwnerRequestError` 保留 `PublicErrorDto` 字段并支持 cause；不得把 code/message 拼进唯一 message 后丢失 params。
- 提供 App 错误呈现函数/模块：已知 code + params -> 本地化文案；未知且 `isPublicErrorDto` 通过的安全 message -> 原样 fallback；否则通用本地化文案。未知 code 仍保留 code 供诊断和特定逻辑判断，但 UI 不展示 raw code。
- 翻译 key 与 code 一一对应，覆盖任务 00 Owner public code catalog。可按现有 app i18n/文案架构选定命名，需通过完整 code coverage test 防止漏 key。
- 安全参数只用于允许的插值位。不得把项目路径、credential、thread 内容、原始 Origin、session/profile secrets 或 arbitrary server params 插入文案。
- admission/管理 workflow 按 `code` 分支，不匹配服务端人类 message；错误在抛出、catch、state projection 中保留原 DTO。
- local browser errors 使用稳定本地 code 或已存在的明确 UI copy adapter；不得伪装成 Owner server code。普通 UI state 的 `message: string` 不在本任务中全面改成错误类型。
- 对 malformed owner response error，Owner runtime 按 protocol parse failure 断开/失败关闭，不继续显示其中 message。

## 验收与验证

- Unit tests: known code localization and primitive interpolation; unknown safe message; unknown absent/unsafe message generic fallback; invalid params and extra DTO fields; retryability preservation; timeout/cancel/connection errors; passkey-required branch by namespaced code; management client preserves DTO.
- Add exhaustive test comparing Owner public code list from telemetry with localization coverage. Locale fallback rules follow existing App localization mechanism; missing translation must not fall back to server text for known codes.
- Focused `pnpm --filter @codex-web/app test`, root `pnpm typecheck`, and `pnpm exec oxfmt --check <touched TS/TSX>`.
- Manual user acceptance (post-implementation): exercise local and remote known Owner errors, one unknown safe DTO fallback, malformed DTO rejection, passkey enrollment branch, and generic network/Relay failures; no React DOM/Playwright/screenshot tests by default.

## 排除项

不新增 browser logger，不改视觉系统，不格式化 transcript 内容，不重写所有非 Owner UI state 错误，不修改 wire contract 或 server mapping。

## 完成结果

- `OwnerRequestError` 保留完整 DTO；Owner management client、runtime、admission 与主要用户可见错误边界已迁移到共享呈现函数。
- 已为全部 42 个 Owner code 提供中英文案，已知 code 不使用服务端 message 覆盖；未知安全 Owner DTO 使用 message fallback，非法或缺少安全 message 时显示通用文案。
- Passkey 分支基于 `owner.auth.passkey-required`；malformed Owner frame fail-closed。少量 browser console 诊断已清理，没有新增 browser logger。
- 验证通过：App tests 270 passed、App typecheck、触及 TS/TSX 的 `oxfmt --check`。并行期间根 typecheck 的失败来自 Server，App 自身包检查通过。
