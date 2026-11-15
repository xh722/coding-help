# 音频硬件只读预检 — 2026-11-15

## 工具

新增 `tools/audio_hardware_preflight.py` 和 `npm run audio:preflight`。命令只读取 `/dev/snd`、`arecord -l`、PulseAudio source 列表和 `DISPLAY`/`WAYLAND_DISPLAY`，不打开录音流、不读取设备名称、不保存音频。

```bash
npm run audio:preflight -- --json
```

## 当前授权环境结果

```json
{"alsa":{"available":false,"cards":0},"device_node":{"available":false},"display":{"available":false},"ok":false,"pulse":{"available":false,"sources":0},"reason":"no audio input device detected"}
```

命令返回退出码 `2`，表示未验证。当前环境没有 `/dev/snd`、ALSA 声卡或可用 PulseAudio source，因此无法继续真实麦克风权限、热插拔、暂停/恢复和长期采集验收。授权本身不会改变容器的设备映射；需要把真实 Linux/Windows/macOS 设备或对应虚拟硬件暴露给运行环境后重新执行。

## 自动化验证

- Python preflight 契约测试：`4/4` 通过，覆盖 ALSA/Pulse 成功、命令失败、异常脱敏和机器可读结果。
- Python ASR 全量测试：`39/39` 通过。
