// ============================================================================
// fidelity-shared.ts — fidelity_target / asset_acquisition_mode / severity ratchet
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import type { CheckContext } from './types';
import { parseVisualHandoffYamlRoot, parseUiChangeFromSpecMarkdown, UI_CHANGE_REQUIRES_UI_SPEC } from './ui-spec-shared';
import { featureFilePath, relFeaturesDir } from '../../config';
import { readCanaryOcrCapableSignal } from './multimodal-probe';

const requireHarness = createRequire(path.resolve(__dirname, '../../harness-runner.ts'));
const YAML = requireHarness('yaml') as { parse: (s: string) => unknown };

/**
 * E2（多模态降级阶梯 plan d4a8f3c6）：`reference_only` 是能力地板（无视觉、无 OCR 时的钳制目标），
 * 与 `pixel_1to1`/`semantic_layout` 并列可声明——spec 作者或钳制逻辑均可写入。已 grep 核对全部
 * 19 处消费点（capture-completeness-check.ts / fidelity-governance-check.ts /
 * structured-ref-elements.ts / check-review.ts 等）均只做 `=== 'pixel_1to1'`/`!== 'pixel_1to1'`
 * 比较，从不比较 `'semantic_layout'` 字面量——新增第三态对既有消费面零行为影响，无需逐一改动。
 */
export type FidelityTarget = 'pixel_1to1' | 'semantic_layout' | 'reference_only';
export type AssetAcquisitionMode = 'approximate' | 'auto_crop' | 'user_dir';

const FIDELITY_TARGETS = new Set<FidelityTarget>(['pixel_1to1', 'semantic_layout', 'reference_only']);
const ASSET_MODES = new Set<AssetAcquisitionMode>(['approximate', 'auto_crop', 'user_dir']);

export interface FidelityDeferralEntry {
  element_id: string;
  reason?: string;
  /** 人类签字/批准标记（pixel_1to1 下必填） */
  human_signed?: boolean;
  signed_by?: string;
  signed_at?: string;
}

export interface RefElementEntry {
  element_id: string;
  screen_ref_id?: string;
  zone?: string;
  type?: string;
  text?: string;
  semantic_role?: string;
  color_ref?: string;
  icon_kind?: string;
  badge?: string;
  disposition: 'implement' | 'defer';
  /** structured | vl — 第二刀双写优先级 */
  provenance?: 'structured' | 'vl';
}

export interface RefElementsDoc {
  schema_version?: string;
  elements: RefElementEntry[];
}

export function parseFidelityTargetFromHandoffDoc(
  doc: Record<string, unknown> | null,
): FidelityTarget {
  if (!doc) return 'semantic_layout';
  const raw = doc.fidelity_target;
  if (typeof raw === 'string' && FIDELITY_TARGETS.has(raw.trim() as FidelityTarget)) {
    return raw.trim() as FidelityTarget;
  }
  return 'semantic_layout';
}

export function parseAssetAcquisitionModeFromHandoffDoc(
  doc: Record<string, unknown> | null,
): AssetAcquisitionMode {
  if (!doc) return 'approximate';
  const raw = doc.asset_acquisition_mode;
  if (typeof raw === 'string' && ASSET_MODES.has(raw.trim() as AssetAcquisitionMode)) {
    return raw.trim() as AssetAcquisitionMode;
  }
  return 'approximate';
}

export function parseFidelityDeferrals(doc: Record<string, unknown> | null): FidelityDeferralEntry[] {
  if (!doc) return [];
  const raw = doc.fidelity_deferrals;
  if (!Array.isArray(raw)) return [];
  const out: FidelityDeferralEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const elementId = rec.element_id;
    if (typeof elementId !== 'string' || !elementId.trim()) continue;
    out.push({
      element_id: elementId.trim(),
      reason: typeof rec.reason === 'string' ? rec.reason : undefined,
      human_signed: rec.human_signed === true,
      signed_by: typeof rec.signed_by === 'string' ? rec.signed_by : undefined,
      signed_at: typeof rec.signed_at === 'string' ? rec.signed_at : undefined,
    });
  }
  return out;
}

/**
 * G1 headless 自签伪造防线：goal-mode 等自动化身份不得冒充人类签字。
 * homepage 失败案例：fidelity_deferrals 全 signed_by=goal-mode-auto 却 human_signed:true。
 */
export const AUTOMATION_SIGNER_IDS = new Set<string>([
  'goal-mode-auto',
  'goal-mode',
  'goal-runner',
  'headless',
  'headless-auto',
  'auto',
  'system',
]);

export function isAutomationSigner(signedBy: string | undefined): boolean {
  if (typeof signedBy !== 'string') return false;
  return AUTOMATION_SIGNER_IDS.has(signedBy.trim().toLowerCase());
}

/**
 * G4b：用户在需求文本中的自然语言裁剪授权 sentinel（"资源可从原图/截图裁剪获取"）。
 * 属**合法的前置确认者**（用户即真人、需求文本即授权），**绝不可加入 AUTOMATION_SIGNER_IDS**。
 * headless 下 crop_confirmed_by=此值 视为有效前置确认，免 mid-run halt 直接裁。
 */
export const USER_REQUIREMENT_CONFIRMER = 'user_requirement';

/**
 * T2：pixel_1to1 P0 pass 屏的真人确认判据——`confirmed_by` 非空且非自动化身份。
 * 视觉裁判可信化主背靠：像素/文本-位置度量均被实测证伪（忠实屏误报），图标/颜色/样式类假 PASS
 * 不可约地需 VL/人判 → pixel_1to1 P0 屏判 pass 须真人过目确认，goal-mode-auto 等自签不算（headless 走 HALT）。
 */
export function isHumanConfirmed(confirmedBy: string | undefined): boolean {
  return typeof confirmedBy === 'string' && confirmedBy.trim().length > 0 && !isAutomationSigner(confirmedBy);
}

/**
 * P0-6（plan c9e2a7f4）：验真签名判据——**授权哨兵 ≠ 验真签名**。
 * user_requirement 是需求级授权（能不能做），不能替代对具体屏/资产的真人过目（有没有人看过）。
 * 2026-07-05 实锤：宿主 agent 以 confirmed_by='user_requirement' 伪签 T2，在其 shell 的 harness
 * 运行中实际通关（回执 blocker_count 0），仅因 goal-runner 干净环境重跑才被打回。
 * 凡"验真/过目"语义的 signer（T2 confirmed_by / bbox_verified_by / baked_text_defer_by /
 * deferral signed_by）一律用本判据；授权语义（crop_confirmed_by）保持既有判据不变。
 * 诚实边界：堵不住伪造人名字符串（headless 自写 signer 本质不可信）；彻底解=带外确认凭证（round7 P0-8）。
 */
export function isHumanVerified(signer: string | undefined): boolean {
  if (!isHumanConfirmed(signer)) return false;
  return signer!.trim().toLowerCase() !== USER_REQUIREMENT_CONFIRMER;
}

/**
 * 真人签字判据：human_signed:true 且 signed_by 非自动化身份。
 * signed_by 缺省视为人工（不破坏交互态既有行为）；仅显式自动化身份被拒。
 */
export function isHumanSignedDeferral(
  d: FidelityDeferralEntry,
  opts?: { requireExplicitSigner?: boolean },
): boolean {
  if (d.human_signed !== true) return false;
  if (isAutomationSigner(d.signed_by)) return false;
  // P0-6：user_requirement 属需求级授权哨兵，不算对具体豁免条目的真人签字。
  if (typeof d.signed_by === 'string' && d.signed_by.trim().toLowerCase() === USER_REQUIREMENT_CONFIRMER) return false;
  // headless：缺 signed_by 视为可疑自签（真人会留名）→ 不算人签；交互态缺省仍算人工。
  if (opts?.requireExplicitSigner) {
    return typeof d.signed_by === 'string' && d.signed_by.trim().length > 0;
  }
  return true;
}

/**
 * G2：从需求/spec 文本识别强 1:1 还原意图。命中即应置 fidelity_target: pixel_1to1。
 * homepage 失败案例：原始需求 6× "完全参考 X.jpg" 却被自动降级为 semantic_layout。
 * 注：强信号常在原始需求文档，spec.md 未必转述——故 TS 侧仅作弱兜底 nudge，主力在 spec 生成提示词。
 */
const PIXEL_1TO1_INTENT_PATTERNS: readonly RegExp[] = [
  /完全参考/, /完全按照/, /完全还原/, /精确还原/, /严格按/, /严格参照/, /照(着|图)/,
  /像素级/, /逐像素/, /100\s*%\s*还原/, /1\s*[:：比]\s*1/, /一比一/,
  /pixel[\s-]?perfect/i, /\b1\s*to\s*1\b/i,
];

