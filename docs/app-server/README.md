# Codex App Server 协议入口

项目默认使用 GitHub 最新 stable 的 Codex App Server。当前仓库锁定并审阅的协议 schema 快照为 **0.167.0**（Git tag `rust-v0.167.0`）；对应文件位于 [`../vendor/codex-app-server/0.167.0/`](../vendor/codex-app-server/0.167.0/)。实现不凭猜测使用未验证的内部格式；每个下载的 runtime 都必须通过 SHA-256、文件结构、版本输出和 JSON-RPC smoke test。

`0.153.0` 快照仍保留在 vendor 目录中，作为历史参考。运行时更新仍由受管 manifest 根据 GitHub stable release 动态检查，schema 快照版本不代表运行时被永久固定在该版本。

- 官方文档：<https://learn.chatgpt.com/docs/app-server>
- 协议原始资料：[`../vendor/`](../vendor/)

runtime 验证失败时服务 fail closed；浏览器只访问 Owner WebSocket Gateway，不直接连接 App Server；Owner WS 与外围 HTTP 契约见 [`../api/README.zh-CN.md`](../api/README.zh-CN.md)。
