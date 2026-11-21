# Conversation 前端重构与 UI 场景工作台

## 状态与启动说明
- 状态：**Ready for implementation**。冷启动审查通过；用户已明确要求实施，文档保存后开始执行。不创建提交。
- 基线：当前工作区源码，不依据 Git 历史或 staged/unstaged 意图。上一轮 Conversation 规格保留展示重构为后续工作，本规格接管该部分。
- 目标：Conversation 是唯一会话事实；展示、发送事务、动画和滚动各自拥有状态。开发工具帮助用户盘点、复现和指代聊天 UI。

## 决策与范围
- Confirmed：保留侧栏、会话、输入区骨架；修正内容可达性、错误状态和非阻塞问卷。
- Confirmed：Vite 开发专用免登录入口；合成领域数据；目录、播放/暂停/重置/事件步进、检查与目标复制。不录制/导入真实数据，不增加 Storybook。
- Confirmed：不提供精确动画时间轴。暂停仅停止事件投递，已开始的动画可结束。
- Recommended default：入口 /__dev/ui，由独立开发 bootstrap 承载；生产构建不包含入口和 fixture。不是恢复旧 preview、Guest 或匿名业务运行。
- Recommended default：保留现有 Chat* 命名作为展示接口，改为只读派生缓存，删除展示状态同步器；命名本身不构成第二套领域模型。
- 不改变 Owner/Relay、后端合同、资源加载协议及线程设置合同；不安装调试平台、动画库或引入截图测试。

## 事实与接口
当前 ConversationClient.watch 支持注入 observer；共享 reducer 和 projectConversation 可复用。现有 session 把完整投影逐项同步到 Valtio，renderer 同时读取 session 与 pending 合并结果，必须统一。
- Session 保存 ConversationState、加载/错误、更新来源，发布不可变 snapshot；展示投影按 Turn 缓存，外部用 useSyncExternalStore 读取。
- 发送事务独立叠加，只使用返回 Turn ID 关联，不以正文或唯一活动 Turn 猜测身份。
- 投影保留 MessagePart、AgentLink 和 Interaction 身份；无 final phase 的终态取最后非空 Assistant 作主要答复，不改变领域 phase。
- 多次问答保留 status/outcome；pending 按 createdAt、缺失时稳定 ID 排序，一次处理一个，并标记待处理数量。
- 非阻塞问卷与输入共存；问卷取消明确叫停止本轮，仍用现有 cancelTurn。输入错误不取代输入。
- 连接恢复保留已有内容；历史/恢复不重播已有内容。动画完成不能驱动业务状态。
- UI 维护展开项和跟随意图。仅本地发送主动锁底；过程更新不覆盖用户折叠。

## 工作台合同
复用现有 ThemeProvider、共享 WorkspaceLayout 与 Sidebar primitives；侧栏仅承载控制系统，默认 400px、范围 240–520px，宽度仅内存保存。主题偏好沿用正式存储。桌面布局最小 1280px，窄视口横向滚动，不适配移动端。
场景定义包含稳定 ID、中文名称、说明、源码入口、初始 Conversation snapshot、带时间的领域变化/快照替换/session 或发送事务步骤。只使用合成数据。
独立 session/Composer 内存 actions，不初始化认证、不调用 Owner、不写正式草稿。目录和复制信息同源。
播放按相对时间；暂停清理投递 timer；步进应用下一步；重置/切换/卸载清理 timer 与 session、本地展示状态。深链接只存场景 ID，不持久化执行数据。
检查显示当前投递、领域状态与展示结果，不声称是原始 RPC。点击开发目标复制场景、步骤、来源 ID、源码入口及视口。
初始场景：流式 Markdown、无 final、完成/失败/中断、命令/文件、compaction、问卷/多次回答、计划、发送关联、加载/失败/恢复。资源与 Agent 只做有类型摘要，不新增详情页。

## 任务与依赖
1. [状态与展示](01-state-and-projection.md)
2. [正式聊天](02-production-chat.md)，依赖 01。
3. [场景与回放](03-scenarios-and-replay.md)，依赖 01。
4. [工作台与集成](04-workbench-and-integration.md)，依赖 02、03。

## 验证与交付
定向纯逻辑测试保护 reducer/projection/session、精确发送关联和回放生命周期。运行 pnpm typecheck、修改 TS 的 oxfmt --check；里程碑完成前 pnpm test。生产 build 检查工作台未进入产物。
UI 手工浏览器回归：内容可达、历史不重播、折叠/滚动、问卷保留输入、工作台切换/回放/复制；工作台按桌面验收，无移动适配。可启动 pnpm dev；正式聊天另需 Owner 登录。复杂用户验收单列，不代替开发检查。
无已知阻塞。实施若发现行为/合同偏差，先更新本文再继续。

## 实施记录
待实施。


## 桌面框架修订记录
用户确认工作台复用现有主题与 workspace 外壳、侧栏派生控制系统、不做移动适配。已提取纯 WorkspaceLayout，正式 workspace 保留原 controller 和移动导航；本次验证与尚待真实 Owner 验收项见 04。此前各数据链路任务的状态不由本次布局验收替代。
