# Codex Web

Codex Web 是一个运行在本地 Web origin 上的 Codex 工作台。它提供完整能力的 Owner 工作区，以及隔离、限时、受限能力的 Guest 工作区，支持桌面和移动端访问。

浏览器通过 Fastify bridge 使用 REST/SSE；Owner 与 Guest 使用独立的认证、runtime、workspace、history 和控制 API。浏览器只接收安全投影，不接收 API key、宿主机路径或 runtime 进程信息。

![Codex Web 工作区](src/assets/codex-web-workspace.png)

## 运行要求

- Node.js 18+
- pnpm
- PostgreSQL（可通过 Docker Compose 提供本地实例）
- Windows 使用 Guest 时，需要先完成 Windows sandbox 配置

本项目提供源码、前端构建命令和本地服务启动命令。项目不提供生产环境、数据库托管、反向代理、域名配置或发行分发。

## 本地开发

克隆项目并进入目录：

```bash
git clone https://github.com/vixinox/codex-web.git
cd codex-web
```

启动本地 PostgreSQL：

```bash
docker compose up -d postgres
```

也可以使用已有 PostgreSQL，在 `.env` 中将 `DATABASE_URL` 设置为已有连接地址。然后安装依赖并复制环境配置：

```bash
pnpm install
cp .env.example .env
pnpm db:push
```

编辑 `.env`，确认 `DATABASE_URL`、`BETTER_AUTH_SECRET`、`BETTER_AUTH_URL` 和 `BETTER_AUTH_TRUSTED_ORIGINS`，并按使用场景填写 Owner credential 与 Guest 配置。

在两个终端分别启动 Vite 和 Owner 服务：

```bash
pnpm dev
pnpm server:owner
```

打开 <http://localhost:5173>。需要 Guest 时，在另一个终端启动：

```bash
pnpm server:guest
```

Windows 首次运行 Guest 前执行：

```powershell
.\setup-windows-sandbox.ps1
```

Owner 和 Guest 是两个独立进程，不能用一个 combined server 命令替代。

## 构建

```bash
pnpm build
```

该命令执行 TypeScript 构建检查并生成 Vite 前端产物。

## 常用检查

```bash
pnpm typecheck
pnpm test
pnpm test:frontend
pnpm test:bridge
pnpm exec oxfmt --check "**/*.{ts,tsx}"
```

## 文档

- [架构与安全边界](PROJECT.md)
- [API 契约](docs/api/README.zh-CN.md)
- [前端边界与数据流](docs/frontend/README.zh-CN.md)
- [App Server 协议资料](docs/app-server/README.md)
