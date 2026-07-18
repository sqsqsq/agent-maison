// ============================================================================
// visual-debt.ts — 视觉债务 SSOT（blind-visual-hardening d5 / plan a9d4c7e2 P0-D）
// ----------------------------------------------------------------------------
// 事故锚：bc-openCard 二轮"基线未校验/素材未验真/保真不作结论"全埋 WARN/soft_advisories，
// test-report「达标可发布」零 caveat。本模块：
//   ① harness 从 check 结果**派生**债务清单（非 agent 自报）→ visual-debt.json（机器真值）
//     + visual-debt.md（人类投影，对齐 headless-assumptions JSONL→md 惯例）；
//   ② 状态三态 open|closed|accepted（design §1.4：closed=已修复；accepted=仍存在但用户经
//     receipt 显式接受——审计语义分立，两者均不再阻断 release，报表分列）；
//   ③ 人工视觉验收 receipt 消费边界（design §1.8 + codex 四轮④⑤）：
//     - rubric 阈值**冻结**：每维 ≥4/5；任一维=3 须显式 accepted_debt_id；1-2 分不得通过；
//     - screens 结构化映射绑定（hash 调序不能验签通过）——object_hash=矩阵规范化哈希；
//     - **只清偿 needs_human（主观视觉）项；needs_fix（确定性 FAIL）拒绝清偿**（修复重跑唯一出路）；
//   ④ 素材三态清偿字段（P1-F 消费）：source/binding/render 全 VERIFIED 才 closed。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { featureDir } from '../../config';
import type { CheckResult } from './types';

export const VISUAL_DEBT_SCHEMA_VERSION = '1.0';
export const RUBRIC_VERSION = 'r1-frozen';
/** 冻结阈值（验收前定死，禁"看结果再调线"——codex 三轮⑤） */
export const RUBRIC_MIN_PASS = 4;
export const RUBRIC_CONDITIONAL = 3;

export type DebtStatus = 'open' | 'closed' | 'accepted';
export type DebtResolutionClass = 'needs_fix' | 'needs_human';
export type AssetVerifyState = 'VERIFIED' | 'UNVERIFIED';

export interface VisualDebtEntry {
  id: string;
  source_check_id: string;
  severity: string;
  summary: string;
  status: DebtStatus;
  resolution_class: DebtResolutionClass;
  asset_key?: string;
  screen_id?: string;
  accepted_by?: string;
  acceptance_receipt?: string;
  /** P1-F 三态清偿（素材类条目）：文件 sanity / 源码绑定 / 设备渲染可见 */
  asset_source_status?: AssetVerifyState;
  asset_binding_status?: AssetVerifyState;
  asset_render_status?: AssetVerifyState;
}

export interface VisualDebtDoc {
  schema_version: string;
  feature: string;
  entries: VisualDebtEntry[];
}

/** 债务源 check（id → 归类）；FAIL→needs_fix，WARN/BLOCKER-SKIP→needs_human（待人工裁量/验收） */
const DEBT_SOURCE_CHECKS: Record<string, { label: string }> = {
  visual_parity_unverified_crop: { label: '素材未验真（crop 未过 asset_crop_validation）' },
  asset_materialization_sanity: { label: '物化素材 sanity 违例（空白/纯色/损坏/role 失配）' },
  asset_placeholder_present: { label: '素材为 maison 占位（可见但≠真素材已供给）' },
  static_fidelity_score: { label: '静态保真分未评估/未达（基线未校验）' },
  visual_parity: { label: '视觉结构 presence 违例' },
  render_visibility_calibrate: { label: '设备渲染可见性观察命中（节点在、像素不可见）' },
  visual_multimodal_parity: { label: '视觉多模态层降级（盲档 SKIP，保真未验）' },
  capture_completeness_external: { label: '参考图覆盖缺口（盲档待人工复核清单）' },
  visual_diff: { label: '设备视觉对照未产出/未达' },
  ui_kit_runtime_conformance: { label: '语义容器运行时未命中（渲染路径断）' },
};

export function visualDebtJsonPath(projectRoot: string, feature: string): string {
  return path.join(featureDir(projectRoot, feature), 'visual-debt.json');
}

export function visualDebtMdPath(projectRoot: string, feature: string): string {
  return path.join(featureDir(projectRoot, feature), 'visual-debt.md');
}

export type VisualDebtLoad =
  | { state: 'missing'; doc: null }
  | { state: 'valid'; doc: VisualDebtDoc }
  | { state: 'invalid'; doc: null; reason: string };

