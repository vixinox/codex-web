# 05 收尾与 06 前端重构交接

## 1. 状态

- 05 状态：Implementation complete；自动化验证已通过，待真实服务链路手工验收后标记 Verified。
- 05 主规格：[`05-remote-entry-auth-and-device-trust.md`](./05-remote-entry-auth-and-device-trust.md)
- 拆分规范：[`05-work-package-split.md`](./05-work-package-split.md)
- 当前架构基线：[`../owner-remote-architecture.md`](../owner-remote-architecture.md)
- 当前工作区有未提交的 05 修复差异；新 agent 必须先阅读 `git diff`，不得假设这些修改已经提交或完整。

## 2. 05 收尾目标

05 只需完成“远程入口和设备安全生命周期”的最小可用闭环，不继续重构 Chat、Workspace、Settings。

最终闭环：

```text
bootstrap URL
  -> fragment 清除
  -> Relay/E2EE/Owner WS
  -> 密码登录
  -> pending binding session
  -> TOTP 或本机管理页批准
  -> 浏览器公钥登记
  -> paired admission 重连
  -> 使用 Agent
```

## 3. 当前已完成事实

- Better Auth 已配置 `twoFactor` 插件，数据库 schema 已加入 twoFactor 字段/表。
- provisional runtime 已允许绑定相关 method，并移除旧的重复 allowlist。
- Owner methods 已加入安全状态、TOTP enable/verify 和 binding status/approve/reject 的入口。
- Connector 已能列出当前 provisional connection，批准时登记 trust peer、生成 paired token 并 promotion，拒绝时关闭连接。
- App 已有 `/owner/manage` 路由和管理页面。
- 管理页 transport 已从不存在的 `/api/owner/method` 改为最小 `/ws` Owner client。
- protocol 已提供 `generatePersistentDeviceKeyPair()`；其 private key 使用 `extractable: false`。
- bootstrap fragment 消费、清理和基础 remote state 测试已存在。

上述事实以当前源码为准；实现细节不得仅以旧提交说明推断。

## 4. 必须完成的收尾任务

### 4.1 Recovery codes

使用已安装 Better Auth 版本提供的 API，不自建 OTP/backup code 算法：

- 首次 TOTP 验证成功后生成 recovery codes；
- recovery codes 只在生成/轮换响应中返回一次；
- 服务端只返回 `recoveryCodesAvailable`，不返回已保存 code；
- 支持 recovery code 单次验证和整组轮换；
- 错误映射为稳定 Owner error code，不泄露账号或 code 状态；
- 管理页提供“生成/轮换 recovery codes”并要求用户确认已保存。

建议新增 Owner methods：

- `owner.security.totp.setup`
- `owner.security.totp.verify`
- `owner.security.recovery.generate`
- `owner.security.recovery.rotate`

方法必须通过 Application Services 调用 Better Auth，页面不得直接访问 Better Auth 内部 API。

### 4.2 TOTP 绑定后推进设备信任

当前 `owner.security.totp.verify` 只能验证 TOTP，不能直接让远程设备成为 paired device。必须补齐：

- TOTP 成功后只更新当前 bootstrap session 的 binding authorization；
- 仍需执行 `remote.device.trust` 的公钥/challenge 校验；
- trust 成功后返回 deviceId 和 paired client token；
- 客户端断开 provisional connection，再以 paired admission 重连；
- 任何一步失败都不能显示为已绑定。

管理页批准路径也必须使用同一套 promotion 逻辑，避免 TOTP 与本机批准产生两套设备登记规则。

### 4.3 Binding request 生命周期

当前 Connector 的 pending 列表是运行时连接视图，需补齐明确生命周期：

- requestId 绑定 bootstrapId 和客户端公钥；
- 只在 provisional connection 存活且 30 分钟 session 未过期时可见；
- approve/reject 一次性消费；
- connection close、过期、trust reset 后立即失效；
- approve 必须验证 requestId 对应的当前 public key，不能只按字符串 ID 操作；
- 不向管理页返回完整公钥、token、session 或内部 connectionId。

### 4.4 管理页最小完整性

`/owner/manage` 必须补齐：

- 显示 TOTP 状态；
- TOTP setup/verify 入口；
- recovery codes 一次性展示和轮换；
- pending request 的 Approve 和 Reject；
- 设备列表、单设备 Revoke、Reset all trust；
- loading、empty、expired、offline、session expired、operation failed 状态；
- Owner WS 关闭时清理 client，避免 pending Promise 永久挂起。

管理页继续使用当前 Vite app 和 Owner WS，不新增 `/api/owner/method` REST 入口。

### 4.5 设备密钥安全

- 确认 IndexedDB 中只存不可导出 CryptoKey 和公钥 metadata；
- 删除所有设备身份路径上的 `serializeKeyPair(privateKey)` 调用；
- 增加测试断言 `privateKey.extractable === false`；
- IndexedDB 不可用、CryptoKey 恢复失败或记录损坏时清理状态并要求重新 bootstrap；
- 不使用 localStorage、URL、日志、React state 序列化或服务端请求保存私钥。

### 4.6 测试与验收

服务端：

- TOTP setup/verify、recovery code 单次消费/轮换；
- pending session 禁止业务 method；
- TOTP 和本机批准两条绑定路径；
- request 过期、重复批准、拒绝、连接关闭、trust reset；
- DTO 不含 token、私钥、完整公钥或 connectionId。

App/protocol：

- Owner WS request/response、关闭和 session 过期；
- fragment 清除；
- IndexedDB CryptoKey 不可导出、清除和损坏恢复；
- management model 和 remote state。

命令：

