// ============================================================================
// spec 阶段脚本 Harness — check-spec.ts
// ============================================================================
// 读取 framework/specs/phase-rules/spec-rules.yaml + doc/features/{feature}/spec.md
// 执行确定性的结构 / 追溯验证。
//
// 检查项（与 spec-rules.yaml 对应）：
//   Structure:     required_chapters, feature_table_format, priority_values,
//                  at_least_one_p0, acceptance_criteria_format, mermaid_flowchart,
//                  exception_table_format, minimum_exception_scenarios,
//                  nfr_quantified, page_description_completeness, metadata_header
//   Traceability:  feature_to_acceptance, acceptance_to_feature
//
// 语义级检查由 AI Harness (verify-spec.md) 完成，不在本脚本范围内。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  PhaseChecker,
  CheckContext,
  CheckResult,
} from './utils/types';
import { SpecLoader } from './utils/spec-loader';
import {
  extractHeadings,
  getSectionContent,
  getSubsectionHeadings,
  extractTables,
  extractCodeBlocks,
  extractMetadata,
  tableHasColumns,
  getColumnValues,
} from './utils/markdown-parser';
import * as YAML from 'yaml';
import { parseScope, describeScopeError } from './utils/scope-parser';
import {
  loadCatalog,
  describeCatalogError,
  allModuleNames,
} from './utils/catalog-parser';
import {
  loadGlossary,
  describeGlossaryError,
  lookupTerm,
} from './utils/glossary-parser';
import { isSpecVisualHandoffSkipped, dispatchSpecVisualHandoff, isSpecUiSpecSkipped, dispatchSpecUiSpec, isSpecAssetAcquisitionSkipped, dispatchSpecAssetAcquisition } from '../capability-registry';
import { relCatalog, relGlossary, relFeatureArtifact, relFeatureFile, loadFrameworkConfig, featureFilePath } from '../config';
import { featureArtifactLayoutWarnings } from './utils/feature-artifact-legacy';
import {
  collectRequirementIntentText,
  dereferenceRequirementDocs,
  detectFidelityIntent,
  isHumanSignedDeferral,
  isHumanVerified,
  isPixel1to1,
  loadSpecMarkdown,
  parseFidelityDeferrals,
  parseFidelityTargetFromHandoffDoc,
} from './utils/fidelity-shared';
import { parseVisualHandoffYamlRoot, loadUiSpecFile, uiSpecAbsPath, type UiSpecAsset } from './utils/ui-spec-shared';
import { loadRefElementsFile, refElementsAbsPath } from './utils/fidelity-shared';
import { scanUiSpecCounterevidence, type RefElementLite } from './utils/vision-counterevidence';
import { verifyVlSigningChain } from './utils/critic-receipt-producer';
import { computeGateFingerprint } from './utils/gate-fingerprint';
import {
  appendArtifactAttestation,
  appendPolicyDowngrade,
  computeCurrentBindingContext,
  hasActiveDowngradeForArtifactHash,
  readLatestRawAttestation,
  resolveEffectiveVisionContext,
  sha256File,
} from './utils/effective-vision-context';
import {
  defaultTrustRegistryPath,
  validateConfirmationReceiptFile,
} from './utils/confirmation-receipt';
import { isGoalOrchestrationEnv } from './utils/phase-state';
import { evaluateAcceptanceFlowStructure, evaluateFlowContract } from './utils/p0-semantic-gates';
import { checkFactsArtifact } from './utils/context-facts';
import { runAcceptanceYamlStructureChecks } from './utils/check-acceptance';
export { dispatchSpecVisualHandoff as checkVisualHandoff };
export { dispatchSpecUiSpec as checkUiSpecStructureBundle };

// --------------------------------------------------------------------------
// blind-visual-hardening d4：fidelity 意图三态覆盖扩面（逐阶段驱动路径前置闸）
// --------------------------------------------------------------------------

/**
 * goal-fakepass t6 的三态检测只在 goal preflight 生效——bc-openCard 二轮宿主走
 * CodeAgentCLI 逐阶段驱动，intent 检测从未运行，缺省 semantic_layout 全部 pixel 硬门禁
 * 未激活。本 check 用**同源函数**（collectRequirementIntentText + detectFidelityIntent，
 * 勿 fork）把三态闸覆盖到 phase-driven 路径：
 *   强意图 + 盲 → BLOCKER（DEFERRED_CAPABILITY_MISSING 语义：不许静默降档继续跑），
 *     唯一放行=有效 fidelity_downgrade receipt（绑定需求 SSOT 哈希）→ 降 WARN（不洗白，
 *     债务/封顶语义由 quality_axes/completion 链承担）；
 *   含混意图 + 盲 + 有参考图 → BLOCKER（await_human_fidelity_tier：交互式走 vision.blind_tier
 *     告知确认——一次需求一次确认，成本属设计内，勿开旁路）；
 *   none / 非盲 → PASS。
 * 落盘 spec/reports/fidelity-intent.json：reference_intent{value,source}/desired/effective/
 * downgrade_receipt（desired 永不被自动改写——ratchet 回升锚点）。
 */
/**
 * 意图文本收集（含 phase-driven 回退）：collectRequirementIntentText 只读 goal-run
 * manifest——逐阶段驱动路径（无 goal-runs）恒空串，正是覆盖缺口的实体。回退源：
 * feature 根目录需求文档（*.md/*.txt，产物投影 visual-debt.md 除外）+ spec.md，
 * 各自过 dereferenceRequirementDocs（同源解引用，勿 fork）。
 */
export function collectIntentTextWithPhaseFallback(
  projectRoot: string,
  feature: string,
  featuresDirRel: string,
): string {
  const goalText = collectRequirementIntentText(projectRoot, feature, featuresDirRel);
  if (goalText.trim()) return goalText;
  const parts: string[] = [];
  const featRoot = path.join(projectRoot, featuresDirRel, feature);
  const EXCLUDE = new Set(['visual-debt.md']);
  try {
    if (fs.existsSync(featRoot)) {
      for (const ent of fs.readdirSync(featRoot, { withFileTypes: true })) {
        if (!ent.isFile() || EXCLUDE.has(ent.name) || !/\.(md|txt)$/i.test(ent.name)) continue;
        try {
          parts.push(fs.readFileSync(path.join(featRoot, ent.name), 'utf-8'));
        } catch { /* 单文件失败跳过 */ }
      }
    }
  } catch { /* ignore */ }
  const specMd = loadSpecMarkdown(projectRoot, feature);
  if (specMd) parts.push(specMd);
  if (parts.length === 0) return '';
  return parts
    .map(p => dereferenceRequirementDocs(projectRoot, p, { featuresDirRel }).combined)
    .join('\n\n');
}

export function checkFidelityCapabilityPregate(ctx: CheckContext): CheckResult[] {
  const id = 'fidelity_capability_pregate';
  const description = 'fidelity 意图三态前置闸（强意图+盲→DEFERRED；含混+参考图→await_human；禁静默降档）';
  const featuresDirRel = (loadFrameworkConfig(ctx.projectRoot).paths?.features_dir ?? 'doc/features').replace(/\\/g, '/');
  const reqText = collectIntentTextWithPhaseFallback(ctx.projectRoot, ctx.feature, featuresDirRel);
  const intent = detectFidelityIntent(reqText);
  const blind = ctx.adapterImageInput === 'none';

  // 参考图存在性（含混意图的确认触发条件）：ux-reference 或 visual_handoff authoritative_refs
  const uxDir = featureFilePath(ctx.projectRoot, ctx.feature, 'ux-reference');
  let hasRefs = false;
  try {
    hasRefs = fs.existsSync(uxDir) && fs.readdirSync(uxDir).some(f => /\.(jpe?g|png|webp|bmp)$/i.test(f));
  } catch { /* ignore */ }
  if (!hasRefs) {
    const specMd = loadSpecMarkdown(ctx.projectRoot, ctx.feature);
    hasRefs = Boolean(specMd && /authoritative_refs:/.test(specMd));
  }

  // downgrade receipt：绑定需求 SSOT 规范化哈希（换需求即 stale）
  const receiptPath = featureFilePath(ctx.projectRoot, ctx.feature, path.join('spec', 'fidelity-downgrade.receipt.json'));
  let downgradeAuthorized = false;
  if (fs.existsSync(receiptPath)) {
    const reqSha = crypto.createHash('sha256').update((reqText ?? '').trim(), 'utf-8').digest('hex');
    const v = validateConfirmationReceiptFile(receiptPath, defaultTrustRegistryPath(ctx.projectRoot), {
      action: 'fidelity_downgrade',
      feature: ctx.feature,
      object_hash: reqSha,
    });
    downgradeAuthorized = v.valid;
  }

  const referenceIntent =
    intent === 'strong_pixel' ? 'exact' : intent === 'ambiguous' ? 'unknown' : hasRefs ? 'layout' : 'inspiration';
  const desired = intent === 'strong_pixel' ? 'pixel_1to1' : 'semantic_layout';
  const effective =
    !blind ? desired
    : intent === 'strong_pixel' ? (downgradeAuthorized ? 'semantic_layout' : 'deferred')
    : intent === 'ambiguous' && hasRefs ? (downgradeAuthorized ? 'semantic_layout' : 'deferred')
    : 'semantic_layout';

  // 落盘（harness-owned；desired 永不被改写）
  try {
    const outPath = featureFilePath(ctx.projectRoot, ctx.feature, path.join('spec', 'reports', 'fidelity-intent.json'));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify({
      schema_version: '1.0',
      reference_intent: { value: referenceIntent, source: 'inferred' },
      desired_fidelity: desired,
      effective_fidelity: effective,
      downgrade_receipt: downgradeAuthorized
        ? relFeatureFile(ctx.projectRoot, ctx.feature, path.join('spec', 'fidelity-downgrade.receipt.json'))
        : null,
    }, null, 2)}\n`, 'utf-8');
  } catch { /* 落盘失败不改变裁决 */ }

  if (!blind || intent === 'none' || (intent === 'ambiguous' && !hasRefs)) {
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'PASS',
      details: `intent=${intent}，blind=${blind}，refs=${hasRefs}——无需前置闸（effective=${effective}）。`,
    }];
  }
  if (downgradeAuthorized) {
    return [{
      id, category: 'structure', description,
      severity: 'MAJOR', status: 'WARN',
      details:
        `intent=${intent} + 盲档：已消费有效 fidelity_downgrade receipt（desired=${desired} 保留，` +
        `effective=semantic_layout）——降级不洗白，视觉债务/completion 封顶语义照常生效。`,
    }];
  }
  return [{
    id, category: 'structure', description,
    severity: 'BLOCKER', status: 'FAIL',
    details: [
      intent === 'strong_pixel'
        ? '【DEFERRED_CAPABILITY_MISSING】需求为强 pixel 意图而当前模型无视觉能力——不得静默以 semantic_layout 继续跑'
        : '【await_human_fidelity_tier】需求含"与截图一致"类含混意图且存在参考图——盲档下须人工定档',
      `（bc-openCard 二轮：逐阶段路径漏检 intent，缺省 semantic_layout 全部 pixel 硬门禁未激活）。`,
      `reference_intent=${referenceIntent}，desired=${desired}（已落盘，不被改写）。`,
    ].join('\n'),
    suggestion:
      '出路三选一：①换有视觉能力的模型/配置 vision.image_input_override 后重跑；' +
      '②真人经带外体系签发 fidelity_downgrade receipt（绑定需求 SSOT 哈希）落 ' +
      'spec/fidelity-downgrade.receipt.json 后重跑（交互式对应 vision.blind_tier 确认动线）；' +
      '③修改需求明确接受布局级还原。',
    failure_kind: intent === 'strong_pixel' ? 'capability_missing_strong_intent' : 'await_human_fidelity_tier',
    blocking_class: 'await_human_fidelity_tier',
  }];
}

// --------------------------------------------------------------------------
// blind-visual-hardening d5/P1-F：盲档素材问人清单（素材是输入不是推断）
// --------------------------------------------------------------------------

/**
 * 盲档下 brand_logo/illustration 类素材无法可信裁剪时，生成 asset-request.md
 * （逐项：用途/建议尺寸/放置路径/当前占位形态）。headless 不阻塞（按 role 占位物化 +
 * 计入视觉债务，release 语义由 P0-A/P0-D 约束）；交互式据此走 registry 确认
 * （提供素材/接受占位/逐项 defer——文案含 ≥4/5 首跑预期）。
 * 用户补素材后重跑 spec harness 自动吸收：resolved_path 存在且过 role-aware sanity →
 * 债务三态 source=VERIFIED，binding/render 由 coding/testing 检查驱动闭账（防假清偿）。
 */
export function maybeWriteAssetRequest(ctx: CheckContext): void {
  if (ctx.adapterImageInput !== 'none') return;
  const uiDoc = loadUiSpecFile(uiSpecAbsPath(ctx.projectRoot, ctx.feature));
  const assets = (uiDoc?.assets ?? []) as UiSpecAsset[];
  if (assets.length === 0) return;
  const items = assets.filter(a => {
    if (!a?.key) return false;
    const roleGuess = /(logo|brand)/i.test(a.key) ? 'brand_logo' : /(ill|guide|promo|banner|face)/i.test(a.key) ? 'illustration' : null;
    if (!roleGuess) return false;
    // 已有可用产物（resolved_path 存在）视为已供给，不再催
    const resolved = a.resolved_path && fs.existsSync(path.join(ctx.projectRoot, a.resolved_path));
    return !resolved;
  });
  if (items.length === 0) return;
  const outPath = featureFilePath(ctx.projectRoot, ctx.feature, path.join('spec', 'asset-request.md'));
  const lines = [
    `# 素材需求清单 — ${ctx.feature}`,
    '',
    '> 盲档（模型无视觉能力）下品牌/插画类素材无法可信获取——素材是**输入**不是推断。',
    '> 三个出路：①按下表放置路径提供素材后重跑 spec harness（自动吸收：过 role sanity 即',
    '> source=VERIFIED，源码绑定/设备渲染两态由 coding/testing 检查闭账——文件放了但 UI 仍引用',
    '> 旧占位不会假清偿）；②接受可见语义占位交付（brand-critical 占位时 release 保持 BLOCKED，',
    '> 债务走人工验收 receipt 显式接受——盲宿主首轮预期走此路，rubric 冻结 ≥4/5）；③逐项 defer。',
    '',
    '| 素材 key | 用途推断 | 建议尺寸 | 放置路径 | 当前占位形态 |',
    '|----------|----------|----------|----------|--------------|',
    ...items.map(a => {
      const role = /(logo|brand)/i.test(a.key) ? 'brand_logo' : 'illustration';
      const size = role === 'brand_logo' ? '96×96（正方形，透明底 png/svg）' : '≥320×200（png/svg）';
      const drop = a.resolved_path ?? `doc/features/${ctx.feature}/spec/assets/${a.key}.png`;
      const ph = role === 'brand_logo' ? 'text_avatar（首字色块）' : 'illustration_frame（中性占位框）';
      return `| ${a.key} | ${role} | ${size} | ${drop} | ${ph} |`;
    }),
    '',
  ];
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
  } catch { /* best-effort 清单，失败不阻断 */ }
}

