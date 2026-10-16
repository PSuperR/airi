# Stage Control 分支使用说明（简体中文）

本文说明 `cursor/stage-control-plugin-1483` 分支（PR #2）新增的内容、构建方法、运行方法和完整协议。踩坑记录见 [PITFALLS.zh-CN.md](./PITFALLS.zh-CN.md)。英文参考文档见 [plugins/airi-plugin-stage-control/README.md](../../plugins/airi-plugin-stage-control/README.md)。

## 这个分支新增了什么

- 内置插件 `plugins/airi-plugin-stage-control`：连接本地服务器通道（默认 `ws://127.0.0.1:6121/ws`），接收 `stage:control` 消息，控制桌面版 AIRI 的舞台。
- 动作：`expression`（表情）、`motion`（Live2D 动作）、`speech`（字幕/朗读）、`view`（视角）、`model`（切换模型）、`window`（显示/隐藏窗口）、`vrma`（播放 VRM 动画）、`state`（读取舞台状态）。
- 动作库：`motion.list` / `motion.play` / `motion.rename` / `motion.upload` / `motion.delete` / `motion.setDirectory`，同时支持 `.vrma` 文件和 Live2D 模型自带的动作组。动作库变化时会广播 `stage:control:event`。
- 每条请求都有回复 `stage:control:result`，带回 `requestId`；插件到渲染进程的调用有 10 秒超时。

## 在 WSL 中构建

```bash
cd /path/to/airi
pnpm install
cd apps/stage-tamagotchi
pnpm run build && npx electron-builder --win zip --x64
```

产物在 `apps/stage-tamagotchi/dist/` 下（zip）。解压到 Windows 任意目录即可。

## 在 Windows 上运行

1. **先完全退出已安装的原版 AIRI**（包括托盘图标）。两者共用同一个 appId、同一份设置和 6121 端口。无需卸载原版。
2. 运行解压目录里的 `airi.exe`。想看日志时，在 PowerShell 中进入该目录运行 `.\airi.exe`，stderr 会直接输出（打包版没有日志文件）。插件启动时会打印 `[stage-control] Started. Channel ... Motion folder ...`。

## 获取 token

打开 设置 → 连接（Settings → Connection），复制 auth token。token 也保存在用户数据目录下的 `server-channel/config.json`。修改 token 后插件会在下次重连时自动读取新值。

## 连接流程

```json
{ "type": "module:authenticate", "data": { "token": "<token>" } }
```

等待：

```json
{ "type": "module:authenticated", "data": { "authenticated": true } }
```

每 20 秒发一次心跳，60 秒无消息服务器会断开：

```json
{ "type": "transport:connection:heartbeat", "data": { "kind": "ping", "message": "my-client", "at": 0 } }
```

服务器转发的消息可能包成 `{ "json": { ... } }`，有 `json` 而没有 `type` 时读取 `json`。

## stage:control 协议

请求：

```json
{ "type": "stage:control", "data": { "requestId": "1", "action": "expression", "name": "happy" } }
```

回复（只发给请求者）：

```json
{ "type": "stage:control:result", "data": { "requestId": "1", "ok": true } }
```

```json
{ "type": "stage:control:result", "data": { "requestId": "1", "ok": false, "error": "..." } }
```

读取类动作把结果放在 `data.data` 中。

### 基础动作

```json
{ "action": "expression", "name": "happy", "durationMs": 3000, "intensity": 1 }
```

```json
{ "action": "motion", "name": "Idle", "index": 0 }
```

```json
{ "action": "speech", "text": "你好", "speak": true }
```

```json
{ "action": "view", "x": 0, "y": 0, "z": 0, "scale": 1 }
```

```json
{ "action": "model", "modelId": "preset-live2d-1" }
```

```json
{ "action": "window", "visible": true }
```

```json
{ "action": "vrma", "src": "D:\\airi\\vrma\\VRMA_01.vrma", "loop": false, "fadeInMs": 300, "fadeOutMs": 300 }
```

```json
{ "action": "state" }
```

以上都放在 `"data"` 里发送。说明：

- `expression`：Live2D 用模型表情名；VRM 用 `happy`、`angry`、`sad`、`relaxed`、`surprised` 等。
- `motion`：仅 Live2D，`name` 为动作组或文件名，组内多个动作时需 `index`。
- `vrma`：仅 VRM。`src` 可为 http(s)/data/blob URL、`file://` URL 或绝对路径；本地文件由插件读取后以 data URL 发给渲染进程，上限 32MB。
- `state`：返回 `{ "renderer": "live2d", "live2dMotionGroups": [{ "group": "Tap", "count": 2 }] }`。

### 动作库

**动作目录**：默认是 `<userData>/motions`（Windows 一般为 `%APPDATA%\airi\motions`，以启动日志为准），自动创建。优先级：环境变量 `AIRI_MOTIONS_DIR` > `motion.setDirectory` 保存的目录（存于 `<userData>/stage-control-motions.json`）> 默认目录。

