# 01 状态与展示

状态：Ready for implementation。
共享决策唯一来源：[主规格](development-spec.md)。

实现唯一 Conversation 事实、不可变 session 外部订阅和按 Turn 派生缓存，保留来源与多次交互。入口 chat/session/state、chat/projection、chat/model。只改 App，不改 wire。校验重复 change、替换快照、dispose、终态与最终答复回退。运行相关 session/projection tests、typecheck、oxfmt。

交付时在本文记录验证与偏差；复杂用户验收为实施后交接。无额外材料决策授权，不创建提交。
