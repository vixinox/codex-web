# Remote Agent Handoff

本文件供下一 session 继续进行技术选型与实施决策。它记录当前对项目方向的共同理解，不是最终实现规格；下一 session 应在此基础上补齐协议、数据模型、进程边界、部署方式和实施拆分。

## Guest 清理阶段的历史暂停点

本节记录 Guest 清理改动开始时的暂停状态；本轮基线迭代的当前状态、验收和阻塞项以 [`docs/product/owner-remote-baseline-iteration.md`](product/owner-remote-baseline-iteration.md) 为准。

用户原本要求先把方向和未决项固定到文档，不进入实现；随后明确同意移除 Guest，并要求把剩余决策和推荐方案写下来。本 session 的实现改动已经接近完成，因此当前工作区同时包含 Guest 清理代码和架构文档改动。用户要求本次在记录进度后结束，不再继续改代码或跑验证。

Guest 已从 Owner/Guest 双运行时收敛为单一认证 Owner 模型：删除了 Guest 服务、API、认证插件、lease/quota 管理、Guest 前端入口/适配器、专属配置和启动脚本；移除了对应 schema 与测试，并清理了项目说明。Owner 登录保护、首次账户创建保护和本地 Fastify/运行时流程保留。远程 Connector 尚未实现。

当时的验证状态是：`pnpm typecheck` 通过；前端测试为 250 项；服务端测试有两条旧的 `reasoningEffort: "extreme"` 断言失败；格式、聚焦服务端测试、数据库和手动浏览器回归尚未完成。当前结果不在此处维护。

当时尚未运行数据库迁移；本轮已在确认目标为本机可丢弃数据库后执行重置和 schema push。服务由用户操作；需要浏览器回归时，请用户启动 Vite `5173` 和 Fastify `3000` 后验收，不由 Agent 启停服务。

## 决策优先级

上文“未决事项与推荐方案”列出 14 个主题，其中数据库清理已由 Owner Remote 基线工作包承接。其余推荐方案是讨论起点，不应被误读成已经全部批准的协议规格。后续远程实现按以下次序收敛，避免先做外围产品决策：

### 开始第一条远程链路前必须拍板

1. **Relay 部署与持久化边界**：首版是否按推荐采用单实例 Relay + 独立 PostgreSQL；确认 Relay 故障时机器本地继续运行，且事件副本有 TTL。具体 TTL、容量上限和部署商可在压测/成本评估后确定。
2. **账户与配对信任根**：确认公网 Relay 的用户身份如何建立，以及本地 Better Auth 用户如何与 Relay 账户关联；推荐不复制本地密码或 session cookie，通过短时一次性配对码和已认证控制端完成绑定。配对码是否需要 Owner UI 明确批准、过期时间、错误次数限制和撤销语义要写入协议。
3. **机器/设备凭据生命周期**：确定首次注册、凭据轮换、撤销传播和离线机器再次上线的规则。推荐机器密钥与控制设备密钥分离，Relay 对每次新连接校验撤销状态，Connector 也必须能收到撤销或通过短期凭据停止接受旧设备。
4. **首条命令和授权范围**：把首版可远程调用的 Owner 能力列成白名单。推荐先支持列出受控 workspace/Thread、创建或恢复 Thread、发送消息和取消 Turn；任意路径、任意命令、任意文件浏览不进入首版。明确 owner runtime 未启动时返回 `runtime_unavailable`，Connector 不隐式启动它。
5. **协议与幂等最小合同**：确定版本化 envelope、身份字段、命令 ID、状态条件、错误模型和未知版本处理。推荐共享包用运行时 schema 校验，命令按 `commandId` 去重，过期/重复请求有确定结果；先用一个命令完成端到端验证。

### 首条链路后、事件同步前必须拍板

6. **事件同步和数据最小化**：确定哪些安全投影事件可远程显示、哪些字段绝不离开 Owner、thread 序列号和本地游标如何持久化。推荐本地 `.data` 是权威来源，Relay 只留有限期密文副本；缺口从本地重建，不能补齐时明确提示历史不完整。
7. **密钥方案与新设备恢复**：选择成熟且同时支持浏览器和 Node 的加密库，并确定设备密钥、会话密钥、配对交换、备份/恢复和撤销后的轮换策略。推荐先完成威胁模型，Relay 永远不接触明文密钥；在恢复 UX 未定之前不要承诺多设备无损恢复。
8. **Connector 生命周期与崩溃语义**：确认 Fastify lifecycle plugin 的启动顺序、关闭排空策略、命令执行记录的持久化位置，以及进程崩溃时 `running` 命令如何查询/人工重试。推荐单队列、先记录再执行，未知执行结果不自动重放有副作用命令。

