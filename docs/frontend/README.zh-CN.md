# 前端边界

前端通过 `@/lib/bridge` 访问 Fastify REST/SSE；页面和 renderer 只消费 UI-facing model，不直接依赖原生 DTO、服务端 payload、宿主机路径或凭据。

API 契约见 [API 契约](../api/README.zh-CN.md)。稳定架构基线见 [PROJECT.md](../../PROJECT.md)。移动端访问策略见 [移动端访问策略](mobile-access.zh-CN.md)。

## 依赖方向

```text
app/main -> app/composition -> app/{chat,workspace,settings} -> lib/bridge
                                      |
                                      +-> components/ui -> lib/utils
```

- `app/composition` 负责路由、布局和领域组合，不直接调用 fetch、SSE 或数据库。
- `app/chat`、`app/settings`、`app/workspace` 负责各自领域 controller、reducer 和 renderer。
- `lib/bridge` 集中 HTTP/SSE、错误解析和原生协议适配。
- `components/ui` 只依赖通用库和 `lib/utils`，不访问 API、路由、认证或浏览器持久化。
- `lib/db` 是 server-only，不能进入浏览器图。

## 导航与状态

应用内导航使用 React Router；数据变化通过 controller、mutation、invalidate 或 refetch 处理，不使用整页重载。认证失效时清理本地状态并导航到 `/login`。

HTTP 响应用于确认命令是否被接受，SSE 事件用于更新 Turn/item 最终状态。Thread/Turn 不携带 Credential identity。Thread ID 以路由为准，不写入 localStorage；Turn 增量和 SSE 事件不写入 localStorage。

Guest 使用独立 `lib/bridge/http/guest.ts` transport、Better Auth anonymous session/cookie、`/guest-api/*` 与 Guest SSE，不调用 Owner `/api/*` transport。Owner 与 Guest 的 Thread/Turn 操作通过共享 Thread client interface 和各自 adapter 接入同一 availability、snapshot/status 与同步语义；adapter 不跨越认证、runtime、workspace 或权限边界。Guest 先读取安全 Thread snapshot，再以 snapshot 的 Guest event cursor 建立 SSE 并在重连后重放；展示仍使用 native reducer。Guest reset 必须清除本地 draft、选中的 skills/model/effort 和已选 Thread。Guest Projects 与 Archived chats 是不可用 UI 状态，不发送 Project、archive 或 restore 请求。

推荐状态：

```text
auth: unknown | authenticated | unauthenticated
connection: disconnected | connecting | connected | reconnecting | failed
thread: idle | loading | ready | starting | failed
turn: idle | queued | inProgress | interrupted | completed | failed
```

## SSE 数据流

```text
用户输入 -> POST /turns -> queued/starting
         -> SSE turn/started + item/*
         -> native reducer 按 itemId 聚合
         -> SSE turn/completed

用户问答 -> SSE item/tool/requestUserInput（瞬时待回答状态）
         -> POST /user-input/:requestId
         -> SSE webcodex/userInput/answered + serverRequest/resolved
         -> native reducer 按 requestId 物化为持久 transcript summary
```

- `item/agentMessage/delta` 按 `itemId` 追加。
- `item/completed` 覆盖对应 item。
- 同一个 SSE ID 只处理一次；重连重放不能重复文本。
- 首次打开 Thread 先读取 `eventCursor`，再用 `afterId` 建立详情流。
- 连接恢复后先读取 Thread 快照校正本地状态。
- 未知事件保留诊断信息，但不能让 Chat 崩溃。
- Thread snapshot 的合法 `model`/`reasoningEffort` 是 Composer Thread scope 的服务端真值；`thread/settings/updated` 只同步发生变化的对应字段。New Chat scope 保持独立缓存，Thread 缺失字段时保留该 scope 的本地选择。
- Owner accepted Turn ID 可用于 native transcript reconciliation；Guest accepted Turn ID 只是 queue/job 取消句柄。共享 pending seam 通过 adapter capability 区分二者，Guest job ID 不进入 native transcript identity。
- Thread 快照的 `historyEvents` 会重放原生快照未保留的命令与问答事件；问答请求、答案和结束事件必须在 native reducer 中归一化，renderer 不直接解释 bridge 事件。

## 显示与安全

- API key、绝对路径、内部 stack、原始凭据响应和不透明 provider payload 不进入 UI。
- 输入框、取消操作和错误状态必须可理解；图标按钮必须有可访问名称和 tooltip。
- 工具和文件事件按只读信息展示；审批能力以当前实际实现为准，不因协议事件存在而假设 UI 已开放。
- Guest composer 固定 `workspaceWrite` access，只有 `gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.5` 以及 low/medium effort 可用；没有附件和 Web Search。真实 Guest skill 列表只返回 name、display name、description、scope 与短期 handle，不返回技能文件路径。
- Guest 前端与 Owner 共用单一 `index.html` 和构建产物，通过 `/`、`/login`、`/app`、`/admin` 路由及 capability 分流，不加载 Guest 不可用的 Credential、Project picker 或 Owner runtime 页面。Guest 仍复用 `WorkspaceSidebar`、`SettingsSidebar`、`ComposerInput` 和通用聊天 renderer；Projects 区域保留统一的 Owner-only 不可用提示，Archived chats 与 Appearance 设置在 Guest capability 下隐藏，避免维护两套样式实现。
- 主题使用语义 token，不在业务组件中新增具体颜色值；主题解析保持为确定性纯逻辑。

## 验证

UI、CSS、renderer 和页面布局使用类型检查、触及文件的 `oxfmt --check` 和手工浏览器回归。transport、安全投影、controller、SSE 和纯逻辑改动使用定向测试（如有）、类型检查和格式检查。除非明确要求，不添加 React DOM、renderer、页面流程、Playwright、截图或视觉自动化测试。