export function detectPixel1to1Intent(text: string | null | undefined): boolean {
  if (typeof text !== 'string' || !text.trim()) return false;
  return PIXEL_1TO1_INTENT_PATTERNS.some(re => re.test(text));
}

// ----------------------------------------------------------------------------
// goal-fakepass-hardening t6：三态意图 + 需求 SSOT 解引用 + 只升不降
// ----------------------------------------------------------------------------

/**
 * ambiguous 信号：提到与截图/设计稿一致但非强 1:1 措辞（"尽量与截图一致"命中此类）——
 * 不自动定档，进确认流（headless preflight halt / 交互态问用户）。
 * bc-openCard 事故：manifest 摘要只有此类弱措辞，而被引用的原始需求.md「完全参考」×7
 * 是强信号——检测必须在解引用后的合并文本上做。
 */
export const AMBIGUOUS_SCREENSHOT_INTENT_PATTERNS: readonly RegExp[] = [
  /(与|跟|和)(参考)?(截图|设计稿|原图|效果图|参考图)[^。\n]{0,8}(一致|对齐|还原)/,
  /(按照?|参考|依照)(截图|设计稿|原图|效果图|参考图)/,
];

export type FidelityIntent = 'strong_pixel' | 'ambiguous' | 'none';

/** 三态意图：强信号（既有关键词表）优先于 ambiguous；两者皆无 → none。
 * @deprecated plan f6b2d9a4：门禁路由改用 detectDesiredFidelity（ambiguous 态删除
 * ——「与截图一致」类=瞄准截图 desired=pixel_1to1，严格度另轴）。保留仅供过渡。 */
export function detectFidelityIntent(text: string | null | undefined): FidelityIntent {
  if (typeof text !== 'string' || !text.trim()) return 'none';
  if (detectPixel1to1Intent(text)) return 'strong_pixel';
  if (AMBIGUOUS_SCREENSHOT_INTENT_PATTERNS.some((re) => re.test(text))) return 'ambiguous';
  return 'none';
}

// ============================================================================
// plan f6b2d9a4：三正交轴检测（质量目标/严格度/素材策略）——「非关键冲突不阻塞」
// 数据模型。inferred 只由需求文本推导（ratchet 锚点）；selected/effective 见
// resolveFidelityRoutingDecision。
// ============================================================================

export type AcceptanceStrictness = 'best_effort' | 'hard';

/** 否定邻域窗口：命中点前该窗口内出现否定词 → 该命中不作数（v3 P1-5 规则②：
 * 「不要求 pixel_1to1，semantic_layout 即可」不得先命中 pixel）。 */
const NEGATION_WINDOW = 12;
const NEGATION_TAIL_RE = /(不要求|不需要|无需|不必|不用|不追求|不做|不是|并非)\s*$/;

function isNegatedAt(text: string, index: number): boolean {
  return NEGATION_TAIL_RE.test(text.slice(Math.max(0, index - NEGATION_WINDOW), index));
}

/** 规范枚举字面量（显式声明优先于措辞推断；`pixel_1to1` 的下划线会挡 \b 词边界——
 * 五轮实锤，故手工列举变体）。 */
const ENUM_LITERAL_PATTERNS: ReadonlyArray<{ tier: FidelityTarget; re: RegExp }> = [
  { tier: 'pixel_1to1', re: /pixel[\s_-]?1\s*to\s*1/gi },
  { tier: 'semantic_layout', re: /semantic[\s_-]?layout/gi },
  { tier: 'reference_only', re: /reference[\s_-]?only/gi },
];

function collectNonNegatedMatches(text: string, re: RegExp): number[] {
  const out: number[] = [];
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = g.exec(text)) !== null) {
    if (!isNegatedAt(text, m.index)) out.push(m.index);
    if (m.index === g.lastIndex) g.lastIndex++;
  }
  return out;
}

/**
 * 质量目标轴（v7 定稿）：
 *   ① 显式规范枚举声明（非否定）> 一切措辞推断——多枚举同现取最高档（瞄高，clamp 兜底）；
 *   ② 强 1:1 措辞（既有词表，含否定过滤）→ pixel_1to1；
 *   ③ 「与截图一致/按截图」类参考措辞 → pixel_1to1（对照截图开发=瞄准截图；
 *      严格度由另一轴承载，能力 clamp 兜底——ambiguous 态删除）；
 *   ④ 无任何视觉措辞 → semantic_layout（既有默认不变）。
 * 「没有高保真（素材）/没有设计稿」是素材声明，不进本轴（见 detectAssetAcquisitionIntent）。
 */
export function detectDesiredFidelity(text: string | null | undefined): {
  desired: FidelityTarget;
  basis: 'explicit_enum' | 'strong_wording' | 'reference_wording' | 'default';
} {
  if (typeof text !== 'string' || !text.trim()) return { desired: 'semantic_layout', basis: 'default' };
  const enumHits = ENUM_LITERAL_PATTERNS
    .filter((p) => collectNonNegatedMatches(text, p.re).length > 0)
    .map((p) => p.tier);
  if (enumHits.length > 0) {
    const best = enumHits.sort((a, b) => FIDELITY_TIER_RANK[b] - FIDELITY_TIER_RANK[a])[0];
    return { desired: best, basis: 'explicit_enum' };
  }
  if (PIXEL_1TO1_INTENT_PATTERNS.some((re) => collectNonNegatedMatches(text, re).length > 0)) {
    return { desired: 'pixel_1to1', basis: 'strong_wording' };
  }
  if (AMBIGUOUS_SCREENSHOT_INTENT_PATTERNS.some((re) => collectNonNegatedMatches(text, re).length > 0)) {
    return { desired: 'pixel_1to1', basis: 'reference_wording' };
  }
  return { desired: 'semantic_layout', basis: 'default' };
}

/** hard 词表（v3 P1-5 规则③：须与视觉/保真语义在有限邻域内关联——需求其他章节的
 * 「严格验收」不得翻转视觉档位严格度）。 */
const HARD_STRICTNESS_PATTERNS: readonly RegExp[] = [
  /必须[^。\n]{0,4}(像素|1\s*[:：比]\s*1|pixel)/, /不接受降级/, /不许降级/, /不得降级/,
  /(达不到|不达标)[^。\n]{0,8}(不得|不能|禁止)[^。\n]{0,4}(继续|通过|交付)/,
  /严格验收/, /严格按[^。\n]{0,6}验收/,
];
const HARD_VISUAL_PROXIMITY = 40;
const VISUAL_SEMANTIC_TOKEN_RE = /(像素|保真|还原|视觉|参考图|截图|设计稿|效果图|原图|界面|UI|fidelity|pixel)/i;

/** 严格度轴：hard 词（视觉邻域内）→ hard；否则 best_effort（「尽量/尽可能」类
 * 与缺省同为 best_effort——缺省即默认，plan v3 P0-2）。 */
export function detectAcceptanceStrictness(text: string | null | undefined): AcceptanceStrictness {
  if (typeof text !== 'string' || !text.trim()) return 'best_effort';
  for (const re of HARD_STRICTNESS_PATTERNS) {
    for (const idx of collectNonNegatedMatches(text, re)) {
      const start = Math.max(0, idx - HARD_VISUAL_PROXIMITY);
      const end = Math.min(text.length, idx + HARD_VISUAL_PROXIMITY);
      if (VISUAL_SEMANTIC_TOKEN_RE.test(text.slice(start, end))) return 'hard';
    }
  }
  return 'best_effort';
}

/** 素材策略轴：需求输入/显式用户声明（ui-spec 声明仅为投影——v7）。
 * 「（无高保真素材）从截图裁剪获取」→ auto_crop；显式素材目录 → user_dir；
 * 无措辞 → null（调用方回落 approximate 缺省）。 */
export function detectAssetAcquisitionIntent(
  text: string | null | undefined,
): AssetAcquisitionMode | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  if (
    /(从|在)[^。\n]{0,12}(截图|原图|参考图)[^。\n]{0,10}(裁剪|裁切|截取|抠图|抠出|获取)/.test(text) ||
    /(截图|原图|参考图)[^。\n]{0,6}(里|中|上)[^。\n]{0,6}(裁剪|裁切|截取|抠)/.test(text)
  ) {
    return 'auto_crop';
  }
  if (/(提供|给定|指定|已备)[^。\n]{0,8}(素材|切图|资源|assets?)[^。\n]{0,4}(目录|文件夹|路径)?/.test(text) &&
      /(目录|文件夹|路径|dir)/i.test(text)) {
    return 'user_dir';
  }
  return null;
}

const REQUIREMENT_DOC_TOKEN_RE = /[\w\-./一-龥]+\.(?:md|txt|yaml)/g;
const REQUIREMENT_DOC_MAX_BYTES = 256 * 1024;

