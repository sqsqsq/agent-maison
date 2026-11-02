// ============================================================================
// upstream-verdict-gate.ts — 跨阶段负面裁决传播（blind-visual-hardening d1 切片一）
// P2：已解析调用只核真实输入/控制依赖，不要求上游phase closed。没有当前解析输入的
// 旧消费者仍使用下面的兼容读取，P3逐一切换；负面事实始终留在共同完成处置中。
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
import { recomputePhaseEvidenceStaleness, createRuntimeArtifactPredicate } from './phase-evidence-manifest';
import { SUMMARY_ASSURANCE_SCHEMA_VERSIONS, validateSummaryV11 } from './quality-axes';
import { scopeDependencyEdges, type ExecutionScope } from './execution-scope';
import type { WorkflowSpec } from '../../workflow-loader';
import { repairResponsibilityContext, resolveRepairResponsibility, readRepairDependencyContext, type RepairResponsibilityContext } from './repair-responsibility';
import { requiredSummaryCheckGaps, phaseCompletionProblems } from './check-disposition';
import type { ResolvedPhaseInputs } from './capability-resolution';
import { inferLegacyProjectRoot, resolveDependencyPath } from './project-relative-path';
import { sha256File } from './phase-evidence-manifest';

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
  workflow?: WorkflowSpec;
  scope?: ExecutionScope;
  frameworkRoot?: string;
}

