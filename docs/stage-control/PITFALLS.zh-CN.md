# Stage Control 踩坑记录

1. **Electron 加载不了插件 TS 源码**：插件入口改为编译产物 `dist/index.mjs`（提交 3a6efcc）。改插件代码后需要重新 build。
2. **渲染进程读不了 `file://`**：插件在 Node 侧读取 `.vrma`，再以 data URL 发给渲染进程，单文件上限 32MB。动作库的 `motion.play` 也走这条路径。
3. **原版 AIRI 共用 appId、设置和 6121 端口**：表现为认证成功但收不到回复。完全退出原版（包括托盘图标）。不要改端口——端口设置是共用的，改了会影响原版。
4. **插件到渲染进程的 invoke 没有超时**：请求可能永远挂起。64cb23c 加了 10 秒超时，错误回复也保留 `requestId`。
5. **token 只读一次**：改 token 后再也连不上。现在每次重连都重新读取。
6. **打包版没有日志文件**：在 PowerShell 中运行 `.\airi.exe` 查看 stderr（`[stage-control] ...`）。
7. **WSL 构建**：
   - corepack 需要先 `mkdir -p ~/.local/bin` 再 `corepack enable --install-directory ~/.local/bin`；
   - pre-commit 钩子需要设置 `COREPACK_HOME`（例如 `export COREPACK_HOME=$HOME/.cache/corepack`）；
   - 从 PowerShell 调用 WSL 时，`bash -lc` 的参数用单引号，避免 `$` 被 PowerShell 展开，例如 `wsl bash -lc 'cd ~/airi && echo $HOME'`。
8. **包体积**：解压约 2.2GB / zip 约 1GB。主要是本地推理（onnxruntime-node 537MB、onnxruntime-web 131MB、transformers、kokoro、sherpa）、DuckDB 137MB，以及约 190MB 字体。精简是后续可做的事。
9. **JSON 中的 Windows 路径**要写成 `\\`，如 `"D:\\airi\\vrma"`。
10. **动作库的 `fs.watch`**：Windows 上一次复制会触发多次事件，所以加了 300ms 防抖；网络盘/部分虚拟盘可能完全不触发事件，此时用 `motion.setDirectory` 指向同一目录可强制重扫。
11. **base64 上传走 WebSocket**：32MB 文件 base64 后约 43MB，单帧较大；大文件优先用 `motion.upload` 的 `path` 方式或直接把文件拖进动作目录。
12. **动作库变更事件只含 .vrma 条目**：Live2D 动作取决于当前模型，需要 `motion.list` 实时读取（通过通用的 `state` 舞台命令）。
13. **MCP 端口 6122 被占用**：原版 AIRI（同一插件）或其他程序占了 6122 时，日志显示 `MCP server did not start`，WebSocket 控制不受影响。退出原版，或用 `AIRI_STAGE_MCP_PORT` 换端口。MCP 认证通过但调用 12 秒超时，通常是主窗口未就绪，或连到了原版 AIRI 的 MCP。
14. **桥接脚本在 asar 里无法用 node 运行**：已加入 `asarUnpack`，实际路径是 `resources\app.asar.unpacked\resources\stage-control-mcp-bridge.mjs`。
15. **灯光颜色读回是 `#RRGGBBAA`**：旧版本读回 8 位颜色、写入只接受 6 位，AI 原样写回会报错。现在读回统一为 `#RRGGBB`，写入接受 6 位或 8 位（忽略 alpha）。
16. **全局快捷键注册失败通知显示原始 i18n key**：主进程缺少翻译。已补齐，并在消息里写出失败的快捷键。注册失败通常是原版 AIRI 或其他程序占用了同一个全局快捷键，退出它或在设置里换一个。
