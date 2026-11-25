# 文档导航

按目标选择阅读路径。本仓库的现行行为以源码和对应的主题契约为准；历史研究与设计提案用于提供背景，不覆盖当前实现。

## 运行项目

- [本地开发](development.md)：安装依赖、启动 App 与 Owner、常用检查和 schema 更新。
- [远程访问](remote-access.md)：配置 Owner、Relay 和前端构建，了解配对及部署边界。

## 理解系统

- [系统架构](architecture.md)：组件全景、依赖方向、安全边界、Conversation 数据流和持久化所有权。
- [Owner 远程架构](owner-remote-architecture.md)：本机 admission、设备信任、enrollment、Passkey 与 session 生命周期。

## 修改代码

- [前端边界与数据流](frontend/README.zh-CN.md)：页面入口、connection profile、Conversation 消费和前端状态职责。
- [Transcript 架构](frontend/transcript-architecture.zh-CN.md)：会话状态、展示投影和聊天 renderer 的实现路径。
- [测试规范](testing.md)：测试分层、准入规则、速度和里程碑检查。
- [Server 模块规则](../packages/server/AGENTS.md)：Owner application、Codex、Relay session 与状态所有权的局部维护约束。
- [Chat UI 规则](../packages/app/src/app/chat/AGENTS.md)：静态 UI 验收和场景回放维护要求。

## 查阅契约

- [Owner / Relay API](api/README.zh-CN.md)：WebSocket、设备认证、事件 cursor、Conversation 命令和本机管理 CLI。
- [Codex App Server](app-server/README.md)：上游协议资料、runtime 区别及 schema 更新流程。
- [Theme generation](frontend/theme-generation.md)：主题色表的生成与检查。

## 研究与设计

- [研究资料](research/)记录外部系统和 App Server 的调研证据；研究结论不是本项目契约。
- [登录入口设计](design/sign-in-page.md)记录尚未实施的页面目标；描述目标体验的内容不代表当前行为。
