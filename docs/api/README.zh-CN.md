# Codex Web API 契约

浏览器只调用 Fastify bridge 的 REST/SSE 接口，不直接连接 Codex App Server。Base URL 为 `http://127.0.0.1:3000`；Better Auth session cookie 由浏览器自动发送。

`/guest-api/*` 是独立的匿名 Guest API。它只接受 Better Auth anonymous session/cookie，并使用独立的 guest lease 管理 workspace、quota、任务和 reset；lease 不是身份凭据。Guest 不能访问 Owner 的 `/api/*`、Project、Credential、Codex runtime 或 Thread 数据。Guest 使用 `pnpm server:guest`，Owner 使用 `pnpm server:owner`，两者不共享 workspace、凭据或 runtime，也不存在 combined 模式。

## 边界

- 所有接口以当前 session 确定用户身份；未认证请求返回 `401 UNAUTHORIZED`。
- `projectId`、`threadId` 和 `credentialId` 只能引用当前用户资源。
- 浏览器永远不会收到 API key、`CODEX_HOME`、宿主机路径、rollout 路径或 App Server 进程信息。
- `input` 保留 Codex 原生 Turn input 语义；前端不得提交任意宿主机路径。
- 事件保留原生 `method + params`，bridge 只增加 SSE envelope。

## 认证与资源

## Guest session 与工作区

| 方法           | 路径                                                      | 用途                                          |
| -------------- | --------------------------------------------------------- | --------------------------------------------- |
| `POST`         | `/guest-api/session`                                      | 签发新的 24 小时 guest lease                  |
| `GET`          | `/guest-api/session`                                      | 读取当前 guest lease 与受限 runtime 声明      |
| `GET`          | `/guest-api/capacity`                                     | 读取当前 lease 与全局准入容量（实际用量与剩余量） |
| `GET` / `POST` | `/guest-api/threads`                                      | 列出或创建当前 lease 的 Thread/首个 Turn      |
| `GET`          | `/guest-api/threads/:guestThreadId`                       | 读取安全投影 Thread 快照与历史事件            |
| `GET`          | `/guest-api/threads/:guestThreadId/status`                | 读取恢复状态                                  |
| `POST`         | `/guest-api/threads/:guestThreadId/turns`                 | 以受限 workspaceWrite 启动 Turn               |
| `POST`         | `/guest-api/threads/:guestThreadId/turns/:turnId/cancel`  | 取消当前 Turn                                 |
| `POST`         | `/guest-api/threads/:guestThreadId/compact`               | 压缩 Thread                                   |
| `POST`         | `/guest-api/threads/:guestThreadId/user-input/:requestId` | 回答非 secret 工具问答                        |
| `GET`          | `/guest-api/events?threadId=&afterId=`                    | Guest 专用 SSE 流                             |
| `GET`          | `/guest-api/skills`                                       | 列出只读镜像中可用的 Guest skills             |

Better Auth anonymous session cookie 承载 Guest 身份，使用标准 HttpOnly session cookie；Guest lease 是关联 user 的 24 小时业务实体，用于 workspace、quota、任务和 reset，不是 owner `/api/*` 的身份凭据。公开 Thread UUID 只映射当前 active lease，跨 lease、过期、Reset 或猜测 ID 一律返回 `GUEST_THREAD_NOT_FOUND`。Session runtime 声明中的 `modelContextWindow` 是 Guest Composer 的独立 context-window fallback，来自 `GUEST_MODEL_CONTEXT_WINDOW`（默认 `256000`），不等同于每日 quota 或 `maxTokensPerTurn`，也不读取 Owner configuration API。

Guest Thread/Turn 固定由专用 Guest App Server 运行，`approvalPolicy: never`、`workspaceWrite` writable root 和 `networkAccess: false` 不可由浏览器覆盖。Agent 可在 lease 私有 workspace 内有限读、写、执行；浏览器没有 command、filesystem、process、Credential、Project、MCP 或 Plugin 管理 API。锁定 `0.153.0` schema 未定义 `readOnlyAccess`，bridge 不传递猜测的 read-root 格式；Windows 平台额外要求 `windowsSandbox/readiness=ready`，Linux 使用受管 runtime 自带的 `bwrap` sandbox，服务均在 sandbox 未就绪时 fail-closed。Reset/过期会停止任务、软删除 Guest/Thread/job 并删除该私有 workspace；审计记录、事件和用量保留。

