# SBOM 与发布清单验证 — 2026-11-15

本阶段新增 `tools/generate-sbom.cjs`、`npm run sbom` 和 bundle 内 `sbom.cdx.json`。SBOM 使用 CycloneDX 1.5，组件来自 `package-lock.json`，来源提交来自 Git HEAD。

## 已验证

- npm lockfile 中没有重复 `name` 字段时，生成器会从 `node_modules/...` 路径推导包名。
- SBOM 序列号由内容哈希生成，同样输入可重复得到相同 JSON。
- 根应用和每个 npm 组件都有 `bom-ref`/PURL，依赖关系指向已列出的组件。
- bundle checker 拒绝缺失 SBOM、格式错误、产品/版本不一致或 sourceRevision 不一致的产物。
- Debian checker 会先解包，再执行包含 SBOM 校验的 bundle checker。

## 自动化结果

- SBOM 定向测试：2/2 通过。
- bundle checker 与 Debian 包测试：通过。
- 实际生成的 SBOM：71 个 npm 组件。
- 实际 Linux bundle：109 个清单文件，SHA-256 校验通过。

## 未完成边界

SBOM 不替代代码签名。生产 GPG key、Debian 签名和跨平台签名仍需在发布环境配置，仓库不保存私钥。
