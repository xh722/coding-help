# coding-help

这个仓库包含两部分内容：

1. 对用户提供的 `interviewcoder-setup.exe` 做的授权离线静态逆向材料。
2. 基于静态证据重建的本地 Electron 应用，项目名为 `InterviewCoder Local Rebuild`。

本地重建版本的目标是复刻桌面交互、会话状态和 IPC 边界。它使用本地 API 与确定性 provider，不调用原软件的云端服务，也不运行原始安装包或 Windows native agent。

## 当前完成度

| 功能 | 状态 | 说明 |
|---|---|---|
| Electron Dashboard | 已完成 | 登录、会话控制、历史会话列表、转写列表、建议列表、错误提示、版本显示 |
| Overlay 悬浮面板 | 已完成 | Local Mode 隐私指示器、转写、建议、录制/暂停/停止状态 |
| 本地登录 | 已完成 | 仅接受演示账户，支持刷新、退出和过期 token |
| 本地 API | 已完成 | loopback 绑定、登录、刷新、用户、会话历史、事件、结构化错误；会话/事件可持久化恢复 |
| 会话状态机 | 已完成 | idle、active、paused、stopped、error，停止操作幂等；生命周期事件写入历史记录 |
| 本地转写 provider | 已完成 | 生成确定性的 partial/final transcript 事件 |
| 平台中立音频 provider | 已完成 | 支持确定性 PCM/WAV 输入、生命周期事件和转写 PCM 接线 |
| 本地建议 provider | 已完成 | 根据最后一条转写生成本地建议，不访问网络 |
| 屏幕枚举 | 已完成 | 通过 Electron `desktopCapturer` 获取显示器列表 |
| 截图 IPC | 已完成 | 获取 PNG data URL 并在 Dashboard 中显示最新截图预览 |
| 真实麦克风/系统音频 | 未完成 | Windows 真实设备 provider 仍待动态验证，当前使用确定性/文件输入 |
| 真实云端 AI/账户/订阅 | 未完成 | 原版服务端逻辑不在安装包中，无法从客户端完整恢复 |
| 原版自动更新链 | 未完成 | 只保留静态逆向证据，未接入原版更新源 |
| Windows 动态行为对照 | 待做 | 需要授权的 Windows 虚拟机和隔离网络环境 |

因此，当前版本适合本地运行、理解架构和继续替换 provider，不能声称已经完全复刻原软件。

## 快速开始

需要 Node.js 24 或更高版本。进入仓库根目录执行：

```bash
npm install
npm test
npm run check
npm run start
```

启动后使用本地演示账户：

```text
邮箱：local-dev@example.com
密码：local-dev-password
```

应用启动时会创建 Dashboard 和 Overlay 窗口。Dashboard 中可以：

1. 登录本地账户。
2. 填写会话标题、语言和备注。
3. 点击 `Start` 创建会话。
4. 观察 transcript partial/final 事件和本地 suggestion。
5. 点击 `Pause`、`Resume` 和 `Stop` 验证状态转换。
6. 打开 Overlay，观察 Local Mode 指示器和会话状态。
7. 使用 `Take screenshot` 测试显示器枚举和截图 IPC；当前版本会执行采集调用，但还没有把图片显示在 Dashboard 中。

所有会话、转写和建议都在本地确定性 provider 中生成，默认不需要互联网。

## 测试与验证

当前测试覆盖 59 个行为：

```bash
npm test
```

覆盖范围包括：

- 版本化 JSON 存储和原子写入。
- 登录、刷新、退出、过期 token 和错误凭据。
- IPC 命令白名单、payload 校验、来源/窗口校验和错误清洗。
- session 状态机、事件时间线、嵌套 payload 深拷贝和幂等停止。
- loopback API、body 限制、畸形 JSON、会话事件和 refresh token 撤销。
- deterministic transcription、suggestion 和 capture provider。
- Electron Preload bridge、sandbox 安全选项、导航/重定向拦截、Overlay 事件。
- Dashboard/Overlay 的 CSP、脚本来源和 renderer API 边界。
- API 启动失败后的离线 fallback。
- local API、auth、session 和 provider 的端到端组合流程。

语法检查：

```bash
npm run check
```

该命令对 `apps/`、`packages/`、`services/` 和 `tests/` 中的 JavaScript/CommonJS 文件执行 `node --check`。

## 目录结构

