# Codex App Server 协议入口

项目默认使用 GitHub 最新 stable 的 Codex App Server。实现不凭猜测使用未验证的内部格式；每个下载的 runtime 都必须通过 SHA-256、文件结构、版本输出和 JSON-RPC smoke test。

- 官方文档：<https://learn.chatgpt.com/docs/app-server>
- 协议原始资料：[`../vendor/`](../vendor/)

runtime 验证失败时服务 fail closed；浏览器只访问 Fastify bridge，不直接连接 App Server；REST/SSE 契约见 [`../api/README.zh-CN.md`](../api/README.zh-CN.md)。
