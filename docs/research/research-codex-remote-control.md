# Codex 官方远控（remote control）调研

调研时间：2026-11-03。依据本机 `C:\Users\Hello\Desktop\codex` checkout，提交 `0a2dda4b5e748a2ba135c87f6f6de19f05498dd4`（2026-11-02）。产品侧依据 [Codex on mobile 文档](https://learn.chatgpt.com/docs/mobile.md) 与 [Work with Codex from anywhere](https://openai.com/index/work-with-codex-from-anywhere)。

## 核心结论

OpenAI 的移动端不是独立 App，而是 ChatGPT iOS 客户端里的 Codex 面板，通过 `wham/remote/control/*` 后端路由到本机 `app-server`。整条链路是**后端可信**的：relay 与鉴权都由 OpenAI 服务端完成，客户端拿到的是 OpenAI 签发的 `remote_control_token`，业务正文不经端到端加密。

对本项目的可借鉴范围严格限定在传输层工程细节：分片重组、按流序号确认、重连游标、背压门控、空闲淘汰。身份模型、配对协议、端点定义全部耦合 ChatGPT 账号，不可移植。

## 组成

| 组件     | 位置                                                                  | 职责                                                                                                 |
| -------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 传输     | `codex-rs/app-server-transport/src/transport/remote_control/`         | 15 897 行；注册、配对、WebSocket、分片、客户端管理                                                   |
| 协议类型 | `codex-rs/app-server-protocol/src/protocol/v2/remote_control.rs`      | `remoteControl/{enable,disable,statusRead,pairing/start,pairing/status,clients/list,clients/revoke}` |
| 持久化   | `codex-rs/state/migrations/00{24,37}_remote_control_enrollments*.sql` | enrollment 记录与启用标志                                                                            |
| CLI      | `codex-rs/cli/src/remote_control_cmd.rs`                              | 配对命令入口                                                                                         |

端点由 `protocol.rs` 的 `normalize_remote_control_url` 从单一基址派生，默认 `https://chatgpt.com/backend-api`：

```text
POST {base}/wham/remote/control/server/enroll
POST {base}/wham/remote/control/server/refresh
POST {base}/wham/remote/control/server/pair
POST {base}/wham/remote/control/server/pair/status
WS   {base→wss}/wham/remote/control/server
```

## 账号门槛

配对与连接都要求 `uses_codex_backend() && get_account_id().is_some()`（`auth.rs:91-131`）。`AuthMode::uses_codex_backend()` 对 `ApiKey | BedrockApiKey | BedrockAccessKeys` 返回 `false`（`app-server-protocol/src/protocol/common.rs:78-87`），即 API key 登录直接被拒，报错文本为 `remote control requires ChatGPT authentication; API key auth is not supported`。

ChatGPT 登录只是**准入条件**，不决定推理走哪条路。实际推理 provider 由 `[model_providers]` 选择；`core/src/client.rs:1323` 的 `uses_codex_backend()` 还要求 `provider.is_openai() && provider.requires_openai_auth && env_key.is_none() && experimental_bearer_token.is_none() && auth.is_none()`。因此自定义 `base_url` 的 provider 会让推理走第三方端点，同时远控通道仍用 ChatGPT token 建立。

需要区分：**通道可用性**只由 OpenAI 账号与 workspace rollout 决定；**推理去向**由 provider 配置决定。两者相互独立。

## 可借鉴的传输设计

### 分片

`segment.rs:21-25`：

| 常量                                        | 值             |
| ------------------------------------------- | -------------- |
| `REMOTE_CONTROL_SEGMENT_TARGET_BYTES`       | 100 KiB        |
| `REMOTE_CONTROL_SEGMENT_MAX_BYTES`          | 150 KiB        |
| `REMOTE_CONTROL_REASSEMBLED_MAX_BYTES`      | 100 MiB        |
| `REMOTE_CONTROL_SEGMENT_COUNT_MAX`          | 1024           |
| `REMOTE_CONTROL_SEGMENT_ASSEMBLY_MAX_COUNT` | 128 个并发重组 |

重组按 `segment_count`、`message_size_bytes`、`segment_id` 逐段校验；`segment_id != next_segment_id` 直接丢弃整个 assembly；`seq_id` 回退视为重放并忽略。

### 序号、确认与游标

- `ServerEnvelope.seq_id` 每 `(client_id, stream_id)` 单调递增。
- `ClientEvent::Ack { segment_id }` 携带 `seq_id`，语义是确认该流中 `seq_id` 不大于它的所有信封；块确认额外带 `segment_id`，使重连时只需保留未确认的线序块。
- 连接请求头 `x-codex-subscribe-cursor` 携带通道级游标，断线后从游标续订（`websocket.rs:71, 1346`）。

### 背压

`CHANNEL_CAPACITY = 128`（`transport/mod.rs:24`）。writer 侧当 `used_rx` 达到上限时**停止接收**而非丢帧（`websocket.rs:1020-1032`），`BoundedOutboundBuffer` 按流分别持有队列。心跳 10 s、pong 超时 60 s、连接超时 30 s、重连退避 5 s 起、60 s 无错后重置、上限 30 s。

### 空闲淘汰

`client_tracker.rs:27-28`：客户端 10 分钟无活动超时，30 秒扫描一次；传输事件发送超时 5 秒（非测试构建）。

## 不可移植部分

- `enroll.rs`、`auth.rs`、`server_api.rs` 全部依赖 `chatgpt.com/backend-api` 的签发与刷新语义，本地无等价实现。
- 无端到端加密：relay 可读业务正文；本项目 Relay 是零知识路由，业务语义必须保留在 Owner 侧。
- 无 trust epoch、无设备公钥绑定：设备身份由服务端签发（`clients.rs:33-48` 的 `device_type/platform/os_version/device_model/app_version`），与 Owner 侧原子绑定模型不同。

因此 seq/cursor 这类状态应由 Owner 生成并置于 E2EE 载荷内，Relay 只搬运，不能照搬为 Relay 职责。

## 与本项目的差异

| 维度     | Codex 官方远控                         | Codex Web                                                 |
| -------- | -------------------------------------- | --------------------------------------------------------- |
| 身份     | ChatGPT 账号 + workspace               | 单 Owner + Passkey                                        |
| 设备信任 | 服务端签发设备记录                     | 浏览器不可导出私钥，Owner 原子绑定                        |
| 信任重置 | 无                                     | `trustEpoch` + identity pinning                           |
| 加密     | 无 E2EE，bearer + `wss`                | X25519 + AES-GCM，AAD 绑定 `sequence`                     |
| 邀请     | `pairing_code` + `manual_pairing_code` | 5 分钟单次 enrollment reference，Relay 只存路由           |
| 帧上限   | 150 KiB 分片，重组 100 MiB             | `RELAY_MAX_FRAME_BYTES` 默认 2 MiB，无分片                |
| 背压     | 停止读取                               | `DEFAULT_MAX_QUEUED_BYTES` 2 MiB（Owner）/ 8 MiB（Relay） |

## 待评估项

1. `packages/protocol/src/relay` 无 payload 分片，超过 `RELAY_MAX_FRAME_BYTES` 的 Thread 响应或 diff 的行为未定义。
2. 域事件层已有 `afterId`/`replayThrough` 回放（`packages/server/src/codex/event-hub.ts:211-263`），但 Relay 层 E2EE 帧无游标；两层恢复语义需明确区分。
3. 远程 session 是否需要等价于 10 分钟空闲淘汰的约束。

## 借用可行性的实测结论

实测时间：2026-11-03，`codex-cli 0.154.0`，Windows 11，ChatGPT 账号（含手机号验证）+ 中转站 provider。

结论：**可行，但需要三个独立开关同时正确**。远控通道用 ChatGPT 账号，推理走中转站 key，两者互不干扰。

### 实测过程

| 状态                          | 命令                               | 实际输出                                                           |
| ----------------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| API key 登录                  | `codex remote-control pair --json` | `remote control pairing is unavailable until enrollment completes` |
| API key 登录                  | `codex remote-control start`       | `Remote control is enabled on PC but the connection is errored.`   |
| ChatGPT 登录                  | `codex remote-control start`       | 连接成功，手机配对成功                                             |
| ChatGPT 登录 + 未配 `env_key` | 手机发起对话                       | 中转站返回 `invalid key`                                           |

前两行的真实原因被 CLI 文本掩盖：`mod.rs:445` 把 `load_remote_control_auth` 的任何错误统一改写为 `pairing_unavailable_error()`，而 `auth.rs:128-131` 的真实错误是 `remote control requires ChatGPT authentication; API key auth is not supported`。排障时应以 `Errored` 状态为准，不要相信 pairing 的文本。

### `invalid key` 的成因

`get_token()`（`login/src/auth/manager.rs:639-645`）按 `auth_mode` 单字段取值，不合并：

```rust
Self::ApiKey(auth) => Ok(auth.api_key.clone()),
Self::Chatgpt(_) | Self::ChatgptAuthTokens(_) => {
    let access_token = self.get_token_data()?.access_token;
    Ok(access_token)
}
```

`auth_mode: "chatgpt"` 时 `OPENAI_API_KEY` 字段被完全忽略，请求头携带的是 OAuth `access_token`（JWT 形态）。中转站不认，返回 401。端点探测确认中转站接受 `Bearer`、`x-api-key`、`x-goog-api-key` 三种形式，故不是 header 形状问题。

### 最终配置

```toml
model_provider = "proxy"
model = "gpt-6.1-sol"

[model_providers.proxy]
name = "xj"
base_url = "https://aixj.vip/v1"
wire_api = "responses"
requires_openai_auth = true
env_key = "AIXJ_API_KEY"
```

三个开关各管一层，读取对象不同：

| 层                                          | 决定因素                               | 代码位置              |
| ------------------------------------------- | -------------------------------------- | --------------------- |
| 远控准入                                    | `auth.json` 的 `auth_mode: "chatgpt"`  | `auth.rs:91-131`      |
| 能力面（workspace、模型目录、插件、skills） | `requires_openai_auth = true`          | `provider.rs:419-425` |
| 推理凭据                                    | `env_key` → `bearer_auth_for_provider` | `auth.rs:288-290`     |

关键机制：`bearer_auth_for_provider` 在 `resolve_provider_auth` 第一行返回，**优先于** `requires_openai_auth` 的 first-party 分支；`api_key()` 只读 `env_key`，不关心其他字段。因此 `requires_openai_auth = true` 与 `env_key` 可以并存——`validate` 只禁止 `env_key` 与 `auth.command` 组合，未禁止 `requires_openai_auth`。

不能删掉 `requires_openai_auth = true`：`provider_uses_first_party_auth_path` 是全条件与，删除后 provider 退回 `ConfiguredProvider` 路由，账号相关能力随之失效。

### 运维注意

- `auth.json` 同一时刻只有一个 `auth_mode`，`apikey` 与 `chatgpt` 互斥；远控要求后者。
- `setx` 设置的环境变量只对新进程生效，修改后必须完全退出 ChatGPT 桌面 App 与 daemon 再启动。
- 配对必须从 ChatGPT 桌面 App 的 `Settings > Connections` 发起；安装文档称 CLI 无法完成配对。
- 官方文档存在滞后：`reference/settings` 未列出 Connections 分区，且“被控制”入口的可见性取决于账号 rollout。

## 代理环境下的远控可用性

现象：代理软件开启 HTTP 代理（系统代理模式）时远控无法建立连接，切换到 TUN/虚拟网卡模式后正常。

根因是 Codex 默认**不读取系统代理**，而非远控特有缺陷。

### 默认策略

```rust
// features/src/lib.rs:1595-1602
FeatureSpec {
    id: Feature::RespectSystemProxy,
    key: "respect_system_proxy",
    stage: Stage::Experimental {
        name: "System proxy",
        menu_description: "Use macOS or Windows system proxy settings for Codex requests.",
    },
    default_enabled: false,
}
```

`core/src/config/mod.rs:1808-1816` 据此选择工厂策略：

| `respect_system_proxy` | 策略                 | 解析顺序                                  |
| ---------------------- | -------------------- | ----------------------------------------- |
| `true`                 | `RespectSystemProxy` | 系统代理/PAC → 环境变量 → 直连            |
| `false`（默认）        | `ReqwestDefault`     | 仅 `HTTP(S)_PROXY` / `ALL_PROXY` 环境变量 |

`ReqwestDefault` 下 `resolve_proxy_route_async` 直接返回 `TransportDefault`（`outbound_proxy.rs:299-305`），不查询 WinHTTP/IE 设置。因此代理软件设置的“系统代理”对 Codex 不可见；TUN 模式在网络层接管，进程侧仍表现为直连，故可用。

### 远控的 WebSocket 同样走这套策略

`websocket-client/src/lib.rs:119-125` 的 `connect` 调用 `http_client_factory.resolve_proxy_route_async(...)`，策略与 HTTP 请求一致。`dialer.rs:52-61` 在 `TransportDefault` 下交给 tungstenite 解析 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY`。

wss 的环境变量优先级单独定义（`outbound_proxy.rs:389-391`）：

```text
EnvProxyKind::SecureWebSocket => HTTPS_PROXY → HTTP_PROXY → ALL_PROXY
```

说明远控连接在设计上已考虑代理环境变量。HTTP 代理走 `CONNECT` 隧道，`dialer.rs:77-105` 有显式 CONNECT 与 407 重试路径。

### 解法

1. 启用系统代理支持（推荐，需重启 App）：

   ```powershell
   codex features enable respect_system_proxy
   ```

2. 设置环境变量（切换代理无需重启，每次连接重新解析）：

   ```powershell
   setx HTTPS_PROXY "http://127.0.0.1:7890"
   setx HTTP_PROXY  "http://127.0.0.1:7890"
   ```

3. 诊断入口：

   ```powershell
   codex doctor network
   ```

   输出包含 `respect system proxy: enabled|disabled`、`managed proxy: configured|not configured` 及代理环境变量详情（`cli/src/doctor/network.rs:100-121`）。

### 注意

`SYSTEM_PROXY_REMEDIATION` 提示文本仅在 `target_os = "macos"` 分支输出（`doctor/network.rs:79`），但 Windows 支持存在于 `outbound_proxy.rs` 的 `mod windows` 与 `connect_windows_proxy`，不能据提示文本推断 Windows 不受支持。

`system_proxy_fallback`（默认启用）只在 `ReqwestDefault` 策略下生效（`outbound_proxy.rs:252-255`），与 `respect_system_proxy` 互斥，用于系统代理解析失败后的重试，不改变路由策略。
