// ============================================================================
// correction-commands.ts — 修正闭环三命令实现（C5-min correction-routing，
// plan d4a7c1e8）
// ============================================================================
// harness-runner 派发：
//   --correction-init   ：归属 + 三问分层 → 写 .current-correction.json（pending）
//   --correction-check  ：对照 revalidate 清单核查证据全绿 → status: closed
//   --adhoc-correction  ：no-feature 载体（compile + lint + 架构规则 + catalog
//                         反查 touched modules；报告落 reports/_adhoc/<ts>/）
// 验证转嫁禁令：revalidate 触及 testing/verification 而宿主无 device 能力 →
// BLOCKER FAIL（failure_kind: verification_evidence_gap；goal 侧独立 halt 分类，
// 不计 no_progress）。

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import {
  featureDir,
  featurePhaseReportsDir,
  loadFrameworkConfig,
  resolveReceiptFilePath,
  statefilePath,
} from '../../config';
import { resolveWorkflowSpec } from '../../workflow-loader';
import { loadResolvedProfile, loadPhaseRuleWithOverlays } from '../../profile-loader';
import { SpecLoader } from './spec-loader';
import { AstAnalyzer } from './ast-analyzer';
import type { CheckContext, CheckResult } from './types';
import { isCapabilitySkipped } from '../../capability-registry';
import { tryLoadProfileCodingHost } from '../../profile-host-loader';
import { diffChangedFiles } from './git-diff';
import { classifyChangedFiles, layerDirPrefixes } from './diff-scope';
import { loadCatalog } from './catalog-parser';
import {
  classifyCorrection,
  resolveCorrectionCategory,
  resolveCorrectionTarget,
  touchedCategories,
  type CorrectionAnswers,
  type RevalidateEntry,
} from './correction-routing';
import {
  assessCorrectionStaleness,
  buildCorrectionState,
  readCorrectionState,
  resolveBaseCommit,
  resolveCurrentSessionSignal,
  writeCorrectionState,
} from './correction-state';
import { inferRepoLayout } from '../../repo-layout';
import { loadFeatureTrackDecl } from './feature-track';
import {
  resolveEnforcementTier,
  resolveFeatureTrack,
  workflowFeaturePhases,
  type AdapterEnforcementManifest,
} from './runtime-policy';
import { isGoalOrchestrationEnv } from './phase-state';

// --------------------------------------------------------------------------
// 公共装配
// --------------------------------------------------------------------------

function readAdapterManifest(frameworkRoot: string, adapter: string): AdapterEnforcementManifest | null {
  try {
    const abs = path.join(frameworkRoot, 'agents', adapter, 'adapter.yaml');
    if (!fs.existsSync(abs)) return null;
    const doc = YAML.parse(fs.readFileSync(abs, 'utf-8')) as Record<string, unknown> | null;
    if (!doc || typeof doc !== 'object') return null;
    return { settings_file: doc.settings_file, hooks: doc.hooks };
  } catch {
    return null;
  }
}

function readActiveStateFeature(projectRoot: string): string | null {
  try {
    const abs = statefilePath(projectRoot);
    if (!fs.existsSync(abs)) return null;
    const raw = JSON.parse(fs.readFileSync(abs, 'utf-8')) as { feature?: unknown };
    return typeof raw.feature === 'string' && raw.feature.trim() ? raw.feature : null;
  } catch {
    return null;
  }
}

/**
 * 已闭环 phase 集（track-aware，cursor 批次 2 review P1）：
 *   - full：receipt 文件存在（§5.1 闭环判据的确定性侧）；
 *   - lite：receipt 或该 phase script-report verdict=PASS——lite 无 receipt 机器件，
 *     以 exit/change 脚本报告为过渡闭环判据；与 --correction-check 的证据探测同源，
 *     C2 verification-matrix 统一 policy 后收敛为 receipt∨policy 判定。
 */
