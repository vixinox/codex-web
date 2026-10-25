已实现行为：
- 增加受保护的 `/owner/manage` 路由。
- 管理页展示 TOTP 状态、待批准绑定请求和受信任设备，并支持批准、撤销与 trust reset 操作。
- 页面通过本机 Owner method RPC client 访问管理合同，远程 Relay 不参与。

新增/修改接口：
- `OwnerManagementClient`：`getSnapshot`、`approveBinding`、`revokeDevice`、`resetTrust`。
- `createOwnerManagementClient` 映射 `owner.security.status`、`remote.device.binding.approve`、`remote.devices.revoke`、`remote.trust.reset`。

修改文件：
- `packages/app/src/app/owner/owner-management-model.ts`
- `packages/app/src/app/owner/owner-management-client.ts`
- `packages/app/src/app/owner/owner-manage-screen.tsx`
- `packages/app/src/app/owner/owner-management-model.test.ts`
- `packages/app/src/app/entry/app-router.tsx`
- `packages/app/src/app/entry/route-components.tsx`

验证命令与结果：
- 待主 agent 集成后运行 app typecheck、oxfmt 和 focused tests。

未解决问题：
- `/api/owner/method` 由后续 Owner transport 集成提供；管理页已隔离 RPC 边界。

下游必须遵守的约束：
- 管理页只接受 local Owner transport；不要通过 Relay 暴露。
- 不向 UI 暴露私钥、token 或完整公钥材料。