Guest 创建 Thread 或启动 Turn 返回的 `turnId` 是 Guest queue/job 的公开取消句柄，不是 App Server native transcript Turn ID。客户端只用它调用 Guest cancel endpoint；transcript identity 以安全 Thread snapshot/SSE 中的 native Turn 投影为准。两类 ID 不得互相写入或比较。

| 方法     | 路径                                  | 用途                         |
| -------- | ------------------------------------- | ---------------------------- |
| `POST`   | `/api/auth/sign-up/email`             | 创建首个本地 owner           |
| `POST`   | `/api/auth/sign-in/email`             | 登录                         |
| `GET`    | `/api/auth/get-session`               | 恢复 session                 |
| `GET`    | `/api/auth/bootstrap`                 | 查询 owner 是否存在          |
| `POST`   | `/api/auth/sign-out`                  | 退出                         |
| `GET`    | `/api/me`                             | 获取当前用户                 |
| `GET`    | `/api/projects`                       | 获取 Project                 |
| `POST`   | `/api/projects`                       | 创建受控 Project             |
| `GET`    | `/api/credentials`                    | 获取脱敏 Credential 和当前项 |
| `POST`   | `/api/credentials`                    | 保存 Credential              |
| `PUT`    | `/api/credentials/current`            | 选择默认 Credential          |
| `POST`   | `/api/credentials/:credentialId/test` | 测试 Credential              |
| `DELETE` | `/api/credentials/:credentialId`      | 删除 Credential              |

Project 是按受控 `cwd` 建立的逻辑分组；删除 Project 不删除目录、文件或 Thread。Credential 响应只包含 `id`、provider、baseUrl 和时间字段，绝不返回 API key。

## Codex runtime

| 方法   | 路径                                | 用途                |
| ------ | ----------------------------------- | ------------------- |
| `GET`  | `/api/codex/status`                 | 获取 runtime 状态   |
| `POST` | `/api/codex/start`                  | 启动 runtime        |
| `POST` | `/api/codex/restart`                | 重启 runtime        |
| `GET`  | `/api/configuration/context-window` | 读取 context window |
| `PUT`  | `/api/configuration/context-window` | 更新 context window |

`credentialId` 可选；省略时使用持久化的 `currentCredentialId`。启动必须显式确认 `danger-full-access`。当前用户没有 Credential 时返回 `409 CODEX_PROFILE_REQUIRED`，缺少确认时返回 `428 CODEX_DANGEROUS_ACCESS_CONFIRMATION_REQUIRED`。

## Thread 与 Turn

| 方法   | 路径                                           | 用途                             |
| ------ | ---------------------------------------------- | -------------------------------- |
| `GET`  | `/api/threads`                                 | 获取当前用户 Thread              |
| `POST` | `/api/threads`                                 | 创建 Thread                      |
| `GET`  | `/api/threads/:threadId`                       | 读取 Thread 快照                 |
| `GET`  | `/api/threads/:threadId/status`                | 获取恢复所需的轻量状态           |
| `POST` | `/api/threads/:threadId/turns`                 | 启动 Turn                        |
| `POST` | `/api/threads/:threadId/turns/:turnId/cancel`  | 取消 Turn 或排队任务             |
| `POST` | `/api/threads/:threadId/user-input/:requestId` | 提交工具问答并持久化安全答案事件 |
| `POST` | `/api/threads/:threadId/approvals/:requestId`  | 响应审批请求                     |

Thread 响应不返回 `cwd`、rollout 路径或 Git remote。读取响应为 `{ thread, eventCursor, historyEvents }`；服务端按受控 Project 校验归属并投影安全字段。安全 Thread 投影可包含白名单内的 `model` 与 `reasoningEffort`；缺失、超长或不受支持的值会被省略。Turn 最终状态以 SSE 的 `turn/completed` 为准。