### 可以留到纵切验证之后

9. **Relay origin 与产品形态**：官方服务/自托管的发布计划、域名和 issuer 可先用单一可配置 Relay 验证。推荐前端和 Relay API/WS 尽量同源；Connector 与控制端固定同一 Relay，切换 Relay 需要显式迁移或重新配对。
10. **离线 PWA 与推送**：推荐首版只展示缓存概要、保留草稿和 UI 偏好；不持久化长效密钥或完整 transcript，恢复联网后由用户确认发送。推送通知、多 Relay 切换和多机器调度延后。
11. **Workspace 展示模型**：推荐本地 Owner UI 注册/命名 workspace，远端只拿稳定 ID、用户定义名称和能力集合，不传绝对路径。首版先验证单 workspace 是否足够，再扩展列表和管理 UX。
12. **运行指标与平台扩展**：先完成 Windows 单机纵切，再验证 Linux；确定事件 TTL、清理频率和指标后再考虑多 Relay 副本、协调和控制面。
下次远程实现的建议起步顺序：先选择第 1-5 项中的一项逐项讨论并把结论冻结为短 ADR；首轮技术讨论建议从“公网 Relay 账户如何与本地 Better Auth Owner 身份关联、配对信任如何建立”开始，因为它决定后续设备身份、凭据、撤销和前端登录边界。一次讨论一个主题。

## 当前目标

在现有 Codex Web 基础上完成一个远程产品闭环：用户在自己的 Windows 或 Linux 机器上运行 Codex Web 的本地执行环境，通过 Web/PWA 从其他设备访问和控制该环境中的 Agent。

产品语境：

> 面向个人开发者的本地 Agent 远程控制平面。

它不是 Codex Desktop/CLI 的 Web 镜像，也不读取用户原生 Codex 数据目录；它远程访问的是 Codex Web 自己维护的运行时、workspace、Thread 和事件。

## 已冻结边界

- 首版用户模型是单个账户；
- 产品前期只支持经过身份验证的 Owner 用户；Guest 匿名试用及其运行时、API、lease、quota、前端入口和管理功能已干净删除，不保留兼容模式。公开展示/试用是产品稳定后的独立决策。
- 首版先验证一台执行机器；数据模型和服务边界可以为未来多机器保留扩展点。
- 执行平台为 Windows or Linux。
- 控制端为桌面 Web + 移动 PWA；
- 本地 Connector 集成在 Owner Fastify 进程中，由 Owner 的生命周期承载；首版不要求额外的 Connector 进程、Windows Service 或 Linux systemd 安装器。
- 公网拓扑采用 `公网 Relay + Owner Fastify 内的 Connector module + Web/PWA 控制端`。
- 当前 Owner Fastify 继续只绑定本机 loopback，作为本地控制层；不直接改造成公网服务。
- Owner 内的 Connector module 主动向 Relay 建立出站双向长连接；浏览器不直接连接用户机器。
- relay 负责设备、机器、会话路由、在线状态、加密事件副本和恢复所需的序列信息。
- 本地 `.data` 是 Codex Web 运行态和完整历史的权威来源；relay 只保存有限期的端到端加密副本。
- relay 不应读取会话正文或 Agent 输出；路由所需的账户、设备、机器、会话 ID、序列号和在线状态可以是明文元数据。
- 不读取、不写入、不监控用户的 `User/.codex`、rollout、Desktop/CLI 历史或其他原生 Codex 产品目录。
- credential、Thread、事件、workspace 映射和运行状态继续按现有 Codex Web 规则维护在本地 `.data` 中。
- connector 只管理 Codex Web 自己创建和维护的 runtime、会话与工作区。
- workspace 由本地 connector 显式选择和注册；远程端只看到用户定义的项目名和受控能力，不接收宿主机绝对路径，也不提供任意文件系统浏览。
- Codex sandbox 只负责执行层隔离；远程产品仍需独立处理设备认证、设备撤销、workspace allowlist、命令能力和 relay 访问控制。
- 首版只管理 connector 创建或明确接管的 Codex Web 会话，不同步 Codex Desktop/CLI 已有会话。
- 首版不实现多模型、多租户、多人共同控制、多机器统一调度、任意终端控制、任意文件系统控制、语音和社交功能。

## 已锁定的技术选型

