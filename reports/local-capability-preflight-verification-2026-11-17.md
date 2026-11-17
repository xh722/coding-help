# 本地能力诊断验证 — 2026-11-17

## 命令

```bash
npm run local:preflight -- --json
```

该入口只组合已有只读预检和工具版本检查：OCR 调用 Tesseract 版本/语言包探测，音频调用 ALSA/PulseAudio/显示环境探测，ASR 调用本地模型预检，更新检查 `gpg`/`tar` 是否可执行。它不联网、不打开录音流、不读取屏幕，也不运行更新安装。

## 当前结果

```json
{
  "ok": false,
  "code": "CAPABILITIES_PARTIAL",
  "summary": {
    "checked": 4,
    "ready": 2,
    "unavailable": 1,
    "needs_configuration": 1
  },
  "checks": {
    "ocr": {"status": "ready", "code": "OCR_READY"},
    "audio": {"status": "unavailable", "code": "AUDIO_UNAVAILABLE"},
    "asr": {"status": "needs_configuration", "code": "ASR_MODEL_MISSING"},
    "update": {"status": "ready", "code": "UPDATE_TOOLS_READY"}
  }
}
```

本机已具备 OCR 语言包和 GPG/TAR；没有物理音频输入设备，也没有通过 `WHISPER_MODEL` 配置本地 ASR 模型。默认命令仍返回诊断报告；加 `--strict` 才把部分状态转换为退出码 2，避免把“报告生成成功”误当成所有硬件和模型都已验证。

## 脱敏边界

聚合器只保留固定错误码、允许的语言名、设备计数和布尔能力，不输出 tessdata 路径、模型目录、设备名、stderr 或异常正文。
