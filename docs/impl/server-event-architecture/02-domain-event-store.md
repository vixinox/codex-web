# 任务 02：Domain event store

将 EventHub 与 SQLite store 切换到版本化 domain event。保留 owner 全局 sequence、thread filter、replay、cursor gap、retention 和 restart restore。使用 `domain_events` 表，不迁移旧 `codex_event`。
