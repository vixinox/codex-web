# 06 Owner 前端运行时 Work Package

## 1. 状态与启动指引

- 状态：Ready for implementation
- 目标：把 05 的最小 remote client、Owner 管理页和现有业务 bridge 统一到一个 Owner 前端运行时。
- 前置：05 已提交为 `cfb2a8f`，自动化 focused checks 已通过；真实远程浏览器链路仍未完成验收。
- 先读：
  - [`05-finalization-and-06-direction.md`](./05-finalization-and-06-direction.md)
  - [`../owner-remote-architecture.md`](../owner-remote-architecture.md)
  - [`../api/README.zh-CN.md`](../api/README.zh-CN.md)
  - [`../frontend/README.zh-CN.md`](../frontend/README.zh-CN.md)
  - `packages/protocol/src/owner/index.ts`
  - `packages/server/src/owner/session-runtime.ts`
  - `packages/server/src/owner/methods.ts`

06 不重新定义 Owner、Relay、E2EE、TOTP、trust epoch 或设备撤销语义。新实现必须消费 05 已提供的服务端合同。

## 2. 问题与用户模型

用户应当只感知一个 Owner 工作台。这个工作台可以通过本机 WebSocket 或远程 Relay/E2EE 连接到同一个 Owner Gateway；连接方式不应改变 Chat、Workspace、Settings 的页面和领域模型。

用户操作的运行时路径为：

```text
App entry
  -> Owner runtime
  -> local WS or remote Relay/E2EE admission
  -> Owner session/auth state
  -> domain adapter
  -> domain state/reducer
  -> UI-facing model
  -> renderer
```

连接断开不会自动取消已经接受的 Turn。读取操作可以在新连接上恢复，mutation 不自动重试。事件恢复必须使用 status、cursor、snapshot 和 reset 合同。

## 3. 当前实现事实

- Owner protocol 已支持 `hello`、`ready`、`request`、`response`、`stream.open`、`stream.event`、`stream.close`、`cancel` 和 `close`。
- Server 已提供 `owner.session.open`、业务 Owner methods、`events.subscribe` 和 `events.resume`。
- 05 的 `packages/app/src/lib/owner-ws/owner-management-client.ts` 只实现管理页用的 request/response，未实现统一 stream、cancel、重连、resume 或状态模型。
- 05 的 bootstrap 解析和 fragment 清除已存在，但当前 App 没有消费 `getRemoteBootstrap()` 来建立 Relay/E2EE 连接。
- `createDeviceKey()` 和 `loadDeviceKey()` 已存在，但当前 App 没有将其接入远程 admission 流程。
- 05 的 paired `clientToken` 尚未与设备密钥一起持久化，页面刷新后无法恢复 paired admission。
- 当前 `packages/app/src/lib/bridge` 缺失多个仍被业务页面引用的模块，包括旧 HTTP、SSE、thread adapter 和 domain adapter。
- 当前 transcript/session/presentation 边界已存在，迁移时应复用，不把 Owner raw frame 或 Codex native payload 交给 renderer。

## 4. 已冻结决策与不变量

### D-01 Owner runtime 所有权

App 级 runtime controller 持有 active Owner connection。Chat、Workspace、Settings 和 Owner Manage 只能通过 domain adapter 使用它，页面不得自行创建 WebSocket 或组装 Owner frame。

### D-02 状态分层

运行时状态分为三层：

```text
transport:
  disconnected | connecting | connected | reconnecting | failed

authentication:
  unknown | unauthenticated | pending_binding | pending_totp |
  authenticated | expired | revoked

runtime:
  idle | resuming | ready | blocked | failed
```

网络断线、session expired、device revoked 和 trust reset 必须投影为不同状态。

### D-03 凭据生命周期

- `sessionToken` 只在 runtime 内存中使用。
- provisional bootstrap token 只在当前 bootstrap 流程内存中使用，fragment 消费后立即清除地址栏。
- paired `clientToken` 与当前设备的不可导出 `CryptoKey`、公钥 metadata、`deviceId` 和 `trustEpoch` 一起存 IndexedDB。
- 不得使用 `localStorage`、URL、日志、错误、React state 序列化结果或服务端请求保存私钥。
- revoke、trust reset、trust epoch 不匹配、密钥损坏或 admission 失败时清理 paired token 和本地设备引用。

### D-04 重试

只自动重试幂等读取。`threads.send`、`threads.cancel`、凭据创建、项目删除、审批和其他 mutation 在断线后不得自动重放；controller 必须返回明确错误或重新读取状态。

### D-05 Stream 与 cursor

Owner WS 通用层负责 stream 生命周期、取消和连接清理。领域 adapter 负责 subscription、cursor、snapshot、reset、事件去重和恢复：

