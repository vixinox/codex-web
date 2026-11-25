# App Server context compaction：调用与生命周期

核对日期：2026-11-23。范围为仓库已审阅的 App Server **0.167.0** JSON Schema 与配套 vendor 文档。没有运行 App Server 或核对上游实现，因此下列“未定义”事项不能当成运行时保证。当前 schema 快照不表示运行时永久固定版本，见 [协议入口](../app-server/README.md#L3)。

## 结论

手动压缩的公开方法是 `thread/compact/start`，参数只有必填 `threadId`，立即返回空对象。完成与失败通过同一 thread 的普通 turn/item 事件表达，不在 RPC 返回值中表达。压缩工作项为 `contextCompaction`，具有 `item/started`、`item/completed` 生命周期。旧 `thread/compacted` 已废弃。

依据：[文档调用与生命周期](https://learn.chatgpt.com/docs/app-server.md)、[参数 schema](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/app-server-protocol/schema/json/v2/ThreadCompactStartParams.json)、[响应 schema](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/app-server-protocol/schema/json/v2/ThreadCompactStartResponse.json)、[旧通知 schema](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/app-server-protocol/schema/json/v2/ContextCompactedNotification.json)。

## 如何调用

1. 建立传输后，执行 `initialize` 请求并发送 `initialized` 通知。每个连接仅初始化一次，初始化前其他请求会失败。线上的 JSON-RPC 省略 `jsonrpc` 字段。依据：[传输](https://learn.chatgpt.com/docs/app-server.md)、[初始化](https://learn.chatgpt.com/docs/app-server.md)。
2. 为目标 thread 建立正常会话与事件订阅；`thread/start` 自动订阅，恢复已有 thread 使用 `thread/resume`。`thread/read` 仅查看存储历史，不订阅事件。依据：[方法概要](https://learn.chatgpt.com/docs/app-server.md)、[历史读取](https://learn.chatgpt.com/docs/app-server.md)、[事件接收](https://learn.chatgpt.com/docs/app-server.md)。
3. 在发送请求之前安排好通知消费，再请求：

```json
{"method":"thread/compact/start","id":25,"params":{"threadId":"thr_b"}}
```

正常受理响应：

```json
{"id":25,"result":{}}
```

响应没有 `turnId`、摘要、压缩百分比或 token 节省数量。请求也没有逐次设置压缩 prompt、模型、effort、目标 token 数或截断范围的字段。不要把空响应当成压缩完成，也不要假定响应一定早于所有通知到达；文档没有定义 response 与异步通知的严格交错顺序。依据：[手动压缩文档](https://learn.chatgpt.com/docs/app-server.md)、[请求 schema](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/app-server-protocol/schema/json/v2/ThreadCompactStartParams.json)、[响应 schema](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/app-server-protocol/schema/json/v2/ThreadCompactStartResponse.json)。

## 生命周期及消费方法

下表是标准生命周期的消费方式，不是要求线上消息只能严格按此表排列；其他通知可以穿插。

| 阶段 | 观察方式 | 应用行为 |
| --- | --- | --- |
| 受理 | RPC `result: {}` | 仅标记请求受理；保持等待 |
| turn 运行 | `turn/started`，`params.threadId`、`params.turn.id`、`status: inProgress` | 按 thread 与 turn 关联运行状态 |
| 开始压缩 | `item/started`，`item.type: contextCompaction` | 显示“正在压缩上下文”；保存 item id |
| item 完成 | `item/completed`，相同压缩 item 的最终状态 | 结束这个压缩 item 的进行态 |
| 整个 turn 结束 | `turn/completed`，`turn.status: completed / interrupted / failed` | 根据最终状态结束忙碌态、显示失败或中断 |

依据：[压缩事件保证](https://learn.chatgpt.com/docs/app-server.md)、[通用 turn 事件](https://learn.chatgpt.com/docs/app-server.md)、[通用 item 生命周期](https://learn.chatgpt.com/docs/app-server.md)。

`contextCompaction` 类型专属字段只有 `id` 和 `type`；它不提供摘要正文、进度比例或压缩前后 token 对比。`ThreadItem` 另有通用元数据，具体以 schema 为准。`item/started` envelope 包含必填 `item`、`startedAtMs`、`threadId`、`turnId`，应从 envelope 取关联信息。依据：[item 类型](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/app-server-protocol/schema/json/v2/ItemStartedNotification.json)、同文件末尾顶层 `properties` / `required`。

不要只监听 `thread/compacted`：它仍在 schema 里但明确 deprecated，内容只有 `threadId`、`turnId`，替代信号是 `contextCompaction` item。依据：[文档](https://learn.chatgpt.com/docs/app-server.md)、[schema](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/app-server-protocol/schema/json/v2/ContextCompactedNotification.json)。

## 压缩期间的其他行为

- **手动 compact turn 不可 steer。** 当前 active turn 为手动 `/compact` 时，提交 `turn/start` 或 `turn/steer` 可能得到结构化 `codexErrorInfo.activeTurnNotSteerable`，其中 `turnKind` 为 `compact`。UI 应等待结束，或显式处理错误，不能假定发出的输入会被排队或加入压缩。依据：[错误定义](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/app-server-protocol/schema/json/v2/ErrorNotification.json)、同文件 `NonSteerableTurnKind`。
- **取消沿用 turn API。** 文档提供 `turn/interrupt`，必填 `threadId` 与 `turnId`，成功受理返回 `{}`，最终通过 `turn/completed` 的 `interrupted` 状态确认。没有独立 `thread/compact/cancel`。这是通用 turn 取消契约；文档没有详细承诺 compact 内部各阶段中断后具体回滚范围。依据：[取消文档](https://learn.chatgpt.com/docs/app-server.md)、[参数](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/app-server-protocol/schema/json/v2/TurnInterruptParams.json)。
- **运行状态与压缩 item 是不同维度。** `thread/status/changed` 表达 loaded thread 的通用运行状态；文档未给 compact 独立 thread status 或专属 flag。识别压缩应依据 item 类型。依据：[状态事件](https://learn.chatgpt.com/docs/app-server.md)。
- **可能伴随 hook。** hook event enum 含 `preCompact`、`postCompact`；若配置并执行同步生命周期 hook，可收到 `hook/started`、`hook/completed`。文档明确异步 hook 不发送这两个通知，不能把 hook 通知当成每次压缩必有的信号。依据：[hook enum](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/app-server-protocol/schema/json/v2/HookStartedNotification.json)、[通知规则](https://learn.chatgpt.com/docs/app-server.md)。
- **token usage 独立处理。** `thread/tokenUsage/updated` 提供 `last`、`total`、可空 `modelContextWindow`，以及 thread/turn id。没有明确命名的“当前压缩后上下文 token 数”字段或压缩前后差值保证；不得直接把累计 total 当上下文占用。依据：[usage schema](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/app-server-protocol/schema/json/v2/ThreadTokenUsageUpdatedNotification.json)。

## 错误与恢复

应区分请求错误与受理后的运行错误。文档中通用失败 turn 会有 `error` 通知并以 `turn/completed` 的 `failed` 状态结束。`ErrorNotification` 有必填 `willRetry`，所以收到一次 error 不应无条件直接判整个 turn 终止；终态仍由 `turn/completed` 确认。错误结构可包含 `message`、`codexErrorInfo`、`additionalDetails`。依据：[错误文档](https://learn.chatgpt.com/docs/app-server.md)、[ErrorNotification schema](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/app-server-protocol/schema/json/v2/ErrorNotification.json)。

通知是连接上的事件；如果客户端主动在 `initialize.capabilities.optOutNotificationMethods` 里屏蔽 `item/started`、`item/completed` 或 turn 事件，将影响自行跟踪生命周期。`thread/read`、`thread/turns/list`、`thread/items/list` 可读历史（后两者实验性），响应的 ThreadItem union 包含压缩 item，但文档没有承诺断线重连后自动重放漏掉的全部压缩通知。依据：[通知过滤](https://learn.chatgpt.com/docs/app-server.md)、[历史接口](https://learn.chatgpt.com/docs/app-server.md)、[历史 item union](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/app-server-protocol/schema/json/v2/ThreadItemsListResponse.json)。

## 手动与自动压缩的边界

`thread/compact/start` 明确触发手动压缩。配置 schema 还暴露 `compact_prompt`、`model_auto_compact_token_limit`、`model_auto_compact_token_limit_scope`；scope 可为 `total`（计算整个 active context）或 `body_after_prefix`（计算已携带 window prefix 后的 sampled output 与后续增长）。这些是配置字段，不是该请求的参数。依据：[配置 schema](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/app-server-protocol/schema/json/v2/ConfigReadResponse.json)、[prompt](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/app-server-protocol/schema/json/v2/ConfigReadResponse.json)、[limit](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/app-server-protocol/schema/json/v2/ConfigReadResponse.json)。

`contextCompaction` item 没有 `reason` 或 `trigger` 字段，不能仅凭它确定压缩是用户手动触发还是自动触发。文档的 item 描述是 Codex 压缩历史时发出，但没有分别列出自动压缩的 turn 创建规则、准确触发时机、默认阈值、失败重试与重复压缩策略。应把“可识别压缩 item”与“已证实自动压缩全部流程”分开。

## 本资料不能支持的结论

以下需要对应 runtime 版本的上游实现或专门验证，不能通过 schema 猜测：

- 已有正常 turn 正在执行时，再发 compact 是拒绝、排队、打断还是合并；重复 compact 请求的幂等性与串并行行为。
- 未加载 thread 是否自动加载；缺失 thread 的具体错误码。
- 压缩用哪种模型、是否远程、默认摘要 prompt、摘要可读性、保留哪些消息与工具输出。
- 压缩是否改写或删除原始 rollout、模型上下文与可见历史的逐条映射、失败或取消后的事务/回滚语义。
- 自动触发的默认阈值和确切阶段；所有压缩是否必定成功、token 是否必定下降、是否有百分比进度。
- 压缩独有通知的数量与通用通知之间的完整严格顺序。

客户端最小实现是：调用前订阅 → 发 `thread/compact/start` → 受理后等待对应 thread 的 compact item 与 turn 终态 → 处理中处理不可 steer 错误 → 失败/取消按 turn 终态收尾。所有 UI 时间线应按事件携带的 thread/turn/item id 关联，而不是用 RPC id 推导 turn id。
