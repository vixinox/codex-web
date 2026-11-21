# 任务 04：集成与验收

## 状态和依赖

- 状态：Verified。
- 决策源：[主规格](./development-spec.md)。
- 本任务负责跨包一致性、回归和验收；发现契约不一致时先更新主规格与对应任务包，再修实现。

## 集成范围

- 对照 telemetry exports、Owner Protocol parser/wire DTO、App error renderer、Server mapper/logger、Relay internal code/close mapper，确认没有私有重复 DTO、legacy uppercase wire code、旧 log facade 或直接 console logging 残留（明确允许的 emergency fallback 和 UI debug cleanup 除外）。
- 检查从 Owner domain error 到 response frame、App localized rendering 的完整链路；HTTP body/error status 独立检查；Relay code 只进内部日志与 coarse close mapping。
- 确认共享 `LOG_LEVEL` 在 Owner Node 与 Relay Bun 一致：缺省 info；debug/info/warn/error 阈值一致；非法值启动失败且只输出安全配置错误。

## 自动化验收

- `pnpm --filter @codex-web/telemetry test`
- `pnpm --filter @codex-web/protocol test`
- `pnpm --filter @codex-web/server test`
- `pnpm --filter @codex-web/relay test`
- `pnpm --filter @codex-web/app test`
- `pnpm typecheck`
- 对所有本次触及 TS/TSX 执行 `pnpm exec oxfmt --check <files...>`；根据仓库流程在提交前由提交者 stage 意图文件后执行 `pnpm lint:staged`。

并行执行的任务需在合并前各自提供 focused 测试结果；最终集成测试在合并后的同一 workspace commit 上重跑相关命令。不得以手工浏览器测试替代 automated type/security/protocol checks。

## 安全验证

使用捕获 sink/fixture 检查所有 logger adapter：字符串及字段注入 API key、authorization bearer、session/client/owner token、Windows/Unix path、Passkey challenge、thread text、JSON-RPC params/results、E2EE ciphertext、CR/LF/control chars、超长文本、循环/深 cause、non-Error 值和错误 metadata。最终输出不得包含 secret、body、stack、未受限对象或换行注入。

跨边界确认：

- 公开错误只含 catalog code、允许的 primitive params、retryable 和已批准安全 fallback message。
- 已知 code 使用 App 本地化，不因服务端 message 覆盖已知文案。
- 未知 code 的有效安全 message 可 fallback；message 缺失/结构非法/危险文本时显示通用文案。
- Owner request/parser error 不把 parser diagnostic 文本作为业务错误展示。
- Relay 对未认证方维持一致拒绝表现；内部日志不得把 secret 或 route secret 写出。
- HTTP status level table 为 5xx error、4xx info、其他 info，response hook 不重复 error hook 记录。

## 手工用户验收（实现后、非开发阻塞）

1. Owner 本地连接和远程 Relay 连接各触发一个已知业务错误，确认 UI 显示相同的本地化文案且保留可重试交互。
2. 使用开发测试 fixture 触发未知但安全 DTO message，确认作为 fallback；再触发缺 message 或不安全 DTO，确认只显示通用文案。
3. 检查 TTY Owner/Relay 启动日志可读；将输出 pipe 到文件后每条记录都是独立合法 JSON object。
4. 触发 2xx、3xx、4xx、5xx HTTP response 与 Relay invalid auth/capacity/enrollment reject，确认级别与对端拒绝策略符合规格。
5. 远程 client 断线/重连、owner 替换/退出、slow consumer 后，确认正常连接恢复流程不受 telemetry sink 行为影响。

## 完成门槛

- 任务 00–03 acceptance 全部满足，所有必需测试/类型/格式检查通过。
- 日志安全检查无未处理泄露路径；每个允许异常输出点均有固定字段与测试。
- 更新主规格状态为 Verified，记录各任务完成状态、命令结果、已接受偏差和仍待用户手工验收事项。
- 未完成手工用户验收不阻塞开发实现 Verified，除非用户将其明确设为发布门槛。

## 实际集成结果

- Task 00–03 已完成；Owner DTO 在 Protocol、App、Server 之间统一，Relay 内部 code 不进入 Owner wire。
- `pnpm test` 通过：Server 138、Protocol 22、Relay 27 tests；`pnpm test:frontend` 通过：App 270 tests；telemetry 13 tests 单独通过。
- `pnpm typecheck` 全 workspace 通过；涉及 logger/Protocol alias 收尾的 TS 文件 `oxfmt --check` 通过。各并行任务已对各自触及 TS/TSX 执行格式检查。
- `git diff --check` 通过。静态扫描未发现 Server `safeError()`、App/Server/Relay `console.log/warn/error`、插值日志事件、`OWNER_ERROR_CODES` 或遗留 `OwnerError` 类型别名。
- 未执行需用户启动 Owner/Relay 与浏览器连接的手工验收；依规格这不是开发完成门槛，仍建议按上文流程检查 TTY/JSONL 与本地/远程 UI 行为。