```text
pnpm --filter @codex-web/server test
pnpm --filter @codex-web/protocol test
pnpm --filter @codex-web/relay test
pnpm --filter @codex-web/app test
pnpm typecheck
pnpm exec oxfmt --check <修改的 TypeScript 文件>
pnpm lint:staged
```

注意：当前 app 全量 typecheck/test 已知会被既有缺失的 `packages/app/src/lib/bridge/*` 模块阻塞。收尾时必须区分这些基线错误与 05 新增错误，并至少保证新增/修改路径无新错误；06 需要处理这批 bridge 缺失和迁移问题。

05 只有在以下手工路径完成后才标记 Verified：

- bootstrap URL 读取并清除 fragment；
- 密码登录进入 pending 状态；
- TOTP 绑定成功；
- 本机管理页批准绑定成功；
- paired 重连后可使用 Agent；
- recovery code 可一次消费；
- pending session 无法访问业务；
- 过期、拒绝、撤销、trust reset、Relay 断线和 IndexedDB 清除后的重新配对均正确。

## 5. 05 明确不继续做

- Chat、Workspace、Settings 全量迁移到 Owner WS；
- 重写现有页面领域架构；
- 统一所有 bridge adapter；
- 全局 connection/session/event store 重构；
- 新设备邀请或 `remote.device.invite`；
- 官方站点发布和公共 Relay 运维。

这些事项转入 06 或更后的工作包。

## 5.1 本次收尾实现记录

- Better Auth twoFactor 的 TOTP setup/verify、recovery code generate/rotate/verify 已通过 Owner Application Services 暴露；recovery code 只在生成或轮换响应中返回，状态查询只返回是否可用，错误统一投影为稳定认证失败。
- 远程密码登录支持 pending two-factor challenge；TOTP 或 recovery code 验证后只推进当前 bootstrap session，设备仍必须通过 `remote.device.trust` 的公钥和 challenge 校验才能 promotion。
- 本机批准和远程 TOTP 复用 connector promotion；pending binding 绑定 bootstrap、公钥和连接生命周期，DTO 只返回请求指纹和时间，不返回公钥、token 或 connectionId。
- `/owner/manage` 已接入 Owner WS，包含 TOTP、recovery code、批准/拒绝绑定、设备撤销和 trust reset，以及 loading、offline、session expired 和失败状态；Owner WS 关闭时会拒绝所有 pending request 并清理 client。
- 浏览器设备密钥只持久化不可导出的 `CryptoKey` 和公钥 metadata；损坏记录会清理并要求重新 bootstrap。
- 已通过 server、protocol、relay focused tests、管理页/fragment focused tests、server/protocol/relay typecheck 和修改文件 `oxfmt --check`。完整 app typecheck/test 仍被 06 明确记录的既有 `packages/app/src/lib/bridge/*` 缺失阻塞。

## 6. 06 整体方向

06 的主题是：**把 05 为了闭环而建立的最小 remote client 和管理页接入，重构成统一的 Owner 前端运行时。**

### 6.1 目标架构

```text
App entry
  -> Owner connection/session controller
  -> Owner WS transport
  -> domain adapters
  -> domain state/reducers
  -> UI-facing models
  -> Chat / Workspace / Settings renderers
```

统一处理：

- local 与 remote Owner WS；
- session token resume；
- Relay/E2EE 连接状态；
- pending/temporary/paired auth state；
- request/response、stream、cancel；
- event cursor、snapshot、reset 和重连；
- session expired、revoked、offline 和 retry。

### 6.2 06 主要工作包方向

- **06A Owner WS 基础运行时**：正式化 request/response/stream/cancel、连接生命周期、错误投影和 session resume。
- **06B 认证与远程状态统一**：将 05 的 bootstrap/TOTP/device state 纳入统一 app controller，管理页不再拥有独立 transport 逻辑。
- **06C Chat/Thread/Turn 迁移**：替换旧 bridge/http/SSE adapter，统一事件 cursor、snapshot、approval、question 和 turn cancel。
- **06D Workspace/Settings 迁移**：Project、Credential、configuration、skills、runtime 和设置页全部使用 Owner methods。
- **06E 清理与回归**：删除不再使用的业务 HTTP/SSE bridge，保留 health、metadata、bootstrap、配对发现等外围 HTTP；修复当前缺失 bridge 模块并完成全量 typecheck/test。

### 6.3 06 非目标

- 不改变 Owner/Relay/E2EE 安全边界；
- 不新增 Guest、多 Owner 或 Relay 账户；
- 不改变 Codex App Server 的执行权威；
- 不把业务方法放回 Relay 或新增 REST tunnel；
- 不重新设计 05 的 TOTP、trust epoch 或设备撤销语义。

## 7. 冷启动顺序

新 agent 处理 05 收尾时：

1. 阅读本文 4 节和当前 `git diff`；
2. 阅读 `docs/owner-remote-architecture.md`；
3. 检查 Better Auth 1.7.4 twoFactor 类型和 schema；
4. 先完成 server 合同和 focused tests；
5. 再补管理页 UI 和 Owner WS client；
6. 最后运行 server/protocol/relay/app focused checks 和手工验收；
7. 完成后更新本文状态和 implementation notes，再提交 milestone。

新 agent 处理 06 时：

1. 先读取本文 6 节和 05 最终实现；
2. 盘点当前 `packages/app/src/lib/bridge/*` 缺失项；
3. 先冻结统一 Owner WS client 接口和状态模型；
4. 按 06A → 06B → 06C → 06D → 06E 顺序推进；
5. 每个领域迁移完成后删除旧 adapter，并运行领域 focused tests。
