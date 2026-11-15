# 本地 SBOM

仓库使用 `package-lock.json` 生成 CycloneDX 1.5 JSON SBOM。组件版本、license、integrity 和 npm 依赖关系来自 lockfile，不访问注册表；来源提交写入 `metadata.properties.sourceRevision`。

生成仓库级 SBOM：

```bash
npm run sbom
```

默认输出为 `dist/interviewcoder-local-rebuild.sbom.cdx.json`。`npm run build:linux` 会把同一份内容写入 bundle 根目录的 `sbom.cdx.json`，`check:linux-bundle` 会验证 CycloneDX 格式、产品/版本、来源提交和清单一致性。Debian 包复验会再次执行 bundle checker。

SBOM 序列号由内容哈希派生，同一份 lockfile、应用版本和来源提交会得到稳定结果。当前 SBOM 是依赖透明度和发布审计材料，不等同于代码签名；生产发布仍需在受控环境用组织密钥签署 bundle、Debian 包和更新 manifest。
