# 任务 03：Owner WS 与 App

状态：已接入，采用 [主规格](readme.md) 的无版本应用契约。

保留 events.subscribe/resume 和 epoch + sequence cursor。共享 Owner envelope parser 校验结构、字段、eventId/cursor；非法消息与同 cursor 内容冲突停止订阅、不推进 cursor。events.reset 是独立控制消息，进程 epoch 改变时重新读取快照。

live/history 使用同一个 envelope-to-Codex adapter，保留 native reducer 和快照优先的补全规则。未知合法事件只显示受限方法名摘要。契约失败保留 transcript，停止自动恢复并提供重试；用户手工浏览器验收见任务 04、07。