// --------------------------------------------------------------------------
// blind-visual-hardening d2：盲档 crop 左移禁令
// --------------------------------------------------------------------------

/**
 * 禁的是盲模型**执行或自证** crop，不禁消费已可信完成的 crop 产物（codex 三轮③收窄）。
 * effective_image_input=none ∧ acquisition=crop 时，须同时满足：
 *   c1 resolved_path 存在；
 *   c2 provenance 可验证（三来源之一，design §1.6）：
 *      verified_artifact = asset-crop-validation.json 该 key verdict=verified；
 *      human_receipt    = spec/crop-provenance/<key>.receipt.json 有效 confirmation receipt；
 *      external_tool    = asset.crop_provenance {kind:external_tool, tool, source_sha256} 结构记录
 *                         （诚实边界：记录存在性确定性校验，工具真实性不做密码学验证）；
 *   c3 human_crop_confirmed=true 且 crop_confirmed_by 为可信真人身份
 *      （isHumanVerified：非空/非自动化/非 user_requirement 哨兵——授权哨兵≠条目级验真，P0-6）。
 * 任一 crop 资产不满足 → BLOCKER FAIL；正确出路=placeholder:true+asset-manifest 或 asset-request 问人。
 * 事故锚：bc-openCard 二轮 22 项 crop 全部 human_crop_confirmed:false 且零验真，物化空白占位。
 */
/** feature 参考图集哈希（external_tool provenance 的成员集）：feature 目录下图片文件递归
 * （含 ux-reference/需求截图子目录），上限 64 文件 / 单文件 ≤32MB——防自填 sha 绕过。 */
export function collectFeatureReferenceImageHashes(projectRoot: string, feature: string): Set<string> {
  const out = new Set<string>();
  const featRoot = featureFilePath(projectRoot, feature, '.');
  const IMAGE_RE = /\.(jpe?g|png|webp|bmp)$/i;
  const MAX_FILES = 64;
  const MAX_BYTES = 32 * 1024 * 1024;
  const walk = (dir: string): void => {
    if (out.size >= MAX_FILES || !fs.existsSync(dir)) return;
    let ents: fs.Dirent[];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
      if (out.size >= MAX_FILES) return;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'reports' || ent.name === 'goal-runs') continue; // 产物目录不算参考源
        walk(abs);
      } else if (ent.isFile() && IMAGE_RE.test(ent.name)) {
        try {
          if (fs.statSync(abs).size > MAX_BYTES) continue;
          out.add(crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex').toLowerCase());
        } catch { /* 单文件失败跳过 */ }
      }
    }
  };
  walk(path.resolve(featRoot));
  return out;
}

/**
 * visual-capability-truth S3：视觉产出确定性反证器。
 * contradicted（已证明矛盾）→ BLOCKER FAIL + attestation contradicted + blind-safe 策略降级；
 * evidence_gap（证据不足）→ MAJOR WARN + attestation unverified（reasons 前缀 evidence_gap:）
 * ——两态同样使 vl_multimodal 失效（fidelity gate 消费 attestation），审计措辞不得混淆；
 * heuristic → observe-only 计数落盘。
 */