export function resolveUpstreamPhaseChain(projectRoot: string, feature: string, runId?: string, pendingOwnerPhase?: string, frameworkRoot?: string): UpstreamChainResolution {
  // D1 §6.4 G4：条件从「有 run」放开为「有 run 或有 feature 冻结记录」——统一入口自己选来源；
  // 两者皆无时才落到下面既有的 workflow 默认链回落（那条分支一行不动）。
  try {
    const { loadEffectiveExecutionScope } = require('./goal-run-creation') as typeof import('./goal-run-creation');
    const { executionCompletionPhases } = require('./execution-scope') as typeof import('./execution-scope');
    const scope = loadEffectiveExecutionScope(projectRoot, feature, runId, frameworkRoot, pendingOwnerPhase);
    if (scope) {
      const { resolveWorkflowSpec, workflowForExistingRun } = require('../../workflow-loader') as typeof import('../../workflow-loader');
      const { resolveProbeFrameworkRoot } = require('../../repo-layout') as typeof import('../../repo-layout');
      const { loadGoalManifestFromRun } = require('./goal-manifest') as typeof import('./goal-manifest');
      const root = frameworkRoot ?? resolveProbeFrameworkRoot(projectRoot, path.resolve(__dirname, '../..'));
      const current = resolveWorkflowSpec(projectRoot, { frameworkRoot: root });
      const workflow = runId ? workflowForExistingRun(current, loadGoalManifestFromRun(projectRoot, runId, { feature }), root, projectRoot) : current;
      const phases = executionCompletionPhases(scope);
      const order = [...new Set([...(workflow.auto_chain ?? []), ...workflow.artifacts.map(a => a.id), ...phases])];
      return { chain: order.filter(phase => phases.includes(phase)), degraded: false, workflow, scope, frameworkRoot: root };
    }
  } catch (error) { return { chain: [], degraded: true, degradedReason: String(error) }; }
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
    const spec = resolveWorkflowSpec(projectRoot, { config, frameworkRoot: frameworkRoot ?? layout.frameworkRoot });
    const track = resolveFeatureTrack(loadFeatureTrackDecl(projectRoot, feature));
    const chain = resolvePhaseChain(spec, track);
    const ordered = (chain as { featureOrdered?: string[] }).featureOrdered;
    if (Array.isArray(ordered) && ordered.length > 0) return { chain: ordered, degraded: false, workflow: spec, frameworkRoot: frameworkRoot ?? layout.frameworkRoot };
    return { chain: FEATURE_PHASE_ORDER, degraded: true, degradedReason: 'workflow featureOrdered 为空' };
  } catch (e) {
    const { loadWorkflowSpec } = require('../../workflow-loader') as typeof import('../../workflow-loader');
    let fallback: WorkflowSpec | undefined;
    try { fallback = loadWorkflowSpec(path.resolve(__dirname, '../../..'), 'spec-driven'); } catch { /* Existing degraded handling diagnoses a broken framework. */ }
    return { chain: FEATURE_PHASE_ORDER, degraded: true, degradedReason: (e as Error).message, workflow: fallback };
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
  /** Raw recompute facts: report churn can allow an owner to work without reviving an old PASS. */
  freshnessChangedPaths?: string[];
  /** 切片二：schema 1.1 quality_axes 摘要（信息面——裁决仍走 verdict 投影，单点不分叉） */
  axisNotes?: string[];
  /** S4（visual-capability-truth）：上游失败的环境层信号（ut_run_status.failure_code 等
   * device_locked 类）——仍拦截不降门禁，只让指引说清"修环境重跑"而非"改代码"。 */
  environmentFailureCode?: string;
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
      violations.push({
        phase: v.phase,
        reason:
          `上游机器裁决 verdict=${v.verdict}（非 PASS 不得下游推进）` +
          (v.environmentFailureCode
            ? `——failure_layer=environment（${v.environmentFailureCode}）：这是环境失败非代码回归，` +
              // t1（openspec device-readiness-and-completion）：措辞须明确主语是**人**——
              // 原文"解锁真机"被 agent 读作自我指令，07-28 事故中 agent 据此对用户真机
              // 枚举 10 组常见 PIN 致设备锁定。指引只描述人的动作，不给 agent 留自解锁暗示。
              `请人修复环境（无可用 ready 凭据或自动恢复未完成时，请人解锁真机并保持前台）后重跑 ${v.phase} harness 即可解除；` +
              `勿改产品代码，也不要尝试自行解锁设备`
            : ''),
      });
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
export function readUpstreamPhaseView(projectRoot: string, feature: string, phase: string, pendingOwnerPhase?: string, runId?: string, frameworkRoot?: string): UpstreamPhaseView {
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
      blocking_skips?: Array<{ id?: string; blocking_class?: string }>;
      quality_axes?: Record<string, { applicable?: boolean; verdict?: string }>;
      ut_run_status?: { failure_code?: unknown };
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
    blockerIds.push(...requiredSummaryCheckGaps(parsed).map(check => check.id ?? 'required_check_gap'));
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
    const parsedSchemaVersion = String((parsed as { schema_version?: unknown }).schema_version);
    if (parsedSchemaVersion === '1.1' || SUMMARY_ASSURANCE_SCHEMA_VERSIONS.has(parsedSchemaVersion)) {
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
  let freshnessChangedPaths: string[] | undefined;
  try {
    const [res] = recomputePhaseEvidenceStaleness(projectRoot, feature, [phase], { pendingOwnerPhase, runId, frameworkRoot });
    if (res) {
      if (res.verdict === 'fresh') freshness = 'fresh';
      else if (res.verdict === 'missing') freshness = 'no_manifest';
      else {
        freshness = res.verdict;
        freshnessChangedPaths = res.changed_paths;
        freshnessDetail =
          res.integrity_errors?.join('；') ??
          (res.changed_paths.length > 0
            ? `变更证据：${res.changed_paths.slice(0, 5).join(', ')}——改法：重跑 ${phase} 的 harness` +
              `（cd framework/harness && npx ts-node harness-runner.ts --phase ${phase} --feature ${feature}），` +
              `或 --revalidate --feature ${feature} --from ${phase} 一次重闭该阶段及其下游`
            : undefined);
      }
    }
  } catch {
    // 重算自身异常不升级为阻断（保守：按 verdict 面消费）；异常面由 safeRun 之外的单测覆盖
    freshness = 'no_manifest';
  }

  // S4：环境层信号透出（device_locked 等 toolchain/环境失败码——20260718 事故：testing 期
  // 重跑 ut 撞真机锁屏翻 FAIL，指引应说"修环境重跑"而非引向改码）。
  let environmentFailureCode: string | undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as { ut_run_status?: { failure_code?: unknown } };
    const code = raw.ut_run_status?.failure_code;
    if (typeof code === 'string' && /device_locked|no_hdc_target|app_not_foreground|device_offline/i.test(code)) {
      environmentFailureCode = code;
    }
  } catch { /* 信号缺失不影响主判定 */ }

  return { phase, summaryExists: true, verdictReadable, verdict, blockerIds, freshness, freshnessDetail, freshnessChangedPaths, axisNotes, environmentFailureCode };
}

/** The current phase's actual input bindings augment workflow/control dependencies. */
export function upstreamPhaseDependencies(projectRoot: string, feature: string, phase: string, resolution: UpstreamChainResolution): string[] {
  const allowed = new Set(resolution.chain);
  const actual = resolution.scope && resolution.workflow && resolution.frameworkRoot
    ? readRepairDependencyContext(projectRoot, feature, resolution.workflow, resolution.scope, resolution.frameworkRoot) : undefined;
  const edges = scopeDependencyEdges(resolution.scope, resolution.workflow, actual?.inputOwners, actual?.inputEdges)
    .filter(edge => allowed.has(edge.before) && allowed.has(edge.after));
  const summaryFile = summaryJsonPath(projectRoot, feature, phase);
  if (fs.existsSync(summaryFile)) {
    try {
      const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8')) as { capability_resolutions?: Array<{ active?: boolean; inputs?: Array<{ state?: string; selected_source?: string; attempts?: Array<{ source?: string; state?: string; upstream_producer?: string }> }> }> };
      for (const capability of summary.capability_resolutions ?? []) if (capability.active !== false) {
        for (const input of capability.inputs ?? []) if (input.state === 'resolved') {
          for (const attempt of input.attempts ?? []) if (attempt.state === 'resolved' && attempt.source === input.selected_source
            && attempt.upstream_producer && allowed.has(attempt.upstream_producer)) {
            edges.push({ before: attempt.upstream_producer, after: phase });
          }
        }
      }
    } catch { /* Current summary shape is checked by its own checker, not reinterpreted here. */ }
  }
  const ancestors = new Set<string>();
  const pending = [phase];
  while (pending.length) {
    const current = pending.pop()!;
    for (const edge of edges) if (edge.after === current && edge.before !== phase && !ancestors.has(edge.before)) { ancestors.add(edge.before); pending.push(edge.before); }
  }
  return [...new Set([...resolution.chain, ...ancestors])].filter(item => ancestors.has(item));
}

/**
 * 下游 phase 启动门禁：上游存在负面/缺失机器裁决或不新鲜绑定 → BLOCKER FAIL。
 * 消费面=summary.json（Markdown 报告只是上游 harness 的解析输入，本门禁不重读散文）。
 */
export function checkUpstreamVerdictGate(opts: {
  projectRoot: string;
  frameworkRoot?: string;
  feature: string;
  phase: string;
  runId?: string;
  resolvedInputs?: ResolvedPhaseInputs;
}): CheckResult[] {
  const id = 'upstream_verdict_gate';
  if (opts.resolvedInputs) {
    const inputs = opts.resolvedInputs;
    const gaps: string[] = [];
    if (inputs.phase !== opts.phase || !('feature' in inputs.context.subject) || inputs.context.subject.feature !== opts.feature) gaps.push('当前检查的输入身份不匹配');
    for (const value of Object.values(inputs.values)) {
      if (value.state !== 'resolved') continue; // Required/optional absence is owned by capabilityResolutionChecks.
      const legacyRoot = inferLegacyProjectRoot(opts.projectRoot, value.binding);
      for (const dependency of value.binding.dependencies) {
        const file = resolveDependencyPath(opts.projectRoot, dependency.path, legacyRoot);
        if (fs.existsSync(file) !== dependency.exists || sha256File(file) !== dependency.sha256) gaps.push(`实际输入已变化：${file}`);
      }
    }
    return [{ id: 'upstream_verdict_gate', category: 'structure', description: '当前检查真实输入绑定可用（不要求上游阶段已闭环）', severity: 'BLOCKER',
      status: gaps.length ? 'SKIP' : 'PASS', details: gaps.length ? gaps.join('\n') : '已核当前输入；其它职责的FAIL、未知和未完项由同一完成评估保留，不冒充上游PASS。',
      ...(gaps.length ? { failure_kind: 'framework_bug', blocking_class: 'framework_internal', suggestion: '重读当前真实输入并只补受影响检查；不要改写上游裁决或伪造PASS。' } : {}) }];
  }
  return [{ id, category: 'structure', description: '当前检查真实输入绑定可用', severity: 'BLOCKER', status: 'SKIP',
    details: '当前工具尚无入口解析的真实输入绑定；保留未知，不从旧阶段排列或summary/closed推断可执行性。',
    failure_kind: 'framework_bug', blocking_class: 'framework_internal',
    suggestion: '由原公开检查入口解析当前适用输入后只补本检查；不要补造上游PASS或阶段作者。' }];
}
