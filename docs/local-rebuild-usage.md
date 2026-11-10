# 本地重建使用说明

## 安装与验证

在仓库根目录执行：

```bash
npm ci
npm test
npm run check
```

`npm test` 使用 Node 内置测试运行器覆盖认证、存储、IPC、会话状态机、provider、local API 和端到端本地流程。`npm run check` 对仓库中的 JavaScript/CommonJS 文件执行语法检查。

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

端到端流程见 [`tests/local-flow.test.cjs`](../tests/local-flow.test.cjs)：它启动本地 API，通过公开 auth/session/provider 接口完成一次完整流程，并核对持久化事件顺序与 `stopped` 快照。真实桌面测试使用 `npm run smoke`；无显示服务时返回“未验证”，不作为通过。

## 安全与范围

本项目不会执行原始安装器，不运行原始 Electron/PE、native DLL 或完整 ASAR，也不提交真实账户 token。原始静态分析材料仅用于界面和接口边界的重建。

## 本地音频

Dashboard 的 `Use microphone` 提供设备选择，在点击 Start 后才申请访问麦克风；Pause 释放设备，Resume 重新采集。`Choose WAV file` 支持本地整数 PCM WAV；默认 `Use demo PCM` 是合成静音。三种输入都支持暂停、恢复、停止和重复会话。默认转写只显示演示文本与输入统计；设置 `CODING_HELP_TRANSCRIPTION_URL` 后才会使用用户自建的 loopback ASR 服务。详细格式、权限和错误处理及真实 Electron smoke 命令见 [音频输入指南](audio-input.md)。标准麦克风链路已通过合成设备验证，物理硬件与 Windows/macOS 权限尚未验收。
