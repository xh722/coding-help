# 屏幕 OCR 合成图与生命周期验证 — 2026-11-17

## 真实 Tesseract 回归

本机预检确认：

```text
tesseract 4.1.1
languages: chi_sim, eng, osd
```

运行：

```bash
npm run ocr:verify -- --json
```

结果：

```json
{"ok":true,"source":"embedded-self-test","language":"eng","chars":14,"matchesExpected":true}
```

报告还包含耗时字段，但不会输出 OCR 文字、图片内容或路径。默认图片是仓库内固定的 1-bit PNG，内容为测试用英文短句；它只证明 Tesseract 可执行链路和输出脱敏，不代表真实桌面文字准确率。

同一命令支持 `--png /path/to/screenshot.png --language chi_sim+eng`，输入路径不会进入报告。当前本机运行的本地 PNG 回归返回 `ok: true`、14 个字符，`matchesExpected: null`。

## Electron OCR 生命周期

主进程契约测试新增两条边界：

- 同一时间已有 OCR 时，第二次请求返回固定 `OCR_BUSY`，不会重复捕获屏幕；
- 首次 OCR 超时/失败后，`finally` 清除占用状态，下一次请求可以重新捕获并返回结果。

这部分仍属于本地代码链路证据。真实桌面捕获、显示器权限、窗口内容和中文/复杂布局识别仍需有显示服务的环境或授权样本验收。
