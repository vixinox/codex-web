# 任务 04：验证与文档

本记录替代此前版本契约阶段的局部检查结果。2026-11-04 完成轻量契约与 review 修复后的开发验证：

| 检查 | 结果 |
| --- | --- |
| pnpm test（server / protocol / Relay） | 121 / 20 / 23 全部通过 |
| pnpm --filter @codex-web/app test | 46 文件、261 测试通过 |
| pnpm typecheck | 全仓通过 |
| 35 个暂存 TS/TSX 文件 oxfmt --check | 通过 |
| pnpm lint:staged | 通过，无新增 warning/error |
| 暂存 diff 空白检查 | 通过 |

覆盖：producer/consumer 共享 fixture、live/history 一致性、未知事件安全摘要、非法 envelope/cursor/identity 拒绝；完整快照不重复尾部 plan/reasoning 增量；整页非法及页首/中/尾非法记录后继续跨页回放；replay/live 交接和取消；写失败不广播及后续恢复；旧 epoch 和超前 cursor reset。

架构检查结论：共享 contract/parser、runtime adapter、安全投影、EventHub/store、Owner transport、App adapter/controller、native reducer 和 renderer 的职责保留；无需为新增事件修改存储或 framing。移除应用版本号、重复错误分类与 cursor 类型/校验；不改 Relay/IPC/runtime manifest 版本，不引入通用 runtime 框架。

后续清理：按用户确认删除一次性事件表迁移命令、重建实现、旧列启动检查及专用迁移测试。清理后事件存储 focused tests（2 项）、全仓 typecheck、目标 TS 格式检查与暂存 lint 均通过；此前完整测试结果为清理前记录。未操作真实本地数据库。

## 待用户浏览器验收（开发完成后的独立交接）

检查时已有 Vite 5173，Owner 3000 未运行，故未执行完整浏览器回归，未启动用户服务或操作真实数据库。

运行 `pnpm server`；Vite 未运行时执行 `pnpm dev`。项目不提供旧事件表结构迁移入口。

验证历史打开、实时增量、断线 resume、Owner 重启后的 reset、错误时 transcript 保持与重试。预期无重复文本、无遗漏后续合法事件、无旧状态覆盖、契约失败后不自动继续消费。自动化已覆盖相应控制逻辑，浏览器验收仍需实际用户环境确认，不扩展为远程认证功能验收。
