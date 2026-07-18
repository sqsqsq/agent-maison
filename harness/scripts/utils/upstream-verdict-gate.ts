// ============================================================================
// upstream-verdict-gate.ts — 跨阶段负面裁决传播（blind-visual-hardening d1 切片一）
// ----------------------------------------------------------------------------
// 背景（bc-openCard 二轮事故）：review 终态「不通过+3 BLOCKER」，但 review summary
// verdict:PASS/closed，ut/testing 照常启动直至「达标可发布」。本 util 让下游 phase
// 启动时消费**上游机器裁决**（summary.json 顶层 verdict + blockers——切片一消费旧结构，
// schema 1.1 落地后单点切换 quality_axes），而不是重新解释上游自然语言报告（防 TOCTOU）。
// 新鲜度：上游存在 phase-evidence-manifest 时复用 recomputePhaseEvidenceStaleness
// 单阶段重算——stale/tampered 意味着 summary 产出后证据被改，不可信 → 阻断；
// manifest 缺失（legacy/交互现场）不因新鲜度阻断（"该跑没跑/旧现场"由既有
// receipt / goal preflight 链负责），仅按 verdict 面消费。
// 上游 summary 完全不存在 → 跳过（单阶段开发流不受影响；截断链治理归 goal preflight）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { receiptDirPath } from '../../config';
import type { CheckResult } from './types';
import { recomputePhaseEvidenceStaleness } from './phase-evidence-manifest';
import { validateSummaryV11 } from './quality-axes';

/** 回退链序（workflow SSOT 不可解析时的保守缺省——与 spec-driven full 轨一致） */
export const FEATURE_PHASE_ORDER = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'] as const;

/**
 * codex 实施 review P1-6：上游链取自 active workflow SSOT（resolveWorkflowSpec +
 * resolvePhaseChain(track)），自定义 workflow/裁剪轨/新阶段自动生效；解析失败回退
 * FEATURE_PHASE_ORDER（保守缺省，不因 workflow 配置问题让门禁静默消失）。
 */
export interface UpstreamChainResolution {
  chain: readonly string[];
  /** workflow SSOT 解析失败——回退缺省链，且回退不覆盖的 phase 不得静默失守（P1-6 三轮修） */
  degraded: boolean;
  degradedReason?: string;
}

export function resolveUpstreamPhaseChain(projectRoot: string, feature: string): UpstreamChainResolution {
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { loadFrameworkConfig } = require('../../config') as typeof import('../../config');
    const { resolveWorkflowSpec } = require('../../workflow-loader') as typeof import('../../workflow-loader');
    const { resolveFeatureTrack, resolvePhaseChain } = require('./runtime-policy') as typeof import('./runtime-policy');
    const { loadFeatureTrackDecl } = require('./feature-track') as typeof import('./feature-track');
    const { inferRepoLayout } = require('../../repo-layout') as typeof import('../../repo-layout');
    /* eslint-enable @typescript-eslint/no-require-imports */
    const config = loadFrameworkConfig(projectRoot);
    const layout = inferRepoLayout(projectRoot);
    const spec = resolveWorkflowSpec(projectRoot, { config, frameworkRoot: layout.frameworkRoot });
    const track = resolveFeatureTrack(loadFeatureTrackDecl(projectRoot, feature));
    const chain = resolvePhaseChain(spec, track);
    const ordered = (chain as { featureOrdered?: string[] }).featureOrdered;
    if (Array.isArray(ordered) && ordered.length > 0) return { chain: ordered, degraded: false };
    return { chain: FEATURE_PHASE_ORDER, degraded: true, degradedReason: 'workflow featureOrdered 为空' };
  } catch (e) {
    return { chain: FEATURE_PHASE_ORDER, degraded: true, degradedReason: (e as Error).message };
  }
}

export type UpstreamFreshness = 'fresh' | 'stale' | 'tampered' | 'no_manifest';

/** 单个上游阶段的机器裁决视图（I/O 与判定分离，判定可纯函数单测） */
export interface UpstreamPhaseView {
  phase: string;
  /** summary.json 是否存在 */
  summaryExists: boolean;
  /** summary 可解析且含 verdict 字段 */
  verdictReadable: boolean;
  verdict: string | null;
  blockerIds: string[];
  freshness: UpstreamFreshness;
  freshnessDetail?: string;
  /** 切片二：schema 1.1 quality_axes 摘要（信息面——裁决仍走 verdict 投影，单点不分叉） */
  axisNotes?: string[];
}

export interface UpstreamViolation {
  phase: string;
  reason: string;
}