1. 断线后读取 Thread status；
2. cursor 可恢复时调用 `events.resume`；
3. cursor 过期、epoch 不匹配或收到 `events.reset` 时读取安全 snapshot；
4. 重新订阅并以事件 ID 去重。

### D-06 迁移策略

旧 bridge 只允许在对应领域迁移完成前短期存在。新代码不得新增旧 HTTP/SSE 依赖；领域 focused tests 通过后立即删除旧 adapter。

### D-07 远程 client 范围

远程 App admission client 是 06B 的必做范围，不得推迟到 Chat 迁移之后。06B 必须形成可执行的 bootstrap、provisional、TOTP/approval、trust、paired reconnect 闭环。

### D-08 连接切换

一个 App runtime 只维护一个 active Owner connection。本地与远程切换时关闭旧 runtime，新连接建立后重新读取安全 snapshot 和 runtime status；不做双连接双写或跨连接业务同步。

### D-09 页面结构

本地与远程共用同一应用壳和领域 renderer，不新增 `/remote/*` 页面树。认证和连接阶段由 runtime model 控制页面可用状态。

### D-10 清理

06E 删除不再使用的业务 HTTP/SSE bridge。保留 health、metadata、bootstrap、配对发现等外围 HTTP；不新增业务 REST tunnel。

## 5. 领域模型与状态所有权

`OwnerRuntime` 是唯一的 transport/session 状态源，至少提供：

```ts
type OwnerRuntime = {
  state: OwnerRuntimeState
  request(method: string, params?: unknown, options?: RequestOptions): Promise<unknown>
  openStream(request: StreamRequest, handlers: StreamHandlers): StreamHandle
  cancelRequest(requestId: string): void
  cancelStream(streamId: string): void
  connect(target: OwnerTarget): Promise<void>
  close(reason?: string): void
  subscribe(listener: () => void): () => void
}
```

具体命名可以按现有代码风格调整，但必须保留这些职责边界：

- transport 不知道 Thread presentation；
- domain adapter 不拼接 wire frame；
- reducer 不保存 token、私钥、绝对路径或原始错误 payload；
- renderer 只消费 UI-facing model；
- runtime 关闭时拒绝所有 pending request、关闭 stream 并清理定时器。

设备记录至少需要支持：

```ts
type DeviceKeyRecord = {
  deviceId: string | null
  publicKey: string
  privateKey: CryptoKey
  pairedClientToken: string | null
  trustEpoch: number | null
}
```

旧记录缺少 paired 字段时必须按未配对记录处理，不得假设已有 admission 能力。

## 6. Owner WS 接口合同

通用 transport 必须覆盖：

- 首帧 `hello` 和 `ready`；
- request/response 的 request ID 分配、重复 ID、超时和错误投影；
- `stream.open/event/close` 与 request 的关联；
- request 和 stream 的显式 cancel；
- close/error 时拒绝所有 pending Promise；
- session resume 和认证失败投影；
- 连接建立、断开、重连和关闭的生命周期通知。

Mutation 在发送后断线时的结果可能未知。runtime 不得根据连接重建自动重放该 mutation；领域 controller 应重新读取权威状态。

## 7. 05 Review 必须纳入的修复

### 7.1 远程 App admission client 缺失

当前 `getRemoteBootstrap()`、`relayUrl`、`clientToken`、`createDeviceKey()`、`loadDeviceKey()` 没有进入可执行连接路径。06B 必须补齐：

- bootstrap data 注入 Owner target；
- device key 创建、恢复和损坏清理；
- Relay attach、E2EE handshake 和 Owner WS admission；
- provisional `owner.session.open`；
- `remote.device.binding.verifyTotp` / recovery code；
- `remote.device.trust` challenge/consume/promotion；
- promotion 后关闭 provisional connection，再用 paired admission 重连；
- paired、expired、revoked、trust reset 和 offline 状态投影。

### 7.2 paired client token 未持久化

trust 成功返回的 paired `clientToken` 必须写入 IndexedDB，与 `deviceId` 和 `trustEpoch` 一起原子更新。旧 token 必须在以下情况清除：

- device revoke；
- trust reset；
- trust epoch 不匹配；
- paired admission 被服务端拒绝；
- CryptoKey 恢复失败或记录损坏；
- 用户显式退出设备信任。

这项持久化不能扩展为 session token 或私钥导出机制。

## 8. 实施里程碑

### 06A-0：接口和纯逻辑冻结

范围：定义 Owner runtime、connection target、状态模型、request error、stream handle、cancel 和 cleanup 合同。

入口：`packages/app/src/lib/owner-ws/*`、`packages/protocol/src/owner/*`。

验收：纯逻辑测试覆盖 request/response、stream、cancel、duplicate ID、timeout、close rejection 和错误投影。

### 06A-1：Owner WS transport

范围：把管理页专用 client 提升为通用 transport；实现 stream、cancel、生命周期、session token resume 和关闭清理。

