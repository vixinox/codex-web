# 任务 01：Codex adapter

建立 `RuntimeEventEnvelope`、`DomainEventEnvelope` 和 Codex adapter。已理解事件映射为 `codex.<method>` domain event，未知合法消息为 `runtime.extension`，无效消息为 `runtime.diagnostic`。以 `docs/vendor/codex-app-server/` 为协议依据，用 fixture 覆盖增量、生命周期、工具、审批、usage 和未知消息。
