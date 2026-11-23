# 本机直接使用与统一 Passkey 开发规格

## 状态与启动指令

- 状态：**Verified**（实现、自动化检查和代码格式检查已完成；真实数据库切换与新代码浏览器回归待用户停止当前服务后执行）。
- 本轮用户指令：开始实施并完成任务。没有提交改动；没有重建真实数据库或停止现有服务。
- 目标：本机打开即用；远程首次经登录链接授权，之后使用设备 session、Passkey 或新链接登录。用户只看到一套 Passkey。
- 实施顺序为 [01 服务端](01-server.md) → [02 前端](02-app.md) → [03 收尾验证](03-integration.md)。本轮用户授权按需使用 subagent 并行推进。

## 基线、事实与冲突

基线是当前工作区源码。此前暂存区已按用户要求提交为 `0474cea`，提交后工作区干净；本规格不从历史 diff 推断设计意图。

已核对：

- `owner/websocket.ts` 将直连标为 local，但只检查 `config.trustedOrigins`；该集合还包含远程 App origin，没有独立的本机授权检查。
- `config.ts` 限制 Owner 监听 loopback；Vite 当前 `server.host: true`，会监听网络接口并代理 `/ws`。
- `session-runtime.ts` 以 Owner 上下文保护业务方法；hello 通过 bearer 恢复数据库 session。`sessionId` 也用于约束事件订阅，不能直接删掉上下文中的标识。
- `auth-domain.ts` 有 local/remote 两套 WebAuthn profile、本地 ticket、本地及远程 session；数据库有 `local_enrollment_ticket` 和两种 Passkey 配置时间。
- 前端 `auth-client.ts` 保存本地 bearer；路由、runtime hook、退出和过期处理都依赖它。runtime hook 当前把 transport connected 直接投影为 ready，未要求认证成功。
- 远程 enrollment、设备撤销和 CLI IPC 已集中实现；保留这些模块与四个 CLI 命令。
- `pnpm db:reset` 已是显式交互式重建入口；目前保留 remote trust peers，会使新 SQLite 与旧 peers 不一致，须在同一重建工作中清理 peers。

冲突与权威：用户最新方向取代 `AGENTS.md` 的“Owner runtime local and authenticated”中必须交互登录的解释，以及 PROJECT、架构/API/前端文档、旧 Connection 规格、`docs/sign-in-page.md` 的 local Passkey/ticket/session 要求。仍保留 Owner 身份、受限本机授权上下文及所有业务归属校验。实施时更新上述现行文档；旧 Connection 规格标为被本文部分取代。登录页视觉设计仍有效，仅删除本地待验证场景，不扩展为整页视觉重做。

## 用户与系统模型

| 场景 | Before | After |
| --- | --- | --- |
| 本机打开 `/app` | local Passkey → 本地 bearer → 新连接恢复 | 本机连接检查 → Owner ready → 工作台 |
| 本机设置 | local/remote Passkey、ticket、登录链接、设备 | 一项 Passkey、登录链接、设备 |
| 本机退出 | 清 bearer，返回可再次登录的页面 | 无 Sign out；关闭页面或停止 Owner |
| 首次远程加入 | 单次链接 → 设备登记与 session | 保留 |
| 已登记远程登录 | session 或 remote Passkey/新链接 | 保留，名称统一为 Passkey |
| CLI | 本机 IPC、四个管理命令 | 保留，不增加登录/Passkey 命令 |

本机访问权来自本机环境，不由可复制的本地 bearer 表达。此模型信任能在本机运行程序的用户，不提供同一操作系统账号内的恶意进程隔离；公网/局域网访问不得因为经过本机代理就自动获得授权。

## 决策与不变量

| 决策 | 状态 | 方案与边界 |
| --- | --- | --- |
| 本机免交互认证 | **Confirmed** | 用户提出更进一步重构；删除 local Passkey，不提供免登录开关或并行旧模式 |
| 一套 Passkey | **Confirmed** | 用户不区分 local/remote；仅部署的远程 HTTPS App origin/RP 可注册和验证 |
| 数据处置 | **Confirmed** | 用户允许重建数据库，不做保留升级；新代码识别旧结构并提示显式 `pnpm db:reset`，启动不自动删除数据 |
| 本机边界 | **Recommended default（已采用）** | loopback peer + 本地 Host + 精确 local Origin；Vite/preview 限 loopback；不采用仅 Origin、仅 IP 或浏览器 hostname 放行 |
| 配置入口 | **Recommended default（已采用）** | 复用 enrollment 打开远程设置；不新增注册票据或跨域 Passkey 转换 |
| 本地授权标识 | **Recommended default（已采用）** | 每个连接构造短期内存 OwnerAdmission；不持久化/签发 bearer，`sessionId` 为服务端随机连接作用域标识 |
| 环境配置 | **Recommended default（已采用）** | `CODEX_APP_ORIGIN` 只表示远程 HTTPS App；RP ID 从其 hostname 推导，删除冗余 `CODEX_APP_RP_ID`；纯本地运行可无远程配置 |