/**
 * 三态加载（codex 三轮 P0-1）：损坏的债务账本**不得**被当成"不存在"——那会绕过单调 ledger
 * （损坏→null→零历史→本轮无新债→READY）。invalid 由消费方 fail-closed（管线抛错进
 * BLOCKED 路径，且不覆盖原文件——保留取证现场）。
 */
export function loadVisualDebtEx(projectRoot: string, feature: string): VisualDebtLoad {
  const p = visualDebtJsonPath(projectRoot, feature);
  if (!fs.existsSync(p)) return { state: 'missing', doc: null };
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8')) as VisualDebtDoc;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) {
      return { state: 'invalid', doc: null, reason: 'entries 缺失/形状非法' };
    }
    return { state: 'valid', doc: parsed };
  } catch (e) {
    return { state: 'invalid', doc: null, reason: `JSON 解析失败：${(e as Error).message}` };
  }
}

/** @deprecated 消费面请用 loadVisualDebtEx（三态）；本函数保留只读展示用途（invalid 归 null） */
export function loadVisualDebt(projectRoot: string, feature: string): VisualDebtDoc | null {
  const r = loadVisualDebtEx(projectRoot, feature);
  return r.state === 'valid' ? r.doc : null;
}

interface CheckLike {
  id: string;
  status: CheckResult['status'];
  severity: CheckResult['severity'];
  details: string;
  structured?: unknown;
}

/**
 * 单调 ledger reducer（codex 实施 review P0-1 重构）：
 *   - check 本轮**缺席**（该 phase 不跑此检查）→ 历史条目原样保留——债务跨阶段单调，
 *     coding 期的债不因 testing 期不跑 visual_parity 而蒸发；
 *   - 同 scope 本轮**明确 PASS** → 才允许 closed（审计行保留）；
 *   - needs_fix 只能由源 check 转绿关闭（人工 receipt 拒清，见 applyVisualAcceptance）；
 *   - accepted 且仍未绿 → 保持 accepted（用户已知情）。
 * 粒度：check 级为主键基座；带结构化 findings 的源（render_visibility 逐屏、
 * asset_materialization_sanity 逐素材）展开为 `debt:<check>:<scope>` 子条目，逐项清偿可审计。
 */
export function deriveVisualDebt(
  feature: string,
  checks: CheckLike[],
  prev: VisualDebtDoc | null,
): VisualDebtDoc {
  const prevEntries = prev?.entries ?? [];
  const prevById = new Map(prevEntries.map(e => [e.id, e]));
  const entries: VisualDebtEntry[] = [];
  const emitted = new Set<string>();

  const emit = (e: VisualDebtEntry): void => {
    if (emitted.has(e.id)) return;
    emitted.add(e.id);
    entries.push(e);
  };

  /** 本轮该 check 的 scope 级条目集（结构化展开）；无结构化 → 单条 check 级 */
  const scopesOf = (checkId: string, worst: CheckLike): Array<{ id: string; screen_id?: string; asset_key?: string; summaryExtra?: string }> => {
    const s = worst.structured as
      | { kind?: string; findings?: Array<{ screen: string }>; assets?: string[] }
      | undefined;
    if (s?.kind === 'render_visibility' && Array.isArray(s.findings) && s.findings.length > 0) {
      const screens = [...new Set(s.findings.map(f => f.screen))];
      return screens.map(sc => ({ id: `debt:${checkId}:${sc}`, screen_id: sc, summaryExtra: `（屏 ${sc}）` }));
    }
    if (s?.kind === 'asset_sanity' && Array.isArray(s.assets) && s.assets.length > 0) {
      return s.assets.map(k => ({ id: `debt:${checkId}:${k}`, asset_key: k, summaryExtra: `（素材 ${k}）` }));
    }
    return [{ id: `debt:${checkId}` }];
  };

  for (const [checkId, meta] of Object.entries(DEBT_SOURCE_CHECKS)) {
    const hits = checks.filter(c => c.id === checkId);
    if (hits.length === 0) {
      // 本轮缺席：历史条目单调保留（含该 check 的全部 scope 子条目）
      for (const pe of prevEntries.filter(e => e.source_check_id === checkId)) emit(pe);
      continue;
    }
    const worst = hits.find(c => c.status === 'FAIL') ?? hits.find(c => c.status === 'WARN')
      ?? hits.find(c => c.status === 'SKIP' && c.severity !== 'MINOR');
    if (!worst) {
      // 本轮明确 PASS → 该 check 全部历史条目闭账 closed（审计保留）
      for (const pe of prevEntries.filter(e => e.source_check_id === checkId)) {
        emit(pe.status === 'closed' ? pe : { ...pe, status: 'closed' });
      }
      continue;
    }
    const resolutionClass: DebtResolutionClass = worst.status === 'FAIL' ? 'needs_fix' : 'needs_human';
    const currentScopes = scopesOf(checkId, worst);
    const currentIds = new Set(currentScopes.map(s => s.id));
    for (const scope of currentScopes) {
      const prevEntry = prevById.get(scope.id);
      const status: DebtStatus =
        prevEntry?.status === 'accepted' && resolutionClass === 'needs_human' ? 'accepted' : 'open';
      emit({
        id: scope.id,
        source_check_id: checkId,
        severity: worst.severity,
        summary: `${meta.label}${scope.summaryExtra ?? ''}`,
        status,
        resolution_class: resolutionClass,
        ...(scope.screen_id ? { screen_id: scope.screen_id } : {}),
        ...(scope.asset_key ? { asset_key: scope.asset_key } : {}),
        ...(prevEntry?.status === 'accepted' && status === 'accepted'
          ? { accepted_by: prevEntry.accepted_by, acceptance_receipt: prevEntry.acceptance_receipt }
          : {}),
        ...(prevEntry
          ? {
              asset_source_status: prevEntry.asset_source_status,
              asset_binding_status: prevEntry.asset_binding_status,
              asset_render_status: prevEntry.asset_render_status,
            }
          : {}),
      });
    }
    // 历史 scope 本轮不再命中（如某屏已修复、其余屏仍病）→ 该 scope 闭账；
    // check 级旧条目在出现 scope 化新条目时同样闭账（粒度升级迁移）。
    for (const pe of prevEntries.filter(e => e.source_check_id === checkId && !currentIds.has(e.id))) {
      emit(pe.status === 'closed' ? pe : { ...pe, status: 'closed' });
    }
  }

  // 债务源表以外的历史条目（前向兼容：未来源 check 改名/下线）——单调保留
  for (const pe of prevEntries) emit(pe);

  return { schema_version: VISUAL_DEBT_SCHEMA_VERSION, feature, entries };
}

