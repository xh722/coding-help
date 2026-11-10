# 麦克风设备变更验证 — 2026-11-10

## 结果

- renderer 暴露 `onDeviceChange(listener)` 和 `dispose()`；首次注册只安装一个浏览器 `devicechange` 监听，最后一个 listener 解绑。
- 设备变化只调用 `enumerateDevices()`，不会调用 `getUserMedia()`，不会重新申请权限或中断正在运行的采集。
- Dashboard 自动刷新麦克风列表；当前选择的设备消失时清除选择并显示回退到 Default microphone 的提示。物理轨道断开仍由原有 `ended` 清理路径处理。
- 页面卸载会同时停止采集并解绑设备监听。

## 验证

`tests/microphone-renderer.test.cjs` 新增设备变更测试：触发 `devicechange` 后收到过滤后的 audioinput 列表，采集约束调用数保持 0；取消 listener 后不再通知，最后一个监听已从媒体设备对象移除。

本项没有声称物理热插拔已验证；当前证据使用标准 API 的合成事件和真实 Electron 的合成麦克风流程。物理设备拔插列在路线图第 5 项。