- 仓库按最小 pnpm monorepo 扩展：现有根 package 继续承载 Vite、Owner 和本地数据库，不搬迁现有应用目录；新增 `apps/relay` 和 `packages/remote-protocol`。
- `apps/relay` 首版使用 Hono + Bun，作为独立运行与部署单元；Hono 组织 HTTP API，Bun 适配层承载 HTTP server 和 WebSocket upgrade/server 能力。
- `packages/remote-protocol` 是纯 TypeScript 共享协议包，承载 Relay、Connector、Web/PWA 共用的 envelope、消息类型和协议版本规则；不依赖 Node、Bun、Fastify、Hono、React 或数据库。
- Bun 专属 API 限制在 Relay 启动/传输适配层，Relay 核心规则和共享协议保持运行时无关，为将来迁移至 Node 或 Cloudflare Workers 保留路径。首版不引入 Cloudflare Workers 或 Durable Objects 运行依赖。
- Owner Fastify 继续承担本地控制层；Relay 不复用 Owner 进程入口，也不把 Owner 暴露到公网。
- Connector 首版作为 Owner Fastify 内的 Node.js/TypeScript 模块运行，不引入独立进程或 Go；它主动连接 Relay，并直接调用 Owner 内部受控能力。

## 目标架构

```text
本地浏览器
    |
    | loopback
    v
Codex Web Owner / Fastify Bridge
    |
    +-- 本地 .data
    +-- Codex runtime
    +-- 受控 workspace
    +-- Connector module -- 出站 WebSocket / 长连接 -- 公网 Relay
                                                        |
                                                        +-- 桌面 Web 控制端
                                                        +-- 移动 PWA 控制端
```

本地 Fastify bridge 继续负责 Better Auth、Credential、Project、Thread、Codex App Server 和本地 REST/SSE。Connector module 是远程连接和机器生命周期边界，不应把宿主机任意能力暴露给 Relay 或浏览器；它与 Owner 共用进程，但保持独立的协议、权限和命令队列模块边界。

## Happy 参照结论

Happy 的参考实现包含：本地 daemon/CLI 执行端、机器注册、会话和机器级连接、Socket.IO 实时同步、持久/临时事件分离、序列号恢复、设备身份、客户端加密、访问密钥和多端控制。它已经证明“从手机控制自己机器上的 Agent”是成熟方向。

因此本项目不应宣称发明远程 Agent 范式；项目价值是完成自己的本地 connector、relay 协议、Codex Web 数据边界、设备生命周期和可验证的断线恢复闭环。

参考：

- https://github.com/slopus/happy
- https://github.com/slopus/happy/blob/main/docs/backend-architecture.md
- https://github.com/slopus/happy/blob/main/docs/cli-architecture.md
- https://github.com/slopus/happy/blob/main/docs/protocol.md
- https://github.com/slopus/happy/blob/main/docs/encryption.md

## 首版远程闭环

```text
Windows/Linux 启动 Owner Fastify（内含 Connector module）
  -> Connector 连接 Relay 并注册机器
  -> 本地绑定一个受控 workspace
  -> Web 登录并生成一次性 QR/配对码
  -> 绑定控制设备与机器
  -> PWA 创建或恢复 Codex Web Thread
  -> 远程发送消息并实时查看安全投影事件
  -> 关闭本地浏览器，Agent 继续运行
  -> PWA 发送下一条受控指令
  -> 网络短断后按序列号补齐事件
  -> 撤销 PWA 设备
  -> 后续同步和控制请求被拒绝
```

首版远程控制动作：

- 创建或恢复 Codex Web Thread；
- 发送用户消息；
- 取消当前 Turn；
- 响应允许远程处理的 Codex 请求；
- 查看安全投影后的历史；
- 查看 connector、机器和会话在线状态。

本地浏览器和 PWA 可以同时连接同一会话；所有控制命令由 connector 的单一队列串行处理。

## 已确定的可靠性与安全语义

- 每个控制命令包含客户端生成的 `commandId`，避免网络重试导致重复执行。
- 命令应带目标会话版本或等价的状态条件，过期命令必须拒绝。
- 命令状态至少区分 `queued`、`running`、`completed`、`rejected`。
- 持久事件使用序列号、客户端确认点和缺口补发；WebSocket 自动重连本身不算恢复保证。
- connector 离线时，PWA 可以保存草稿，但恢复连接后由用户确认是否发送；不自动执行可能已经过期的指令。
- relay 故障时，本地 `.data` 和本地 Agent 可继续运行；恢复后补同步。
- 新设备通过一次性 QR/配对码取得读取加密历史所需的密钥材料。
- 设备身份和机器身份分开管理；账户可以查看和撤销控制设备。
- 撤销设备立即阻断后续同步和控制，但不承诺远程收回该设备已经缓存或解密的明文。
- 撤销后只对后续新会话轮换密钥；首版不强制重加密全部历史。
- relay 的加密事件设置有限保留期；本地 `.data` 继续保留完整历史。

