# Tasks: Verification Matrix

## 1. Config 与 policy

- [ ] config template + schema 增 `evidence_profile: strict|balanced`（field_notes 说明；minimal 非法值）
- [ ] C0 `resolveEvidencePolicy` 接入矩阵求解（headless/goal 强制 strict；balanced 保留集 config 可覆写）
- [ ] 红线清单落 spec + 单测锁死（矩阵输出不含红线开关）

## 2. check-receipt policy 化

- [ ] 五个硬必需块（:333/:341/:365/:402/:551）按 policy 分派；optional 缺失仅 WARN
- [ ] lite feature：exit 0 + 顶层 `not_applicable` 机读标注
- [ ] receipt 模板按 policy 分节（strict 全填；off 项标 skipped_by_policy 语义）

## 3. snapshot 与 closure

- [ ] `evidence_policy_snapshot` 两层契约（policy + validation_status）写入 receipt frontmatter 与 `.current-phase.json`
- [ ] harness-runner closure 三态（receipt_passed / closed_by_exit_report / open）+ next_step 按矩阵
- [ ] Resume Gate 对 not_applicable 走 lite 闭环判据
- [ ] Stop hook 消费 snapshot（缺省 full+strict 解释旧 state）

## 4. Fixtures 与 Verify

- [ ] 矩阵各象限夹具（full×balanced / headless 强制 strict / lite not_applicable / 旧 state 兼容 / optional+missing WARN）
- [ ] `cd harness && npm test` 全绿（缺省 strict 路径零回归）
- [ ] `npm run openspec:validate` + `npm run release:verify`
