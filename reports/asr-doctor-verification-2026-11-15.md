# ASR doctor 诊断与基准验证 — 2026-11-15

## 已实现

- 新增 `tools/asr_runtime_doctor.py` 和 `npm run asr:doctor`。
- 默认只允许已存在的本地模型目录；命名模型只有显式传 `--allow-model-download` 才会下载。
- 可选 `--audio` 对整数 PCM WAV 做真实 `faster-whisper` 推理，输出加载耗时、推理耗时、格式、语言和转写字符数。
- 报告增加进程 CPU 用户/系统耗时和峰值 RSS 内存；平台不提供进程资源接口时会标记 `available: false`。
- 默认输出不包含模型绝对路径、原始转写文本或音频内容；`--json` 可供脚本保存结构化结果。

## 自动化验证

- Python doctor 测试：4/4 通过，覆盖缺少依赖、本地模型参数、WAV 格式/语言/文本长度、敏感文本不输出和资源指标计算。
- Python ASR 全量测试：25/25 通过。
- Node 全量测试：157/157 通过。
- JavaScript 语法检查：61 个文件通过。

## 实际运行时验证

使用此前隔离的 `/tmp/coding-help-asr-venv` 和缓存的 `faster-whisper tiny`：

```bash
HF_ENDPOINT=https://hf-mirror.com HF_HUB_DISABLE_XET=1 \
HF_HOME=/tmp/coding-help-hf-cache XDG_CACHE_HOME=/tmp/coding-help-cache \
/tmp/coding-help-asr-venv/bin/python tools/asr_runtime_doctor.py \
  --model tiny --allow-model-download --json
```

预检返回 `ok: true`，本次缓存命中时模型加载约 `290.33 ms`，1 秒静音 WAV 推理约 `206.47 ms`，进程 CPU 用户/系统耗时约 `3598.94/255.43 ms`，峰值 RSS 约 `278.97 MB`，语言字段为 `en`，转写字符数为 `0`。本轮只用静音 WAV 做推理 smoke，因此仍未验证真实中文/英文语音准确率、长时间资源占用和物理麦克风链路。项目默认不设置镜像，也不会自动联网。