export function closedPhasesFor(
  projectRoot: string,
  feature: string,
  phases: readonly string[],
  track: 'lite' | 'full',
  frameworkRoot?: string,
): string[] {
  return phases.filter((p) => {
    try {
      if (fs.existsSync(resolveReceiptFilePath(projectRoot, feature, p).path)) return true;
      if (track !== 'lite') return false;
      const reportAbs = path.join(
        featurePhaseReportsDir(projectRoot, feature, p, frameworkRoot),
        'script-report.json',
      );
      if (!fs.existsSync(reportAbs)) return false;
      const doc = JSON.parse(fs.readFileSync(reportAbs, 'utf-8')) as {
        summary?: { verdict?: string };
      };
      return doc.summary?.verdict === 'PASS';
    } catch {
      return false;
    }
  });
}

// --------------------------------------------------------------------------
// --correction-init
// --------------------------------------------------------------------------

export interface CorrectionInitOpts {
  requestedFeature?: string;
  answers: CorrectionAnswers;
  requestText: string;
  frameworkRoot: string;
}

export function runCorrectionInit(projectRoot: string, opts: CorrectionInitOpts): number {
  const target = resolveCorrectionTarget({
    requestedFeature: opts.requestedFeature ?? null,
    activeStateFeature: readActiveStateFeature(projectRoot),
    featureDirExists: (f) => {
      try {
        return fs.existsSync(featureDir(projectRoot, f));
      } catch {
        return false;
      }
    },
  });

  if (target.kind === 'ask_user') {
    console.error(`❌ correction-init: 归属不明 —— ${target.reason}`);
    return 1;
  }

  const baseCommit = resolveBaseCommit(projectRoot);
  if (!baseCommit) {
    console.error('❌ correction-init: 无法解析 git HEAD（base_commit 必需，红线 fail-closed）');
    return 1;
  }

  const fw = loadFrameworkConfig(projectRoot);
  const adapter = typeof fw.agent_adapter === 'string' ? fw.agent_adapter : '';
  const tier = resolveEnforcementTier(
    adapter ? readAdapterManifest(opts.frameworkRoot, adapter) : null,
    { mode: isGoalOrchestrationEnv() ? 'goal' : 'interactive' },
  );

  let feature: string | null = null;
  let rootLayer: string;
  let touched: string[];
  let revalidate: RevalidateEntry[];

  if (target.kind === 'feature') {
    feature = target.feature;
    const spec = resolveWorkflowSpec(projectRoot, { config: fw, frameworkRoot: opts.frameworkRoot });
    const track = resolveFeatureTrack(loadFeatureTrackDecl(projectRoot, feature));
    const closed = closedPhasesFor(
      projectRoot,
      feature,
      workflowFeaturePhases(spec, track),
      track,
      opts.frameworkRoot,
    );
    const cls = classifyCorrection({ answers: opts.answers, spec, track, closedPhases: closed });
    rootLayer = cls.root_layer;
    touched = cls.touched_layers;
    revalidate = cls.revalidate;
  } else {
    // no-feature：无 workflow 投影，层即类别；载体为 --adhoc-correction 单项清单
    rootLayer = resolveCorrectionCategory(opts.answers);
    touched = touchedCategories(opts.answers);
    revalidate = [{ phase: 'adhoc', status: 'pending' }];
  }

  const state = buildCorrectionState({
    feature,
    root_layer: rootLayer,
    touched_layers: touched,
    revalidate,
    // session 信号真实接线（codex 批次 2 P1）：复用 .current-phase.json session 治理；
    // 取不到 → null，staleness 退回 TTL 兜底
    session_id: resolveCurrentSessionSignal(projectRoot),
    base_commit: baseCommit,
    request_text: opts.requestText,
    enforcement_tier: tier,
  });
  const abs = writeCorrectionState(projectRoot, state);

  console.log('✅ correction-init: 已写入修正状态（status: pending）');
  console.log(`   state: ${path.relative(projectRoot, abs).replace(/\\/g, '/')}`);
  console.log(`   归属: ${feature ?? '(no-feature → --adhoc-correction)'}`);
  console.log(`   root_layer: ${rootLayer} | touched: ${touched.join(', ')}`);
  console.log(`   revalidate: ${revalidate.map((r) => r.phase).join(' → ')}`);
  console.log('   下一步: 经 `correction.layer` gate 用户确认后实施（只动声明层）；');
  console.log(
    feature
      ? '   实施后逐项重跑 revalidate phase 的 harness，再 --correction-check 收口。'
      : '   实施后跑 --adhoc-correction，再 --correction-check 收口。',
  );
  return 0;
}

