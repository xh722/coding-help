# 项目路线图

## 待办

- [ ] **Windows 动态验证**：使用授权 Windows x64 虚拟机运行 `tools/windows-dynamic-preflight.ps1`，再观察原版安装器、`interviewcoder.exe`、`agent-windows.exe`、录音/屏幕采集、stdin/stdout 协议和网络边界。
  - 状态：已记录，当前跳过。
  - 阻塞条件：当前工作环境是 Linux，没有 Windows 虚拟机或真实音频设备；本地 Electron 可使用独立 Xvfb 虚拟显示验证。
  - 入口：[Windows 动态验证 Runbook](dynamic-validation/windows-interviewcoder-runbook.md)

- [ ] **物理麦克风与平台验收**：标准浏览器麦克风采集已实现；待在真实 Linux/Windows/macOS 设备验证系统权限、设备切换、拔插和长期运行。合成设备测试不代表硬件验证。
- [ ] **系统音频与 Windows 原版采集对照**：系统回放采集和原版 agent 的协议兼容仍未实现；Windows 动态验证继续跳过。
- [ ] **具体本地 ASR 模型**：loopback HTTP 适配器、WAV 封装、超时和返回校验已完成；待选择、授权并在本机部署实际 Whisper/Vosk 等模型服务。仓库不下载或捆绑模型。
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
- [x] 标准麦克风选择、点击 Start 后申请访问、AudioWorklet PCM 分块、暂停释放/恢复重连、退出和失败清理。
- [x] 麦克风权限及 IPC 约束；合成麦克风真实 Electron 验证，含摄像头/Overlay/非采集状态拒绝。
- [x] 可选 loopback ASR 适配器：仅允许 localhost/127.0.0.1/::1，默认关闭，失败不泄漏响应内容。
