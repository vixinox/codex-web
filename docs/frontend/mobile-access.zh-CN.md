# 移动端访问策略

本文记录"拒绝移动端访问"这一诉求的现状、HTML 级方案的实测结论，以及推荐的分层落地方式。评价部分标注为判断；实测部分标注了验证方式。

相关文档：[前端边界](README.zh-CN.md)、[API 契约](../api/README.zh-CN.md)、[PROJECT.md](../../PROJECT.md)。

## 1. 结论

- 现状只有一层**前端 React 渲染前的视口判断**，属于 UX 层软拒绝，不构成访问控制。
- 用户直觉中的两种 HTML 级做法（移除 `script[type=module]`、`window.stop()`）**实测均不可靠**：前者完全无效，后者截断文档解析。
- HTML 级唯一稳健形态是**在 `<head>` 内联经典脚本里 `location.replace()` 到独立静态页**。
- 但 HTML 级仍不是边界：Fastify 只提供 JSON API，不托管 HTML（`server/http/server-base.ts` 仅注册 `sensible` 与日志/错误钩子；`server/` 无静态托管依赖），HTML 由 Vite 与构建产物提供。
- 推荐分工：**Cloudflare 边缘层负责设备准入（真阻断）；仓库内保留一个轻量 HTML gate 负责本地/无 CDN 场景与提示页。**

## 2. 现状（实测）

| 项       | 事实                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------ |
| 闸门     | `src/app/main.tsx:32-33`，判在 `<Routes>` 之前，覆盖 `/`、`/login`、`/admin/*`、`/app/*`、错误页全部路由 |
| 判定     | `src/lib/platform/browser/use-mobile.ts`（15 行），订阅 `(max-width: 767px)`，快照取 `innerWidth < 768`  |
| 提示页   | `src/app/composition/screens/mobile-unsupported-screen.tsx`（21 行），纯静态，**无 escape hatch**        |
| 服务端   | 全仓无 UA / Client Hints 判定；`server/config.ts:109` 强制 loopback                                     |
| CSS      | `src/index.css` 仅有 `prefers-reduced-motion`、`hover: hover` 两处 `@media`，无 767px 拒绝样式           |
| 覆盖缺口 | 手机需先下载并执行 `index-*.js` 1.5 MB（gzip 476 KB）+ CSS 108 KB（gzip 16.9 KB）才被拦住                |

判定口径的两个固有缺陷：

- 误伤：桌面窗口缩到 <768px（分屏、拖窄）被完全挡住且无出路。
- 漏放：手机横屏或小尺寸平板视口 ≥768px 时直接进入未适配布局。

## 3. HTML 级方案实测

headless Chrome 152，本地 fixture（`<head>` 内联经典脚本，判定 `matchMedia('(max-width: 767px)')`，视口 420×800）。

| 做法                          | 实测结果                                                                     | 可用性                 |
| ----------------------------- | ---------------------------------------------------------------------------- | ---------------------- |
| 移除 `script[type=module]`    | 标签确实移除（`0` 个残留），**模块照常执行**（`moduleRan: true`）；内联与外链两种形态均如此 | 无效                   |
| `window.stop()`               | 模块未执行，**但 `document.body === null`**，没有可渲染的提示 UI              | 不可用                 |
| 纯 CSS `@media` 遮蔽          | 内容隐藏，但 JS 执行且 `/api/me` 正常发出                                     | 仅视觉                 |
| `location.replace()` 到静态页 | 导航成功，文档被替换；`/app.js` 仍被请求一次（解析器在导航提交前继续推进）     | **稳健，推荐形态**     |
| 现状 React 级                 | 全量 bundle 下载并执行后才拦                                                 | 最弱                   |

Vite 8.3.0 实测：`index.html` 中的内联经典脚本在 `vite build` 后**原样保留**，`public/*.html` 原样拷贝到输出目录，因此该方案不需要改 `vite.config.ts`。

落地原型实测（构建产物与 Vite dev 两种模式均验证）：

| 场景                     | 结果                                    |
| ------------------------ | --------------------------------------- |
| 420px 视口访问 `/`       | 跳到 `/unsupported.html`，应用未执行    |
| 1280px 视口访问 `/`      | 正常进入应用                            |
| 420px + 已选择"仍要继续" | 正常进入应用（localStorage 逃生开关生效） |

## 4. 推荐做法

### 4.1 边缘层：Cloudflare 负责真阻断

