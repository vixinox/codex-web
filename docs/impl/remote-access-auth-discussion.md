# 远程访问与认证方案讨论交接

本文整理 2026-10-29 至 2026-10-30 关于 Owner 登录、设备授权和 Paseo 取舍的讨论，供后续会话继续完善。它是产品讨论记录；可执行的最终契约以 [`remote-access-auth-spec.md`](./remote-access-auth-spec.md) 为准。若与当前实现或正式架构文档冲突，以当前工作包为准。

## 背景与问题

当前产品是单 Owner、本地运行时，通过 Relay 远程控制。当前网页登录同时包含本机 Owner 的邮箱/密码认证，以及远程 Owner 的 Relay URL、9 位 Owner code、指纹人工核验、邮箱/密码和 TOTP/恢复码流程。账户已启用 TOTP。

复杂感来自多种职责叠加：

- Owner 账户凭据回答“谁在登录”。
- 9 位 Owner code 和 Relay URL 回答“要连接哪台 Owner”。
- Owner 公钥指纹回答“加密通道另一端是不是预期 Owner”。
- 远程设备密钥和会话回答“已配对设备如何再次连接”。
- 设备撤销回答“某台设备失陷后如何单独收回权限”。

用户希望减少新设备和回访时的输入，同时保留人在外远程访问 Owner 的能力；不希望为了每次登录都接触 Owner 机器而牺牲可用性。

## 最新冻结的首次使用体验（2026-10-30）

本轮已确认采用渐进式安全设置：首次启动不要求用户知道或保存 recovery code，也不要求先注册任何 Passkey。Owner 初始化完成后，CLI 等待 Owner 监听就绪并只打印一次五分钟有效、单次消费的首登 URL/QR；用户扫描或打开后直接建立第一个远程设备 session，随后即可完整使用产品。

首登 URL/QR 只证明“这是本次 Owner 首次启动提供的入口”，不登记 Passkey、不创建第二台设备、不授权管理操作。Owner 指纹仍需在 E2EE 握手中核对。URL/QR 丢失或过期时，用户回到 Owner 机器执行显式 CLI 命令重新生成；Owner 重启不会反复刷屏打印。

首次登录后的管理页显示一次性安全设置提示。用户可以主动登记远程 Passkey、生成并保存 recovery code；本机 Passkey 必须在 `http://localhost:5173` 的本机页面单独登记，不能由远程 Passkey 代替。两种 Passkey 都是可选的启动后设置，但配置后可获得正常 Passkey 登录、恢复和设备管理能力。未配置任何恢复方式时，唯一 session 丢失后必须回到 Owner 机器重新生成首登 URL/QR。

登录页必须反映这种状态：已配对设备先尝试静默恢复；首登 URL/QR 显示为无需 Passkey 的“首次连接”；只有检测到远程 Passkey 时才显示 Passkey 登录；只有检测到 recovery batch 时才显示恢复码入口；两者都不存在时明确提示回到 Owner 机器获取新的首登 URL/QR。登录页不再出现邮箱、密码或 TOTP 表单。

## 已达成的方向

