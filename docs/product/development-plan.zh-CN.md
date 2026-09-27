# Codex Web 开发主线

## 目标

交付一个可从单一 Web origin 使用的 Codex 工作台：

```text
打开站点
  -> 检查当前实例
  -> Owner 登录或 Guest 试用
  -> 查看 Thread
  -> 发起 / 取消 Turn
  -> 接收 SSE 进度
  -> 移动端断线后恢复正确状态
```

产品采用“一个部署对应一个 origin”的模型。当前不做实例列表、实例切换、跨 origin 会话迁移或 Hosted 服务。

## 阶段总览

| 阶段 | 目标 | 状态 | 进入条件 |
| --- | --- | --- | --- |
| 0. 现有基线 | Owner/Guest 隔离、Thread/Turn、REST/SSE、安全投影可作为稳定底座 | 已完成 | 现有测试和规范可作为实现边界 |
| 1. 当前实例入口 | Startup、metadata、Owner/Guest 分流、移动端正式进入、PWA manifest | 已完成 | 当前 origin 能安全检查并进入工作台 |
| 2. 移动端 UI 与响应式适配 | 响应式布局、移动端导航、Composer、Thread、设置和状态交互 | 未开始 | 移动端核心页面具备可用且可回归的 UI 基线 |
| 3. 自托管部署安全 | Docker Compose、HTTPS 反向代理、同源路由、Origin 防护、数据卷隔离 | 进行中 | Compose 配置、镜像构建和服务端安全测试已通过；待真实启动验收 |
| 4. 移动端恢复 | online/visibility 恢复、status/snapshot/SSE 校正、“继续上次任务” | 进行中 | 阶段 2 的移动端 UI 完成，恢复逻辑仍需实际移动网络回归 |
| 5. 发布验收 | Compose 实际启动、远程 HTTPS、桌面/移动端完整回归和文档收口 | 未开始 | 阶段 2、3、4 的手工验收完成 |
| 6. Hosted / 多实例 | 独立产品决策和后端交付 | 暂缓 | 自托管主线稳定且有明确用户需求 |

阶段必须按 0 → 1 → 2 → 3 → 4 → 5 顺序推进。阶段 6 不得插入当前主线。

## 阶段 0：稳定基线

### 必须保持

- Owner 与 Guest 使用独立进程、认证、workspace、history、runtime 和 API；
- 浏览器只接收安全投影，不接收 API key、宿主机路径、`CODEX_HOME`、rollout 或进程信息；
- Thread 详情先 snapshot，再按 cursor 建立 SSE；重复事件必须去重；
- Guest accepted Turn ID 只用于取消，不进入 native transcript identity。

### 验收

- `pnpm typecheck`；
- bridge、security、SSE、Guest 隔离定向测试；
- 不改变现有 Owner/Guest 权限边界。

## 阶段 1：当前实例入口（已完成）

### 已交付

- `/metadata` 安全能力契约；
- `ConnectionProfile` 和兼容性判断；
- Startup 选择当前服务、检查连接、分流 Owner/Guest；
- 未认证 `/` 进入 `/startup`；
- 移除移动端拒绝闸门；
- Web App Manifest；
- 当前 origin 的 session 级产品事件计数。

### 完成证据

- 连接模型测试通过；
- `pnpm typecheck` 通过；
- 触及 TypeScript 文件的 `oxfmt --check` 通过。

## 阶段 2：移动端 UI 与响应式适配（未开始）

当前仓库已有少量断点样式，但尚未形成可用的移动端信息架构、导航模式和页面级响应式方案。本阶段先完成移动端产品 UI 基线，再进行移动端断线恢复验收。

### 任务范围

