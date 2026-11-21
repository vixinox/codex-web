# Task 00：Conversation 领域合同

> 后续内容过滤、Skills 标识与详细错误合同以 [05](./05-owner-filter-removal-and-simplification.md) 为准；本文旧安全投影约束与结果不再代表 05 完成后的行为。

## 状态

- Implementation complete；自动化验证通过，详见 [03 集成与清理](./03-integration-and-cutover.md)。
- 本任务实现共享领域包；UI 仅要求共享模型支持相应语义，不新增 presentation behavior。
- 父规格：[development-spec.md](./development-spec.md)。

## 目标与范围

创建 `@codex-web/conversation` 作为 browser-safe、runtime/transport/UI-independent 的领域模块。定义有类型的 Conversation snapshot、change/event、commands、interaction 与 agent relation；提供纯 reducer 和 contract test helpers。Owner WS envelope/cursor 仍归 `@codex-web/protocol/owner`。

核心模型至少覆盖 Conversation、Turn、Message、typed MessagePart、Activity、Interaction、AgentLink、source identity、event identity 与 occurred/received timestamps。具体 discriminated unions 必须逐项映射 ThreadItem、realtime item、thread-scoped notification/request；对非 Conversation 的 schema method 给出明确的所属子域或排除原因。

## 接口与不变量

- 领域事件使用 discriminated union，不接受开放字符串 type + 任意 payload 作为 reducer input。
- IDs 使用语义区分类型/namespace：conversation、turn、message、activity、interaction、agent、source event、Owner delivery event、runtime request correlation 不得混用裸身份。
- `ConversationSnapshot` 携带应用 watermark；纯 `applyChange(state, change)` 按 source/event identity 幂等。未知未来 status 不得默认映射为 completed。
- Delta 作用于稳定 MessagePart/Activity identity；terminal lifecycle 不得被迟到的 nonterminal change 回退。
- AgentLink 表达 parent/child agent、任务和 child conversation/thread 关联；保留 schema 所给的 relation，不压缩成数量。
- Interaction 表达 pending、resolved outcome、cancelled/expired 等状态和 request correlation。RPC request ID 是 adapter correlation，不等同领域 Interaction ID。
- 包不依赖 React、Fastify、Codex App Server DTO、Node-only runtime、SQLite 或 Owner WS。

## 验收

- 能用同一 reducer 驱动 Codex fixture 与第二种测试 adapter fixture，领域 union/reducer 不出现 Codex method 检查。
- 针对 assistant delta、activity lifecycle、approval/user input、child agent link、duplicate/late changes、unknown extension diagnostic 编写纯逻辑测试。
- Official schema fixture coverage 对 19 ThreadItem、4 realtime item、相关通知和 server request 有逐项 disposition；完整列表见父规格矩阵。领域覆盖不要求每一项都有 UI。
- package exports 仅公开 browser-safe model/reducer/schema helpers；typecheck 与 package tests 通过。

## 排除

- 不定义视觉控件、renderer 聚合方式或用户可见文案。
- 不做通用插件注册、运行时 capability negotiation 或任意 raw extension payload。
- 不改变 Owner stream cursor/envelope 格式。
