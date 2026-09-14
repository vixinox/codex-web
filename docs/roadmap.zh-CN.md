# 剩余工作

最后审阅：2026-09-14

本文档记录主线之外的剩余工作、优先级和验收标准。稳定架构基线见 [`../PROJECT.md`](../PROJECT.md)，当前任务范围见 [`../AGENTS.md`](../AGENTS.md)。

主线（Owner 客户端、Guest Page）已完成。以下按优先级排列，P0 完成前不要开始 P1，P1 完成前不要开始 P2。

## P0 · 恢复可信的绿灯

当前仓库在公开状态下不可验证：评审者 clone 后第一条命令即失败。以下四项缺一不可。

### P0-2 消除 `pnpm test:frontend` 竞态

**现象**：全量运行 1 failed / 241 passed；单独运行该文件 8/8 通过。

**位置**：`src/app/workspace/sidebar/use-workspace-sidebar-controller.test.tsx`，测试名 `does not reorder threads when selecting one changes its server timestamp`。

**根因**：`waitFor(() => expect(bridge.fetchThreads).toHaveBeenCalledTimes(3))` 在断言 model 之前返回，但此时 `rootThreads.status` 仍为 `loading`。断言的是调用次数，等待的却是状态收敛。

**验收**：`pnpm test:frontend` 连续 3 次退出码均为 0；单独运行仍通过。

**约束**：修 `waitFor` 的等待条件（等待 `rootThreads.status === 'ready'`），不要改断言期望值，也不要放宽为 `toMatchObject` 的部分匹配 —— 该测试保护的是「服务端时间戳变化不得重排 Thread」这一真实行为。

### P0-3 补充 LICENSE

**现象**：仓库公开且无 `LICENSE`，默认「保留所有权利」，与求职展示意图冲突。

**验收**：仓库根目录存在 `LICENSE`，`package.json` 的 `license` 字段与之一致。

## P1 · 展示面

README 已加入工作区截图。

### P1-2 README 首屏加截图

已将 startup mock 工作区截图归档至 `docs/assets/codex-web-workspace.png` 并加入 README；截图用临时页面已移除。

## P2 · Web Search 端到端

这是唯一同时覆盖前端、全栈与 AI 应用三线的题材：它沿现有架构延伸（协议 → 白名单投影 → native reducer → presentation model → renderer），不新增运行面，且有真实产品价值。

**当前状态**：只有展示管道，没有功能，且管道本身在半途截断。

| 环节              | 位置                                                 | 状态                                                         |
| ----------------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| 服务端 item 投影  | `server/codex/native-protocol.ts:184`                | 已投影 `query` 与 `action`                                   |
| `action` 归一化   | `server/codex/native-protocol.ts:299-303`            | 仅保留 `type`/`query`/`pattern`，**丢弃 `url` 与 `queries`** |
| presentation 适配 | `src/app/chat/projection/thread-presentation.ts:265` | 只取 `query` 作 title，**整个 `action` 被丢弃**              |
| 渲染              | `src/app/chat/transcript/thread-block.tsx:86`        | 按 `kind === 'search'` 渲染通用 activity 行                  |
| 开关              | 无                                                   | **无任何位置启用**                                           |

**锁定的 0.153.0 schema 实测**（`docs/vendor/codex-app-server/0.153.0/codex_app_server_protocol.v2.schemas.json`）：

```text
Config.web_search = WebSearchMode | null
WebSearchMode    = "disabled" | "cached" | "indexed" | "live"
Config.tools     = ToolsV2 | null
ToolsV2          = { web_search: WebSearchToolConfig | null }
WebSearchToolConfig = { allowed_domains?, context_size?("low"|"medium"|"high"), location? }
WebSearchLocation   = { city?, country?, region?, timezone? }
WebSearchAction  = 判别联合，按 `type` 三分：
  search     { type: "search",     query?, queries? }
  openPage   { type: "openPage",   url? }
  findInPage { type: "findInPage", url?, pattern? }
```

原生 item 形态为 `webSearch { id, query, action? }`，见 `docs/vendor/codex-app-server.md`（Item 列表项与紧随其后的 `webSearch.action` 说明段）。

**实施顺序**：

1. **服务端启用**。bridge 自行生成 `config.toml`：Owner 在 `server/codex/manager.ts:439-452`，Guest 在 `server/guest-manager.ts:303-322`。写入 `web_search` 模式与 `[tools.web_search]` 段。默认启用，不区分owner和guest，默认live。这一点与现有部分文档冲突，以这边为准，移除旧描述。
2. **补齐 `action` 投影**。`native-protocol.ts:299-303` 的 `action()` 现状丢弃 `url` 与 `queries`，使 `openPage` 退化为只有 `type` 的对象、`findInPage` 丢失目标页、`search` 丢失多查询。按 `WebSearchAction` 判别联合补全，不要无条件透传整个 `action` 对象 —— 该文件的职责是白名单投影。
3. **presentation 迁移 `action`**。`ChatActivity` 目前没有承载 search action 的字段（见 `src/app/chat/model/types.ts:21-37`）。新增字段后由 `thread-presentation.ts` 填充，renderer 只读取 UI model，不在 `thread-block.tsx` 解析原生字段。
4. **renderer 区分动作类型**。`search` / `openPage` / `findInPage` 应有可区分的展示；沿用 `activity-icon.tsx` 与 `thread-block.tsx` 现有分派，不为 search 单独建组件树。
5. **测试**。至少覆盖：`action` 归一化（含 `url`）、presentation 迁移。原生协议投影测试已存在于 `native-protocol.test.ts`，按同一风格扩展。

**边界**：

- 不要新增依赖。schema 与投影范式均已存在。

## 低优先级技术债

以下不阻塞上述任何阶段，空闲时处理：

- `@shadcn/react`（`package.json:31`）在 `src` 中零引用，可移除。`shadcn` 与 `tw-animate-css` 均被消费（`src/index.css:2-3`），不要一并删除。
- `madge` 与 `dpdm` 是 devDependency，但 `scripts` 中无任何命令消费它们（`package.json:67,70`）。要么接上一条依赖图校验命令，要么移除。
- `src/app/composition/screens/mock/` 三个文件共 863 行（其中 `fixtures/real-chat-fixtures.ts` 537 行），仅被 `startup-screen.tsx:6` 消费，用于 `/startup` 演示。
