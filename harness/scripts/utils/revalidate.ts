// ============================================================================
// revalidate.ts — `--revalidate --feature <f> [--from <phase>]`（plan 07a41ec6 T8 /
// openspec efficiency-first-closure「Revalidate is a check executor」）
// ----------------------------------------------------------------------------
// 只是检查执行器：不拥有阶段推进、不建第二套状态机。
//   · 链由 resolveUpstreamPhaseChain 取，stale 由 recomputePhaseEvidenceStaleness 判；
//   · 按链序对每个目标阶段重跑该阶段 harness（现有 checks；T6 同键复用让 testing 不必真机重跑），
//     harness 在跑内已含 check-receipt + finalize（T4 路径）；未闭环时再走 sync-closure 打印 blocker；
//   · FAIL 即停，打印该阶段 blocker 与改法；
//   · 语义 verifier 不重跑：材料未变复用既有报告，材料变了但历史有 PASS 走
//     completed_with_prior_review（T7）——结果如实标 script_revalidated / semantic_not_reverified，
//     不宣称完整语义再审。
// 记录落 <feature>/revalidation.json（机器可读；不是状态机，只是本次执行的账）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

import { featureDir, featurePhaseReportsDir } from '../../config';
import { recomputePhaseEvidenceStaleness, type PhaseStalenessResult } from './phase-evidence-manifest';
import { runSyncClosureDetailed } from './phase-state';
import { resolveUpstreamPhaseChain } from './upstream-verdict-gate';
import { loadVerifierEvidenceForSubject } from './verifier-evidence';

/** 子进程 harness 据此在 summary 里标 script_revalidated（不宣称语义再审）。 */
export const REVALIDATE_ENV = 'MAISON_REVALIDATE';
export const REVALIDATION_RECORD_FILE = 'revalidation.json';

export interface RevalidationTarget {
  phase: string;
  reason: 'stale' | 'tampered' | 'from' | 'downstream_of_from';
}

export interface RevalidationPlan {
  chain: string[];
  targets: RevalidationTarget[];
  skipped: Array<{ phase: string; reason: string }>;
}

/**
 * 纯函数：从链、新鲜度与 --from 选出要重跑的阶段（按链序）。
 *   · 尚未跑过（无 summary.json）的阶段不在重验域——那是"未完成"，不是"输入变了"；
 *   · 跑过但从未闭环（manifest missing）同理，按正常流程完成；
 *   · --from 指定起点：起点及其下游（跑过的）一律重跑，不看新鲜度。
 */
export function planRevalidation(
  chain: string[],
  staleness: PhaseStalenessResult[],
  from: string | undefined,
  hasSummary: (phase: string) => boolean,
): RevalidationPlan {
  const byPhase = new Map(staleness.map(s => [s.phase, s]));
  const fromIdx = from ? chain.indexOf(from) : -1;
  if (from && fromIdx < 0) {
    throw new Error(`--from ${from} 不在该 feature 的 phase 链：${chain.join(' → ')}`);
  }
  const targets: RevalidationTarget[] = [];
  const skipped: Array<{ phase: string; reason: string }> = [];
  chain.forEach((phase, i) => {
    const s = byPhase.get(phase);
    if (!hasSummary(phase)) {
      skipped.push({ phase, reason: '尚未跑过（无 summary.json），不在重验域' });
      return;
    }
    if (fromIdx >= 0 && i >= fromIdx) {
      targets.push({ phase, reason: i === fromIdx ? 'from' : 'downstream_of_from' });
      return;
    }
    if (s && (s.verdict === 'stale' || s.verdict === 'tampered')) {
      targets.push({ phase, reason: s.verdict });
    } else {
      skipped.push({ phase, reason: s ? `verdict=${s.verdict}` : '无新鲜度记录' });
    }
  });
  return { chain, targets, skipped };
}

export interface RevalidationPhaseResult {
  phase: string;
  reason: RevalidationTarget['reason'];
  verdict: string;
  closure_status: string;
  verifier: 'reused_same_material' | 'completed_with_prior_review' | 'not_applicable' | 'missing';
  flags: string[];
  exit_code: number;
}

interface SummaryLike {
  verdict?: string;
  closure_status?: string;
  verifier_subject_id?: string;
  verifier_closure?: { mode?: string; current_material_not_reverified?: string[] };
  blockers?: Array<{ id?: string; details_excerpt?: string; details?: string; suggestion?: string }>;
  next_action?: string;
}

