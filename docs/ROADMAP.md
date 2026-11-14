# 项目路线图

## 待办

## 后续执行清单（按顺序）

- [x] **1. 设备热插拔与选择器可靠性**：监听浏览器 `devicechange`、刷新设备名称、处理拔出中的设备并保持权限边界；合成设备和单元测试已完成。
- [x] **2. 桌面打包与可复现发布检查**：加入 Electron runtime bundle、SHA-256 资源清单、启动检查和 Linux CI 构建产物验证；不发布原版安装器或 native 文件。
- [x] **3. 系统音频能力探测**：探测当前平台是否提供回放采集，明确潜在路径、拒绝原因和 UI 状态；没有平台实现时保持安全的不可用结果。实际采集仍待平台验收。
- [ ] **4. 具体本地 ASR 模型服务**：在用户授权并部署 Whisper/Vosk 等模型服务后，接入已完成的 loopback 协议并验证语言、延迟和错误恢复。
- [ ] **5. 真实硬件验收**：在授权 Linux/Windows/macOS 设备验证权限、设备切换、拔插、暂停恢复和长时间运行。
- [ ] **6. Windows 动态行为对照**：使用授权 Windows 虚拟机运行原版 preflight，记录 agent、采集和网络边界；当前环境跳过。
- [x] **7. 离线更新适配器**：本地 manifest、GPG detached signature、归档哈希、tar 路径检查、原子 current/previous 切换和 rollback 已完成；原版更新服务器兼容仍待动态证据。

- [ ] **Windows 动态验证**：使用授权 Windows x64 虚拟机运行 `tools/windows-dynamic-preflight.ps1`，再观察原版安装器、`interviewcoder.exe`、`agent-windows.exe`、录音/屏幕采集、stdin/stdout 协议和网络边界。
  - 状态：已记录，当前跳过。
  - 阻塞条件：当前工作环境是 Linux，没有 Windows 虚拟机或真实音频设备；本地 Electron 可使用独立 Xvfb 虚拟显示验证。
  - 入口：[Windows 动态验证 Runbook](dynamic-validation/windows-interviewcoder-runbook.md)

- [ ] **物理麦克风与平台验收**：标准浏览器麦克风采集已实现；待在真实 Linux/Windows/macOS 设备验证系统权限、设备切换、拔插和长期运行。合成设备测试不代表硬件验证。
- [ ] **系统音频与 Windows 原版采集对照**：系统回放采集和原版 agent 的协议兼容仍未实现；Windows 动态验证继续跳过。
- [ ] **具体本地 ASR 模型**：loopback HTTP 适配器、WAV 封装、超时和返回校验已完成；待选择、授权并在本机部署实际 Whisper/Vosk 等模型服务。仓库不下载或捆绑模型。
- [x] **离线更新链**：`build:update`、`apply-update.cjs` 和 `docs/offline-updates.md` 已完成本地签名、完整性、原子切换、失败清理和回滚；网络下载、自动更新和原版 generic updater 仍未接入。
- [x] **Linux 可安装桌面包**：生成 Debian x64 包，提供 `/opt` bundle、系统启动器和桌面入口，并在 CI 解包复验 manifest；代码签名、自动更新和 Windows/macOS 安装包仍未完成。
- [x] **本地 ASR 生命周期管理**：可选 supervisor 以 loopback `/healthz` 为就绪条件，使用无 shell 的 JSON argv 启动子进程，有限重试、静态错误、SIGTERM/SIGKILL 清理和状态暴露均有自动化测试；实际模型和识别质量仍未验证。

## 后续目标与完成条件

1. **真实本地 ASR**
   - 安装 `services/local-asr/requirements.txt` 中的依赖，并准备用户授权的 Whisper/Vosk 模型目录。
   - 运行 `/healthz` 和 `/transcribe`，用真实语音样本验证语言、空音频、超时、模型错误和重复会话。
   - 记录识别延迟、CPU/内存占用和错误恢复；没有模型或只有固定 fixture 时不能标记完成。

2. **物理音频设备**
   - 在真实 Linux、Windows 或 macOS 设备验证权限申请、设备枚举、拔插、设备切换、暂停/恢复和长时间采集。
   - 保存不含原始音频和设备隐私信息的验收报告；合成设备测试只能作为自动化回归。

3. **系统音频边界**
   - 在具备平台权限的环境验证桌面回放采集的实际样本是否能进入受控 provider。
   - 分别记录 Windows display-media、Linux PipeWire、macOS System Audio Recording 的权限和失败行为。
   - 保持 Dashboard-only 权限边界，未通过实际样本验证前只报告 `potential` 或 `unavailable`。

4. **Windows 原版动态对照**
   - 使用授权 Windows x64 VM，先执行 preflight 的样本 SHA-256 检查，再记录安装器、主进程、`agent-windows.exe` 和 DLL 的进程/文件/注册表边界。
   - 捕获并脱敏 stdin/stdout JSON 行协议、录音/屏幕采集生命周期和网络请求；任何 hash 不匹配都停止动态阶段。

5. **更新链兼容性**
   - 取得授权的 manifest、签名公钥、安装包和失败样本，验证版本选择、签名校验、断点/重试和回滚。
   - 在证据足够前不接入原版 generic updater URL；最终实现必须有离线签名失败和回滚测试。

6. **可安装桌面发布物**
   - 在 Linux bundle 之外生成可安装格式，并验证启动、卸载、资源完整性和最小权限。
   - 之后再处理 Windows/macOS 安装包和代码签名；每种平台都必须有对应 CI 或授权机器上的 smoke 证据。

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
- [x] 可选 `faster-whisper` loopback 服务骨架、模型缺失 503、WAV 校验和 CPU/int8 配置；实际模型部署和准确率验收仍未完成。
- [x] ASR runtime 预检：模型和依赖缺失时返回明确的未验证状态，成功加载本地模型才返回通过；实际语音质量验收仍未完成。
- [x] Linux bundle 发布门禁：CI 可锁定来源提交 SHA，清单不匹配时拒绝验收；签名、更新下载和回滚仍未实现。
- [x] Debian x64 可安装包：`build:deb`/`check:deb` 验证包元数据、启动器、桌面入口和内部 bundle 清单。
- [x] 物理硬件只读预检：确认当前容器无 `/dev/snd`、无 ALSA 声卡和不可用 PulseAudio；物理验收仍阻塞。
- [x] Windows preflight 静态安全加强：默认核对授权样本 SHA-256，hash 不匹配时拒绝进入动态阶段；实际 Windows 运行仍阻塞。
