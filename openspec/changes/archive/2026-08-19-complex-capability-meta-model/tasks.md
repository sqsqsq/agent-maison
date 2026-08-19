# Tasks: Complex Capability Meta-Model

> 时序纪律：§1 随评审定稿即可完成；`Br_release_3.0.0` 已从 `90a4df90` 隔离，§2 起
> 须先完成该 cutoff 的快速事实调和（plan e7b3a9d4 t2 门）。3.0.0 正式发布继续约束
> 3.1.0 发布顺序，不阻塞本 change 实施。

## 1. Spec 契约定稿

- [x] 待决点 A/B 裁决（均 FAIL、无例外）与声明位置唯一化，已回填 spec delta / design / 总纲 §12 / AGENTS.md
- [x] 用户/codex 复核修订版，change 定稿（08-13 三轮评审收口）
- [x] provider-seam 裁决增量回填（R7–R10；08-14 三轮：seam 增量 → 五项返修 → 实质候选口径统一），窄 review 收口

## 2. 扫描器实现

- [x] plan-version-lib：受限字段解析——行内 `[]`、非空 block-list、折叠/字面块正文判空（CRLF 安全），仅解析 frontmatter
- [x] check-plan-version：`checkParentGoalDeclarations` 接入同一遍历，default/release 双模式生效，**位于 future/allowlist 提前返回之前**（D8）
- [x] goal 文件定位（frontmatter id 唯一匹配，零/多份均报错）与 §0.1 表格首列目标 id 集提取（fail-closed）
- [x] 字段级诊断文案（沿用 `{file, reason}` 通道，逐字段可定位）

## 3. 测试

- [x] `scripts/tests/check-parent-goal.unit.mjs` 九类用例：合法声明 / goal 零匹配或多匹配 / advances 非法 id / relation・layer 枚举非法 / 必填字段缺失（含 requires/provides 缺省）/ parallel_authority_added=true / 未声明零告警 / **顺延 plan 非法声明在当前窗口 FAIL** / 行内 `[]` 与折叠块解析
- [x] 全仓真实 plan 回归：动态扫描全部声明了 `parent_goal` 的 plan 必须通过（不写死数量），其余存量 plan 零新增告警
- [x] 纳入 `release:check-plans-test`（`node --test scripts/tests/*.unit.mjs` 自动拾取）

## 4. 收编

- [x] 总纲 §12 与 AGENTS.md：机器声明位置唯一化为 frontmatter（评审期完成，纯文档裁定）
- [x] AGENTS.md「父目标对齐声明（人工核对）」节改为指向机器校验与本 capability spec，保留"未声明不强制挂靠"口径（实施落地时）

## 5. Verify

- [ ] `node scripts/check-plan-version.mjs` 与 `--release` 双模式 PASS（P0 未执行 release 模式整仓检查；由总计划 m5/MG 在批次收尾承担，执行前不宣称通过）
- [x] `npm run release:check-plans-test` 全绿
- [x] `npm run openspec:validate` 全绿
- [ ] `npm run release:verify`（P0 未执行 release；由总计划 m5/MG 在批次收尾承担，执行前不宣称通过）