/** 纯判定：给定上游视图集合 → 违例清单（不做 I/O，单测直接喂视图） */
export function evaluateUpstreamViews(views: UpstreamPhaseView[]): UpstreamViolation[] {
  const violations: UpstreamViolation[] = [];
  for (const v of views) {
    if (!v.summaryExists) continue; // 未跑阶段不在本门禁职责内（见文件头注释）
    if (!v.verdictReadable) {
      violations.push({
        phase: v.phase,
        reason: `summary.json 存在但机器裁决不可信（${v.freshnessDetail ?? 'verdict 缺失/不可解析'}）`,
      });
      continue;
    }
    if (v.verdict !== 'PASS') {
      violations.push({ phase: v.phase, reason: `上游机器裁决 verdict=${v.verdict}（非 PASS 不得下游推进）` });
      continue;
    }
    if (v.blockerIds.length > 0) {
      violations.push({
        phase: v.phase,
        reason: `上游 summary 存在未清 blocker（${v.blockerIds.slice(0, 5).join(', ')}${v.blockerIds.length > 5 ? '…' : ''}）`,
      });
      continue;
    }
    if (v.freshness === 'stale' || v.freshness === 'tampered') {
      violations.push({
        phase: v.phase,
        reason: `上游证据链 ${v.freshness}（summary 产出后证据被改/完整性断裂，机器裁决不再可信）${v.freshnessDetail ? `：${v.freshnessDetail}` : ''}`,
      });
    }
  }
  return violations;
}

function summaryJsonPath(projectRoot: string, feature: string, phase: string): string {
  return path.join(receiptDirPath(projectRoot, feature, phase), 'reports', 'summary.json');
}

/** I/O：读取单个上游阶段视图 */
export function readUpstreamPhaseView(projectRoot: string, feature: string, phase: string): UpstreamPhaseView {
  const p = summaryJsonPath(projectRoot, feature, phase);
  if (!fs.existsSync(p)) {
    return { phase, summaryExists: false, verdictReadable: false, verdict: null, blockerIds: [], freshness: 'no_manifest' };
  }
  let verdict: string | null = null;
  let verdictReadable = false;
  let blockerIds: string[] = [];
  let axisNotes: string[] | undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8')) as {
      verdict?: unknown;
      blockers?: Array<{ id?: unknown }>;
      quality_axes?: Record<string, { applicable?: boolean; verdict?: string }>;
    };
    if (typeof parsed.verdict === 'string' && parsed.verdict.trim().length > 0) {
      verdict = parsed.verdict.trim();
      verdictReadable = true;
    }
    if (Array.isArray(parsed.blockers)) {
      blockerIds = parsed.blockers
        .map(b => (typeof b?.id === 'string' ? b.id : null))
        .filter((x): x is string => x !== null);
      // blockers 存在但条目无 id（形状破损）——按存在计数，防"洗形状"绕过
      if (blockerIds.length === 0 && parsed.blockers.length > 0) {
        blockerIds = parsed.blockers.map((_, i) => `blocker#${i}`);
      }
    }
    // 切片二：1.1 多轴摘要（信息面）——裁决单点仍是 verdict（quality_axes 唯一解析器的投影产物），
    // 此处只透出"哪根轴不干净"帮助定位，不另做第二套判定。
    if (parsed.quality_axes && typeof parsed.quality_axes === 'object') {
      axisNotes = Object.entries(parsed.quality_axes)
        .filter(([, a]) => a?.applicable === true && a?.verdict !== 'PASS')
        .map(([id, a]) => `${id}=${a?.verdict ?? '?'}`);
      if (axisNotes.length === 0) axisNotes = undefined;
    }
    // codex 实施 review P0-3 + 三轮 P1-4：声明 1.1 → 完整契约唯一权威校验（四字段+轴不变量）；
    // 违反 → 机器裁决不可信（手搓裸/半 summary 拒收）
    if ((parsed as { schema_version?: unknown }).schema_version === '1.1') {
      const v11Errors = validateSummaryV11(parsed);
      if (v11Errors.length > 0) {
        return {
          phase, summaryExists: true, verdictReadable: false, verdict: null, blockerIds: [],
          freshness: 'no_manifest',
          freshnessDetail: `1.1 summary 契约违反（quality_axes/report_validity/release_readiness/completion_status：${v11Errors.slice(0, 2).join('；')}）`,
        };
      }
    }
  } catch {
    return { phase, summaryExists: true, verdictReadable: false, verdict: null, blockerIds: [], freshness: 'no_manifest' };
  }

  // 新鲜度：单阶段重算（manifest 缺失 → no_manifest，不作阻断依据）
  let freshness: UpstreamFreshness = 'no_manifest';
  let freshnessDetail: string | undefined;
  try {
    const [res] = recomputePhaseEvidenceStaleness(projectRoot, feature, [phase]);
    if (res) {
      if (res.verdict === 'fresh') freshness = 'fresh';
      else if (res.verdict === 'missing') freshness = 'no_manifest';
      else {
        freshness = res.verdict;
        freshnessDetail =
          res.integrity_errors?.join('；') ??
          (res.changed_paths.length > 0 ? `变更证据：${res.changed_paths.slice(0, 5).join(', ')}` : undefined);
      }
    }
  } catch {
    // 重算自身异常不升级为阻断（保守：按 verdict 面消费）；异常面由 safeRun 之外的单测覆盖
    freshness = 'no_manifest';
  }

  return { phase, summaryExists: true, verdictReadable, verdict, blockerIds, freshness, freshnessDetail, axisNotes };
}

