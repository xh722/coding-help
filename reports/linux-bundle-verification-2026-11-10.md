# Linux x64 bundle 验证 — 2026-11-10

## 实现

- `npm run build:linux` 从已安装 Electron 39.8.10 runtime 复制 Linux x64 运行目录，把 `apps/`、`packages/`、`services/` 和最小 `package.json` 放入 `resources/app`。
- `run.sh` 使用同一 runtime 启动 `resources/app`；`bundle-manifest.json` 为每个文件记录大小和 SHA-256。
- `npm run check:linux-bundle` 校验 manifest 完整性、hash、启动器可执行权限、runtime/app 存在，并拒绝原版安装器和 native 文件名；CI 传入 `CODING_HELP_EXPECTED_REVISION` 时还会拒绝来源提交 SHA 不一致的 bundle。
- `npm run build:deb` 将 bundle 包装成 Debian x64 包，安装到 `/opt/interviewcoder-local-rebuild`，并提供 `/usr/bin/interviewcoder-local-rebuild` 与桌面入口；`npm run check:deb` 解包后重新执行 bundle 校验。
- Debian 构建先写临时 archive，完成后才原子替换目标文件；`dpkg-deb` 中断或失败不会留下可误用的半成品包。
- `dist/` 被 Git 忽略，构建产物不会进入提交；签名、自动更新、Windows/macOS 安装包不在本项范围。

## 本地结果

```text
npm run build:linux
Linux bundle created: dist/interviewcoder-local-rebuild-linux-x64
Manifest files: 101
Electron: 39.8.10

npm run check:linux-bundle
Linux bundle verified: 105 files, SHA-256 manifest matches.

npm run build:deb
Debian package created: dist/interviewcoder-local-rebuild_0.1.0_amd64.deb

npm run check:deb
Debian package verified: interviewcoder-local-rebuild 0.1.0 amd64.
```

同一 bundle 的 runtime 已运行完整 Electron smoke：WAV 64000 字节、合成麦克风 PCM、权限拒绝、暂停释放/恢复重连、停止、刷新和退出登录均通过。CI 的 node-tests job 也执行 bundle 构建和校验。
