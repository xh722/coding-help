# 系统音频能力探测验证 — 2026-11-10

## 结果

- 新增 `audio.get-system-capabilities`，只允许 Dashboard 主 frame 调用。
- 探测会读取桌面源列表，返回 `potential`、`unavailable` 或 `unknown`，始终包含 `captureStarted: false`；不会调用 `getDisplayMedia`、`getUserMedia`、摄像头或屏幕权限。
- Dashboard 的 **Check system audio** 显示平台路径和原因。`potential` 只表示 Electron/平台存在可能的 display-media 路径，不代表已获得系统权限或已收到音频样本。
- Linux 使用 PipeWire，Windows 使用 loopback 路径，macOS 需要系统音频权限；实际跨平台采集和热插拔仍列入硬件验收。

## 验证

Node 测试覆盖无 API、无桌面源、探测异常、未知平台、Dashboard-only IPC 和 captureStarted 永远为 false。Electron smoke 登录后调用能力探测并点击 UI 按钮，验证不会开始采集；原有麦克风/WAV 流程继续通过。

依据：[Electron desktopCapturer 官方文档](https://www.electronjs.org/docs/latest/api/desktop-capturer)。
