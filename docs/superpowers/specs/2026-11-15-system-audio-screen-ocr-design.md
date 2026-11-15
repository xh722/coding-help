# 系统音频采集与按需屏幕 OCR 设计

日期：2026-11-15  
状态：用户已确认方向，待规格审阅  
目标仓库：`xh722/coding-help`

## 目标

在现有本地 Electron 重建版本中增加两项明确、可关闭、可验收的能力：

1. 用户主动触发后采集系统回放音频，并沿用现有 PCM/loopback ASR 链路。
2. 用户主动触发后截取指定显示器画面，并在本机执行一次 OCR，返回屏幕文字。

两项能力都必须保持本地处理、显式授权、主 frame 限定和有界资源使用。没有平台能力、权限或本机 OCR 引擎时，返回固定未验证/不可用状态，不生成演示文本。

## 已确认的范围

### 屏幕 OCR

第一版采用按需截图 + 本地 OCR：用户点击“识别屏幕”后只执行一次截图和一次 OCR。第一版只返回纯文本和状态，不做连续采集、视觉问答、代码理解或云端视觉模型调用。

当前已有显示器枚举和 PNG 截图预览；新能力复用该截图源，不重复实现显示器访问。

### 系统音频

第一版采用显式 `getDisplayMedia({ audio: true, video: true })` 流程：用户点击系统音频采集后选择系统源，视频轨道立即丢弃，音轨交给现有 AudioWorklet 转换为单声道 16-bit PCM。音频块进入已有转写 provider 和 loopback ASR，不保存原始 PCM。

平台差异只影响能力结果和权限提示：Windows 使用 display-media/loopback 路径，Linux 依赖 PipeWire 与桌面源选择器，macOS 依赖 System Audio Recording 权限。当前 Linux 容器无真实音频设备，Windows/macOS 动态行为仍需对应环境验收。

## 方案取舍

考虑过三种方向：

- 直接实现三套 native PipeWire/Windows/macOS 采集器，平台控制力最强，但依赖、权限和测试环境都超过当前仓库能稳定验收的范围。
- 采用浏览器 display-media + 可注入 provider，权限由用户触发，跨平台边界清晰，能先完成 IPC、生命周期、错误和自动化测试。
- 连续截图并调用视觉模型，同时做系统音频实时理解，功能最丰富，但资源、隐私和模型依赖最大。

本设计选择第二种；连续 OCR、视觉问答和 native agent 兼容留到具备平台证据后再拆分。

## 架构

### 屏幕 OCR provider

新增 `packages/providers/screen-ocr.cjs`，不依赖 Electron，接收受限 PNG 字节并返回结构化结果：

```text
ocr({ png, language }) ->
  { ok: true, text, language, chars }
  { ok: false, code: OCR_UNAVAILABLE | OCR_TIMEOUT | OCR_INVALID_RESULT }
```

默认适配器调用本机 `tesseract`，使用固定 argv、无 shell、stdin 输入和 stdout 输出；默认语言为 `chi_sim+eng`，语言参数只接受受限字符集。输入和输出分别设置大小上限和超时。没有 `tesseract` 或中文语言包时只返回 `OCR_UNAVAILABLE`，不把截图内容放进错误信息。

主进程新增 `capture.ocr-screen`，只接受 `displayId`。主进程先通过现有截图 provider 得到 PNG，再调用 OCR provider；renderer 只能收到文本长度、语言、状态和 OCR 文本，不收到命令、模型路径或本地文件路径。OCR 文本不写入 session history，除非后续另行设计用户主动保存功能。

### 系统音频 provider

新增 `packages/providers/system-audio.cjs`，生命周期与麦克风 provider 对齐：

```text
start({ captureId, onEvent, onChunk })
pause()
resume({ captureId })
stop()
getState()
```

renderer 侧新增 `createSystemAudioCapture()`，复用麦克风采集的 AudioWorklet、有界发送队列、序号、迟到授权清理、track `ended` 处理和暂停恢复重连。系统音频使用独立 capture ID，过期块不能进入新一轮采集。

新增 IPC 白名单命令：

- `audio.use-system`：选择系统音频输入模式。
- `audio.system-ready`：提交协商后的采样率和声道。
- `audio.system-chunk`：提交有界 PCM 块和序号。
- `audio.system-failed`：提交固定错误码。
- `capture.ocr-screen`：触发一次屏幕 OCR。

