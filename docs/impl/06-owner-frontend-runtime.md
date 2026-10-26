# 06 Owner 前端运行时 Work Package

## 1. 状态与启动指引

- 状态：In progress；06A-06E 自动化实现已完成，真实 Owner/Relay 浏览器链路待验收
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

## 3. 06 启动时基线

- Owner protocol 已支持 `hello`、`ready`、`request`、`response`、`stream.open`、`stream.event`、`stream.close`、`cancel` 和 `close`。
- Server 已提供 `owner.session.open`、业务 Owner methods、`events.subscribe` 和 `events.resume`。
- 05 的 `packages/app/src/lib/owner-ws/owner-management-client.ts` 只实现管理页用的 request/response；06 后续将其提升为共享 runtime。
- 05 已提供 bootstrap fragment 消费、设备密钥存储和服务端绑定合同，但当时 App 尚未建立远程 admission client。
- 05 的设备记录当时没有 paired `clientToken`；06 将扩展记录以支持刷新后 paired admission。
- 06 启动时 `packages/app/src/lib/bridge` 有多个仍被页面引用的 HTTP、SSE、thread adapter 和 domain adapter 缺失项。
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

以下是对 `cfb2a8f...HEAD` 的代码 review 发现，仍是当前修复项；不能因为存在基础 helper 或文档计划而视为完成。

### 7.1 [P1] 远程 App admission 主流程未接通

`use-owner-runtime.ts` 可读取 bootstrap、创建设备密钥并建立 Relay socket，但没有调用 `promoteProvisionalDevice()`；该 helper 当前没有调用点。远程用户仍被认证路由导向普通 `/login`，没有可执行的 provisional 登录和 TOTP/recovery 入口。因此代码还未形成完整可用的远程配对流程。

06B 必须补齐：

- bootstrap data 注入 Owner target；
- device key 创建、恢复和损坏清理；
- Relay attach、E2EE handshake 和 Owner WS admission；
- provisional `owner.session.open`；
- `remote.device.binding.verifyTotp` / recovery code；
- `remote.device.trust` challenge/consume/promotion；
- promotion 后关闭 provisional connection，再用 paired admission 重连；
- paired、expired、revoked、trust reset 和 offline 状态投影。

验收必须由实际调用链和测试共同证明，不以 helper 存在或 Relay socket 能握手作为完成标准。

### 7.2 [P1] paired client token 写入路径不可达

`setPairedDevice()` 目前只由未接入的 `promoteProvisionalDevice()` 调用。启动代码虽然读取 `pairedClientToken`，但实际 promotion 无法写入它；刷新后恢复因此不可达。

修复要求：

- 接通 7.1 promotion 路径后，将返回的 `clientToken` 与 `deviceId`、`trustEpoch` 原子写入同一 IndexedDB 记录；
- 新页面启动时若没有 bootstrap fragment，应检查已配对记录并以 paired admission 恢复；
- pairing 尚未确认或 IndexedDB 写入失败时，不得显示 paired 成功；
- admission 明确被服务端拒绝、trust reset、epoch 不匹配、revoke、CryptoKey 恢复失败或记录损坏时清除 paired 状态；普通离线或暂时网络错误不得误删仍有效的 paired 凭据。

### 7.3 [P1] Thread event cursor 与 Server 合同不一致

Server 的 cursor 是 `{ epoch, sequence }`；Thread interface 和 Owner Thread adapter 仍按数字 cursor/`afterId` 处理。当前 `events.subscribe` 未传 `cursor`，resume 也可能传数字值，因此断线期间的事件回放和 cursor epoch 校验无法可靠工作。

修复要求：

- 将 `ThreadSnapshot.eventCursor`、`ThreadRuntimeStatus.eventCursor` 和 adapter 状态统一为 API 定义的对象 cursor；
- 初次 `events.subscribe` 传入 snapshot 的完整 cursor；
- `events.resume` 传入服务端返回的 `subscriptionId` 和最后确认的完整 cursor；
- 明确处理 `events.reset`，读取安全 snapshot、hydrate reducer 并从新 cursor 重新订阅；
- 对 replay、重复事件、epoch 不匹配、cursor gap 和 reset 补 focused tests。

### 7.4 [P2] `events.reset` 目前被 adapter 忽略

服务端 reset event 的 cursor 位于 `params` 且为对象；adapter 只接受数字 `envelope.cursor`，会静默丢弃 reset。修复应并入 7.3，不单独建立第二套恢复状态机。

### 7.5 前端加密依赖违反已记录边界

已解决：Relay E2EE 实现位于 `packages/app/src/lib/remote/relay-crypto.ts`，Owner socket 只依赖该本地 adapter 和 `@codex-web/protocol/relay` 的帧类型/parser；App 不直接依赖 `@codex-web/protocol/relay/crypto`。不改变 E2EE 合同。

### 7.6 runtime controller 存在双重 transport 访问入口

已收敛：业务层通过 controller 的 `request`、`openStream`、`subscribeNotification` 和连接生命周期接口访问 Owner runtime；controller 不再暴露底层 transport 实例。

## 8. 实施里程碑

### 06A-0：接口和纯逻辑冻结（已实现，仍需按 review 修正合同偏差）

范围：定义 Owner runtime、connection target、状态模型、request error、stream handle、cancel 和 cleanup 合同。

入口：`packages/app/src/lib/owner-ws/*`、`packages/protocol/src/owner/*`。

验收：纯逻辑测试覆盖 request/response、stream、cancel、duplicate ID、timeout、close rejection 和错误投影。

### 06A-1：Owner WS transport（已有实现）

范围：把管理页专用 client 提升为通用 transport；实现 stream、cancel、生命周期、session token resume 和关闭清理。