## 未决事项与推荐方案

以下是当前仍未实现或未拍板的事项。推荐值作为下一轮决策起点；实施前应将协议、安全相关决定写成短 ADR 并用端到端切片验证。

1. **Relay 持久化与部署规模**：推荐 Relay 使用独立 PostgreSQL 保存账户、设备、机器绑定、撤销状态、命令去重元数据和有限 TTL 的密文事件副本；在线 WebSocket 注册表保留内存态，首版单实例部署。不要先做多副本协调。事件副本 TTL 和总量上限需按恢复体验、成本确定。
2. **远程身份与现有 Better Auth 的关系**：推荐 Relay 作为远程账户身份的公网认证入口，控制设备使用独立设备凭据；本地 Owner 的 Better Auth 继续保护本机 UI/API。配对时通过短时、一次性配对码把机器绑定到账户，不向 Relay 复制本地密码或 Owner session cookie。
3. **机器与设备身份/撤销**：推荐机器和控制设备分别有不可变 ID 与独立密钥；Relay 持久化账户绑定和撤销状态。配对码短时、单次使用并由 Connector 本地确认；撤销后 Relay 拒绝新握手/命令，Connector 对已建立连接也执行撤销通知或短期凭据过期检查。
4. **共享消息协议**：推荐 `packages/remote-protocol` 定义带 `version`、`type`、`requestId`、`machineId`、`deviceId` 和受限 `payload` 的显式 envelope；用运行时 schema 校验入站消息，未知版本/类型 fail closed。命令采用客户端 `commandId`、目标 Thread/状态条件和 queued/running/completed/rejected 状态。
5. **WebSocket 实现**：推荐 Relay 用 Hono+Bun 单进程，Hono 处理 HTTP，`Bun.serve` WebSocket handler 负责 upgrade 与连接生命周期；Owner Connector 用 Node `ws` 客户端；浏览器用原生 WebSocket。以同进程 smoke test 验证关闭、心跳、认证失败和重连，暂不采用 uWS。
6. **端到端加密和密钥恢复**：推荐先选成熟、跨浏览器/Node 的密码学库并做威胁建模，不自创密钥协议。长期身份密钥留在设备本地，消息使用 AEAD；Relay 仅存密文。新设备通过已认证配对流程取得会话密钥材料；撤销不能收回旧明文，只轮换后续新会话密钥。密钥备份/多设备恢复的 UX 在实现前必须定案。
7. **事件权威、序列和补发**：推荐本地 Owner `.data` 为历史权威；Connector 从现有安全 SSE/EventHub 投影事件。为每个 Thread 分配单调序列并本地持久化游标，Relay 保存带 TTL 的密文副本与 ack 游标；副本过期或缺口无法补齐时，Connector 从本地重新生成并补发。
8. **Connector 生命周期与 Owner 未 ready**：推荐 Connector 在 Owner App Server 与本地存储初始化完成后启动，作为 Fastify lifecycle plugin；关闭时先停止接收命令、排空队列、断开 Relay。Owner runtime 未启动时允许设备/机器在线并列出能力，但创建/继续 Thread 的命令返回明确的 `runtime_unavailable`，不由 Connector 隐式启动 Owner runtime。
9. **命令执行与崩溃恢复**：推荐 Connector 对所有远程控制命令单队列串行化；先持久记录 commandId，再执行 Owner 内部能力并记录结果，重复命令返回原状态。命令超时不自动重放有副作用操作，客户端查询状态或由用户确认重试。
10. **Relay 地址与前端入口**：推荐官方部署由构建配置给出唯一 Relay origin；自托管通过部署配置设置 Relay origin，前端不允许随意切换每台节点的 Relay。Connector 与控制端必须绑定同一 Relay；迁移 Relay 作为显式重新配对/迁移流程。静态前端、HTTP API 和 WS 尽量同源，简化 Cookie、CORS 和 PWA 安装。
11. **离线 PWA 范围**：推荐首版仅离线展示已缓存的机器/Thread 概要、保存草稿和安全的非敏感 UI 偏好；不缓存认证 secret、长效 bearer token 或完整敏感 transcript。离线草稿恢复后必须由用户确认发送；推送通知延后。
12. **Workspace 注册与可见信息**：推荐 workspace 只由本地 Owner UI 注册并命名；Relay/PWA 仅收到稳定 workspace ID、用户定义名称和允许的能力，不收到绝对路径。首版不提供远程任意路径选择或文件浏览。
13. **自托管、官方服务与运维**：推荐先以一个可配置 Relay 部署形态验证；官方托管和自托管共用协议与 schema，认证 issuer/域名按部署配置区分。首版加入结构化脱敏日志、健康/ready 检查、连接数/重连/事件缺口指标和 TTL 清理任务，不先做复杂控制面。
14. **验证与平台范围**：推荐先做 Windows 单机端到端 vertical slice，再验证 Linux；协议和纯业务逻辑测试运行在 Node，Relay adapter 增加 Bun runtime smoke test。重点覆盖重复命令、撤销、Relay 故障、Owner 重启、PWA 中途断线与事件缺口恢复。
推荐实施顺序：建立 workspace/protocol 骨架；接着完成配对与在线状态；再交付一个有幂等保证的远程命令；最后接入加密事件同步、恢复、撤销和跨平台验收。