export function checkVisionOutputCounterevidence(ctx: CheckContext): CheckResult[] {
  const id = 'vision_output_counterevidence';
  const description = '视觉产出反证器（U+FFFD/无映射/低置信升 UI——三态分立，attestation 落盘）';
  const uiSpecAbs = uiSpecAbsPath(ctx.projectRoot, ctx.feature);
  const uiDoc = loadUiSpecFile(uiSpecAbs);
  if (!uiDoc) return [];
  const refDoc = loadRefElementsFile(refElementsAbsPath(ctx.projectRoot, ctx.feature));
  const scan = scanUiSpecCounterevidence(
    uiDoc,
    (refDoc?.elements as RefElementLite[] | undefined) ?? null,
  );
  const uiSpecHash = sha256File(uiSpecAbs);
  const uiSpecRelP = path
    .relative(ctx.projectRoot, uiSpecAbs)
    .replace(/\\/g, '/');
  // attestation 落盘（append-only；同 hash 同 verdict 幂等跳过）
  // 五轮 review P0-1：vision 账本单写者（对齐 visual-rounds ledger 的 S5 纪律）——
  // goal 态 agent 自跑 harness 只**计算**反证结论（结果照常展示回喂），不写账本；
  // 只有 runner 直接 spawn 的 gate harness（MAISON_GOAL_GATE_HARNESS=1）或非 goal 交互态
  // 允许提交。agent 即便伪造该 env 直写，外层 runner 的 invoke 快照括号仍会检出并 halt。
  const ledgerWriteAllowed =
    !isGoalOrchestrationEnv() || process.env.MAISON_GOAL_GATE_HARNESS === '1';
  const persistAttestation = (
    verdict: 'contradicted' | 'unverified' | 'verified',
    reasons: string[],
    binding?: import('./utils/effective-vision-context').ArtifactAttestationRecord['binding'],
  ): void => {
    if (!uiSpecHash || !ledgerWriteAllowed) return;
    // 幂等判据含 verdict/reasons/**canonical binding**（五轮 P1：同 hash 新 run/invoke 重验
    // 时 binding 已变，不得跳写让账面保留旧签发身份）。
    const existing = readLatestRawAttestation(ctx.projectRoot, ctx.feature, uiSpecHash);
    if (
      existing &&
      existing.verdict === verdict &&
      existing.reasons.join('|') === reasons.join('|') &&
      JSON.stringify(existing.binding ?? null) === JSON.stringify(binding ?? null)
    ) return;
    appendArtifactAttestation(ctx.projectRoot, ctx.feature, {
      artifact_path: uiSpecRelP,
      artifact_hash: uiSpecHash,
      verdict,
      reasons,
      source: 'vision_output_counterevidence',
      ...(binding ? { binding } : {}),
    });
  };
  if (scan.contradicted.length > 0) {
    persistAttestation('contradicted', scan.contradicted.map(f => `${f.code}:${f.where}`));
    // blind-safe 策略降级（幂等：activeDowngrades 层去重靠 supersede 语义，此处按 hash 防重复行）
    if (ledgerWriteAllowed && uiSpecHash && !hasActiveDowngradeForHash(ctx.projectRoot, ctx.feature, uiSpecHash)) {
      appendPolicyDowngrade(ctx.projectRoot, ctx.feature, {
        reason: 'artifact_visual_attestation=contradicted（effective policy downgraded to blind-safe）',
        artifact_path: uiSpecRelP,
        artifact_hash: uiSpecHash,
        source: 'vision_output_counterevidence',
      });
    }
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'FAIL',
      details: [
        `【反证成立（contradicted）】视觉产出与确定性证据矛盾——本产物的视觉验证签名无效，`,
        `本 run 视觉策略保守降级 blind-safe（措辞注意：这是策略降级，不等于已证明模型无视觉能力）：`,
        ...scan.contradicted.slice(0, 8).map(f => `  - [${f.code}] ${f.where}：${f.detail}`),
        ...(scan.evidenceGap.length > 0 ? [`另有 ${scan.evidenceGap.length} 项证据缺口（evidence_gap，详见 WARN 明细）`] : []),
      ].join('\n'),
      suggestion:
        '修正 ui-spec 受污染文本（重新核对参考图/重采 OCR）→ 产物新 hash 重新走验证（verified attestation 自动解除该降级）；或走盲档地板交付。',
      affected_files: [uiSpecRelP],
    }];
  }
  if (scan.evidenceGap.length > 0) {
    persistAttestation('unverified', scan.evidenceGap.map(f => `evidence_gap:${f.code}:${f.where}`));
    // codex 实施 review P0-3b：evidence_gap 同样落 blind-safe 策略降级（S1 design §4：
    // 两态同样可安全降 blind-safe；措辞=缺证降级非证伪降级）
    if (ledgerWriteAllowed && uiSpecHash && !hasActiveDowngradeForHash(ctx.projectRoot, ctx.feature, uiSpecHash)) {
      appendPolicyDowngrade(ctx.projectRoot, ctx.feature, {
        reason: 'artifact_visual_attestation=evidence_gap（缺证降级 blind-safe——非证伪，补证后新 hash verified 自动解除）',
        artifact_path: uiSpecRelP,
        artifact_hash: uiSpecHash,
        source: 'vision_output_counterevidence',
      });
    }
    return [{
      id, category: 'structure', description,
      severity: 'MAJOR', status: 'WARN',
      details: [
        `【证据不足（evidence_gap）】${scan.evidenceGap.length} 项 UI 文本缺乏可信视觉证据——`,
        `不构成"已证伪"，但 vl_multimodal 签名不可采信（缺证 ≠ 证伪，审计分立）；本 run 视觉策略缺证降级 blind-safe：`,
        ...scan.evidenceGap.slice(0, 8).map(f => `  - [${f.code}] ${f.where}：${f.detail}`),
        ...(scan.heuristics.length > 0 ? [`observe-only 计数：${scan.heuristics.map(h => h.code).join(', ')}`] : []),
      ].join('\n'),
      suggestion: '为无映射文本补 source_ref/核对参考图；置信管线落盘后低置信项自动纳入判定。',
      affected_files: [uiSpecRelP],
    }];
  }
  // 三轮 review P0-3（收紧二轮）：文本互证（ui-spec vs ref-elements）两个文件都是 agent 产物，
  // 单靠 exact/substring 匹配仍是间接自签。verified 只在**正向 provenance + 终签链全绑定**时
  // 铸造：当前 run/精确 invoke 的 runner 事件锚回执（capability=canary 判卷证视觉能力 +
  // refs=结构化验读事件证读过当前参考图，逐张 hash 核对）；铸造行携带 binding（run/invoke/
  // refs hash/ref-elements hash/gate fingerprint）。盲模型同步两份文本 → 无 canary receipt →
  // 铸不出 verified、解除不了 blind-safe。
  if (scan.positive_provenance) {
    const chain = verifyVlSigningChain({ projectRoot: ctx.projectRoot, feature: ctx.feature });
    if (chain.ok) {
      // 四轮 review P1：binding 与消费端同源计算（computeCurrentBindingContext——resolver 验的
      // 就是这套值）；gate fingerprint 不可算 → **不铸 verified**（fail-closed，binding 必填）。
      // 幂等语义：旧 verified 行 binding 陈旧时 resolver 投影为 unverified → 与新铸 verified
      // 必然不等 → 落新行（幂等键实质含完整 binding 有效性）。
      const bindingCtx = computeCurrentBindingContext(
        ctx.projectRoot, ctx.feature, path.resolve(__dirname, '..', '..'),
      );
      if (!bindingCtx.gate_fingerprint) {
        persistAttestation('unverified', ['counterevidence_clean_unbound', 'gate_fingerprint_uncomputable']);
        return [{
          id, category: 'structure', description,
          severity: 'BLOCKER', status: 'PASS',
          details:
            `无确定性反证且终签链绑定，但 gate fingerprint 不可计算——verified 拒铸（binding 必填，fail-closed）；` +
            'attestation 记 unverified。排查 framework phase-rules 可读性后重跑。',
        }];
      }
      persistAttestation('verified', ['counterevidence_clean', 'provenance_mapped', 'signing_chain_bound'], {
        run_id: chain.runId!,
        invoke_id: chain.expectedInvoke!,
        ref_elements_sha256: bindingCtx.ref_elements_sha256,
        refs: bindingCtx.refs,
        gate_fingerprint: bindingCtx.gate_fingerprint,
      });
      return [{
        id, category: 'structure', description,
        severity: 'BLOCKER', status: 'PASS',
        details:
          `无确定性反证、正向 provenance 成立且终签链全绑定（texts=${scan.counters.texts_total} 全匹配；` +
          `refs=${bindingCtx.refs.length} 张 runner 事件锚验读）；verified attestation 已落盘（含 binding）。`,
      }];
    }
    persistAttestation('unverified', ['counterevidence_clean_unbound', `signing_chain:${chain.failures[0] ?? 'unknown'}`]);
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'PASS',
      details:
        `无确定性反证且文本正向匹配（texts=${scan.counters.texts_total}），但终签链未绑定` +
        `（${chain.failures.slice(0, 2).join('；')}）——文本互证不单独铸 verified（两份文件皆 agent 产物），` +
        'attestation 记 unverified；不解除既有降级。',
    }];
  }
  persistAttestation('unverified', ['counterevidence_clean_no_provenance']);
  return [{
    id, category: 'structure', description,
    severity: 'BLOCKER', status: 'PASS',
    details:
      `无确定性反证（texts=${scan.counters.texts_total}，单字符碎片=${scan.counters.single_char_fragments}` +
      `${scan.heuristics.length > 0 ? `；observe-only：${scan.heuristics.map(h => h.code).join(', ')}` : ''}），` +
      '但无正向 provenance 基础（非 OCR 工作流/文本未全部匹配参考）——attestation 记 unverified_clean，' +
      '不签 verified、不解除既有降级（解除须 runner supersede 或正向验证成立的新 hash verified）。',
  }];
}


// codex 实施 review 二轮附带修：旧判据 downgrade_reasons.includes('contradicted') 对
// evidence_gap 降级行永假 → 每次重跑重复追加同 hash 降级行（账面膨胀）；且 P0-4 后
// per-hash attestation 原因也会进 downgrade_reasons（无账本行也含 'contradicted' 字样，
// 会反向抑制真正的账本行落盘）。改为账本级 active 降级行按 hash 精确判定。
function hasActiveDowngradeForHash(projectRoot: string, feature: string, hash: string): boolean {
  return hasActiveDowngradeForArtifactHash(projectRoot, feature, hash);
}

export function checkBlindCropProhibition(ctx: CheckContext): CheckResult[] {
  const id = 'blind_crop_prohibition';
  const description = '盲档 crop 左移禁令（禁执行/自证裁剪；可信外部产物按 c1-c3 放行为消费态）';
  if (ctx.adapterImageInput !== 'none') {
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'PASS',
      details: `effective_image_input=${ctx.adapterImageInput ?? '未探测'}（非盲档），本门禁不适用。`,
    }];
  }
  const uiDoc = loadUiSpecFile(uiSpecAbsPath(ctx.projectRoot, ctx.feature));
  const assets = (uiDoc?.assets ?? []) as UiSpecAsset[];
  const cropAssets = assets.filter(a => a && a.acquisition === 'crop');
  if (cropAssets.length === 0) {
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'PASS',
      details: 'ui-spec 无 acquisition:crop 资产（placeholder/repo_assets 路径不受本门禁约束）。',
    }];
  }

  // verified_artifact 来源：spec/reports/asset-crop-validation.json（profile 产物，此处只读 JSON）
  let verifiedKeys = new Set<string>();
  try {
    const vPath = featureFilePath(ctx.projectRoot, ctx.feature, path.join('spec', 'reports', 'asset-crop-validation.json'));
    if (fs.existsSync(vPath)) {
      const parsed = JSON.parse(fs.readFileSync(vPath, 'utf-8')) as {
        entries?: Record<string, { verdict?: string }>;
      };
      verifiedKeys = new Set(
        Object.entries(parsed.entries ?? {})
          .filter(([, v]) => v?.verdict === 'verified')
          .map(([k]) => k),
      );
    }
  } catch { /* 解析失败按无验真处理（fail-closed） */ }

  const violations: string[] = [];
  const admitted: string[] = [];
  for (const a of cropAssets) {
    const missing: string[] = [];
    const resolvedAbs = a.resolved_path ? path.join(ctx.projectRoot, a.resolved_path) : null;
    if (!resolvedAbs || !fs.existsSync(resolvedAbs)) missing.push('c1 resolved_path 不存在');

    let provenanceOk = verifiedKeys.has(a.key);
    if (!provenanceOk && resolvedAbs && fs.existsSync(resolvedAbs)) {
      const rPath = featureFilePath(ctx.projectRoot, ctx.feature, path.join('spec', 'crop-provenance', `${a.key}.receipt.json`));
      if (fs.existsSync(rPath)) {
        // receipt 绑定 crop 产物字节哈希——换图即 stale（对齐 receipt 消费契约 object_hash 语义）
        const artifactSha = crypto.createHash('sha256').update(fs.readFileSync(resolvedAbs)).digest('hex');
        const v = validateConfirmationReceiptFile(rPath, defaultTrustRegistryPath(ctx.projectRoot), {
          action: 'crop_provenance',
          feature: ctx.feature,
          object_hash: artifactSha,
        });
        provenanceOk = v.valid;
      }
    }
    if (!provenanceOk) {
      // cursor 实施 review P2 收紧：external_tool 记录不再"自填即过"——source_sha256 必须命中
      // feature 参考图集的真实文件哈希（工具确实从某张权威原图裁出），否则不构成 provenance。
      const p = a.crop_provenance;
      const shapeOk = Boolean(
        p && p.kind === 'external_tool' &&
        typeof p.tool === 'string' && p.tool.trim().length > 0 &&
        typeof p.source_sha256 === 'string' && /^[0-9a-f]{64}$/i.test(p.source_sha256.trim()),
      );
      if (shapeOk) {
        provenanceOk = collectFeatureReferenceImageHashes(ctx.projectRoot, ctx.feature).has(
          p!.source_sha256!.trim().toLowerCase(),
        );
      }
    }
    if (!provenanceOk) missing.push('c2 provenance 不可验证（verified_artifact/human_receipt/external_tool 三来源均缺）');

    if (a.human_crop_confirmed !== true || !isHumanVerified(a.crop_confirmed_by)) {
      missing.push('c3 human_crop_confirmed 缺可信真人身份（自动化/user_requirement 哨兵不算条目级验真）');
    }

    if (missing.length > 0) violations.push(`  - ${a.key}：${missing.join('；')}`);
    else admitted.push(a.key);
  }

  if (violations.length === 0) {
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'PASS',
      details: `盲档下 ${admitted.length} 项 crop 资产全部满足可信消费态（c1-c3）：${admitted.slice(0, 10).join(', ')}${admitted.length > 10 ? '…' : ''}`,
    }];
  }
  return [{
    id, category: 'structure', description,
    severity: 'BLOCKER', status: 'FAIL',
    details: [
      `【盲档 crop 禁令】effective_image_input=none：盲模型不能执行/自证裁剪，${violations.length}/${cropAssets.length} 项 crop 资产不满足可信消费态`,
      '（bc-openCard 二轮：22 项 crop 全未验真 → coding 物化空白占位 → 设备"假可见"）：',
      ...violations.slice(0, 20),
      violations.length > 20 ? `  …还有 ${violations.length - 20} 项` : null,
    ].filter(Boolean).join('\n'),
    suggestion:
      '不满足条件的资产改走：①placeholder:true + asset-manifest（coding 期按 role 生成可见语义占位）；' +
      '②asset-request 问人（用户提供素材/外部工具裁剪后按 crop_provenance 记录）；' +
      '③已有可信产物则补齐 c1-c3（验真产物/人签 receipt/external_tool 记录 + 真人 crop_confirmed_by）。',
    affected_files: [relFeatureFile(ctx.projectRoot, ctx.feature, path.join('spec', 'ui-spec.yaml'))],
    failure_kind: 'blind_crop_prohibited',
    blocking_class: 'asset_integrity',
  }];
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function ruleDesc(
  ctx: CheckContext,
  section: 'structure_checks' | 'semantic_checks' | 'traceability_checks',
  id: string,
): string {
  const checks = ctx.phaseRule[section] as Record<string, { description: string }>;
  return checks?.[id]?.description?.trim() ?? id;
}

