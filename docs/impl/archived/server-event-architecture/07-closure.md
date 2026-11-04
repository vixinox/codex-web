# 任务 07：闭环验证与文档收尾

状态：开发验证与文档收尾完成；用户浏览器验收待执行。共享决策见 [主规格](readme.md)。

检查 producer→store→live/history→reducer 的统一语义；覆盖 replay/live 交接、去重、冲突、reset、取消、契约失败停止、持久化失败及重启序列。只修复本事件链的具体问题，不借机重写传输基础设施。

开发验证必须运行 protocol/App/server/Relay 测试、pnpm typecheck、目标 TS/TSX oxfmt --check 和 pnpm lint:staged。记录实际结果，不以既有工作区修改为理由跳过。

同步主规格、任务 01–04、API、frontend、current-behavior 和 PROJECT 的冲突措辞。人工浏览器验收由用户在 pnpm server 与 pnpm dev 运行后完成：历史打开、实时增量、断线 resume、reset、错误后 transcript 保持及重试。用户验收单独记录，不替代自动化验证。

实际检查结果与用户验收入口见 [任务 04](04-verification.md)。