/**
 * 需求文本解引用：requirement 中出现的相对路径 token（存在、≤256KB、限 doc/ 与
 * features_dir 前缀）读入合并。事故对位：runner 只对 manifest 摘要做意图检测，
 * SSOT 文档从未被读过。
 */
export function dereferenceRequirementDocs(
  projectRoot: string,
  requirement: string | null | undefined,
  opts?: { featuresDirRel?: string; excludePrefixes?: string[] },
): { combined: string; resolvedPaths: string[] } {
  const base = typeof requirement === 'string' ? requirement : '';
  if (!base.trim()) return { combined: base, resolvedPaths: [] };
  const featuresDirRel = (opts?.featuresDirRel ?? 'doc/features').replace(/\\/g, '/');
  const allowedPrefixes = ['doc/', featuresDirRel.endsWith('/') ? featuresDirRel : `${featuresDirRel}/`];
  const excludedPrefixes = (opts?.excludePrefixes ?? []).map((p) => p.replace(/\\/g, '/'));
  const seen = new Set<string>();
  const parts = [base];
  const resolvedPaths: string[] = [];
  let m: RegExpExecArray | null;
  REQUIREMENT_DOC_TOKEN_RE.lastIndex = 0;
  while ((m = REQUIREMENT_DOC_TOKEN_RE.exec(base)) !== null) {
    const rel = m[0].replace(/\\/g, '/').replace(/^\.\//, '');
    if (seen.has(rel)) continue;
    seen.add(rel);
    if (!allowedPrefixes.some((p) => rel.startsWith(p))) continue;
    if (excludedPrefixes.some((p) => rel.startsWith(p))) continue;
    const abs = path.resolve(projectRoot, rel);
    if (!abs.startsWith(path.resolve(projectRoot) + path.sep)) continue; // 越界防线
    try {
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
      if (fs.statSync(abs).size > REQUIREMENT_DOC_MAX_BYTES) continue;
      parts.push(fs.readFileSync(abs, 'utf-8'));
      resolvedPaths.push(rel);
    } catch {
      /* 不可读跳过 */
    }
  }
  return { combined: parts.join('\n\n'), resolvedPaths };
}

// ============================================================================
// plan e7c2a4d8 T1d：goal-runs 权威枚举单一入口——结构性跳过 .dry 子树；无 manifest
// 目录二分（v22 P1）：bootstrap-only 残留（be1c48 形态：仅 detach.log/lock，无
// events/evidence）静默排除、走既有孤儿流程；已有 events/progress/phases 而 manifest
// 缺失=曾启动的 run 被破坏 → corruptRuns（不 throw——七轮教训：上层枚举消费者吞
// 异常；requirement hash/closure/completion/phase-lineage 四类门禁消费者见
// corruptRuns 非空必须 BLOCKER/INVALID，不得静默改选其他 run）。
// ============================================================================

export interface AuthoritativeGoalRuns {
  /** 权威 run 目录名（有 manifest.json；按名排序） */
  runs: string[];
  corruptRuns: Array<{ runId: string; reason: string }>;
}

export function listAuthoritativeGoalRuns(
  projectRoot: string,
  feature: string,
  featuresDirRel = 'doc/features',
): AuthoritativeGoalRuns {
  return classifyGoalRunsDir(path.join(projectRoot, featuresDirRel, feature, 'goal-runs'));
}

/** 绝对路径口径（verify-feature-completion 等经 featureFilePath 解析目录的消费面）。 */
export function classifyGoalRunsDir(runsDir: string): AuthoritativeGoalRuns {
  const out: AuthoritativeGoalRuns = { runs: [], corruptRuns: [] };
  if (!fs.existsSync(runsDir)) return out;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(runsDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    // 结构名（.dry 等点前缀目录）不入权威也不入 corrupt——目录名即隔离边界。
    if (ent.name.startsWith('.')) continue;
    const dir = path.join(runsDir, ent.name);
    if (fs.existsSync(path.join(dir, 'manifest.json'))) {
      out.runs.push(ent.name);
      continue;
    }
    const started =
      fs.existsSync(path.join(dir, 'events.jsonl')) ||
      fs.existsSync(path.join(dir, 'progress.json')) ||
      fs.existsSync(path.join(dir, 'phases'));
    if (started) {
      out.corruptRuns.push({
        runId: ent.name,
        reason: '目录已有 events/progress/phases 证据但 manifest.json 缺失——曾启动的 run 被破坏',
      });
    }
    // else：bootstrap-only 残留（仅 detach.log/lock）→ 静默排除。
  }
  out.runs.sort((a, b) => a.localeCompare(b));
  return out;
}

/**
 * 需求 SSOT 意图文本收集（check-spec 对账门禁消费）：全部 goal-run manifest 的
 * requirement + 各自解引用文档合并；无 goal run（纯交互）→ 空串（调用方回退 spec.md）。
 */
export function collectRequirementIntentText(
  projectRoot: string,
  feature: string,
  featuresDirRel = 'doc/features',
): string {
  const runsDir = path.join(projectRoot, featuresDirRel, feature, 'goal-runs');
  if (!fs.existsSync(runsDir)) return '';
  const parts: string[] = [];
  // T1d：权威枚举单一入口（跳过 .dry 与残留——dry manifest 不再进需求意图/hash）。
  for (const runId of listAuthoritativeGoalRuns(projectRoot, feature, featuresDirRel).runs) {
    const manifestPath = path.join(runsDir, runId, 'manifest.json');
    try {
      const m = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { requirement?: string };
      if (typeof m.requirement === 'string' && m.requirement.trim()) {
        parts.push(dereferenceRequirementDocs(projectRoot, m.requirement, {
          featuresDirRel,
          excludePrefixes: [`${featuresDirRel.replace(/\\/g, '/')}/${feature}/`],
        }).combined);
      }
    } catch { /* 单 manifest 损坏跳过 */ }
  }
  return parts.join('\n\n');
}

/**
 * 需求 SSOT 引用文档路径集（codex 六轮 P0-5：manifest.requirement 引用的原始需求/
 * 解引用文档必须进阶段血缘，否则改原始需求后上游 closure 仍判 fresh）。扫全部
 * goal-run manifest 的 requirement，返回项目根相对路径去重集（供 evidence extraInputs）。
 * ux-reference 目录下的参考图同样纳入（UI feature 的视觉 SSOT）。
 */
export function collectRequirementSsotPaths(
  projectRoot: string,
  feature: string,
  featuresDirRel = 'doc/features',
): string[] {
  const out = new Set<string>();
  const runsDir = path.join(projectRoot, featuresDirRel, feature, 'goal-runs');
  if (fs.existsSync(runsDir)) {
    // T1d：权威枚举单一入口（.dry/残留不入阶段血缘——更晚 dry run 不得改变 lineage）。
    for (const runId of listAuthoritativeGoalRuns(projectRoot, feature, featuresDirRel).runs) {
      const manifestPath = path.join(runsDir, runId, 'manifest.json');
      // codex 七轮 P0-2：manifest.json 本身入血缘——内联 manifest.requirement 被改
      //（不解引用任何文件）也必须使上游 closure stale。此前只收解引用文件，纯内联
      // 需求改写对 closure 隐形。
      out.add(path.join(featuresDirRel, feature, 'goal-runs', runId, 'manifest.json').split(path.sep).join('/'));
      try {
        const m = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { requirement?: string };
        for (const rel of dereferenceRequirementDocs(projectRoot, m.requirement, {
          featuresDirRel,
          excludePrefixes: [`${featuresDirRel.replace(/\\/g, '/')}/${feature}/`],
        }).resolvedPaths) {
          out.add(rel);
        }
      } catch { /* 单 manifest 损坏跳过 */ }
    }
  }
  // ux-reference 参考图
  const uxDir = path.join(projectRoot, featuresDirRel, feature, 'ux-reference');
  try {
    if (fs.existsSync(uxDir)) {
      for (const f of fs.readdirSync(uxDir)) {
        if (/\.(jpe?g|png|webp|bmp)$/i.test(f)) {
          out.add(path.join(featuresDirRel, feature, 'ux-reference', f).split(path.sep).join('/'));
        }
      }
    }
  } catch { /* 忽略 */ }
  return [...out].sort();
}

/**
 * 单个 run 的规范化 requirement 内容哈希（codex 八轮 P0-2：closure 血缘须绑定"当前权威
 * run 的 requirement"，而非扫描所有历史 manifest 文件路径）。取该 run manifest.requirement
 * 内联文本 + 解引用文档内容 + ux-reference 文件内容的稳定摘要——内容 hash 而非文件 hash，
 * 故换 run（新文件路径）带来的新需求也能被检测。runId 缺失/manifest 不可读 → null。
 */
export function computeRunRequirementSha(
  projectRoot: string,
  feature: string,
  runId: string | undefined,
  featuresDirRel = 'doc/features',
): string | null {
  if (!runId) return null;
  const manifestPath = path.join(projectRoot, featuresDirRel, feature, 'goal-runs', runId, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  let requirement: string;
  try {
    requirement = (JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { requirement?: string }).requirement ?? '';
  } catch {
    return null;
  }
  return computeRequirementShaFromText(projectRoot, feature, requirement, featuresDirRel);
}

/**
 * 内容级 requirement 血缘哈希（plan e7c2a4d8 T1a）：与 computeRunRequirementSha 共用
 * 同一 parts 组装路径——截断链 preflight 在 manifest 落盘前用内存 requirement 调本函数，
 * 两口径逐字节同构（closure 记录与 preflight 重算的比对语义不变）。
 */
export function computeRequirementShaFromText(
  projectRoot: string,
  feature: string,
  requirement: string,
  featuresDirRel = 'doc/features',
): string {
  const currentFeaturePrefix = `${featuresDirRel.replace(/\\/g, '/')}/${feature}/`;
  const deref = dereferenceRequirementDocs(projectRoot, requirement, {
    featuresDirRel,
    excludePrefixes: [currentFeaturePrefix],
  });
  const parts = [`inline:${requirement}`];
  for (const rel of deref.resolvedPaths.sort()) {
    try {
      parts.push(`${rel}:${fs.readFileSync(path.join(projectRoot, rel), 'utf-8')}`);
    } catch { /* skip */ }
  }
  // 参考图片由 reference receipt/gate 单独绑定；运行中生成的 feature 产物不得改变需求身份。
  return crypto.createHash('sha256').update(parts.join('\n'), 'utf-8').digest('hex');
}

const FIDELITY_TIER_RANK: Record<FidelityTarget, number> = {
  reference_only: 0,
  semantic_layout: 1,
  pixel_1to1: 2,
};

/** 档位枚举硬校验（十三轮 P0-1：resolveRequestedFidelity 对非法值静默回退 detected——
 * CLI/manifest 显式传值时必须显式拒，垃圾枚举不得静默入 manifest）。 */
export function isValidFidelityTarget(v: unknown): v is FidelityTarget {
  return typeof v === 'string' && FIDELITY_TARGETS.has(v as FidelityTarget);
}

/**
 * `--fidelity`/manifest.fidelity 只升不降（codex 三轮 P0-2：headless agent 可代跑命令
 * 自带 flag，flag ≠ 用户授权）：requested < detected → 无效（降档唯一通道=t10 receipt，
 * 调用方在凭证校验通过后显式传 downgradeAuthorized）。
 */
export function resolveRequestedFidelity(
  detected: FidelityTarget,
  requested: FidelityTarget | undefined,
  downgradeAuthorized = false,
): { effective: FidelityTarget; rejectedDowngrade: boolean } {
  if (!requested || !FIDELITY_TARGETS.has(requested)) {
    return { effective: detected, rejectedDowngrade: false };
  }
  if (FIDELITY_TIER_RANK[requested] >= FIDELITY_TIER_RANK[detected]) {
    return { effective: requested, rejectedDowngrade: false };
  }
  return downgradeAuthorized
    ? { effective: requested, rejectedDowngrade: false }
    : { effective: detected, rejectedDowngrade: true };
}

/** pixel_1to1 联动：默认抬升 user_dir */
export function effectiveAssetAcquisitionMode(
  fidelityTarget: FidelityTarget,
  declared: AssetAcquisitionMode,
): AssetAcquisitionMode {
  if (fidelityTarget === 'pixel_1to1' && declared === 'approximate') {
    return 'user_dir';
  }
  return declared;
}

export function isPixel1to1(ctx: CheckContext): boolean {
  return ctx.fidelityTarget === 'pixel_1to1';
}

/**
 * E2：能力钳制的输入——只取当前 goal-mode/adapter 实测的视觉能力与 OCR 环境就绪度，
 * 不含具体 adapter 名/模型名（钳制只关心"能不能看图/能不能 OCR"两个布尔量）。
 */
export interface FidelityCapability {
  /** adapter/模型是否具备图片输入能力（MultimodalProbeResult.supported 同型：tool_read|native_attach） */
  hasVision: boolean;
  /** isOcrAvailable()（profile 相关，由调用方探测传入——core 不硬依赖具体 profile 的 OCR 实现） */
  ocrAvailable: boolean;
}

export type FidelityClampReason = 'no_vision_ocr_available' | 'no_vision_no_ocr';

export interface FidelityClampResult {
  /** 有效档位——供 isPixel1to1 等全部消费面读取 */
  effective: FidelityTarget;
  clamped: boolean;
  reason?: FidelityClampReason;
}

/**
 * E2（多模态降级阶梯 plan d4a8f3c6）：desired（用户/需求声明）× capability（当前 adapter+
 * 环境实测）→ effective——**不改写** desired（保留意图供 ratchet 回升，只影响运行时有效档位）。
 * 钳制表：hasVision → 不钳（强模型效果好）；无视觉+OCR 可用 → pixel_1to1 钳到 semantic_layout
 * （案B chrys 银行卡实证：这正是让 OCR 全文覆盖门禁从无解题降为可跑通的关键）；
 * 无视觉+无OCR → 钳到 reference_only 地板（最弱也要能跑通，不能异常中断）。
 */
export function clampFidelityByCapability(
  desired: FidelityTarget,
  capability: FidelityCapability,
): FidelityClampResult {
  if (capability.hasVision) return { effective: desired, clamped: false };
  if (desired === 'reference_only') return { effective: desired, clamped: false };
  if (capability.ocrAvailable) {
    if (desired === 'pixel_1to1') {
      return { effective: 'semantic_layout', clamped: true, reason: 'no_vision_ocr_available' };
    }
    return { effective: desired, clamped: false };
  }
  // 无视觉也无 OCR：不论 desired 是 pixel_1to1 还是 semantic_layout，都钳到地板。
  return { effective: 'reference_only', clamped: true, reason: 'no_vision_no_ocr' };
}

export interface EffectiveFidelityContext {
  /** 有效档位（已钳制）——CheckContext.fidelityTarget 的赋值来源，全消费面单点收口于此 */
  fidelityTarget: FidelityTarget;
  /** 原始声明档位（未钳制，供 ratchet 回升 + intent_nudge 判"是否合法钳制"用） */
  declaredFidelityTarget: FidelityTarget;
  fidelityClamped: boolean;
  fidelityClampReason?: FidelityClampReason;
  assetAcquisitionMode: AssetAcquisitionMode;
  effectiveAssetAcquisitionMode: AssetAcquisitionMode;
  fidelityDeferrals: FidelityDeferralEntry[];
}

/**
 * 把 resolveFidelityContextFromFeature 的原始声明结果 × 能力钳制，合成 CheckContext 需要的
 * 完整字段集——harness-runner.ts 的唯一调用点，纯函数、可单测（capability 由调用方探测传入）。
 */
export function resolveEffectiveFidelityContext(
  raw: {
    fidelityTarget: FidelityTarget;
    assetAcquisitionMode: AssetAcquisitionMode;
    effectiveAssetAcquisitionMode: AssetAcquisitionMode;
    fidelityDeferrals: FidelityDeferralEntry[];
  },
  capability: FidelityCapability,
): EffectiveFidelityContext {
  const clamp = clampFidelityByCapability(raw.fidelityTarget, capability);
  return {
    fidelityTarget: clamp.effective,
    declaredFidelityTarget: raw.fidelityTarget,
    fidelityClamped: clamp.clamped,
    fidelityClampReason: clamp.reason,
    assetAcquisitionMode: raw.assetAcquisitionMode,
    effectiveAssetAcquisitionMode: raw.effectiveAssetAcquisitionMode,
    fidelityDeferrals: raw.fidelityDeferrals,
  };
}

// ============================================================================
// plan f6b2d9a4：两谓词拆分 + 三段式路由决策 + fidelity-intent SSOT / capability
// snapshot IO。执行类逻辑读 isPixelExecutionTarget；严重度抬升/人确认/封顶读
// isHardPixelContract（effective=pixel ∧ strictness=hard——不用 desired：有效降档
// receipt 放行 semantic 后不得再激活 pixel 硬门禁）。确定性完整性错误不经这两谓词。
// ============================================================================

/** 执行类谓词：是否按 pixel 目标运行高质量提取/diff/度量（=旧 isPixel1to1 语义）。 */
export function isPixelExecutionTarget(ctx: CheckContext): boolean {
  return ctx.fidelityTarget === 'pixel_1to1';
}

/** 裁决类谓词：质量缺口是否升级 BLOCKER/真人确认/completion 封顶。 */
export function isHardPixelContract(ctx: CheckContext): boolean {
  return ctx.fidelityTarget === 'pixel_1to1' && ctx.acceptanceStrictness === 'hard';
}

export interface FidelityRoutingInput {
  /** 解引用后的合并需求文本 */
  requirementText: string;
  /** manifest.fidelity（未校验原值——非法枚举由 transition 校验拦，此处忽略非法值） */
  manifestFidelity?: string;
  /** 该值来源（CLI 显式 / manifest 文件声明）——decision.source 用 */
  manifestFidelitySource?: 'explicit_cli' | 'manifest_declared';
  /** fidelity_downgrade receipt 验真结果（调用方验；本函数不读盘） */
  downgradeReceiptValid?: boolean;
  capability: FidelityCapability;
  /** goal run_id 或显式 phase execution identity（如 phase:<feature>:spec） */
  executionIdentity: string;
  requirementSha: string;
}

export type FidelityDecisionSource =
  | 'requirement_self_declared'
  | 'auto_default'
  | 'explicit_cli'
  | 'manifest_declared'
  | 'downgrade_receipt'
  | 'human_confirmed';

export interface FidelityRoutingDecision {
  inferred: FidelityTarget;
  selected: FidelityTarget;
  effective: FidelityTarget;
  strictness: AcceptanceStrictness;
  assetAcquisitionMode: AssetAcquisitionMode;
  clamped: boolean;
  clampReason?: FidelityClampReason;
  rejectedDowngrade: boolean;
  /** 唯一真冲突：selected=pixel ∧ strictness=hard ∧ clamp 降档 */
  defer: boolean;
  decision: { source: FidelityDecisionSource; rationale: string; decision_id: string };
}

/**
 * 三段式路由（v4 P0 冻结）：inferred（文本推导，ratchet 锚）→ selected（只升不降；
 * 有效降档 receipt 才许降）→ effective（能力 clamp）。纯函数，不读盘不探测——
 * capability/receipt 验真由调用方（goal-runner / initializer / check-spec 复核）供给。
 */
export function resolveFidelityRoutingDecision(input: FidelityRoutingInput): FidelityRoutingDecision {
  const det = detectDesiredFidelity(input.requirementText);
  const strictness = detectAcceptanceStrictness(input.requirementText);
  const assetIntent = detectAssetAcquisitionIntent(input.requirementText);
  const requested = isValidFidelityTarget(input.manifestFidelity) ? input.manifestFidelity : undefined;
  const sel = resolveRequestedFidelity(det.desired, requested, input.downgradeReceiptValid === true);
  const clamp = clampFidelityByCapability(sel.effective, input.capability);
  const defer = sel.effective === 'pixel_1to1' && strictness === 'hard' && clamp.clamped;

  const receiptDowngraded =
    input.downgradeReceiptValid === true && requested !== undefined &&
    sel.effective === requested && FIDELITY_TIER_RANK[requested] < FIDELITY_TIER_RANK[det.desired];
  const requestedApplied =
    requested !== undefined && sel.effective === requested && requested !== det.desired;
  const source: FidelityDecisionSource = receiptDowngraded
    ? 'downgrade_receipt'
    : requestedApplied
      ? (input.manifestFidelitySource ?? 'manifest_declared')
      : det.basis === 'default'
        ? 'auto_default'
        : 'requirement_self_declared';
  // routing_input_digest（v5 P2）：manifest/receipt/capability 任一变化 → 新 decision_id
  const digest = crypto.createHash('sha256').update(JSON.stringify({
    f: requested ?? null,
    r: input.downgradeReceiptValid === true,
    v: input.capability.hasVision,
    o: input.capability.ocrAvailable,
  })).digest('hex');
  const decision_id = crypto.createHash('sha256')
    .update(`${input.executionIdentity}|${input.requirementSha}|${digest}`)
    .digest('hex').slice(0, 16);
  const rationale =
    `inferred=${det.desired}(${det.basis}) selected=${sel.effective} effective=${clamp.effective}` +
    `${clamp.clamped ? `(clamped:${clamp.reason})` : ''} strictness=${strictness}` +
    ` asset=${assetIntent ?? 'approximate(default)'}`;
  return {
    inferred: det.desired,
    selected: sel.effective,
    effective: clamp.effective,
    strictness,
    assetAcquisitionMode: assetIntent ?? 'approximate',
    clamped: clamp.clamped,
    clampReason: clamp.reason,
    rejectedDowngrade: sel.rejectedDowngrade,
    defer,
    decision: { source, rationale, decision_id },
  };
}

// ---- fidelity-intent.json（唯一 SSOT）与 capability-snapshot.json IO ----

export const FIDELITY_INTENT_SCHEMA_VERSION = '2.0';

/**
 * plan c8e5b3f1 t1：需求来源裁判——`goal_manifest`=goal 模式（preflight vision policy 收紧重建）；
 * `explicit_cli`=手动阶段驱动显式 `--requirement(-file)`（解析结果 trim 非空）；`intent_fallback`=
 * 手动路径仅靠宽泛意图文本兜底（README/笔记/spec.md），**不**具备权威需求语义。
 * 字段省略=旧版 doc（legacy 兼容，不判 corrupt、也不解锁 derive.requirement）；在场但枚举非法
 * → 判 corrupt（半写/篡改不得被当 legacy 混过去）。`FIDELITY_INTENT_SCHEMA_VERSION` 不 bump。
 */
export type RequirementProvenance = 'goal_manifest' | 'explicit_cli' | 'intent_fallback';
const REQUIREMENT_PROVENANCES = new Set<RequirementProvenance>(['goal_manifest', 'explicit_cli', 'intent_fallback']);

export function isValidRequirementProvenance(v: unknown): v is RequirementProvenance {
  return typeof v === 'string' && REQUIREMENT_PROVENANCES.has(v as RequirementProvenance);
}

export interface FidelityIntentSsot {
  schema_version: string;
  inferred_fidelity: FidelityTarget;
  selected_fidelity: FidelityTarget;
  effective_fidelity: FidelityTarget;
  acceptance_strictness: AcceptanceStrictness;
  asset_acquisition_mode: AssetAcquisitionMode;
  clamped: boolean;
  clamp_reason?: FidelityClampReason;
  decision: { source: FidelityDecisionSource; rationale: string; decision_id: string };
  execution_identity: string;
  requirement_sha256: string;
  /** plan c8e5b3f1 t1：可选——writer 从此永远写；缺字段=旧版 doc（legacy 兼容）。 */
  requirement_provenance?: RequirementProvenance;
  /**
   * plan c4e8a1f7 T2：可选——requirement source 来源列表（项目根相对；与 goal manifest
   * 同源）。缺字段=旧版 doc（legacy 兼容，不判 corrupt）；在场须为字符串数组。
   */
  requirement_source_files?: string[];
}

export function fidelityIntentSsotPath(projectRoot: string, feature: string): string {
  return featureFilePath(projectRoot, feature, path.join('spec', 'reports', 'fidelity-intent.json'));
}

/** post-impl2 P1-3：SSOT 三态——missing（可自动初始化）/corrupt（完整性问题，恒 BLOCKER
 * 或 runner-owned 受控重建）/valid。损坏与缺失不得折叠（「损坏恒 BLOCKER」不变量）。 */
export type FidelityIntentSsotState =
  | { state: 'missing' }
  | { state: 'corrupt' }
  | { state: 'valid'; doc: FidelityIntentSsot };

export function loadFidelityIntentSsotState(projectRoot: string, feature: string): FidelityIntentSsotState {
  const s = loadFidelityIntentSsotStateInner(projectRoot, feature);
  return s;
}

export function loadFidelityIntentSsot(projectRoot: string, feature: string): FidelityIntentSsot | null {
  const s = loadFidelityIntentSsotStateInner(projectRoot, feature);
  return s.state === 'valid' ? s.doc : null;
}

function loadFidelityIntentSsotStateInner(projectRoot: string, feature: string): FidelityIntentSsotState {
  const p = fidelityIntentSsotPath(projectRoot, feature);
  if (!fs.existsSync(p)) return { state: 'missing' };
  try {
    const doc = JSON.parse(fs.readFileSync(p, 'utf-8')) as FidelityIntentSsot;
    // post-impl P1-6：全字段严格校验——部分损坏的 SSOT 不得被当权威输入消费
    //（返回 null=按缺失处理：UI 特性 pregate BLOCKER 指向重新初始化；v1 三态旧文件同路）。
    const validAsset = doc?.asset_acquisition_mode === 'approximate' ||
      doc?.asset_acquisition_mode === 'auto_crop' || doc?.asset_acquisition_mode === 'user_dir';
    const validStrict = doc?.acceptance_strictness === 'best_effort' || doc?.acceptance_strictness === 'hard';
    if (
      !isValidFidelityTarget(doc?.inferred_fidelity) ||
      !isValidFidelityTarget(doc?.selected_fidelity) ||
      !isValidFidelityTarget(doc?.effective_fidelity) ||
      !validStrict || !validAsset ||
      typeof doc?.clamped !== 'boolean' ||
      typeof doc?.decision?.source !== 'string' ||
      doc?.schema_version !== FIDELITY_INTENT_SCHEMA_VERSION ||
      typeof doc?.decision?.decision_id !== 'string' || !/^[0-9a-f]{16}$/i.test(doc.decision.decision_id) ||
      typeof doc?.execution_identity !== 'string' || !doc.execution_identity.trim() ||
      typeof doc?.requirement_sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(doc.requirement_sha256) ||
      // plan c8e5b3f1 t1：requirement_provenance 在场但枚举非法 → corrupt（半写/篡改不得当 legacy）；
      // 缺字段=旧版 doc，按 legacy 兼容不判 corrupt（不 bump schema_version）。
      (doc.requirement_provenance !== undefined && !isValidRequirementProvenance(doc.requirement_provenance)) ||
      // plan c4e8a1f7 T2：requirement_source_files 在场但形状非法 → corrupt；缺字段=legacy 兼容。
      (doc.requirement_source_files !== undefined &&
        (!Array.isArray(doc.requirement_source_files) ||
         doc.requirement_source_files.some((f) => typeof f !== 'string' || !f.trim()))) ||
      // clamp 关系：clamped=true 须携合法 reason；false 不得携（半改写即 corrupt）
      (doc.clamped === true && doc.clamp_reason !== 'no_vision_ocr_available' && doc.clamp_reason !== 'no_vision_no_ocr') ||
      (doc.clamped === false && doc.clamp_reason !== undefined) ||
      typeof doc?.decision?.rationale !== 'string' ||
      !['requirement_self_declared', 'auto_default', 'explicit_cli', 'manifest_declared',
        'downgrade_receipt', 'human_confirmed'].includes(doc.decision.source)
    ) {
      return { state: 'corrupt' };
    }
    return { state: 'valid', doc };
  } catch {
    return { state: 'corrupt' };
  }
}

export function writeFidelityIntentSsot(
  projectRoot: string,
  feature: string,
  d: FidelityRoutingDecision,
  ids: {
    executionIdentity: string;
    requirementSha: string;
    requirementProvenance: RequirementProvenance;
    /** plan c4e8a1f7 T2：可选来源列表（fidelity-intent SSOT 不建第二份图片清单） */
    requirementSourceFiles?: string[];
  },
): string {
  const p = fidelityIntentSsotPath(projectRoot, feature);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const doc: FidelityIntentSsot = {
    schema_version: FIDELITY_INTENT_SCHEMA_VERSION,
    inferred_fidelity: d.inferred,
    selected_fidelity: d.selected,
    effective_fidelity: d.effective,
    acceptance_strictness: d.strictness,
    asset_acquisition_mode: d.assetAcquisitionMode,
    clamped: d.clamped,
    ...(d.clampReason ? { clamp_reason: d.clampReason } : {}),
    decision: d.decision,
    execution_identity: ids.executionIdentity,
    requirement_sha256: ids.requirementSha,
    // plan c8e5b3f1 t1：writer 从此永远写（必填入参，TS 防漏接）。
    requirement_provenance: ids.requirementProvenance,
    ...(ids.requirementSourceFiles && ids.requirementSourceFiles.length > 0
      ? { requirement_source_files: ids.requirementSourceFiles }
      : {}),
  };
  // post-impl3 P1-4：tmp+rename 原子替换（半写崩溃不得留下截断 SSOT）
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf-8');
  fs.renameSync(tmp, p);
  return p;
}

/** post-impl3 P0-3：能力单源——快照判盲时 CheckContext.adapterImageInput 同步转 none
 * （否则 fidelity 已降档而 blind 门禁仍按 adapter 声明认「非盲」，crop 禁令/占位/
 * 问人清单被跳过）。无快照回落探测值。 */
export function deriveEffectiveAdapterImageInput<T extends string | undefined>(
  snapVisionVerdict: boolean | null,
  probeImageInput: T,
): T | 'none' {
  if (snapVisionVerdict === false) return 'none';
  return probeImageInput;
}

export interface CapabilitySnapshot {
  schema_version: string;
  execution_identity: string;
  /** post-impl4 P1-5：与 fidelity-intent SSOT 同批事务标记——pregate 强制两者一致 */
  decision_id?: string;
  vision: { verdict: boolean; source: string };
  ocr: { verdict: boolean; source: string };
  created_at: string;
}

export function capabilitySnapshotPath(projectRoot: string, feature: string): string {
  return featureFilePath(projectRoot, feature, path.join('spec', 'reports', 'capability-snapshot.json'));
}

export function writeCapabilitySnapshot(
  projectRoot: string,
  feature: string,
  snap: Omit<CapabilitySnapshot, 'schema_version' | 'created_at'>,
): string {
  const p = capabilitySnapshotPath(projectRoot, feature);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(
    tmp,
    `${JSON.stringify({ schema_version: '1.0', ...snap, created_at: new Date().toISOString() }, null, 2)}\n`,
    'utf-8',
  );
  fs.renameSync(tmp, p);
  return p;
}

export function loadCapabilitySnapshot(projectRoot: string, feature: string): CapabilitySnapshot | null {
  const p = capabilitySnapshotPath(projectRoot, feature);
  if (!fs.existsSync(p)) return null;
  try {
    const doc = JSON.parse(fs.readFileSync(p, 'utf-8')) as CapabilitySnapshot;
    if (
      typeof doc?.vision?.verdict !== 'boolean' || typeof doc?.ocr?.verdict !== 'boolean' ||
      typeof doc?.vision?.source !== 'string' || typeof doc?.ocr?.source !== 'string' ||
      typeof doc?.execution_identity !== 'string' || !doc.execution_identity.trim() ||
      typeof (doc as { decision_id?: unknown }).decision_id !== 'string' ||
      !/^[0-9a-f]{16}$/i.test((doc as { decision_id: string }).decision_id) ||
      doc.schema_version !== '1.0' ||
      typeof doc?.created_at !== 'string' || !doc.created_at.trim() ||
      !doc.vision.source.trim() || !doc.ocr.source.trim()
    ) return null;
    return doc;
  } catch {
    return null;
  }
}

/** pixel_1to1 下关键视觉项 ratchet：WARN → FAIL/BLOCKER。
 * plan f6b2d9a4 P0-1：裁决类升级只在 **hard contract**（effective=pixel ∧ hard）生效
 * ——best_effort 的质量缺口维持缺省严重度并记债务，不再借 pixel 目标抬 BLOCKER。 */
export function fidelityRatchetSeverity(
  ctx: CheckContext,
  defaultSeverity: 'BLOCKER' | 'MAJOR' | 'MINOR',
  opts?: { elevateWarnToBlocker?: boolean },
): 'BLOCKER' | 'MAJOR' | 'MINOR' {
  if (!isHardPixelContract(ctx)) return defaultSeverity;
  if (defaultSeverity === 'MAJOR' || opts?.elevateWarnToBlocker) {
    return 'BLOCKER';
  }
  return defaultSeverity;
}

export function fidelityRatchetFailOrWarn(
  ctx: CheckContext,
  softWouldWarn: boolean,
): { severity: 'BLOCKER' | 'MAJOR'; status: 'FAIL' | 'WARN' } {
  if (isHardPixelContract(ctx)) {
    return { severity: 'BLOCKER', status: 'FAIL' };
  }
  return softWouldWarn
    ? { severity: 'MAJOR', status: 'WARN' }
    : { severity: 'BLOCKER', status: 'FAIL' };
}

export function loadSpecMarkdown(projectRoot: string, feature: string): string | null {
  const p = featureFilePath(projectRoot, feature, path.join('spec', 'spec.md'));
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf-8');
}

/**
 * 意图文本收集（含 phase-driven 回退）：collectRequirementIntentText 只读 goal-run
 * manifest——逐阶段驱动路径（无 goal-runs）恒空串，正是覆盖缺口的实体。回退源：
 * feature 根目录需求文档（*.md/*.txt，产物投影 visual-debt.md 除外）+ spec.md，
 * 各自过 dereferenceRequirementDocs（同源解引用，勿 fork）。
 *
 * plan f3a8c6d2 t5a：由 check-spec.ts 下沉至此（三个依赖 collectRequirementIntentText /
 * dereferenceRequirementDocs / loadSpecMarkdown 本就都在本文件），使 capability-resolution
 * 的 derive.visual-reference 可复用同源收集器而不反向依赖 check 脚本。check-spec.ts 保留
 * 同名 re-export，既有消费方（fidelity-intent-init）零改动。
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

export function loadHandoffDocFromFeature(projectRoot: string, feature: string): Record<string, unknown> | null {
  const md = loadSpecMarkdown(projectRoot, feature);
  if (!md) return null;
  return parseVisualHandoffYamlRoot(md);
}

/** 从 feature spec.md 解析 fidelity 上下文字段（供 harness-runner 注入 CheckContext） */
export function resolveFidelityContextFromFeature(
  projectRoot: string,
  feature: string,
): {
  fidelityTarget: FidelityTarget;
  assetAcquisitionMode: AssetAcquisitionMode;
  effectiveAssetAcquisitionMode: AssetAcquisitionMode;
  fidelityDeferrals: FidelityDeferralEntry[];
} {
  const doc = loadHandoffDocFromFeature(projectRoot, feature);
  const fidelityTarget = parseFidelityTargetFromHandoffDoc(doc);
  const declared = parseAssetAcquisitionModeFromHandoffDoc(doc);
  return {
    fidelityTarget,
    assetAcquisitionMode: declared,
    effectiveAssetAcquisitionMode: effectiveAssetAcquisitionMode(fidelityTarget, declared),
    fidelityDeferrals: parseFidelityDeferrals(doc),
  };
}

export function refElementsAbsPath(projectRoot: string, feature: string): string {
  return featureFilePath(projectRoot, feature, path.join('spec', 'ref-elements.yaml'));
}

/**
 * P0-2（plan 7c4f2e9b）：报错/affected_files 用的 spec/ 相对路径——与 refElementsAbsPath
 * **同源**。事故实证：relFeatureArtifact('ref-elements.yaml') 落 feature 根路径，agent 照
 * 报错把文件 cp 到根目录白耗时间（归档里因此存在双份 ref-elements.yaml）。
 */
export function refElementsRelPath(projectRoot: string, feature: string): string {
  return path.relative(projectRoot, refElementsAbsPath(projectRoot, feature)).replace(/\\/g, '/');
}

export function assetManifestAbsPath(projectRoot: string, feature: string): string {
  return featureFilePath(projectRoot, feature, path.join('spec', 'asset-manifest.yaml'));
}

export function loadRefElementsFile(absPath: string): RefElementsDoc | null {
  if (!fs.existsSync(absPath)) return null;
  try {
    const doc = YAML.parse(fs.readFileSync(absPath, 'utf-8')) as RefElementsDoc;
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.elements)) return null;
    return doc;
  } catch {
    return null;
  }
}