插件会监视该目录（300ms 防抖）：放进去的 `.vrma` 会自动出现在库里，删除的文件会自动消失。

**直接使用 D:\airi\vrma**：

```json
{ "type": "stage:control", "data": { "action": "motion.setDirectory", "directory": "D:\\airi\\vrma" } }
```

恢复默认：`{ "action": "motion.setDirectory", "reset": true }`。也可以用 `motion.upload` 把文件复制到默认目录。

**命名**：目录中的 `motions.json` 记录显示名、标签和描述，没有设置时显示名为去掉扩展名的文件名：

```json
{
  "version": 1,
  "motions": {
    "VRMA_01.vrma": { "name": "挥手打招呼", "tags": ["greet", "happy"], "description": "右手挥动" },
    "live2d:Tap:0": { "name": "点头" }
  }
}
```

**条目格式**：

```json
{
  "id": "vrma:VRMA_01.vrma",
  "name": "挥手打招呼",
  "type": "vrma",
  "compatibleModels": ["vrm"],
  "source": { "kind": "file", "fileName": "VRMA_01.vrma", "path": "...", "sizeBytes": 123456 },
  "tags": ["greet"],
  "description": "右手挥动"
}
```

Live2D 条目：`"id": "live2d:Tap:0"`，`"type": "live2d"`，`"source": { "kind": "live2d", "group": "Tap", "index": 0 }`。

**动作列表**：

```json
{ "action": "motion.list" }
```

```json
{ "action": "motion.list", "all": true }
```

```json
{ "action": "motion.play", "id": "vrma:VRMA_01.vrma", "loop": false }
```

```json
{ "action": "motion.play", "name": "挥手打招呼" }
```

```json
{ "action": "motion.play", "id": "live2d:Tap:0" }
```

```json
{ "action": "motion.rename", "id": "vrma:VRMA_01.vrma", "name": "挥手打招呼", "tags": ["greet"], "description": "右手挥动" }
```

```json
{ "action": "motion.upload", "path": "D:\\airi\\vrma\\VRMA_03.vrma", "name": "转圈" }
```

```json
{ "action": "motion.upload", "fileName": "jump.vrma", "base64": "<base64 或 data: URL>", "overwrite": false }
```

```json
{ "action": "motion.delete", "id": "vrma:jump.vrma" }
```

```json
{ "action": "motion.setDirectory", "directory": "D:\\airi\\vrma" }
```

- `motion.list` 默认只返回当前模型能播放的动作，结果：`{ "modelType": "vrm", "directory": "...", "motions": [...] }`。
- `motion.play` 按 id 或名称（不区分大小写，也可用文件名）播放，自动分发给 `vrma` 或 `motion`。
- `motion.rename` 传空字符串可清除对应字段；Live2D 动作也可以改名。
- `motion.upload`：必须是 `.vrma`，不超过 32MB，同名文件需 `overwrite: true`；`path` 是运行 AIRI 那台机器上的绝对路径。
- `motion.delete` 只能删除 `.vrma` 文件。

**变更事件**（广播给所有连接）：

```json
{ "type": "stage:control:event", "data": { "event": "motion.library.changed", "directory": "...", "motions": [] } }
```

## 给 AI / LLM 的说明

1. 先调用 `motion.list`，只会得到当前模型能用的动作。
2. 根据 `name`、`tags`、`description` 选择合适的动作。
3. 用 `motion.play` + `id` 播放。
4. 切换模型后或收到 `motion.library.changed` 时重新 `motion.list`。
5. `ok: false` 时读 `error`，里面会说明怎么处理（比如需要换成 VRM 模型）。
6. 可以用 `motion.rename` 为动作补充中文名和标签，方便以后选择。

## 测试脚本

在仓库根目录（AIRI 运行中）：

```bash
node scripts/stage-control-example.mjs --token <token>
# 或
STAGE_CONTROL_TOKEN=<token> STAGE_CONTROL_URL=ws://127.0.0.1:6121/ws node scripts/stage-control-example.mjs
```

脚本依次发送 window/expression/motion/speech/view/model/state/motion.list，并打印每个结果。Windows 上用 Node 22+ 直接运行即可（自带 WebSocket）。

## 常见问题

- **认证成功但收不到任何回复**：多半是原版 AIRI 仍在运行（含托盘），请求被它接走了。完全退出原版后重启本版本。不要改端口，端口设置是两者共用的。
- **`invalid token`**：到 设置 → 连接 重新复制 token。
- **`The stage is not ready.`**：主窗口还没加载完，或窗口被关闭。
- **`The VRM model is not ready.` / `cannot play a .vrma animation`**：当前不是 VRM 模型，或模型仍在加载。
- **新放入的 .vrma 没出现**：确认扩展名是 `.vrma`，目录是 `motion.list` 返回的 `directory`；网络盘上 fs watch 可能不触发，可再次调用 `motion.setDirectory` 强制重扫。
- **JSON 里的 Windows 路径**：反斜杠要写成 `\\`。

更多问题见 [踩坑记录](./PITFALLS.zh-CN.md)。