function loadPrd(ctx: CheckContext): string | null {
  return new SpecLoader(ctx.projectRoot, undefined, undefined, ctx.frameworkRoot)
    .loadFeatureDoc(ctx.projectRoot, ctx.feature, 'spec.md');
}

// --------------------------------------------------------------------------
// Structure Checks
// --------------------------------------------------------------------------

function checkRequiredChapters(ctx: CheckContext, prd: string): CheckResult[] {
  const expected = [
    '术语映射表',
    '功能概述', 'Scope 声明', '目标用户与使用场景', '功能清单', '页面/界面描述',
    '业务流程图', '异常/边界场景处理', '非功能性需求', '验收标准',
  ];

  const headingTexts = extractHeadings(prd).map(h => h.text);
  const missing = expected.filter(e => !headingTexts.some(t => t.includes(e)));

  if (missing.length === 0) {
    return [{ id: 'required_chapters', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'required_chapters'), severity: 'BLOCKER', status: 'PASS', details: `全部 ${expected.length} 个必需章节均存在。` }];
  }
  return [{
    id: 'required_chapters', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'required_chapters'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `缺少 ${missing.length} 个必需章节：${missing.join('、')}`,
    suggestion: '请补充缺失的 spec 章节。',
  }];
}

function checkScopeDeclaration(ctx: CheckContext, prd: string): CheckResult[] {
  const { scope, error } = parseScope(prd);
  if (error) {
    return [{
      id: 'scope_declaration', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'scope_declaration'),
      severity: 'BLOCKER', status: 'FAIL',
      details: describeScopeError(error),
      suggestion:
        '请在「Scope 声明」章节补充 ```yaml 代码块，包含 in_scope_modules（≥1 项）、out_of_scope_modules、rationale 三个字段。',
    }];
  }

  const details = [
    `in_scope_modules: ${scope!.in_scope_modules.join('、')}`,
    `out_of_scope_modules: ${scope!.out_of_scope_modules.join('、') || '（空）'}`,
    `rationale: ${scope!.rationale ? '已填写' : '⚠️ 未填写'}`,
  ].join('；');

  const rationaleWarn = scope!.rationale.length === 0;
  return [{
    id: 'scope_declaration', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'scope_declaration'),
    severity: 'BLOCKER',
    status: rationaleWarn ? 'WARN' : 'PASS',
    details,
    suggestion: rationaleWarn ? '建议补充 rationale 说明为何 out_of_scope_modules 不需要改。' : undefined,
  }];
}

function checkFeatureTableFormat(ctx: CheckContext, prd: string): CheckResult[] {
  const section = getSectionContent(prd, '功能清单');
  if (!section) {
    return [{ id: 'feature_table_format', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'feature_table_format'), severity: 'BLOCKER', status: 'FAIL', details: '未找到「功能清单」章节。' }];
  }

  const tables = extractTables(section);
  if (tables.length === 0) {
    return [{ id: 'feature_table_format', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'feature_table_format'), severity: 'BLOCKER', status: 'FAIL', details: '「功能清单」中未找到 Markdown 表格。' }];
  }

  const { hasAll, missing } = tableHasColumns(tables[0], ['编号', '功能名称', '优先级', '描述']);
  if (!hasAll) {
    return [{ id: 'feature_table_format', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'feature_table_format'), severity: 'BLOCKER', status: 'FAIL', details: `功能清单表格缺少列：${missing.join('、')}。实际表头：${tables[0].headers.join('、')}` }];
  }

  return [{ id: 'feature_table_format', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'feature_table_format'), severity: 'BLOCKER', status: 'PASS', details: `功能清单表格包含 ${tables[0].rows.length} 行，表头列齐全。` }];
}

function checkPriorityValues(ctx: CheckContext, prd: string): CheckResult[] {
  const section = getSectionContent(prd, '功能清单');
  const tables = section ? extractTables(section) : [];
  if (tables.length === 0) {
    return [{ id: 'priority_values', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'priority_values'), severity: 'BLOCKER', status: 'SKIP', details: '功能清单无表格可分析。' }];
  }

  const priorities = getColumnValues(tables[0], '优先级');
  const allowed = new Set(['P0', 'P1', 'P2', 'P3']);
  const invalid = priorities.filter(p => !allowed.has(p));

  if (invalid.length === 0) {
    return [{ id: 'priority_values', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'priority_values'), severity: 'BLOCKER', status: 'PASS', details: `全部 ${priorities.length} 行的优先级值合法。` }];
  }
  return [{
    id: 'priority_values', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'priority_values'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `${invalid.length} 个无效的优先级值：${[...new Set(invalid)].join('、')}。允许值：P0/P1/P2/P3`,
  }];
}

function checkAtLeastOneP0(ctx: CheckContext, prd: string): CheckResult[] {
  const section = getSectionContent(prd, '功能清单');
  const tables = section ? extractTables(section) : [];
  if (tables.length === 0) {
    return [{ id: 'at_least_one_p0', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'at_least_one_p0'), severity: 'BLOCKER', status: 'SKIP', details: '功能清单无表格。' }];
  }

  const p0Count = getColumnValues(tables[0], '优先级').filter(p => p === 'P0').length;
  if (p0Count > 0) {
    return [{ id: 'at_least_one_p0', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'at_least_one_p0'), severity: 'BLOCKER', status: 'PASS', details: `共 ${p0Count} 个 P0 功能项。` }];
  }
  return [{ id: 'at_least_one_p0', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'at_least_one_p0'), severity: 'BLOCKER', status: 'FAIL', details: '功能清单中没有任何 P0 功能项。' }];
}

function checkAcceptanceCriteriaFormat(ctx: CheckContext, prd: string): CheckResult[] {
  const section = getSectionContent(prd, '验收标准');
  if (!section) {
    return [{ id: 'acceptance_criteria_format', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'acceptance_criteria_format'), severity: 'BLOCKER', status: 'FAIL', details: '未找到「验收标准」章节。' }];
  }

  const acPattern = /\*\*(AC-[\w]+)\*\*/g;
  const ids = [...section.matchAll(acPattern)].map(m => m[1]);

  if (ids.length === 0) {
    return [{ id: 'acceptance_criteria_format', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'acceptance_criteria_format'), severity: 'BLOCKER', status: 'FAIL', details: '「验收标准」中未找到 AC-N 格式编号。' }];
  }

  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (duplicates.length > 0) {
    return [{ id: 'acceptance_criteria_format', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'acceptance_criteria_format'), severity: 'BLOCKER', status: 'WARN', details: `${ids.length} 条 AC，存在重复编号：${[...new Set(duplicates)].join('、')}` }];
  }

  return [{ id: 'acceptance_criteria_format', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'acceptance_criteria_format'), severity: 'BLOCKER', status: 'PASS', details: `验收标准包含 ${ids.length} 条唯一 AC 项。` }];
}

function checkMermaidFlowchart(ctx: CheckContext, prd: string): CheckResult[] {
  const section = getSectionContent(prd, '业务流程图');
  if (!section) {
    return [{ id: 'mermaid_flowchart', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'mermaid_flowchart'), severity: 'BLOCKER', status: 'FAIL', details: '未找到「业务流程图」章节。' }];
  }

  const mermaidBlocks = extractCodeBlocks(section, 'mermaid');
  if (mermaidBlocks.length === 0) {
    return [{ id: 'mermaid_flowchart', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'mermaid_flowchart'), severity: 'BLOCKER', status: 'FAIL', details: '「业务流程图」中未找到 Mermaid 代码块。' }];
  }

  const hasFlowchart = mermaidBlocks.some(b =>
    /flowchart|graph\s+(TD|LR|RL|BT)/i.test(b.content),
  );

  if (!hasFlowchart) {
    return [{ id: 'mermaid_flowchart', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'mermaid_flowchart'), severity: 'BLOCKER', status: 'WARN', details: `${mermaidBlocks.length} 个 Mermaid 代码块，但未检测到 flowchart 语法。` }];
  }

  return [{ id: 'mermaid_flowchart', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'mermaid_flowchart'), severity: 'BLOCKER', status: 'PASS', details: `找到 ${mermaidBlocks.length} 个 Mermaid 流程图。` }];
}

function checkExceptionTableFormat(ctx: CheckContext, prd: string): CheckResult[] {
  const section = getSectionContent(prd, '异常/边界场景处理') ?? getSectionContent(prd, '异常');
  if (!section) {
    return [{ id: 'exception_table_format', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'exception_table_format'), severity: 'MAJOR', status: 'FAIL', details: '未找到「异常/边界场景处理」章节。' }];
  }

  const tables = extractTables(section);
  if (tables.length === 0) {
    return [{ id: 'exception_table_format', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'exception_table_format'), severity: 'MAJOR', status: 'FAIL', details: '「异常/边界场景处理」中未找到表格。' }];
  }

  const { hasAll, missing } = tableHasColumns(tables[0], ['编号', '异常场景', '处理方式']);
  if (!hasAll) {
    return [{ id: 'exception_table_format', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'exception_table_format'), severity: 'MAJOR', status: 'FAIL', details: `异常场景表格缺少列：${missing.join('、')}。实际表头：${tables[0].headers.join('、')}` }];
  }

  return [{ id: 'exception_table_format', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'exception_table_format'), severity: 'MAJOR', status: 'PASS', details: `异常场景表格包含 ${tables[0].rows.length} 行，表头列齐全。` }];
}

function checkMinimumExceptionScenarios(ctx: CheckContext, prd: string): CheckResult[] {
  const section = getSectionContent(prd, '异常/边界场景处理') ?? getSectionContent(prd, '异常');
  const tables = section ? extractTables(section) : [];
  if (tables.length === 0) {
    return [{ id: 'minimum_exception_scenarios', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'minimum_exception_scenarios'), severity: 'MAJOR', status: 'SKIP', details: '异常场景章节无表格。' }];
  }

  const rowCount = tables[0].rows.length;
  if (rowCount >= 3) {
    return [{ id: 'minimum_exception_scenarios', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'minimum_exception_scenarios'), severity: 'MAJOR', status: 'PASS', details: `异常场景共 ${rowCount} 种（≥ 3）。` }];
  }
  return [{ id: 'minimum_exception_scenarios', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'minimum_exception_scenarios'), severity: 'MAJOR', status: 'FAIL', details: `异常场景仅 ${rowCount} 种，不满足最低 3 种要求。` }];
}

