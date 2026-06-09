#!/usr/bin/env ts-node
// ============================================================================
// Goal runner — tool-agnostic deterministic multi-phase orchestrator
// ============================================================================
// Usage (from repo root or instance root):
//   cd framework/harness && npx ts-node scripts/goal-runner.ts \
//     --feature <f> --requirement "..." --adapter claude \
//     [--start prd] [--end testing] [--dry-run] [--resume <run-id> --feature <f>]
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import minimist from 'minimist';
import {
  loadFrameworkConfig,
  loadFrameworkConfigWithSources,
  featurePhaseReportsDir,
} from '../config';
import { detectRepoLayout } from '../repo-layout';
import { resolveWorkflowSpec } from '../workflow-loader';
import {
  classifyPhaseVerdict,
  formatDeferredUpstreamNotice,
  resolveAutoChain,
  resolveGoalRunStatus,
  type FeaturePhase,
  type HarnessVerdict,
} from './utils/phase-transition-policy';
import {
  buildGoalManifestFromInput,
  loadGoalManifestFile,
  loadGoalManifestFromRun,
  writeGoalManifest,
  type GoalManifest,
} from './utils/goal-manifest';
import {
  generateGoalReportJson,
  loadGoalReportJson,
  writeGoalReport,
  type GoalPhaseOutcome,
} from './utils/goal-report-generator';
import {
  invokeAgentHeadless,
  resolveHeadlessInvokePlan,
  type InvokeTemplateVars,
} from './utils/agent-invoke';
import {
  checkRunBudget,
  getSummaryMtime,
  loadEventsJsonl,
  resolvePhaseHarnessVerdict,
  resolveResumeFromEvents,
  resolveResumeState,
} from './utils/goal-runner-phase';
import { MAISON_GOAL_RUNNER_ENV } from './utils/phase-state';
import { loadGoalCapability } from './utils/goal-adapter-capability';
import {
  resolveAdapterProvenance,
  runGoalPreflight,
} from './utils/goal-preflight';

const PHASE_SKILL_REL: Record<FeaturePhase, string> = {
  prd: 'skills/feature/prd-design/SKILL.md',
  design: 'skills/feature/requirement-design/SKILL.md',
  coding: 'skills/feature/coding/SKILL.md',
  review: 'skills/feature/code-review/SKILL.md',
  ut: 'skills/feature/business-ut/SKILL.md',
  testing: 'skills/feature/device-testing/SKILL.md',
};

interface SummaryJson {
  verdict?: HarnessVerdict;
  blocking_class?: string;
  failure_kind?: string;
  blockers?: Array<{ blocking_class?: string; classification?: string }>;
}