// --------------------------------------------------------------------------
// --correction-check
// --------------------------------------------------------------------------

interface EvidenceProbe {
  ok: boolean;
  detail: string;
}

function probePhaseEvidence(
  projectRoot: string,
  feature: string,
  phase: string,
  createdAtMs: number,
  frameworkRoot?: string,
): EvidenceProbe {
  const reportAbs = path.join(
    featurePhaseReportsDir(projectRoot, feature, phase, frameworkRoot),
    'script-report.json',
  );
  if (!fs.existsSync(reportAbs)) {
    return { ok: false, detail: `script-report.json 不存在（${phase} 门禁尚未重跑）` };
  }
  try {
    const doc = JSON.parse(fs.readFileSync(reportAbs, 'utf-8')) as {
      timestamp?: string;
      summary?: { verdict?: string };
    };
    const ts = doc.timestamp ? Date.parse(doc.timestamp) : fs.statSync(reportAbs).mtimeMs;
    if (!Number.isFinite(ts) || ts <= createdAtMs) {
      return { ok: false, detail: `${phase} 报告早于修正起点（stale evidence，须重跑）` };
    }
    if (doc.summary?.verdict !== 'PASS') {
      return { ok: false, detail: `${phase} 最新报告 verdict=${doc.summary?.verdict ?? '?'}（未绿）` };
    }
    return { ok: true, detail: `${phase} 报告 PASS 且晚于修正起点` };
  } catch (err) {
    return { ok: false, detail: `${phase} 报告解析失败：${(err as Error).message}` };
  }
}

export function adhocReportsRoot(harnessRoot: string): string {
  return path.join(harnessRoot, 'reports', '_adhoc');
}

function probeAdhocEvidence(harnessRoot: string, createdAtMs: number): EvidenceProbe {
  const root = adhocReportsRoot(harnessRoot);
  if (!fs.existsSync(root)) {
    return { ok: false, detail: 'reports/_adhoc 不存在（--adhoc-correction 尚未跑）' };
  }
  const candidates = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(root, e.name, 'correction-report.json'))
    .filter((p) => fs.existsSync(p));
  let best: { ts: number; verdict: string } | null = null;
  for (const p of candidates) {
    try {
      const doc = JSON.parse(fs.readFileSync(p, 'utf-8')) as { generated_at?: string; verdict?: string };
      const ts = doc.generated_at ? Date.parse(doc.generated_at) : fs.statSync(p).mtimeMs;
      if (Number.isFinite(ts) && (!best || ts > best.ts)) {
        best = { ts, verdict: doc.verdict ?? '?' };
      }
    } catch {
      /* skip corrupt */
    }
  }
  if (!best || best.ts <= createdAtMs) {
    return { ok: false, detail: '无晚于修正起点的 adhoc 报告（先跑 --adhoc-correction）' };
  }
  if (best.verdict !== 'PASS') {
    return { ok: false, detail: `最新 adhoc 报告 verdict=${best.verdict}（未绿）` };
  }
  return { ok: true, detail: 'adhoc 报告 PASS 且晚于修正起点' };
}

