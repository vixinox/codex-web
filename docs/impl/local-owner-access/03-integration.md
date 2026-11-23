# 03 数据重建、跨连接验证与契约收尾

状态：代码与自动化验证完成；真实数据库切换和用户服务浏览器回归待后置执行。依赖01、02。先读 [主规格](README.md)。本包负责跨模块正确性及现行文档一致性，不是另一次功能扩展。

## 集成责任

1. 复核01/02交付：本机唯一Owner上下文、ready.ownerId、passkeyAvailable/appOrigin、远程session仍绑定设备。不得把transport connected当作workspace ready。
2. 复用合成authenticator与真实应用服务/session runtime测试，串联注册、签名认证、关闭旧连接、从新连接恢复及受保护请求；包括remote过期/撤销和重放。不要再只断言token存在。复用原回归，不造重复注册fixture。
3. 精确搜索退休符号，删除localPasskey/localEnrollment/ticket/local bearer及旧profile参数的活动引用和无用配置；保留明确历史说明，不为历史场景新增测试。废弃的本地流程测试删除/改写，先前临时恢复修复也随生命周期删除。
4. 同步AGENTS当前范围、PROJECT稳定安全边界、owner-remote-architecture、API、frontend、current-behavior、`.env.example`与sign-in-page。本地待验证文案/设计删除；旧Connection规格只增加被取代指针，保留历史验证但不得当作当前要求。主规格记录实际结果。

## 数据重建执行边界

用户已经选择允许重建、不保留升级。实施时先完成临时fixture验证，再执行真实重建；确认配置路径在明确的dataRoot，仅操作命令定义的SQLite文件与trust peers，绝不递归删除dataRoot或Codex Home。

优先由用户按既有交互执行：停止Owner → `pnpm db:reset` → `pnpm server`；本地浏览器刷新直接使用。Agent只停止自己启动的服务，不能为重建杀死用户运行服务；若用户服务仍在运行且需要停止，报告具体命令/状态，将真实重建作为用户切换步骤，不以此代替开发期测试。不得通过交互工具默默清除其他用户数据。

告知重建清空控制面（包括Project分组、API Credential、Passkey和配对），保留Codex Home历史/工作区文件与node identity。远程需移除旧profile后新链接加入，重新配置Passkey；这是此次明确允许的重建代价，不实现自动profile修复或pin绕过。无服务运行时的首次启动依旧可自行创建新库。

## 检查与验收

- 最终`pnpm test`、`pnpm typecheck`、全部触及TS/TSX `pnpm exec oxfmt --check`。如以后获准提交：仅stage本任务文件并运行`pnpm lint:staged`；无自动提交要求。
- 本机手工：无浏览器凭据打开`http://localhost:5173/app`，读取Project/Credential/Codex状态；刷新、深链接、进入Connection、重启连接均不弹登录，不出现伪未认证toast，无Sign out。`127.0.0.1:5173`一致。
- 边界测试：远程origin直接访问Owner、恶意Host/DNS重绑定域名、无Origin、非loopback peer、forwarded伪装不被授权；Relay无认证不获得本机能力。网络监听配置只能loopback，部署不转发Owner `/ws`。
- 用户后置远程验收：本机生成链接并打开远程设置→登记设备→用户点击创建Bitwarden Passkey→远程退出→Passkey再登录→业务请求成功；再测撤销当前/全部设备、本地仍可用。首次加入仍依赖新链接，Passkey不能让陌生设备绕过登记。
- 取消/失效链接不显示配置成功；仅本地使用且无远程配置正常工作。不得为了验收补充新页面或扩大CLI。

完成时把主规格更新为Verified，记录实际检查结果、删除范围与差异；真实数据库切换和Bitwarden验收可作为明确的后置用户事项，不把缺少自动化边界验证包装为手工待验收。
