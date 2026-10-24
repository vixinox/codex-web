# Paseo 基准的 Relay Transport 专题

状态：总架构的专题文档。Owner 业务协议和持久层决策分别见 [`owner-remote-final-architecture.md`](./owner-remote-final-architecture.md) 和 [`owner-sqlite-refactor-plan.md`](./owner-sqlite-refactor-plan.md)。

## 边界

Owner Gateway 是身份、业务、Agent、Thread、事件和历史的唯一边界。Relay 是不可信的连接转发层，不保存业务数据，不解析 Owner method，也不连接 Owner 数据库。

```text
Remote Client
    | E2EE WebSocket
    v
Relay
    | opaque encrypted payload
    v
Owner RelayTransport -> Owner Gateway session runtime
```

本地客户端直接连接 Owner Gateway。远程客户端完成 Relay attach、设备配对、ECDH handshake 和 trust epoch 校验后，进入同一个 Owner session runtime。远程和本地使用完全相同的 `@codex-web/protocol/owner` 业务 frame。

## Protocol package

`@codex-web/protocol` 是共享 workspace package，但通过 subpath 保持职责隔离：

- `@codex-web/protocol/owner`：Owner request/response/stream/cancel/error 合同；
- `@codex-web/protocol/relay`：attach、pairing、handshake、encrypted 和 connection lifecycle；
- `@codex-web/protocol/relay/crypto`：ECDH、session key 和 AES-GCM payload。

Relay 只依赖 `relay` subpath。Owner Gateway 只依赖 `owner` subpath；Owner RelayTransport 在边界处同时使用两者。

## Relay 责任

- 按 `nodeId`、角色和 `connectionId` 路由 Owner 与控制端；
- 处理连接替换、断开、重连、heartbeat 和背压；
- 转发 opaque E2EE payload；
- 输出脱敏连接级日志和指标；
- 不读取账户、session、Credential、Thread、事件或业务正文。

Relay 重启只导致连接重建，不影响 Owner 数据和历史。Relay 不使用 Better Auth、SQLite、PostgreSQL 或其他业务持久化。

## Owner RelayTransport 责任

Owner 进程主动连接 Relay，处理 attach/ready、重连、远程虚拟连接、pairing、trust epoch、session key 和 transport 生命周期。解密后的 Owner frame 直接交给 Gateway，不转换为 HTTP request/reply 或 SSE。

信任重置必须轮换 Owner 信任根、清空已授权控制端、关闭旧连接并拒绝旧 epoch，同时保留 Owner 本地业务历史。

## 实施顺序

1. 完成 `@codex-web/protocol/relay` 的 frame parser 和 crypto 测试；
2. 验证无持久化 Relay 的 attach、路由、替换、断开和重连；
3. 实现 Owner RelayTransport 与 Gateway 的 transport attachment；
4. 完成 pairing、ECDH、trust epoch 和远程 Owner session admission；
5. 验证远程 Thread/Turn/approval/question/cursor 恢复使用 Owner WS 合同。

不得恢复 HTTP/SSE tunnel，也不得让 Relay 解释 Owner method。
