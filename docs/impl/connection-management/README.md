# Connection 管理收敛

状态：Verified（本地 Passkey session 恢复修正开发验证完成；用户浏览器验收继续）。用户已要求实施；本文件是唯一实施规格。基线为当前工作区源码，不分析 staged/unstaged 意图，不依赖 Git 历史。

## 已确认范围

- Settings → Connection 保留现有 Passkey 配置、local/remote 认证区分、ticket 和 step-up；相关前端文件改用 connection-* 命名，路由不变。
- 只管理设备查询、生成/取消登录链接、移除单个/所有设备。删除独立的批量 session 撤销、trust reset、特殊 recovery 及其 Web/CLI/IPC 入口，不留别名。
- CLI 只连接运行中的 Owner；未运行时提示 pnpm server，不启动临时 runtime。四个命令：devices list、enrollment issue、devices revoke <device-id>、devices revoke-all。enrollment issue 显示为“生成登录链接”；删除 CLI/IPC 的独立取消入口，不留别名。Web 二维码旁保留取消。撤销仍需交互确认，变更不自动重试。
- 全部移除保留 Owner identity、密钥、trust epoch、本地 Passkey 和本机恢复入口。保留存储结构，不迁移或操作真实数据。

## 实现约束

Web 和本机 IPC 分别授权后委托同一设备管理模块，邀请兑换和撤销串行执行。排队的远程变更检查设备授权；撤销期间开始的握手不得重新授权。

邀请五分钟、单次、全局一个；替换/取消/过期/设备撤销/Owner 或 Relay 连接失效后不可兑换。失败登记补偿清理。客户端只关心有效邀请或无邀请，不新增终止原因协议；无效时收起二维码、刷新设备列表，不从普通网络错误推断成功。

移除统一废止设备/session 授权、清 trust peers、关闭连接。跨存储失败返回错误并断开访问，支持幂等重试；不宣称跨存储事务原子性。列表只呈现仍被授权的设备。owner.security.status 增加 currentDeviceId；现有保留 RPC 不改名。

可信 E2EE device_revoked 关闭保留原因、停止重连、只清当前 profile session 并返回登录。普通断连仍按网络失败处理。

Connection 页面只保留一条读取/刷新路径：初次加载、操作结束、有效邀请期间每三秒查询；隐藏时暂停、恢复可见立即查询，卸载清理。保留单设备/全部移除确认，不增加设备命名。

## 一次性登录修正（已确认）

链接授权本次登录，不强制创建新设备；Passkey 是可选的重新认证方式。首次登录登记设备；同一浏览器再次兑换新的有效链接时复用设备密钥、deviceId 和 connection profile，仅签发新 session。没有有效链接时，设备密钥本身不能恢复过期 session。

采用默认：产品限定单 Owner，复用当前配置 Relay 下最近使用的已配对 profile（lastConnectedAt，缺省 createdAt），包括已退出或 session 过期的记录；多个历史重复记录不自动合并或删除。沿用已保存的 nodeId、Owner public-key pin 和 trust epoch 验证；身份变化失败关闭，不回退创建新身份。没有记录才生成 draft；失败只删除本次新 draft，保留已有 profile 和 session。完成写入时再次校验 Owner identity。

兑换仍须通过 E2EE 公钥持有证明及五分钟单次链接验证。已有受信任公钥复用 deviceId，不重复登记；失败不得撤销该设备或其他 session，只清本次签发的 session。已移除设备只有拿到新的 Owner 链接才能重新登记，更新原 profile，不恢复旧 session。保留现有 wire 名称、路径及存储结构，不新增协议、迁移或兼容入口。

验收：同一密钥多次兑换新链接保持一个设备；重放、替换链接失败；已移除身份需新授权；已有设备重新登录失败不影响原授权；浏览器复用最近 profile 且隔离 Relay/Owner pin；CLI 取消命令被拒绝。沿用下方自动化与手工验证要求。

## 实施顺序

本地 Passkey session 恢复：已确认 localhost 登录后所有业务请求未认证。auth-domain.resume 不得因 session.deviceId 为空而撤销本地 session；仍验证 session TTL、撤销状态和 trust epoch。Relay 恢复继续要求 E2EE 已登记设备且 session.deviceId 与当前设备一致，本地 session 不能用于 Relay。现有注册/认证回归增加新连接恢复与跨 transport 拒绝，本地 session 在全部远程设备撤销后仍可恢复。此项仅修复当前认证模型；本地免登录重构另立规格。