主进程把系统音频块送入现有 transcription provider；`audio.get-status` 增加 `source: "system-audio"` 和固定状态，不返回音频内容或设备标识。

### UI

Dashboard 增加两个显式操作：

- `Recognize screen`：选择显示器后执行一次截图 OCR，展示文本或固定错误。
- `Use system audio`：用户启动会话前选择系统源并请求权限；采集期间显示状态、块数和字节数。

现有 `Take screenshot` 继续只负责预览截图。Overlay 不获得系统音频启动或 OCR 权限。会话暂停释放系统音频轨道，恢复时重新请求并生成新的 capture ID。

## 权限与安全边界

- 只有已登录 Dashboard 的主 frame 可以请求系统音频；Overlay、子 frame、外部 URL、导航后的页面和后台定时任务全部拒绝。
- `display-capture` 权限只在用户点击系统音频操作且存在待处理请求时允许；普通页面和截图预览不自动触发权限。
- 截图 PNG 只在主进程到 OCR provider 的内存路径中存在，不写临时文件，不上传网络，不进入 session history。
- OCR 命令固定为无 shell 子进程；禁止 renderer 提供可执行文件路径、任意参数或 OCR 命令。
- 音频块只在主进程内存和 ASR 请求中流转，事件只包含状态、格式、统计和固定错误码。
- OCR 和系统音频均有输入大小、队列长度、响应长度和超时上限；超限立即终止当前操作并清理资源。

## 错误行为

| 场景 | 对外结果 |
| --- | --- |
| 没有系统源或平台不支持 | `SYSTEM_AUDIO_UNAVAILABLE` |
| 用户拒绝显示/系统音频权限 | `SYSTEM_AUDIO_PERMISSION_DENIED` |
| 音频轨道结束或设备消失 | `SYSTEM_AUDIO_LOST`，结束当前采集 |
| PCM 队列过载 | `SYSTEM_AUDIO_BACKPRESSURE`，结束当前采集 |
| OCR 引擎或语言包缺失 | `OCR_UNAVAILABLE` |
| OCR 超时或输出超过上限 | `OCR_TIMEOUT` 或 `OCR_INVALID_RESULT` |
| 截图源不存在 | `CAPTURE_UNAVAILABLE` |

错误文本保持固定，不泄漏本地路径、命令、设备名称、截图内容或 ASR 响应正文。

## 测试与验收

### 自动化测试

- screen OCR provider：固定 argv、stdin 输入、超时、输出上限、缺少引擎、命令失败和结果脱敏。
- system audio provider：开始/暂停/恢复/停止、队列上限、轨道结束、旧 capture ID、资源清理和事件不含 PCM。
- IPC：新增命令的 allowlist、字段校验、Dashboard 主 frame 限制和 Overlay/子 frame 拒绝。
- renderer：`getDisplayMedia` 音频轨道转 PCM、视频轨道丢弃、权限拒绝、暂停恢复和迟到 track 清理。
- main 合约：OCR 只接收指定显示器，系统音频只在用户动作后启动，并与 transcription 生命周期一致。

### 本机验收

- 有 `tesseract` 和 `chi_sim` 语言包时，用合成/真实截图验证 OCR 文本；没有引擎时验证固定 `OCR_UNAVAILABLE`。
- 有系统音频源时运行一次真实 start/stop 和 loopback ASR；没有源时运行 preflight 并记录未验证结果。
- `npm test`、`npm run check`、`git diff --check`、Linux bundle 和 Debian 门禁必须保持通过。

真实系统音频、Windows/macOS 权限、物理设备热插拔和识别质量不能由 fake provider 或无设备容器标记为通过。

## 不在本次范围

- 连续截图、屏幕录像、OCR 自动上传或云端视觉模型。
- 自动监听系统音频、后台录音或绕过系统权限。
- Windows 原版 `agent-windows.exe`、Recall 上传协议或原版 generic updater。
- 自动把 OCR 文本或系统音频转写写入历史；需要单独的用户保存设计。

## 完成条件

1. 用户可在 Dashboard 显式触发一次屏幕 OCR，缺少引擎时看到固定未验证状态。
2. 用户可在 Dashboard 显式选择系统音频，音频经有界 PCM 流进入现有 loopback ASR，暂停/恢复/停止和错误清理与麦克风一致。
3. 所有新增 IPC、provider、权限和 renderer 行为有自动化测试，事件和持久化数据不包含原始截图或 PCM。
4. README、音频指南、路线图和验证报告明确区分代码链路通过与平台硬件未验证。
