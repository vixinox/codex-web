# 04 Owner bootstrap 与远程设备入口

## 目标

完成“本机 Owner 后端 + Relay + 官方网页入口”所需的后端和协议合同，但不在本工作包实现正式官方网页。未配对浏览器可以在登录后获得短期临时 Owner session；用户随后可主动将当前浏览器升级为长期受信任设备。

用户路径固定为：

```text
启动 Owner 后端
  -> 后端自动连接 Relay
  -> 终端隐藏输入创建首个 Owner 账号
  -> 终端输出一次性官方 bootstrap URL
  -> 官方网页使用 URL 定位 Owner 节点
  -> 用户登录账号并完成后续 2FA（05）
  -> 建立短期临时 session
  -> 用户选择“信任此浏览器”
  -> 浏览器公钥登记为 deviceId，session 升级为正常策略
```

## 范围

### 04 必须完成

- Relay/E2EE admission、双向握手、连接生命周期和恢复；
- 终端交互式首个 Owner 账号创建，密码不得进入日志或 bootstrap URL；
- 一次性、短时、绑定 node/trust epoch 的 bootstrap capability；
- bootstrap 后的临时远程 Owner session 合同；
- 登录后“信任此浏览器”的配对接口和设备撤销；
- 已信任设备生成一次性新设备邀请的 Owner method 合同；
- protocol/server/relay 测试客户端和集成验收；
- 必要的配置、部署和安全边界文档。

### 04 明确不做

- 官方网页产品入口和页面 UI；
- 浏览器 IndexedDB/WebAuthn 私钥存储；
- Better Auth twoFactor 和陌生设备强制 2FA；
- 临时 session 的正式续期/升级 UI；
- 聊天、工作区、设置从旧 HTTP/SSE 到 Owner WS 的全量迁移；
- Relay 账户、业务数据库、离线业务队列或 Guest 兼容层。

现有本地前端 HTTP/SSE 链路在 04 保留。后续按领域迁移到 Owner WS，全部迁移完成后再删除业务 HTTP/SSE；health、metadata、auth bootstrap 和配对发现等外围 HTTP 继续保留。

## 关键合同

### 终端 bootstrap

- 新增一次性本地 CLI bootstrap 入口，复用本地 Owner 创建逻辑；
- 交互输入姓名、邮箱和密码，密码使用隐藏输入；
- 创建账号后生成官方 HTTPS bootstrap URL；
- capability 绑定 `nodeId`、当前 `trustEpoch`、用途和过期时间；
- capability 只能消费一次，消费、过期、trust reset 后立即失效；
- capability 不等于 Owner session，不允许直接调用业务方法；
- bootstrap URL 不包含 Owner 私钥、设备私钥、密码或长期 bearer token。

### 远程临时 session

- bootstrap 只把浏览器绑定到指定 Owner 节点，不自动成为长期受信任设备；
- 用户完成账号登录后获得短期临时 session；
- 临时 session 允许完成登录后所需的远程初始化和设置操作，生命周期短于正常 session；
- 05 负责 2FA 和正式 session 策略，04 只提供 session/device trust 的状态字段和服务边界；
- Owner WebSocket、Relay admission 和 E2EE 握手仍必须同时成立。

### 浏览器信任升级

- 当前临时 session 可显式请求“信任此浏览器”；
- 浏览器生成设备密钥对，只提交公钥；私钥由 05 的浏览器端实现保存，04 不落盘浏览器私钥；
- Owner 通过一次性 challenge 登记公钥并分配稳定 `deviceId`；
- 后续连接按 `deviceId`、当前 `trustEpoch`、E2EE `handshake.ok` 和有效 Owner session admission；
- 撤销设备立即关闭现有连接并拒绝后续握手；trust reset 轮换 Owner 密钥和 trust epoch 并清空设备；
- 已信任设备可以创建短时一次性新设备邀请，但不能绕过新浏览器的账号登录和 05 的 2FA 策略。

### Relay 边界

- Relay 只验证 attach 路由凭据并转发 opaque encrypted payload；
- Relay 不读取账号、session、设备公钥、Owner frame 或业务正文；
- 设备身份由 Owner 根据 E2EE 握手中的客户端公钥推出，不能信任客户端自报的 `deviceId`；
- 继续使用 `awaiting_handshake -> handshaking -> open` 状态机、序列/nonce 检查、背压、心跳和幂等清理。

## 接口与持久化

- `remote.bootstrap.create`：仅本地 CLI/本地 Owner transport，返回短时 bootstrap URL 所需的 capability；
- `remote.bootstrap.consume`：消费 capability 并绑定目标节点，不返回业务数据；
- `remote.pairing.offer`：本地 Owner 创建一次性配对 offer；
- `remote.device.trust`：已认证临时 session 请求登记当前浏览器公钥；
- `remote.device.invite`：已认证、已配对设备生成一次性新设备邀请；
- `remote.devices.list`、`remote.devices.revoke`、`remote.trust.reset`：本地 Owner 管理操作；
- Owner 长期密钥、设备公钥、challenge、trust epoch 继续保存在 `CODEX_DATA_ROOT/remote-trust.json`；
- Relay 不持久化任何上述状态；Owner session 继续由 Better Auth 管理。

## 验证

- protocol：bootstrap、配对、握手、临时/已配对 admission 的合法/非法帧、过期、重放和上下文绑定；
- server：CLI 首次创建、bootstrap 单次消费、临时 session、信任升级、设备列表/撤销、trust reset；
- relay：attach 冒认、节点/角色探测、设备 ID 错配、替换、关闭清理、限流、背压和重启空状态；
- integration：Owner 出站连接 Relay、bootstrap、pairing、双向 `handshake.ok`、Owner WS 业务调用、断线恢复、单设备撤销和 trust reset；
- 保持现有本地 Owner WebSocket 和 HTTP/SSE 前端回归；不以真实公共 Relay 或真实用户凭据作为自动化测试前置。

运行：

```text
pnpm --filter @codex-web/protocol test
pnpm --filter @codex-web/server test
pnpm --filter @codex-web/relay test
pnpm --filter @codex-web/protocol typecheck
pnpm --filter @codex-web/server typecheck
pnpm --filter @codex-web/relay typecheck
pnpm exec oxfmt --check <修改的 TypeScript 文件>
pnpm lint:staged
```
