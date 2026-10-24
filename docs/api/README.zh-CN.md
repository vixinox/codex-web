# Codex Web API 契约

Owner 业务统一通过版本化 WebSocket 提供。浏览器、桌面端和远程控制端都连接同一个 Owner Gateway；远程连接经 Relay E2EE transport 接入，不重新模拟 HTTP request/reply。

## HTTP 外围

HTTP 只保留不属于 Owner 核心业务协议的入口：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/health` | 进程存活检查 |
| `GET` | `/ready` | 依赖和事件 store 就绪检查 |
| `GET` | `/metadata` | 产品、协议版本和公开能力 |
| `GET` | `/api/auth/bootstrap` | 本地首次 Owner 创建发现 |
| `POST` | `/api/remote/pairing/offer` | 本地已认证 Owner 创建一次性配对 offer |

不再提供 credential、project、configuration、codex、skills、thread、event、auth session 或 `/api/me` REST/SSE 业务路由。

## Owner WebSocket

连接使用 `@codex-web/protocol/owner` 的 UTF-8 JSON frame。`hello` 必须是首帧；服务端返回 `ready`，随后接受 `request`、`cancel` 和服务端的 `response`、`notification`、`stream.*`。

主要方法命名空间：

```text
owner.status
owner.bootstrap.create
owner.session.open
owner.session.close
credentials.*
projects.*
codex.*
configuration.contextWindow.*
capabilities.list
skills.list
threads.*
userInput.respond
approvals.resolve
events.subscribe
events.resume
remote.status
remote.pairing.offer
remote.trust.reset
```

业务方法只返回安全 DTO。响应、事件和错误不得包含 API key、绝对路径、Codex Home、rollout 路径、App Server 进程信息、原始 Codex payload 或 stack。

## 认证与权限

首次 Owner bootstrap 只能来自本地、可信 Origin 的连接。`owner.session.open` 使用 email/password，通过 Better Auth 公共 API 返回 opaque bearer token；后续连接在 `hello.sessionToken` 携带 token。远程连接必须先通过设备配对、当前 trust epoch 和 E2EE admission。

每个请求都执行 Owner、Project、Thread 和受控路径归属校验。产品只有一个 Owner 不会取消资源归属检查。

## 事件与恢复

事件使用统一 WS stream：

```text
events.subscribe(scope, threadId?, cursor?)
events.resume(subscriptionId, cursor)
stream.event
stream.close
```

公共 cursor 为 `{ epoch: string; sequence: number }`。有效 cursor 先回放缺失事件再切换实时订阅；cursor 过期、epoch 不匹配或历史 gap 时发送 `events.reset`，客户端重新读取安全 Thread snapshot 后订阅。

连接断开不会隐式取消已经接受的 Turn；取消必须调用 `threads.cancel`。请求 ID 在单连接内不可重用，stream 和 subscription 受连接、session 和 Owner 范围约束。

## 错误

统一响应格式为：

```json
{
  "type": "response",
  "requestId": "request-1",
  "error": {
    "code": "THREAD_NOT_FOUND",
    "message": "Thread not found.",
    "retryable": false
  }
}
```

错误只返回稳定的 Owner error code，不暴露 HTTP body、数据库错误、凭据、路径或原始 runtime 信息。