function checkNfrQuantified(ctx: CheckContext, prd: string): CheckResult[] {
  const section = getSectionContent(prd, '非功能性需求');
  if (!section) {
    return [{ id: 'nfr_quantified', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'nfr_quantified'), severity: 'MAJOR', status: 'FAIL', details: '未找到「非功能性需求」章节。' }];
  }

  const numericPattern = /[≤≥<>]\s*\d+|\d+\s*(秒|ms|FPS|fps|MB|KB|dp|%)/;
  if (numericPattern.test(section)) {
    return [{ id: 'nfr_quantified', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'nfr_quantified'), severity: 'MAJOR', status: 'PASS', details: '非功能性需求包含量化数值指标。' }];
  }

  return [{ id: 'nfr_quantified', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'nfr_quantified'), severity: 'MAJOR', status: 'FAIL', details: '「非功能性需求」未包含量化数值指标（如 ≤ 1.5 秒、≥ 54 FPS）。' }];
}

function checkPageDescriptionCompleteness(ctx: CheckContext, prd: string): CheckResult[] {
  const section = getSectionContent(prd, '页面/界面描述') ?? getSectionContent(prd, '页面');
  if (!section) {
    return [{ id: 'page_description_completeness', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'page_description_completeness'), severity: 'MAJOR', status: 'FAIL', details: '未找到「页面/界面描述」章节。' }];
  }

  const subsections = (
    getSubsectionHeadings(prd, '页面/界面描述').length > 0
      ? getSubsectionHeadings(prd, '页面/界面描述')
      : getSubsectionHeadings(prd, '页面')
  ).filter(h => !h.text.includes('总览') && !h.text.includes('汇总') && !h.text.includes('概述'));

  if (subsections.length === 0) {
    return [{ id: 'page_description_completeness', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'page_description_completeness'), severity: 'MAJOR', status: 'WARN', details: '未找到页面子章节。' }];
  }

  const requiredCols = ['组件', '类型', '交互行为'];
  const pagesWithoutTable: string[] = [];

  for (const sub of subsections) {
    const subContent = getSectionContent(prd, sub.text);
    if (!subContent) { pagesWithoutTable.push(sub.text); continue; }

    const tables = extractTables(subContent);
    const hasValidTable = tables.some(t => tableHasColumns(t, requiredCols).hasAll);
    if (!hasValidTable) pagesWithoutTable.push(sub.text);
  }

  if (pagesWithoutTable.length === 0) {
    return [{ id: 'page_description_completeness', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'page_description_completeness'), severity: 'MAJOR', status: 'PASS', details: `全部 ${subsections.length} 个页面均有组件表格。` }];
  }

  return [{
    id: 'page_description_completeness', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'page_description_completeness'),
    severity: 'MAJOR', status: 'WARN',
    details: `${pagesWithoutTable.length} 个页面缺少组件表格：${pagesWithoutTable.join('、')}`,
    suggestion: '每个页面子章节应包含组件表格（至少含"组件、类型、交互行为"三列）。',
  }];
}

function checkMetadataHeader(ctx: CheckContext, prd: string): CheckResult[] {
  const metadata = extractMetadata(prd);
  const required = ['模块标识', '版本', '创建日期', '状态'];
  const missing = required.filter(f => !metadata[f]);

  if (missing.length === 0) {
    return [{ id: 'metadata_header', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'metadata_header'), severity: 'MINOR', status: 'PASS', details: `元数据齐全：${Object.keys(metadata).join('、')}` }];
  }
  return [{ id: 'metadata_header', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'metadata_header'), severity: 'MINOR', status: 'WARN', details: `元数据缺少字段：${missing.join('、')}` }];
}

// --------------------------------------------------------------------------
// WP6: Terminology / Catalog Alignment Checks
// --------------------------------------------------------------------------

const TERMINOLOGY_REQUIRED_COLUMNS = [
  '原始术语',
  '权威模块',
  '所属层',
  '置信度',
  '易混项',
  '用户确认',
];

function specMdAffected(ctx: CheckContext): string[] {
  return [relFeatureArtifact(ctx.projectRoot, ctx.feature, 'spec.md')];
}

/** 导出供单测直接调用（project_scale=small 一次性确认分支，C4 exploration-scale）。 */
export function checkTerminologyMappingTable(ctx: CheckContext, prd: string): CheckResult[] {
  const specAffected = specMdAffected(ctx);
  const section = getSectionContent(prd, '术语映射表');
  if (!section) {
    return [{
      id: 'terminology_mapping_table', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_mapping_table'),
      severity: 'BLOCKER', status: 'FAIL',
      details: '未找到「术语映射表」章节。spec Step 1.5 要求 spec 必须以该章节起始。',
      suggestion: '请在功能概述之前插入 "## 0. 术语映射表" 章节，按模板填写映射表。',
      affected_files: specAffected,
    }];
  }

  const tables = extractTables(section);
  if (tables.length === 0) {
    return [{
      id: 'terminology_mapping_table', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_mapping_table'),
      severity: 'BLOCKER', status: 'FAIL',
      details: '「术语映射表」章节未找到 Markdown 表格。',
      suggestion:
        `请参考 framework/profiles/${ctx.resolvedProfile.name}/skills/spec/templates/spec-template.md 中的表格格式。`,
      affected_files: specAffected,
    }];
  }

  const table = tables[0];
  const { hasAll, missing } = tableHasColumns(table, TERMINOLOGY_REQUIRED_COLUMNS);
  if (!hasAll) {
    return [{
      id: 'terminology_mapping_table', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_mapping_table'),
      severity: 'BLOCKER', status: 'FAIL',
      details: `术语映射表缺少列：${missing.join('、')}。实际表头：${table.headers.join('、')}`,
      affected_files: specAffected,
    }];
  }

  if (table.rows.length === 0) {
    return [{
      id: 'terminology_mapping_table', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_mapping_table'),
      severity: 'BLOCKER', status: 'FAIL',
      details: '术语映射表为空。至少列出需求中出现的主要业务名词（即便是极简需求也不可省略）。',
      affected_files: specAffected,
    }];
  }

  // 过滤模板占位行（原始术语列仍然是 `{术语1}` 之类的）
  const realRows = table.rows.filter(row => {
    const term = (row[0] || '').trim();
    return term.length > 0 && !/^\{.*\}$/.test(term);
  });
  if (realRows.length === 0) {
    return [{
      id: 'terminology_mapping_table', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_mapping_table'),
      severity: 'BLOCKER', status: 'FAIL',
      details: '术语映射表仅包含模板占位行（形如 `{术语1}`），未填写真实业务术语。',
      affected_files: specAffected,
    }];
  }

  const confirmIdx = table.headers.findIndex(h => h.includes('用户确认'));
  const moduleIdx = table.headers.findIndex(h => h.includes('权威模块'));
  const termIdx = 0;

  const unconfirmed: string[] = [];
  realRows.forEach(row => {
    const cell = (row[confirmIdx] || '').trim();
    const isConfirmed = /\[[xX]\]/.test(cell);
    if (!isConfirmed) unconfirmed.push((row[termIdx] || '(空)').trim());
  });

  if (unconfirmed.length > 0) {
    // C4 exploration-scale：project_scale=small 允许一次性对照 architecture.md 模块清单的
    // 整体确认替代逐行 [x]（红线仍是"须有一次真人/headless 确认"，只是确认粒度从逐行降为一次性）。
    const isSmallScale = loadFrameworkConfig(ctx.projectRoot).project_scale === 'small';
    const onceConfirmed = isSmallScale && /-\s*\[[xX]\]\s*.*一次性确认/.test(section);
    if (!onceConfirmed) {
      return [{
        id: 'terminology_mapping_table', category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'terminology_mapping_table'),
        severity: 'BLOCKER', status: 'FAIL',
        details: `${unconfirmed.length} 条术语映射未获得用户确认（用户确认列不是 [x]）：${unconfirmed.join('、')}`,
        suggestion: isSmallScale
          ? '交互态：逐条确认写回 [x]；或在术语映射表节末追加一行 "- [x] 已对照 architecture.md 模块清单一次性确认全部术语映射"（small 档专用，替代逐行确认）。goal-mode headless：按 user-confirmation-ux.md §9 自动写回并留痕 headless-assumptions.md。'
          : '交互态：须等用户逐条确认后写回 [x]。goal-mode headless：按 user-confirmation-ux.md §9 自动写回 [x] 并留痕 headless-assumptions.md。',
        affected_files: specAffected,
      }];
    }
  }

  const confidenceIdx = table.headers.findIndex(h => h.includes('置信度'));
  const fakeHighWarnings: CheckResult[] = [];
  if (confidenceIdx >= 0) {
    const glossaryForHigh = loadGlossary(ctx.projectRoot);
    if (glossaryForHigh.ok) {
      for (const row of realRows) {
        const term = (row[termIdx] || '').trim();
        const conf = (row[confidenceIdx] || '').trim().toLowerCase();
        if (!term || conf !== 'high') continue;
        const hit = lookupTerm(glossaryForHigh.glossary, term);
        if (!hit) {
          fakeHighWarnings.push({
            id: 'terminology_high_without_glossary',
            category: 'structure',
            description: '术语映射表 high 置信度须 glossary 背书',
            severity: 'MINOR',
            status: 'WARN',
            details: `「${term}」标为 high 但不在 ${relGlossary(ctx.projectRoot)}（含 aliases）中；新术语应标 medium/low 并入 must-review。`,
            suggestion: '将置信度降为 medium/low，或先把术语写入 glossary 后再标 high。',
            affected_files: [relFeatureArtifact(ctx.projectRoot, ctx.feature, 'spec.md')],
          });
        }
      }
    }
  }

  // 校验 canonical_module 必须存在于 module-catalog.yaml
  const catalogResult = loadCatalog(ctx.projectRoot);
  if (!catalogResult.ok) {
    return [{
      id: 'terminology_mapping_table', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_mapping_table'),
      severity: 'BLOCKER', status: 'FAIL',
      details: `模块画像加载失败：${describeCatalogError(catalogResult.error)}`,
      affected_files: specAffected,
    }];
  }

  const knownModules = new Set(allModuleNames(catalogResult.catalog));
  const unknown: Array<{ term: string; module: string }> = [];
  realRows.forEach(row => {
    const term = (row[termIdx] || '').trim();
    const mod = (row[moduleIdx] || '').trim();
    if (!mod) return;
    // 支持「候选①：A / 候选②：B」形式的未命中行（含非模块名分隔符），只校验第一个候选
    const primary = mod.split(/[\/／,，]/)[0].replace(/候选[①②③]?[:：]\s*/g, '').trim();
    if (primary && !knownModules.has(primary)) {
      unknown.push({ term, module: primary });
    }
  });

  if (unknown.length > 0) {
    return [
      ...fakeHighWarnings,
      {
        id: 'terminology_mapping_table', category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'terminology_mapping_table'),
        severity: 'BLOCKER', status: 'FAIL',
        details: `${unknown.length} 条术语的权威模块不在 ${relCatalog(ctx.projectRoot)} 内：${unknown.map(u => `${u.term}→${u.module}`).join('、')}`,
        suggestion: `请检查模块名拼写，或先把真实存在的新模块补充到 ${relCatalog(ctx.projectRoot)} 再写 spec。`,
        affected_files: specAffected,
      },
    ];
  }

  // 校验已确认映射是否与 glossary 矛盾（防"用户漫不经心勾 [x]"路径）
  const glossaryResult = loadGlossary(ctx.projectRoot);
  if (!glossaryResult.ok) {
    return [{
      id: 'terminology_mapping_table', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_mapping_table'),
      severity: 'BLOCKER', status: 'WARN',
      details: `${realRows.length} 条术语均已确认且对齐 catalog，但 glossary 校验跳过：${describeGlossaryError(glossaryResult.error)}`,
    }];
  }

  const conflicts: Array<{ term: string; picked: string; canonical: string }> = [];
  realRows.forEach(row => {
    const term = (row[termIdx] || '').trim();
    const picked = (row[moduleIdx] || '').trim().split(/[\/／,，]/)[0]
      .replace(/候选[①②③]?[:：]\s*/g, '').trim();
    if (!term || !picked) return;

    const hit = lookupTerm(glossaryResult.glossary, term);
    if (!hit) return; // 术语不在 glossary，不做强校验（新术语允许进入）
    if (hit.term.canonical_module !== picked) {
      conflicts.push({
        term,
        picked,
        canonical: hit.term.canonical_module,
      });
    }
  });

  if (conflicts.length > 0) {
    const parts = conflicts.map(
      c => `「${c.term}」用户确认了 ${c.picked}，但 glossary 权威映射是 ${c.canonical}`,
    );
    return [
      ...fakeHighWarnings,
      {
      id: 'terminology_mapping_table', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_mapping_table'),
      severity: 'BLOCKER', status: 'FAIL',
      details: `${conflicts.length} 条用户已确认的映射与 ${relGlossary(ctx.projectRoot)} 冲突：${parts.join('；')}`,
      suggestion:
        `两种合法处理：(1) 按 glossary 修正 spec 映射；(2) 若确认要覆盖 glossary，先显式修改 ${relGlossary(ctx.projectRoot)} 中该术语的 canonical_module 并注明 user-approved 日期，再跑 check。`,
      affected_files: specAffected,
    }];
  }

  return [
    ...fakeHighWarnings,
    {
    id: 'terminology_mapping_table', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'terminology_mapping_table'),
    severity: 'BLOCKER', status: 'PASS',
    details: `${realRows.length} 条术语全部已确认，权威模块对齐 module-catalog，与 glossary 无冲突。`,
  }];
}