`historyEvents` 只包含当前用户、当前 Thread、保留窗口内经过安全投影且需要补齐原生 Thread 快照的事件：Thread model/effort 设置更新、命令执行生命周期，以及用户问答的 `item/tool/requestUserInput`、`webcodex/userInput/answered`、`serverRequest/resolved`。Guest 还可能收到 bridge 自有的 `webcodex/guest-token-limit`，其参数严格为 `threadId`、`turnId`、`maxTokens` 和可选 `actualTokens`；前端将它渲染为当前 Turn 内独立的 system activity。`webcodex/userInput/answered` 是 bridge 自有事件，用于持久化 App Server 的 resolved 通知未携带的已提交答案；前端按 `requestId` 将请求、答案和结束事件归一为稳定的 transcript summary。`eventCursor` 是当前 Thread 最后一条历史事件 ID，而非用户级最后 ID，因此跨 Thread 事件不会导致 SSE 漏事件；查询快照与响应之间产生的新事件仍通过 SSE 补回。每个用户 Thread 最多保留最近 1000 条事件，旧的按事件 ID 滚动删除。`historyEvents` 不含 API key、绝对路径、stack 或 raw rollout 字段。

## SSE

```http
GET /api/events?threadId=thread-id&afterId=123
Accept: text/event-stream
Last-Event-ID: 123
```

连接后先收到 `: connected`，事件格式为：

```text
id: 124
event: item/agentMessage/delta
data: {"method":"item/agentMessage/delta","params":{}}
```

规则：

- `id` 是 bridge 事件 ID，不是 JSON-RPC request ID。
- `event` 等于消息 `method`；没有 method 时为 `message`。
- `data` 是原生 `{ method, params }` envelope。
- `threadId` 过滤 Thread；`scope=workspace` 接收当前用户的 workspace lifecycle 事件。
- 首次连接使用 Thread 快照的 `eventCursor` 作为 `afterId`，重连使用最后收到的 `Last-Event-ID`。
- 游标必须是非负安全整数；非法游标返回 `INVALID_EVENT_CURSOR`。
- 前端按 Codex item ID 聚合 delta，`item/completed` 是最终事实来源；bridge 不生成 UI block。问答是例外：bridge 发布 `webcodex/userInput/answered` 补足原生 `serverRequest/resolved` 缺失的答案字段，UI block 仍由前端投影生成。

前端应处理 `thread/started`、`thread/settings/updated`、`thread/tokenUsage/updated`、`turn/started`、`item/started`、`item/agentMessage/delta`、`item/completed`、`turn/completed`、`turn/diff/updated`、审批 request、`serverRequest/resolved`、`error` 和 `warning`。Guest 前端还应处理 `webcodex/guest-token-limit`，并将其作为 system activity 显示，而不是覆盖原生 turn error。`thread/settings/updated` 的浏览器投影只包含 `threadId` 及合法时的 `model`、`reasoningEffort`，不透传原始 `threadSettings`。同一 SSE ID 只处理一次。

Guest SSE 使用同一 envelope 与 cursor 规则，但路径为 `/guest-api/events`，cursor 只来自当前 Guest Thread 的 `guest_event`；不得与 Owner `codex_event` 或 Owner `/api/events` 混用。Guest 只安全投影普通且非 secret 的 `item/tool/requestUserInput`，所有 approval、permission、command、file、network、MCP、dynamic-tool 或未知 server request 都由服务端拒绝，绝不转发到浏览器。Guest capacity 的每日剩余量始终为 `limit - used`，`maxTokensPerTurn` 仅表示单轮硬上限，不参与准入 headroom 或 reservation。

## 错误

统一格式：

```json
{ "error": { "code": "INVALID_PROJECT", "message": "..." } }
```

常见处理：

| HTTP  | code                                           | 前端动作                |
| ----- | ---------------------------------------------- | ----------------------- |
| `400` | `INVALID_PROJECT` / `INVALID_CREDENTIAL`       | 显示表单或请求错误      |
| `401` | `UNAUTHORIZED`                                 | 清理 session 并跳转登录 |
| `404` | `CREDENTIAL_NOT_FOUND` / `THREAD_NOT_FOUND`    | 刷新资源或显示不存在    |
| `502` | `CODEX_UNAVAILABLE` / `CREDENTIAL_TEST_FAILED` | 显示可重试错误          |
| `500` | `INTERNAL_ERROR` / `AUTH_FAILURE`              | 显示通用错误            |

错误不得展示 stack、数据库错误、API key、宿主机路径或完整环境变量。
