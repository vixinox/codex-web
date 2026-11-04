# Server 事件链与统一业务层

状态：本次实现工作包已收尾归档，轻量契约与 review 修复完成，开发验证通过；用户浏览器验收待执行，归档不代表已完成手工验收。

## 目标与决策

解决 Codex App Server 新事件接收过于保守、跨层重复修改的问题。以当前工作区源码为基线，承接本次暂存 review 的具体缺陷；不依据 Git 历史推断需求。

- Owner 应用协议和 domain envelope 不维护版本号。前后端共同更新，不维护旧契约兼容；Relay、CLI IPC、runtime manifest 的版本机制不在本次范围。
- Codex 是当前唯一 runtime；保留 native reducer，不预建通用多 runtime 框架。
- `@codex-web/protocol/owner` 提供唯一 envelope 类型、结构 parser 和事件错误分类。严格校验结构不等于保守丢弃未知语义：合法未知 runtime 消息进入 `runtime.extension`。
- runtime extension 递归过滤凭据/路径字段，payload 上限 128,000 UTF-8 字节；renderer 仅收到受限方法名摘要，不收到扩展 payload。
- 保留全局单调 sequence 和 epoch + sequence cursor。epoch 在进程重启时变化；旧 epoch 或过期/超前 cursor 通过 `events.reset` 触发快照恢复。
- envelope 包含 eventId、type、runtime、可选关联 ID、createdAt 和 object payload。实时事件 eventId 必须等于 cursor sequence，同 cursor 内容冲突停止订阅。
- 非法契约停止消费、不推进 cursor，保留 transcript 并提示重新连接/重试。普通网络恢复、reset 快照恢复与契约失败停止分别处理。

## 数据流和职责

```text
Codex JSON-RPC → Codex adapter / safe projection → DomainEventEnvelope
  → EventHub / domain_events → Owner frame + shared validation
  → App adapter → Codex native reducer → presentation model → renderer
```

adapter 解释 Codex 语义和关联 ID；projection 限制安全字段和大小；EventHub 分配 sequence、持久化成功后广播、回放并衔接实时事件；store 返回合法事件以及原始扫描位置和 hasMore，不以过滤后的事件数量判断分页结束。非法持久记录拒绝恢复并记录脱敏诊断，不伪造兼容事件。

Owner transport 管理 frame 和连接；App domain adapter 管理事件校验、cursor、去重与订阅 resume；controller 协调快照和恢复；native reducer 解释事件。完整 Thread 快照为已物化内容真值，history 只按现有补全规则恢复缺失内容；plan/reasoning 尾部增量和旧生命周期不能覆盖/重复完整快照。合法未处理事件显示摘要。

扩展一个事件：在 server adapter 增加必要的安全语义映射、在 native reducer 增加展示语义和对应 fixture/test；未新增映射也必须能走安全 extension 路径。不为新增事件修改 EventHub、store 或 Owner framing。

## 事件数据处理

已确认：项目尚未发布，事件表直接使用当前无版本结构，不维护旧 domain event 格式或表结构的迁移、兼容、专用重建命令及启动检查。不自动修改或清空现有数据库；本地开发数据整理不作为产品能力。

## 工作包与依赖

任务 01–03 已接入；本轮 05→06→07 开发任务已完成，任务 04 汇总实际验证与用户验收。

- [01 Codex adapter](01-codex-adapter.md)
- [02 Domain event store](02-domain-event-store.md)
- [03 Owner WS 与 App](03-owner-ws-app.md)
- [04 验证记录](04-verification.md)
- [05 Review 修复](05-review-fixes.md)
- [06 轻量契约](06-lightweight-contract.md)
- [07 闭环验证](07-closure.md)

已确认的范围/数据/版本取舍均已落定，无待决设计问题。未经用户要求不创建提交、不启动子代理。

## 完成标准

protocol、App、server、Relay 测试，全仓 pnpm typecheck，目标 TS/TSX oxfmt --check 与 pnpm lint:staged。覆盖共享 producer/consumer fixture、跨页非法记录、replay/live 顺序、持久化失败、重启、history 补全、cursor/reset、取消、冲突和契约失败停止。

用户浏览器验收独立记录：用户启动 pnpm server 和 pnpm dev 后验证历史打开、实时增量、断线 resume、reset、错误后 transcript 保持与重试。它不替代开发正确性检查，不扩展为远程认证验收。
