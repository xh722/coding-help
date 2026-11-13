# 本地 ASR 生命周期验证 — 2026-11-13

本阶段新增 `packages/providers/asr-supervisor.cjs`。它只接受 loopback transcription endpoint 和 JSON argv 命令数组，使用 `child_process.spawn(file, args, { shell: false })` 启动用户提供的本地服务。

## 已验证

- 启动后轮询 `/healthz`，健康检查通过才报告 `ready`。
- 已运行服务可以直接复用，不需要配置或启动子进程。
- 服务进程退出或健康检查超时后按上限重试。
- 重试耗尽返回固定 `ASR_START_FAILED` 和 `Local ASR service could not become ready.`。
- 不把命令参数、模型路径、异常文本或服务响应写入公开状态和错误消息。
- 退出时发送 `SIGTERM`，超时后发送 `SIGKILL`，清理轮询和进程引用。
- 桌面 session 在 supervisor ready 前保持 `idle`；服务不可用时返回固定 `ASR_UNAVAILABLE`，不会伪造转写。
- `audio.get-status` 只暴露 `state`、`pid` 和尝试次数。

## 配置

```bash
CODING_HELP_TRANSCRIPTION_URL=http://127.0.0.1:43123/transcribe
CODING_HELP_ASR_COMMAND='["python3","services/local-asr/faster_whisper_server.py"]'
```

没有设置 `CODING_HELP_ASR_COMMAND` 时，应用继续使用已运行的 loopback 服务或演示 provider。该阶段没有捆绑模型，也没有把 supervisor 的协议测试当作真实语音识别质量验收。

## 自动化结果

- Node 测试：142/142 通过。
- Python ASR 测试：19/19 通过。
- JavaScript 语法检查：52 个文件通过。
- 当前环境没有 `faster-whisper` 模型，因此真实语言识别、延迟和准确率仍未验证。
