# 本地 ASR 协议 fixture 验证 — 2026-11-10

仓库新增 `npm run asr:fixture`。它监听 loopback `/transcribe`，限制 32 MiB，校验 RIFF PCM WAV 的格式、块对齐和长度后返回固定 JSON 文本。它不加载模型、不分析语音、不代表 ASR 准确率。

真实 loopback 测试使用 Node HTTP server、`fetch`、WAV 封装和 `createLocalHttpTranscriptionProvider`，覆盖成功响应和畸形输入 400 错误。全量仓库测试现为 131 项；实际模型服务仍需用户自行部署，路线图第 4 项保持未完成。新增测试不会把 fixture 固定文本当成识别结果。