本机防护可选仅收紧 Origin 或加入本机 token；前者不足以约束代理路径，后者重新增加凭据生命周期，因此采用上表组合。配置入口可只显示远程地址，或复用登录链接；采用后者减少手工步骤。数据库不采用定向升级或暂留空表，这是用户明确选择。

必须保留：单 Owner、loopback runtime、Owner 身份和业务归属检查、远程 E2EE identity pin、已登记设备约束、session TTL/撤销、邀请单次/替换/过期、远程 step-up、可信 device_revoked 停止重连。不得恢复 Guest、Owner code 输入、trust reset 或匿名远程访问。

## 服务端边界与接口

### 本机直连

1. Owner 仅监听 `127.0.0.1`/`::1`/localhost。`/ws` 在创建 runtime 前检查实际 socket peer 为 loopback（含 IPv4-mapped IPv6），不采用 forwarded headers 作为证明。
2. Origin 必须精确为 `http://localhost:5173` 或 `http://127.0.0.1:5173`。拒绝缺失、null、远程 origin、任意其他端口/域名；配置中的远程 origin 不得扩展这份授权表。
3. 校验原始 Host authority，仅允许本地 hostname 与 Owner 当前端口，及 Vite 代理保留的本地 hostname:5173；拒绝重绑定域名、格式错误和伪装 X-Forwarded-Host。端口来源为已有 config，无新增信任配置。
4. Vite dev/preview 绑定 loopback，明确端口 5173；不得配置网络监听或任意 allowedHosts。`/ws` proxy 保留上述检查可识别的 Host 和 Origin。公开部署只公开静态 App 与 Relay，不代理 Owner `/ws`；本机免登录不支持公开隧道/自定义域名直通 Owner。
5. 通过检查且已有唯一 Owner 后，由 WebSocket adapter 注入 `localAdmission: OwnerAdmission`（OwnerSessionRuntime options 的内部字段），不是客户端 frame。hello 时只在 `transport.kind === 'local'` 消费，直接发送 authenticated ready。
6. local admission 包含 `ownerId`、`sessionId: local:<server-generated-connection-id>`；无 sessionToken/deviceId/stepUpAt。连接关闭即消失，不写数据库。没有 Owner 或初始化失败则 fail closed，不伪造 Owner。
7. 继续以现有 authenticated 方法守卫执行业务；不得改成所有 local 方法绕过 `requireOwner`。事件订阅保留 sessionId 绑定，新本地连接重新订阅；不构造永久本地 session。

### 远程与 Passkey

- Relay 路径不能读取 localAdmission；enrollment candidate 仍只能兑换邀请，已配对未登录连接仍只能执行公开认证方法。
- `auth-domain` 只接受一个 `{ origin, rpId }`，删除 profile 枚举与 profileName 参数；保留 origin/rpId 对实际 Passkey 的校验和持久化，不能删除 WebAuthn 的域名边界。
- `registerOptions/register/authenticationOptions/authenticate` 只由 E2EE Relay transport 使用；注册仍须已认证，local 调用返回现有 local/origin 边界错误。认证签发 session 必须绑定有效 pairedDeviceId；`owner_session.device_id` 改为非空。
- `owner.passkey.authentication.verify` 保留 `{ ownerId, token, expiresAt }`。`owner.security.status` 用 `passkeyAvailable` 取代 local/remote 字段，并返回 `appOrigin: string | null`，保留 devices/currentDeviceId。`owner.status` 返回一致的 Passkey 字段。是否存在远程配置由服务端判断，不从用户浏览器当前域名推断。
- `owner.enrollment.issue` 返回 `{ reference, expiresAt, appOrigin }`，Web 与 CLI 使用服务端配置的 origin 构造链接；不得继续用当前 localhost origin 生成远程邀请。相关状态查询也返回同一 appOrigin，避免刷新后退回当前 origin。
- 远程未配置时 `appOrigin = null`、Passkey unavailable，本机工作台及 CLI 设备查询仍可用；生成邀请/配置 Passkey按既有 remote-unavailable 错误失败，不生成伪 localhost 远程入口。配置 Relay 时要求 HTTPS `CODEX_APP_ORIGIN` 与 WSS/既有允许的开发 Relay 配置正确；不再默认生成 localhost WebAuthn profile。
- 删除 `owner.localEnrollment.issue`、ticket 入参/transport 字段、local Passkey handlers；无别名。保留四个 CLI 命令及 IPC 白名单。通用 `owner.session.close` 仅用于远程持久 session，本地不需要退出 API。

