# Windows 动态与更新边界 — 2026-11-10

## 已完成的安全准备

- Windows preflight 默认核对安装包 SHA-256，样本不匹配会抛错并在任何进程、注册表或任务采集前终止；脚本不包含启动样本的命令。
- runbook 要求授权 Windows VM、网络白名单、测试账户、脱敏 token 和独立证据目录。
- 静态材料确认原版使用 generic updater URL，但未提供经过动态验证的 manifest schema、签名链、下载包或回滚状态。

## 保持阻塞的项目

当前 Linux 环境没有 Windows VM，不能验证原版 installer、agent、系统音频、更新 manifest、签名校验、下载重试或回滚。没有这些证据，不实现本地 updater，也不把原版 generic URL 接入重建应用。第 6/7 项在路线图中保持未完成；本报告只记录安全边界和阻塞原因。
