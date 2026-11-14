# 离线签名更新与回滚验证 — 2026-11-14

本阶段新增 `packages/core/update.cjs`、`tools/build-update.cjs` 和 `tools/apply-update.cjs`。更新链只处理本地文件，不连接原版更新服务器。

## 已验证

- manifest 严格检查 schema、产品、平台、版本、归档文件名、字节数和 SHA-256。
- detached signature 必须产出受信任的 GPG fingerprint；错误签名和未授权 signer 会拒绝。
- 归档在解包前验证大小和 SHA-256。
- tar 成员禁止绝对路径和 `..` 路径，避免写出 staging 目录。
- 更新先写入 `versions/.staging-*`，完成 payload 检查后才改名为版本目录。
- `current` 和 `previous` 只允许指向 `versions/` 下的符号链接。
- 版本切换使用临时符号链接和 `rename`；解包、签名或切换失败不会留下 staging 或半成品版本。
- 默认禁止重复版本和降级；rollback 只交换 current/previous 指针。
- Debian launcher 优先执行 `current/run.sh`，没有 current 时兼容旧的包内 `run.sh`。

## 自动化结果

- 全量 Node 测试：148/148 通过。
- Python ASR 测试：19/19 通过。
- JavaScript 语法检查：57 个文件通过。
- 更新核心测试：4 个场景通过。
- 更新构建测试：2 个场景通过。
- Linux bundle：107 个文件，清单 SHA-256 校验通过。
- Debian 包：`interviewcoder-local-rebuild 0.1.0 amd64` 解包校验通过。
- 测试使用临时 payload、签名状态 fixture 和 tar 注入，不依赖网络或生产私钥。
- 当前环境的 gpg-agent 不可启动，因此没有把临时生产 key 生成当成通过条件；真实发布仍需在发布机用受控 GPG keyring 运行 `build:update` 和 `apply-update.cjs`。

## 未完成边界

原版 generic updater URL、联网下载、断点续传、自动更新计划任务、Windows/macOS 安装器和生产代码签名仍未实现。仓库不保存任何私钥或真实更新地址。
