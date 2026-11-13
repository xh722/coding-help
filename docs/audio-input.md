# 本地麦克风 / PCM / WAV 音频输入

标准麦克风、音频文件和 PCM 数据已接入桌面会话；默认转写器是演示实现，**不会识别语音**。如配置用户自己运行的 loopback ASR 服务，应用可在会话结束时发送 PCM WAV 并显示服务返回的文本。系统音频、Windows 原版 agent 对照和真实硬件验收继续列入待办。

## 可选本地 ASR

仓库不捆绑模型，也不会自动连接公网服务。启动桌面应用前设置环境变量：

```bash
CODING_HELP_TRANSCRIPTION_URL=http://127.0.0.1:43123/transcribe npm start
```

只接受 `http`/`https` 的 `localhost`、`127.0.0.1` 或 `[::1]`，不接受 URL 用户名、密码或公网域名。应用在会话结束时以 `audio/wav` POST 单个 PCM WAV，包含标准 RIFF/PCM 头；服务应返回 JSON：

```json
{"text":"recognized text"}
```

返回文本会去除首尾空格并限制长度；空响应、非 JSON、HTTP 错误、网络错误和超时都会产生固定错误提示。请求不会跟随重定向，响应体有 256 KiB 上限；原始响应、服务地址中的凭据和音频内容不会写入历史。暂停期间不发送，停止会取消等待中的请求，旧会话的迟到响应不会写入新会话。状态栏会显示 `LOCAL ASR · loopback`；未配置或配置无效时显示 `DEMO · no speech recognition`。

该适配器只定义本地服务协议，不代表仓库已包含 Whisper/Vosk 等识别模型。模型服务的安装、模型文件、语言设置和准确率由用户自行负责。

仓库提供一个协议 fixture 方便验收链路：

```bash
npm run asr:fixture
CODING_HELP_TRANSCRIPTION_URL=http://127.0.0.1:43123/transcribe npm start
```

fixture 只校验 PCM WAV 并返回固定文本，**不是语音识别模型**；它用于确认 loopback、WAV、超时和错误处理。实际识别需要替换成用户部署的 Whisper/Vosk 等服务。

如果用户已安装 `faster-whisper` 并拥有本地模型目录，可以运行仓库提供的可选服务：

```bash
python3 -m pip install -r services/local-asr/requirements.txt
WHISPER_MODEL=/path/to/model npm run asr:faster-whisper
CODING_HELP_TRANSCRIPTION_URL=http://127.0.0.1:43123/transcribe npm start
```

启动服务前可以先运行本地模型预检：

```bash
WHISPER_MODEL=/path/to/model npm run asr:preflight
```

预检只使用本地文件；依赖、模型目录或模型加载失败会返回 `NOT VERIFIED` 和退出码 2，不会被当成通过。

服务默认使用 CPU `int8` 和 4 个 CPU 线程，只监听 loopback；也可设置 `WHISPER_DEVICE`、`WHISPER_COMPUTE_TYPE`。服务严格校验 PCM WAV 和 `Content-Length`，限制并发与推理资源。模型路径缺失、依赖未安装或模型加载失败时服务仍可启动用于 `/healthz` 诊断，但返回 503，不会返回固定文本或伪造识别。需要允许下载命名模型时显式传 `--allow-model-download`，仓库不会替用户下载模型。

## 使用麦克风

