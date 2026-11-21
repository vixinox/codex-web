# 03 场景与回放

状态：Ready for implementation。
共享决策唯一来源：[主规格](development-spec.md)。

依赖 01。开发模块定义类型化合成场景与纯回放状态， timer 由 host 管理。复用正式 session/reducer/projector，禁止网络和正式持久化。测试步进、快照替换、重置、计时与结束，无真实 sleep。场景切换/卸载必须清理；不做真实录制和精确动画时间控制。

交付时在本文记录验证与偏差；复杂用户验收为实施后交接。无额外材料决策授权，不创建提交。
