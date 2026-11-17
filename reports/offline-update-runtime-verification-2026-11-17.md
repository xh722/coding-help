# 离线更新真实运行时回归 — 2026-11-17

## 运行内容

执行：

```bash
npm run update:verify -- --json
```

探针在隔离临时目录生成一次性 GPG key，使用真实 `gpg` 和 `tar` 构造两版最小 Linux bundle。随后通过现有更新管理器验证 manifest、detached signature、归档大小与 SHA-256、tar 解包、`current/previous` 原子指针和 rollback。完成后删除临时 keyring、归档、安装根目录和所有 staging 文件。

## 结果

```json
{
  "ok": true,
  "provider": "gpg+tar+update-manager",
  "version": "0.0.2-self-test",
  "rollbackVersion": "0.0.1-self-test",
  "checks": {
    "signature": true,
    "archive": true,
    "rollback": true
  }
}
```

CLI 只输出固定指标，不输出 GPG 指纹、临时路径、私钥、归档内容或异常文本。缺少 GPG 时返回固定 `UPDATE_GPG_UNAVAILABLE`；其他链路失败统一返回 `UPDATE_VERIFY_FAILED`。

## 边界

这证明本机 GPG/TAR 和更新管理器可以完成一次真实签名、安装和回滚。它不使用生产 key，不接入网络，不验证原版 generic updater，也不替代 Windows/macOS 安装器和发布环境代码签名验收。
