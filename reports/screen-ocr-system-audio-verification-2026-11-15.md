# 屏幕 OCR 与系统音频验证报告 — 2026-11-15

## 结论

屏幕 OCR 和系统音频采集已完成本地代码接入、IPC 契约、权限边界和资源生命周期验证。屏幕 OCR 使用主显示器全屏 PNG，快捷键为 `CommandOrControl+Shift+O`；PNG 只在内存中传给本地 Tesseract，不进入截图预览或会话历史。系统音频使用 `getDisplayMedia({ video: true, audio: ... })`，拿到流后立即停止视频轨道，只把单声道 PCM 送入已有转写管线。

本报告不把平台硬件能力标为已验收：当前 Linux 环境没有 `tesseract` 可执行文件、没有 `/dev/snd`，也没有 `DISPLAY`，因此没有真实 OCR 进程运行、物理回放采样或 Xvfb Electron smoke 证据。

## 实现范围

- `packages/providers/screen-ocr.cjs`：固定 `tesseract stdin stdout --psm 6 -l chi_sim+eng` argv，禁用 shell，限制 PNG 输入 8 MiB、输出字符数和 3 秒超时，统一静态错误码。
- `apps/desktop/main/index.cjs`：选择主显示器和其 bounds 作为全屏截图尺寸，增加 `capture.ocr-screen`，注册/注销 `CommandOrControl+Shift+O`，只 broadcast OCR 状态和文字。
- `apps/desktop/renderer/system-audio.js`：调用 `getDisplayMedia`，停止所有视频轨道，复用 AudioWorklet PCM 分块，并在 ended、权限异常、过载和卸载时清理资源。
- `packages/providers/system-audio.cjs`：系统音频能力探测和主进程采集标识/sequence/超时生命周期。
- `apps/desktop/main/media-permissions.cjs`：仅允许受信任 Dashboard 主 frame 在 pending system-audio acquisition 期间获得 `display-capture`。
- Dashboard：`Recognize screen`、屏幕 OCR 状态/文字、`Use system audio` 和音频状态展示；OCR 不写入截图 `<img>` 或 session history。

## 自动化验证

以下命令在当前 checkout 通过：

```bash
npm run test:screen-ocr
node --test tests/system-audio.test.cjs tests/system-audio-renderer.test.cjs
node --test tests/desktop-microphone.test.cjs tests/media-permissions.test.cjs
npm test
npm run check
node --check tools/electron-smoke.cjs
```

结果：OCR provider 5 项通过；系统音频 renderer/provider 6 项通过；桌面音频与权限集成 8 项通过；全量 Node 测试 170 项通过；Python ASR/硬件预检合计 39 项通过；JavaScript 语法检查 65 个文件和 Electron smoke 脚本语法检查通过。`tools/electron-smoke.cjs` 已加入 OCR 可用/不可用两条路径，以及 OCR 不更新截图预览的断言。

覆盖的关键断言：

- 主屏选择、全屏 bounds、PNG 内存传递、OCR 结果 broadcast 和快捷键注销。
- `tesseract` argv 固定、无 shell、输入/输出/超时上限、缺少可执行文件和非零退出静态错误。
- `getDisplayMedia` 约束包含 audio，video track 立即停止，audio track ended 会释放所有资源。
- PCM sequence、大小、采集标识和主进程 `audio.system-*` IPC 校验。
- display-capture 权限只在受信任 Dashboard 的 pending provider acquisition 期间允许；Overlay、子 frame、外部 URL 和非采集状态拒绝。
- OCR PNG、系统 PCM、设备 ID、采集标识和路径不写入会话历史或错误消息。

## 本机限制和验收入口

检查结果：

```text
tesseract: not installed
/dev/snd: absent
DISPLAY: unset
ffmpeg: /usr/bin/ffmpeg
```

本轮执行 `npm run smoke` 返回退出码 2（`NOT VERIFIED`），因为该容器没有 `DISPLAY`，且没有安装 `xvfb-run`；这不是 smoke 通过，也不是应用失败。具备桌面或 Xvfb 后，smoke 会实际点击 OCR 按钮，并验证成功结果或不可用状态以及截图预览保持不变。

安装 OCR 依赖后可运行：

```bash
sudo apt-get install -y tesseract-ocr tesseract-ocr-chi-sim tesseract-ocr-eng
npm start
```

进入 Dashboard 后登录，选择 **Recognize screen** 或按快捷键；若 Tesseract 可用，结果会出现在屏幕 OCR 文字区。系统音频需要 Linux PipeWire/桌面选择器或 Windows/macOS 对应权限，选择 **Use system audio** 后点击 **Start**，观察系统权限提示和 `System audio active` 状态。真实平台验收应另外记录平台、权限结果、音频轨道是否有样本和停止后的资源释放，不应把 `potential` 能力探测当作通过。
