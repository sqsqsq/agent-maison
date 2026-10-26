import assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import * as ts from 'typescript';
import { clearFrameworkConfigCache, featureFilePath } from '../../config';
import { loadCanonicalBlueprint } from '../../scripts/utils/component-blueprint-path';
import { loadCanonicalChangeUnit, parseChangeUnitFeatureId } from '../../scripts/utils/change-unit-path';
import { readRunBoundContracts } from '../../scripts/utils/capability-resolution';
import { parseReviewIssueRows } from '../../scripts/utils/repair-candidates';
import { parseVerifierRequest } from '../../scripts/utils/verifier-request';
import { countAgentInvokeStarts, resolveResumedBudget } from '../../scripts/utils/goal-runner-phase';
import { BLUEPRINT_ID, assess, prepareFreshCuRequest, project, specFirstCuHooks, withFreshCuHost } from './lifecycle-evolution.unit.test';
import { boundInputs, repairAdapter, s16Born, superviseOnce } from './design-authority-repair.unit.test';
import { goalRunEvents, requestVia, runGoalRuntimeChain } from './goal-runner-testing-integrity.unit.test';
import { CU_SOURCE, goalStatusFeatureLine, publishRequestedVerifier, publishVerifier, writeCuSpecDraft } from './real-chain.unit.test';
import { publishFixtureVerifierEvidence } from '../utils/verifier-evidence-fixture';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, type UnitExecutionTiming } from '../utils/unit-case-selection';
import type { UnitCaseResult } from '../run-unit';

type Host = Parameters<Parameters<typeof withFreshCuHost>[0]>[0];
type Ev = Record<string, any>;
const REPORTS = process.env.DISPOSITION_RUNTIME_REPAIR_REPORT_DIR
  ? path.resolve(process.env.DISPOSITION_RUNTIME_REPAIR_REPORT_DIR)
  : path.resolve(__dirname, '../../reports/6fd6c8c1/review-repair-20261025');
const SOURCE = path.resolve(__dirname, '../../..');
const loadedSourceHashes = Object.fromEntries(['harness/scripts/goal-phase-runtime.ts', 'harness/scripts/utils/check-disposition.ts',
  'harness/scripts/utils/verify-feature-completion.ts', 'harness/tests/unit/disposition-runtime-repair.unit.test.ts'].map(file =>
  [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(SOURCE, file))).digest('hex')]));
const cases: Array<{ name: string; run: () => Promise<void> }> = [];
const json = (file: string): Ev => JSON.parse(fs.readFileSync(file, 'utf8'));
const end = (events: Ev[]) => [...events].reverse().find(event => event.type === 'run_end');
const published = (events: Ev[]) => events.filter(event => event.type === 'design_authority_repair' && event.stage === 'published');

async function withRepairHost(run: (s: Host) => Promise<void>): Promise<void> {
  const previous = process.env.REAL_CHAIN_DEBUG;
  try { await withFreshCuHost(async s => {
    try { await run(s); }
    catch (error) { process.env.REAL_CHAIN_DEBUG = '1'; throw error; }
  }); }
  finally { if (previous === undefined) delete process.env.REAL_CHAIN_DEBUG; else process.env.REAL_CHAIN_DEBUG = previous; }
}

function observeEvents(onEvent: (file: string, event: Ev) => void): () => void {
  const nodeFs = require('fs') as typeof fs;
  const original = nodeFs.appendFileSync;
  nodeFs.appendFileSync = ((file: fs.PathOrFileDescriptor, data: string | Uint8Array, options?: any) => {
    const result = original(file, data, options);
    if (typeof file === 'string' && path.basename(file) === 'events.jsonl') {
      for (const line of String(data).split('\n').filter(Boolean)) onEvent(file, JSON.parse(line));
    }
    return result;
  }) as typeof fs.appendFileSync;
  return () => { nodeFs.appendFileSync = original; };
}

