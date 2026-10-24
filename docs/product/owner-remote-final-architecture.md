# Owner 远程控制最终架构

状态：当前总架构基线。实施细节见 [`../impl/01-owner-websocket-backend.md`](../impl/01-owner-websocket-backend.md)，Relay transport 见 [`owner-remote-paseo-architecture.md`](./owner-remote-paseo-architecture.md)，SQLite 见 [`owner-sqlite-refactor-plan.md`](./owner-sqlite-refactor-plan.md)。

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

SQLite 是下一阶段 Owner 控制面持久层目标，负责 session、Project、Credential、current credential 和 Owner event journal。Remote trust、节点密钥和加密密钥保持本地文件/OS secret 边界。Codex Thread transcript 继续由 Codex Home/App Server 负责，Relay 不使用业务数据库。

在 SQLite 切换完成前，现有 PostgreSQL 只作为过渡实现；不得因此恢复 REST/SSE 或改变 Owner WS/Application Services 边界。

## 实施顺序

1. 冻结 `@codex-web/protocol` 的 owner/relay subpath 和 Owner session runtime；
2. 完成 Owner WS、Application Services 和必要外围 HTTP；
3. 删除旧 REST/SSE business routes、HTTP/SSE tunnel 和旧前端 bridge；
4. 将运行单元固定在 `packages/app`、`packages/server`、`packages/relay` 和 `packages/protocol`；
5. 完成 SQLite stores、migration、启动恢复和 PostgreSQL 清理；
6. 接入 Owner RelayTransport、配对、E2EE、远程 session 和远程 cursor recovery；
7. 后续实现 App Owner WS client、文件/终端等扩展流。

## 验收

- 本地和远程客户端使用相同 Owner WS 合同；
- Relay 只能看到连接元数据和密文 payload；
- Owner、Project、Thread、Credential 归属检查在本地和远程一致；
- Credential secret、路径、raw Codex payload 和 stack 不进入协议、日志或 UI；
- Owner 重启后可恢复控制面状态并从 Codex history 恢复 Thread；
- WS 重连与 event cursor recovery 分离，cursor 失效时回退安全 snapshot；
- 旧 trust epoch、撤销设备和无效 session 无法建立业务连接。
