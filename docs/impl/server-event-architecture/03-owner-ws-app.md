# 任务 03：Owner WS 与 App

保留 `events.subscribe/resume` 和 cursor 生命周期，把事件正文切换为 `{ event: DomainEventEnvelope }`。前端 adapter 在边界转换为现有 session reducer 使用的通知，实时流与 Thread history 共享同一 domain event 映射。
