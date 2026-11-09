# 本地重建使用说明

## 安装与验证

在仓库根目录执行：

```bash
npm install
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

local API 只监听 `127.0.0.1`，默认使用随机端口。转写和建议由确定性本地 provider 生成，因此登录、会话、暂停/恢复、结束和事件记录无需互联网。若 local API 无法启动，应用应进入离线模式；原始服务端、账户系统、Recall 云上传和 Windows native agent 都不会被调用。

端到端流程见 [`tests/local-flow.test.cjs`](../tests/local-flow.test.cjs)：它启动本地 API，通过公开 auth/session/provider 接口完成一次完整流程，并核对持久化事件顺序与 `stopped` 快照。

## 安全与范围

本项目不会执行原始安装器，不运行原始 Electron/PE、native DLL 或完整 ASAR，也不提交真实账户 token。原始静态分析材料仅用于界面和接口边界的重建。
