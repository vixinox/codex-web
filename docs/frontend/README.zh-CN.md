# 前端边界

前端位于 `packages/app`，通过 Owner WS client 访问本机 Owner Gateway。页面和 renderer 只消费 UI-facing model，不直接依赖 Owner protocol raw frame、Codex payload、宿主机路径或凭据。

## 依赖方向

```text
app/entry -> app/composition -> app/{chat,workspace,settings}/application
                                      |
                                      +-> domain -> UI-facing model -> renderer
                                      |
                                      +-> lib/owner-ws -> @codex-web/protocol/owner
                                      |
                                      +-> components/ui -> lib/utils
```

`packages/app` 可以依赖 `@codex-web/protocol/owner` 的类型和 parser，但不依赖 `@codex-web/protocol/relay/crypto`、server-only database 或 Fastify request/reply。

## Owner WS client

`lib/owner-ws` 负责连接、session token resume、request/response、stream、cancel、事件 cursor、重连和认证过期状态。领域 controller 通过 adapter 调用方法，不拼接 wire frame，不访问 HTTP 或 SSE。

连接状态使用：

```text
disconnected | connecting | connected | reconnecting | failed
```

认证状态使用：

```text
unknown | authenticated | unauthenticated
```

认证失效时清理本地 Owner state 并导航到 `/login`。重连后先读取 Thread status；cursor 无法恢复时读取安全 snapshot，再重新订阅。

## 数据流

```text
用户输入 -> request(threads.send)
         -> response(accepted turn)
         -> stream.open/event/close
         -> native reducer
         -> presentation model
         -> renderer
```

审批、用户问答、Turn cancel 和事件恢复都使用同一条 WS 连接。连接断开不会自动取消正在执行的 Turn。

## 安全显示边界

- API key、session token、绝对路径、Codex Home、rollout 路径、stack 和原始 provider payload 不进入 UI state、日志或缓存。
- renderer 不解析 `method`、原生 item 或 server error payload；adapter/reducer 先将其投影为 UI model。
- 文件和终端流属于后续 protocol 扩展；当前 Owner protocol 只支持 JSON text frame。

## 验证

Owner WS transport、cursor 恢复、controller 和纯逻辑变更使用定向测试、`pnpm typecheck` 和触及文件的 `oxfmt --check`。页面验收使用用户启动的 Vite 和 Owner 服务进行手工浏览器回归。