```text
apps/desktop/
  main/index.cjs       Electron 主进程、窗口、IPC、API 生命周期
  preload/index.cjs    sandbox 安全 bridge，只暴露 localRebuild
  renderer/
    index.html         Dashboard 页面
    app.js             登录、会话、事件渲染
    overlay.html       Overlay 页面
    overlay.js         Overlay 状态和事件渲染
    styles.css         本地 UI 样式

packages/core/
  auth.cjs              本地认证状态和 token 生命周期
  storage.cjs           版本化 JSON 存储
  session.cjs           会话状态机和事件记录
  ipc.cjs               IPC 白名单、schema 和错误清洗

packages/providers/
  transcription.cjs     确定性 partial/final provider
  suggestions.cjs       本地建议 provider
  capture.cjs           显示器/截图接口和注入式实现

services/local-api/
  server.cjs            127.0.0.1 本地 API

tests/
  *.test.cjs            Node 内置测试和 Electron 合约测试

docs/
  local-rebuild-usage.md                       快速使用说明
  superpowers/specs/...-design.md              完整设计和安全边界
  superpowers/plans/...-implementation-plan.md 实施计划
```

## 安全边界

本地重建版本遵循以下约束：

- Electron 使用 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- Preload 只暴露 `window.localRebuild.invoke/onEvent/removeEventListener`。
- renderer 不接触 `require`、`ipcRenderer`、Node `process` 或任意命令执行接口。
- 本地 API 只监听 `127.0.0.1`、`localhost` 或 `::1`。
- 认证失败、token 过期和 API 不可用会分别处理；HTTP 401 不会被误判成离线。
- Dashboard 和 Overlay 使用本地 CSP，事件内容通过 `textContent` 写入页面。
- 导航和重定向被拦截，外部窗口默认拒绝。
- Overlay 明确显示 `LOCAL MODE`，没有实现伪装进程、反检测或绕过用户可见性。
- 不提交原始安装包、完整 ASAR、native DLL/GStreamer 文件或真实账户 token。

## 离线 fallback

Electron 启动时会尝试启动本地 API。如果 API 因端口、权限或其他启动错误不可用，应用会进入离线模式：

- 使用本地确定性认证 fallback。
- 保留 session 状态机。
- 保留本地转写和建议 provider。
- 不访问原版云端服务。

认证接口返回 4xx 时仍会向用户报告真实认证错误，不会错误地切换到离线模式。

## 原版静态逆向材料

原始安装包是 NSIS → 7z → Electron ASAR 结构。静态分析确认了：

- Electron 主进程、Preload、renderer bundle。
- `x-desktop-access-token` 和平台 Bearer token 流程。
- `chrome-extension://ipc/*` 本地协议路由。
- Recall Desktop SDK、`agent-windows.exe` 和 `libbot_desktop_rs.dll`。
- 屏幕/窗口/麦克风/系统音频采集路径。
- generic updater 配置和自动更新入口。

报告和证据：

- [`reports/interviewcoder-static-analysis-2026-11-09.md`](reports/interviewcoder-static-analysis-2026-11-09.md)
- [`evidence/artifact-metadata.txt`](evidence/artifact-metadata.txt)
- [`evidence/main-index-snippets.txt`](evidence/main-index-snippets.txt)
- [`evidence/desktop-sdk-snippets.txt`](evidence/desktop-sdk-snippets.txt)
- [`evidence/renderer-auth-snippets.txt`](evidence/renderer-auth-snippets.txt)
- [`evidence/native-strings.txt`](evidence/native-strings.txt)

原始安装包和大型解包文件只保留在本地分析目录，不纳入 Git。

## 下一阶段

提高与原软件的行为一致性，需要在授权的 Windows 虚拟机中完成动态验证：

1. 记录原版安装后的进程树、文件、注册表和自动启动项。
2. 捕获 `agent-windows.exe` 的 stdin/stdout JSON 行协议。
3. 观察屏幕、窗口、麦克风和系统音频采集的真实输入输出。
4. 对照平台 API、Recall 上传和实时转写请求。
5. 将已验证的行为逐项替换本地 deterministic provider。
6. 最后再考虑 Electron 打包和安装器生成。

完整设计见 [`docs/superpowers/specs/2026-11-09-interviewcoder-local-rebuild-design.md`](docs/superpowers/specs/2026-11-09-interviewcoder-local-rebuild-design.md)，使用说明见 [`docs/local-rebuild-usage.md`](docs/local-rebuild-usage.md)。

项目路线图和已跳过的 Windows 动态验证待办见 [`docs/ROADMAP.md`](docs/ROADMAP.md)。

## 最终验证

2026-11-10：`npm test` 通过 44/44，`npm run check`、`git diff --check` 和大文件扫描通过；最终本地重建提交作者为 `19856850715@163.com`。