1. 登录后点击 **Use microphone**，从 **Microphone device** 中选择设备；通常可保留 **Default microphone**。**Refresh devices** 仅枚举设备，不开始录音。系统报告耳机、USB 麦克风等变化时列表会自动刷新；如果当前设备被拔出，界面会清除选择并提示回退到 Default microphone。尚未授权时系统可能不提供设备名称。
2. 点击 **Start** 才申请麦克风访问。界面先显示 **Requesting microphone access**，准备完成后显示 **Microphone active** 和接收统计。系统提示授权时，允许该本地应用使用麦克风。
3. **Pause** 关闭音轨和 AudioContext；**Resume** 重新申请并建立采集，不补录暂停期间的声音。运行或暂停时，输入源和设备选择被锁定。
4. **Stop**、**Sign out**、关闭 Dashboard、刷新页面或退出应用都会结束采集。设备断开、处理器失败或处理速度不足会终止会话并提示错误。
5. 拒绝权限、设备被占用或找不到设备时，检查系统设置，必要时停止后刷新设备列表，重新开始。等待权限或初始化超过 30 秒会自动取消；取消之后才到达的授权结果也会立即关闭音轨。

只采集用户选择的麦克风，不采集系统回放、摄像头或屏幕声音。Dashboard 的 **Check system audio** 只读取桌面源并报告当前平台是否存在潜在 display-media 路径，不申请屏幕权限、不启动流、不把摄像头或桌面画面混入音频。实际系统音频采集仍未实现。麦克风音频在本机流经 AudioWorklet 和主进程，不回放到扬声器，不上传或保存原始 PCM。历史中保存的是生命周期、格式和演示统计，不包含设备 ID、采集标识或原始音频。

实现通过 Chromium 的标准 `getUserMedia` 获取音频，AudioWorklet 下混为单声道 16-bit little-endian PCM。请求 16kHz，界面记录实际协商采样率；每块约 20ms。IPC 每包不超过 16384 字节，队列最多 4 个等待块及 1 个在途块，过载直接停止并提示，不静默丢块。

