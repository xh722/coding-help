# 本地深度能力回归验证 — 2026-11-18

## 命令

```bash
npm run local:preflight -- --deep --json
```

该入口先运行只读能力预检，再运行两个真实本机回归：OCR 使用固定内嵌 PNG 调用 Tesseract；离线更新在隔离临时目录生成一次性 GPG 密钥，使用真实 `gpg`、`tar` 和更新管理器完成签名、归档、安装与回滚。回归过程不访问网络，也不使用生产密钥。

## 本机结果

```json
{
  "ok": false,
  "code": "CAPABILITIES_PARTIAL",
  "summary": {
    "checked": 4,
    "ready": 3,
    "unavailable": 0,
    "needs_configuration": 1
  },
  "checks": {
    "ocr": {
      "status": "ready",
      "deep": {
        "status": "ready",
        "code": "OCR_REGRESSION_READY",
        "chars": 14,
        "matchesExpected": true
      }
    },
    "audio": {
      "status": "ready"
    },
    "asr": {
      "status": "needs_configuration",
      "code": "ASR_MODEL_MISSING"
    },
    "update": {
      "status": "ready",
      "deep": {
        "status": "ready",
        "code": "UPDATE_REGRESSION_READY",
        "checks": {
          "signature": true,
          "archive": true,
          "rollback": true
        }
      }
    }
  },
  "deep": true,
  "regressions": {
    "checked": 2,
    "ready": 2,
    "unavailable": 0
  }
}
```

深度回归已经通过；总状态仍是 `CAPABILITIES_PARTIAL`，原因是本机没有配置 ASR 模型目录。该结果不能替代真实语音识别质量验收。音频状态依赖运行命令时的桌面/设备权限；受限 shell 可能看不到同一组 ALSA 设备。

## 脱敏边界

深度聚合器只保留 OCR 字符数与匹配布尔值，以及更新签名、归档和回滚布尔值。识别文本、模型路径、临时目录、GPG 指纹、stderr 和异常正文均不会进入报告。