export function runCorrectionCheck(
  projectRoot: string,
  harnessRoot: string,
  frameworkRoot?: string,
): number {
  const state = readCorrectionState(projectRoot);
  if (!state) {
    console.error('❌ correction-check: 无有效 .current-correction.json —— 请先 --correction-init 建立修正状态');
    return 1;
  }
  // session 信号来自 .current-phase.json 治理（换会话接管后 last_seen 变化 → mismatch）；
  // 取不到信号时 TTL 兜底
  const staleness = assessCorrectionStaleness(state, {
    currentSessionId: resolveCurrentSessionSignal(projectRoot),
  });
  if (staleness.stale) {
    console.error(`❌ correction-check: 修正状态 stale（${staleness.reason}）—— 请重建 correction（--correction-init）`);
    return 1;
  }
  if (state.status === 'closed') {
    console.log('✅ correction-check: 修正已闭环（status: closed）');
    return 0;
  }

  const createdAtMs = Date.parse(state.created_at);
  const pending: string[] = [];
  const nextRevalidate: RevalidateEntry[] = state.revalidate.map((entry) => {
    const probe =
      entry.phase === 'adhoc'
        ? probeAdhocEvidence(harnessRoot, createdAtMs)
        : state.feature
          ? probePhaseEvidence(projectRoot, state.feature, entry.phase, createdAtMs, frameworkRoot)
          : { ok: false, detail: `feature 缺失但 revalidate 含 ${entry.phase}（state 损坏，请重建）` };
    if (!probe.ok) pending.push(`  - ${entry.phase}: ${probe.detail}`);
    else console.log(`   ✓ ${entry.phase}: ${probe.detail}`);
    return { phase: entry.phase, status: probe.ok ? 'done' : 'pending' };
  });

  if (pending.length > 0) {
    writeCorrectionState(projectRoot, { ...state, revalidate: nextRevalidate });
    console.error('❌ correction-check: revalidate 未全绿——');
    for (const line of pending) console.error(line);
    return 1;
  }

  writeCorrectionState(projectRoot, { ...state, revalidate: nextRevalidate, status: 'closed' });
  console.log('✅ correction-check: revalidate 全绿，修正闭环（status: closed）');
  return 0;
}

// --------------------------------------------------------------------------
// --adhoc-correction
// --------------------------------------------------------------------------

/** catalog 反查：changed file → 命中 entry_file dirname 前缀的模块名 */
function reverseLookupTouchedModules(projectRoot: string, changedFiles: string[]): {
  touched: string[];
  unattributed: string[];
} {
  const load = loadCatalog(projectRoot);
  const prefixes: Array<{ name: string; prefix: string }> = [];
  if (load.ok) {
    for (const m of load.catalog.modules) {
      if (!m.entry_file) continue;
      const dir = path.posix.dirname(m.entry_file.replace(/\\/g, '/'));
      if (dir && dir !== '.') prefixes.push({ name: m.name, prefix: dir.replace(/\/+$/, '') + '/' });
    }
  }
  const layers = layerDirPrefixes(projectRoot);
  const touched = new Set<string>();
  const unattributed: string[] = [];
  for (const f of changedFiles) {
    const norm = f.replace(/\\/g, '/');
    if (!layers.some((l) => norm.startsWith(l))) continue; // 层外中性变更
    const hit = prefixes.find((p) => norm.startsWith(p.prefix));
    if (hit) touched.add(hit.name);
    else unattributed.push(norm);
  }
  return { touched: [...touched].sort(), unattributed };
}

function buildAdhocCheckContext(
  projectRoot: string,
  harnessRoot: string,
  frameworkRoot: string,
): CheckContext {
  const fw = loadFrameworkConfig(projectRoot);
  const specLoader = new SpecLoader(projectRoot, undefined, undefined, frameworkRoot);
  let phaseRule = specLoader.loadPhaseRule('coding');
  const resolvedProfile = loadResolvedProfile(projectRoot, fw);
  phaseRule = loadPhaseRuleWithOverlays('coding', phaseRule, resolvedProfile);
  const layout = inferRepoLayout(frameworkRoot);
  return {
    phase: 'coding',
    feature: '_adhoc',
    projectRoot,
    phaseRule,
    featureSpec: { feature: '_adhoc' },
    docsCommitted: fw.paths.docs_committed ?? false,
    skipVisualHandoff: true,
    resolvedProfile,
    frameworkRoot,
    frameworkRel: layout.frameworkRel,
    harnessRoot,
    layoutKind: layout.kind,
  } as CheckContext;
}

