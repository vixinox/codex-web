# Codex App Server 协议入口

项目锁定 `codex-cli 0.153.0`。实现以锁定版本 schema 为准，不凭猜测实现未验证的内部格式。

- 官方文档：<https://learn.chatgpt.com/docs/app-server>
- 锁定 schema 与原始资料：[`../vendor/`](../vendor/)

修改 CLI 版本时，先生成新的 schema，再同步实现、协议测试和架构基线。浏览器只访问 Fastify bridge，不直接连接 App Server；REST/SSE 契约见 [`../api/README.zh-CN.md`](../api/README.zh-CN.md)。
