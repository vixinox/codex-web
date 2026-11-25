# 远程访问

远程浏览器经 Relay 连接本机 Owner。Owner 对 Owner 方法和设备授权作最终判断；Relay 只转发端到端加密帧和短期 enrollment reference，不保存 Owner 业务内容。浏览器和 Owner 可以不经 Relay 在同一台机器上通过受限 loopback origin 使用。

## 部署配置

本机开发时不需要这些变量。启用 Relay 开发配置前，可从根目录 `.env.example` 创建本地 `.env`，并分别向 Owner、Relay 和前端构建环境配置下表所列的值；不要将真实 token 提交到仓库。

| 运行位置 | 配置 |
| --- | --- |
| Owner | `CODEX_APP_ORIGIN=https://codex.example.com`、`CODEX_REMOTE_RELAY_URL=wss://relay.example.com/ws`、`RELAY_OWNER_TOKEN` |
| Relay | 与 Owner 完全相同的 `RELAY_OWNER_TOKEN` |
| 前端构建（例如 Cloudflare Pages） | 与 Owner 相同的公开 `CODEX_REMOTE_RELAY_URL` |

`RELAY_OWNER_TOKEN` 至少 32 个字符，必须作为秘密只提供给 Owner 和 Relay。Vite 将公开 Relay URL 编入浏览器 bundle，不会暴露该 token。配置远程 Relay 时 `CODEX_APP_ORIGIN` 必须是 HTTPS origin，不含路径；它也确定远程 WebAuthn RP ID。若不启用远程访问，这些设置都不是本机开发的前置条件。

Owner 仅向 Relay 建立出站 WSS 连接，不监听公网入站服务；TLS 在 Relay 或其反向代理终止。Relay 默认监听 `127.0.0.1:8787`。可按资源需求设置 `RELAY_HOST`、`RELAY_PORT`、`RELAY_MAX_CONNECTIONS`、`RELAY_MAX_CLIENTS_PER_NODE`、`RELAY_MAX_FRAME_BYTES`、`RELAY_MESSAGES_PER_SECOND` 和 `RELAY_MAX_QUEUED_BYTES`。通过 `pnpm --filter @codex-web/relay dev` 启动开发 Relay。

## 连接与恢复

从 Owner 本机或已认证设备生成一次性 enrollment 链接，在远程浏览器打开以登记或复用设备。已知 profile 可静默恢复 session；需要重新认证时可使用 Passkey。新浏览器需要新的 Owner invitation。设备撤销立即移除相应授权；Relay 重启会断开远程连接，但不清理 Owner 或 Codex Home 数据，客户端之后通过 Owner session 与 cursor 恢复。

配置或排查身份、session 和撤销行为时，以[Owner 远程架构](owner-remote-architecture.md)作为详细契约。
