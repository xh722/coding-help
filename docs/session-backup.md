# 本地会话备份

Dashboard 的 `Export backup` 会通过受认证的本地 API 导出全部已保存会话。下载文件是版本化 JSON，格式为 `coding-help-session-backup`，包含导出时间和会话事件。

备份只在本机生成，不上传到网络。导出前服务端和主进程都会清理 `password`、token、secret、authorization、credential、cookie、private key 和 API key 等敏感字段。认证 access token、refresh token 不属于备份内容。

导出的文件可以作为人工归档或后续迁移的输入。当前版本只提供导出和单会话 JSON 查看，不提供自动导入覆盖；这样不会在误选文件时覆盖当前会话历史。备份文档带有 `schemaVersion`，后续变更应通过版本迁移处理。

## 验证内容

- 没有登录凭据时 `/backup` 返回 `401`。
- 会话 metadata 和事件中的敏感字段会被递归删除。
- 重复会话 ID、错误时间戳、错误产品和错误 schema 会被拒绝。
- 主进程只向 renderer 返回经过 schema 解析的备份文档。
