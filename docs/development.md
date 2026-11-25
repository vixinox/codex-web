# 本地开发

## 环境与启动

- Node.js 20.19+ 或 22.12+，pnpm，以及 `better-sqlite3` 支持的平台。
- `pnpm install` 安装 workspace 依赖。本机首次运行不要求配置 `.env`。
- 在独立终端运行 `pnpm dev` 和 `pnpm server`；Vite 使用 `5173`，Owner 使用 `3000`。
- 打开 <http://localhost:5173> 或 <http://127.0.0.1:5173>。本机授权由 Owner 校验实际 loopback peer、Host 和 Origin；不要用反向代理或 forwarded headers 扩展该边界。

Owner 默认在 `.data/codex` 创建 `owner.sqlite` 和运行时数据；用 `CODEX_DATA_ROOT` 指定其他数据目录。Thread transcript 属于 Codex Home，不在 Owner SQLite 中。数据库 reset 会删除 Owner 控制面、Passkey 和已登记设备；只有明确需要丢弃这些数据时才运行 `pnpm db:reset`。

## 远程开发

远程访问需要单独部署/运行 Relay 和 Owner shared secret。先阅读[远程访问指南](remote-access.md)，不要把 `RELAY_OWNER_TOKEN` 配置到前端构建环境。

## 代码定位

- 浏览器入口与页面：`packages/app/src/app/entry/`、`composition/`。
- Chat 状态和展示：`packages/app/src/app/chat/session/`、`projection/`、`ui/`。聊天维护规则在该目录的 `AGENTS.md`。
- Owner 业务用例：`packages/server/src/owner/application/`；模块状态所有权与 450 行架构预算见 `packages/server/AGENTS.md`。
- Codex 集成/runtime：`packages/server/src/codex/`。
- Relay 与共享协议：`packages/relay/src/`、`packages/protocol/src/`。

## 检查

受影响包优先运行对应 `pnpm test:*` 命令。全量测试为 `pnpm test`，所有 package 类型检查为 `pnpm typecheck`，lint 为 `pnpm lint`。里程碑使用 `pnpm quality:check` 检查耗时回归；维护和重新校准方式见[测试规范](testing.md)。Server 架构范围检查可单独运行 `pnpm lint:architecture`。

TypeScript 格式使用 Oxfmt：`pnpm exec oxfmt --check <touched-ts-files>`。提交前按仓库指引运行 `pnpm lint:staged`。

## App Server schema

运行 `pnpm schema:update` 检查 GitHub 最新 stable，并优先复用匹配版本的本机 Codex CLI generator 或缓存。首次缺少对应 generator 时，脚本会下载并校验官方 CLI；生成结果写入 Git 忽略的 `docs/vendor/codex-app-server/<version>/`。命令只生成 schema，不把上游新 union 成员自动认定为已支持。完整约束和 review 流程见[App Server 文档](app-server/README.md)。
