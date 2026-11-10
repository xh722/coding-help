# faster-whisper loopback 服务验证 — 2026-11-10

## 已实现

- `services/local-asr/faster_whisper_server.py` 只监听 `127.0.0.1`、`localhost` 或 `::1`，提供 `/healthz` 和 `/transcribe`。
- 请求体上限 32 MiB，严格解析 PCM WAV，拒绝压缩格式、错误采样率、位深、块对齐和截断数据。
- 服务使用用户显式提供的模型路径或显式 `--allow-model-download` 的命名模型；默认 CPU `int8`，可配置 device/compute type。
- 模型未安装、路径缺失或加载失败时服务保留诊断接口但返回 503；错误正文不暴露异常、文件路径或模型信息。
- 识别结果限制长度，临时 WAV 用完立即删除；只返回文本、provider、语言和音频格式元数据。

## 本机验证

```text
npm run test:asr-server
2 tests, OK

python3 services/local-asr/faster_whisper_server.py --help
help output verified
```

本机没有 `faster_whisper` Python 包或模型权重，因此没有声称真实语音识别、语言准确率或延迟通过。安装依赖和模型后，用 `npm run asr:faster-whisper` 启动，再配置 `CODING_HELP_TRANSCRIPTION_URL` 连接桌面端。

Node 全量测试仍为 125/125，Linux bundle manifest 为 104 个文件，bundle Electron smoke 通过。上述证据验证服务边界和集成协议，不替代模型质量验收。

实现参考 faster-whisper 官方 API：`WhisperModel(model, device="cpu", compute_type="int8")` 和 `model.transcribe(...)`。见 [官方 README](https://github.com/SYSTRAN/faster-whisper)。