1. **响应式设计基线**：盘点现有桌面布局和固定尺寸；定义窄屏、手机横屏、小平板和桌面断点、内容最大宽度、边距、触控目标、层级、滚动容器、safe-area 和软键盘处理规则；统一使用语义主题 token。阶段采用代码内设计基线，不另设设计稿前置交付物。
2. **应用外壳与导航**：为 Workspace、Settings、Startup、Login、Admin 和错误页设计窄屏布局；桌面侧栏在移动端改为 shadcn Drawer；使用菜单/关闭按钮和浏览器或系统返回键完成导航，不增加左右滑动手势；保证 Thread 列表、设置导航和当前 Thread 之间可达且不遮挡内容。
3. **Thread 工作区**：适配 Thread header、空状态、消息时间线、工具/文件事件、计划面板、问答请求、错误和加载状态；处理长文本、代码块、表格、横向滚动和回到底部操作。
4. **移动端 Composer**：重新安排输入区、模型/推理强度、技能、项目、Plan mode、发送和取消控件；处理虚拟键盘顶起、输入区高度、横屏、草稿恢复、禁用和失败重试；Owner 与 Guest 继续使用各自能力边界。
5. **移动端专属交互**：设计 Thread 切换、侧栏打开/关闭、设置返回、当前任务指示、继续上次任务入口和网络状态提示；明确手势、焦点、Escape/返回键和触控反馈，避免仅缩小桌面 UI。
6. **Owner/Guest 能力投影**：验证 Guest 不出现 Credential、Project picker、Archived chats、不可用设置和其他 Owner-only 控件；确认两套 runtime 的移动端导航和错误状态不串用。
7. **可访问性与设备行为**：保证触控目标、键盘/屏幕阅读器顺序、可见焦点、对比度、动态字体、横竖屏、safe-area、减少动画和离线提示可用。
8. **性能与资源**：避免移动端首屏加载不必要的桌面专属内容；检查长 Thread 渲染、滚动性能、图片/代码块和输入法组合输入；不把 transcript、命令输出、文件内容、路径或凭据写入本地持久化。

### 已具备组件

- `src/components/ui/drawer.tsx` 已添加并可直接使用；后续任务不得重复生成 Drawer，直接接入现有 `Drawer`、`DrawerTrigger`、`DrawerContent`、`DrawerClose` 等导出。
- Drawer 基于当前 `@base-ui/react/drawer` 和项目 shadcn 风格实现；移动端侧栏接入时保留现有 controller、route 和 Owner/Guest capability 边界。

### 完整实施计划

#### 已确认决策

- 目标是完整移动端工作台，而非只修复 CSS。
- 移动端使用抽屉侧栏；直接复用现有 shadcn Drawer。
- 使用菜单/关闭按钮和浏览器或系统返回键；不增加左右滑动手势。
- 设备基线为 `375×812`、`812×375`、`768×1024`，并补充 `1280px` 桌面回归。
- 采用代码内设计基线，不另设设计稿前置交付物。
- 继续复用 Owner/Guest controller、adapter、UI-facing model 和语义主题 token。
- 不保存 transcript、Turn 增量、命令输出、文件内容、路径或凭据；仅保留现有安全路由/恢复引用及必要 UI 偏好。

#### 实现任务

1. **设计基础与布局系统**：盘点固定尺寸、`min-width`、滚动容器和桌面专属布局；统一断点、页面边距、内容最大宽度、触控目标、层级、圆角、边框和 safe-area；在 `src/index.css` 补充语义 token、safe-area 和软键盘布局规则；使用 `dvh`/`svh`、`env(safe-area-inset-*)` 和 `min-width: 0`。
2. **应用外壳与 Drawer**：使用现有 `Drawer`、`DrawerTrigger`、`DrawerContent`、`DrawerClose`；扩展 `WorkspaceFrame`、`WorkspaceNavigation` 和 sidebar 组合，使桌面保留固定侧栏、移动端改为按钮打开 Drawer；实现遮罩、焦点管理、Escape、系统返回、关闭后焦点恢复和 safe-area。
3. **Workspace、Thread 和导航**：适配 Workspace shell、Thread header、空状态、加载、错误和运行中状态；移动端侧栏完成 Thread、新建 Chat、Project/Thread 切换、Settings、退出登录；Guest 不显示 Credential、Project picker、Archived chats、Owner-only 设置；Thread 标题不得撑宽页面。
4. **Transcript 与内容展示**：适配用户消息、Agent 消息、工具/文件事件、计划、问答、错误和完成状态；长文本换行，代码块/表格/diff 局部横向滚动；移动端计划和工具事件可折叠；保留 native reducer 和现有事件投影。
5. **Composer 移动端交互**：适配输入、发送、取消、模型、推理强度、技能、项目和 Plan mode；处理软键盘、输入法组合输入、横屏高度、发送中禁用、取消、失败重试和草稿 scope；继续由 Owner/Guest capability 控制选项。
6. **移动端专属交互**：实现 Thread 切换、Drawer 开关、Settings 返回、当前任务指示、继续上次任务入口和网络状态提示；不依赖 hover；系统返回先关闭 Drawer，再返回页面层级。
7. **Startup、Login、Settings、Admin 和错误页**：适配窄屏表单、按钮、错误提示、重试、Appearance、Credential、Guest capacity、404/403/服务不可用页面；Admin 与 Owner/Guest 工作台保持边界。
8. **可访问性、设备行为与性能**：保证触控目标、焦点环、键盘/屏幕阅读器顺序、aria 状态、横竖屏、动态字体、减少动画和 safe-area；检查长 Thread、代码高亮、图片/附件、滚动和首屏资源；不增加页面级自动化测试。

