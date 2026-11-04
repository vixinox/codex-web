# 任务 06：轻量 Owner 事件契约

状态：开发实现与自动化验证完成；不提供旧事件表迁移入口。共享决策见 [主规格](readme.md)。

已确认移除 Owner hello/ready version、domain envelope schemaVersion、事件表 schema_version 及版本专用错误/分支。共享 parser、安全投影、128000 UTF-8 字节上限、cursor 和 native reducer 保留。Relay、IPC、runtime manifest 版本不在范围内。不建立通用多 runtime 框架。

数据处理：直接使用当前 domain_events 结构，不提供旧结构迁移、专用重建命令或启动检查，不自动清库。重启 epoch 使旧 cursor 进入 reset。

职责：runtime adapter 解释 Codex；EventHub 排序、持久化后广播、回放；store 提供分页扫描信息；Owner transport 校验 frame；App adapter 校验事件、维护 cursor；controller 协调快照；reducer 解释事件；renderer 仅消费 UI model。

验证：无版本握手、非法结构拒绝、全仓类型检查与相关测试。

实际检查结果与用户验收入口见 [任务 04](04-verification.md)。