const VERIFICATION_CATEGORIES = new Set(['verification', 'ut', 'testing', 'exit']);

export async function runAdhocCorrection(
  projectRoot: string,
  harnessRoot: string,
  frameworkRoot: string,
): Promise<number> {
  const state = readCorrectionState(projectRoot);
  if (!state) {
    console.error('❌ adhoc-correction: 无有效 .current-correction.json —— 请先 --correction-init（no-feature 归属）');
    return 1;
  }
  if (state.feature) {
    console.error(
      `❌ adhoc-correction: 当前修正归属 feature "${state.feature}"，应重跑该 feature 的 revalidate phase（--adhoc-correction 仅承载 no-feature 修正）`,
    );
    return 1;
  }
  const staleness = assessCorrectionStaleness(state, {
    currentSessionId: resolveCurrentSessionSignal(projectRoot),
  });
  if (staleness.stale) {
    console.error(`❌ adhoc-correction: 修正状态 stale（${staleness.reason}）—— 请重建 correction`);
    return 1;
  }

  const results: CheckResult[] = [];
  const ctx = buildAdhocCheckContext(projectRoot, harnessRoot, frameworkRoot);

  // 1) changed-files：git diff base_commit ∪ 工作区（含 staged/untracked）
  const diff = diffChangedFiles({ projectRoot, baseRef: state.base_commit });
  if (!diff.executed) {
    results.push({
      id: 'adhoc_changed_files',
      category: 'traceability',
      description: '修正变更文件推导（git diff base_commit ∪ 工作区）',
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `无法执行 git diff：${diff.error ?? '未知错误'}（fail-closed）`,
    });
  } else {
    results.push({
      id: 'adhoc_changed_files',
      category: 'traceability',
      description: '修正变更文件推导（git diff base_commit ∪ 工作区）',
      severity: 'MINOR',
      status: 'PASS',
      details: `base=${state.base_commit.slice(0, 12)}，共 ${diff.changedFiles.length} 个变更文件`,
    });
  }
  const changedFiles = diff.executed ? diff.changedFiles : [];

  // 2) catalog 反查 touched modules（diff_within_scope 的 no-feature 替代——不豁免越界防护）
  const lookup = reverseLookupTouchedModules(projectRoot, changedFiles);
  results.push({
    id: 'adhoc_touched_modules',
    category: 'traceability',
    description: 'catalog 反查触及模块（记录回 correction state）',
    severity: 'BLOCKER',
    status: lookup.unattributed.length === 0 ? 'PASS' : 'FAIL',
    details:
      lookup.unattributed.length === 0
        ? `touched modules: ${lookup.touched.length > 0 ? lookup.touched.join(', ') : '(无层内变更)'}`
        : `层内变更无法归属任何 catalog 模块（${lookup.unattributed.length} 个）：\n` +
          lookup.unattributed.slice(0, 10).map((f) => `  - ${f}`).join('\n') +
          '\n请补 module-catalog 的 entry_file 或确认改动落点。',
  });

  // 3)-5) compile / lint / 架构规则 三段各自按 capability/provider 判定，互不连带
  // （codex 批次 2 review P2：compile 的 SKIP 声明不得让 lint/架构规则消失——
  //   契约是 no-feature 必跑三项，缺哪项由该项自身语义呈现）
  const host = tryLoadProfileCodingHost(ctx.resolvedProfile.profileDir);

  // 3) 编译（profile provider；SKIP 声明按 SKIP 语义）
  if (isCapabilitySkipped(ctx.resolvedProfile, 'coding.compile')) {
    results.push({
      id: 'adhoc_compile',
      category: 'structure',
      description: '编译检查（profile 声明 SKIP coding.compile）',
      severity: 'MINOR',
      status: 'PASS',
      details: 'capability SKIP：按 profile 声明跳过',
    });
  } else if (!host) {
    results.push({
      id: 'adhoc_compile',
      category: 'structure',
      description: '编译检查（复用 profile coding host）',
      severity: 'BLOCKER',
      status: 'FAIL',
      details: '宿主 profile 未提供 coding-host-rules；无法验证可编译性（fail-closed）',
    });
  } else {
    try {
      const rs = await host.checkCodingCompile(ctx);
      results.push(...rs.map((r) => ({ ...r, id: r.id.startsWith('adhoc_') ? r.id : `adhoc_${r.id}` })));
    } catch (err) {
      results.push({
        id: 'adhoc_compile',
        category: 'structure',
        description: '编译检查执行失败',
        severity: 'BLOCKER',
        status: 'FAIL',
        details: (err as Error).message,
      });
    }
  }

  // 4) lint（独立判定：capability SKIP > provider 在场 > 可见缺项 WARN）
  if (isCapabilitySkipped(ctx.resolvedProfile, 'coding.lint')) {
    results.push({
      id: 'adhoc_lint',
      category: 'structure',
      description: 'lint 检查（profile 声明 SKIP coding.lint）',
      severity: 'MINOR',
      status: 'PASS',
      details: 'capability SKIP：按 profile 声明跳过',
    });
  } else if (host && typeof host.checkCodingLint === 'function') {
    try {
      const rs = await host.checkCodingLint(ctx);
      results.push(...rs.map((r) => ({ ...r, id: r.id.startsWith('adhoc_') ? r.id : `adhoc_${r.id}` })));
    } catch (err) {
      results.push({
        id: 'adhoc_lint',
        category: 'structure',
        description: 'lint 检查执行失败',
        severity: 'MAJOR',
        status: 'FAIL',
        details: (err as Error).message,
      });
    }
  } else {
    results.push({
      id: 'adhoc_lint',
      category: 'structure',
      description: 'lint 检查（宿主未提供 provider）',
      severity: 'MAJOR',
      status: 'WARN',
      details: '宿主 profile 未提供 checkCodingLint——可见缺项，不阻断',
    });
  }

  // 5) 架构规则（层依赖 / 跨模块出口）——只扫描变更中的宿主源码文件。
  //    host 缺失时源码后缀集未知 → MINOR SKIP（代码工程的 fail-closed 已由
  //    adhoc_compile 的 BLOCKER FAIL 分支承担；纯文档工程属合法形态）
  if (!host) {
    results.push({
      id: 'adhoc_architecture_rules',
      category: 'structure',
      description: '架构规则检查（宿主未提供 coding host，源码后缀集未知）',
      severity: 'MINOR',
      status: 'SKIP',
      details: '无 coding-host-rules 可派生 sourceFileSuffixes；代码工程请补 profile coding host。',
    });
  } else {
    const suffixes = host.sourceFileSuffixes.map((s) => (s.startsWith('.') ? s : `.${s}`));
    const changedSources = changedFiles.filter(
      (f) => suffixes.some((suf) => f.endsWith(suf)) && fs.existsSync(path.join(projectRoot, f)),
    );
    try {
      const cfg = loadFrameworkConfig(projectRoot);
      const analyzer = new AstAnalyzer(projectRoot, cfg.architecture);
      const analyses = changedSources.length > 0 ? analyzer.analyzeFiles(changedSources) : [];
      const violations: string[] = [];
      for (const a of analyses) {
        for (const v of analyzer.checkInternalLayerCompliance(a)) violations.push(v.message);
        for (const v of analyzer.checkArchLayerCompliance(a)) violations.push(v.message);
      }
      results.push({
        id: 'adhoc_architecture_rules',
        category: 'structure',
        description: '架构规则检查（模块内分层 + 跨模块依赖，变更源码范围）',
        severity: 'BLOCKER',
        status: violations.length === 0 ? 'PASS' : 'FAIL',
        details:
          violations.length === 0
            ? `${changedSources.length} 个变更源码文件均符合架构规则`
            : `${violations.length} 处违规：\n` + violations.slice(0, 10).map((v) => `  - ${v}`).join('\n'),
      });
    } catch (err) {
      results.push({
        id: 'adhoc_architecture_rules',
        category: 'structure',
        description: '架构规则检查执行失败',
        severity: 'BLOCKER',
        status: 'FAIL',
        details: (err as Error).message,
      });
    }
  }

  // 6) 验证转嫁禁令：touched 含验证层而宿主无 device 能力 → 显式 evidence 缺口 halt-confirm
  const touchesVerification = state.touched_layers.some((l) => VERIFICATION_CATEGORIES.has(l));
  if (touchesVerification) {
    const deviceSkipped =
      isCapabilitySkipped(ctx.resolvedProfile, 'device_test.run') ||
      !ctx.resolvedProfile.capabilities['device_test.run']?.provider ||
      ctx.resolvedProfile.capabilities['device_test.run']?.provider === 'none';
    if (deviceSkipped) {
      results.push({
        id: 'adhoc_verification_evidence',
        category: 'traceability',
        description: '验证转嫁禁令：修正触及验证层但宿主无 device 验证能力',
        severity: 'BLOCKER',
        status: 'FAIL',
        details:
          '需要人工验证（evidence 缺口，halt-confirm）：\n' +
          '  - 修正声明触及验证层，但当前宿主无 device_test.run 能力，agent 不得以"已自测"替代；\n' +
          '  - 请真人执行验证并以 manual_confirm 记录（真人 + 时间），或在具备 device 能力的环境重跑。',
        failure_kind: 'verification_evidence_gap',
      });
    } else {
      results.push({
        id: 'adhoc_verification_evidence',
        category: 'traceability',
        description: '验证层 evidence 能力在场（device_test.run 可用）',
        severity: 'MINOR',
        status: 'PASS',
        details: 'revalidate 的 testing 证据沿用 device-testing 即席报告契约。',
      });
    }
  }

  // 报告落盘（确定性路径，不落 features_dir；不建临时假 feature 目录）
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(adhocReportsRoot(harnessRoot), ts);
  fs.mkdirSync(outDir, { recursive: true });
  const blockerFails = results.filter((r) => r.severity === 'BLOCKER' && r.status === 'FAIL');
  const verdict = blockerFails.length === 0 ? 'PASS' : 'FAIL';
  const generatedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(outDir, 'correction-report.json'),
    JSON.stringify(
      {
        schema_version: '1.0',
        verdict,
        generated_at: generatedAt,
        base_commit: state.base_commit,
        touched_modules: lookup.touched,
        results,
      },
      null,
      2,
    ) + '\n',
    'utf-8',
  );
  const mdLines = [
    `# Adhoc Correction Report（no-feature）`,
    '',
    `- verdict: **${verdict}**`,
    `- generated_at: ${generatedAt}`,
    `- base_commit: ${state.base_commit}`,
    `- touched_modules: ${lookup.touched.join(', ') || '(none)'}`,
    '',
    '## Revalidate 结果',
    '',
    ...results.map(
      (r) => `- [${r.status}] ${r.id}（${r.severity}）：${(r.details ?? '').split('\n')[0]}`,
    ),
    '',
  ];
  fs.writeFileSync(path.join(outDir, 'correction-report.md'), mdLines.join('\n'), 'utf-8');

  // touched modules 记录回 state（catalog 反查结果）
  writeCorrectionState(projectRoot, { ...state, touched_modules: lookup.touched });

  console.log(`${verdict === 'PASS' ? '✅' : '❌'} adhoc-correction: verdict=${verdict}`);
  console.log(`   报告: ${path.relative(projectRoot, outDir).replace(/\\/g, '/')}/correction-report.md`);
  if (blockerFails.length > 0) {
    for (const b of blockerFails) {
      console.error(`   BLOCKER ${b.id}: ${(b.details ?? '').split('\n')[0]}`);
    }
  }
  return verdict === 'PASS' ? 0 : 1;
}