function readSummary(projectRoot: string, feature: string, phase: string, frameworkRoot?: string): SummaryLike | null {
  try {
    const abs = path.join(featurePhaseReportsDir(projectRoot, feature, phase, frameworkRoot), 'summary.json');
    if (!fs.existsSync(abs)) return null;
    return JSON.parse(fs.readFileSync(abs, 'utf-8')) as SummaryLike;
  } catch {
    return null;
  }
}

/**
 * 重验账本里的 verifier 字段（**只是记录，不阻断**）。plan d2f7a9c4：走共享 loader 读 MD，
 * 不手拼路径、不看残留旧 .json——否则同材料复用会被误记成 missing。export 供单测直驱。
 */
export function verifierModeOf(projectRoot: string, feature: string, phase: string, summary: SummaryLike | null, frameworkRoot?: string): RevalidationPhaseResult['verifier'] {
  if (!summary?.verifier_subject_id) return 'not_applicable';
  if (summary.verifier_closure?.mode === 'completed_with_prior_review') return 'completed_with_prior_review';
  // plan d2f7a9c4：走共享 loader（读 MD + 校验终态块），不手拼路径、不看残留旧 .json。
  // 只有"存在且校验通过"才算可复用；报告在但终态块坏 = 不可复用，与缺失同判。
  const loaded = loadVerifierEvidenceForSubject(projectRoot, feature, phase, summary.verifier_subject_id, {
    frameworkRoot,
  });
  return loaded.ok ? 'reused_same_material' : 'missing';
}

function printBlockers(summary: SummaryLike | null): void {
  const blockers = summary?.blockers ?? [];
  if (blockers.length === 0) {
    console.log(`   （summary 无 blockers 列表；next_action=${summary?.next_action ?? '?'}）`);
    return;
  }
  for (const b of blockers.slice(0, 12)) {
    console.log(`   ✗ ${b.id ?? '?'}：${(b.details_excerpt ?? b.details ?? '').split(/\r?\n/)[0]}`);
    if (b.suggestion) console.log(`     改法：${b.suggestion.split(/\r?\n/)[0]}`);
  }
}

