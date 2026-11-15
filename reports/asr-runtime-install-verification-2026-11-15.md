# ASR 运行时安装与模型预检 — 2026-11-15

## 本轮完成

- 在仓库外的 `/tmp/coding-help-asr-venv` 创建 Python 3.10 隔离环境。
- 按 `services/local-asr/requirements.txt` 安装 `faster-whisper==1.2.1` 及其依赖；导入验证通过：`faster-whisper 1.2.1`、`ctranslate2 4.9.0`、`av 17.1.0`。
- `tools/asr_runtime_preflight.py` 新增 `--allow-model-download`。默认仍要求本地模型目录并使用离线加载；只有命名模型和显式开关同时存在时才允许下载。
- 本地缺失模型预检返回固定 `NOT VERIFIED` 和退出码 2；命名模型的真实预检也返回退出码 2，符合失败关闭约定。

## 当前阻塞

使用临时缓存运行：

```bash
HF_HOME=/tmp/coding-help-hf-cache \
XDG_CACHE_HOME=/tmp/coding-help-cache \
/tmp/coding-help-asr-venv/bin/python tools/asr_runtime_preflight.py \
  --model tiny --allow-model-download
```

`faster-whisper` 尝试访问 Hugging Face 时收到 `Connection reset by peer`，没有产生模型缓存。直接访问 `https://huggingface.co/.../config.json` 也得到相同的 TLS 连接重置。服务因此保持 `/healthz` 503，不能宣称真实模型加载或语音识别准确率通过。

## 结论

Python 运行时依赖已经在隔离环境中可用，预检工具具备本地离线和显式下载两种清晰模式；真实模型权重仍需在网络可达或用户提供本地模型目录的环境中验证。当前失败不会污染仓库，也不会自动联网或写入项目目录。