export type RefElementsDenominatorSource = 'memory_manifest' | 'disk';

/** capture-completeness 分母：同 run 内存 manifest 优先，否则只读磁盘 ref-elements.yaml */
export function resolveRefElementsDenominator(
  ctx: CheckContext,
  projectRoot: string,
  feature: string,
): {
  elements: RefElementEntry[] | null;
  source: RefElementsDenominatorSource | null;
  detail?: string;
} {
  if (ctx.refElementsManifest && ctx.refElementsManifest.length > 0) {
    return {
      elements: ctx.refElementsManifest,
      source: 'memory_manifest',
      detail: ctx.refElementsManifestDetail,
    };
  }
  const refAbs = refElementsAbsPath(projectRoot, feature);
  const doc = loadRefElementsFile(refAbs);
  if (!doc?.elements?.length) {
    return { elements: doc?.elements ?? null, source: doc ? 'disk' : null };
  }
  return { elements: doc.elements, source: 'disk' };
}

/** pixel_1to1：ref-elements disposition=defer 须对应 fidelity_deferrals 且 human_signed */
export function findUnsignedRefElementDefers(
  refDoc: RefElementsDoc,
  deferrals: FidelityDeferralEntry[],
  opts?: { requireExplicitSigner?: boolean },
): string[] {
  const signedIds = new Set(
    deferrals.filter(d => isHumanSignedDeferral(d, opts)).map(d => d.element_id.toLowerCase()),
  );
  const declaredIds = new Set(deferrals.map(d => d.element_id.toLowerCase()));
  const violations: string[] = [];
  for (const el of refDoc.elements) {
    if (el.disposition !== 'defer') continue;
    const lower = el.element_id.toLowerCase();
    if (!declaredIds.has(lower)) {
      violations.push(`${el.element_id}（ref-elements defer 未登记 fidelity_deferrals）`);
    } else if (!signedIds.has(lower)) {
      violations.push(`${el.element_id}（fidelity_deferrals 未 human_signed）`);
    }
  }
  return violations;
}