function checkScopeMatchesCatalog(ctx: CheckContext, prd: string): CheckResult[] {
  const { scope, error } = parseScope(prd);
  if (error) {
    return [{
      id: 'scope_matches_catalog', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'scope_matches_catalog'),
      severity: 'BLOCKER', status: 'SKIP',
      details: `Scope 声明解析失败，跳过 catalog 对齐校验：${describeScopeError(error)}`,
    }];
  }

  const catalogResult = loadCatalog(ctx.projectRoot);
  if (!catalogResult.ok) {
    return [{
      id: 'scope_matches_catalog', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'scope_matches_catalog'),
      severity: 'BLOCKER', status: 'FAIL',
      details: `模块画像加载失败：${describeCatalogError(catalogResult.error)}`,
    }];
  }

  const known = new Set(allModuleNames(catalogResult.catalog));
  const invalidIn = scope!.in_scope_modules.filter(m => !known.has(m));
  const invalidOut = scope!.out_of_scope_modules.filter(m => !known.has(m));

  if (invalidIn.length === 0 && invalidOut.length === 0) {
    return [{
      id: 'scope_matches_catalog', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'scope_matches_catalog'),
      severity: 'BLOCKER', status: 'PASS',
      details: `Scope 声明中全部 ${scope!.in_scope_modules.length + scope!.out_of_scope_modules.length} 个模块名均存在于 ${relCatalog(ctx.projectRoot)}。`,
    }];
  }

  const detailParts: string[] = [];
  if (invalidIn.length > 0) detailParts.push(`in_scope_modules 未收录：${invalidIn.join('、')}`);
  if (invalidOut.length > 0) detailParts.push(`out_of_scope_modules 未收录：${invalidOut.join('、')}`);

  return [{
    id: 'scope_matches_catalog', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'scope_matches_catalog'),
    severity: 'BLOCKER', status: 'FAIL',
    details: detailParts.join('；'),
    suggestion:
      `请确认模块名拼写是否正确；若确实是新模块，先更新 ${relCatalog(ctx.projectRoot)} 再写 spec。`,
  }];
}

// --------------------------------------------------------------------------
// C1a: 术语映射表的权威模块必须出现在 Scope 声明里
// --------------------------------------------------------------------------

function checkTerminologyModulesWithinScope(ctx: CheckContext, prd: string): CheckResult[] {
  const section = getSectionContent(prd, '术语映射表');
  if (!section) {
    return [{
      id: 'terminology_modules_within_scope', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_modules_within_scope'),
      severity: 'BLOCKER', status: 'SKIP',
      details: '未找到「术语映射表」章节（已由 terminology_mapping_table 报告）。',
    }];
  }

  const tables = extractTables(section);
  if (tables.length === 0) {
    return [{
      id: 'terminology_modules_within_scope', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_modules_within_scope'),
      severity: 'BLOCKER', status: 'SKIP',
      details: '术语映射表无 markdown 表格（已由 terminology_mapping_table 报告）。',
    }];
  }

  const table = tables[0];
  const moduleIdx = table.headers.findIndex(h => h.includes('权威模块'));
  if (moduleIdx < 0) {
    return [{
      id: 'terminology_modules_within_scope', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_modules_within_scope'),
      severity: 'BLOCKER', status: 'SKIP',
      details: '术语映射表缺少「权威模块」列（已由 terminology_mapping_table 报告）。',
    }];
  }

  const realRows = table.rows.filter(row => {
    const term = (row[0] || '').trim();
    return term.length > 0 && !/^\{.*\}$/.test(term);
  });
  if (realRows.length === 0) {
    return [{
      id: 'terminology_modules_within_scope', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_modules_within_scope'),
      severity: 'BLOCKER', status: 'SKIP',
      details: '术语映射表只有占位行（已由 terminology_mapping_table 报告）。',
    }];
  }

  const { scope, error } = parseScope(prd);
  if (!scope) {
    return [{
      id: 'terminology_modules_within_scope', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_modules_within_scope'),
      severity: 'BLOCKER', status: 'SKIP',
      details: `Scope 声明解析失败，无法做交叉校验：${error ? describeScopeError(error) : '未知原因'}。`,
    }];
  }

  const scopeSet = new Set<string>([
    ...scope.in_scope_modules,
    ...scope.out_of_scope_modules,
  ]);

  const missing: Array<{ term: string; module: string }> = [];
  for (const row of realRows) {
    const term = (row[0] || '').trim();
    const modCell = (row[moduleIdx] || '').trim();
    if (!modCell) continue;
    // 仅取首个候选作为权威模块（与 terminology_mapping_table check 同口径）
    const primary = modCell.split(/[\/／,，]/)[0]
      .replace(/候选[①②③]?[:：]\s*/g, '').trim();
    if (!primary) continue;
    if (!scopeSet.has(primary)) {
      missing.push({ term, module: primary });
    }
  }

  if (missing.length === 0) {
    return [{
      id: 'terminology_modules_within_scope', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_modules_within_scope'),
      severity: 'BLOCKER', status: 'PASS',
      details: `术语映射表中全部 ${realRows.length} 条权威模块均已在 Scope 声明中出现。`,
    }];
  }

  return [{
    id: 'terminology_modules_within_scope', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'terminology_modules_within_scope'),
    severity: 'BLOCKER', status: 'FAIL',
    details:
      `${missing.length} 条术语的权威模块既不在 in_scope_modules 也不在 out_of_scope_modules：` +
      missing.map(x => `${x.term}→${x.module}`).join('、'),
    suggestion:
      '两种合法处理：\n' +
      '(1) 把这些模块补进 in_scope_modules（本需求确实要改）或 out_of_scope_modules（仅消歧用、不改）；\n' +
      '(2) 若该术语本来就不在本需求语境，从术语映射表里删除该行。',
    affected_files: [relFeatureArtifact(ctx.projectRoot, ctx.feature, 'spec.md')],
  }];
}

// --------------------------------------------------------------------------
// C1b: glossary 术语在正文出现但未进术语映射表 → WARN（兜底网）
// --------------------------------------------------------------------------

function checkGlossaryTermsUsedInBody(ctx: CheckContext, prd: string): CheckResult[] {
  const glossaryResult = loadGlossary(ctx.projectRoot);
  if (!glossaryResult.ok) {
    return [{
      id: 'glossary_terms_used_in_body', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'glossary_terms_used_in_body'),
      severity: 'MAJOR', status: 'SKIP',
      details: `glossary 加载失败，本 check 跳过：${describeGlossaryError(glossaryResult.error)}`,
    }];
  }

  const glossary = glossaryResult.glossary;
  if (glossary.terms.length === 0) {
    return [{
      id: 'glossary_terms_used_in_body', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'glossary_terms_used_in_body'),
      severity: 'MAJOR', status: 'SKIP',
      details: 'glossary 暂无术语条目，无法反向扫描。',
    }];
  }

  // 1. 抽出术语映射表里已声明的所有 term（含同 glossary 条目的 alias 传递）
  const tableCovered = new Set<string>();
  const tableSection = getSectionContent(prd, '术语映射表');
  if (tableSection) {
    const tables = extractTables(tableSection);
    if (tables.length > 0) {
      for (const row of tables[0].rows) {
        const term = (row[0] || '').trim();
        if (!term || /^\{.*\}$/.test(term)) continue;
        // 表里这一行可能写的是 "Toast / 基础组件" 这种合写形式，先按 / ， 拆开
        for (const piece of term.split(/[\/／,，]/)) {
          const p = piece.trim();
          if (!p) continue;
          tableCovered.add(p);
          const hit = lookupTerm(glossary, p);
          if (hit) {
            tableCovered.add(hit.term.term);
            for (const a of hit.term.aliases) tableCovered.add(a);
          }
        }
      }
    }
  }

  // 2. 构造"正文"——把术语映射表整段从 spec 正文里挖掉，剩下的就是 body
  const body = tableSection ? prd.split(tableSection).join('') : prd;

  // 3. 逐术语反向扫描：term/aliases 命中 body 但未在 tableCovered → WARN
  const missing: Array<{ canonical_term: string; appeared_as: string; module: string }> = [];
  for (const t of glossary.terms) {
    const variants = [t.term, ...t.aliases].filter(v => v && v.length > 0);
    if (variants.some(v => tableCovered.has(v))) continue;
    const seen = variants.find(v => body.includes(v));
    if (!seen) continue;
    missing.push({
      canonical_term: t.term,
      appeared_as: seen,
      module: t.canonical_module,
    });
  }

  if (missing.length === 0) {
    return [{
      id: 'glossary_terms_used_in_body', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'glossary_terms_used_in_body'),
      severity: 'MAJOR', status: 'PASS',
      details: 'spec 正文使用的 glossary 术语均已在术语映射表中显式声明。',
    }];
  }

  return [{
    id: 'glossary_terms_used_in_body', category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'glossary_terms_used_in_body'),
    severity: 'MAJOR', status: 'WARN',
    details:
      `${missing.length} 个 glossary 术语在 spec 正文出现但未进术语映射表：` +
      missing.map(x =>
        x.appeared_as === x.canonical_term
          ? `${x.appeared_as}(→${x.module})`
          : `${x.appeared_as}[→${x.canonical_term} → ${x.module}]`,
      ).join('、'),
    suggestion:
      '若这些词确实是业务术语 → 加进术语映射表并勾选 [x]，避免 plan / 3 阶段因术语歧义改错模块；\n' +
      '若只是正文里偶然带过的非业务用词 → 可直接忽略本 WARN（不会升级为 BLOCKER）。',
    affected_files: [
      relFeatureArtifact(ctx.projectRoot, ctx.feature, 'spec.md'),
      relGlossary(ctx.projectRoot),
    ],
  }];
}