/**
 * P1-F 三态标注（codex 四轮附加：文件放进去了 ≠ UI 引用了）：素材家族条目的
 * source/binding/render 三态由三类检查的本轮绿灯态派生——
 *   source  = asset_materialization_sanity（文件 sanity）
 *   binding = visual_parity（源码/资源绑定 presence 面）
 *   render  = render_visibility_calibrate（设备区域可见）
 * 防假清偿的**硬保障**是各阶段检查各自的债务条目（任一未绿仍 open→release BLOCKED）；
 * 本标注是给人看的 rollup（哪一态卡住一眼可判），不构成独立裁决。
 */
export function annotateAssetTriState(doc: VisualDebtDoc, checks: CheckLike[]): VisualDebtDoc {
  // codex 三轮次要项：只更新**本轮实际观察到**的维度——某阶段没跑 render check 时，
  // 不得把历史 VERIFIED 覆盖成 UNVERIFIED（rollup 失真）；缺席维度保留原值。
  const observe = (id: string): AssetVerifyState | undefined => {
    const hits = checks.filter(c => c.id === id);
    if (hits.length === 0) return undefined; // 本轮未观察——保留历史
    return hits.every(c => c.status === 'PASS') ? 'VERIFIED' : 'UNVERIFIED';
  };
  const stages = {
    asset_source_status: observe('asset_materialization_sanity'),
    asset_binding_status: observe('visual_parity'),
    asset_render_status: observe('render_visibility_calibrate'),
  };
  const ASSET_FAMILY = new Set(['visual_parity_unverified_crop', 'asset_materialization_sanity', 'asset_placeholder_present']);
  return {
    ...doc,
    entries: doc.entries.map(e => {
      if (!ASSET_FAMILY.has(e.source_check_id)) return e;
      return {
        ...e,
        ...(stages.asset_source_status !== undefined ? { asset_source_status: stages.asset_source_status } : {}),
        ...(stages.asset_binding_status !== undefined ? { asset_binding_status: stages.asset_binding_status } : {}),
        ...(stages.asset_render_status !== undefined ? { asset_render_status: stages.asset_render_status } : {}),
      };
    }),
  };
}

export function countBlockingDebt(doc: VisualDebtDoc | null): { open: number; accepted: number } {
  const entries = doc?.entries ?? [];
  return {
    open: entries.filter(e => e.status === 'open').length,
    accepted: entries.filter(e => e.status === 'accepted').length,
  };
}

