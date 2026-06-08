# `generic` profile · Skill 跳板

文档型 / 非端侧宿主工程：**不假定** ArkTS、hvigor 或 Hypium。

- 本会禁用 `coding` / `ut` / `testing` 阶段脚本 harness（见 `profile.yaml > phases_disabled`）。
- Skill 主体的流程骨架仍以 `framework/skills/*/SKILL.md` 为准；若需在纯文档流程中加条款，请在 `framework/profiles/generic/skills/<n>/` 下增补 `profile-addendum.md`，并在对应 SKILL 「Step 0」中指向该路径（可参考 `hmos-app` profile 写法）。
- **`coding` / `business-ut`**：已提供 `profile-addendum.md`，说明阶段禁用与非 ArkTS 宿主的阅读方式。
- **Harness 回归 fixture**：[`harness/tests/fixtures/`](../harness/tests/fixtures)（如 `profile_generic/coding_phase_disabled`），由 [`run-tests.ts`](../../../harness/tests/run-tests.ts) 与 hmos-app profile 合并扫描。
