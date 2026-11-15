# 本地会话备份验证 — 2026-11-15

本阶段新增版本化会话备份文档、认证 API、主进程 IPC 和 Dashboard 导入/导出按钮。

## 已验证

- `coding-help-session-backup` schema 固定为版本 1，包含产品、导出时间和会话数组。
- metadata、事件和嵌套 payload 会递归移除 password、token、secret、authorization、credential、cookie、private key 和 API key 字段。
- `/backup` 只接受有效 Bearer token；未认证请求返回 `401`。
- 重复会话 ID、错误时间戳、错误产品、错误 schema 和非法会话结构会被拒绝。
- 主进程会再次解析备份文档，只把 schema 允许的字段交给 renderer。
- Dashboard 提供单会话 `Export JSON` 和全量 `Export backup` 两条路径；备份不会通过外网发送。
- Dashboard `Import backup` 通过主进程文件选择器读取 JSON；服务端先完整验证，再一次性合并，重复 ID 返回 409 且不会部分写入或覆盖现有会话。

## 自动化结果

- Node 测试：157/157 通过。
- Python ASR 测试：21/21 通过。
- JavaScript 语法检查：61 个文件通过。
- Linux bundle：109 个文件，清单 SHA-256 校验通过。
- Debian 包：`interviewcoder-local-rebuild 0.1.0 amd64` 解包校验通过。

## 未开放边界

当前导入只支持同一 `schemaVersion` 的安全合并，不提供覆盖已有会话、跨版本迁移或撤销导入。导入前应保留一份现有导出备份，以便人工回滚。
