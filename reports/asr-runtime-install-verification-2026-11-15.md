# ASR 运行时安装与模型预检 — 2026-11-15

## 本轮完成

- 在仓库外的 `/tmp/coding-help-asr-venv` 创建 Python 3.10 隔离环境。
- 按 `services/local-asr/requirements.txt` 安装 `faster-whisper==1.2.1` 及其依赖；导入验证通过：`faster-whisper 1.2.1`、`ctranslate2 4.9.0`、`av 17.1.0`。
- `tools/asr_runtime_preflight.py` 新增 `--allow-model-download`。默认仍要求本地模型目录并使用离线加载；只有命名模型和显式开关同时存在时才允许下载。
- 本地缺失模型预检返回固定 `NOT VERIFIED` 和退出码 2；命名模型在官方 Hugging Face 不可达时也返回退出码 2，符合失败关闭约定。

## 真实模型运行时

在不修改项目默认配置的前提下，使用临时缓存和可达的 Hugging Face 镜像完成了 `tiny` 模型的运行时验证：

```bash
HF_ENDPOINT=https://hf-mirror.com HF_HUB_DISABLE_XET=1 \
HF_HOME=/tmp/coding-help-hf-cache XDG_CACHE_HOME=/tmp/coding-help-cache \
/tmp/coding-help-asr-venv/bin/python tools/asr_runtime_preflight.py \
  --model tiny --allow-model-download
```

- `tiny` 模型加载成功，耗时约 11 秒。
- 使用同一环境启动 loopback 服务后，`GET /healthz` 返回 200；向 `/transcribe` 发送 1 秒、16kHz、单声道、16-bit PCM 静音 WAV，返回 200、空文本、`language: "en"` 和完整格式元数据。
- 服务使用 `SIGINT` 退出，未留下后台进程；模型和缓存都在 `/tmp`，没有写入仓库。

## 当前边界

官方 `https://huggingface.co/...` 在本机收到 `Connection reset by peer`，因此本次证据使用镜像完成。项目默认不设置镜像，也不会自动联网；生产使用应优先提供已下载的本地模型目录。

静音样本只证明模型加载、WAV 解码、推理调用和返回协议，不证明中文/英文真实语音的识别准确率、延迟目标或长时间资源稳定性。路线图中的真实语音样本、物理麦克风和平台权限验收仍保持待办。

## 结论

Python 运行时依赖、真实 `tiny` 模型加载和 loopback 静音推理已经在隔离环境中验证；预检工具具备本地离线和显式下载两种清晰模式。真实语音质量、平台设备和官方模型源可达性仍需后续环境证据，当前验证不会污染仓库，也不会自动联网或写入项目目录。