- 保留 9 位 Owner code，用于经 Relay 定位目标 Owner。
- 远程登录考虑以 Passkey 作为人的认证凭据；本轮明确暂不考虑 TOTP 作为远程认证方案。
- 官方远程客户端固定由 `https://codex.vixinox.com` 提供，Relay 固定使用 `relay.vixinox.com`；WebAuthn origin 为 `https://codex.vixinox.com`，RP ID 固定为 `codex.vixinox.com`。
- 本机和远程分别注册独立 Passkey，各自绑定本机与官方远程 origin；本机 origin/RP ID 仍需固定。
- 本机 WebAuthn 默认采用当前本机 Web UI origin `http://localhost:5173` / RP ID `localhost`；服务端按完整 origin 白名单校验，浏览器不得用 IP 别名访问本机登录页。
- 首次远程 Passkey 登记由首次登录后的 `/app/settings/connection` 主动发起；在远程 Passkey 尚未存在时，当前首登 session 可以完成这一步，后续新增/删除需 Passkey step-up。官方远程 origin 创建独立 Passkey，不与本机 origin 混用。
- 保留恢复码作为远程紧急恢复凭据，但不在首次启动时生成。用户在管理页主动生成后，恢复码可启动恢复；Owner 单次消费后必须登记新 Passkey，随后才建立完整 session 并轮换其余恢复码。
- 认证模型切换不做旧数据库迁移；允许删除并重建整个 `owner.sqlite`。这会同时清除其中的 Owner 账户/session、Project、Credential 和其他控制面数据，随后重新初始化 Owner。
- 提供一次性 URL/QR 作为一条龙连接入口，尽量打包 Relay URL、Owner code、Owner 身份信息和登录请求所需信息，减少手动录入。
- 首版由 Owner 初始启动路径通过 CLI 打印一次性首登 URL/QR；后续重新生成必须复用受控本机管理通道，不能另起独立 Owner 实例。
- 普通一次性连接包仅用于定位 Owner 和关联登录请求，不能签发 session。唯一例外是首登 `first_session` URL/QR：它是五分钟、单次、限定首个远程设备 session 的授权；不要求 Passkey 或 recovery code，不登记凭据，不能调用管理方法或授权第二个设备。
- 人在外且无法触碰 Owner 时，仍应可以通过固定登录页、Relay URL 和 9 位 code 找到 Owner，再用 Passkey 登录。一次性 URL/QR 是便利入口，不是唯一入口。
- 登录成功后，客户端保存设备密钥/会话以便同一已配对设备静默恢复；新增 Passkey、管理恢复码、撤销设备等安全管理操作要求 Passkey 再验证。

## 目标流程草案

### 首次设置

Owner 首次初始化只准备运行时和首登 grant，不登记本机 Passkey，也不生成 recovery code；移除用户名、邮箱、密码和 TOTP 这些用户凭据。CLI 打印一次首登 URL/QR，用户首登后直接获得第一个远程 session。随后在管理页主动配置远程 Passkey、recovery code，以及通过短时 ticket 跳转本机页面配置本机 Passkey。保留内部 Owner principal、Passkey credential、公钥、session、恢复码哈希和设备记录。本机 Passkey 使用 `http://localhost:5173` / `localhost`，不能复用 `https://codex.vixinox.com` 下的远程 Passkey。

### 新设备：现场或提前准备

1. Owner 首次启动后 CLI 打印首登 URL/QR。
2. 新设备打开 URL 或扫描 QR，建立到指定 Owner 的 Relay E2EE 通道并核对 Owner 公钥指纹。
3. Owner 原子消费 `first_session` grant，登记第一个设备身份并建立该设备 session；不需要 Passkey 或 recovery code。
4. 用户进入工作区。管理页提示可选的远程 Passkey、recovery code 和本机 Passkey 设置。

### 首次登录后的安全设置

1. 用户在 `/app/settings/connection` 主动选择登记远程 Passkey或生成 recovery code；首次远程 Passkey/recovery 设置可由首登 session 完成。
2. 用户需要本机 Passkey 时，管理页签发短时 localhost enrollment ticket，并引导用户在 Owner 机器的 `http://localhost:5173` 完成独立 WebAuthn ceremony。
3. 跳过设置不会阻止进入工作区，但管理页显示安全状态和丢失唯一 session 后必须回 Owner 机器的提示。

### 新设备：人在外，无现成一次性包

1. 用户打开固定登录页，使用上次保存或手动提供的 Relay URL，并输入 9 位 Owner code 定位 Owner。
2. Owner 返回与本次登录绑定的 Passkey challenge。
3. Passkey 认证成功后，Owner 为新设备登记设备身份并建立会话；若所有 Passkey 均不可用，则使用恢复码启动恢复并先登记新 Passkey。

这条路径是“人身在外仍能登录”的必要条件；若新设备必须拿到 Owner 当场生成的 URL/QR，目标就无法满足。连接包的“一次性”应约束为单次登录请求，而不应让唯一允许的远程登录入口必须现场签发。

### 已配对设备回访

已配对设备默认使用本地保存的设备密钥静默恢复远程 Owner 会话，不要求每次重新验证 Passkey。session 闲置 30 天过期，最长有效期 90 天；显式退出清除本地密钥/token 并撤销对应服务端 session。新增/移除 Passkey、恢复码轮换、设备撤销、Owner code 轮换、trust reset 和签发新设备 QR 时要求 Passkey 再验证。已有 Owner code 和 Relay URL 应优先从成功连接记录恢复。

## 安全语义与明确边界

