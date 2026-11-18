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
| 会话状态机 | 已完成 | idle、active、paused、stopped；支持停止后再次开始，音频错误会停止并提示；生命周期事件写入历史记录 |
| 本地转写 provider | 已完成（演示 + 可选 loopback ASR） | 默认只显示 PCM 统计；配置 `CODING_HELP_TRANSCRIPTION_URL` 后可把 PCM WAV 发给用户自建的 loopback ASR 服务；可选 supervisor 负责本地服务健康检查、有限重试和退出清理 |
| 平台中立音频 provider | 已完成 | 可在 Dashboard 选择本地 PCM WAV，完整帧分块、暂停/恢复、输入统计和错误清理 |
| 本地建议 provider | 已完成 | 根据最后一条转写生成本地建议，不访问网络 |
| 屏幕枚举 | 已完成 | 通过 Electron `screen` 枚举显示器，`desktopCapturer` 获取屏幕图像 |
| 截图 IPC | 已完成 | 获取 PNG data URL 并在 Dashboard 中显示最新截图预览 |
| 屏幕 OCR | 已完成，本机 Tesseract 已验证 | `CommandOrControl+Shift+O` 或 Dashboard 按钮捕获主屏全屏 PNG，只在内存中调用本地 Tesseract，Dashboard 只显示识别文字，不显示截图、不写历史；真实屏幕内容准确率仍需单独验收 |
| 标准麦克风采集 | 已实现，硬件待验 | 设备选择、自动响应设备变更、点击开始申请权限、AudioWorklet PCM、暂停释放/恢复重连；已通过真实 Electron 合成设备验证 |
| 系统音频采集 | 已实现，平台硬件待验 | Dashboard 选择后，Start 触发 `getDisplayMedia({video:true,audio:true})`；立即停止视频轨道，只把单声道 PCM 送入现有 ASR；Windows/Linux/macOS 权限和真实回放仍待验 |
| 系统音频能力探测 | 已完成 | 只读检查 Electron/平台路径和桌面源；实际采集另有独立 display-capture 权限和音频生命周期 |
| 本地能力诊断 | 已完成 | `npm run local:preflight -- --json` 汇总 OCR、音频硬件、ASR 模型和 GPG/TAR 工具状态；增加 `--deep` 可真实运行 OCR 合成图与离线更新回归；结果按 ready、unavailable、needs_configuration 分级，不读取网络或输出敏感路径 |
| 真实云端 AI/账户/订阅 | 未完成 | 原版服务端逻辑不在安装包中，无法从客户端完整恢复 |
| 原版自动更新链 | 未完成 | 只保留静态逆向证据，未接入原版更新源 |
| Linux x64 桌面 bundle / Debian 包 | 已完成，签名待做 | 可复现复制 Electron runtime + 本地应用，生成 SHA-256 manifest，并可生成 Debian x64 包；不包含原版安装器或 native 文件 |
| 离线签名更新与回滚 | 已完成本地链路，本机 GPG/TAR 已验证，生产密钥待配 | 本地 GPG detached signature、归档哈希、tar 路径检查、原子 `current/previous` 指针和失败清理；`npm run update:verify -- --json` 使用临时密钥验证签名、安装和回滚；不连接原版更新服务器 |
| 本地会话备份导入/导出 | 已完成 | Dashboard 导出和导入版本化 JSON；递归清理认证凭据，冲突整批拒绝，不上传网络 |
| SBOM 与发布清单 | 已完成本地生成，生产签名待配 | `npm run sbom` 生成 CycloneDX 1.5，Linux bundle 和 Debian checker 会验证 SBOM；代码签名仍需发布密钥 |
| Windows 动态行为对照 | 待做 | 需要授权的 Windows 虚拟机和隔离网络环境 |

因此，当前版本适合本地运行、理解架构和继续替换 provider，不能声称已经完全复刻原软件。

## 证据等级

项目报告和路线图使用以下三档状态，分别表示证据强度，而不是简单的成功/失败：

| 状态 | 含义 | 可得出的结论 |
|---|---|---|
| 对应评测器 | 已有直接测试、协议或真实运行证据对应目标评测器 | 可以标记该边界已验证 |
| 部分匹配 | 只覆盖部分行为，或证据来自静态分析、合成设备、单样本或受限环境 | 只能标记部分验证，不能宣称完整通过 |
| 未找到直接匹配 | 没有直接证据，只有推测或待授权环境验证 | 保持未验证，不把推测当作实现 |