function evidence(s: Host, feature: string, runId: string, label: string, facts: Ev): void {
  const dir = path.join(REPORTS, label); fs.mkdirSync(dir, { recursive: true });
  const runDir = featureFilePath(s.root, feature, `goal-runs/${runId}`);
  for (const file of ['events.jsonl', 'goal-report.json', 'manifest.json', 'feature-completion.json']) {
    if (fs.existsSync(path.join(runDir, file))) fs.copyFileSync(path.join(runDir, file), path.join(dir, file));
  }
  fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify({ ...facts,
    isolated_root: s.root,
    effective_binding_diagnostic: boundInputs(s, feature, runId),
    source_hashes_at_suite_load: loadedSourceHashes,
    boundary: 'Only deterministic author/verifier outputs, existing SDK providers, and the OS spawn boundary are substitutes. The real detach parent generates child argv; its original goalMain executes that argv. CLI authorization, runtime, design publication, binding, phase gates, closure and finalizer remain production. No real model, OS guardian or device is claimed.',
  }, null, 2) + '\n');
}

function completed(s: Host, feature: string, runId: string): void {
  const events = goalRunEvents(s.root, runId, feature);
  assert.equal(end(events)?.status, 'CHAIN_SLICE_COMPLETED', JSON.stringify(events.slice(-8)));
  const current = assess(s, feature);
  assert(current.complete && current.record.state !== 'absent' && current.record.run_id === runId, JSON.stringify(current));
  assert(fs.existsSync(featureFilePath(s.root, feature, `goal-runs/${runId}/feature-completion.json`)), 'production finalizer must issue the completion original');
  const contracts = readRunBoundContracts(s.root, s.frameworkRoot, feature, runId);
  assert(contracts && contracts.files?.length, 'the actual production construction reader must resolve the current bound design');
  const identity = parseChangeUnitFeatureId(feature)!;
  const currentCu = loadCanonicalChangeUnit(s.root, identity.blueprintId, identity.changeUnitId);
  const currentBlueprint = loadCanonicalBlueprint(s.root, identity.blueprintId);
  const ref = currentCu.changeUnit.component_blueprint_ref as Ev;
  assert.equal(ref.revision, currentBlueprint.blueprint.revision, 'the real CU must point to the newly published design');
  assert.equal(ref.artifact_sha256, currentBlueprint.artifactSha256);
}

function converted(parent: string[] | undefined, child: string[] | undefined): void {
  assert(parent && parent.includes('--detach'), 'the production parent must receive detach');
  assert(!parent.includes('--authorize-autonomy'), 'the test driver must not preauthorize the parent');
  assert(child && child.includes('--detached-child') && child.includes('--authorize-autonomy'), 'the real launcher must transport its normalized authorization');
  assert(!child.includes('--detach'), 'the real launcher must strip the parent transport flag');
}

function ledgerBehavior(file: string): { added: number; restored: number } {
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} as any };
  new Function('module', 'exports', compiled)(module, module.exports);
  const ledger = new module.exports.LedgerFeature();
  return { added: ledger.add(120), restored: ledger.restore([45, 55]) };
}

function reviewGate(s: Host, feature: string, runId: string, attemptId: string): void {
  const result = spawnSync(process.execPath, [require.resolve('ts-node/dist/bin.js'), '--transpile-only',
    '--project', path.join(s.frameworkRoot, 'harness/tsconfig.json'), path.join(s.frameworkRoot, 'harness/harness-runner.ts'),
    '--project-root', s.root, '--feature', feature, '--phase', 'review', '--summary'], {
    cwd: s.harnessDir, encoding: 'utf8', windowsHide: true, timeout: 60000,
    env: { ...process.env, MAISON_GOAL_RUN_ID: runId, MAISON_GOAL_ATTEMPT: attemptId, MAISON_GOAL_ATTEMPT_PHASE: 'review', MAISON_GOAL_RUNNER: '1' },
  });
  assert(!result.error && (result.status === 0 || result.status === 1), `the source gate must actually execute: ${result.error ?? result.stderr}`);
}

