# 产品开发规划

Codex Web 的主线是：用户通过一个独立 Web origin 进入 Codex 工作台，在桌面或移动设备上查看、发起、跟进和控制编码任务。

当前产品只围绕两种运行时交付：

- Owner：用户自己的完整工作区；
- Guest：隔离、限时、受限能力的试用工作区。

部署、认证、workspace、credential、runtime 和 SSE 安全边界以 [`PROJECT.md`](../../PROJECT.md)、[`docs/api/README.zh-CN.md`](../api/README.zh-CN.md) 和 [`docs/frontend/README.zh-CN.md`](../frontend/README.zh-CN.md) 为准。

## 主规划

完整阶段、依赖关系、当前进度和验收标准见 [`development-plan.zh-CN.md`](development-plan.zh-CN.md)。该文件是本目录唯一的开发计划入口。

## 文档规则

- 本目录只保留稳定的产品目标和开发顺序；
- 不记录面试叙事、宣传文案、临时操作步骤或尚未决定的方案；
- 新的架构、安全或运行时决策先在代码和规范文档中验证，再同步到主规划；
- 计划状态只使用“已完成 / 进行中 / 未开始 / 暂缓”。
