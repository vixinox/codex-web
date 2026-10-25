已实现行为：
- 完成 05A 服务端认证合同、05B 远程入口基础设施、05C 浏览器设备密钥基础设施和 05D 本机 Owner 管理路由。
- 移除新设备邀请 method，保持 05 范围不引入邀请路径。

新增/修改接口：
- Better Auth twoFactor、pending/provisional remote admission、Owner 管理 RPC 与 remote device lifecycle methods。

修改文件：
- 见 `05A-implementation-notes.md`、`05B-implementation-notes.md`、`05C-implementation-notes.md`、`05D-implementation-notes.md`。

验证命令与结果：
- server tests：84 通过。
- protocol tests：16 通过。
- app remote focused tests：3 通过。
- 新增 TypeScript 文件 `oxfmt --check` 与 `pnpm lint:staged` 通过。

未解决问题：
- 完整 app typecheck 仍被既有缺失 bridge 模块阻断；需要后续工作包恢复或迁移这些旧业务 adapter。
- Relay/浏览器真实部署验收需要用户启动 Vite、Owner 和 Relay 服务。

下游必须遵守的约束：
- 05 不实现新设备邀请、Relay 账户或 Chat/Workspace/Settings 全量迁移。