cases.push({
  name: '6fd R4 detach parent without injected autonomy silently publishes and rebinds the original design',
  run: () => withRepairHost(async s => {
    const b = await s16Born(s, { entry: 'detach', preauth: false, extra: { authorizeAutonomy: false } });
    try {
      converted(b.parentArgs, b.childArgs);
      assert(published(b.events).some(event => event.outcome === 'recovered'), JSON.stringify(b.events.slice(-10)));
      assert.equal(Number(loadCanonicalBlueprint(s.root, BLUEPRINT_ID).blueprint.revision), b.baseRevision + 1);
      completed(s, b.feature, b.runId);
    } finally { evidence(s, b.feature, b.runId, 'detach-authority', { parent_argv: b.parentArgs, child_argv: b.childArgs, test_authorizeAutonomy: false, published: published(b.events) }); }
  }),
}, {
  name: '6fd R4 supervisor original resume detach restores autonomy and cumulative budget before real design repair',
  run: () => withRepairHost(async s => {
    let cut = false;
    const restore = observeEvents((file, event) => {
      if (file.startsWith(s.root) && event.type === 'agent_invoke_end' && event.phase === 'spec' && !cut) {
        cut = true;
        throw new Error('bounded transport interruption after the original author returned and before its gate');
      }
    });
    let b: Awaited<ReturnType<typeof s16Born>>;
    try { b = await s16Born(s, { entry: 'detach', preauth: false, extra: { authorizeAutonomy: false } }); }
    finally { restore(); }
    let supervisor: Awaited<ReturnType<typeof superviseOnce>> | undefined;
    let resumed: Awaited<ReturnType<typeof requestVia>> | undefined;
    const before = resolveResumedBudget(b.events);
    try {
      converted(b.parentArgs, b.childArgs);
      assert.equal(end(b.events)?.status, 'INTERRUPTED', 'the initial parent must have entered the actual run before interruption');
      assert(before.totalTurns > 0 && !published(b.events).length, 'resume must inherit spent calls and unfinished design');
      supervisor = await superviseOnce(s, b.feature, b.runId);
      assert.deepEqual(supervisor.spawned, [['--feature', b.feature, '--resume', b.runId, '--force-resume', '--detach']], JSON.stringify(supervisor));
      const p = project(s, b.feature), hooks = specFirstCuHooks(p, true);
      const adapter = repairAdapter(s, () => b.saved);
      resumed = await requestVia('detach', s.root, { frameworkRoot: s.frameworkRoot, featureId: b.feature, adapter: 'codex',
        resume: b.runId, forceResume: true, authorizeAutonomy: false, ...hooks,
        onSpec: ctx => { if (ctx.attempt === 1) { p.runId = ctx.runId; writeCuSpecDraft(p); } else hooks.onSpec(ctx); },
        onOutOfChain: adapter.onOutOfChain });
      converted(resumed.parentArgs, resumed.childArgs);
      assert(resumed.parentArgs!.includes('--resume') && !supervisor.spawned[0].includes('--authorize-autonomy'));
      const events = goalRunEvents(s.root, b.runId, b.feature), after = resolveResumedBudget(events);
      assert(after.totalTurns > before.totalTurns && after.priorActiveMs >= before.priorActiveMs, 'resume must retain original calls and active time');
      assert.equal(after.totalTurns, countAgentInvokeStarts(events));
      assert.equal(events.filter(event => event.type === 'supervisor_restart').length, 1);
      assert(published(events).some(event => event.outcome === 'recovered'), 'supervisor-origin restart must silently perform the real design publication');
      completed(s, b.feature, b.runId);
    } finally { evidence(s, b.feature, b.runId, 'supervisor-authority', { initial_parent_argv: b.parentArgs, initial_child_argv: b.childArgs,
      supervisor, resumed_parent_argv: resumed?.parentArgs, resumed_child_argv: resumed?.childArgs,
      budget_before: before, budget_after: resolveResumedBudget(goalRunEvents(s.root, b.runId, b.feature)), test_authorizeAutonomy: false }); }
  }),
}, {
  name: '6fd R4 foreground session with default unattended object and no autonomy asks the design owner without publication',
  run: () => withRepairHost(async s => {
    const b = await s16Born(s, { preauth: false, extra: { viaHostBridge: true, authorizeAutonomy: false } });
    try {
      const manifest = json(featureFilePath(s.root, b.feature, `goal-runs/${b.runId}/manifest.json`));
      assert(manifest.unattended && manifest.unattended.approval_mode === 'never', 'the counterexample must contain the actual default unattended object');
      assert(!published(b.events).length && !b.events.some(event => event.type === 'agent_invoke_start' && String(event.phase).startsWith('design-repair-')));
      const halt = [...b.events].reverse().find(event => event.type === 'phase_halt');
      assert.equal(halt?.halt_reason, 'execution_scope_unresolved');
      assert.equal(halt?.design_authority?.class, 'B1');
      assert.equal(Number(loadCanonicalBlueprint(s.root, BLUEPRINT_ID).blueprint.revision), b.baseRevision, 'unattended defaults cannot silently publish');
      assert(!assess(s, b.feature).complete);
    } finally { evidence(s, b.feature, b.runId, 'session-no-authority', { test_authorizeAutonomy: false, end: end(b.events), published: published(b.events) }); }
  }),
});

