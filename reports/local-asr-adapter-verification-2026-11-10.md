# 可选本地 ASR 适配器验证 — 2026-11-10

## 已实现

- `createLocalHttpTranscriptionProvider()` 只接受无凭据的 `http`/`https` loopback endpoint：`localhost`、`127.0.0.1`、`::1`。
- 会话音频在本机内存中封装为 RIFF PCM WAV，通过一次 POST 发送到用户自建服务；服务返回 JSON `{ "text": "..." }`。
- 响应文本会裁剪空白并限制长度；HTTP 错误、空响应、非 JSON、网络错误和超时使用固定错误码。
- 响应体在 JSON 解析前限制为 256 KiB；畸形 JSON、空文本、超长文本和超限响应统一使用独立的 `TRANSCRIPTION_BAD_RESPONSE` 错误码，网络/HTTP 错误仍使用不可用错误码。
- PCM 上限 32 MiB；停止会取消请求，暂停期间不接收新的音频；错误消息不包含响应正文、私有 URL 或音频数据。
- 桌面端通过 `CODING_HELP_TRANSCRIPTION_URL` 显式启用；没有配置或配置无效时回退到演示 provider，并显示 DEMO 状态。仓库不下载或捆绑识别模型。

## 验证

```text
node --test --test-isolation=none tests/transcription-http.test.cjs tests/desktop-transcription-http.test.cjs
10 tests, 10 pass, 0 fail
```

覆盖 loopback 地址拒绝、WAV 头和格式、文本校验、响应体上限和坏响应分类、网络/HTTP/超时脱敏、暂停恢复、上限、幂等 finish、停止取消、桌面端等待最终识别和无效配置回退。

完整仓库测试（119 tests）和真实 Electron smoke 已重新运行；原有合成麦克风/WAV 流程不依赖该适配器。

## 未完成

适配器不是识别模型。需要用户在本机自行部署 Whisper、Vosk 或其他兼容 HTTP 服务，并自行确认模型文件、语言、性能和准确率。没有模型服务时，项目继续提供本地音频采集和明确标注的演示转写。
