# Tasks: hmos-app-hsp-module-format

## 1. Profile SSOT & harness

- [x] 1.1 `profile.yaml` 增加 HSP
- [x] 1.2 `isLibraryFormat` + har-only 检查替换
- [x] 1.3 catalog/coding overlay 描述同步

## 2. Skills & docs

- [x] 2.1 Skill 0 infer-module-card / addendum / template
- [x] 2.2 Skill 2 design overlay / addendum / template
- [x] 2.3 Skill 3 coding addendum / templates / reference / verify overlay
- [x] 2.4 Skill 4 review + runbook + test-plan-template
- [x] 2.5 profile-schema + atomic-service-roadmap + types.ts 注释

## 3. Verify

- [x] 3.1 单测 + catalog/coding 集成夹具
- [x] 3.2 `cd harness && npm test` 全 PASS
- [x] 3.3 `npm run openspec:validate`（change 通过；spec/harness-gates 既有失败未由本变更引入）
