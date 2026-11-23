# Codex Web

Codex Web 是一个运行在本地 Web origin 上、由 Owner 身份保护的单用户 Codex 工作台，支持桌面和移动端访问。本机浏览器通过受限 loopback 来源直接使用；远程浏览器通过 Relay 和已登记设备访问。

浏览器通过 Fastify Owner WebSocket 访问本机 Gateway；Owner 负责远程认证、runtime、workspace、history 和 Agent 控制。本机访问依赖服务端验证的 loopback peer、Host 与 Origin，不使用本地登录凭据；远程访问仍需设备授权和有效 session。浏览器不接收 API key 或 runtime 进程信息。

![Codex Web 工作区](packages/app/src/assets/codex-web-workspace.png)

## 运行要求

- Node.js 20.19+ or 22.12+
- pnpm
- SQLite（由 Owner 首次启动自动创建）

本项目提供源码、前端构建命令和本地服务启动命令。项目不提供生产环境、数据库托管、反向代理、域名配置或发行分发。

## 本地开发

克隆项目并进入目录：

```bash
git clone https://github.com/vixinox/codex-web.git
cd codex-web
```

本机开发默认无需环境变量。只有需要调整可选配置或启用远程 Relay 时，才复制并编辑环境配置：

```bash
pnpm install
cp .env.example .env
```

首次运行 `pnpm server` 会在默认数据目录 `.data/codex` 创建数据库和单一 Owner 身份；本机访问不要求创建登录凭据。数据库路径可通过 `CODEX_DATA_ROOT` 覆盖。旧数据库结构不会自动迁移，若启动提示需要重建，请停止 Owner 后按提示运行交互式 `pnpm db:reset`。重建会清除 SQLite 控制面数据、Passkey 和已配对设备，保留 Codex Home 历史、工作区文件及 Owner node identity。

Owner 不限制不同线程间的并发任务数。保存的 Credential endpoint 由 Owner 自行选择；Server 不限制 host、网络范围或 scheme，并会向该地址发送 API key。连接验证通过 Node `fetch` 执行，因此最终可用的协议仍取决于 Node fetch 与 Provider 的支持。Codex runtime 使用 `approvalPolicy: never` 与 `sandbox: danger-full-access` 启动，不要求额外确认。请只配置自己信任的 endpoint，并在可信本机环境运行 Owner。

远程控制需要部署 Relay。使用的配置按运行环境分为：

| 环境 | 必需配置 |
| --- | --- |
| Owner | `CODEX_APP_ORIGIN=https://codex.example.com`、`CODEX_REMOTE_RELAY_URL=wss://relay.example.com/ws`、`RELAY_OWNER_TOKEN` |
| Relay | 与 Owner 相同的 `RELAY_OWNER_TOKEN` |
| 前端构建（如 Cloudflare Pages） | 与 Owner 一致的 `CODEX_REMOTE_RELAY_URL` |

Owner 和前端构建环境中的 Relay URL 值相同，但需要分别配置；Vite 只把这个公开 URL 注入浏览器 bundle，不暴露 Owner token。`RELAY_OWNER_TOKEN` 至少 32 字符，必须作为秘密配置在 Owner 与 Relay 两边。`CODEX_APP_ORIGIN` 必须是 HTTPS origin（不带路径）；配置 Relay 时 Owner 会拒绝缺少该值或 HTTP 值。Owner 只作为出站 WSS 客户端连接 Relay，不开放公网入站端口；TLS 在 Relay 或前置反向代理处终止。Relay 只做连接转发，不保存业务状态：重启会断开全部远程设备，Owner 连接短时中断不影响本地使用，客户端重连后由 Owner 的 snapshot/cursor 恢复 session 和事件状态。健康检查端点 `/healthz` 只返回 `{status, protocolVersion, connections}`，不含 node 或设备标识。Relay 默认监听 `127.0.0.1:8787` 并限制连接与缓冲资源，可覆盖 `RELAY_HOST`、`RELAY_PORT`、`RELAY_MAX_CONNECTIONS`、`RELAY_MAX_CLIENTS_PER_NODE`、`RELAY_MAX_FRAME_BYTES`、`RELAY_MESSAGES_PER_SECOND` 和 `RELAY_MAX_QUEUED_BYTES`。服务以 `pnpm --filter @codex-web/relay dev` 启动。

从旧配置升级时，将 Owner 上的 `CODEX_REMOTE_RELAY_OWNER_TOKEN` 改名为 `RELAY_OWNER_TOKEN`，并删除 `VITE_CODEX_REMOTE_RELAY_URL`；前端构建现在从 `CODEX_REMOTE_RELAY_URL` 读取 Relay 地址。

在两个终端分别启动 Vite 和 Owner 服务：

```bash
pnpm dev
pnpm server
```

打开 <http://localhost:5173> 或 <http://127.0.0.1:5173> 即可进入本机工作台。远程设备须由本机 Connection 设置或 CLI 生成一次性登录链接加入。

## 构建

```bash
pnpm build
```

该命令执行 TypeScript 构建检查并生成 Vite 前端产物。

## 常用检查

```bash
pnpm typecheck
pnpm test
pnpm test:core
pnpm test:frontend
pnpm test:server
pnpm exec oxfmt --check "**/*.{ts,tsx}"
```

`pnpm test` 是全仓测试入口，覆盖 Server、Protocol、Relay、Conversation、Telemetry 和 App。
日常改动优先运行受影响包的测试；`pnpm test:core` 是核心 Server/Protocol/Relay 的快速入口。
测试分层、清理规则和新增测试约束见 [`docs/testing.md`](docs/testing.md)。

## 文档

- [架构与安全边界](PROJECT.md)
- [Owner 远程架构](docs/owner-remote-architecture.md)
- [API 契约](docs/api/README.zh-CN.md)
- [前端边界与数据流](docs/frontend/README.zh-CN.md)
- [App Server 协议资料](docs/app-server/README.md)
