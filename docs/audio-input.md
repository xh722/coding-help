# 本地 PCM / WAV 音频输入

音频文件和 PCM 数据已接入桌面会话；当前转写器仍为演示实现，**不会识别文件中的语音**。它显示接收到的音频块和字节数，不输出猜测的识别文本。麦克风、系统音频和 Windows 原版 agent 继续列入待办。

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
| 不支持 | MP3、AAC、float WAV、WAVE_FORMAT_EXTENSIBLE、实时设备 |

错误文件、截断数据、不一致的 RIFF 长度 / byteRate / blockAlign、无读取权限、超限输入都会返回错误，不会启动原始 Windows 程序。`audio.error` 对外使用固定错误信息，不泄漏本机路径。

8-bit PCM 使用无符号样本；此处遵循 [Microsoft waveform PCM 数据格式](https://learn.microsoft.com/en-us/windows/win32/multimedia/devices-and-data-types)。文件选择由主进程的 [Electron dialog](https://www.electronjs.org/docs/latest/api/dialog) 完成，renderer 不能传入任意文件路径。

## Provider 合约

`createAudioCaptureProvider()` 提供 `start({ onEvent, onChunk })`、`pause()`、`resume()`、`stop()`、`getState()`。一个实例用于一次流；桌面端每次会话创建新输入实例。

- `onChunk(Buffer, metadata)` 仅在主进程内调用；metadata 包含 `sampleRate`、`channels`、`bitsPerSample`、`format`、`sequence`、`sampleOffset`、`durationMs`、`timestamp`。
- `onEvent()` 只传 `audio.started/paused/resumed/stopped/error` 元数据；自然完成、停止和消费回调异常都会清理定时器及内部缓冲引用。
- `createLocalTranscriptionProvider({ mode: 'audio' })` 接受 `pushAudio()`，统计 `{ bytes, chunks }`。它持续接收直到 `finishAudio()`，不会被旧演示的 20ms 定时器提前关闭。
- `getAudioStats()` 不返回原始音频；`stop()` 清空统计。旧 `mode: 'demo'` 定时演示仍用于独立合约测试。
- 其他音频实现可通过 `createAppDependencies({ audio })` 注入；这是扩展点，尚未提供真实设备适配器。

## 验证

```bash
npm test
npm run check
npm run smoke
```

没有显示服务的 Linux CI 可以运行 `xvfb-run -a npm run smoke`。smoke 启动真实 Electron、主进程、sandboxed Preload 和 renderer，在临时用户目录中完成登录、WAV 输入、暂停/恢复、完整 64000 字节传输、历史保存和第二次会话。仅 OS 文件选择对话框返回值使用测试 fixture；其他链路使用真实实现，不打开麦克风。

没有 DISPLAY 时 smoke 返回退出码 2（未验证），不会假报成功。受限 Linux CI 只有显式设置 `CODING_HELP_SMOKE_NO_SANDBOX=1` 才给该测试进程传 Chromium `--no-sandbox`；普通 `npm start` 不使用此开关。本次本地 Xvfb 验证未启用它。