/** P0 视觉元素 id 前缀/关键词（defer 须人类签字） */
export const P0_VISUAL_ELEMENT_HINTS = [
  'search_bar',
  'search',
  'promo_badge',
  'badge',
  'brand_logo',
  'logo',
  'nfc',
  'illustration',
  'semantic_color',
] as const;

export function isP0VisualElementId(elementId: string): boolean {
  const lower = elementId.toLowerCase();
  return P0_VISUAL_ELEMENT_HINTS.some(h => lower.includes(h));
}

// ============================================================================
// E0（多模态降级阶梯 plan d4a8f3c6）：能力感知 phase prompt 支撑函数
// ============================================================================

/**
 * 需求文本"涉及 UI"的宽松探测（比 detectPixel1to1Intent 的 1:1 强意图更宽泛——
 * 这里只判"是不是 UI 类需求"，不判保真强度）。首次 spec invoke 前 spec.md 不存在，
 * 无法读 ui_change 字段，只能退回需求文本启发式；spec.md 写出后应改用
 * UI_CHANGE_REQUIRES_UI_SPEC.has(parseUiChangeFromSpecMarkdown(...))（更权威）。
 */
const UI_RELEVANT_PATTERNS: readonly RegExp[] = [
  /页面/, /界面/, /截图/, /参考图/, /设计稿/, /视觉/, /还原/, /布局/, /组件/,
  /交互稿/, /原型图/, /配色/, /样式/, /图标/, /\bUI\b/i, /\bUX\b/i, /figma/i, /icon/i,
];