当前映射为：Electron smoke、麦克风权限和本地 ASR HTTP 协议属于“对应评测器”；ASR 识别质量和屏幕 OCR 真实内容属于“部分匹配”；物理音频设备、平台系统音频和 Windows 原版动态行为属于“未找到直接匹配”。

## 快速开始

需要 Node.js 24 或更高版本，以及本机桌面显示服务。进入仓库根目录执行：

```bash
npm ci
npm test
npm run check
npm run start
```

生成可复现的 Linux x64 bundle：

```bash
npm run build:linux
npm run check:linux-bundle
./dist/interviewcoder-local-rebuild-linux-x64/run.sh
```

bundle 只包含当前仓库的 `apps/`、`packages/`、`services/` 和已安装 Electron runtime。`bundle-manifest.json` 记录每个文件的大小和 SHA-256；`check:linux-bundle` 会校验清单、启动器权限和原版安装器/native 文件排除。CI 传入 `CODING_HELP_EXPECTED_REVISION` 时还会校验 bundle 来源提交 SHA。当前没有签名、自动更新或 Windows/macOS 安装包。

发布审计还可以生成本地 CycloneDX SBOM：

```bash
npm run sbom
```

`npm run build:linux` 会把 SBOM 放入 bundle 根目录；`check:linux-bundle` 和 `check:deb` 会验证产品、版本和来源提交。SBOM 不等同于代码签名，生产签名仍需受控密钥。

在 Debian/Ubuntu x64 环境可以生成可安装包：

```bash
npm run build:linux
npm run check:linux-bundle
npm run build:deb
npm run check:deb
sudo apt install ./dist/interviewcoder-local-rebuild_0.1.0_amd64.deb
```

Debian 包把完整 bundle 安装到 `/opt/interviewcoder-local-rebuild`，并提供 `/usr/bin/interviewcoder-local-rebuild` 和桌面入口。包检查器会解包并重新验证内部 manifest；当前包没有代码签名、自动更新或卸载后数据迁移逻辑。

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
7. 使用 `Take screenshot` 测试显示器枚举和截图 IPC；该路径会显示在 Dashboard 的 Latest screenshot 区域。
8. 使用 `Recognize screen` 或按 `CommandOrControl+Shift+O` 识别主屏全屏内容。截图只在内存中传给本地 OCR，界面显示识别文字，不显示截图，也不会进入会话历史。
9. 选择 `Use system audio` 后点击 `Start`，系统会请求显示/系统音频权限；应用立即停止视频轨道，只采集回放音频并送入当前转写 provider。Linux 需要 PipeWire/桌面选择器，Windows/macOS 需要对应系统权限。
10. 在 Saved sessions 中点击 `Export backup` 导出全部本地会话；点击 `Import backup` 可从 JSON 恢复，冲突 ID 会整批拒绝；单个会话仍可用 `Export JSON` 导出。

默认使用三秒演示 PCM；也可以点击 `Choose WAV file` 读取本地文件、`Use microphone` 选择麦克风，或 `Use system audio` 采集系统回放。选择和刷新设备不会录音；系统设备变化会自动刷新列表，已拔出的设备会回退到 Default microphone 并提示。点击 `Start` 后才申请麦克风或 display-capture 权限。`Pause` 释放音轨，`Resume` 重新采集；停止、刷新和退出登录均结束采集。默认转写是演示输出；配置本机 ASR loopback 服务后才会执行实际识别。详细用法、权限排错、格式限制和隐私说明见 [音频输入指南](docs/audio-input.md)。

会话备份格式、隐私清理、导入冲突和恢复边界见 [本地会话备份](docs/session-backup.md)。

需要应用自动管理本地 ASR 子进程时，同时设置 `CODING_HELP_ASR_COMMAND` 为 JSON argv 数组：

```bash
export CODING_HELP_TRANSCRIPTION_URL=http://127.0.0.1:43123/transcribe
export CODING_HELP_ASR_COMMAND='["python3","services/local-asr/faster_whisper_server.py"]'
# 可选：语音分段吞字时关闭仓库服务的 VAD 过滤
export CODING_HELP_ASR_NO_VAD_FILTER=1
npm start
```

应用只接受 loopback `/healthz` 通过后开始会话，失败时不会进入 active；退出时会清理子进程。完整配置见 [音频输入指南](docs/audio-input.md)。

## 测试与验证

测试覆盖如下行为（最新数量见文末验证记录）：

```bash
npm test
```

覆盖范围包括：