export function runRevalidate(
  harnessRoot: string,
  projectRoot: string,
  frameworkRoot: string,
  feature: string,
  from?: string,
): number {
  const startedAt = new Date().toISOString();
  const resolution = resolveUpstreamPhaseChain(projectRoot, feature);
  const chain = [...resolution.chain];
  const hasSummary = (phase: string): boolean =>
    fs.existsSync(path.join(featurePhaseReportsDir(projectRoot, feature, phase, frameworkRoot), 'summary.json'));
  const before = recomputePhaseEvidenceStaleness(projectRoot, feature, chain, { frameworkRoot });

  console.log(`\n🔁 revalidate: feature=${feature}${from ? `, from=${from}` : ''}`);
  console.log(`   链：${chain.join(' → ')}${resolution.degraded ? `（workflow 链退化：${resolution.degradedReason}）` : ''}`);
  for (const s of before) {
    console.log(`   - ${s.phase}: ${s.verdict}${s.changed_paths.length > 0 ? `（变更：${s.changed_paths.slice(0, 4).join('、')}${s.changed_paths.length > 4 ? '…' : ''}）` : ''}${s.propagated_from ? `（上游 ${s.propagated_from} 传染）` : ''}`);
  }

  let plan: RevalidationPlan;
  try {
    plan = planRevalidation(chain, before, from, hasSummary);
  } catch (e) {
    console.error(`错误: ${(e as Error).message}`);
    return 1;
  }
  const results: RevalidationPhaseResult[] = [];
  const writeRecord = (exitCode: number): void => {
    const after = recomputePhaseEvidenceStaleness(projectRoot, feature, chain, { frameworkRoot });
    const record = {
      schema_version: '1.0',
      feature,
      from: from ?? null,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      chain,
      targets: plan.targets,
      skipped: plan.skipped,
      results,
      staleness_after: after.map(s => ({ phase: s.phase, verdict: s.verdict })),
      exit_code: exitCode,
      note: '只重跑脚本门禁并按 T4 路径闭环；语义 verifier 未重跑（见各阶段 flags / summary.verifier_closure）',
    };
    try {
      const dir = featureDir(projectRoot, feature);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, REVALIDATION_RECORD_FILE), `${JSON.stringify(record, null, 2)}\n`, 'utf-8');
    } catch {
      /* 账本落盘失败不改变退出码 */
    }
  };

  if (plan.targets.length === 0) {
    console.log('   链上没有需要重验的阶段（无 stale/tampered，且未指定 --from）。');
    writeRecord(0);
    return 0;
  }
  console.log(`   重验目标：${plan.targets.map(t => `${t.phase}(${t.reason})`).join('、')}`);
  for (const s of plan.skipped) console.log(`   跳过 ${s.phase}：${s.reason}`);

  const isWin = process.platform === 'win32';
  for (const target of plan.targets) {
    console.log(`\n▶ revalidate ${target.phase}（${target.reason}）——重跑脚本门禁`);
    const run = spawnSync(
      isWin ? 'npx.cmd' : 'npx',
      ['ts-node', '--transpile-only', path.join(harnessRoot, 'harness-runner.ts'), '--phase', target.phase, '--feature', feature],
      { cwd: harnessRoot, shell: isWin, stdio: 'inherit', env: { ...process.env, [REVALIDATE_ENV]: '1' } },
    );
    let summary = readSummary(projectRoot, feature, target.phase, frameworkRoot);
    const verdict = summary?.verdict ?? 'UNKNOWN';
    if (run.status !== 0 || verdict !== 'PASS') {
      console.error(`\n❌ revalidate 中断于 ${target.phase}：脚本 verdict=${verdict}（exit=${run.status ?? 'null'}）`);
      printBlockers(summary);
      results.push({
        phase: target.phase, reason: target.reason, verdict, closure_status: summary?.closure_status ?? 'open',
        verifier: verifierModeOf(projectRoot, feature, target.phase, summary, frameworkRoot), flags: ['script_revalidated'], exit_code: run.status ?? 1,
      });
      writeRecord(1);
      return 1;
    }
    let closure = summary?.closure_status ?? 'open';
    if (closure !== 'closed') {
      const sync = runSyncClosureDetailed(harnessRoot, projectRoot, feature, target.phase, frameworkRoot);
      summary = readSummary(projectRoot, feature, target.phase, frameworkRoot);
      closure = summary?.closure_status ?? closure;
      if (sync.exitCode !== 0 || closure !== 'closed') {
        console.error(`\n❌ revalidate 中断于 ${target.phase}：脚本 PASS 但未闭环（closure_status=${closure}）——按上方 check-receipt 输出补齐后重跑 --revalidate`);
        results.push({
          phase: target.phase, reason: target.reason, verdict, closure_status: closure,
          verifier: verifierModeOf(projectRoot, feature, target.phase, summary, frameworkRoot), flags: ['script_revalidated'], exit_code: sync.exitCode || 1,
        });
        writeRecord(sync.exitCode || 1);
        return sync.exitCode || 1;
      }
    }
    const verifier = verifierModeOf(projectRoot, feature, target.phase, summary, frameworkRoot);
    results.push({
      phase: target.phase, reason: target.reason, verdict, closure_status: closure, verifier,
      flags: ['script_revalidated', ...(verifier === 'completed_with_prior_review' ? ['semantic_not_reverified'] : [])],
      exit_code: 0,
    });
  }

  const after = recomputePhaseEvidenceStaleness(projectRoot, feature, chain, { frameworkRoot });
  const allFresh = after.every(s => s.verdict === 'fresh' || !hasSummary(s.phase));
  console.log('\n📋 revalidate 结果');
  console.log('| phase | 脚本 | 闭环 | verifier | 标注 |');
  console.log('|---|---|---|---|---|');
  for (const r of results) console.log(`| ${r.phase} | ${r.verdict} | ${r.closure_status} | ${r.verifier} | ${r.flags.join(', ')} |`);
  console.log(`   链新鲜度：${after.map(s => `${s.phase}=${s.verdict}`).join('，')}`);
  if (results.some(r => r.verifier === 'completed_with_prior_review')) {
    console.log('   ⚠ 有阶段沿用既往 verifier PASS（semantic_not_reverified）：当前材料的语义未重审，差异见 summary.verifier_closure。');
  }
  writeRecord(allFresh ? 0 : 1);
  return allFresh ? 0 : 1;
}