## 前端流程与状态所有权

- 本地环境由一处纯逻辑判定，仅匹配上述 origin；浏览器判定只选择 UI/transport，不能授予服务端权限。本地优先于旧 `active-connection-profile` 或 connection query，不以存储决定本地/远程。远程 origin 即使在运行 Owner 的同一台机器上打开，也仍按远程流程，不能从物理位置推断免认证。
- 本地 `/`、`/login` 进入 `/app`，`/app/*` 保留目的路径直接连接本机 `/ws`。从 ready.ownerId 获取实际身份，不从旧本地 bearer、location state 或硬编码取值。
- ready frame 为本机 authenticated 响应增加 ownerId；认证 ready 必须提供有效 ownerId，未认证 ready 不携带身份。Owner shared parser/runtime/controller 更新同一合同，远程 session 恢复亦一致。
- `useOwnerRuntime` 移除 sessionToken 参数，使用本地 origin 或远程 profileId 选择 target；没有 profile 的远程页面不得回落直连本机 `/ws`。
- 工作台、设置 client 与全局 Owner bridge 仅在 `transport === connected && authentication === authenticated` 后暴露 ready。远程 session 被拒绝时清当前 profile session、返回登录；本机授权失败显示连接错误，不跳回不存在的本地登录，也不无限重试。保护 Codex/status、Project、Credential 与订阅，不能靠延时或吞 unauthorized 修复。
- 删除 `lib/auth/auth-client.ts` 及所有调用、local signIn、local bearer 读取/保存/退出/过期分支；本地侧栏不传 onSignOut，renderer 无回调时不显示按钮。远程退出语义保持现状，仅清当前浏览器 session。
- 旧 sessionStorage key 不再读取；它随浏览器 session 结束自然消失，不保留兼容适配器。浏览器 profile 数据结构不改，不做历史重复记录合并。

### 一项 Passkey 设置

- 远程已登录设置页：只展示 Passkey 状态和创建按钮，用户点击后调用系统认证器；不展示 Local/Remote origin 行。
- 本机设置页：若未配置，显示“设置 Passkey”；使用现有 `owner.enrollment.issue` 得到短期链接，打开远程 `/app/enroll?ref=...&next=connection`。只有固定枚举 `next=connection` 可用，不接受任意 return URL；它仅控制成功导航，不改变授权和 wire grant。浏览器阻止弹窗时显示可点击链接，复制能力复用现有控件。
- 远程登录页兑换成功后，普通链接进工作台；next=connection 进入现有 Connection 页面。用户再次点击创建 Passkey，不自动唤起系统认证器，不增加页面。
- 这会正常登记/复用当前浏览器在远程 origin 的设备，并替换全局单个待用邀请；原设置附近说明“将打开远程网站；当前待用登录链接会被替换”。不新增独立配置 invitation 类型。
- 成功/取消/过期/Owner 离线遵循既有流程；本机页显示状态仍走现有读取路径，回到页面时刷新，不能因为打开链接就显示配置成功。生成后已消费但取消 Passkey 时，已授权设备正常保留，不额外补偿撤销。
- localhost 收到旧 enrollment URL 时不消费远程 grant、不登记本机设备；直接进入本机工作台。新链接始终指向服务端 appOrigin；不新增 localhost→remote 重定向兼容流程。

## 删除与数据重建

直接删除 local_enrollment_ticket schema/导出/逻辑、owner.local_passkey_configured_at、local profile、ticket DTO/错误专用代码与测试、本地 session 存储和入口。Owner 的 Passkey 状态以当前部署 origin 的实际 credential 为真值；删除 remote_passkey_configured_at 冗余标记，统一状态字段为 passkeyAvailable。

不做迁移或保留升级。旧数据库启动时检查旧 ticket 表/旧配置列/nullable session.device_id，返回清晰的显式重建提示；不静默带旧结构运行，也不自动调用 db:push/reset。

用户明确允许重建；实际实施阶段可在所需服务停止且路径验证后复用 `pnpm db:reset` 的交互入口执行，不能删除整个 dataRoot。重建清空 Owner SQLite 内的 Project 分组、API Credential、Passkey、设备、session、事件等控制面数据；Codex Home 原生历史和工作区文件不删除。Owner 数据库身份重新初始化，旧浏览器 profile 不再匹配，需从登录页移除旧连接并用新链接加入。

重建脚本必须先取得现有实例锁；复用 RemoteTrustStore.clearPeers 清 peers，保留 nodeId/keyPair/trustEpoch；检查/删除准确的 owner.sqlite 及其 WAL/SHM 文件再建表。任何失败停止并报告，不声称数据仍保留，不自动启动 Owner。无通用迁移框架、数据导出、旧数据库兼容读写或第二套认证实现。