#### 接口与文件边界

- 保持 `WorkspaceSidebar`、`SettingsSidebar`、`ComposerInput`、transcript renderer 的现有 controller/model 接口。
- 通过响应式组合和移动端 presentation 层调整布局，不复制 Owner/Guest 业务逻辑。
- 新增或调整的状态只服务 UI，不改变认证、Thread、Turn、SSE 或 Guest runtime 契约。
- 重点文件包括 `src/app/composition/workspace-frame.tsx`、`src/app/composition/navigation/workspace-navigation.tsx`、`src/app/composition/layout/thread-header.tsx`、`src/app/composition/layout/composer-container.tsx`、`src/app/workspace/sidebar/workspace-sidebar.tsx`、`src/app/composition/navigation/settings-sidebar.tsx`、`src/app/chat/composer/ui/composer-input.tsx`、`src/index.css`；Drawer 已存在，不得重复生成。

#### 验证场景

- 运行 `pnpm typecheck`，并对所有触及 TypeScript 文件运行 `oxfmt --check`。
- 运行 Composer、sidebar、Guest capability 和纯逻辑相关的现有定向测试。
- 在 `375×812`、`812×375`、`768×1024`、`1280px` 手工验证 Startup、Login、Owner、Guest、Drawer、Thread 切换、新建 Chat、Turn、取消、问答、长文本、代码块、工具事件、计划、Settings、错误、重试、退出登录、软键盘和横竖屏。
- 阶段完成必须满足无遮挡、无横向溢出、无滚动竞争，Composer 在软键盘和横屏下可用，Owner/Guest 能力边界正确，Drawer 焦点/返回/关闭正确；断线恢复仍由阶段 4 验收。

### 完成门槛

- 在至少一个窄屏手机、一个手机横屏尺寸和一个小平板尺寸完成 Startup、Login、Owner、Guest、Thread、Turn、取消、问答、设置和错误流程手工回归；
- 侧栏、Thread 内容和 Composer 不发生遮挡、横向溢出或滚动容器竞争；
- 软键盘弹出和收起后 Composer、输入焦点和最新消息位置正确；
- Owner 与 Guest 的移动端 UI 能力边界与桌面端一致；
- `pnpm typecheck`、触及 TypeScript 文件的 `oxfmt --check` 通过，并完成桌面端回归；
- 阶段 2 只验收 UI、布局和交互基础；网络切换、后台恢复和 SSE 校正属于阶段 4。

## 阶段 3：自托管部署安全（进行中）

### 实现顺序

1. **容器拓扑**：Postgres、Owner、Guest、Web nginx 分离运行；默认只启动 Postgres、Owner 和 Web。Guest 通过 Compose `guest` profile 按需启动；数据库、runtime 和数据卷不暴露公网端口。
2. **同源路由**：Owner API、Guest API、Admin API、SSE 和静态资源均从同一个 origin 提供；公网部署的 HTTPS 由用户自己的反向代理负责。
3. **监听与代理配置**：Web nginx 提供构建后的 `dist`，默认仅将 `127.0.0.1:8080` 暴露给宿主机；用户可在宿主机使用自己的 HTTPS 反向代理。只有显式 `SERVER_TRUST_PROXY=true` 且 `SERVER_ENFORCE_ORIGIN_CHECKS=true` 时，才允许 Fastify 在受信代理后的容器网络监听。
4. **认证边界**：代理模式强制 HTTPS `BETTER_AUTH_URL` 和 `BETTER_AUTH_TRUSTED_ORIGINS`；未信任 Origin 的写请求返回 `ORIGIN_NOT_ALLOWED`。
5. **镜像边界**：`.env`、`.data`、凭据、workspace 和内部文档不得进入镜像或 Web 静态目录。

