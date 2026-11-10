# 本地音频输入阶段验证记录

日期：2026-11-10。范围：本地 PCM/WAV 输入、持续接收的演示转写器、桌面文件选择和会话生命周期。Windows 原版动态验证按用户要求继续保留待办。

## 实际交付

- Dashboard 可以通过系统文件选择器选择整数 PCM WAV，显示文件名、格式和接收统计；取消或输入无效不会覆盖此前选择。
- 文件按完整采样帧发送。8-bit 为无符号；支持 16/24/32-bit signed little-endian。文件限制 64 MiB / 65536 块，在选择时检查。
- 默认输入是三秒生成的 PCM 静音；演示转写只显示输入统计，不执行语音识别。WAV 输入不播放扬声器、不访问麦克风或外部服务。
- 暂停/恢复/停止同时协调音频和转写；可开始第二次会话。消费者异常或文件读取失败会清理并提示，恢复后可重试。
- 事件写入按序进行，Stop 和退出等待已排队的写入。音频块和完整文件路径不进入历史/renderer 事件。
- 修复了真实启动时 Dashboard 加载不存在文件的问题。新增 `npm run smoke`，运行真实 Electron 主进程、sandboxed Preload 和 renderer。

## 根因与回归

| 发现 | 修复与证据 |
| --- | --- |
| 旧演示转写在约20ms后完成，后续音频块被拒收 | `tests/audio-flow.test.cjs` 在修复前重现丢块；新 audio 模式持续接收直到输入结束 |
| 默认音频数组为空，桌面没有 WAV 入口 | `tests/desktop-audio.test.cjs` 验证默认流非空、文件选择及全量6400字节；真实 Electron 另验证64000字节 |
| WAV 位深/帧边界元数据错误 | 全位深 fixture、44.1kHz立体声24bit帧对齐、RIFF大小/布局/错误清理用例 |
| 会话结束后无法再次开始 | 状态机重置 + 真实第二次会话 |
| Dashboard 指向不存在的 dashboard.html | 改为现有 index.html；文件存在性回归和真实 UI 启动验证 |
| 历史事件并发写入、停止未等待 | 顺序队列回归和实际历史列表断言 |
| 文件过长在 Start 才报错 | 共享分块校验器，22分钟fixture在选择阶段被拒绝 |
| 读取失败后重试成功，旧错误提示仍显示 | 真实 Electron 回归先失败，再验证修复后错误隐藏 |
| Smoke 错把先加载的 Overlay 当成 Dashboard | 依 URL 选择 Dashboard 并限时等待，不依赖窗口加载顺序 |

## 最终本地结果

- `npm test`：**80/80 通过，0失败，0跳过**。
- `npm run check`：**28个 JavaScript 文件通过语法检查**。临时插入 SyntaxError 的负向对照被检查命令以退出码1拒绝，随后移除 fixture。
- `git diff --check`：通过。
- Git 跟踪文件大小检查：无超过20 MiB的文件。
- `DISPLAY=:94 npm run smoke`：**通过，退出码0**，使用工作目录内独立 Xvfb；没有启用测试用 no-sandbox 开关。

真实 Electron smoke 覆盖本地登录、sandboxed Preload bridge、选择合成 WAV、文件暂时缺失/恢复后的重试、暂停/恢复、可见64000字节统计、100块完整传输、历史中的元数据和演示结果、第二次会话。只替换 OS 文件选择对话框的返回值，文件解析/定时/IPC/HTTP/历史/UI都执行真实实现。测试使用临时 userData，不运行原版安装器或 native agent，不调用真实设备。

三个独立审查分别检查流格式/消费、主进程生命周期/IPC、用户流程/文档契约。发现的长文件限制和旧错误提示问题已修复并复审；没有未处理的本批阻塞问题。

## 可重复执行

```bash
npm ci
npm test
npm run check
xvfb-run -a npm run smoke   # 无物理显示器的 Linux；桌面环境可直接 npm run smoke
```

没有显示服务时 smoke 返回2表示未验证，不算通过。GitHub Actions 增加独立 Electron smoke job；远端结果以对应 Actions run 为准，本地通过不冒充远端已通过。

## 仍未实现

真实麦克风/系统音频、真实 ASR/LLM、原版 Windows agent 行为、发布安装包都不在本次完成声明中。离线 fallback 可以运行本地输入，但 local API 不可用时新历史不能保证落盘。这些范围继续在路线图中保留，不能把演示文本当成识别结果。

详见 [音频输入指南](../docs/audio-input.md)。
