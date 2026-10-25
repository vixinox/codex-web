已实现行为：
- 应用启动时消费官方 remote bootstrap URL fragment，并立即清理地址栏。
- 增加受限远程认证状态与方法权限投影，阻止 pending session 访问 Owner 业务。
- 增加浏览器设备密钥 IndexedDB 存储和清理接口；私钥保持为不可序列化 CryptoKey 引用。

新增/修改接口：
- `consumeRemoteBootstrap`、`clearRemoteBootstrapAddress`
- `canInvokeRemoteMethod`
- `createDeviceKey`、`loadDeviceKey`、`setDeviceId`、`clearDeviceKey`

修改文件：
- `packages/app/src/app/entry/bootstrap.tsx`
- `packages/app/src/lib/remote/*`

验证命令与结果：
- `pnpm --filter @codex-web/app test -- src/lib/remote/bootstrap.test.ts` 通过
- `pnpm exec oxfmt --check ...` 通过
- `pnpm lint:staged` 通过

未解决问题：
- 完整 app typecheck 仍受仓库既有缺失 bridge 模块阻断。

下游必须遵守的约束：
- bootstrap token 只存在于短期 controller 输入，不写入 localStorage、URL 之外的持久化或日志。
- paired admission 必须在 trust 成功后断开 bootstrap 连接并重新建立。
