# 项目路线图

## 待办

## 后续执行清单（按顺序）

- [x] **1. 设备热插拔与选择器可靠性**：监听浏览器 `devicechange`、刷新设备名称、处理拔出中的设备并保持权限边界；合成设备和单元测试已完成。
- [x] **2. 桌面打包与可复现发布检查**：加入 Electron runtime bundle、SHA-256 资源清单、启动检查和 Linux CI 构建产物验证；不发布原版安装器或 native 文件。
- [x] **3. 系统音频能力探测**：探测当前平台是否提供回放采集，明确潜在路径、拒绝原因和 UI 状态；没有平台实现时保持安全的不可用结果。实际采集仍待平台验收。
- [ ] **4. 具体本地 ASR 模型服务**：在用户授权并部署 Whisper/Vosk 等模型服务后，接入已完成的 loopback 协议并验证语言、延迟和错误恢复。
- [ ] **5. 真实硬件验收**：在授权 Linux/Windows/macOS 设备验证权限、设备切换、拔插、暂停恢复和长时间运行。
- [ ] **6. Windows 动态行为对照**：使用授权 Windows 虚拟机运行原版 preflight，记录 agent、采集和网络边界；当前环境跳过。
- [ ] **7. 更新链兼容性**：基于动态证据验证 manifest、签名、下载和回滚，再设计本地更新适配器。

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
- [x] 设备变更监听与选择器回退；Linux x64 runtime bundle、SHA-256 manifest 和 bundle smoke。
- [x] 系统音频只读能力探测；不会申请屏幕/摄像头权限或启动音频流。
- [x] 本地 ASR 协议参考 fixture：真实 loopback HTTP、WAV 校验和固定响应；不冒充实际语音识别模型。
- [x] 物理硬件只读预检：确认当前容器无 `/dev/snd`、无 ALSA 声卡和不可用 PulseAudio；物理验收仍阻塞。
- [x] Windows preflight 静态安全加强：默认核对授权样本 SHA-256，hash 不匹配时拒绝进入动态阶段；实际 Windows 运行仍阻塞。