### 当前进度

- Dockerfile、Compose、nginx 和 `.dockerignore` 已添加；
- 默认 Compose 只启动 Postgres、Owner 和 Web，Guest 通过 `guest` profile 按需启动；
- nginx 已对 Owner/Guest SSE 单独关闭 buffering，使用 HTTP/1.1 长连接，并保留外部代理的 `X-Forwarded-Proto`；
- Owner、Guest 和 Web 均已配置容器 healthcheck，Web 等待 Owner ready；Guest upstream 使用运行时 DNS，未启用 Guest 时 Web 仍可启动；
- Origin 检查和 HTTPS 配置校验已添加；生产代理通过 `COMPOSE_*` 变量覆盖容器内的 `BETTER_AUTH_*`、`SERVER_*` 配置；
- 默认/Guest profile 的 Compose config、`pnpm typecheck`、`git diff --check` 和 `docker compose build --no-cache` 已通过；
- 尚未在真实 Docker 环境启动完整拓扑；公网 HTTPS、Cookie 和代理 SSE 回归留到阶段 5。

### 完成门槛

- `docker compose config` 通过；
- Compose 实际启动后 Owner、Web 和 Postgres healthcheck 正常；按需启动 Guest profile 后 Guest healthcheck 正常；
- Compose 默认仅在宿主机回环地址暴露 `8080`；公网 `80/443` 由用户自己的 HTTPS 反向代理负责；
- 本地 HTTP 入口上的 Owner API、Guest API 和两条 SSE 流均可用；
- 非白名单 Origin 的写请求被拒绝；
- 数据库、runtime、workspace 和 credential 文件无法通过 Web 访问。

阶段 3 的代码和镜像实现已完成；在真实 Compose 启动、API/SSE smoke test 完成前，阶段状态保持“进行中”。

## 阶段 4：移动端恢复（进行中）

### 实现顺序

1. 监听 `online`、`offline` 和 `visibilitychange`；
2. 恢复时先读取 Thread status；
3. cursor 有变化时重新读取 snapshot；
4. 用新的 cursor 建立 SSE；
5. 保留现有 event ID 去重和 native reducer；
6. 当前 origin 恢复上次 Thread 路由，不缓存 transcript、命令输出、文件内容、路径或凭据；
7. session 失效、Thread 删除或 Guest lease 过期时清理恢复引用。

### 当前进度

- Thread detail controller 已接入 online/visibility 触发的恢复；
- 既有 status → snapshot → SSE 定向测试保持通过；
- 尚未完成真实手机网络切换、锁屏恢复和 PWA 安装后的回归。

### 完成门槛

- Wi-Fi/蜂窝网络切换后 Thread 不重复、不丢失；
- 页面从后台恢复后能校正到最新状态；
- Owner 和 Guest 恢复路径互不串用；
- 恢复失败达到上限后保留 transcript 并显示可重试状态；
- 桌面端现有工作流无回归。

## 阶段 5：发布验收（未开始）

### 必须完成

- 使用干净环境构建镜像，不依赖本机 `.env` 或 `.data`；
- 完成 HTTPS 域名、Cookie、Origin、SSE 和反向代理回归；
- 完成桌面端和移动端完整流程：Startup、Owner、Guest、Thread、Turn、取消、问答、断线恢复；
- 运行最小必需检查：
  - `pnpm typecheck`
  - 触及文件 `oxfmt --check`
  - 配置/Origin/SSE/bridge 定向测试
  - `docker compose config`
- 记录已知旧测试失败，确认没有新增失败；
- 只在阶段 5 完成后更新产品状态为可交付。

## 暂缓范围

- Hosted 服务和官方账号体系；
- 多实例保存、默认实例和实例切换；
- 跨 origin 会话或 Thread 迁移；
- Web Push、Inbox、后台无限运行和离线执行；
- 手机本地文件系统、命令执行和完整桌面设置复刻。
