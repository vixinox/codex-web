# Codex Web API 契约

> 本文定义 REST、WebSocket 与 Relay 相关 API 合同。认证和远程 onboarding 的当前实现快照见 [`../current-behavior.md`](../current-behavior.md)。

Owner 业务统一通过版本化 WebSocket 提供。浏览器、桌面端和远程控制端都连接同一个 Owner Gateway；远程连接经 Relay E2EE transport 接入，不重新模拟 HTTP request/reply。

## HTTP 外围

HTTP 只保留不属于 Owner 核心业务协议的入口：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/health` | 进程存活检查 |
| `GET` | `/ready` | 依赖和事件 store 就绪检查 |
| `GET` | `/metadata` | 产品、协议版本和公开能力 |
| `GET` | `/api/auth/bootstrap` | 本地首次 Owner 创建发现 |
| `POST` | `/api/auth/owner-security/setup` | 已登录本机 Owner 首次设置 TOTP，返回 setup URI |
| `POST` | `/api/auth/owner-security/verify` | 本机首次 TOTP 验证并返回一次性 recovery codes |
| `POST` | `/api/auth/owner-security/complete` | 确认 recovery codes 已保存并持久完成首次安全初始化 |
| `GET` | `<Relay origin>/owner-code/:9-digit-code` | 查询 Relay 内存中的在线 Owner 映射，公开只读、CORS、no-store |

不再提供 credential、project、configuration、codex、skills、thread、event、auth session 或 `/api/me` REST/SSE 业务路由。

## Owner WebSocket

连接使用 `@codex-web/protocol/owner` 的 UTF-8 JSON frame。`hello` 必须是首帧；服务端返回 `ready`，随后接受 `request`、`cancel` 和服务端的 `response`、`notification`、`stream.*`。

主要方法命名空间：

```text
owner.status
owner.bootstrap.create
owner.session.open
owner.session.close
owner.login.verifyTotp
owner.login.verifyRecoveryCode
owner.login.rollback
owner.loginQr.issue
owner.loginQr.cancel
owner.loginQr.redeem
owner.security.recovery.acknowledge
owner.code.show
owner.code.rotate
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
remote.trust.reset
```

业务方法只返回安全 DTO。响应、事件和错误不得包含 API key、绝对路径、Codex Home、rollout 路径、App Server 进程信息、原始 Codex payload 或 stack。

## 认证与权限

首次 Owner 创建只能来自本地、可信 Origin。创建后需完成 TOTP setup、TOTP 验证和 recovery code 保存确认。普通远程登录先以 owner-code 定位在线节点，再通过 E2EE login-candidate 提交 email/password 和 TOTP 或 recovery code；未认证连接不能调用 Owner 业务方法。首次 Owner fingerprint 必须与本机管理页显示值核对。

已认证 Owner 可签发一个当前有效期为 5 分钟的一次性 QR；再次签发、取消、Owner 重启、trust epoch 变更或成功兑换都会使原 capability 失效。QR 兑换绑定当前 E2EE 客户端公钥，创建 session 与设备记录后提升为 paired admission。Relay 只转发 opaque E2EE 帧。

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
