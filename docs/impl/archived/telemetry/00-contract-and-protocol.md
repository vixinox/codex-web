# 任务 00：Telemetry 契约与 Owner Protocol

## 状态和依赖

- 状态：Complete; the contract is frozen for tasks 01/02/03.
- 依赖：当前 `@codex-web/telemetry` foundation 已存在。
- 后续依赖：本任务完成并冻结 API 后，App、Owner Server、Relay 三任务方可开始跨边界迁移。
- 决策源：[主规格](./development-spec.md)。本任务只细化契约，不得改变主规格的 code 格式、DTO 安全规则或顺序。

## 目标与范围

在 telemetry 中建立完整、稳定、可浏览器消费的错误码目录和 DTO；将 Owner protocol response error 改为此 DTO；把 parser/frame validation issue 与业务错误分开；更新 encode/parse/stream 错误校验及所有 Protocol 测试。冻结后，三个消费者任务仅能使用已发布的 exports，不得自行扩展 wire payload。

允许修改 `packages/telemetry/**`、`packages/protocol/**` 和本任务/主规格文档。不得迁移 App UI、Owner Server 业务错误产生/日志、Relay app/router 日志。

## 必须形成的契约

- `TelemetryErrorCode` 提供已知 Owner/Relay namespaced code catalog 和 known-code guard；`PublicErrorDto.code` 的静态类型须允许格式合法的未来 code（例如 `TelemetryErrorCode | (string & {})` 或等效 branded type），以支持未知 code 安全 fallback。Owner wire parser 只接受 `owner.*` namespace；接受 catalog 中的 Owner code 和格式合法、但当前 catalog 未收录的未来 `owner.*` code。`relay.*` code 是 Relay 内部诊断码，不进入 Owner public DTO。
- 公共 DTO 字段按主规格：`code`、可选有限 primitive `params`、`retryable`、可选安全 fallback `message`。DTO guard 必须拒绝未知字段、危险 key、非有限 number、非 primitive、超限内容和未经安全规约的 message。
- `OwnerResponseFrame.error` 引用 telemetry DTO；不要把错误字段复制进 protocol 本地 interface。
- Parser 返回 `OwnerProtocolIssue` 专用类型，含 parser code/message，仅供诊断和 frame rejection；它不能被误用作 App 的业务 error DTO，也不能包含输入正文。
- `OWNER_ERROR_CODES`、旧 `OwnerError` 类型与重复 guard 被移除或收敛，避免双重真相。Stream/domain-event parser 的 contract issue 可以继续返回 parser 专用 `{ code, message }`，但需区分命名和类型，避免与 `PublicErrorDto` 混淆。
- 旧码映射依据主规格表，AuthDomainError 码纳入目录；完成前扫描所有 `OwnerMethodError`/`AuthDomainError` throw site，更新迁移表并证明无遗漏。

## 数据流和失败策略

Owner Server 最终负责产生 DTO；本任务只建立 schema/guard/parser，不能把 parser 错误自动包装为 displayable business error。通用 `isPublicErrorDto` 校验 code 的 namespaced syntax、长度和 DTO 安全边界，但不要求 code 必须在当前 catalog 中；Owner frame parser 另要求 `owner.*` namespace。因此合法未知 Owner code 可以由 App 按主规格执行安全 message fallback；Relay code 与 parser issue 均不得被当作 Owner displayable error。未知 code 不得包含任意动态文本或超出 code grammar。

Parser diagnostics must remain bounded and generic. Invalid frame content, params, secret-like strings, or raw request JSON must not be embedded in issue message. Existing Owner frame grammar, max sizes, sequence/cursor semantics remain unchanged.

## 验收标准

- 所有旧 Owner displayable codes 有且仅有一个迁移映射；有合并映射时主规格表列出别名；Parser-only codes 不进入 UI error catalog。
- Owner frame parse/encode、response、stream error close 相关测试覆盖合法新 DTO、可选 params/message、合法未知 namespaced code、格式非法 code、额外字段、对象 params、秘密 key、超限字符串和非法 retryable。合法未知 code 保留给 App fallback；格式非法 code 被 parser 拒绝。
- Domain event parser issue tests continue passing and types no longer alias public error DTO accidentally.
- `pnpm --filter @codex-web/telemetry test` (final count 13)、`pnpm --filter @codex-web/protocol test`、两个包 typecheck、根 `pnpm typecheck`、触及 TS 文件格式检查通过。
- 主规格的 telemetry API surface 与实际 exports 完全一致，任务 01/02/03 可无临时 adapter 依赖直接消费。

## 完成结果

冻结 exports、DTO shape、code catalog、parser issue boundary、旧到新的迁移表与测试命令。具体导出项和兼容说明记录在[主规格](./development-spec.md)的 Task 00 frozen API 小节。

旧 Owner displayable codes 已按迁移表映射；`OwnerMethodError`/`AuthDomainError` literal callsite audit 未发现表外业务码。Parser-only frame/event issue codes 不进入 displayable code catalog。消费者迁移后已删除 deprecated type-only `OwnerError` aliases，Owner response 直接使用 `PublicErrorDto`，无旧 DTO 兼容层。

验证通过：

- `pnpm --filter @codex-web/telemetry test`：13 passed after logger sink-containment regression coverage was added during integration.
- `pnpm --filter @codex-web/telemetry typecheck`：passed。
- `pnpm --filter @codex-web/protocol test`：22 passed。
- `pnpm --filter @codex-web/protocol typecheck`：passed。
- `pnpm typecheck`：all workspace packages passed.
- `pnpm exec oxfmt --check packages/telemetry/src/errors.ts packages/telemetry/src/errors.test.ts packages/protocol/src/owner/index.ts packages/protocol/src/owner/index.test.ts`：passed.
