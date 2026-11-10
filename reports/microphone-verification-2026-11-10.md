# 标准麦克风阶段验证 — 2026-11-10

## 实现结果

- Dashboard 增加麦克风模式、设备选择与刷新；点击 Start 才申请采集，界面显示请求中、运行、释放和错误状态。
- 使用 getUserMedia → AudioWorklet → sandboxed Preload → 主进程，转换为单声道 signed16 little-endian PCM；请求 16kHz，报告实际采样率。
- Pause 关闭轨道和 AudioContext，Resume 使用新的采集标识重新采集；Stop、Sign out、页面刷新、窗口销毁、渲染进程退出、应用退出及输入错误均有清理路径。
- 每包上限 16384 字节、按采样对齐、有序，最多 4 个等待包和 1 个在途包；迟到授权、旧标识、非法数据和处理器失败不会污染新采集。
- 权限只允许 Dashboard 主 frame 在已开始的采集请求期间访问 audio，拒绝摄像头、混合音视频、Overlay、其他 URL 和子 frame。
- PCM 不上传或写入历史；生命周期、实际格式和演示统计可持久化。转写仍明确标注 DEMO，不执行语音识别。

## 本地验证环境

Linux x64 / Ubuntu 22.04，Node 24.14.1，Electron 39.8.10，Playwright Core 1.57.0，Xvfb 虚拟显示。

```text
npm test
109 tests, 109 pass, 0 fail, 0 skipped

npm run check
Syntax checked 37 JavaScript files.

DISPLAY=:95 npm run smoke
Electron smoke PASS: real preload/login/WAV 64000 bytes/history;
synthetic microphone PCM/permission denials/pause release/resume reacquire/stop/reload/signout.
```

本地测试使用 Chromium `--use-fake-device-for-media-stream`；不使用 `--use-fake-ui-for-media-stream` 或 `--no-sandbox`。没有录制物理麦克风。测试直接检查 Web API 返回的轨道 `readyState`，不是只看 UI 文案。暂停期间字节/块数不变，恢复后创建新流，旧流保持 ended。

权限负例包括开始前、暂停期间、停止后的重新请求，运行期间的摄像头和 audio/video 混合请求，以及 Overlay 请求。Node 测试另外覆盖其他 URL、子 frame、非法包、旧标识、超时、设备断开、异步取消和 renderer 退出。

## 检查能否抓住真实失败

在仓库外的验收副本中，故意令 AudioWorklet 的 process 返回 true 但不发送 PCM。相同 Electron smoke 返回退出码 1，报出实际状态 `started`、`bytes:0`、`chunks:0`，证明“会话显示运行但没有音频数据”无法通过验收。正式源码未修改。

采集控制器的定向测试也检查：未收到 ready 确认时不发送、队列第 5 个等待包触发过载、取消后迟到的轨道被关闭、PCM 字节序正确。独立代码审查发现并修复了 processorerror 没有释放资源的问题；新增运行中、初始化中和旧采集回调的回归测试。最终整阶段审查确认该问题已修复，没有新增待修复项。

## 未验证 / 未实现范围

- 尚未验证物理麦克风、Windows/macOS 系统权限、热插拔和长期运行稳定性。合成设备成功不代表硬件兼容已验收。
- 不支持系统回放采集；没有运行原始安装包或 Windows native agent。原版 Windows 动态对照继续按用户要求跳过。
- 真实 ASR、云端 AI/账户/订阅、更新链和安装包发布尚未完成。

使用说明和排错见 [音频输入指南](../docs/audio-input.md)，后续事项见 [路线图](../docs/ROADMAP.md)。