export function detectUiRelevantRequirement(text: string | null | undefined): boolean {
  if (typeof text !== 'string' || !text.trim()) return false;
  return UI_RELEVANT_PATTERNS.some(re => re.test(text));
}

/**
 * codex review（E6 后复核）发现的口径不一致：resolvePhaseCapabilityAdvisory（goal-runner.ts）
 * 优先信 spec.md 的 ui_change 字段（更权威，spec.md 存在时 requirement 文本可能只是简短的
 * "继续完成该需求"），但 decideVisionCanaryProbe（goal-preflight.ts，先于任何 phase 跑）
 * 此前只看 requirement 文本——resume/继续 coding 场景下会被误判 not_ui_relevant 而跳过金丝雀，
 * 让案A（mx 2.7 套壳）"假视觉"风险在 resume 场景重新露头。抽出单一函数两处共用，避免再次分岔。
 */
export function resolveUiRelevanceForRun(
  projectRoot: string,
  feature: string,
  requirement: string | null | undefined,
): boolean {
  const specMd = loadSpecMarkdown(projectRoot, feature);
  if (specMd) {
    const uiChange = parseUiChangeFromSpecMarkdown(specMd);
    return uiChange !== null && UI_CHANGE_REQUIRES_UI_SPEC.has(uiChange);
  }
  return detectUiRelevantRequirement(requirement);
}