- 版本化 JSON 存储和原子写入。
- 全量会话备份 schema、敏感字段清理、认证保护和主进程边界。
- CycloneDX SBOM 生成、依赖关系、bundle 来源提交和发布清单一致性。
- 登录、刷新、退出、过期 token 和错误凭据。
- IPC 命令白名单、payload 校验、来源/窗口校验和错误清洗。
- session 状态机、事件时间线、嵌套 payload 深拷贝和幂等停止。
- loopback API、body 限制、畸形 JSON、会话事件和 refresh token 撤销。
- deterministic transcription、suggestion 和 capture provider。
- Electron Preload bridge、sandbox 安全选项、导航/重定向拦截、Overlay 事件。
- Dashboard/Overlay 的 CSP、脚本来源和 renderer API 边界。
- API 启动失败后的离线 fallback。
- local API、auth、session 和 provider 的端到端组合流程。
- 完整 WAV 帧传输、来源切换、输入错误后重试、重复会话及退出清理。
- 麦克风 PCM 编码、设备/处理器故障、迟到授权、队列过载、过期采集标识、乱序/越界音频块和权限拒绝。
- 麦克风 `devicechange` 自动刷新、设备监听解绑和拔出设备回退。
- Linux x64 bundle 的 runtime 复制、SHA-256 manifest、清单校验和应用资源排除。
- 系统音频能力探测、平台提示、无源/错误结果和 Dashboard-only IPC 限制。
- loopback ASR 参考 fixture 的真实 HTTP/WAV 验证；fixture 固定返回文本，不宣称语音识别。
- 可选 `faster-whisper` loopback 服务骨架；模型和依赖由用户自行安装，缺失时返回 503，不伪造识别结果。`asr:preflight` 默认只读本地模型，传 `--allow-model-download` 才会尝试下载命名模型。`asr:benchmark` 可对最多 32 份带逐字参考的授权 WAV 运行 beam/VAD 矩阵，只输出 CER/WER、延迟和资源指标，不输出原始文本；`asr:stability` 可用合成静音重复检查 loopback 健康、请求延迟和退出清理。
- `asr:doctor` 本地运行时诊断和 WAV 基准：输出依赖版本、模型加载/推理耗时、重复推理的平均/最小/P95、格式、语言、文本长度、CPU 用户/系统耗时和峰值 RSS 内存；提供参考文本时还会计算脱敏的 CER/WER，不写出原始转写内容；`asr:smoke` 可启动本地 faster-whisper 服务并验证 `/healthz`、`/transcribe` 和退出清理；`asr:stability` 可用合成静音重复验证首尾健康检查、HTTP 状态计数、延迟和退出清理；`audio:preflight` 只读检查 ALSA/PulseAudio 和显示环境，不打开录音流。已用一份带逐字参考文本的授权中文 WAV 完成真实模型和 loopback 验证，但样本 CER/WER 偏高，不能宣称识别质量通过。
- 屏幕 OCR 和系统音频的 provider、IPC、权限门控、全屏主屏选择、视频轨道释放、PCM 队列和静态错误码有独立自动化测试；`npm run ocr:preflight -- --json` 只读检查 Tesseract 与 `chi_sim`/`eng` 语言包，`npm run ocr:verify -- --json` 使用固定合成 PNG 运行真实 Tesseract 并只输出脱敏指标，不读取屏幕或联网；本机实际屏幕捕获仍需要 Tesseract、桌面服务、PipeWire 和对应系统权限。
- 离线更新回归探针；`npm run update:verify -- --json` 在隔离临时目录生成一次性 GPG key，使用真实 `gpg`/`tar` 验证两版 manifest、签名、归档哈希、安装和 `current/previous` 回滚，不输出指纹、路径或私钥，也不访问网络。
- 本地能力诊断；`npm run local:preflight -- --json` 一次汇总 OCR、音频、ASR 和更新工具预检。增加 `--deep` 会在同一份脱敏报告中真实运行 OCR 合成图与离线更新回归，并把结果放在 `checks.*.deep` 和 `regressions` 下；默认只生成诊断结果，增加 `--strict` 才会在存在未验证能力或深度回归失败时返回退出码 2。
- loopback ASR 地址校验、PCM WAV 封装、返回文本校验、超时、停止取消、请求上限和错误脱敏。

