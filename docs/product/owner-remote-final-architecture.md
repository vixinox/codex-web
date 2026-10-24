# Owner 远程控制最终架构

状态：当前总架构基线。Relay transport 专题见 [`owner-remote-paseo-architecture.md`](./owner-remote-paseo-architecture.md)。

## 最终决策

- Codex App Server 是 Agent、Thread、Turn 和 Codex 原生历史的执行权威。
- Owner Gateway 是本机唯一客户端边界，负责认证、授权、资源归属和协议版本。
- Web、桌面和移动端统一使用 Owner WebSocket 业务协议。
- 本地客户端直接连接 Gateway；远程客户端通过 Relay E2EE transport 接入同一个 session runtime。
- Relay 只处理连接生命周期和 opaque encrypted payload，不解析 Owner method、JSON-RPC、身份或业务内容。
- HTTP 只保留 health、metadata、bootstrap、配对发现、文件传输和明确的外部集成。
- Owner 只支持一个本地 Owner 节点及其远程控制端。

## Workspace 结构

```text
packages/app             Web UI and Owner WS client
packages/server          Owner Gateway, services, Codex adapter and stores
packages/relay           Relay runtime and connection router
packages/protocol        owner/ and relay/ protocol subpaths
```

`@codex-web/protocol/owner` 与 `@codex-web/protocol/relay` 共享 package metadata，但保持显式代码和 exports 隔离。Server、App、Relay 不通过相对路径跨 package 读取源码。

## 链路

```text
Local Client -> Owner Gateway -> Application Services -> Codex App Server

Remote Client -> Relay -> Owner RelayTransport -> Owner Gateway
```

本地 WebSocket 与 Relay data socket 都实现 transport-neutral `OwnerTransport`，进入同一个 `OwnerSessionRuntime`。Gateway 不复制 Project、Credential、Thread 或 Codex 业务规则，只调用 Application Services 并投影安全 DTO。

## Application Services

Application Services 是业务唯一入口，负责 Owner session、Credential、Project/Workspace、Thread/Turn、审批、用户问答、事件 cursor、配置、配对和 trust reset。Service 不导入 Fastify request/reply/socket、Relay socket 或数据库具体类型。

Codex adapter 只负责 App Server 进程、JSON-RPC、模型目录、Thread ownership 和安全事件投影；它不负责 Owner session、设备信任或 Relay 权限。

## Protocol

Owner protocol 使用 `hello`、`ready`、`request`、`response`、`notification`、`stream.*`、`cancel` 和 `close`。Relay protocol 使用 attach、pairing、handshake、encrypted 和 connection lifecycle frame。Relay protocol 不包含 HTTP/SSE tunnel frame。

Owner method 的认证、资源归属、错误投影、stream、背压、cursor 和断开语义由 Gateway 统一处理。连接断开不会隐式取消已经接受的 Turn。

## 持久化

Owner 控制面使用位于 `CODEX_DATA_ROOT/owner.sqlite` 的本地 SQLite，持久化认证 session、Project、Credential、current credential 和安全投影后的 Owner event journal。数据库初始化与 migration 在 Owner 开始监听前完成；无法安全初始化或恢复时 Owner 不提供服务。

Remote trust、节点密钥和 Credential 加密密钥保持在本地文件或 OS secret 边界。Codex Thread transcript 继续由 Codex Home/App Server 管理；SQLite 不保存原始 runtime payload、API key 明文或宿主路径，Relay 不使用 Owner 业务数据库。
