## 1. OpenSpec

- [x] 1.1 新增 init-orchestration delta spec
- [x] 1.2 `npm run openspec:validate` 通过

## 2. Harness

- [x] 2.1 decision schema + assertDecisionStructure 分层校验
- [x] 2.2 preflight project materialized_adapters 必填 + context 交叉校验
- [x] 2.3 执行链 decision SSOT + context root 加固 + satisfied 闭包豁免
- [x] 2.4 emit-staging-template 无 context 文件容错
- [x] 2.5 单测覆盖

## 3. 文档

- [x] 3.1 framework-init + staging 示例 + framework-init 命令
- [x] 3.2 `cd harness && npm test` 全 PASS