`npm run smoke` 使用真实 Electron 运行桌面流程（需要显示服务；无显示器的 Linux 使用 `xvfb-run -a npm run smoke`）。命令必须从仓库根目录执行；如果当前终端不在仓库目录，使用 `npm --prefix /path/to/coding-help run smoke`。文件选择器返回合成 WAV；麦克风由 Chromium 合成媒体设备提供，经过真实 AudioWorklet、Preload 和主进程验证。覆盖采集、暂停释放、恢复重连、停止、刷新、退出登录，以及摄像头/Overlay/非采集状态拒绝。不录制物理麦克风，不跳过权限处理。系统音频需要真实桌面回放和平台权限，OCR 需要 `tesseract` 及 `chi_sim`/`eng` 数据，自动化测试不会伪造这两类硬件/可执行文件。

语法检查：

```bash
npm run check
```

该命令对 `apps/`、`packages/`、`services/` 和 `tests/` 中的 JavaScript/CommonJS 文件执行 `node --check`。

## 目录结构

```text
apps/desktop/
  main/index.cjs       Electron 主进程、窗口、IPC、API 生命周期
  main/media-permissions.cjs Dashboard 麦克风权限策略
  preload/index.cjs    sandbox 安全 bridge，只暴露 localRebuild
  renderer/
    index.html         Dashboard 页面
    app.js             登录、会话、事件渲染
    microphone.js      浏览器采集、设备列表和资源释放
    system-audio.js    getDisplayMedia 系统音频采集、视频轨道释放和资源清理
    pcm-worklet.js     音频下混、PCM 编码和分块
    overlay.html       Overlay 页面
    overlay.js         Overlay 状态和事件渲染
    styles.css         本地 UI 样式

packages/core/
  auth.cjs              本地认证状态和 token 生命周期
  storage.cjs           版本化 JSON 存储
  session.cjs           会话状态机和事件记录
  ipc.cjs               IPC 白名单、schema 和错误清洗
  backup.cjs            版本化会话备份、敏感字段清理和 schema 校验
  update.cjs            离线 manifest、GPG 签名、归档校验、原子切换和回滚

packages/providers/
  audio.cjs             PCM / WAV 输入和资源清理
  microphone.cjs        麦克风采集标识、IPC 数据校验及生命周期
  system-audio.cjs      系统音频能力探测、display-media PCM 生命周期及固定错误码
  screen-ocr.cjs        有界 PNG OCR provider，固定调用本地 Tesseract
  transcription.cjs     演示转写及 PCM 输入统计
  transcription-http.cjs 可选 loopback ASR WAV 适配器
  asr-supervisor.cjs  本地 ASR 子进程、健康检查、重试和退出清理
  suggestions.cjs       本地建议 provider
  capture.cjs           显示器/截图接口和注入式实现

services/local-api/
  server.cjs            127.0.0.1 本地 API

tests/
  *.test.cjs            Node 内置测试和 Electron 合约测试

docs/
  local-rebuild-usage.md                       快速使用说明
  sbom.md                                      SBOM 生成与发布校验
  superpowers/specs/...-design.md              完整设计和安全边界
  superpowers/plans/2026-11-10-audio-capture-provider.md 音频实施计划
```

## 安全边界

本地重建版本遵循以下约束：

- Electron 使用 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- Preload 只暴露 `window.localRebuild.invoke/onEvent/removeEventListener`。
- renderer 不接触 `require`、`ipcRenderer`、Node `process` 或任意命令执行接口。
- WAV 文件路径只来自系统选择器；仅受信任桌面窗口的主 frame 可调用 IPC。
- 麦克风仅允许 Dashboard 主 frame 在采集请求期间访问；摄像头、混合音视频、Overlay 和其他页面请求均拒绝。每次采集使用独立标识和有界 PCM 消息，不保存原始声音或设备 ID。
- 系统音频仅允许 Dashboard 主 frame 在待采集状态下申请 `display-capture`；`getDisplayMedia` 的视频轨道立即停止，只有有界单声道 PCM 进入 ASR，不保存桌面图像、原始音频或采集标识。
- 屏幕 OCR 只使用主显示器的内存 PNG，固定无 shell 调用本地 Tesseract，结果通过临时事件返回；PNG 不显示、不写入截图预览或历史，OCR 文本也不持久化。
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
- 离线 fallback 当前仅维持本次会话；local API 不可用时，新历史记录不能保证写入。

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

本机已用隔离环境加载 `faster-whisper tiny`，并用一份带逐字参考文本的授权中文 WAV 完成真实推理和 loopback `/healthz`、`/transcribe` 验证；该样本 CER `0.5676`、WER `3.0`，识别质量仍未通过，需要更多清晰样本或更大模型。当前仓库不捆绑模型；未配置 loopback 服务时仍不会识别语音。SBOM 已在本机完成，生产代码签名仍待发布环境密钥。