function appendEvent(reportDir: string, projectRoot: string, event: Record<string, unknown>): void {
  const abs = path.join(projectRoot, reportDir, 'events.jsonl');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.appendFileSync(abs, JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n', 'utf-8');
}

function readPhaseSummary(
  projectRoot: string,
  feature: string,
  phase: FeaturePhase,
): {
  summary: SummaryJson | null;
  summaryPath: string | null;
  summaryAbsPath: string | null;
  reportDir: string | null;
} {
  const dir = featurePhaseReportsDir(projectRoot, feature, phase);
  const summaryPath = path.join(dir, 'summary.json');
  if (!fs.existsSync(summaryPath)) {
    return { summary: null, summaryPath: null, summaryAbsPath: null, reportDir: dir };
  }
  try {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as SummaryJson;
    const rel = path.relative(projectRoot, summaryPath).replace(/\\/g, '/');
    const relDir = path.relative(projectRoot, dir).replace(/\\/g, '/');
    return { summary, summaryPath: rel, summaryAbsPath: summaryPath, reportDir: relDir };
  } catch {
    return { summary: null, summaryPath: null, summaryAbsPath: null, reportDir: dir };
  }
}

function extractBlockingMeta(summary: SummaryJson | null): {
  blocking_class?: string;
  failure_kind?: string;
} {
  if (!summary) return {};
  if (summary.blocking_class || summary.failure_kind) {
    return { blocking_class: summary.blocking_class, failure_kind: summary.failure_kind };
  }
  const b = summary.blockers?.[0];
  if (!b) return {};
  return { blocking_class: b.blocking_class, failure_kind: b.classification };
}

function runHarnessPhase(
  projectRoot: string,
  frameworkRoot: string,
  phase: FeaturePhase,
  feature: string,
  dryRun: boolean,
): number {
  if (dryRun) return 0;
  const harnessDir = path.join(frameworkRoot, 'harness');
  const result = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['ts-node', 'harness-runner.ts', '--phase', phase, '--feature', feature, '--summary'],
    {
      cwd: harnessDir,
      encoding: 'utf-8',
      shell: process.platform === 'win32',
      env: { ...process.env, [MAISON_GOAL_RUNNER_ENV]: '1' },
    },
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.status ?? 1;
}

function buildPhasePrompt(
  manifest: GoalManifest,
  phase: FeaturePhase,
  frameworkRoot: string,
  deferredUpstream: Array<{ phase: FeaturePhase; reason: string }>,
): string {
  const skillAbs = path.join(frameworkRoot, PHASE_SKILL_REL[phase]);
  const parts = [
    `# Goal run phase: ${phase}`,
    '',
    `Feature: ${manifest.feature}`,
    manifest.requirement ? `Requirement:\n${manifest.requirement}` : '',
    '',
    formatDeferredUpstreamNotice(deferredUpstream),
    `Read and follow the phase skill: ${PHASE_SKILL_REL[phase]}`,
    `Skill absolute path: ${skillAbs}`,
    '',
    'After producing artifacts, run harness for this phase and ensure summary.json is written.',
    'Do NOT claim phase complete if harness verdict is INCOMPLETE or FAIL.',
  ].filter(Boolean);
  return parts.join('\n');
}


function main(): void {
  const argv = minimist(process.argv.slice(2), {
    string: ['feature', 'requirement', 'adapter', 'start', 'end', 'resume', 'manifest'],
    boolean: ['help', 'dry-run'],
    alias: { f: 'feature', h: 'help' },
  });

  if (argv.help) {
    console.log(`
Goal runner — tool-agnostic multi-phase orchestrator

  npx ts-node scripts/goal-runner.ts --feature <f> --requirement "<text>" --adapter claude
    [--start prd] [--end testing] [--dry-run] [--resume <run-id> --feature <f>] [--manifest <file>]
`);
    process.exit(0);
  }

  // detectRepoLayout 从 __dirname 或 cwd 向上查找工程根，
  // 兼容从 framework/harness（SKILL 指示路径）和工程根两种 cwd 启动。
  // inferRepoLayout 假设 cwd 即 projectRoot，从 framework/harness 启动会失败。
  const layout = detectRepoLayout(__dirname);
  const projectRoot = layout.projectRoot;
  const frameworkRoot = layout.frameworkRoot;
  const cfg = loadFrameworkConfig(projectRoot);
  const workflow = resolveWorkflowSpec(projectRoot, { config: cfg, frameworkRoot });

  const featuresDir = cfg.paths.features_dir ?? 'doc/features';

  let manifest: GoalManifest;
  if (argv.resume) {
    if (!argv.manifest && !argv.feature) {
      console.error('[goal-runner] BLOCKER: --resume 须配 --feature 或 --manifest');
      process.exit(1);
    }
    if (argv.manifest) {
      manifest = loadGoalManifestFile(String(argv.manifest), projectRoot, { featuresDir });
    } else {
      manifest = loadGoalManifestFromRun(projectRoot, String(argv.resume), {
        feature: String(argv.feature),
        featuresDir,
      });
    }
  } else if (argv.manifest) {
    manifest = loadGoalManifestFile(String(argv.manifest), projectRoot, { featuresDir });
  } else {
    manifest = buildGoalManifestFromInput(
      {
        start_phase: argv.start ?? 'prd',
        end_phase: argv.end ?? 'testing',
        feature: argv.feature,
        requirement: argv.requirement,
        adapter: argv.adapter ?? cfg.agent_adapter,
        unattended: {
          write_mode: 'workspace-write',
          approval_mode: 'never',
          max_turns: 20,
          timeout_seconds: 3600,
        },
      },
      { projectRoot, featuresDir },
    );
  }

  const dryRun = Boolean(argv['dry-run']);
  const { adapterStatus } = loadFrameworkConfigWithSources(projectRoot);
  const provenance = resolveAdapterProvenance(
    {
      adapter: argv.adapter ? String(argv.adapter) : undefined,
      manifest: argv.manifest ? String(argv.manifest) : undefined,
      resume: argv.resume ? String(argv.resume) : undefined,
    },
    adapterStatus,
  );
  runGoalPreflight({
    projectRoot,
    frameworkRoot,
    manifest,
    provenance,
    dryRun,
  });
  writeGoalManifest(manifest, projectRoot);
  appendEvent(manifest.report_dir, projectRoot, { type: 'run_start', dry_run: dryRun });

  const chain = resolveAutoChain(
    workflow,
    manifest.start_phase,
    manifest.end_phase,
    manifest.chain_override,
  );

  const cap = loadGoalCapability(frameworkRoot, manifest.adapter!);
  let outcomes: GoalPhaseOutcome[] = [];
  let deferredUpstream: Array<{ phase: FeaturePhase; reason: string }> = [];
  let chainStartIndex = 0;

  if (argv.resume) {
    const priorReport = loadGoalReportJson(projectRoot, manifest.report_dir);
    if (priorReport?.phases?.length) {
      const resume = resolveResumeState(chain, priorReport.phases);
      outcomes = [...resume.priorOutcomes];
      deferredUpstream = [...resume.deferredUpstream];
      chainStartIndex = resume.startIndex;
    } else {
      const events = loadEventsJsonl(path.join(projectRoot, manifest.report_dir, 'events.jsonl'));
      const resume = resolveResumeFromEvents(chain, events);
      outcomes = [...resume.priorOutcomes];
      deferredUpstream = [...resume.deferredUpstream];
      chainStartIndex = resume.startIndex;
    }
    appendEvent(manifest.report_dir, projectRoot, {
      type: 'resume',
      start_index: chainStartIndex,
      start_phase: chain[chainStartIndex],
    });
  }

  let totalTurns = 0;
  let halted = false;
  const startMs = Date.now();
  const wallMs = manifest.budget.wall_clock_minutes * 60 * 1000;

  for (let phaseIdx = chainStartIndex; phaseIdx < chain.length; phaseIdx++) {
    const phase = chain[phaseIdx];
    let retries = 0;
    let phaseDone = false;

    while (!phaseDone) {
      const budget = checkRunBudget(
        totalTurns,
        manifest.budget.max_total_turns,
        Date.now() - startMs,
        wallMs,
      );
      if (budget !== 'ok') {
        halted = true;
        appendEvent(manifest.report_dir, projectRoot, {
          type: budget === 'wall_clock' ? 'budget_wall_clock' : 'budget_turns',
          phase,
        });
        outcomes.push({
          phase,
          verdict: 'FAIL',
          halted: true,
          retries,
        });
        break;
      }

      totalTurns++;
      const phaseDir = path.join(projectRoot, manifest.report_dir, 'phases', phase);
      fs.mkdirSync(phaseDir, { recursive: true });
      const promptPath = path.join(phaseDir, 'prompt.md');
      const prompt = buildPhasePrompt(manifest, phase, frameworkRoot, deferredUpstream);
      fs.writeFileSync(promptPath, prompt, 'utf-8');

      const { summaryAbsPath: summaryPathBefore } = readPhaseSummary(
        projectRoot,
        manifest.feature,
        phase,
      );
      const summaryMtimeBefore = getSummaryMtime(summaryPathBefore);

      const vars: InvokeTemplateVars = {
        PROMPT_FILE: promptPath,
        PROMPT: prompt,
        SKILL_PATH: path.join(frameworkRoot, PHASE_SKILL_REL[phase]),
        PROJECT_ROOT: projectRoot,
        FRAMEWORK_ROOT: frameworkRoot,
        FEATURE: manifest.feature,
        PHASE: phase,
      };
      const invokePlan = resolveHeadlessInvokePlan(
        manifest.adapter!,
        cap.capability!,
        manifest.unattended,
        prompt,
        vars,
      );
      const invoke = invokeAgentHeadless(invokePlan, projectRoot, {
        dryRun,
        timeoutMs: (manifest.unattended.timeout_seconds ?? 3600) * 1000,
      });
      fs.writeFileSync(path.join(phaseDir, 'agent-output.log'), invoke.stdout + invoke.stderr, 'utf-8');
      appendEvent(manifest.report_dir, projectRoot, {
        type: 'agent_invoke',
        phase,
        exit_code: invoke.exitCode,
        skipped: invoke.skipped,
        command: invoke.command,
      });

      const harnessExit = runHarnessPhase(projectRoot, frameworkRoot, phase, manifest.feature, dryRun);
      const { summary, summaryPath, summaryAbsPath, reportDir } = readPhaseSummary(
        projectRoot,
        manifest.feature,
        phase,
      );
      const summaryMtimeAfter = getSummaryMtime(summaryAbsPath);
      const resolved = resolvePhaseHarnessVerdict({
        dryRun,
        agentExitCode: invoke.exitCode,
        agentSkipped: invoke.skipped,
        harnessExitCode: harnessExit,
        summaryBeforeMtime: summaryMtimeBefore,
        summaryAfterMtime: summaryMtimeAfter,
        summaryVerdict: summary?.verdict as HarnessVerdict | undefined,
      });
      const verdict = resolved.verdict;
      const meta = extractBlockingMeta(summary);
      const action = classifyPhaseVerdict({
        verdict,
        ...meta,
        dependency_policy: manifest.dependency_policy,
        retries_used: retries,
        max_retries_per_phase: manifest.budget.max_retries_per_phase,
      });

      appendEvent(manifest.report_dir, projectRoot, {
        type: 'phase_verdict',
        phase,
        verdict,
        action,
        harness_exit: harnessExit,
        stale_summary: resolved.stale_summary,
        agent_failed: resolved.agent_failed,
      });

      if (action === 'advance') {
        outcomes.push({
          phase,
          verdict,
          summary_path: summaryPath ?? undefined,
          report_dir: reportDir ?? undefined,
          retries,
        });
        phaseDone = true;
        continue;
      }

      if (
        action === 'defer_external_and_continue_if_allowed' ||
        action === 'defer_external_and_halt'
      ) {
        const reason = meta.failure_kind ?? meta.blocking_class ?? 'external_blocked';
        deferredUpstream.push({ phase, reason });
        outcomes.push({
          phase,
          verdict,
          deferred: true,
          deferred_reason: reason,
          summary_path: summaryPath ?? undefined,
          report_dir: reportDir ?? undefined,
          retries,
        });
        phaseDone = true;
        if (action === 'defer_external_and_halt') {
          halted = true;
        }
        continue;
      }

      if (action === 'retry') {
        retries++;
        continue;
      }

      outcomes.push({
        phase,
        verdict,
        halted: true,
        summary_path: summaryPath ?? undefined,
        report_dir: reportDir ?? undefined,
        retries,
      });
      halted = true;
      phaseDone = true;
    }

    if (halted) break;
  }

  const reachedEnd =
    !halted &&
    outcomes.length === chain.length &&
    outcomes[outcomes.length - 1]?.phase === chain[chain.length - 1];

  const phaseRecords = outcomes.map((o) => ({
    phase: o.phase,
    deferred: o.deferred,
    halted: o.halted,
  }));
  const status = resolveGoalRunStatus(phaseRecords, reachedEnd);
  const report = generateGoalReportJson(manifest.run_id, manifest.feature, status, outcomes);
  writeGoalReport(projectRoot, manifest.report_dir, report);
  appendEvent(manifest.report_dir, projectRoot, { type: 'run_end', status });

  console.log('');
  console.log('GOAL_RUN_SUMMARY');
  console.log(`run_id=${manifest.run_id}`);
  console.log(`status=${status}`);
  console.log(`report_dir=${manifest.report_dir}`);
  console.log(`phases=${outcomes.map((o) => o.phase).join(',')}`);

  if (status === 'HALTED') process.exit(1);
  if (status === 'DEFERRED' || status === 'PARTIAL') process.exit(2);
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error((err as Error)?.message ?? err);
  process.exit(1);
}