## 范围与验收

范围只包括上述认证、入口、相关 schema/config、必要文档与测试。无页面视觉重做、依赖新增、OAuth、多账号、多 Owner、CLI 新命令、会话管理扩展或 Codex App Server 协议改动。

实施依赖：01 冻结服务端接口并验证本机边界；02 消费接口并删除本地生命周期；03 汇总跨连接回归和清理现行文档。每包包含本身必要的删除工作，03 不是泛化的后续 cleanup。

开发期必须验证：

1. 本机无 bearer hello 可获得 Owner、受保护业务及事件；每次重连独立授权。恶意/远程/missing/null Origin、非法 Host、非 loopback peer、spoofed forwarded headers 无法使用本机授权，Vite 代理实际 Host/Origin 行为有覆盖。
2. localAdmission 不得用于 relay；远程无 session、过期/撤销 session 不显示 ready、不触发任何 workspace bootstrap。有效远程 session、Passkey、邀请与设备撤销保持现有不变量。
3. 合成 authenticator 注册 → 签名登录 → 关闭原连接 → 新 session 恢复 → 受保护请求，使用真实应用服务与 session runtime，不能止于返回 token。断连/旧 socket 隔离/无多余重连测试继续通过。
4. 新库无本地认证结构；旧库被拒且不改写；reset 在临时 fixture 清控制面/peers并保留 node identity/Codex Home；锁冲突不删除。浏览器旧 local storage 不影响本机访问。
5. 配置入口生成可信远程 origin、固定 next 参数；拒绝任意跳转；失效邀请保留现有失败清理。
6. 聚焦 tests 后执行全仓 `pnpm test`、`pnpm typecheck`、触及 TS/TSX 的 `pnpm exec oxfmt --check`。只有再次获准提交时才 stage intended files 并 `pnpm lint:staged`；本规格不要求自动里程碑提交。

手工验收：实施后复用用户 Vite 5173、Owner 3000、Relay，按任务包执行本地刷新/深链接/设置、远程加入/Passkey/退出/撤销。真实 Bitwarden 交互属于用户后置验收，不代替开发期边界与协议测试；普通本机浏览器回归由实施者在可访问环境执行并记录限制，不新增 DOM/Playwright/截图测试。

## 未决项与交付门禁

无阻塞决策。推荐默认已标明边界，未冒充逐项用户确认。需执行者核对反向代理部署没有公开 Owner `/ws`；不支持以远程代理绕过本机来源校验。若实施证据表明上述 Host/Origin 合同不可满足，先更新规格并补证据，不能回退任意 trustedOrigins。

## 实施结果（2026-11-23）

- 01/02/03 代码范围完成：本机 peer + Host + Origin 校验及内存 admission；authenticated ready 带 `ownerId`；远程 Passkey 单 origin/RP、设备绑定 session、服务端 appOrigin；移除 local ticket/Passkey/bearer 生命周期；连接状态只有认证后才开放 workspace/bridge；Vite/preview loopback；reset 只触及 owner.sqlite 与 WAL/SHM，并清 peers、保留 node identity。
- 自动化通过：全仓 `pnpm test`、`pnpm typecheck`、本任务 43 个存在的 TypeScript 文件 `oxfmt --check`。Server reset fixture 验证清 SQLite/peers、保留 node identity/Codex Home、清理 WAL/SHM 和锁冲突不删除；WebSocket 回归覆盖 loopback peer 地址族、恶意/远程/null/missing Origin、伪装 Host/forwarded header 与 authenticated 本机调用；Protocol ready parser 验证 ownerId 合同。
- 配置与现行文档已同步，包括 `AGENTS.md`、`PROJECT.md`、架构、API、前端、`current-behavior.md`、`.env.example`、README 与 sign-in 说明。旧 Connection 管理规格已加入被取代指针，保留远程设备/邀请历史约束。
- 未执行真实 `.data/codex` 重建或服务重启：用户现有 Fastify 3000、Vite 5173、Relay 8787 正在运行。浏览器复用既有页面看到 `Owner connection failed`，该 Fastify 进程没有加载新代码；切换服务后还需执行本机和远程浏览器回归。由用户停止 Owner 后执行 `pnpm db:reset`，会清空 SQLite Owner 控制面数据、Passkey 和设备，保留 Codex Home、工作区文件和 Owner node identity。Bitwarden Passkey 的真实创建/登录仍为用户后置验收。

启动前和冷启动门禁已核对：旧路径、数据重建、协议/身份、错误/恢复、自动验证及用户验收均有归属。实现与自动化验证完成；上述服务切换后的手工步骤仍未完成，不据此宣称已通过。
