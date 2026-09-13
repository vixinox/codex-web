# Transcript 渲染架构

本文档描述当前 Chat transcript 的真实前端实现。它记录数据边界、状态归一化、组件职责和流式渲染行为；协议字段的完整定义仍以 [API 契约](../api/README.zh-CN.md) 和 `src/app/chat/native` 为准。

## 总体路径

Transcript 遵循单向数据流：

```text
Fastify bridge snapshot/SSE
        |
        v
useThreadDetailController
        |
        v
ThreadSession (native state + reducer)
        |
        v
toChatThreadPresentation / toChatTurnPresentation
        |
        v
ChatThreadPresentation
        |
        v
ThreadAssets
  └─ SessionThreadTurn / ThreadTurn
       ├─ UserContent
       ├─ WorkSummary + Collapsible
       ├─ ThreadBlock[]
       │    ├─ StreamingAssistant -> MessageContent
       │    ├─ ActivityRow / ActivityBatch
       │    ├─ FileActivityBlock
       │    └─ article/error/user
       ├─ QuestionnaireSummary / PendingStatus
       ├─ final plan
       └─ error / copy actions
```

页面和 renderer 只接收 `ChatThreadPresentation`、`ChatTurnPresentation` 及其子类型，不直接读取 native DTO、bridge payload、SSE method 或宿主机信息。

## 数据进入与归一化

`useThreadDetailController` 负责 Thread 的生命周期，而不是渲染：

1. 等待 bridge availability，读取安全 Thread snapshot 和 `eventCursor`。
2. 将 snapshot 的 `historyEvents` 重放到 session，再以 `replayAfterId` 建立 SSE 订阅。
3. SSE 按事件 ID 去重；断线恢复时先读取 status，必要时重新 hydrate snapshot。
4. 未知或格式错误事件转换为 protocol error，由 reducer 记录，不能让 transcript 崩溃。

`thread-session-store.ts` 保存每个 Thread 的 native 状态和可变 presentation 缓存。完整 hydrate 时按原生 turn 顺序同步；局部事件只重新投影受影响的 turn，并更新 `turnOrder`、`latestUserBlockId`、busy、compaction 和 user-input 等派生状态。session snapshot 通过 `useThreadSessionSnapshot` 提供稳定的 React 订阅结果。

`thread-presentation.ts` 是 native DTO 到 UI model 的唯一主要适配层：

- 白名单化 model/reasoning effort、状态、时间和 token usage。
- 将原生 item 归一为 `ChatBlock`：user、assistant、activity、context-compaction article、error。
- 按连续 activity kind 聚合为 activity block，并补充 command、file diff、状态、输出和脱敏后的展示字段。
- 从原生 plan 和 diff 生成 `ChatPlanPresentation` 与 diff 统计。
- 将用户输入中的 text、skill、mention、image、audio 转换为 `ChatUserContent`，并移除注入的 skill marker。
- 将问答请求和已回答/已 resolved 事件归一为 questionnaire summary；renderer 不解释 bridge 事件。

## ThreadAssets 容器

`ThreadAssets` 是 transcript 的列表容器和滚动协调器：

- 使用 session 的 `turnOrder` 渲染 turn；没有 session 时使用传入 presentation 的 turn 数组。
- session 模式下每个 turn 由 `SessionThreadTurn` 按 ID 读取，避免父组件为每个 SSE 增量重建全部 turn 对象。
- 只把最后一个 turn 的 `retryState` 和 pending questionnaire 传入。
- 监听实际可滚动父节点的 scroll/resize。用户位于底部时保持自动滚动；用户向上阅读时锁定位置。
- 新 user block、compacting、retry 或 `lockEpoch` 请求会重新获取底部锁定并滚动到底部。
- 通过 `sameTurnShape` 比较 thread/turn identity，在 session 模式下避免仅因 metadata 变化而重排 transcript。
- 空列表显示新对话占位；独立的 `compacting` 状态在尚无 compaction turn 时显示 `LiveRow`。

## ThreadTurn 的展示规则

`ThreadTurn` 将一个 presentation turn 切成稳定的视觉区域：

