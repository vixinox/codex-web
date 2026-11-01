# Server 事件链与统一业务层

状态：已完成

本规格定义 Codex Web server 的事件边界。Codex App Server 原生 JSON-RPC 只在 runtime adapter 内部解析；Owner WebSocket、事件历史和前端只接收版本化 domain event envelope。

## 决策

- 当前实现以 Codex 为第一 runtime，不预建其他 agent 的完整事件模型。
- vendor schema 定义原生协议形状，fixture 验证运行时事件顺序、交错和历史回放。
- `projectNativeMessage` 不再是事件总线、持久化和 Owner WS 的共享入口。
- domain event 是 server 的事件历史真值，实时流和历史读取使用同一投影。
- Owner 继续使用单调全局 sequence 和 `epoch + sequence` cursor；保留 `events.subscribe` 与 `events.resume` 生命周期。
- 未映射的合法 runtime 消息转为 `runtime.extension`，递归过滤凭据/路径字段，payload 限制为 128,000 UTF-8 字节后进入 domain log 与 Owner WS。
- 事件表使用 `domain_events` 语义；旧 `codex_event` 不迁移，开发数据库可直接 reset/recreate。

## 数据流

```text
Codex JSON-RPC
  -> Codex adapter
  -> versioned DomainEventEnvelope
  -> EventHub / domain_events
  -> Owner client envelope
  -> WS stream and thread history
```

每条事件包含 `schemaVersion`、`eventId`、`type`、`runtime`、可选关联 ID、`createdAt` 和 `payload`。Thread 快照仍经过独立 client projection；它不再参与原生事件解析。

## 边界

原始 runtime envelope 不单独持久化。adapter 负责 runtime 语义和关联 ID；EventHub 负责排序、回放、cursor、保留和订阅；client projection 负责 Owner WS 可见字段与大小/脱敏限制。未知事件进入扩展事件，不阻断同一 Thread。

## 验证

server 变更运行 `pnpm typecheck`、`pnpm --filter @codex-web/server test` 和目标 TypeScript 文件的 `oxfmt --check`。前端事件契约变更运行 `pnpm --filter @codex-web/app test` 与全仓 `pnpm typecheck`。
