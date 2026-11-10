# faster-whisper loopback 服务验证 — 2026-11-10

## 已实现

- `services/local-asr/faster_whisper_server.py` 只监听 `127.0.0.1`、`localhost` 或 `::1`，提供 `/healthz` 和 `/transcribe`。
- 请求体上限 32 MiB PCM，严格解析 RIFF/WAVE 块、偶数填充、PCM 格式、byteRate、blockAlign、帧边界和截断数据；只接受单一 `Content-Length` 的 `audio/wav` 请求。
- 服务使用用户显式提供的模型路径或显式 `--allow-model-download` 的命名模型；默认 CPU `int8`、4 个 CPU 线程，可配置 device/compute type。
- 模型未安装、路径缺失或加载失败时服务保留诊断接口但返回 503；错误正文不暴露异常、文件路径或模型信息。
- 识别结果限制长度并逐段消费；模型输入使用内存 WAV，不创建临时文件，只返回文本、provider、语言和音频格式元数据。
- 只允许 loopback 绑定；并发 handler 和模型推理均有上限，忙时返回固定 503；SIGINT/SIGTERM 会退出服务。

## 本机验证

```text
npm run test:asr-server
16 tests, OK

python3 services/local-asr/faster_whisper_server.py --help
help output verified
```

本机没有 `faster_whisper` Python 包或模型权重，因此没有声称真实语音识别、语言准确率或延迟通过。本轮在仓库外的 Python 3.10 虚拟环境中尝试安装 `faster-whisper==1.2.1`；下载其 `av` 二进制依赖时网络传输未完成，已停止临时安装进程，仓库没有新增依赖或模型文件。安装依赖和模型后，用 `npm run asr:faster-whisper` 启动，再配置 `CODING_HELP_TRANSCRIPTION_URL` 连接桌面端。

Node 全量测试为 132/132，Linux bundle manifest 为 104 个文件，bundle source revision 校验通过。此前同一 bundle 流程的 Electron smoke 已通过；本轮运行环境没有 Xvfb，未重复启动桌面 smoke。上述证据验证服务边界和集成协议，不替代模型质量验收。

实现参考 faster-whisper 官方 API：`WhisperModel(model, device="cpu", compute_type="int8")` 和 `model.transcribe(...)`。见 [官方 README](https://github.com/SYSTRAN/faster-whisper)。