入口：`packages/app/src/lib/owner-ws/*`、`packages/app/src/app/entry/*`。

验收：管理页不再直接拥有 transport；Owner WS 关闭时没有悬挂 Promise；本地连接可重新建立。

### 06A-2：连接/session controller

范围：实现 transport/auth/runtime 三层状态、重连退避、认证失败、session expired、offline 和 active connection 切换。

验收：读取可恢复，mutation 不自动重放；连接切换后重新 hydrate；状态变化可被 React controller 订阅。

### 06B：认证与远程状态统一

范围：接入 bootstrap、设备密钥、Relay/E2EE、provisional login、TOTP/recovery、trust promotion、paired token 持久化和管理页 adapter。

入口：`packages/app/src/lib/remote/*`、`packages/app/src/lib/owner-ws/*`、`packages/app/src/app/owner/*`、`packages/app/src/app/entry/*`。

验收：真实浏览器完成 bootstrap 清除、密码登录、TOTP 或本机批准、paired 重连、刷新后 paired admission、撤销、trust reset、Relay 断线和 IndexedDB 清除后的重新配对。

### 06C：Chat/Thread/Turn 迁移

范围：将 thread list/read/status/create/send/cancel/compact、events、approval、question 迁移到 Owner domain adapters；复用现有 thread session/reducer/presentation。

入口：`packages/app/src/app/chat/*`、`packages/app/src/lib/bridge/interfaces/*`、`packages/app/src/app/chat/session/*`。

验收：snapshot、history replay、cursor resume、reset hydrate、事件去重、turn cancel、approval 和 user input focused tests 通过；删除对应旧 HTTP/SSE adapter。

### 06D：Workspace/Settings 迁移

范围：迁移 projects、credentials、configuration、skills、codex lifecycle 和设置页。

入口：`packages/app/src/app/workspace/*`、`packages/app/src/app/settings/*`、各 domain adapter。

验收：页面只通过 Owner methods 工作；保留外围 HTTP；旧领域 bridge 删除。

### 06E：清理与全量回归

范围：删除未使用的业务 HTTP/SSE bridge，修复所有缺失 bridge import，统一测试和文档状态。

验收：全量 `pnpm typecheck`、相关 package tests、`oxfmt --check`、`pnpm lint:staged` 和用户启动服务后的手工回归通过。

## 9. 明确非目标

- 不新增 Guest、多 Owner、Relay 账户或离线业务队列；
- 不改变 Codex App Server 的执行权威；
- 不把业务方法放回 Relay；
- 不新增业务 REST tunnel；
- 不重新设计 TOTP、recovery code、trust epoch、设备撤销或 Owner 权限边界；
- 不在 06 中重写 transcript renderer 的视觉架构；
- 不保留长期 HTTP/SSE 与 Owner WS 双轨业务实现。

## 10. 验证命令与手工验收

每个里程碑按影响范围运行最小验证：

```text
pnpm --filter @codex-web/protocol test
pnpm --filter @codex-web/app test
pnpm typecheck
pnpm exec oxfmt --check <修改的 TypeScript 文件>
pnpm lint:staged
```

涉及 server/relay 合同时追加对应 package tests。UI 接受使用用户启动的 Vite、Owner 和 Relay 服务进行手工浏览器回归，不新增 React DOM、Playwright 或截图测试。

最终手工路径必须覆盖：

- local Owner connection 和 session resume；
- bootstrap fragment 清除；
- remote provisional login、TOTP/recovery 和本机批准；
- paired admission、页面刷新后的恢复和 Relay 断线重连；
- session expired、device revoke、trust reset；
- IndexedDB 不可用、CryptoKey 损坏和重新 bootstrap；
- Chat snapshot/cursor/reset、turn cancel、approval 和 question；
- Workspace/Settings 的 Owner WS 读写路径。

## 11. 冷启动执行顺序

新 session 开始前必须：

1. 阅读本文件和 05 最终提交 `cfb2a8f`；
2. 运行 `git status --short --branch` 并阅读当前 WIP；
3. 盘点 `packages/app/src/lib/bridge` 的缺失 import；
4. 先完成 06A-0 的接口和 focused tests；
5. 在 06B 先补齐本文件第 7 节的两个 P1；
6. 每个领域迁移完成后删除旧 adapter，再进入下一个领域；
7. 不把 05 的安全语义作为 06 的重设计对象。

## 12. 未决事项

没有阻塞 06 开始的架构决策。实现时只允许在以下边界内做局部选择：

- `OwnerRuntime` 的具体 TypeScript 命名；
- 重连退避的具体时间参数；
- 各领域 adapter 的目录组织；
- UI-facing error 文案和 loading 状态的具体呈现。

这些选择不得改变第 4 节的冻结不变量。