Passkey 登录返回修正：用户完成 Bitwarden 验证后出现 Connection failed。将原合成验证器回归延伸至 application-services 后复现：context 已认证，但返回只有 token/expiresAt，缺少登录入口要求的 ownerId。认证成功响应补齐 ownerId；前端将其设为必要字段，缺失时报现有协议错误。沿用一个注册/认证回归，补充客户端成功/缺失身份校验，不增加页面或新认证流程；验证定向测试、typecheck、oxfmt、pnpm test，实际浏览器由用户继续验收。

Passkey challenge 编码修正：用户注册 remote Passkey 时报告响应 challenge 与预期不一致；服务端回归已复现同样错误。保留现有随机 challenge、一次性消费、连接/profile 绑定及 origin/RP/用户验证要求，将传给 SimpleWebAuthn 注册与认证 options 的 challenge 显式解码为随机字节，避免库将 Base64URL 文本再次编码。使用合成验证器响应覆盖 remote/local 注册、凭据持久化、签名认证和重放拒绝；运行定向测试、typecheck、oxfmt 和全仓测试。真实 Bitwarden 创建与登录由用户继续验收，不新增页面、依赖或协议。

同一回归继续发现注册成功后的事务未执行凭据 insert 与 Owner 配置 update（Drizzle 查询未执行），导致返回成功但 hasPasskey 为 false。保持 better-sqlite3 同步事务，显式 run 两条写入；此项属于本次 Passkey 注册成功并可再次认证的必要验收。

Connection 页重复淡入修正：控制器主动 connect 替换旧 transport 的同步 disconnected 通知不得排队重连；connecting/reconnecting 阶段的失败由 connect promise 的 catch 处理，已连接后的意外断连仍按退避恢复。收到 connected 后清理遗留重连 timer。回归测试使用同一控制器两次 connect、推进时钟，确认健康连接不额外重连；保留真实断连、重试耗尽和明确撤销测试。无需改动动画或轮询逻辑。验证：定向 controller 测试、typecheck、oxfmt、pnpm test；浏览器认证页回归受当前可用会话限制。

本次修正：已用真实 CLI 链接复现成功响应尚在异步解密时原生 close 先使请求失败。浏览器 Relay adapter 按到达顺序串行解密；Owner runtime 在处理原生 close 前等待已收到消息交付完成，旧 socket 的延迟回调不得关闭新连接。排队消息不得在认证/解密失败后继续交付。无排队消息的断连仍正常失败；保留明确 device_revoked 的停止重连行为，不增加延时、wire 消息或服务端兼容路径。

删除 EnrollmentRoute 的独立页面，将现有 /app/enroll 入口直接交由现有 LoginRoute/LoginScreen 处理（保留既有链接地址，不新增别名路由）。链接在本地或远程 origin 都优先于已保存 session 自动兑换，加载、失败与重试复用登录页；普通 localhost Passkey/远程连接入口保留。保留 StrictMode 单次兑换保护、profile 复用及失败清理，将兑换逻辑移至现有 lib/remote/admission.ts，移除 entry 层重复登录实现。

验收与验证：定向 transport/runtime 测试必须先复现“响应解密被暂停 → 原生 close → 释放解密”，证明成功响应先于关闭处理，并覆盖相邻帧顺序、失败关闭和旧连接隔离。运行 pnpm test、pnpm typecheck、触及文件 oxfmt；使用运行中的 CLI/Relay 复跑真实兑换与设备复用；浏览器检查登录页失败入口和成功跳转。只清理本次验证设备，不动用户设备或服务。此前历史验证不构成本次修正的验收。

1. 共用设备管理实现及退休方法删除。
2. 纯 IPC CLI 与命令/菜单收敛。
3. Connection 文件重命名、页面及撤销状态处理。
4. 同步现行架构/API/前端/行为文档；PROJECT 仅修改稳定职责与 CLI 运行方式。

## 验证与完成条件

定向测试保护邀请单次/替换/取消/过期/连接失效、登记补偿、撤销授权及会话清理、并发撤销、部分失败、身份保留、CLI 在线/未运行及邀请生命周期、明确撤销与普通断连区别。复用现有测试，避免重复 fixture；移除退休行为测试，不新增 renderer/DOM/截图测试。