/** 参考图受支持扩展名（与声明面统一，review 裁决：png/jpg/jpeg/webp——不含 bmp，
 * 避免"发现但不能合法声明"的永久假分母）。OCR 预扫、source sibling 扫描与 ux-reference
 * 回退共用一份枚举。 */
const OCR_PRESCAN_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function listImageFilesInDir(absDir: string): string[] {
  try {
    if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) return [];
    return fs
      .readdirSync(absDir)
      .filter(f => OCR_PRESCAN_IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()))
      .map(f => path.join(absDir, f))
      .sort();
  } catch {
    return [];
  }
}

function listSiblingImageFilesInDir(absDir: string): string[] {
  return listImageFilesInDir(absDir);
}

/**
 * requirement 文本里锚定 features_dir（如 "doc/features"）起点的路径引用——CJK 文本没有
 * 空格分隔，"参考图在doc/features/..."里"在"与路径无缝相连，纯 bidirectional token 正则
 * 会把前缀中文动词一起吞进去（曾踩坑：把"参考图在doc"当一个 token，resolve 到不存在的
 * 目录）；反过来贪婪向后延伸又会把"...目录下"这类中文尾缀（口语描述，非路径段）一起吞掉。
 * 解法：只认**从 features_dir 字面量开始**的匹配（不吃前缀 prose），贪婪向后收集
 * `/segment` 直到分隔符终止，再从最长到最短逐段回缩找**磁盘上真实存在**的最长前缀——
 * 天然跳过"目录下"这类不存在的伪路径段，不必理解中文语法。
 */
