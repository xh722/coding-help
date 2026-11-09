# coding-help

本仓库保存对用户提供的软件包进行的授权、离线静态逆向材料，以及一个不依赖原版服务的本地 Electron 重建版本。

当前报告：

- [`reports/interviewcoder-static-analysis-2026-11-09.md`](reports/interviewcoder-static-analysis-2026-11-09.md)

仓库只提交可审阅的报告、证据摘录、哈希和复现脚本。原始安装包、完整 ASAR 解包目录和随包的大型 native/GStreamer 文件保留在本地分析目录，不纳入 Git。

本地重建的安装、测试、启动方式和演示账户见 [`docs/local-rebuild-usage.md`](docs/local-rebuild-usage.md)。完整设计见 [`docs/superpowers/specs/2026-11-09-interviewcoder-local-rebuild-design.md`](docs/superpowers/specs/2026-11-09-interviewcoder-local-rebuild-design.md)。

最终验证（2026-11-09）：`npm test` 通过 36/36 个测试，`npm run check` 和 `git diff --check` 均通过；已检查 Git 跟踪文件，没有超过 1 MiB 的文件。