/**
 * 下游 phase 启动门禁：上游存在负面/缺失机器裁决或不新鲜绑定 → BLOCKER FAIL。
 * 消费面=summary.json（Markdown 报告只是上游 harness 的解析输入，本门禁不重读散文）。
 */
export function checkUpstreamVerdictGate(opts: {
  projectRoot: string;
  feature: string;
  phase: string;
}): CheckResult[] {
  const id = 'upstream_verdict_gate';
  const description =
    '跨阶段负面裁决传播门禁（上游机器裁决非 PASS / blocker 未清 / 证据链不新鲜 → 下游不得启动）';
  const resolution = resolveUpstreamPhaseChain(opts.projectRoot, opts.feature);
  const order = resolution.chain;
  const idx = order.indexOf(opts.phase);
  if (idx < 0) {
    if (resolution.degraded) {
      // codex 三轮 P1-6：workflow 解析失败 + 当前 phase 不在回退链 → 门禁不得静默消失
      return [{
        id,
        category: 'structure',
        description,
        severity: 'BLOCKER',
        status: 'FAIL',
        details:
          `【链解析降级】workflow SSOT 解析失败（${resolution.degradedReason ?? '未知'}），且当前 phase ` +
          `"${opts.phase}" 不在保守回退链 [${order.join(', ')}] 内——自定义阶段的上游裁决传播无法保证，不得静默放行。`,
        suggestion: '修复 workflow 配置（framework.config workflow / workflows/*.workflow.yaml）后重跑。',
        failure_kind: 'workflow_chain_unresolved',
        blocking_class: 'product_verdict',
      }];
    }
    return []; // workflow 正常解析且 phase 非 feature 链成员（global 等）——合法零结果
  }
  if (idx === 0) {
    return []; // 链首：无上游可消费
  }
  const upstream = order.slice(0, idx);
  const views = upstream.map(p => readUpstreamPhaseView(opts.projectRoot, opts.feature, p));
  const violations = evaluateUpstreamViews(views);
  const consumed = views.filter(v => v.summaryExists).map(v => v.phase);
  const skipped = views.filter(v => !v.summaryExists).map(v => v.phase);

  if (violations.length === 0) {
    return [{
      id,
      category: 'structure',
      description,
      severity: 'BLOCKER',
      status: 'PASS',
      details: [
        `上游机器裁决全部可消费且无负面结论。`,
        consumed.length > 0 ? `已消费：${consumed.join(', ')}` : null,
        skipped.length > 0 ? `未跑（跳过，由 receipt/goal preflight 链负责该跑未跑治理）：${skipped.join(', ')}` : null,
      ].filter(Boolean).join('\n'),
    }];
  }

  const axisLines = views
    .filter(v => v.axisNotes && v.axisNotes.length > 0)
    .map(v => `  - [${v.phase}] 轴摘要：${v.axisNotes!.join(', ')}`);
  return [{
    id,
    category: 'structure',
    description,
    severity: 'BLOCKER',
    status: 'FAIL',
    details: [
      '【负面裁决传播】上游阶段存在未解决的负面机器裁决，下游不得推进（bc-openCard 二轮：',
      'review「不通过+3 BLOCKER」曾照常进 ut/testing 直至「达标可发布」）：',
      ...violations.map(v => `  - [${v.phase}] ${v.reason}`),
      ...(axisLines.length > 0 ? ['多轴定位（quality_axes 信息面）：', ...axisLines] : []),
    ].join('\n'),
    suggestion:
      '回到对应上游阶段修复问题并重跑其 harness（summary verdict 回到 PASS 且 blocker 清空）后再启动本阶段；' +
      '不得手改上游 summary.json——证据链新鲜度重算会将篡改判为 tampered。',
    failure_kind: 'upstream_negative_verdict',
    blocking_class: 'product_verdict',
  }];
}