1. 第一条 user block 渲染为右对齐气泡，并提供复制文本和时间。
2. 其余非 final assistant blocks 进入 process 区域。reasoning summary activity 在 renderer 前过滤。
3. process 区域按原有 block 顺序渲染，并放入可折叠容器；turn 工作中自动展开，完成后默认收起。
4. `WorkSummary` 根据 turn 状态、耗时、活动和 compaction 状态显示摘要。只有存在可展开详情时才显示折叠触发器。
5. questionnaire summary 只渲染一次；pending questionnaire 在工作中的 turn 下显示等待回答状态。
6. 最后的 `assistant` final block 单独渲染，避免与过程消息混在工作详情中。
7. final plan 渲染 explanation、markdown text 或步骤列表；turn error 以 alert 展示。
8. 完成的 turn 在存在 assistant 文本时提供复制响应和时间。

`visibleTurnContent` 根据已提交的完整 markdown block、article、非 reasoning activity、questionnaire 和 final plan 计算可见内容、revision 和 trailing assistant。未闭合的 assistant 尾部始终留在 pending，直到终态 flush；`Thinking` 只在工作中且尚未收到 assistant 文本时显示，因此 activity-only turn 保留提示，而纯文本输出开始后直接移除，不依赖 assistant block 动画完成状态。

turn 进入 terminal 状态时，`StreamingAssistant` 只 flush 尚未提交的合法尾部。预览文本和 flush 后的 block 使用相同位置与 block identity，不会因为 `animate` 从 true 切换为 false 而重新播放历史内容。

## ThreadBlock 与活动渲染

`ThreadBlock` 只做 `ChatBlock` 到视觉组件的分派：

- assistant 使用 `StreamingAssistant`，完成文本交给 `MessageContent`。
- article 使用轻量的 context-compaction 行。
- error 使用 alert 行；user 使用紧凑气泡。
- activity block 按 kind 选择普通 activity 行、批量折叠、命令输出、文件变更和 diff 展示。
- 多活动 block 在仍有 running activity 时自动展开；完成后允许用户折叠。
- command、file path、diff header 和 markdown 等展示细节由 transcript 下的专用 helper 处理，避免把格式化逻辑放进容器组件。

`TranscriptCollapsibleContent` 统一折叠动画和高度约束，使 process、问答详情、活动批次和文件详情使用同一行为。

assistant Markdown block 在 turn 进行中按完整 Markdown 边界提交：已经闭合的 block 立即进入 transcript 并以整块透明度淡入，未闭合的 pending 尾部继续留在内存中，不展示 broken Markdown。turn 进入终态时只 flush 尚未提交的最后 block；历史 completed turn 直接显示，不重复播放进入动画。`MarkdownBlockView` 每收到一个新 block 执行一次 GSAP opacity enter，代码块、表格和普通文字使用相同的整块行为；GSAP 不使用 `x`、`y` 或 `transform`。reduced-motion 下直接完成。

开发环境可通过 `[transcript]` console 日志观察 event、turn、split、render 和 gsap 阶段。日志只包含 ID、状态、数量、长度和布尔值，不包含正文、原始 payload、路径、凭据或 workspace 信息。

## Owner 与 Guest

Owner 和 Guest 使用各自 bridge/thread adapter，但共享 session、presentation model 与 transcript renderer。Guest 的 queue/job turn ID 仅用于取消，不进入 native transcript identity；展示始终依赖 snapshot/SSE 中的 native turn projection。Guest capability 通过上层 controller 和 composer view model 限制可用操作，`ThreadAssets` 不按 runtime 分支，也不接触认证、workspace 或凭据。

## 修改边界与验证

- 新增协议字段时，先在 native reducer/presentation adapter 中完成白名单化，再让 renderer 消费 UI model。
- 不在 `ThreadAssets` 或 `ThreadBlock` 中解析 SSE method、原生 item 或服务端错误 payload。
- 影响 renderer、CSS 或布局时运行 `pnpm typecheck`、触及文件的 `oxfmt --check`，并进行手工浏览器回归。
- 影响 reducer、projection、SSE 或 session 时运行对应定向测试，再运行 `pnpm typecheck` 和 `oxfmt --check`。
- 不新增 React DOM、Playwright 或截图测试，除非任务明确要求。
