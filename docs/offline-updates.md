# 离线签名更新与回滚

仓库提供一个只处理本地文件的更新链。它不访问更新服务器，也不会执行原版 generic updater URL。更新包由三个文件组成：

- `*.manifest.json`：版本、平台、归档文件名、大小和 SHA-256。
- `*.manifest.json.asc`：对 manifest 原文的 GPG detached signature。
- `*.tar.gz`：待安装的 Linux bundle。

更新器要求配置受信任的 GPG 指纹。它会按以下顺序处理：验证 manifest、验证签名指纹、验证归档大小和 SHA-256、检查 tar 路径、解包到 `versions/.staging-*`、确认 bundle 文件存在、写入版本目录，最后原子切换 `current` 和 `previous` 符号链接。任何步骤失败都会清理 staging 和新版本目录，当前版本保持不变。

## 构建更新包

先准备一个用户管理的 GPG keyring，并记录完整 fingerprint。仓库不会生成、提交或保存生产私钥。

```bash
export CODING_HELP_GPG_HOME=/path/to/update-keyring
export CODING_HELP_UPDATE_FINGERPRINT=0123456789ABCDEF0123456789ABCDEF01234567
npm run build:linux
npm run build:update -- \
  dist/interviewcoder-local-rebuild-linux-x64 \
  dist/updates \
  0.1.1
```

输出目录会得到：

```text
interviewcoder-local-rebuild-0.1.1-linux-x64.tar.gz
interviewcoder-local-rebuild-0.1.1-linux-x64.manifest.json
interviewcoder-local-rebuild-0.1.1-linux-x64.manifest.json.asc
```

`build:update` 使用 `tar` 创建归档，使用 `gpg --detach-sign --armor` 签名 manifest。已有同名输出时会拒绝覆盖。

## 应用更新

Debian 包的 launcher 会优先执行 `/opt/interviewcoder-local-rebuild/current/run.sh`，没有 current 指针时回退到包内原始 `run.sh`。因此可以把 Debian 安装根目录作为 update root；写入 `/opt` 需要管理员权限。

```bash
export CODING_HELP_GPG_HOME=/path/to/update-keyring
export CODING_HELP_UPDATE_FINGERPRINT=0123456789ABCDEF0123456789ABCDEF01234567
sudo -E node tools/apply-update.cjs \
  /opt/interviewcoder-local-rebuild \
  dist/updates/interviewcoder-local-rebuild-0.1.1-linux-x64.manifest.json \
  dist/updates/interviewcoder-local-rebuild-0.1.1-linux-x64.manifest.json.asc \
  dist/updates/interviewcoder-local-rebuild-0.1.1-linux-x64.tar.gz
```

回滚只切换两个本地指针，不重新下载或解包：

```bash
sudo -E node tools/apply-update.cjs --rollback /opt/interviewcoder-local-rebuild
```

默认禁止重复版本和降级。`current`、`previous` 只允许指向 `versions/` 下的符号链接；手工修改为普通文件或目录会被拒绝。

## 当前边界

这条链已经覆盖离线签名、完整性、原子切换和回滚测试，但没有接入原版更新服务器，也没有把网络下载、自动更新计划任务或生产私钥放入仓库。真实 GPG key、生产签名和跨平台安装器仍需在发布环境配置。