权限仅允许正在申请/运行采集的 Dashboard 主 frame 访问 audio；摄像头、混合 audio/video、Overlay、其他 URL 和子 frame 均拒绝。主进程同时安装 [Electron permission check/request handlers](https://www.electronjs.org/docs/latest/api/session)，并核对采集标识、顺序、PCM 类型和长度。浏览器处理流程参见 [AudioWorkletProcessor.process](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process)。

Electron 的桌面音频路径依赖平台：Windows 可使用 display-media loopback，Linux 依赖 PipeWire 和用户选择器，macOS 14.2+ 需要 System Audio Recording 权限；官方文档还说明 macOS 权限缺失时可能得到没有样本的 ended 音轨。因此本项目把探测结果标为 `potential`，不会把探测当成实际采集成功。参考 [Electron desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer)。

本阶段使用 Linux + Chromium 合成麦克风验证链路，**没有实测物理麦克风，也没有验证 Windows/macOS 系统权限和设备兼容性**。

## 在桌面端使用

1. `npm ci` 后执行 `npm start`，使用 `local-dev@example.com` / `local-dev-password` 登录。
2. 点击 **Choose WAV file**，在系统文件选择器中选择本地 PCM WAV。取消选择会保留之前的输入。
3. 点击 **Start**。界面显示文件名、采样率、声道数、位深、接收块数和字节数。选择文件本身不会开始采集。
4. **Pause / Resume** 控制音频流和演示转写器；运行中不能切换音频源。
5. 输入到达文件末尾时停止送入 PCM；演示结果显示已接收的字节数。点击 **Stop** 结束会话、保存历史，并释放音频源。
6. 停止后可以选择另一个文件、启动新会话。**Use demo PCM** 使用三秒合成静音数据，不访问麦克风。

本模块只读取和分块送入音频，不提供扬声器播放。音频生命周期和演示结果进入会话历史；原始 PCM、文件完整路径和音频内容不写入历史或 renderer 事件。原文件不会被修改。

## 支持范围

| 属性 | 支持范围 |
| --- | --- |
| 容器 | little-endian RIFF/WAVE |
| 编码 | integer PCM，format tag 1 |
| 位深 | 8-bit unsigned、16/24/32-bit signed little-endian |
| 文件大小 | 最多 64 MiB，含文件头 |
| 分块数量 | 最多 65536 块；默认 16kHz、20ms 分块约 21 分 50 秒，超长文件需先切分 |
| 采样率 / 声道 | 1–384000 Hz / 1–32，格式字段须一致 |
| 分块 | 默认 20ms，始终按完整采样帧切分，尾块按实际长度处理 |
| 文件格式不支持 | MP3、AAC、float WAV、WAVE_FORMAT_EXTENSIBLE |

错误文件、截断数据、不一致的 RIFF 长度 / byteRate / blockAlign、无读取权限、超限输入都会返回错误，不会启动原始 Windows 程序。`audio.error` 对外使用固定错误信息，不泄漏本机路径。

8-bit PCM 使用无符号样本；此处遵循 [Microsoft waveform PCM 数据格式](https://learn.microsoft.com/en-us/windows/win32/multimedia/devices-and-data-types)。文件选择由主进程的 [Electron dialog](https://www.electronjs.org/docs/latest/api/dialog) 完成，renderer 不能传入任意文件路径。

## Provider 合约

`createAudioCaptureProvider()` 提供 `start({ onEvent, onChunk })`、`pause()`、`resume()`、`stop()`、`getState()`。一个实例用于一次流；桌面端每次会话创建新输入实例。

- `onChunk(Buffer, metadata)` 仅在主进程内调用；metadata 包含 `sampleRate`、`channels`、`bitsPerSample`、`format`、`sequence`、`sampleOffset`、`durationMs`、`timestamp`。
- `onEvent()` 只传 `audio.started/paused/resumed/stopped/error` 元数据；自然完成、停止和消费回调异常都会清理定时器及内部缓冲引用。
- `createLocalTranscriptionProvider({ mode: 'audio' })` 接受 `pushAudio()`，统计 `{ bytes, chunks }`。它持续接收直到 `finishAudio()`，不会被旧演示的 20ms 定时器提前关闭。
- `createLocalHttpTranscriptionProvider({ endpoint, fetchImpl, requestTimeoutMs })` 只接受 loopback 服务；`finishAudio()` 封装 WAV 并等待 JSON 文本。默认桌面配置仍使用上面的演示 provider。
- `getAudioStats()` 不返回原始音频；`stop()` 清空统计。旧 `mode: 'demo'` 定时演示仍用于独立合约测试。
- `createMicrophoneProvider()` 由主进程管理采集标识，提供相同生命周期接口及 `ready/push/fail/permissionExpected`。暂停和恢复会使用不同标识，过期音频块无法进入新采集。
- renderer 的 `createMicrophoneCapture()` 管理 MediaStream、AudioContext、Worklet、有界发送队列和 `devicechange` 监听；异步步骤取消、迟到授权、设备 `ended` 和 Worklet `processorerror` 均有清理路径，页面卸载时会解绑监听。
- 其他音频实现可通过 `createAppDependencies({ audio })` 注入；系统音频仍只有能力探测，实际适配器未实现。

## 验证

```bash
npm test
npm run check
npm run smoke
```

没有显示服务的 Linux CI 可以运行 `xvfb-run -a npm run smoke`。smoke 启动真实 Electron、主进程、sandboxed Preload 和 renderer，在临时用户目录中完成登录、WAV 输入、暂停/恢复、完整 64000 字节传输、历史保存和第二次会话。OS 文件选择对话框返回值使用测试 fixture。

同一测试用 Chromium `--use-fake-device-for-media-stream` 供应合成音频，通过真实 `getUserMedia`、AudioWorklet、Preload 和主进程验证数据流及轨道释放；覆盖暂停/恢复、停止、刷新、退出登录和权限拒绝。它不使用绕过权限的 `--use-fake-ui-for-media-stream`，不录制物理麦克风。

没有 DISPLAY 时 smoke 返回退出码 2（未验证），不会假报成功。受限 Linux CI 只有显式设置 `CODING_HELP_SMOKE_NO_SANDBOX=1` 才给该测试进程传 Chromium `--no-sandbox`；普通 `npm start` 不使用此开关。本次本地 Xvfb 验证未启用它。
