// ============================================================================
// testing-write-boundary.ts — testing 期写入边界 prompt 文案（plan d8c5f3a7 v23 F5/D7）
// ----------------------------------------------------------------------------
// v23 收敛：本模块只剩**静态 prompt 文案**——把"哪里能写、哪里不能写"在 invoke 前讲清楚。
// 机器判定不在这里：runner 通过通用 phase write boundary 做 agent invoke 前后哈希快照；
// 违规会作废本 invocation 证据、保留字节为未受信输入，并自动回退唯一 owner 重验重签。
// 旧的六分区 classifyWritePath 机器分类器已删：它建在 git status 上，而 goal-runs/、
// reports/* 本就在 canonical gitignore、docs_committed:false 宿主 doc 域整体不进 git——
// 在真实宿主上半盲（v22 推倒根因之一）。
// ============================================================================

// M5A §4.3：逻辑 featureId → 物理相对路径唯一 SSOT（边界声明必须与机器校验路径同源）
import { featureRelativePath } from './feature-identity';

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
  // M5A：边界声明使用物理 Feature 路径（CU=<blueprint_id>/<change_unit_id>），
  // 与机器快照/校验路径逐字节同源（P2 tasks 8.7 boundary text 断言）。
  const featureRel = toPosix(featureRelativePath(cfg.feature));
  return [
    '**Write boundary for this phase — declared set matches what the machine actually checks:**',
    `- WRITABLE: \`${featuresDir}/${featureRel}/testing/**\` and \`${featuresDir}/${featureRel}/device-testing/**\` (test plan / report / screenshots / traces / diagnostics), and build output dirs.`,
    `- FORBIDDEN (pre/post snapshot; violation = evidence discarded, gate skipped, bytes preserved as untrusted input, automatic backtrack to the unique owner for full revalidation) — product source: ${cfg.productLayerDirs.map(d => `\`${toPosix(d)}/**\``).join(', ') || '(none declared)'}. Not even to add \`.id()\` test anchors: record the missing anchor in that screen's \`must_fix\` — the runner backtracks to coding to implement it.`,
    '- FORBIDDEN (same snapshot check) — requirement SSOT: `acceptance.yaml`, `contracts.yaml`, `ui-spec.yaml`, `spec.md`, `plan.md`, `use-cases.yaml`; and root build config: `build-profile.json5`, `oh-package.json5`, `hvigorfile.ts`, `AppScope/`. Editing an owner artifact invalidates its trusted closure and downstream evidence; the runner returns to that owner rather than accepting the downstream edit. If acceptance criteria look wrong, record the finding in the testing output so spec can re-evaluate it.',
    '- Runner-owned, read-only by convention (NOT snapshot-covered, no machine protection here — the runner itself writes to it; you still have zero reason to touch it): `goal-runs/**` run manifests/events.',
  ];
}