最终运行 pnpm test、pnpm typecheck、触及 TS/TSX 的 pnpm exec oxfmt --check。未授权提交，不暂存；若将来提交需 lint:staged。用户后置浏览器/Relay 验收需要 Vite 5173、Owner 3000、配置好的 Relay 和 Owner 认证，不替代自动化验证。

## 完成与验证

前一轮四项实施的验证记录如下；本次一次性登录修正的结果追加在下方。前端仅保留一条刷新路径，未增加邀请终止原因协议；开发文档合并为本文件。

- pnpm test：486 项通过（Server 154、Protocol 25、Relay 27、Conversation 8、Telemetry 14、App 258）。
- pnpm typecheck：通过；29 个触及 TS/TSX 的 oxfmt --check：通过。
- 补充 oxlint：新设备管理/CLI/页面逻辑无 error；保留的 WebAuthn JSON 转换仍有一条类型断言 warning。全量触及文件检查也报告原有 warning，未进行无关清理。未暂存或提交，未运行 lint:staged。
- 一次全仓复跑遇到未触及 manager.test.ts 的 Windows 临时目录 EBUSY；该文件 13 项定向通过，随后完整 pnpm test 通过，未修改该模块。
- 浏览器仅确认 Connection 路由和 Settings 外壳可达；现有 Vite 5173 保持运行，未检测到 Owner 3000，页面停留在连接状态。完整 Passkey/设备/Relay 验收需要用户启动 pnpm server 并提供认证环境。未启动或停止用户服务，未操作真实数据库。

### 一次性登录修正（2026-11-23）

- 定向测试通过：Server 19 项（device-management、CLI、IPC、cli-client、methods），App 14 项（device-key-store、connection-model、runtime-controller）。
- pnpm test：490 项通过（Server 156、Protocol 25、Relay 27、Conversation 8、Telemetry 14、App 260）。
- pnpm typecheck：通过；触及 connection-screen.tsx、runtime-controller.ts、cli.ts 的 oxfmt --check 与 oxlint：通过。
- 页面与入口：Settings → Connection 改为 Sign-in link，保留 Web 取消；CLI/IPC 不再暴露 cancel，`enrollment cancel` 被 usage 校验拒绝；已保存 profile 复用密钥与 Owner identity pin，失败只清本次新 session 或新 draft。
- 浏览器：Vite 5173 可达并渲染 Settings 外壳；本机无可用 Owner 认证（headless 无 relay 扩展与已保存 session），内容停留在 “Connecting to Owner…”，未执行真实设备/Relay 兑换。完整手工验收仍需用户环境。未启动或停止服务，未操作真实数据库。

### 登录收尾竞态与页面收敛（2026-11-23）

- 先通过可控解密 promise 的 transport/runtime 回归测试复现失败，再修复入站串行解密和 close 等待；覆盖成功响应后 paired/native close、解密失败停止后续交付、替代连接不受旧回调影响。
- 删除独立 EnrollmentRoute 和状态卡片；原 /app/enroll 直接使用 LoginRoute/LoginScreen 自动兑换，加载/错误/重试复用登录页。兑换逻辑移到既有 admission 模块，保留 profile 复用和 StrictMode 去重；无新增依赖、wire 协议、存储结构或服务端修改。
- pnpm test：494 项通过（Server 156、Protocol 25、Relay 27、Conversation 8、Telemetry 14、App 264）。最终相关 4 个前端测试文件 23 项通过；pnpm typecheck、8 个触及 TS/TSX 的 oxfmt --check 通过。
- 定向 oxlint 无 error，仍报告保留代码的类型断言和遮蔽 warning，未做无关清理；未运行 lint:staged，未暂存或提交。
- 复用用户正在运行的 Vite/Owner/Relay，经真实 CLI 新链接连续兑换 10 次，10 次成功并保持同一 deviceId。本次仅生成一个临时测试设备，已通过 CLI 逐个设备撤销命令清理，最终设备列表为 []；临时脚本已删除，未启动/停止用户服务。
- 浏览器确认原链接地址渲染既有登录页、无效链接显示同页错误、返回普通登录清除链接错误；完整浏览器成功跳转尚未执行，不以真实 transport 兑换代替用户最终验收。