入口：`packages/app/src/lib/owner-ws/*`、`packages/app/src/app/entry/*`。

验收：管理页不再直接拥有 transport；Owner WS 关闭时没有悬挂 Promise；本地连接可重新建立。

### 06A-2：连接/session controller（已有实现）

范围：实现 transport/auth/runtime 三层状态、重连退避、认证失败、session expired、offline 和 active connection 切换。

验收：读取可恢复，mutation 不自动重放；连接切换后重新 hydrate；状态变化可被 React controller 订阅。

### 06B：认证与远程状态统一（自动化实现完成，待真实环境验收）

范围：接入 bootstrap、设备密钥、Relay/E2EE、provisional login、TOTP/recovery、trust promotion、paired token 持久化和管理页 adapter。

入口：`packages/app/src/lib/remote/*`、`packages/app/src/lib/owner-ws/*`、`packages/app/src/app/owner/*`、`packages/app/src/app/entry/*`。

验收：真实浏览器完成 bootstrap 清除、密码登录、TOTP 或本机批准、paired 重连、刷新后 paired admission、撤销、trust reset、Relay 断线和 IndexedDB 清除后的重新配对。

### 06C：Chat/Thread/Turn 迁移（自动化实现完成，待真实环境验收）

范围：将 thread list/read/status/create/send/cancel/compact、events、approval、question 迁移到 Owner domain adapters；复用现有 thread session/reducer/presentation。

入口：`packages/app/src/app/chat/*`、`packages/app/src/lib/bridge/interfaces/*`、`packages/app/src/app/chat/session/*`。

验收：snapshot、history replay、cursor resume、reset hydrate、事件去重、turn cancel、approval 和 user input focused tests 通过；删除对应旧 HTTP/SSE adapter。

### 06D：Workspace/Settings 迁移（生产调用已迁移）

范围：迁移 projects、credentials、configuration、skills、codex lifecycle 和设置页。

入口：`packages/app/src/app/workspace/*`、`packages/app/src/app/settings/*`、各 domain adapter。

验收：页面只通过 Owner methods 工作；保留外围 HTTP；旧领域 bridge 删除。

### 06E：清理与全量回归（自动化回归通过；server 并发 suite 有时序波动）

范围：删除未使用的业务 HTTP/SSE bridge，修复所有缺失 bridge import，统一测试和文档状态。

验收：`pnpm typecheck`、app/protocol/relay tests、修改文件 `oxfmt --check` 和 `pnpm lint:staged` 通过。server 全套 84 项在并发执行时曾出现临时 runtime 目录 EBUSY 和 startup 子进程超时；单独复跑 startup readiness 测试时 84 项全通过。真实 Owner/Relay 手工回归尚未完成。

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

新 session 从以下顺序开始，避免重新盘点已确认的问题：

1. 阅读本文件和 05 最终提交 `cfb2a8f`；
2. 运行 `git status --short --branch` 并阅读当前 WIP；
3. 盘点 `packages/app/src/lib/bridge` 的缺失 import；
4. 先处理 7.1 与 7.2：打通用户可达的远程 admission，并证明 paired token 写入和刷新恢复；
5. 处理 7.3 与 7.4：按对象 cursor 实现订阅、resume、reset hydrate 和重订阅；
6. 解决 7.5 的 crypto 依赖边界，运行 app typecheck 和相关 focused tests；
7. 处理 7.6 的双入口问题，并完成 06E 全量测试、旧 bridge 清理和手工浏览器验收；
8. 不把 05 的安全语义作为 06 的重设计对象。

## 12. 当前实现记录

- 06A-2 已加入三层 runtime/session controller、有限重连退避、retry、target switch 和连接生命周期测试；页面通过 controller 的 request/stream/close 入口访问运行时。
- 06C 已按 `{ epoch, sequence }` cursor 合同完成 subscribe/resume/reset recovery、事件去重和 snapshot hydrate。
- 06D 已将 Workspace/Settings 生产调用迁移到 Owner domain adapters；生产代码不再引用业务 HTTP/SSE bridge。
- 远程 Relay/E2EE socket、设备记录、provisional admission、TOTP/recovery 验证、trust promotion、paired token 写入和刷新后 admission 已形成实际调用闭环。
- Relay E2EE 由 App 内 `relay-crypto.ts` adapter 实现；Owner socket 不直接依赖 protocol crypto 子路径，符合前端边界文档。
- 受测试环境限制，少量纯 controller 测试仍通过 Owner bridge mock 模拟事件；生产调用已统一走 Owner domain adapter。
- 06E 已删除未使用的业务 HTTP/SSE bridge 实现；外围 bootstrap/metadata HTTP 不受影响。
- 远程端已消费 `remote.device.paired` 通知，支持本机批准后自动保存 paired token、切换 admission 并建立 Owner session。
- 06 review 基点为 `cfb2a8f`；自动化 P1/P2 修复及其 focused tests 已完成。真实 Owner/Relay 浏览器路径未通过前，06 保持 In progress。

### 最终手工验收状态

未执行：当前环境没有运行中的 Vite `5173` 或 Owner `3000` 服务，也没有可用于真实配对的 Owner/Relay 会话。完成 06 前仍需按第 10 节验证本地 session、bootstrap 清除、TOTP/recovery 与本机批准、paired 刷新/重连、撤销/trust reset、设备存储故障恢复、Chat cursor/reset/审批/问答及 Workspace/Settings 读写。

## 13. 未决事项

没有阻塞 06 开始的架构决策。实现时只允许在以下边界内做局部选择：

- `OwnerRuntime` 的具体 TypeScript 命名；
- 重连退避的具体时间参数；
- 各领域 adapter 的目录组织；
- UI-facing error 文案和 loading 状态的具体呈现。

这些选择不得改变第 4 节的冻结不变量。
