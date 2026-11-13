# ASR runtime preflight 验证 — 2026-11-13

仓库新增 `tools/asr_runtime_preflight.py` 和 `npm run asr:preflight`。它只接受本地模型目录，使用 `faster-whisper` 的 `local_files_only=True` 加载模型；缺少依赖、模型目录或模型加载失败时输出固定 `NOT VERIFIED` 并返回退出码 2。退出码 2 表示环境未验证，不能用于发布通过或完成声明。

本地单元测试覆盖三种情况：缺少依赖、缺少模型目录、成功加载本地模型参数。命令如下：

```text
npm run test:asr-runtime
3 tests, OK

python3 tools/asr_runtime_preflight.py
NOT VERIFIED: model path is required
exit 2
```

当前机器仍没有 `faster_whisper` 包和模型权重，所以真实模型识别、语言准确率、延迟和长时间运行继续保留在路线图第 4 项。准备模型后运行：

```bash
WHISPER_MODEL=/path/to/model npm run asr:preflight
```
