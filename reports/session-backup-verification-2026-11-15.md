# 本地会话备份验证 — 2026-11-15

本阶段新增版本化会话备份文档、认证 API、主进程 IPC 和 Dashboard 全量导出按钮。

## 已验证

- `coding-help-session-backup` schema 固定为版本 1，包含产品、导出时间和会话数组。
- metadata、事件和嵌套 payload 会递归移除 password、token、secret、authorization、credential、cookie、private key 和 API key 字段。
- `/backup` 只接受有效 Bearer token；未认证请求返回 `401`。
- 重复会话 ID、错误时间戳、错误产品、错误 schema 和非法会话结构会被拒绝。
- 主进程会再次解析备份文档，只把 schema 允许的字段交给 renderer。
- Dashboard 提供单会话 `Export JSON` 和全量 `Export backup` 两条路径；备份不会通过外网发送。

## 自动化结果

- Node 测试：152/152 通过。
- Python ASR 测试：19/19 通过。
- JavaScript 语法检查：59 个文件通过。
- Linux bundle：108 个文件，清单 SHA-256 校验通过。
- Debian 包：`interviewcoder-local-rebuild 0.1.0 amd64` 解包校验通过。

## 未开放边界

当前只提供导出，不提供自动导入覆盖和跨版本迁移。导入功能需要明确合并、重复 ID、回滚和用户确认语义，暂不把不完整的导入实现暴露到桌面端。
