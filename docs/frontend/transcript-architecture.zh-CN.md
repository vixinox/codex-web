# Transcript 渲染架构

本文记录当前 Chat transcript 的数据边界、状态归一化和 renderer 职责。Owner wire contract 以[API 契约](../api/README.zh-CN.md)为准；本文只说明前端消费路径。

## 总体路径

```text
Owner threads.read snapshot + watermark / conversation.change stream
        |
        v
useThreadDetailController
        |
        v
ThreadSessionRegistry / ThreadSession
        |
        v
shared Conversation state + applyConversationDelivery
        |
        v
conversation-presentation.ts -> ChatThreadPresentation
        |
        v
ThreadAssets -> ThreadTurn -> ThreadBlock / activity renderers
```

页面与 renderer 消费 UI-facing presentation model，不解析 Owner method、wire envelope 或 Codex App Server DTO。跨端的 Conversation types 和 reducer 位于 `packages/conversation`；App 的具体转换和会话资源归 App 所有。

## 数据进入与会话状态

- `use-thread-detail-controller.ts` 请求 `threads.read`，取得 snapshot/watermark，并从同一游标开始订阅 `conversation.change`。
- `thread-session-store.ts` 中的 `ThreadSessionRegistry` 管理 Thread session 生命周期、引用与数量上限；单个 session 保存共享 Conversation state 和当前展示快照。
- `conversation-state.ts` 将 Owner delivery 交给共享 Conversation reducer；事件 identity/application sequence 用于顺序和去重。
- 网络断开或 cursor reset 时 controller 重新读取权威 snapshot 并重建订阅，不在旧内容上重复追加历史事件。
- Composer 草稿和控制器生命周期由相邻的 composer/session 模块管理，不属于 renderer。

## Presentation 与 renderer

`conversation-presentation.ts` 将共享 Conversation snapshot/turn/activity/message 转换为页面模型，包括可展示的 user content、activity group、plan、markdown 和 error 状态。新增共享 Conversation 成员时，先扩展协议 parser/reducer 与该投影，再由 renderer 展示对应 UI。

`ThreadAssets` 是消息列表容器和滚动协调器，按稳定 turn identity 呈现 session 内容。`ThreadTurn` 组织 user、处理中间活动、最终 assistant response、问答状态和错误；`ThreadBlock` 按 presentation block 类型分派到 markdown、活动、文件变更及轻量文章组件。格式化 helper 留在 transcript 子模块，避免容器组件拥有协议语义。

流式 Markdown 保留未闭合尾部，只有完整 block 才进入展示；terminal turn 收尾时再 flush 合法尾部。完成内容不在重渲染时重新播放进入动画。滚动规则区分用户正在底部跟随与向上阅读两种状态。

## 修改与验证

- 不让 renderer 解析服务端 DTO、Owner method 或 event cursor；转换责任留在 controller、共享 reducer 和 presentation 层。
- 影响纯状态转换或投影时运行对应 App focused test；影响 controller、transport 或 security projection 时运行相关测试。
- 影响 renderer、CSS 或布局时运行 `pnpm typecheck`、触及 TypeScript 文件的 `oxfmt --check`，并进行手工浏览器回归。
- 不新增 React DOM、Playwright、截图或视觉自动化测试，除非用户明确要求。