Windows 原版动态验证已按要求记为待办并跳过，不阻塞上述标准能力开发。后续具备授权虚拟机时再进行：

1. 记录原版安装后的进程树、文件、注册表和自动启动项。
2. 捕获 `agent-windows.exe` 的 stdin/stdout JSON 行协议。
3. 观察屏幕、窗口、麦克风和系统音频采集的真实输入输出。
4. 对照平台 API、Recall 上传和实时转写请求。
5. 将已验证的行为逐项替换本地 deterministic provider。
6. 最后再考虑 Electron 打包和安装器生成。

完整设计见 [`docs/superpowers/specs/2026-11-09-interviewcoder-local-rebuild-design.md`](docs/superpowers/specs/2026-11-09-interviewcoder-local-rebuild-design.md)，使用说明见 [`docs/local-rebuild-usage.md`](docs/local-rebuild-usage.md)。

项目路线图和已跳过的 Windows 动态验证待办见 [`docs/ROADMAP.md`](docs/ROADMAP.md)。

## 最终验证

PCM/WAV 阶段证据见 [音频阶段验证报告](reports/audio-input-verification-2026-11-10.md)；麦克风实现、测试结果和未验证范围见 [麦克风阶段验证报告](reports/microphone-verification-2026-11-10.md)；屏幕 OCR 与系统音频实现见 [屏幕 OCR 与系统音频验证报告](reports/screen-ocr-system-audio-verification-2026-11-15.md)；OCR 合成图与生命周期见 [屏幕 OCR 真实验证报告](reports/screen-ocr-real-verification-2026-11-17.md)；本地能力诊断见 [本地能力诊断报告](reports/local-capability-preflight-verification-2026-11-17.md)；本地深度能力回归见 [本地深度能力回归报告](reports/local-capability-deep-verification-2026-11-18.md)；可选 ASR 适配器见 [本地 ASR 验证报告](reports/local-asr-adapter-verification-2026-11-10.md)；ASR 生命周期见 [ASR supervisor 验证报告](reports/asr-supervisor-verification-2026-11-13.md)；离线更新见 [离线签名更新与回滚](docs/offline-updates.md)；离线更新真实回归见 [离线更新真实运行时回归](reports/offline-update-runtime-verification-2026-11-17.md)；会话备份见 [本地会话备份](docs/session-backup.md)；会话备份证据见 [备份验证报告](reports/session-backup-verification-2026-11-15.md)；SBOM 证据见 [SBOM 验证报告](reports/sbom-verification-2026-11-15.md)；bundle 验证见 [Linux bundle 报告](reports/linux-bundle-verification-2026-11-10.md)；系统音频探测见 [系统音频报告](reports/system-audio-capability-verification-2026-11-10.md)；物理设备检查见 [硬件验收报告](reports/physical-audio-hardware-verification-2026-11-10.md)；本次只读硬件预检见 [音频硬件预检报告](reports/audio-hardware-preflight-verification-2026-11-15.md)；真实语音模型见 [真实语音 ASR 验证报告](reports/asr-real-speech-verification-2026-11-15.md)；beam size 参数见 [ASR beam size 验证报告](reports/asr-beam-size-verification-2026-11-16.md)；多样本参数矩阵见 [ASR benchmark 验证报告](reports/asr-quality-benchmark-verification-2026-11-16.md)；稳定性与生命周期见 [ASR runtime stability 验证报告](reports/asr-runtime-stability-verification-2026-11-17.md)；Windows/更新边界见 [边界验证报告](reports/windows-update-boundary-verification-2026-11-10.md)；faster-whisper 服务见 [ASR 服务报告](reports/faster-whisper-server-verification-2026-11-10.md)；运行时预检见 [ASR runtime 预检报告](reports/asr-runtime-preflight-verification-2026-11-13.md)；运行时依赖和模型下载预检见 [ASR 安装验证报告](reports/asr-runtime-install-verification-2026-11-15.md)；doctor 诊断和基准见 [ASR doctor 验证报告](reports/asr-doctor-verification-2026-11-15.md)；服务启动、健康检查、静音转写和清理见 [ASR runtime smoke 验证报告](reports/asr-runtime-smoke-verification-2026-11-15.md)。当前全量门禁为 187 项 Node 测试、52 项 Python ASR 测试、73 个 JavaScript 文件语法检查、Linux bundle 清单校验和 Debian 包解包校验；历史验证报告保留各自运行时的测试计数，真实 Electron smoke、物理系统音频和生产 GPG 密钥仅在相应运行环境中验收。提交作者邮箱为 `19856850715@163.com`。
