# 项目路线图

## 待办

- [ ] **Windows 动态验证**：使用授权 Windows x64 虚拟机运行 `tools/windows-dynamic-preflight.ps1`，再观察原版安装器、`interviewcoder.exe`、`agent-windows.exe`、录音/屏幕采集、stdin/stdout 协议和网络边界。
  - 状态：已记录，当前跳过。
  - 阻塞条件：当前工作环境是 Linux，没有 Windows 虚拟机、PowerShell 和显示/音频设备。
  - 入口：[Windows 动态验证 Runbook](dynamic-validation/windows-interviewcoder-runbook.md)

- [ ] **真实音频 provider**：在 Windows 动态证据确认采集边界后，替换确定性 transcription provider。
- [ ] **真实转写适配器**：只接入经过授权、已验证 schema 的服务端或本地模型。
- [ ] **更新链兼容性**：验证 manifest、签名校验、下载和回滚行为后再设计更新适配器。
- [ ] **桌面打包**：完成 provider 和安全边界验证后，生成可安装的 Electron 构建产物。

## 已完成

- [x] Electron Dashboard、Overlay 和安全 Preload bridge。
- [x] 本地认证、refresh/logout、过期 token 和 offline fallback。
- [x] local API、session 状态机、转写/建议/capture provider。
- [x] 截图结果在 Dashboard 中预览。
- [x] 端到端测试、Node 语法检查、GitHub CI 基线。