- Relay 是传输/路由层，不应读取 Passkey 私钥或应用认证内容。E2EE 保护消息内容；Owner 身份仍需由已绑定的公钥/目标信息确认。
- Passkey 认证必须绑定正确的目标 Owner、一次性 challenge 和 WebAuthn origin/RP ID。本机 WebAuthn 只接受 `http://localhost:5173` / `localhost`，远程 WebAuthn 只接受 `https://codex.vixinox.com` / `codex.vixinox.com`；Relay 域名只承载传输，不改变 origin。Owner 必须校验 assertion 的签名、origin、RP ID 和服务端 challenge 绑定；不能假定 Better Auth 插件可直接覆盖经 Relay 的 E2EE RPC 流程。
- 恢复码是高熵、单次使用的备用凭据，只经 E2EE 传输；Owner 端只保存哈希并原子消费。恢复成功后需登记新的 Passkey，并轮换剩余恢复码。该路径是紧急恢复，不是日常登录方式。
- URL/QR 里的请求标识应是随机、短时、不可预测、服务端原子单次消费，并可在 Owner 管理端取消。普通登录 QR 不应单独充当长期 bearer 登录凭据；首登 `first_session` QR 是明确限定范围的短时 bearer，只能建立第一个 session。
- 首登 QR 泄露时，攻击者最多能抢先消费首个 session；因此必须绑定 Owner ID、节点公钥指纹、当前 trust epoch、官方远程 origin 和首个 E2EE 客户端公钥，五分钟有效、单次消费、Owner 重启失效，且不能调用管理 RPC 或登记第二台设备。普通登录请求仍要求目标 Owner 的 Passkey 或已配置的 recovery code。
- 新设备成功认证后创建设备密钥和独立 session。保留服务端逐设备记录、单设备撤销和撤销全部远程 session。设备页展示名称、创建时间、最近活动和撤销操作，不展示凭据材料。
- 手工输入的首次远程连接不能因为有 Passkey 就自动省略 Owner 身份绑定。Passkey 证明用户持有凭据，不自动证明 Relay 握手端就是预期 Owner；连接包或预存信任必须绑定目标 Owner 公钥。

## 已确认的模型与参数

以下方向和默认参数均已确认。

1. **移除用户账户凭据：** 移除用户名、邮箱、密码和 TOTP；保留内部 Owner principal/稳定 `ownerId`、Passkey credential 与公钥、session、恢复码哈希和设备授权记录。首次启动不要求 Passkey 或 recovery code；首登 session 后再分别注册本机与远程 Passkey。本机 origin/RP ID 为 `http://localhost:5173` / `localhost`。
2. **Passkey challenge：** Owner 生成至少 32 字节随机 challenge，有效 5 分钟，要求用户验证；绑定 Owner、用途、登录请求、E2EE 连接和待登记设备公钥，成功后原子消费。失败最多 3 次后作废并限速；校验签名、origin、RP ID 和用户验证标志。
3. **恢复码：** 每批生成 10 条高熵单次恢复码，Owner 仅存哈希并限速、原子消费。使用一条后轮换整批、撤销所有既有远程 session；先登记新 Passkey，再创建新 session。
4. **已配对 session：** 设备密钥静默恢复；闲置 30 天过期、最长有效期 90 天，到期后需对应 origin 的 Passkey 重新认证。新增/移除 Passkey、恢复码轮换、设备撤销、Owner code 轮换、trust reset 和签发新设备 QR 要求 Passkey 再验证。显式退出清除本地密钥/token 并撤销对应服务端 session。
5. **登录 QR/请求：** 普通 QR 只用于发现与关联请求，不是 bearer 登录凭据；首次启动的 `first_session` QR 是唯一例外，可在五分钟内单次建立首个远程 session，但不登记凭据、不授权管理、不允许第二设备。每 Owner 同时最多一个待处理请求，有效 5 分钟、单次消费、可取消；重发撤销旧请求。认证成功不另加人工批准，但 Owner 管理页记录并展示安全事件。
6. **Owner 身份发现与首次信任：** 固定客户端预设官方 Relay 地址，Owner code 只负责路由，回访使用已保存的 Owner 公钥。首次连接若无预存公钥，须通过 QR 或可信线下渠道核对完整指纹；不以 Passkey 代替 Owner 身份验证，不接受静默 TOFU。
7. **设备登记与撤销：** 保留服务端逐设备记录、单设备撤销及撤销全部远程 session。设备列表展示名称、创建时间、最近活动和撤销操作，不展示凭据材料。trust reset 同时使所有远程 session、待处理登录请求和 QR 失效，并要求设备重新配对。
8. **管理入口与 CLI：** `/app/settings/connection` 是首登后的安全设置和新设备请求签发入口。CLI 自适应工作：Owner 运行时通过本机 IPC 将命令交给 Owner；Owner 停止时，CLI 取得实例锁并启动短生命周期受管 runtime。IPC 仅允许同一 OS 用户，Windows 使用命名管道，macOS/Linux 使用 Unix domain socket；命令仍由 Owner application services 执行，不由 CLI 直接写库。CLI 初始启动只打印一次首登 URL/QR，不执行 Passkey ceremony，也不打印 recovery code；丢失/过期时通过显式命令重新生成。重置本机 Passkey 仅在 Owner 停止时由 CLI 执行，清除本机 origin 凭据并签发短时单次登记授权；Owner 重启后，`localhost` 页面仅允许登记新本机 Passkey。远程 Passkey、恢复码和其他数据不受影响。
9. **数据库切换：** 不为旧认证/Owner 数据库做兼容迁移；一次性删除并重建整个 `owner.sqlite`，重新初始化 Owner。清除 Project、Credential、Owner session 和其他控制面记录；Codex Home 中的 Thread transcript 不受影响。清理远程端 IndexedDB 旧 session，保留数据库外的 Owner node key/fingerprint，并让所有设备重新配对。

