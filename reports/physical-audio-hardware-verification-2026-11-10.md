# 物理音频硬件验收 — 2026-11-10

## 当前环境结果

本次只做了只读设备检查，没有伪造硬件通过：

```text
/dev/snd unavailable
arecord -l: no soundcards found
PulseAudio connection refused
```

因此当前环境没有可用的 ALSA/PulseAudio 物理输入设备，无法验证真实麦克风权限、热插拔、设备切换、暂停恢复或长期运行。Chromium 合成设备的 Electron smoke 只证明浏览器链路和资源清理，不代表物理硬件兼容。

## 已有替代证据

- 标准麦克风 provider、AudioWorklet、权限、队列和异步清理由 Node 测试覆盖。
- Chromium `--use-fake-device-for-media-stream` 的真实 Electron smoke 覆盖 PCM、暂停释放、恢复重连、停止、刷新、退出登录和权限拒绝。
- `devicechange` 使用标准媒体设备 API 的合成事件验证；没有宣称 USB/蓝牙/内置麦克风拔插已通过。

物理设备验收继续保留在路线图第 5 项，需在授权 Linux/Windows/macOS 机器上重新运行，不应把本报告当成硬件通过证据。
