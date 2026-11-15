# ASR runtime smoke 验证 — 2026-11-15

## 已实现

- 新增 `tools/asr_runtime_smoke.py` 和 `npm run asr:smoke`。
- 脚本使用无 shell 的 argv 启动仓库内 `faster_whisper_server.py`，只允许 loopback host。
- 启动后轮询 `/healthz`，再发送指定 WAV 或生成的 1 秒静音 WAV 到 `/transcribe`。
- 退出前发送终止信号并等待清理；启动、端口、健康检查和响应过大等错误统一为固定消息。
- 结果只保留 HTTP 状态、provider、语言、WAV 格式和文本字符数，不输出原始转写、模型路径或服务异常文本。

## 自动化验证

- Python smoke 契约测试：`4/4` 通过，覆盖敏感文本脱敏、完整启动/请求/清理流程、外部绑定拒绝和端口分配失败。
- Python ASR 全量测试：`35/35` 通过。
- CI 已加入 `npm run test:asr-smoke`。

## 实际运行时验证

使用此前隔离的 `/tmp/coding-help-asr-venv`、缓存的 `faster-whisper tiny` 和本地生成的 1 秒静音 WAV：

```bash
HF_ENDPOINT=https://hf-mirror.com HF_HUB_DISABLE_XET=1 \
HF_HOME=/tmp/coding-help-hf-cache XDG_CACHE_HOME=/tmp/coding-help-cache \
/tmp/coding-help-asr-venv/bin/python tools/asr_runtime_smoke.py \
  --model tiny --allow-model-download --json
```

返回 `ok: true`；`/healthz` 返回 HTTP `200`，`/transcribe` 返回 HTTP `200`，格式为 16 kHz、单声道、16-bit、16000 帧，语言字段为 `en`，文本字符数为 `0`。服务进程在请求结束后自动清理。

静音样本只证明服务生命周期、WAV 协议和模型调用链，不证明中文/英文真实语音识别准确率，也不代表物理麦克风、系统音频或 Windows 动态行为已经验收。项目默认不设置镜像，也不会自动联网。
