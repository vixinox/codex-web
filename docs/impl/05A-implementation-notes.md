已实现行为：
- Better Auth 启用 TOTP twoFactor 插件，使用安全的 recovery code 存储与单次消费能力。
- 临时 bootstrap session 在 Owner runtime 层限制为状态、登录、设备信任及绑定相关方法；不能访问业务方法。
- 删除远程设备邀请 method，避免重新引入 05 明确排除的新设备邀请路径。

新增/修改接口：
- Better Auth `enableTwoFactor`、`verifyTotp`、`generateBackupCodes` 等 twoFactor API 现在可用。
- 现有 `owner.session.open` 与 `remote.device.trust` 继续作为临时绑定入口。

修改文件：
- `packages/server/src/auth.ts`
- `packages/server/src/db/schema.ts`
- `packages/server/src/owner/session-runtime.ts`
- `packages/server/src/owner/methods.ts`

验证命令与结果：
- `pnpm --filter @codex-web/server typecheck` 通过。

未解决问题：
- pending binding status/approve/verifyTotp 的业务 adapter 仍需在远程入口和本机管理页工作包中接入。
- 现有数据库需要执行 schema migration 以创建 twoFactor 表和 user.twoFactorEnabled 字段。

下游必须遵守的约束：
- bootstrap provisional transport 永远只能调用受限方法；信任成功后必须断开并用 paired admission 重连。
- 不得重新注册 `remote.device.invite`。