// --------------------------------------------------------------------------
// Traceability Checks
// --------------------------------------------------------------------------

function checkFeatureToAcceptance(ctx: CheckContext, prd: string): CheckResult[] {
  const featureSection = getSectionContent(prd, '功能清单');
  const featureTables = featureSection ? extractTables(featureSection) : [];
  if (featureTables.length === 0) {
    return [{ id: 'feature_to_acceptance', category: 'traceability', description: ruleDesc(ctx, 'traceability_checks', 'feature_to_acceptance'), severity: 'BLOCKER', status: 'SKIP', details: '功能清单无表格。' }];
  }

  const featureIds = getColumnValues(featureTables[0], '编号');
  const priorities = getColumnValues(featureTables[0], '优先级');
  const p0p1: string[] = [];
  for (let i = 0; i < featureIds.length; i++) {
    if (priorities[i] === 'P0' || priorities[i] === 'P1') p0p1.push(featureIds[i]);
  }

  const acSection = getSectionContent(prd, '验收标准');
  if (!acSection) {
    return [{ id: 'feature_to_acceptance', category: 'traceability', description: ruleDesc(ctx, 'traceability_checks', 'feature_to_acceptance'), severity: 'BLOCKER', status: 'FAIL', details: '未找到验收标准章节。' }];
  }

  const refPattern = /\*\*AC-[\w]+\*\*\s*\(([^)]+)\)/g;
  const referencedFeatures = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = refPattern.exec(acSection)) !== null) {
    m[1].split(/[,，]/).map(r => r.trim()).forEach(r => referencedFeatures.add(r));
  }

  const uncovered = p0p1.filter(f => !referencedFeatures.has(f));

  if (uncovered.length === 0) {
    return [{ id: 'feature_to_acceptance', category: 'traceability', description: ruleDesc(ctx, 'traceability_checks', 'feature_to_acceptance'), severity: 'BLOCKER', status: 'PASS', details: `全部 ${p0p1.length} 个 P0/P1 功能均有验收标准。` }];
  }
  return [{
    id: 'feature_to_acceptance', category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'feature_to_acceptance'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `${uncovered.length}/${p0p1.length} 个 P0/P1 功能缺少 AC：${uncovered.join('、')}`,
    suggestion: '请为每个 P0/P1 功能添加至少一条验收标准。',
  }];
}

function checkAcceptanceToFeature(ctx: CheckContext, prd: string): CheckResult[] {
  const acSection = getSectionContent(prd, '验收标准');
  if (!acSection) {
    return [{ id: 'acceptance_to_feature', category: 'traceability', description: ruleDesc(ctx, 'traceability_checks', 'acceptance_to_feature'), severity: 'BLOCKER', status: 'SKIP', details: '未找到验收标准章节。' }];
  }

  const acItemPattern = /\*\*(AC-[\w]+)\*\*(?:\s*\(([^)]*)\))?/g;
  const items: Array<{ id: string; hasRef: boolean }> = [];
  let m: RegExpExecArray | null;
  while ((m = acItemPattern.exec(acSection)) !== null) {
    const isGeneral = m[1].startsWith('AC-G');
    items.push({ id: m[1], hasRef: isGeneral || (!!m[2] && m[2].trim().length > 0) });
  }

  if (items.length === 0) {
    return [{ id: 'acceptance_to_feature', category: 'traceability', description: ruleDesc(ctx, 'traceability_checks', 'acceptance_to_feature'), severity: 'BLOCKER', status: 'SKIP', details: '未找到 AC 项。' }];
  }

  const orphaned = items.filter(i => !i.hasRef);
  if (orphaned.length === 0) {
    return [{ id: 'acceptance_to_feature', category: 'traceability', description: ruleDesc(ctx, 'traceability_checks', 'acceptance_to_feature'), severity: 'BLOCKER', status: 'PASS', details: `全部 ${items.length} 条 AC 均关联到功能编号。` }];
  }
  return [{
    id: 'acceptance_to_feature', category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'acceptance_to_feature'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `${orphaned.length} 条 AC 未关联功能编号：${orphaned.map(o => o.id).join('、')}`,
    suggestion: '格式：**AC-1** (F1): 描述...',
  }];
}

// --------------------------------------------------------------------------
// Headless assumptions trace (goal-mode review hint)
// --------------------------------------------------------------------------

function checkHeadlessAssumptionsTrace(ctx: CheckContext): CheckResult[] {
  const specRel = relFeatureArtifact(ctx.projectRoot, ctx.feature, 'spec.md');
  const assumptionsRel = specRel.replace(/\/spec\.md$/, '/headless-assumptions.md');
  const assumptionsAbs = path.join(ctx.projectRoot, assumptionsRel);
  if (!fs.existsSync(assumptionsAbs)) return [];
  const content = fs.readFileSync(assumptionsAbs, 'utf-8');
  const autoCount = (content.match(/auto-approved \(goal-mode\)/gi) || []).length;
  if (autoCount === 0) return [];
  return [{
    id: 'headless_assumptions_review',
    category: 'structure',
    description: 'goal-mode 自动确认留痕待复核',
    severity: 'MINOR',
    status: 'WARN',
    details: `${autoCount} 条术语/闸门为 goal-mode 自动确认，待人工复核（见 ${assumptionsRel}）。`,
    affected_files: [assumptionsRel],
  }];
}

// --------------------------------------------------------------------------
// Main Checker
// --------------------------------------------------------------------------

function safeRun(fn: () => CheckResult[], checkId: string): CheckResult[] {
  try {
    // t1d（plan e6a3c9f4）：编排边界附加产出来源，供报告/summary 定位真实产出方。
    return fn().map(r => (r.source ? r : { ...r, source: checkId }));
  } catch (err) {
    const e = err as Error;
    const isProgrammerError =
      e instanceof TypeError || e instanceof RangeError || e instanceof SyntaxError;
    return [{
      id: checkId, category: 'structure',
      description: `${checkId} 执行异常`,
      severity: isProgrammerError ? 'BLOCKER' : 'MINOR',
      status: isProgrammerError ? 'FAIL' : 'SKIP',
      details: isProgrammerError
        ? `[Harness 内部错误] ${e.message}\n${e.stack ?? ''}`
        : `检查执行时发生错误：${e.message}`,
      // P0-3（plan d9b4f7e2）：程序员错误=框架缺陷，结构化归因 framework_bug——goal-runner
      // 据此首触 halt 指向回灌源仓，不再让 agent 把门禁崩溃当自身产物问题反复修。
      ...(isProgrammerError
        ? {
            failure_kind: 'framework_bug',
            blocking_class: 'framework_internal',
            suggestion:
              '门禁脚本自身异常（framework 缺陷，非本 feature 产物问题）——请把完整栈回灌 agent-maison 源仓修复；不要修改产物或 framework 发布件来绕过。',
          }
        : {}),
    }];
  }
}

