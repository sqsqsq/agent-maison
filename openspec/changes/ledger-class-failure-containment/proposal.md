# ledger-class-failure-containment

## Why

宿主 bc-openCard-2 三轮运行（09-18 / 09-20 / 09-21）显示：约一半的墙不是产品真值问题，而是**账本与形状**（绑定、指纹、ID 同名、字段形状、来源追溯、新鲜度）被按产品缺陷处理。本 change 只收口这一类失败的**传播范围**，不改任何一档（产品真值）判据。

两条具体事实：

- 前序 change 让视觉证据不可消费时把责任方（`evidence_block_owner` → `repair_owner`）保真送到 `testing_channel_evidence_obligation` 与 summary blockers。好处是归因不再兜底 `code_regression`；副作用是一个**参考图 id 命名不一致**（宿主 `spec/ui-spec.yaml` 的 `*_ref` 与 `spec/spec.md` 的 `authoritative_refs.id` 四屏全不对）现在会生成 `category=spec` 的 repair candidate，并通过既有 `backtrack_to_phase` 把 spec→plan→coding→review→ut→testing 整链作废重走。账本类缺口没有上游产物需要作废——它要的是对齐或披露。
- `shouldHaltNoProgress` 对 `code_regression` 附加 `relevantEvidenceKnown === true`（相关集合未知时不得用空快照冒充"无改动"）。这个保护是对的，但它顺带选的**出路**（退回有界重试）在实测里 8 次同签名零进展（`a70eb7` i12/i13/i14、`f829b8` 三次 + 一次 resume），而且终态理由 `content_retry_exhausted` 把一个账本问题描述成了内容问题。

## What Changes

- **第二档失败不得产生回退交接候选，因而不触发 `phase_backtrack_requested`、也不扩大回退目标。** 档位读数不新立表：直接读既有 `repair_owner`（由 `evidence_block_owner` 提上来），非 `coding` 即账本/形状档。落点在**候选生产点**（`collectPhaseRepairCandidates` 的 testing 分支），因为 assess 读的是盘上 summary 的 `repair_candidates`——只在 runner 内存里过滤挡不住它的责任阶段推荐。披露原样保留（`repair_owner` / `affected_files` / `spec_capture_gap` 归因）。**失效范围算法 `resolveInvalidatablePhases` 一字未动**。一档（已执行断言失配、视觉缺陷）候选、回退与重验原样保留，混合轮也只按一档候选定目标。
- **相关集合未知或为空时走既有 `no_progress_guard` 停下交回**，理由写「相关目标未知」，不再烧满 `max_retries_per_phase` 再判 `content_retry_exhausted`。`relevantEvidenceKnown` 判据本身一字未改；空集只说明"没解析出目标"，不得被说成"证明了没修"。不新增 halt reason、不动 adjudication 注册表。
- **模式误用不再被说成时效问题**：detached run 被传 attended 专用 `--goal-*` 参数时，`validateAttendedGoalContext` 报「模式不匹配」并点名不该传的参数；身份判据（越权接管保护）一个字不改，真正的 session 租约过期仍报租约。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `goal-runner`：证据不可消费不再产生回退交接候选（回退资格与回退目标同时收口）；无相关目标时的停止出路与其 events 可见性；attended 上下文的模式误用话术。

## Impact

- 影响 runtime：`harness/scripts/utils/repair-candidates.ts`（testing 分支删除 evidence-block 的产候选路径）、`harness/scripts/utils/goal-failure-classifier.ts`（`shouldHaltNoProgress` 的未知集合出路）、`harness/scripts/goal-phase-runtime.ts`（no-progress 指引 + verdict 之后补发 `phase_halt`）、`harness/scripts/utils/attended-goal-context.ts`（模式误用话术）。
- 影响指引：`skills/project/goal-mode/SKILL.md`、`skills/reference/goal-mode-operations.md`、`agents/claude/templates/agents/phase-executor.md`（按模式给出可直接执行的 harness 命令）。
- 不改宿主、不改第一档判据、不改 `resolveInvalidatablePhases`、不新增 check id / halt reason / 评分 / 豁免 / 次数闸。
- 已知上限：一个小的产品修复仍会让 review 与 UT 全量重跑（收窄它需要"本次改动影响哪些验证面"的真实判据，本 change 不发明）。