## 建议的实施切片

1. 创建 `apps/relay` 与 `packages/remote-protocol` workspace 骨架；Relay 仅实现健康检查和版本化协议握手，验证 Hono+Bun HTTP/WebSocket 同进程工作。
2. Owner Fastify 启动内置 Connector module，并能通过内部受控能力创建/列出/停止自己的 Codex Web Thread。
3. Relay 建立账户、机器、控制设备和一次性配对的最小模型。
4. Connector 与 Relay 完成认证、心跳和机器在线状态。
5. Web/PWA 能看到已配对机器并发送一个带 `commandId` 的受控命令。
6. Relay/Connector 实现实时事件转发、序列号、ack 和缺口补发。
7. 将现有安全 Thread/SSE 投影接入远程同步，验证 Relay 存储无法还原正文。
8. 实现 Connector 单队列、本地和远程并发控制、取消和命令状态。
9. 实现 PWA 草稿、重连确认、设备撤销和后续请求拒绝。
10. 在 Windows 和 Linux 各完成一次完整验收，并补齐故障集成测试。

## 必测故障场景

- Owner Fastify 重启（内置 Connector 随进程重连）；
- relay 暂时不可用；
- PWA 在流式事件中途断线；
- 事件缺口补发；
- 控制命令重复提交；
- 设备撤销后继续发命令；
- 本地浏览器和 PWA 同时操作同一会话；
- connector 与控制端同时重连；
- relay 数据库只能看到密文，不能还原会话正文；
- Windows 与 Linux 使用同一协议通过测试，平台差异只在进程和路径适配层。

## 相关代码与文档

- 项目架构基线：`C:/Users/Hello/Desktop/codex-web/PROJECT.md`
- 项目说明：`C:/Users/Hello/Desktop/codex-web/README.md`
- API 契约：`C:/Users/Hello/Desktop/codex-web/docs/api/README.zh-CN.md`
- 前端架构：`C:/Users/Hello/Desktop/codex-web/docs/frontend/README.zh-CN.md`
- 当前 bridge/runtime：`server/owner/`、`server/codex/`、`server/http/`、`src/lib/bridge/`
- 当前事件与历史：`server/http/event-routes.ts`、`src/lib/bridge/events/`、`src/app/chat/`
- 当前本地数据模型：`src/lib/db/schema.ts`

## Suggested skills

下一 session 进行技术选型和实施决策时，建议调用：

- `spec-driven-workflow`：把本 handoff 固化为冲突可控的实施规格；
- `codebase-design`：确定 connector、relay、bridge 和协议的模块边界；
- `better-auth-best-practices`：设计账户、设备配对和会话身份；
- `better-auth-security-best-practices`：处理设备撤销、token、CSRF、来源和审计边界；
- `app-ui-system`：重构 Web/PWA 的远程控制界面和状态模型；
- `tdd`：为协议、幂等、事件恢复和跨进程链路建立测试优先的验证方式；
- `resolving-merge-conflicts`：仅在并行实施产生真实冲突时使用。

## 下一 session 的起点

不要重新讨论是否继续 Codex Web、是否做多租户、是否读取 `User/.codex`、是否保留 Guest，这些已经确定。先按“本 session 暂停点”核对代码和验证，再按“决策优先级”逐项讨论；不要直接开始 Relay/Connector 实现，直到身份配对、命令白名单和最小协议合同冻结。首个实现纵切建议限定为：Windows Owner Fastify 内 Connector 出站连 Relay，配对一台控制设备，展示在线状态，并成功执行一个可去重的无歧义 Thread 命令。
