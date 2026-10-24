# Owner SQLite 持久层重构计划

状态：Owner WS 架构之后的下一阶段持久层实施计划。总架构见 [`owner-remote-final-architecture.md`](./owner-remote-final-architecture.md)，Relay transport 见 [`owner-remote-paseo-architecture.md`](./owner-remote-paseo-architecture.md)。

## 目标

将 `packages/server` 的 Owner 控制面从 PostgreSQL 改为单进程 SQLite，同时保持 Owner WS、Application Services、Codex App Server 和 Relay 边界稳定：

- 单一认证 Owner、email/password 和 session 生命周期保持不变；
- Project、Credential、current credential 和 Owner event journal 可跨 Owner 重启恢复；
- Codex Thread transcript 仍由 Codex App Server/Codex Home 负责；
- Relay 不连接 SQLite、不保存业务数据；
- Owner 核心业务继续只通过 WS 暴露。

本阶段不导入现有 PostgreSQL 数据。首次启动创建新的 SQLite 文件并通过 Owner bootstrap 创建账户。

## 存储边界

```text
packages/server
  +-- Better Auth / SQLite
  +-- Project / Credential / Owner configuration
  +-- SQLite Owner event journal
  +-- Codex App Server / Codex Home (Thread authority)
  +-- remote trust files / credential encryption key
```

SQLite 文件位于 `CODEX_DATA_ROOT/owner.sqlite`，不放入静态资源目录。节点密钥、配对状态和 Credential 加密密钥继续遵循独立文件或 OS secret 边界。

SQLite 保存安全投影和 Owner 自有事件，不复制完整 Codex transcript，也不保存原始 runtime payload、API key 明文或路径敏感信息。

## 技术合同

- 使用 Better Auth SQLite adapter 和 Drizzle SQLite dialect；
- 使用版本化 migrations，Owner 监听前完成目录创建、打开、pragma 和 migration；
- 单 Owner 进程串行写入，启用外键和适合本地单写者的 busy timeout；
- EventStore 保持 `append-before-publish`、Owner/Thread 查询、cursor 和 retention 语义；
- migration、打开、写入或恢复失败时 Owner 不监听，错误必须脱敏；
- 不保留 PostgreSQL fallback，不从旧 PostgreSQL 导入数据。

## 实施阶段

1. 在 `packages/server/src/db` 建立 SQLite schema、driver 和 migrations；
2. 改造 Auth、Workspace、Credential store 和 EventStore，移除 PostgreSQL 类型；
3. 更新 Owner 启动/关闭生命周期，确保所有 store 准备完成后才监听；
4. 删除 `pg`、`DATABASE_URL`、`DATABASE_SSL`、Docker PostgreSQL 路径和旧 reset 脚本；
5. 更新 README、配置、诊断命令和本地数据保护说明；
6. 保持 `@codex-web/protocol/owner`、Relay transport、Codex adapter 和前端 WS client 合同不变。

## 测试与验收

- 空目录创建 SQLite、执行 migration、重复启动幂等；
- Auth session、Project、Credential 和 current credential 重启恢复；
- EventStore append/load/retain/cursor 与现有语义一致；
- Owner 归属、外键、敏感信息脱敏和写入失败 fail-closed；
- Owner WS、Relay 和 Codex focused tests 不需要改业务合同；
- 全新环境无需 PostgreSQL 即可启动 Owner，并完成 bootstrap、WS login、Thread/Turn 和重启恢复。