cases.push({
  name: '6fd R5 terminal confirmed review finding reaches its coding owner actual repair source recheck and Feature CU completion',
  run: () => terminalOwnerRuntime(),
});

export async function terminalOwnerRuntime(): Promise<void> {
  return withRepairHost(async s => {
    const p = project(s, 'cu-bGVkZ2VyLWFwcC1ibHVlcHJpbnQAbGVkZ2VyLXJlZnJlc2g');
    const request = prepareFreshCuRequest(s);
    const hooks = specFirstCuHooks(p, true);
    let delivered = false, codingCalls = 0, repairCalls = 0, reviewCalls = 0, repaired = false;
    let sourceRevalidatedBeforeRepair = false;
    const sourceRevalidations: Ev[] = [];
    let lateCandidates: Ev[] = [], repairPrompt = '', runId = '', sourceAttempt = '', lateObservation: Ev | undefined;
    const outputDir = path.join(REPORTS, 'terminal-owner'); fs.mkdirSync(outputDir, { recursive: true });
    const restore = observeEvents((file, event) => {
      if (!file.startsWith(s.root) || delivered || event.type !== 'phase_verdict' || event.phase !== 'ut' || event.action !== 'advance') return;
      delivered = true; runId = path.basename(path.dirname(file));
      const history = goalRunEvents(s.root, runId, p.feature);
      assert(!history.some(row => row.type === 'run_end'), 'the independently confirmed finding must arrive at the real chain end before completion');
      assert.equal(history.filter(row => row.type === 'phase_verdict' && row.verdict === 'PASS' && row.action === 'advance').length, request.chain.length);
      const behavior = ledgerBehavior(path.join(s.root, CU_SOURCE));
      assert.notDeepEqual(behavior, { added: 120, restored: 100 }, 'the late verifier must observe a real executable product defect');
      const report = featureFilePath(s.root, p.feature, 'review/review-report.md');
      const observationRel = path.relative(s.root, featureFilePath(s.root, p.feature, 'review/reports/late-review-observation.json')).replace(/\\/g, '/');
      lateObservation = { source_file: CU_SOURCE, source_sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(s.root, CU_SOURCE))).digest('hex'),
        actual: behavior, expected: { added: 120, restored: 100 }, requirement: request.requirement };
      fs.writeFileSync(path.join(s.root, observationRel), JSON.stringify(lateObservation, null, 2));
      const old = fs.readFileSync(report, 'utf8');
      const diagnosis = `add(120)=${behavior.added}; restore([45,55])=${behavior.restored}; expected 120/100; evidence=${observationRel}; balance应累计金额并保持恢复余额`;
      fs.writeFileSync(report, old.replace(/\| R-1 \|[^\n]+/, `| CR-LATE | 逻辑错误 | MAJOR | ${diagnosis} | ${CU_SOURCE} | ${diagnosis} |`)
        .replace('| MAJOR | 0 |', '| MAJOR | 1 |').replace('| MINOR | 1 |', '| MINOR | 0 |').replace('**审查结论**: 通过', '**审查结论**: 不通过'));
      const start = [...history].reverse().find(row => row.type === 'agent_invoke_start' && row.phase === 'review');
      sourceAttempt = String(start?.invoke_id).replace(/^review-/, '');
      reviewGate(s, p.feature, runId, sourceAttempt);
      const reports = featureFilePath(s.root, p.feature, 'review/reports');
      const pending = json(path.join(reports, 'summary.json'));
      assert(pending.verifier_subject_id, 'the actual source gate must issue its subject');
      const issue = parseReviewIssueRows(fs.readFileSync(report, 'utf8')).find(row => row.id === 'CR-LATE');
      assert(issue, 'the independent verifier must read the real current review finding');
      publishFixtureVerifierEvidence({ projectRoot: s.root, reportsDir: reports, feature: p.feature, phase: 'review', subjectId: pending.verifier_subject_id,
        skipSummaryPatch: true, reportText: 'Independent verifier substitute executed the current LedgerFeature, compared frozen acceptance, and confirmed the concrete balance mismatch.\n```issue-verification\n- issue: CR-LATE\n  verdict: confirmed\n  repair_owner: coding\n  evidence: ' + issue.files.join(', ') + ' | ' + issue.summary + '\n```\n' });
      reviewGate(s, p.feature, runId, sourceAttempt);
      const current = json(path.join(reports, 'summary.json'));
      lateCandidates = current.repair_candidates ?? [];
      for (const name of ['summary.json', 'script-report.json', 'late-review-observation.json']) fs.copyFileSync(path.join(reports, name), path.join(outputDir, `late-source.${name}`));
      fs.copyFileSync(report, path.join(outputDir, 'late-source.review-report.md'));
      fs.copyFileSync(path.join(reports, `verifier.report.${current.verifier_subject_id}.md`), path.join(outputDir, 'late-source.verifier.md'));
      assert(current.report_validity === 'PASS' && current.verdict === 'FAIL' && lateCandidates.some(row => row.id === 'CR-LATE'),
        `the actual source gate must retain the confirmed candidate: ${JSON.stringify({ verdict: current.verdict, report_validity: current.report_validity, next_action: current.next_action, candidates: lateCandidates, blockers: current.blockers })}`);
    });
    let probe: Awaited<ReturnType<typeof runGoalRuntimeChain>> | undefined;
    try {
      probe = await runGoalRuntimeChain(s.root, { frameworkRoot: s.frameworkRoot, featureId: p.feature, adapter: 'codex', ...hooks,
        freshRequirement: request.requirement, freshStartPhase: request.chain[0] as 'spec', freshEndPhase: request.chain.at(-1),
        onCoding: ctx => {
          codingCalls++;
          if (!delivered) {
            hooks.onCoding(ctx);
            const file = path.join(s.root, CU_SOURCE);
            fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('this.entries.reduce((a, b) => a + b, 0)', 'this.entries.length'));
            return;
          }
          if (repaired) { publishVerifier(p, 'coding'); return; }
          assert(sourceRevalidatedBeforeRepair, 'the original review must reverify the late finding before the coding repair');
          lateCandidates = json(featureFilePath(s.root, p.feature, 'review/reports/summary.json')).repair_candidates ?? [];
          repairCalls++;
          repairPrompt = ctx.prompt;
          assert(ctx.prompt.includes('Verified repair candidates for this phase') && ctx.prompt.includes('CR-LATE'), 'the actual coding author must receive the production verified candidate');
          const target = /CR-LATE:[^\n]+（涉及：([^）]+)）/.exec(ctx.prompt)?.[1];
          const evidenceRel = /evidence=([^\s|）]+\.json)/.exec(ctx.prompt)?.[1];
          assert(target && evidenceRel, 'the production prompt must carry the actual source target and observed evidence path');
          const observed = json(path.join(s.root, evidenceRel));
          const file = path.join(s.root, target);
          assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), observed.source_sha256);
          assert.deepEqual(ledgerBehavior(file), observed.actual, 'the author must reproduce the actual candidate evidence before changing source');
          const old = fs.readFileSync(file, 'utf8');
          assert(old.includes('return this.entries.length;'), 'the author must diagnose the current balance expression');
          fs.writeFileSync(file, old.replace('return this.entries.length;', 'return this.entries.reduce((a, b) => a + b, 0);'));
          assert.deepEqual(ledgerBehavior(file), observed.expected);
          repaired = true;
        },
        onReview: ctx => {
          reviewCalls++;
          if (delivered) {
            if (!repaired) {
              const actual = ledgerBehavior(path.join(s.root, CU_SOURCE));
              assert.notDeepEqual(actual, { added: 120, restored: 100 }, 'the original source must reproduce the still-open defect before handing it off');
              const file = featureFilePath(s.root, p.feature, 'review/review-report.md');
              fs.appendFileSync(file, '\n## Current implementation recheck\nOriginal reviewer independently re-executed add/restore: ' + JSON.stringify(actual) + '; the product finding stays open.\n');
              reviewGate(s, p.feature, ctx.runId, String(ctx.goalAttemptId));
              const current = json(featureFilePath(s.root, p.feature, 'review/reports/summary.json'));
              const issue = parseReviewIssueRows(fs.readFileSync(file, 'utf8')).find(row => row.id === 'CR-LATE');
              assert(issue && current.verifier_subject_id, 'the reviewer self-check must issue the current verified finding subject');
              const reportsDir = featureFilePath(s.root, p.feature, 'review/reports');
              publishFixtureVerifierEvidence({ projectRoot: s.root, reportsDir, feature: p.feature, phase: 'review', subjectId: current.verifier_subject_id,
                skipSummaryPatch: true, reportText: '```issue-verification\n- issue: CR-LATE\n  verdict: confirmed\n  repair_owner: coding\n  evidence: ' + issue.files.join(', ') + ' | ' + issue.summary + '\n```\n' });
              sourceRevalidations.push({ phase: 'review', attempt_id: ctx.goalAttemptId, verifier_subject_id: current.verifier_subject_id,
                verifier_report: current.verifier_report, actual, model_boundary: 'Independent verifier output over the current real author self-check subject; no synthetic runtime invocation event.' });
              sourceRevalidatedBeforeRepair = true;
              return;
            }
            assert.deepEqual(ledgerBehavior(path.join(s.root, CU_SOURCE)), { added: 120, restored: 100 });
          }
          hooks.onReview(ctx);
        },
        onOutOfChain: ctx => {
          if (ctx.phase === 'review-verifier-format-repair' && delivered && !repaired) {
            const current = parseVerifierRequest(ctx.prompt.slice(ctx.prompt.lastIndexOf('\n{') + 1));
            assert(current && current.phase === 'review' && current.feature === p.feature);
            const issue = parseReviewIssueRows(fs.readFileSync(featureFilePath(s.root, p.feature, 'review/review-report.md'), 'utf8')).find(row => row.id === 'CR-LATE');
            assert(issue, 'the original source verifier must read its current issue');
            assert.notDeepEqual(ledgerBehavior(path.join(s.root, CU_SOURCE)), { added: 120, restored: 100 });
            publishFixtureVerifierEvidence({ projectRoot: s.root, reportsDir: featureFilePath(s.root, p.feature, 'review/reports'), feature: p.feature,
              phase: 'review', subjectId: current.subject_id, skipSummaryPatch: true,
              reportText: '```issue-verification\n- issue: CR-LATE\n  verdict: confirmed\n  repair_owner: coding\n  evidence: ' + issue.files.join(', ') + ' | ' + issue.summary + '\n```\n' });
          } else assert(publishRequestedVerifier(p, ctx), `unexpected model request ${ctx.phase}`);
        },
      });
      runId = path.basename(probe.reportDir);
      assert(delivered && repaired && repairCalls === 1 && reviewCalls >= 2,
        JSON.stringify({ delivered, repaired, codingCalls, repairCalls, reviewCalls, terminal: end(probe.events) }));
      const firstTerminal = probe.events.findIndex(row => row.type === 'phase_verdict' && row.phase === 'ut' && row.action === 'advance');
      const firstRecovery = probe.events.slice(firstTerminal + 1).find(row => row.type === 'phase_backtrack_requested');
      assert(firstRecovery?.reason === 'upstream_gap' && firstRecovery.to_phase === 'review', 'the actual chain end must first return to its original review source');
      assert(sourceRevalidatedBeforeRepair && sourceRevalidations.length, 'a real review self-check and current independent verifier reply must precede the coding repair');
      const reviewed = json(featureFilePath(s.root, p.feature, 'review/reports/summary.json'));
      assert.equal(reviewed.verdict, 'PASS'); assert.equal(reviewed.closure_status, 'closed');
      assert(!reviewed.repair_candidates?.length, 'the original source must reverify and retire its actual finding');
      completed(s, p.feature, runId);
      const publicStatus = goalStatusFeatureLine(s, p.feature);
      assert(publicStatus.startsWith('feature_status=FEATURE_COMPLETED (verify=VALID'), `the public Feature/CU consumer must accept the production completion: ${publicStatus}`);
    } finally {
      restore();
      const reports = featureFilePath(s.root, p.feature, 'review/reports');
      for (const name of ['summary.json', 'script-report.json']) if (fs.existsSync(path.join(reports, name))) fs.copyFileSync(path.join(reports, name), path.join(outputDir, `final-source.${name}`));
      const current = fs.existsSync(path.join(reports, 'summary.json')) ? json(path.join(reports, 'summary.json')) : {};
      for (const [name, relative] of [['verifier.md', current.verifier_report], ['verifier-request.json', current.verifier_request]] as const)
        if (relative && fs.existsSync(path.join(s.root, relative))) fs.copyFileSync(path.join(s.root, relative), path.join(outputDir, `final-source.${name}`));
      const review = featureFilePath(s.root, p.feature, 'review/review-report.md');
      if (fs.existsSync(review)) fs.copyFileSync(review, path.join(outputDir, 'final-source.review-report.md'));
      if (fs.existsSync(path.join(s.root, CU_SOURCE))) {
        fs.copyFileSync(path.join(s.root, CU_SOURCE), path.join(outputDir, 'final-LedgerFeature.ets.snapshot'));
        fs.writeFileSync(path.join(outputDir, 'final-behavior.json'), JSON.stringify(ledgerBehavior(path.join(s.root, CU_SOURCE)), null, 2));
      }
      if (runId) evidence(s, p.feature, runId, 'terminal-owner', { delivered, repaired, coding_calls: codingCalls, repair_calls: repairCalls, review_calls: reviewCalls, late_candidates: lateCandidates,
        source_revalidated_before_repair: sourceRevalidatedBeforeRepair, source_revalidations: sourceRevalidations,
        late_observation: lateObservation, repair_prompt: repairPrompt, external_arrival: 'The test observes the actual final UT PASS append, then supplies a delayed independent review model output. Original review freshness is reverified before coding receives its candidate; the original source verifies again after the actual repair. No event, reader, source check, candidate decision or completion is fabricated.' });
    }
  });
}

export async function runSelectedCases(selector?: string) {
  const results: UnitCaseResult[] = [], timings: UnitExecutionTiming[] = [];
  for (const entry of cases.filter(entry => matchesUnitCase(entry.name, selector))) {
    const finish = startCaseTiming([entry.name], timings);
    try { await entry.run(); results.push({ name: entry.name, ok: true }); }
    catch (error) { results.push({ name: entry.name, ok: false, error: (error as Error).stack }); }
    finally { finish(); clearFrameworkConfigCache(); }
  }
  return selectedUnitCases(results, selector, timings);
}
export const runAll = async () => (await runSelectedCases()).results;