export function renderVisualDebtMd(doc: VisualDebtDoc): string {
  const { open, accepted } = countBlockingDebt(doc);
  const lines = [
    `# 视觉债务 — ${doc.feature}`,
    '',
    '> 本文件为 visual-debt.json（机器真值）的人类投影，勿手改；清偿走修复重跑或人工验收 receipt。',
    `> open=${open}（阻断 release）· accepted=${accepted}（用户显式接受，不再阻断，审计分列）`,
    '',
    '| 条目 | 来源 check | 严重度 | 状态 | 处置类 | 摘要 |',
    '|------|-----------|--------|------|--------|------|',
    ...doc.entries.map(e =>
      `| ${e.id} | ${e.source_check_id} | ${e.severity} | ${e.status} | ${e.resolution_class} | ${e.summary} |`),
    '',
  ];
  return lines.join('\n');
}

/** 原子写（codex 三轮 P0-1：进程中断不得留截断 JSON 冒充账本）：tmp + rename */
function atomicWrite(absPath: string, content: string): void {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, absPath);
}

export function writeVisualDebt(projectRoot: string, doc: VisualDebtDoc): void {
  atomicWrite(visualDebtJsonPath(projectRoot, doc.feature), `${JSON.stringify(doc, null, 2)}\n`);
  atomicWrite(visualDebtMdPath(projectRoot, doc.feature), renderVisualDebtMd(doc));
}

// ---------------------------------------------------------------------------
// 人工视觉验收 receipt（payload 策略校验——信任链校验由 confirmation-receipt 承担）
// ---------------------------------------------------------------------------

export interface VisualAcceptanceScreens {
  screen_id: string;
  variant: string;
  reference_sha256: string;
  actual_sha256: string;
}

export interface VisualAcceptancePayload {
  rubric_version: string;
  rubric: { container: number; hierarchy: number; density: number; state_color: number };
  screens: VisualAcceptanceScreens[];
  accepted_debt_ids: string[];
  signed_by: string;
}

/** screens 矩阵规范化哈希（receipt object_hash 绑定源；逐屏配对绑定，调序/换对即变） */
export function screensMatrixHash(screens: VisualAcceptanceScreens[]): string {
  const canonical = [...screens]
    .map(s => `${s.screen_id} ${s.variant} ${s.reference_sha256} ${s.actual_sha256}`)
    .sort()
    .join('\n');
  return crypto.createHash('sha256').update(canonical, 'utf-8').digest('hex');
}

/** 冻结 rubric 策略校验（design §1.8）：≥4 通过；=3 须显式 accepted_debt_id；≤2 拒绝 */
export function validateRubricPolicy(payload: VisualAcceptancePayload): string[] {
  const errors: string[] = [];
  if (payload.rubric_version !== RUBRIC_VERSION) {
    errors.push(`rubric_version=${payload.rubric_version} ≠ 冻结版本 ${RUBRIC_VERSION}`);
  }
  const dims = Object.entries(payload.rubric ?? {});
  if (dims.length !== 4) errors.push('rubric 须为四维（container/hierarchy/density/state_color）');
  for (const [k, v] of dims) {
    if (typeof v !== 'number' || v < 1 || v > 5) errors.push(`${k}=${v} 非法（1-5）`);
    else if (v <= 2) errors.push(`${k}=${v}：1-2 分不得通过（修复后重评）`);
    else if (v === RUBRIC_CONDITIONAL && (payload.accepted_debt_ids ?? []).length === 0) {
      errors.push(`${k}=3：须对应显式 accepted_debt_ids（接受残余债务留痕）`);
    }
  }
  if (!Array.isArray(payload.screens) || payload.screens.length === 0) {
    errors.push('screens 结构化映射缺失（不接受裸 hash 数组）');
  }
  return errors;
}

/**
 * 应用验收：仅 needs_human 条目可 accepted；needs_fix 一律拒绝（确定性 FAIL 只能修复重跑）。
 * 返回拒绝清单供上层如实报告。
 */
export function applyVisualAcceptance(
  doc: VisualDebtDoc,
  payload: VisualAcceptancePayload,
  receiptRelPath: string,
): { doc: VisualDebtDoc; rejected: string[] } {
  const rejected: string[] = [];
  const ids = new Set(payload.accepted_debt_ids ?? []);
  const entries = doc.entries.map(e => {
    if (!ids.has(e.id)) return e;
    if (e.resolution_class === 'needs_fix') {
      rejected.push(`${e.id}（needs_fix：确定性 FAIL 不可人工清偿——修复后重跑）`);
      return e;
    }
    if (e.status === 'closed') return e;
    return { ...e, status: 'accepted' as DebtStatus, accepted_by: payload.signed_by, acceptance_receipt: receiptRelPath };
  });
  return { doc: { ...doc, entries }, rejected };
}
