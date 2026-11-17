# 本地 ASR 稳定性与生命周期验证 — 2026-11-17

## 工具

新增 `asr:stability`，在 loopback 服务上执行有界重复探测：

- 首次 `/healthz` 检查确认服务已就绪；
- 使用合成的 1 秒静音 PCM WAV，重复调用 `/transcribe`；
- 记录成功/失败计数、HTTP 状态计数、语言、音频格式和平均/最小/P95 延迟；
- 再次检查 `/healthz`，最后发送 `SIGTERM` 并确认子进程退出；
- 输出只包含固定状态和资源指标，不包含转写文本、路径、模型名或异常正文。

工具上限为每次 1–100 次探测，默认 5 次；只允许 loopback 地址，沿用现有 beam/VAD 和 WAV 边界。

## 自动化证据

`tests/asr_runtime_stability_test.py` 覆盖：

1. 重复探测、首尾健康检查、延迟统计和退出清理；
2. 单次 HTTP 失败后的固定错误、失败计数和敏感错误脱敏；
3. 迭代次数和外部绑定地址拒绝。

本轮 Python 测试为 `51/51`，Node 测试为 `175/175`。

## 当前本机运行边界

本轮尝试使用本地 tiny 模型运行：

```bash
npm run asr:stability -- --model /path/to/local/model --iterations 5 --json
```

当前运行环境没有此前临时的 `faster-whisper` 虚拟环境和模型缓存，服务因此返回静态 `503 local ASR model is unavailable`；稳定性命令仍确认服务子进程退出，且没有泄漏模型路径或异常正文。

这证明了工具的错误边界、脱敏和清理链路，不证明真实模型重复推理、语音质量、物理麦克风或系统音频平台已通过。重新准备本地依赖和模型后，可用同一条命令完成真实循环验收。