function extractExistingRequirementPathRefs(requirement: string, projectRoot: string): string[] {
  const anchor = relFeaturesDir(projectRoot).replace(/\\/g, '/');
  if (!anchor) return [];
  const escapedAnchor = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escapedAnchor}(?:[\\\\/][\\w.\\u4e00-\\u9fa5-]+)*`, 'g');
  const matches = requirement.match(re) ?? [];
  const resolved: string[] = [];
  for (const m of matches) {
    const segments = m.split(/[\\/]/).filter(Boolean);
    for (let end = segments.length; end >= 1; end--) {
      const candidate = segments.slice(0, end).join('/');
      const abs = path.resolve(projectRoot, candidate);
      if (fs.existsSync(abs)) {
        resolved.push(abs);
        break; // 取最长存在前缀，命中即停，不再回缩更短的
      }
    }
  }
  return resolved;
}

/**
 * plan c4e8a1f7 T2：**单一 bounded 参考图发现集合**（全消费面共享的期望分母）。
 * 语义冻结：
 *   1. 需求文本中可解析的显式项目图片（既有 extractExistingRequirementPathRefs 语义）
 *      UNION
 *   2. 项目内 requirement source 各**直接父目录**的一层受支持图片（非递归）
 *   3. canonical path 去重 + 确定性排序
 *   4. 仅当并集为空才 fallback 到 feature `ux-reference/`
 * inline requirement（无 sources）不触发 sibling 扫描；项目外 source 只读正文、不扫描其
 * sibling。返回绝对路径数组。
 */
export function resolveRequirementReferenceImages(
  projectRoot: string,
  feature: string,
  requirement: string | undefined,
  opts?: { requirementSourceFiles?: string[] },
): string[] {
  const found = new Set<string>();
  if (requirement) {
    for (const abs of extractExistingRequirementPathRefs(requirement, projectRoot)) {
      if (OCR_PRESCAN_IMAGE_EXTENSIONS.has(path.extname(abs).toLowerCase())) {
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) found.add(abs);
        continue;
      }
      for (const img of listImageFilesInDir(abs)) found.add(img);
    }
  }
  // 项目内 source 直接父目录一层扫描（项目外 source 不扫描）。
  const projectRootAbs = path.resolve(projectRoot);
  for (const src of opts?.requirementSourceFiles ?? []) {
    const srcAbs = path.isAbsolute(src) ? src : path.resolve(projectRoot, src);
    if (!srcAbs.startsWith(projectRootAbs + path.sep)) continue; // 项目外：只读正文不扫描
    const parentDir = path.dirname(srcAbs);
    for (const img of listSiblingImageFilesInDir(parentDir)) found.add(img);
  }
  if (found.size === 0) {
    const uxRefDir = featureFilePath(projectRoot, feature, 'ux-reference');
    for (const img of listImageFilesInDir(uxRefDir)) found.add(img);
  }
  return [...found].sort();
}

/**
 * E0③（codex 采纳的参考图发现规则）：首次 spec invoke 前 spec.md / visual_handoff.
 * authoritative_refs 尚不存在，不能复用既有"从 spec 收集图片"的路径。deterministic
 * pre-scan 顺序：①requirement 文本中锚定 features_dir 的显式目录/文件路径引用 → 该目录下
 * 图片文件；②回退 feature 既有 ux-reference/ 目录；③扫不到图源 → 空数组（调用方据此跳过
 * OCR 预跑，绝不造假分母）。返回绝对路径，按文件名排序（确定性，供幂等 OCR 落盘用）。
 * plan c4e8a1f7 T2：委托共享发现集合（正文显式 ∪ source 直接父目录一层；仅空集回退
 * ux-reference）——与 capability/refs receipt/prompt 同一分母，不另实现第二套。
 */
export function discoverReferenceImagesForOcrPrescan(
  projectRoot: string,
  feature: string,
  requirement: string | undefined,
  opts?: { requirementSourceFiles?: string[] },
): string[] {
  return resolveRequirementReferenceImages(projectRoot, feature, requirement, {
    requirementSourceFiles: opts?.requirementSourceFiles,
  });
}

/** ocr-toolkit.ts 的 OcrWord/OcrLine 同型（profile 侧真实签名——bbox 为 [x,y,w,h] 归一化，
 * 非 x0/y0/x1/y1；此前误写过后者，E6 核对时改正，未曾被消费故属潜伏未爆的类型错配）。 */
export interface ProfileOcrWordLike {
  text: string;
  conf: number;
  bbox: [number, number, number, number];
}
export interface ProfileOcrLineLike {
  text: string;
  box: [number, number, number, number];
  words: ProfileOcrWordLike[];
}

/** 与 ocr-toolkit.ts 的公开函数同型（profile 侧真实签名的子集，E6 扩展：聚类/噪声过滤/候选真文本/列分组）。 */
export interface ProfileOcrToolkit {
  isOcrAvailable: () => boolean;
  ocrImageWords: (imagePath: string) => {
    ok: boolean;
    error?: string;
    width?: number;
    height?: number;
    words?: ProfileOcrWordLike[];
  };
  /** E6①②：词→行聚类（与 capture_completeness_external 门禁同一份实现，"同源化"）。 */
  clusterOcrLines?: (words: ProfileOcrWordLike[]) => ProfileOcrLineLike[];
  /** E6①②：噪声过滤（状态栏/纯符号剔除）——与门禁侧同一份实现。 */
  collectAuditableOcrLines?: (lines: ProfileOcrLineLike[]) => ProfileOcrLineLike[];
  /** E6③：噪声前缀/后缀 + 最长 CJK 游程候选真文本提取。 */
  extractLikelyRealTextRun?: (
    lineText: string,
  ) => { candidate: string; noisePrefix: string; noiseSuffix: string } | null;
  /** E6①：行内按 x 显著 gap 列分组（辅助结构推断）。 */
  detectColumnGroups?: (line: ProfileOcrLineLike) => string[];
}

/**
 * OCR 工具链按 profileDir 通用路径动态加载——不硬编码 'hmos-app'（generic 等无 OCR 资产的
 * profile require 会失败，按设计返回 null，不是错误）。与 capability-registry.ts 的
 * provider 动态 require（path.join(resolved.profileDir, 'harness', 'providers', ...)）
 * 同构，供 harness-runner.ts（钳制探测）与 goal-runner.ts（E0/E6 OCR 预扫描）共用，避免重复实现。
 * E6①②新增函数为可选（非全 profile 都实现列分组/候选提取——降级为仅原始 words 可用）。
 */
export function loadProfileOcrToolkit(profileDir: string): ProfileOcrToolkit | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(path.join(profileDir, 'harness', 'ocr-toolkit')) as Partial<ProfileOcrToolkit>;
    if (typeof mod.isOcrAvailable !== 'function' || typeof mod.ocrImageWords !== 'function') return null;
    return {
      isOcrAvailable: mod.isOcrAvailable,
      ocrImageWords: mod.ocrImageWords,
      ...(typeof mod.clusterOcrLines === 'function' ? { clusterOcrLines: mod.clusterOcrLines } : {}),
      ...(typeof mod.collectAuditableOcrLines === 'function'
        ? { collectAuditableOcrLines: mod.collectAuditableOcrLines }
        : {}),
      ...(typeof mod.extractLikelyRealTextRun === 'function'
        ? { extractLikelyRealTextRun: mod.extractLikelyRealTextRun }
        : {}),
      ...(typeof mod.detectColumnGroups === 'function' ? { detectColumnGroups: mod.detectColumnGroups } : {}),
    };
  } catch {
    return null; // profile 无 OCR 工具链（如 generic）——非错误，按"无 OCR"处理
  }
}

export function probeProfileOcrAvailable(profileDir: string): boolean {
  const toolkit = loadProfileOcrToolkit(profileDir);
  return toolkit ? toolkit.isOcrAvailable() : false;
}

/**
 * cursor review（E6 后复核）发现：harness-runner（门禁钳制）此前只看 `probeProfileOcrAvailable`，
 * goal-runner（prompt 能力块）额外 OR 了金丝雀 `ocr_capable` 信号——两处口径不一致，会出现
 * "agent 被告知 semantic_layout 可尝试 OCR，门禁却钳到 reference_only" 的文案不一致。收口为
 * 单一函数，两处共用同一口径。
 */
export function resolveOcrAvailableForRun(
  projectRoot: string,
  profileDir: string,
  adapterName: string | undefined,
  identity?: import('./multimodal-probe').CanaryExecutionIdentity,
): boolean {
  return probeProfileOcrAvailable(profileDir) || readCanaryOcrCapableSignal(projectRoot, adapterName, identity);
}
