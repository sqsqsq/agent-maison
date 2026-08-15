// ============================================================================
// testing-write-boundary.ts — testing 期写入边界 prompt 文案（plan d8c5f3a7 v23 F5/D7）
// ----------------------------------------------------------------------------
// v23 收敛：本模块只剩**静态 prompt 文案**——把"哪里能写、哪里不能写"在 invoke 前讲清楚。
// 机器判定不在这里：runner 用 fs 递归哈希快照（product-source-snapshot.ts，三集合=产品层+
// feature SSOT+根构建配置）做 invoke 前后对比，违规即 run 终止态（halt + 拒 resume）。
// 旧的六分区 classifyWritePath 机器分类器已删：它建在 git status 上，而 goal-runs/、
// reports/* 本就在 canonical gitignore、docs_committed:false 宿主 doc 域整体不进 git——
// 在真实宿主上半盲（v22 推倒根因之一）。
// ============================================================================

export interface WriteBoundaryConfig {
  /** 产品源码层目录（architecture.outer_layers） */
  productLayerDirs: readonly string[];
  /** features_dir 相对路径（缺省 doc/features） */
  featuresDirRel?: string;
  /** 当前 feature */
  feature: string;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/** 生成注入 testing prompt 的边界说明（与 fs 快照的保护范围同口径） */
export function renderWriteBoundaryGuidance(cfg: WriteBoundaryConfig): string[] {
  const featuresDir = toPosix(cfg.featuresDirRel ?? 'doc/features');
  return [
    '**Write boundary for this phase — declared set matches what the machine actually checks:**',
    `- WRITABLE: \`${featuresDir}/${cfg.feature}/testing/**\` and \`${featuresDir}/${cfg.feature}/device-testing/**\` (test plan / report / screenshots / traces / diagnostics), and build output dirs.`,
    `- FORBIDDEN (pre/post snapshot; violation = RUN-TERMINATING: evidence discarded, gate skipped, run halts, --resume refused, your changes left in place for human inspection) — product source: ${cfg.productLayerDirs.map(d => `\`${toPosix(d)}/**\``).join(', ') || '(none declared)'}. Not even to add \`.id()\` test anchors: record the missing anchor in that screen's \`must_fix\` — the runner backtracks to coding to implement it.`,
    '- FORBIDDEN (same snapshot check) — requirement SSOT: `acceptance.yaml`, `contracts.yaml`, `ui-spec.yaml`, `spec.md`, `plan.md`, `use-cases.yaml`; and root build config: `build-profile.json5`, `oh-package.json5`, `hvigorfile.ts`, `AppScope/`. Editing SSOT invalidates the upstream evidence chain of spec/plan/coding/review at once (that is exactly how the 2026-07-24 run deadlocked). If acceptance criteria look wrong, note it in your test report for humans.',
    '- Runner-owned, read-only by convention (NOT snapshot-covered, no machine protection here — the runner itself writes to it; you still have zero reason to touch it): `goal-runs/**` run manifests/events.',
  ];
}
