# 项目路线图

## 待办

- [ ] **Windows 动态验证**：使用授权 Windows x64 虚拟机运行 `tools/windows-dynamic-preflight.ps1`，再观察原版安装器、`interviewcoder.exe`、`agent-windows.exe`、录音/屏幕采集、stdin/stdout 协议和网络边界。
  - 状态：已记录，当前跳过。
  - 阻塞条件：当前工作环境是 Linux，没有 Windows 虚拟机或真实音频设备；本地 Electron 可使用独立 Xvfb 虚拟显示验证。
  - 入口：[Windows 动态验证 Runbook](dynamic-validation/windows-interviewcoder-runbook.md)

- [ ] **Windows 真实音频设备**：在 Windows 动态证据确认采集边界后，接入麦克风/系统音频设备；当前保留可注入的 device provider 待实现。
- [ ] **真实转写适配器**：只接入经过授权、已验证 schema 的服务端或本地模型。
- [ ] **更新链兼容性**：验证 manifest、签名校验、下载和回滚行为后再设计更新适配器。
- [ ] **桌面打包**：完成 provider 和安全边界验证后，生成可安装的 Electron 构建产物。

## 已完成

- [x] Electron Dashboard、Overlay 和安全 Preload bridge。
- [x] 本地认证、refresh/logout、过期 token 和 offline fallback。
- [x] local API、session 状态机、转写/建议/capture provider。
- [x] 平台中立音频 capture provider、PCM 转写输入和会话生命周期接线。
- [x] 截图结果在 Dashboard 中预览。
- [x] 端到端测试、Node 语法检查、GitHub CI 基线。

- [x] Dashboard 选择本地 WAV、显示 PCM 输入状态和统计；连续会话与退出清理。
- [x] 真实 Electron/Xvfb smoke：登录、暂停/恢复、完整文件传输、历史和第二次会话。
