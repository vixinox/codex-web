# Owner Remote 基线清理迭代

## 1. 状态与启动说明

- 状态：Owner-only 基线、自动化验证与手动浏览器回归全部完成。用户报告的“取消归档后 sidebar 未恢复 Thread”已修复；Fastify 重启后的现场复测确认通过。
- 目标：把 Guest 移除后的 Owner-only 项目收口为可继续远程控制开发的干净、可运行基线。
- 当前分支：`codex/owner-remote`。
- 后续工作从本工作包和 [`remote-agent-handoff.md`](../remote-agent-handoff.md) 开始；前者定义基线与本轮验收，后者记录远程产品方向和待决技术选择。
- 本轮不实现 Relay、Connector、设备配对、远程协议或远程 UI。

## 2. 当前实现事实

- 项目采用本地认证 Owner 模型；浏览器通过 Fastify bridge 使用 Owner 的 REST/SSE 接口。
- Guest runtime、Guest API、匿名认证、lease/quota、管理路由和 Guest UI 已从主代码路径移除；历史架构说明保留为背景，不构成运行时入口或操作指引。
- Guest 删除改动进入本轮时已暂存，分布于服务端、前端、认证、配置、schema、脚本、测试和文档。
- 本地数据库已使用 `pnpm db:reset` 重建 Owner-only schema，并确认仅有 `account`、`codex_event`、`credential`、`project`、`session`、`user`、`verification` 表；此命令会清空目标数据库的 `public` schema，不得指向其他数据库。
- Thread 的 `model` 和 `reasoningEffort` 投影接受安全格式的标识符。effort 是 App Server model catalog 动态广告值；创建 Thread/Turn 时服务端按当前 catalog 校验模型与 effort 组合。
- 当前自动化结果：服务端 102/102、Bridge 92/92、前端 250/250、隔离数据库集成测试 1/1 通过；类型检查、生产构建、全项目格式检查和 `pnpm lint:staged` 均通过。集成测试使用临时本地数据库与临时数据目录，验证后已清理。

## 3. 冻结决策与不变量

- 只保留一个经过身份验证的 Owner 用户模型；本地 Owner runtime 仍只绑定 loopback。
- 不保留 Guest 兼容路由、认证类型、配置键、schema、前端适配、测试或可执行说明。
- Owner 现有 REST/SSE 语义保持不变；敏感路径、凭据和 runtime 进程信息仍不得泄漏给浏览器。
- `reasoningEffort` 不建立固定产品枚举；只接受安全格式，能力校验由当前 model catalog 承担。
- 当前数据库是本地可丢弃开发库，重置已经由本轮授权；服务仍由用户管理，Agent 不启动、停止或接管服务。
- 所有改动留在 `codex/owner-remote`，最终统一创建一个提交，不合并到其他分支。

## 4. 迭代里程碑

1. **已完成：建立隔离基线**，创建目标分支并保留原暂存 Guest 清理，记录起始状态。
2. **已完成：收口 Owner-only 实现**，清除 Guest 源码和操作入口、清理本地 Guest 环境变量并重建数据库。
3. **已完成：统一协议和质量门槛**，按动态 catalog 更新 effort 契约，修复格式、暂存 lint 工具和集成测试问题。
4. **已完成：冻结下一轮入口**，远程身份、配对、命令、协议、事件恢复及 Connector 生命周期列为后续决策，本轮没有实现远程代码。
5. **已完成：修复后的现场复测与最终提交**，用户手动通过 Owner 主流程，并在 Fastify 重启后确认取消归档的 Thread 重新出现在 sidebar。自动化回归通过；全部改动 amend 至 `codex/owner-remote` 上唯一迭代提交，工作区干净，不合并。

## 5. 验收标准

- Guest 残留扫描在运行时代码、配置、脚本、测试及产品操作指引中无命中；架构历史和本工作包保留必要上下文。
- 数据库重建成功，包含 Owner 认证与业务表，不再有 Guest 表或 Guest 专属用户字段。
- 类型检查、完整服务端/前端测试、集成测试、构建、全项目格式检查和暂存 lint 均通过。
- 用户已手动确认 Owner 登录/首账户创建、runtime 启停、workspace 与 Thread 浏览、创建 Thread、发送/取消 Turn、设置读取/保存、登出与登录保护；在 Fastify 重启后再次取消归档，归档页条目消失且 sidebar 已恢复 Thread。
- `codex/owner-remote` 最终只有一笔本轮迭代提交；提交后 `git status` 干净，不执行合并。

当前无阻塞：用户管理的 Vite `5173` 与 Fastify `3000` 已运行，Owner 主流程及修复后的取消归档回归均已通过。

自动化验证命令：

```bash
pnpm db:reset
pnpm typecheck
pnpm test
pnpm test:frontend
pnpm test:bridge
pnpm test:integration
pnpm build
pnpm exec oxfmt --check "**/*.{ts,tsx}"
pnpm lint:staged
```

手动回归需要用户运行 Vite `5173` 与 Fastify `3000`；本轮完整手动回归及修复后的 Archived chats → Unarchive 复测已通过。服务由用户管理，不要由 Agent 启动、停止或重启。

## 6. 下一轮远程实现决策卡

开始 Relay/Connector 编码前，依次冻结以下决策，并将确认结果记录到短 ADR 或更新的实施规格：

- **身份与配对**：公网 Relay 的身份根如何关联本地 Owner；一次性配对码由谁批准、多久过期、失败如何限流。
- **机器和设备生命周期**：独立身份凭据如何注册、轮换、撤销；撤销如何传播到已建立连接。
- **远程命令合同**：首版命令白名单、`commandId` 幂等行为、过期状态条件及错误状态。
- **共享协议**：版本化 envelope、身份字段、runtime schema 校验和未知版本处理。
- **事件与加密**：本地权威事件、序列号/ack/缺口补发、Relay 密文保留与新设备密钥恢复。
- **Connector 生命周期**：Fastify 插件启动/关闭顺序、命令队列、崩溃后未知执行状态的查询和恢复规则。

## 7. 入口文件

- 仓库约束：`AGENTS.md`
- 稳定架构与安全边界：`PROJECT.md`
- 远程产品方向及已知候选方案：[`remote-agent-handoff.md`](../remote-agent-handoff.md)
- REST/SSE 合同：[API 文档](../api/README.zh-CN.md)
- 前端边界：[前端架构文档](../frontend/README.zh-CN.md)
