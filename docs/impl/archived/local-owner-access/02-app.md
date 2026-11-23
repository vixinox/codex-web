# 02 本机工作台入口与单一 Passkey 设置

状态：完成并验证；依赖01接口。先读 [主规格](README.md)，不自行发明兼容字段。

目标：本机直接进入工作台，只有远程登录页和一项 Passkey 设置。范围是 App入口/runtime/controller/Connection/导航；不重做登录页视觉，不增加页面或认证协议。

## 已验证入口与改动责任

- `app/composition/screens/startup-screen.tsx`：更新可选 `/startup` 快速开始步骤，不能再要求用户创建本地 Owner 账户；说明启动 Owner 与 App 后本机直接进入工作台。
- `app/entry/route-components.tsx`、`app-router.tsx`：本机路由直接连接，从ready取得Owner身份；远程仍依赖profile，`/app/enroll`继续复用现有LoginScreen。
- `lib/owner-ws/{owner-runtime,runtime-controller,use-owner-runtime}.ts`：投影ownerId与认证状态，连接状态不能单独授予ready；桥接发布与workspace bootstrap共用该条件。等待中的session恢复不能发业务请求；拒绝认证后不能继续显示工作台。
- `lib/auth/auth-client.ts`：删除；`app/entry/auth-expiry-handler.tsx`删本地bearer分支。本地来源校验失败显示连接错误，不重定向登录；远程失效只清当前profile。
- `app/composition/screens/login-screen.tsx`、`lib/remote/admission.ts`：删本地Passkey登录；Passkey只服务remote；严格解析固定`next=connection`，成功后导航既有Connection页，非法next失败关闭、不消费邀请。
- `app/settings/connection/connection-{model,client,screen}`：用单一passkeyAvailable/appOrigin；删ticket与local/remote行。本机设置按钮复用邀请打开远程设置，所有邀请QR/URL用服务端appOrigin；复制与阻止弹窗fallback复用现有控件。
- `app/composition/navigation/workspace-navigation.tsx`、`app/workspace/sidebar/workspace-sidebar.tsx`：只远程提供退出动作，无onSignOut时不渲染按钮。其余远程退出/移除语义不扩展。

本机origin判断集中在一个已有合适的纯逻辑模块或很小的helper，禁止各组件自行猜测。旧storage/profile/query不得将本机工作台切到Relay；远程缺profile不得创建直连Owner socket。

## 验收与验证

- 自动测试只保护纯逻辑、transport/controller与已有存储边界，不新增renderer/DOM/Playwright测试。
- 更新ready fixtures；聚焦`pnpm --filter @codex-web/app exec vitest run src/lib/owner-ws/owner-runtime.test.ts src/lib/owner-ws/runtime-controller.test.ts src/lib/remote/admission.test.ts src/lib/remote/device-key-store.test.ts src/app/settings/connection/connection-model.test.ts`，加入实际新增的入口纯逻辑测试路径。
- 证明unauthenticated connected不能启动workspace/设置客户端或发布业务bridge；authenticated ready含ownerId后才启动。保留正常断线重连与device_revoked终止测试，不能改动画掩盖错误。
- 配置链接仅使用服务端origin；固定next与普通链接导航分别验证，不能自动唤起Passkey。localhost旧enroll不会消费远程邀请。
- `pnpm typecheck`与触及TS/TSX oxfmt。实施者执行可访问的本机浏览器回归并记录；用户后置验收远程Bitwarden创建、退出/再次登录、取消与邀请失效。无远程配置时本机仍完整可用，设置解释远程尚未配置。

可决定现有组件内文案和私有helper命名；不得增加独立enrollment页面、local登录按钮、配置票据、自动设备撤销或profile迁移。
