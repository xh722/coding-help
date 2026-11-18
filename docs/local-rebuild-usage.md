# 本地重建使用说明

## 安装与验证

在仓库根目录执行：

```bash
npm ci
npm test
npm run check
npm run local:preflight -- --json
```

Linux x64 bundle：

```bash
npm run build:linux
npm run check:linux-bundle
./dist/interviewcoder-local-rebuild-linux-x64/run.sh
```

构建目录只使用当前 checkout 的应用文件和已安装 Electron runtime；清单校验每个文件的 SHA-256。生成的 `dist/` 被 Git 忽略，不会提交二进制产物。签名、自动更新和 Windows/macOS 安装包仍未实现。

`npm test` 使用 Node 内置测试运行器覆盖认证、存储、IPC、会话状态机、provider、local API 和端到端本地流程。`npm run check` 对仓库中的 JavaScript/CommonJS 文件执行语法检查。

`npm run local:preflight -- --json` 汇总 OCR、音频硬件、ASR 模型和 GPG/TAR 工具状态。报告把每项标为 `ready`、`unavailable` 或 `needs_configuration`，默认只生成诊断结果；增加 `--strict` 才会在仍有未验证能力时返回退出码 2。该命令不联网、不打开录音流、不读取屏幕，也不会输出设备名、模型路径或异常正文。

需要同时验证本地 OCR 和离线更新链时，使用：

```bash
npm run local:preflight -- --deep --json
```

`--deep` 会运行固定合成图 OCR 和隔离临时目录中的 GPG/TAR 更新安装与回滚回归。基础硬件、模型和工具状态仍位于 `checks`，深度结果位于 `checks.ocr.deep`、`checks.update.deep` 和 `regressions`；只保留固定状态码、字符数、匹配布尔值和签名/归档/回滚布尔值，不输出识别文本、路径、指纹或 stderr。

## 启动

```bash
npm run start
```

启动 Electron 后使用本地演示账户登录：

```text
邮箱：local-dev@example.com
密码：local-dev-password
```

该账户只由本地 API 提供，token 仅用于当前本地实例。不要将它当作线上账户，也不要填入真实凭据。

## 离线行为

local API 只监听 `127.0.0.1`，默认使用随机端口。转写和建议由确定性本地 provider 生成，因此登录、会话、暂停/恢复、结束和事件记录无需互联网。若 local API 启动失败，应用会进入离线模式，使用本地认证回退和确定性 provider 继续提供会话功能；原始服务端、账户系统、Recall 云上传和 Windows native agent 都不会被调用。

端到端流程见 [`tests/local-flow.test.cjs`](../tests/local-flow.test.cjs)：它启动本地 API，通过公开 auth/session/provider 接口完成一次完整流程，并核对持久化事件顺序与 `stopped` 快照。真实桌面测试必须从仓库根目录使用 `npm run smoke`；如果当前终端在其他目录，使用 `npm --prefix /path/to/coding-help run smoke`。无显示服务时返回“未验证”，不作为通过。

## 安全与范围

本项目不会执行原始安装器，不运行原始 Electron/PE、native DLL 或完整 ASAR，也不提交真实账户 token。原始静态分析材料仅用于界面和接口边界的重建。

## 本地音频

Dashboard 的 `Use microphone` 提供设备选择，在点击 Start 后才申请访问麦克风；Pause 释放设备，Resume 重新采集。`Use system audio` 在点击 Start 后申请 display-capture，立即停止视频轨道，只留下系统回放音频。`Choose WAV file` 支持本地整数 PCM WAV；默认 `Use demo PCM` 是合成静音。四种输入都支持暂停、恢复、停止和重复会话。默认转写只显示演示文本与输入统计；设置 `CODING_HELP_TRANSCRIPTION_URL` 后才会使用用户自建的 loopback ASR 服务。详细格式、权限和错误处理及真实 Electron smoke 命令见 [音频输入指南](audio-input.md)。标准麦克风链路已通过合成设备验证，物理硬件与 Windows/macOS 系统音频权限尚未验收。

点击 `Recognize screen` 或按 `CommandOrControl+Shift+O` 可识别主屏全屏内容。PNG 仅在内存中交给本地 Tesseract，Dashboard 只显示文字，不显示截图、不写入历史。Linux/Ubuntu 需要 `tesseract-ocr`、`tesseract-ocr-chi-sim` 和 `tesseract-ocr-eng`；未安装时会显示静态不可用状态。完整边界见 [音频输入指南](audio-input.md) 和 [屏幕 OCR 与系统音频验证报告](../reports/screen-ocr-system-audio-verification-2026-11-15.md)。