## Paseo 对照

已检查本机 `C:\Users\Hello\Desktop\paseo` checkout，已有代码调研见 [`research-paseo.md`](../research/research-paseo.md)。Paseo 普通 QR/链接主要携带稳定 server ID、Daemon 公钥和 Relay 地址，用来发现并加密连接到特定 Daemon；它不是本轮设想的单次登录授权。若 Daemon 配置机器密码，客户端还需要共享机器密码；普通 Owner 客户端没有邮箱账户、TOTP 或逐设备撤销凭据。其简洁来自机器级共享访问模型，代价是设备间不能独立授权和撤销。

本方案希望借鉴 Owner/Daemon 本地权威、Relay 只转发、连接信息由 Owner 提供的方向，但拟使用 Passkey 身份验证和逐次设备会话，语义比 Paseo 普通配对更强，也更复杂。

## 当前仓库能力与差距

- 当前远程登录实现仍要求 Relay URL、Owner code、人工输入并核对指纹、邮箱/密码和 TOTP；实现快照见 [`current-behavior.md`](../current-behavior.md)。
- 现有 `/app/settings/connection` 已通过当前运行的 Owner WebSocket 签发、取消、查询短期一次性 QR capability；兑换后建立远程会话并登记设备。Capability store 在进程内存，Owner 重启会使未消费的 grant 失效。
- 当前 QR 已包含 Relay URL、Owner code、Owner 节点信息、公钥指纹和一次性 capability；客户端会核验 QR 中公钥指纹与握手 Owner 公钥一致。
- 当前 QR 登录走独立的一次性授权兑换，不是 Passkey 流程，也不要求邮箱/密码/TOTP。登录页当前支持摄像头/图片扫描。
- 当前 CLI 在 Owner 运行时拒绝执行操作，Owner 停止时使用临时受管 runtime；因此 CLI 依托运行中 Owner 服务签发 QR 需要新增/重构管理通道。
- 仓库当前认证基线、Owner 会话及设备管理仍实现账户认证和 TOTP；本讨论已确认新模型移除用户名、邮箱、密码和 TOTP，但尚未实施。实现由拆分后的工作包负责，并在 M6 与 `PROJECT.md`、`docs/owner-remote-architecture.md`、`docs/api/README.zh-CN.md` 和 `docs/current-behavior.md` 对齐。

## 规格状态

实现级工作包入口见 [`remote-access-auth-spec.md`](./remote-access-auth-spec.md)，协调索引见 [`remote-access-auth/README.md`](./remote-access-auth/README.md)。认证模型、主要参数和首次 `first_session` bootstrap QR 权限范围已冻结。拆分包明确规定旧认证/QR/CLI 代码的替换与删除顺序、包间依赖、验收命令和交接格式；不得直接复用当前 QR capability 的授权语义。