const checker: PhaseChecker = {
  phase: 'spec',

  async check(ctx: CheckContext): Promise<CheckResult[]> {
    const prd = loadPrd(ctx);
    if (!prd) {
      const prdRel = relFeatureArtifact(ctx.projectRoot, ctx.feature, 'spec.md');
      return [{
        id: 'spec_file_exists', category: 'structure',
        description: `${prdRel} 不存在`,
        severity: 'BLOCKER', status: 'FAIL',
        details: `spec 文件 ${prdRel} 不存在，无法进行任何检查。`,
        affected_files: [prdRel],
      }];
    }

    const results: CheckResult[] = [
      ...featureArtifactLayoutWarnings(ctx.projectRoot, ctx.feature, ['spec.md']),
    ];

    results.push(...safeRun(() => checkRequiredChapters(ctx, prd), 'required_chapters'));
    results.push(...safeRun(() => checkTerminologyMappingTable(ctx, prd), 'terminology_mapping_table'));
    results.push(...safeRun(() => checkHeadlessAssumptionsTrace(ctx), 'headless_assumptions_review'));
    results.push(...safeRun(() => checkScopeDeclaration(ctx, prd), 'scope_declaration'));
    results.push(...safeRun(() => checkScopeMatchesCatalog(ctx, prd), 'scope_matches_catalog'));
    results.push(...safeRun(() => checkTerminologyModulesWithinScope(ctx, prd), 'terminology_modules_within_scope'));
    if (isSpecVisualHandoffSkipped(ctx.resolvedProfile)) {
      results.push({
        id: 'visual_handoff',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'visual_handoff'),
        severity: 'MINOR',
        status: 'SKIP',
        details: `project_profile=${ctx.resolvedProfile.name} 未启用 spec.visual_handoff 脚本守门`,
      });
    } else {
      // visual_handoff 先于 ui_spec：structured_ref_elements 注入 ctx.refElementsManifest，
      // capture-completeness 同 run 优先读内存 manifest（见 capability-registry dispatchSpec*）。
      results.push(...safeRun(() => dispatchSpecVisualHandoff(ctx, prd), 'visual_handoff'));
    }
    // S3 P0-2b（codex 实施 review）：反证器**先于** ui-spec/fidelity gate 执行——同一次
    // harness run 内 attestation 先落盘，终签消费本次结论而非上一轮陈旧记录（自守卫：
    // 无 ui-spec 文档返回空结果，与 profile 开关无耦合）。
    results.push(...safeRun(() => checkVisionOutputCounterevidence(ctx), 'vision_output_counterevidence'));
    if (isSpecUiSpecSkipped(ctx.resolvedProfile)) {
      results.push({
        id: 'ui_spec_structure',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'ui_spec_structure'),
        severity: 'MINOR',
        status: 'SKIP',
        details: `project_profile=${ctx.resolvedProfile.name} 未启用 spec.ui_spec 脚本守门`,
      });
    } else {
      results.push(...safeRun(() => dispatchSpecUiSpec(ctx, prd), 'ui_spec_structure'));
    }
    if (!isSpecAssetAcquisitionSkipped(ctx.resolvedProfile)) {
      results.push(...safeRun(() => dispatchSpecAssetAcquisition(ctx), 'asset_acquisition'));
    }
    // --- blind-visual-hardening d4：fidelity 意图三态前置闸（逐阶段路径扩面）---
    results.push(...safeRun(() => checkFidelityCapabilityPregate(ctx), 'fidelity_capability_pregate'));

    // --- blind-visual-hardening d2：盲档 crop 左移禁令（不依赖 profile capability 开关——
    //     盲模型自证裁剪在任何 profile 下都非法）---
    results.push(...safeRun(() => checkBlindCropProhibition(ctx), 'blind_crop_prohibition'));
    // （vision_output_counterevidence 已前移至 ui_spec 检查之前——同 run 内 attestation 先落盘）
    // --- blind-visual-hardening P1-F：盲档素材问人清单（side artifact，best-effort）---
    try { maybeWriteAssetRequest(ctx); } catch { /* 清单生成失败不阻断 */ }
    results.push(...safeRun(() => checkFeatureTableFormat(ctx, prd), 'feature_table_format'));
    results.push(...safeRun(() => checkPriorityValues(ctx, prd), 'priority_values'));
    results.push(...safeRun(() => checkAtLeastOneP0(ctx, prd), 'at_least_one_p0'));
    results.push(...safeRun(() => checkAcceptanceCriteriaFormat(ctx, prd), 'acceptance_criteria_format'));
    results.push(...safeRun(() => checkMermaidFlowchart(ctx, prd), 'mermaid_flowchart'));
    results.push(...safeRun(() => checkExceptionTableFormat(ctx, prd), 'exception_table_format'));
    results.push(...safeRun(() => checkMinimumExceptionScenarios(ctx, prd), 'minimum_exception_scenarios'));
    results.push(...safeRun(() => checkNfrQuantified(ctx, prd), 'nfr_quantified'));
    results.push(...safeRun(() => checkPageDescriptionCompleteness(ctx, prd), 'page_description_completeness'));
    results.push(...safeRun(() => checkMetadataHeader(ctx, prd), 'metadata_header'));

    const acceptanceRuleDesc = (
      c: CheckContext,
      s: string,
      id: string,
    ): string =>
      ruleDesc(c, s as 'structure_checks' | 'semantic_checks' | 'traceability_checks', id);
    results.push(...runAcceptanceYamlStructureChecks(ctx, acceptanceRuleDesc));

    results.push(...safeRun(() => checkFeatureToAcceptance(ctx, prd), 'feature_to_acceptance'));
    results.push(...safeRun(() => checkAcceptanceToFeature(ctx, prd), 'acceptance_to_feature'));
    results.push(...safeRun(() => checkGlossaryTermsUsedInBody(ctx, prd), 'glossary_terms_used_in_body'));
    results.push(
      ...safeRun(
        () => checkFactsArtifact(ctx.projectRoot, ctx.feature, 'spec', {
          phaseRule: ctx.phaseRule,
          profileName: ctx.resolvedProfile.name,
          frameworkRoot: ctx.frameworkRoot,
        }),
        'context_exploration_gate',
      ),
    );

    // --- goal-fakepass-hardening t6：档位声明 vs 需求 SSOT 强意图对账（BLOCKER，双模式）---
    results.push(...safeRun(() => checkFidelityIntentReconciliation(ctx), 'fidelity_intent_reconciliation'));

    // --- goal-fakepass-hardening t4a：P0 结构化流程模型 + flow_contract 确认点 ---
    results.push(...safeRun(() => evaluateAcceptanceFlowStructure(ctx.projectRoot, ctx.feature), 'acceptance_flow_structure'));
    results.push(
      ...safeRun(() => {
        const featuresDirRel = (loadFrameworkConfig(ctx.projectRoot).paths?.features_dir ?? 'doc/features').replace(/\\/g, '/');
        const reqText = collectRequirementIntentText(ctx.projectRoot, ctx.feature, featuresDirRel);
        return evaluateFlowContract(ctx.projectRoot, ctx.feature, reqText);
      }, 'acceptance_flow_contract'),
    );

    // --- goal-fakepass-hardening t7：ux-reference 逐图建模对账（out-of-scope 加界）---
    results.push(...safeRun(() => checkUxReferenceMapping(ctx), 'ux_reference_mapping'));

    return results;
  },
};

/**
 * t7（codex 二轮 P1-2/四轮 P1-8）：每张参考图须映射 ui-spec 屏或显式 out-of-scope
 * 登记（裁剪证明：crop_of 父图 + reason）；需求正文直接引用的图片 agent 无权自划
 * out-of-scope；多数（>50%）out-of-scope → FAIL——"难还原的截图全标裁剪素材"后门关闭。
 */
function checkUxReferenceMapping(ctx: CheckContext): CheckResult[] {
  const id = 'ux_reference_mapping';
  const description = 'ux-reference 参考图逐图建模对账（未映射/越权 out-of-scope 拦截）';
  const uxDir = featureFilePath(ctx.projectRoot, ctx.feature, 'ux-reference');
  const IMAGE_RE = /\.(jpe?g|png|webp|bmp)$/i;
  let images: string[] = [];
  try {
    if (fs.existsSync(uxDir)) images = fs.readdirSync(uxDir).filter((f) => IMAGE_RE.test(f));
  } catch { /* 目录不可读按空处理 */ }
  if (images.length === 0) {
    return [{ id, category: 'structure', description, severity: 'MINOR', status: 'SKIP', details: '无 ux-reference 参考图。' }];
  }
  const uiSpecPath = featureFilePath(ctx.projectRoot, ctx.feature, path.join('spec', 'ui-spec.yaml'));
  const uiSpecRaw = fs.existsSync(uiSpecPath) ? fs.readFileSync(uiSpecPath, 'utf-8') : '';
  const refElementsPath = featureFilePath(ctx.projectRoot, ctx.feature, path.join('spec', 'ref-elements.yaml'));
  let outOfScope: Array<{ image?: string; reason?: string; crop_of?: string }> = [];
  try {
    if (fs.existsSync(refElementsPath)) {
      const doc = YAML.parse(fs.readFileSync(refElementsPath, 'utf-8')) as { out_of_scope?: typeof outOfScope };
      if (Array.isArray(doc?.out_of_scope)) outOfScope = doc.out_of_scope;
    }
  } catch { /* 解析失败按无登记 */ }
  const featuresDirRel = (loadFrameworkConfig(ctx.projectRoot).paths?.features_dir ?? 'doc/features').replace(/\\/g, '/');
  const reqText = collectRequirementIntentText(ctx.projectRoot, ctx.feature, featuresDirRel);

  const failures: string[] = [];
  const unmapped: string[] = [];
  let oosCount = 0;
  for (const img of images) {
    if (uiSpecRaw.includes(img)) continue; // 已映射建模
    const entry = outOfScope.find((e) => e.image === img);
    if (entry) {
      oosCount++;
      if (reqText.includes(img)) {
        failures.push(`${img}：需求正文直接引用的图片不得 agent 自划 out-of-scope`);
      } else if (!entry.crop_of || !entry.reason) {
        failures.push(`${img}：out-of-scope 登记缺裁剪证明（crop_of 父图 + reason）`);
      }
      continue;
    }
    unmapped.push(img);
  }
  if (oosCount * 2 > images.length) {
    failures.push(`out-of-scope 占多数（${oosCount}/${images.length}）——参考图整批跳过通道关闭`);
  }
  if (failures.length > 0) {
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'FAIL',
      details: failures.join('\n'),
      suggestion: '为参考图建模 ui-spec 屏；裁剪素材在 ref-elements.yaml out_of_scope 登记 crop_of+reason；需求引用图必须建模。',
    }];
  }
  if (unmapped.length > 0) {
    const ratchet = isPixel1to1(ctx)
      ? { severity: 'BLOCKER' as const, status: 'FAIL' as const }
      : { severity: 'MAJOR' as const, status: 'WARN' as const };
    return [{
      id, category: 'structure', description,
      severity: ratchet.severity, status: ratchet.status,
      details: `参考图未映射 ui-spec 屏且未登记 out-of-scope：${unmapped.join('、')}（漏建模的屏不会进视觉比对）。`,
      suggestion: '逐图建模或显式登记（登记进决议账本 must_review）。',
    }];
  }
  return [{
    id, category: 'structure', description,
    severity: 'BLOCKER', status: 'PASS',
    details: `${images.length} 张参考图全部映射/合法登记（out-of-scope ${oosCount}）。`,
  }];
}

/**
 * t6：把「有截图+完全参考类措辞却用 semantic_layout=禁止的降级」从 prose 机器化。
 * 事故对位：原始需求「完全参考」×7，spec 自声明 semantic_layout，整条视觉硬门禁失效；
 * fidelity-shared G2 注释自证 homepage 同模式复发（此前 TS 侧只有弱 nudge，无门禁）。
 * 豁免=fidelity_deferrals 真人签字降档条目（自动化身份/user_requirement 不算；
 * goal 环境须留名）——且仅降级 WARN，不产生干净通过。
 */
function checkFidelityIntentReconciliation(ctx: CheckContext): CheckResult[] {
  const id = 'fidelity_intent_reconciliation';
  const description = '保真档位声明 vs 需求 SSOT 强意图对账（强 1:1 意图禁止静默降档）';
  const specMd = loadSpecMarkdown(ctx.projectRoot, ctx.feature);
  if (!specMd) {
    return [{ id, category: 'structure', description, severity: 'MINOR', status: 'SKIP', details: 'spec.md 不存在。' }];
  }
  const handoff = parseVisualHandoffYamlRoot(specMd);
  const declared = parseFidelityTargetFromHandoffDoc(handoff);
  const featuresDirRel = (loadFrameworkConfig(ctx.projectRoot).paths?.features_dir ?? 'doc/features').replace(/\\/g, '/');
  const reqText = collectRequirementIntentText(ctx.projectRoot, ctx.feature, featuresDirRel) || specMd;
  const intent = detectFidelityIntent(reqText);
  if (intent !== 'strong_pixel' || declared === 'pixel_1to1') {
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'PASS',
      details: `intent=${intent}，declared=${declared}——无禁止的降级。`,
    }];
  }
  const deferrals = parseFidelityDeferrals(handoff);
  const headless = isGoalOrchestrationEnv();
  const covering = deferrals.find(
    (d) => /fidelity|档位|降档|pixel/i.test(`${d.element_id} ${d.reason ?? ''}`) &&
      isHumanSignedDeferral(d, { requireExplicitSigner: headless }),
  );
  if (covering) {
    return [{
      id, category: 'structure', description,
      severity: 'MAJOR', status: 'WARN',
      details:
        `需求 SSOT 为强 1:1 意图但声明 ${declared}——已有真人签字降档 deferral` +
        `（${covering.element_id}, signed_by=${covering.signed_by ?? 'n/a'}）。降级不洗白：run 封顶 AWAITING_HUMAN_REVIEW。`,
    }];
  }
  return [{
    id, category: 'structure', description,
    severity: 'BLOCKER', status: 'FAIL',
    details:
      `需求 SSOT 命中强 1:1 还原意图（完全参考/像素级/1比1 类措辞），但 spec 声明 fidelity_target=${declared}` +
      '——禁止的降级（bc-openCard/homepage 双事故同模式）。',
    suggestion:
      '将 fidelity_target 改为 pixel_1to1；或经用户确认在 fidelity_deferrals 增加真人签字降档条目' +
      '（human_signed: true + signed_by 真人署名；goal-mode-auto/user_requirement 不算）。',
  }];
}

export default checker;
