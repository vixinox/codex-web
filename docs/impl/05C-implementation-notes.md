已实现行为：
- 浏览器设备密钥使用 Web Crypto ECDH P-256 生成，并优先保存不可导出的 CryptoKey 到 IndexedDB。
- IndexedDB 不可用、记录缺失或损坏时返回失败，调用方必须要求重新配对。

新增/修改接口：
- `DeviceKeyRecord`
- `createDeviceKey`、`loadDeviceKey`、`setDeviceId`、`clearDeviceKey`

修改文件：
- `packages/app/src/lib/remote/device-key-store.ts`

验证命令与结果：
- 与 05B focused tests、oxfmt 和 lint:staged 一并通过。

未解决问题：
- Relay WebSocket adapter 与真实浏览器 IndexedDB 手工回归留待用户启动服务后验收。

下游必须遵守的约束：
- 不得将私钥导出到 JSON、React state、localStorage、URL 或日志。