免费套餐可用性（据 Cloudflare 文档）：Single Redirects 每 zone 10 条、Custom Rules 5 条，二者**均不支持正则**（正则需 Business+）；Snippets **免费套餐不可用**（Pro 起）。可用字段：`http.user_agent`、`http.request.headers`、`http.cookie`（`http.request.cookies` 映射需 Pro）。**不能用 Snippets 兜底。**

推荐一条 Single Redirect 规则（302 到静态提示页）：

```text
(http.request.uri.path eq "/" or http.request.uri.path eq "/login" or
 http.request.uri.path eq "/startup" or
 starts_with(http.request.uri.path, "/app") or
 starts_with(http.request.uri.path, "/admin"))
and not http.cookie contains "codex_web_desktop=1"
and (
  http.request.headers["sec-ch-ua-mobile"][0] eq "?1"
  or http.user_agent contains "Android"
  or http.user_agent contains "iPhone"
  or http.user_agent contains "Mobile"
)
```

要点：

- 路径白名单限定在文档请求，避免把 `/assets/*`、`/api/*` 一起重定向。
- `Sec-CH-UA-Mobile` 在 Chromium 属低熵提示、默认发送且无需 `Accept-CH`；**Safari/Firefox 不发送**，因此必须回落 UA 匹配。UA 可伪造，此层定位是"防君子 + 审计"，不是硬安全边界。
- iPadOS 13+ 默认以桌面 UA（`Macintosh`）上报，上述 UA 匹配不会命中；如需覆盖 iPad，单靠 UA 做不到，应接受漏放或补设备尺寸信号。
- 若还要拒绝移动端直连 API，再加一条 Custom Rule：同条件对 `/api/*`、`/guest-api/*` 返回 403。注意这会连带影响该设备的所有 API 调用，需确认可接受。
- 逃生开关必须**同时写 cookie 与 localStorage**（cookie 供边缘规则读取，localStorage 供仓库内 gate 读取），否则边缘与前端判断不一致，会出现"点了继续仍被重定向"的循环。

### 4.2 仓库内：轻量 HTML gate

保留一个最小 gate，覆盖本地开发（无 CDN）与边缘规则失效场景，并承载提示页：

1. `index.html`：在 `<meta name="viewport">` 之后、module 脚本**之前**插入内联经典脚本：`matchMedia('(max-width: 767px)')` 命中且未 opt-in 时 `location.replace('/unsupported.html')`。不要尝试移除 module 标签（实测无效）。
2. 新增 `public/unsupported.html`：静态提示页，"仍要继续"链接写入 cookie + localStorage 后回 `/`。
3. `index.html` 增加 `<noscript><meta http-equiv="refresh" content="0;url=/unsupported.html" /></noscript>`。
4. 删除 React 层实现，避免第二套约定：`src/app/main.tsx:32-33` 两行、`mobile-unsupported-screen.tsx`、`use-mobile.ts`（全仓仅 `main.tsx` 一处消费该 hook）。

## 5. 顺带解决的问题

- 手机不再下载并执行 1.5 MB 主 chunk；只有首次导航早于跳转的那次 `/app.js` 请求无法避免。
- 禁用 JS 的客户端此前得不到任何提示（React gate 不会执行），`<noscript>` 补齐。
- 窄窗桌面用户此前零出路，逃生开关解决误伤。
- `use-mobile.ts` 中"订阅用 `matchMedia`、快照用 `innerWidth`"的不一致（Windows 经典滚动条下二者可差约 15px，出现订阅触发但快照不变的区间）随该文件删除而消失。
- React gate 会在 App 组件内返回提示页，而 HTML gate 让应用完全不进入渲染，不存在半渲染状态。
- Vite 无需配置变更：内联脚本保留、`public/` 原样拷贝均已实测。

## 6. 未验证 / 待确认

- Cloudflare 侧未实际配置验证；表达式按文档编写，需在 dashboard 的表达式编辑器中确认字段与函数在目标套餐下可用。
- 本仓库不托管 HTML，因此边缘规则与仓库内 gate 的判定信号（UA/CH 与视口宽度）**天然不一致**：横屏手机视口 ≥768px 时仓库内 gate 放行、边缘规则拦截。若要严格一致，需以边缘规则为准，并接受本地开发无此拦截。
- 是否对 `/api/*` 做设备维度硬拒绝属于产品决策：Guest 的真实威胁是额度滥用而非设备类型（见 [Guest 滥用防护评估](../guest/abuse-mitigation.zh-CN.md)），按设备准入与该既定方针需明确取舍后再落地。