### Connection 重连循环（2026-11-23）

- 用户已确认 URL 登录成功，进入 Connection 后约每 500ms 重复淡入。控制器测试复现：同一 controller 再次 connect 主动关闭旧 socket，错误安排重连；推进两秒后 socket factory 被调用 5 次而非 2 次。
- 修正 connecting/reconnecting 期间的主动 transport 替换不排队恢复；connected 清理残余重连任务。保留实际掉线退避和撤销终止。生产改动仅 runtime-controller 的两处条件，不改动画、页面或轮询。
- 回归验证替代连接等待 600ms 不触发多余连接，成功后推进两秒保持稳定；controller 8 项、全仓 495 项通过，typecheck、两个触及文件 oxfmt 与 oxlint 通过。未提交或暂存。
- 用户登录会话位于当前工具不可直接访问的 VS Code 浏览器；可用浏览器没有该认证页面。本次未操作用户会话或设备，页面视觉稳定性由用户继续验收。

### Passkey 注册与登录（2026-11-23）

- 回归先复现用户相同的 Unexpected registration response challenge；用户给出的响应 challenge 解码一次即为 expected。SimpleWebAuthn 14.0.3 将字符串 challenge 视作 UTF-8 文本，导致已编码随机值被再次编码。注册与认证 options 改传原始字节，服务端预期保持原 Base64URL 值。
- 注册验证通过后回归发现凭据未持久化；同步事务的 insert/update 补充 run，确保凭据及 Owner 配置标记写入后才返回成功。
- 一个合成验证器回归覆盖 local/remote 注册、凭据与配置标记保存、真实签名认证、注册和认证重放拒绝；不模拟验证库成功结果。定向 4 项通过，全仓 pnpm test 通过；pnpm typecheck、两个触及 TS 文件 oxfmt 与 oxlint 通过。最终补强配置标记断言后定向测试和格式检查再次通过。
- 本次修改仅 auth-domain、其测试与本规格。未启动/停止用户服务、操作真实凭据数据库或 Bitwarden，未暂存或提交。Owner 当前启动命令没有 watch，用户需重启 pnpm server 后继续真实浏览器注册/登录验收。

### Passkey 登录返回身份（2026-11-23）

- 用户确认注册成功；sign out 后 Bitwarden 已完成验证，但前端 Connection failed。现有登录入口要求 result.ownerId，应用服务却只返回 token/expiresAt。回归延伸到实际 application-services，证明服务端 context 已认证而响应身份为 undefined，修正前失败。
- 认证成功响应补齐 ownerId；客户端将身份作为必需字段，缺失时返回现有协议错误，不让未完整响应到达登录页的通用异常分支。API 文档同步该返回合同。
- 复用原合成验证器测试，验证 local/remote 注册、真实签名经应用服务认证、返回身份与当前 context 一致及重放拒绝；新增客户端成功/缺失身份两个纯逻辑用例。定向服务端 10 项、客户端 4 项通过；全仓 pnpm test 通过（App 267 项），pnpm typecheck、4 个触及 TS 文件 oxfmt 通过。oxlint 无 error，报告原有 application-services/admission 类型断言等 warning，未做无关清理。
- 未操作用户凭据、会话或服务，未暂存或提交；需重启 pnpm server 并刷新前端后由用户继续 sign out/Passkey 登录验收。既有已登记 Passkey 无需重新配置。

### 提交前本地 session 恢复（2026-11-23）

- localhost Passkey 已成功签发 session，但工作台新连接的 resume 将 deviceId 为空误判为撤销，导致所有业务请求未认证。删除该误撤销分支，保留 TTL、撤销状态、trust epoch 验证与远程 deviceId 匹配。
- 原注册/认证回归延伸至应用服务的新连接恢复，覆盖本地 session 不得用于 Relay，跨 transport 失败不破坏本地 session；全部远程设备撤销后本地 session 仍可恢复。
- pnpm test、pnpm typecheck、暂存区 38 个 TS/TSX 文件 oxfmt --check 通过。提交前按仓库规则运行 lint:staged；实际 localhost 浏览器验收仍待用户重启 Owner 后执行。
- 本项维持当前认证模型；用户提出的本机直接使用、删除本地 Passkey/ticket/session 的方向将由下一份开发规格定义，不在本次修复中提前实施。
