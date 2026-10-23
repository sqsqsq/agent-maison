import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import * as YAML from 'yaml';
import { clearFrameworkConfigCache, featureFilePath, featurePhaseReportsDir, loadFrameworkConfig } from '../../config';
import { checkFactsArtifact, factsBaselineFingerprint, findPhaseDeltaSection, type FactsInvocationContext } from '../../scripts/utils/context-facts';
import { parseContextExploration } from '../../scripts/utils/context-exploration';
import { loadCompletedFactsBaseline, loadFactsInvocationContext } from '../../scripts/utils/capability-resolution-entry-input';
import { createObservedSourceHashReader, loadPhaseEvidenceManifest, recomputePhaseEvidenceStaleness } from '../../scripts/utils/phase-evidence-manifest';
import { compareExistingTestPreservation } from '../../scripts/utils/repair-responsibility';
import { checkCodingExistingTestPreserved } from '../../scripts/check-coding';
import { collectReviewRepairCandidates, scopeRevisionInputFromRepairCandidates } from '../../scripts/utils/repair-candidates';
import { resolveCapabilityInputs } from '../../scripts/utils/capability-resolution';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { loadResolvedProfile } from '../../profile-loader';
import type { CheckContext } from '../../scripts/utils/types';
import { researchSnapshotFacts } from '../fixtures/host-snapshot-3.1.0/migrate';
import { copyTree } from '../fixtures/host-snapshot-3.1.0/generate';
import { provisionRealChainProject, provisionFrameworkUnder, scaffoldRealChainHost, git, writeHostFile, REAL_CHAIN_REQUIREMENT } from '../utils/real-chain-host';
import { writeSpecMaterials, writePlanMaterials, writeCodingMaterials, writeReviewMaterials, writeUtMaterials, writeTestPlan, publishVerifier, readSummary, dumpPhase } from './real-chain.unit.test';
import { runGateHarness } from './real-chain-seams.unit.test';
import { runGoalRuntimeChain } from './goal-runner-testing-integrity.unit.test';
import { publishFixtureVerifierEvidence } from '../utils/verifier-evidence-fixture';
import { loadAuthoritativeEvents } from '../../scripts/utils/goal-runner-phase';
import { assessFeature } from '../../scripts/utils/feature-assessment';
import { resolveChangeUnitExpectedExecution } from '../../scripts/utils/change-unit-completion';
import { readUpstreamPhaseView } from '../../scripts/utils/upstream-verdict-gate';
import { computeGateFingerprint } from '../../scripts/utils/gate-fingerprint';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, type SelectedUnitCases, type UnitExecutionTiming } from '../utils/unit-case-selection';
import type { UnitCaseResult } from '../run-unit';

const frameworkRoot = path.resolve(__dirname, '../../..');
const historyRoot = path.resolve(__dirname, '../fixtures/host-recovery-history');
const group = '20261022/20261022T103904Z-179a73';
const recorded = path.join(historyRoot, group);
const runId = '20261022T103904Z-179a73';
const feature = 'cu-YmMtb3BlbkNhcmQtMgBvcGVuLWNhcmQtZmxvdw';
const featureDir = 'doc/features/bc-openCard-2/open-card-flow';
const spy = '02-Feature/WalletMain/src/ohosTest/ets/test/spy/SpyBankRepository.ets';
const bankInfo = '02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets';
const sha = (bytes: Buffer | string): string => crypto.createHash('sha256').update(bytes).digest('hex');
const historyEvents = (): any[] => fs.readFileSync(path.join(recorded, 'events.jsonl'), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));

function withRecordedProject(run: (root: string, events: any[], manifest: any) => void): void {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'responsibility-179a73-')));
  try {
    fs.cpSync(path.join(recorded, 'project'), root, { recursive: true });
    // LF fixture copies stay portable; restore exact captured bytes before checking historical hashes.
    const sources = JSON.parse(fs.readFileSync(path.join(historyRoot, 'sources.json'), 'utf8'));
    for (const entry of sources.files) if (entry.raw_file && entry.file.startsWith(`${group}/project/`)) {
      fs.writeFileSync(path.join(root, entry.file.slice(`${group}/project/`.length)), zlib.gunzipSync(fs.readFileSync(path.join(historyRoot, entry.raw_file))));
    }
    const all = historyEvents();
    const end = all.findIndex(event => event.type === 'agent_invoke_start' && event.invoke_id === 'coding-i6');
    assert(end > 0);
    const events = all.slice(0, end);
    // Only invocation-local absolute source locations change. Frozen scope, ownership and verdicts remain original.
    for (const event of events) for (const dep of event.facts_context?.baseline?.dependencies ?? []) {
      dep.path = path.join(root, path.win32.relative('D:\\1.code\\SimulatedWalletForHmos', dep.path).replace(/\\/g, '/'));
    }
    const dir = path.join(root, featureDir, 'goal-runs', runId);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(recorded, 'manifest.json'), path.join(dir, 'manifest.json'));
    fs.writeFileSync(path.join(dir, 'events.jsonl'), events.map(event => JSON.stringify(event)).join('\n') + '\n');
    fs.copyFileSync(path.join(recorded, 'facts.before-i6.md'), path.join(root, featureDir, 'context/facts.md'));
    clearFrameworkConfigCache();
    run(root, events, JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')));
  } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
}

async function replayCR001Runtime(adoptNonCompatibility = false): Promise<void> {
  const project = provisionRealChainProject();
  try {
    const birth = scaffoldRealChainHost(project);
    const adaptedSpy = spy.replace('02-Feature/WalletMain/', `${project.modulePath}/`);
    const before = fs.readFileSync(path.join(recorded, 'SpyBankRepository.before.ets'), 'utf8');
    const after = fs.readFileSync(path.join(recorded, 'project', spy), 'utf8');
    const repaired = adoptNonCompatibility ? "import { expect } from '@ohos/hypium';\n" + after
      + '\nexport function checkFixtureContract(): void { expect(true).assertTrue(); }\n' : after;
    writeHostFile(project.root, adaptedSpy, before);
    for (const source of ['data/model/BankInfo.ets', 'data/model/BankCardType.ets', 'data/repository/BankRepository.ets']) {
      writeHostFile(project.root, `${project.modulePath}/src/main/ets/${source}`, fs.readFileSync(path.join(recorded, `project/02-Feature/WalletMain/src/main/ets/${source}`), 'utf8'));
    }
    writeHostFile(project.root, `${project.modulePath}/src/main/ets/data/model/BankInfo.ets`, fs.readFileSync(path.join(recorded, 'BankInfo.before.ets'), 'utf8'));
    git(project.root, ['add', '-A']); git(project.root, ['commit', '-qm', 'original CR-001 test fixture and required model']);
    const originalRow = fs.readFileSync(path.join(recorded, 'phases/review/harness/review-report.md'), 'utf8').split('\n').find(line => line.startsWith('| CR-001 |'))!;
    const row = originalRow.replace(spy, adaptedSpy);
    const originalVerification = fs.readFileSync(path.join(recorded, 'phases/review/harness/verifier.report.md'), 'utf8');
    const confirmed = originalVerification.slice(originalVerification.indexOf('- issue: CR-001'), originalVerification.indexOf('- issue: CR-002')).trimEnd();
    const baselines: string[] = [];
    let fixed = false;
    let adoptionPreservedBytes = false;
    let returningOwnerGateChecked = false;
    const adoptionViews: unknown[] = [];
    const research = (ctx: { runId: string; goalAttemptId?: string; phase: string }): FactsInvocationContext | undefined => {
      const admitted = loadFactsInvocationContext({ projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature, phase: ctx.phase, runId: ctx.runId, attemptId: ctx.goalAttemptId });
      if (admitted) researchSnapshotFacts(project.root, featureFilePath(project.root, project.feature, 'context/facts.md'), ctx.phase, admitted);
      return admitted;
    };
    const probe = await runGoalRuntimeChain(project.root, {
      frameworkRoot: project.frameworkRoot, featureId: project.feature, realHarness: true, adapter: 'codex',
      freshStartPhase: birth[0] as 'spec', freshEndPhase: birth.at(-1), freshRequirement: REAL_CHAIN_REQUIREMENT,
      onSpec: ctx => { project.runId = ctx.runId; writeSpecMaterials(project); if (ctx.attempt > 1) publishVerifier(project, 'spec'); },
      onPlan: ctx => { project.runId = ctx.runId; writePlanMaterials(project); research(ctx); if (ctx.attempt > 1) publishVerifier(project, 'plan'); },
      onCoding: ctx => {
        project.runId = ctx.runId;
        const entry = loadFactsInvocationContext({ projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature, phase: 'coding', runId: ctx.runId, attemptId: ctx.goalAttemptId });
        if (entry?.baseline) baselines.push(entry.baseline.fingerprint);
        const events = loadAuthoritativeEvents(featureFilePath(project.root, project.feature, `goal-runs/${ctx.runId}/events.jsonl`));
        if (adoptNonCompatibility && events.some(event => event.type === 'phase_verdict' && event.phase === 'ut' && event.verdict === 'PASS' && event.action !== 'advance' && event.action !== 'retry')) {
          const loader = new SpecLoader(project.root, undefined, undefined, project.frameworkRoot);
          const formal: CheckContext = { projectRoot: project.root, frameworkRoot: project.frameworkRoot, frameworkRel: 'framework', harnessRoot: project.harnessDir, phase: 'coding', feature: project.feature,
            phaseRule: loader.loadPhaseRule('coding'), featureSpec: loader.loadFeatureSpec(project.feature), resolvedProfile: loadResolvedProfile(project.root, loadFrameworkConfig(project.root), project.frameworkRoot) };
          const savedRun = process.env.MAISON_GOAL_RUN_ID;
          process.env.MAISON_GOAL_RUN_ID = ctx.runId;
          try { assert(checkCodingExistingTestPreserved(formal).every(check => check.status === 'PASS'), 'a real UT PASS handed back to coding still carries its verified current bytes'); }
          finally { if (savedRun === undefined) delete process.env.MAISON_GOAL_RUN_ID; else process.env.MAISON_GOAL_RUN_ID = savedRun; }
          returningOwnerGateChecked = true;
        }
        const repair = events.some(event => event.type === 'phase_backtrack_requested' && (event as { candidates?: Array<{ id: string }> }).candidates?.some(candidate => candidate.id === 'CR-001'));
        writeCodingMaterials(project);
        writeHostFile(project.root, `${project.modulePath}/src/main/ets/data/model/BankInfo.ets`, fs.readFileSync(path.join(recorded, 'project', bankInfo), 'utf8'));
        if (repair) { writeHostFile(project.root, adaptedSpy, repaired); fixed = true; }
        const currentFacts = featureFilePath(project.root, project.feature, 'context/facts.md');
        if (entry) researchSnapshotFacts(project.root, currentFacts, 'coding', entry);
        fs.appendFileSync(currentFacts, `\n## phase_delta: coding\n| 路径 | 事实 | 影响 |\n|---|---|---|\n| ${project.modulePath}/src/main/ets/data/model/BankInfo.ets | 原接口新增必填 supportedCardTypes | 旧 typed fixture 必须兼容 |\n`);
        if (ctx.attempt > 1) publishVerifier(project, 'coding');
      },
      onReview: ctx => {
        project.runId = ctx.runId; writeReviewMaterials(project);
        const admitted = research(ctx);
        const file = featureFilePath(project.root, project.feature, 'review/review-report.md');
        if (admitted) fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('## 2. 审查维度', admitted.source_paths.map(source => `- ${source}`).join('\n') + '\n\n## 2. 审查维度'));
        if (!fixed) {
          const report = fs.readFileSync(file, 'utf8').replace('| 编号 | 分类 | 严重程度 |', '| 编号 | 严重程度 | 分类 |')
            .replace(/^\| R-1 \|.*$/m, row).replace('| BLOCKER | 0 |', '| BLOCKER | 1 |').replace('| MINOR | 1 |', '| MINOR | 0 |').replace('**审查结论**: 通过', '**审查结论**: 不通过');
          fs.writeFileSync(file, report);
          runGateHarness(project, 'review', undefined, ctx.goalAttemptId ?? '', { HARNESS_HDC_TARGET: 'fake-device', MAISON_DEVICE_TARGET_KIND: 'physical' }, 'agent');
          const subject = readSummary(project, 'review')?.verifier_subject_id;
          assert(subject, dumpPhase(project, 'review'));
          publishFixtureVerifierEvidence({ projectRoot: project.root, reportsDir: featurePhaseReportsDir(project.root, project.feature, 'review', project.frameworkRoot),
            feature: project.feature, phase: 'review', subjectId: subject, skipSummaryPatch: true,
            reportText: `\`\`\`issue-verification\n${confirmed}\n\`\`\`` });
        } else {
          assert.equal(fs.readFileSync(path.join(project.root, adaptedSpy), 'utf8'), repaired);
          if (ctx.attempt > 1) publishVerifier(project, 'review');
        }
      },
      onUt: ctx => {
        project.runId = ctx.runId; assert(fixed, 'UT cannot close the original missing fixture field');
        const upstream = () => readUpstreamPhaseView(project.root, project.feature, 'coding', 'ut', ctx.runId, project.frameworkRoot);
        const viewBefore = adoptNonCompatibility ? upstream() : undefined;
        const beforeUt = fs.readFileSync(path.join(project.root, adaptedSpy));
        writeUtMaterials(project);
        research(ctx);
        adoptionPreservedBytes = beforeUt.equals(fs.readFileSync(path.join(project.root, adaptedSpy)));
        if (adoptNonCompatibility) {
          const summary = JSON.parse(fs.readFileSync(featureFilePath(project.root, project.feature, 'coding/reports/summary.json'), 'utf8'));
          const script = JSON.parse(fs.readFileSync(featureFilePath(project.root, project.feature, 'coding/reports/script-report.json'), 'utf8'));
          const revision = scopeRevisionInputFromRepairCandidates(summary.repair_candidates ?? [], { projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature, runId: ctx.runId });
          adoptionViews.push({ attempt: ctx.goalAttemptId, frameworkRoot: project.frameworkRoot, viewBefore, viewAfter: upstream(), blocker_count: summary.blocker_count, blockers: summary.blockers,
            candidates: summary.repair_candidates, scope_revision_input: script.checks.flatMap((check: { scope_revision_input?: unknown }) => check.scope_revision_input ? [check.scope_revision_input] : []), revisionNow: revision });
          fs.writeFileSync(path.join(frameworkRoot, 'harness/reports/c2f7a91e/ut-adoption-state.json'), JSON.stringify(adoptionViews, null, 2) + '\n');
        }
        if (ctx.attempt > 1) publishVerifier(project, 'ut');
      },
      onTesting: ctx => { project.runId = ctx.runId; writeTestPlan(project); research(ctx); if (ctx.attempt > 1) publishVerifier(project, 'testing'); },
    });
    const failure = ['coding', 'review', 'ut', 'testing'].map(phase => dumpPhase(project, phase)).join('\n');
    if (adoptNonCompatibility) {
      const reports = path.resolve(frameworkRoot, 'harness/reports/c2f7a91e');
      fs.writeFileSync(path.join(reports, 'ut-adoption-state.json'), JSON.stringify(adoptionViews, null, 2) + '\n');
      const snapshot = path.join(reports, 'ut-adoption-project');
      assert.equal(path.dirname(snapshot), reports);
      fs.rmSync(snapshot, { recursive: true, force: true });
      copyTree(project.root, snapshot, true);
      fs.cpSync(path.join(project.root, '.git'), path.join(snapshot, '.git'), { recursive: true });
    }
    assert.equal(probe.exitCode, 0, `${failure}\n${JSON.stringify(probe.events.slice(-8))}`);
    const reviewFail = probe.events.findIndex(event => event.type === 'phase_verdict' && event.phase === 'review' && event.verdict === 'FAIL');
    const reentry = probe.events.findIndex((event, index) => index > reviewFail && event.type === 'agent_invoke_start' && event.phase === 'coding');
    assert(reviewFail >= 0 && reentry > reviewFail, 'verified original CR-001 must cause an actual coding reentry');
    assert(baselines.length >= 2 && baselines.every(value => value === baselines[0]), 'repair retains original establishing facts baseline');
    for (const phase of ['coding', 'review', 'ut', 'testing']) {
      assert(probe.events.some((event, index) => index > reentry && event.type === 'phase_verdict' && event.phase === phase && event.verdict === 'PASS'), phase);
      assert.equal(readSummary(project, phase)?.closure_status, 'closed', phase);
    }
    for (const phase of ['spec', 'plan', 'coding', 'review', 'ut', 'testing']) {
      assert.equal(loadPhaseEvidenceManifest(project.root, project.feature, phase)?.manifest.environment.profile, 'test-chain', `${phase}: native operations must stay on the isolated transport profile`);
    }
    const assessment = assessFeature(project.root, project.feature, { ...resolveChangeUnitExpectedExecution(project.root, project.feature, false, project.frameworkRoot), frameworkRoot: project.frameworkRoot });
    assert(assessment.complete, JSON.stringify(assessment.obligations.filter(obligation => obligation.status === 'uncovered')));
    const codingReport = JSON.parse(fs.readFileSync(featureFilePath(project.root, project.feature, 'coding/reports/script-report.json'), 'utf8'));
    assert(codingReport.checks.some((check: { id: string; status: string }) => check.id === 'coding_existing_test_preserved' && check.status === 'PASS'), 'production preservation check must approve the real two-line repair');
    if (adoptNonCompatibility) {
      assert(returningOwnerGateChecked, 'the real owner return must exercise the formal coding gate directly');
      assert(adoptionPreservedBytes, 'UT must actually validate and adopt these bytes without rewriting the original error');
      const firstUt = probe.events.findIndex(event => event.type === 'phase_verdict' && event.phase === 'ut' && event.verdict === 'PASS');
      assert(probe.events.some((event, index) => index > reentry && index < firstUt && event.type === 'phase_verdict' && event.phase === 'coding' && event.verdict === 'FAIL'), 'unadopted assertion changes must fail first');
      const loader = new SpecLoader(project.root, undefined, undefined, project.frameworkRoot);
      const ctx: CheckContext = { projectRoot: project.root, frameworkRoot: project.frameworkRoot, frameworkRel: 'framework', harnessRoot: project.harnessDir, phase: 'coding', feature: project.feature,
        phaseRule: loader.loadPhaseRule('coding'), featureSpec: loader.loadFeatureSpec(project.feature), resolvedProfile: loadResolvedProfile(project.root, loadFrameworkConfig(project.root), project.frameworkRoot) };
      const savedRun = process.env.MAISON_GOAL_RUN_ID;
      process.env.MAISON_GOAL_RUN_ID = project.runId;
      try {
        const manifestFile = featureFilePath(project.root, project.feature, 'ut/reports/phase-evidence-manifest.json');
        const ownerManifest = fs.readFileSync(manifestFile);
        fs.unlinkSync(manifestFile);
        assert(checkCodingExistingTestPreserved(ctx).some(check => check.status === 'FAIL'), 'without actual owner adoption the same bytes remain blocked');
        fs.writeFileSync(manifestFile, ownerManifest);
        assert(checkCodingExistingTestPreserved(ctx).every(check => check.status === 'PASS'), 'the actual owner closure carries unchanged bytes');
        fs.appendFileSync(path.join(project.root, adaptedSpy), '\nexport function laterUnauthorizedAssertion(): void { expect(false).assertTrue(); }\n');
        assert(checkCodingExistingTestPreserved(ctx).some(check => check.status === 'FAIL'), 'later coding mutation invalidates the adopted hash');
      } finally { if (savedRun === undefined) delete process.env.MAISON_GOAL_RUN_ID; else process.env.MAISON_GOAL_RUN_ID = savedRun; }
    }
  } finally { clearFrameworkConfigCache(); fs.rmSync(project.root, { recursive: true, force: true }); }
}

const cases: Array<{ name: string; run(): void | Promise<void> }> = [
  { name: '179a73 immutable history retains review FAIL, i5 UT-write contradiction, i6 baseline loss and terminal failure', run() {
    const sources = JSON.parse(fs.readFileSync(path.join(historyRoot, 'sources.json'), 'utf8'));
    for (const entry of sources.files.filter((item: { file: string }) => item.file.startsWith(`${group}/`))) {
      assert.equal(sha(fs.readFileSync(path.join(historyRoot, entry.file))), entry.sha256, entry.file);
      if (entry.raw_file) assert.equal(sha(zlib.gunzipSync(fs.readFileSync(path.join(historyRoot, entry.raw_file)))), entry.original_sha256, entry.raw_file);
    }
    const events = historyEvents();
    assert.deepStrictEqual(events.filter(event => event.type === 'phase_verdict').map(event => [event.invoke_id, event.verdict]), [
      ['spec-i1', 'PASS'], ['plan-i2', 'PASS'], ['coding-i3', 'PASS'], ['review-i4', 'FAIL'], ['coding-i5', 'FAIL'], ['coding-i6', 'FAIL'], ['coding-i7', 'FAIL'],
    ]);
    const i5 = events.find(event => event.type === 'agent_invoke_start' && event.invoke_id === 'coding-i5');
    const baseline = fs.readFileSync(path.join(recorded, 'facts.spec-original.md'), 'utf8');
    const beforeI6 = fs.readFileSync(path.join(recorded, 'facts.before-i6.md'), 'utf8');
    assert.equal(factsBaselineFingerprint(baseline), i5.facts_context.baseline.fingerprint);
    assert.equal(factsBaselineFingerprint(beforeI6), i5.facts_context.baseline.fingerprint);
    assert(beforeI6.includes('CR-001 返修前已核对'));
    assert(!beforeI6.includes('2026-10-22 本次重试实际重新读取'));
    for (const attempt of ['coding-i6', 'coding-i7']) assert.equal(events.find(event => event.type === 'agent_invoke_start' && event.invoke_id === attempt).facts_context.baseline, undefined);
    const observed = events.find(event => event.type === 'phase_write_observed' && event.invoke_id === 'coding-i5');
    assert.equal((observed.owned ?? []).length, 0);
    assert.equal(observed.observations[0].owner, 'ut');
    assert.equal(observed.observations[0].disposition, 'deferred_to_checker');
    assert.equal(sha(fs.readFileSync(path.join(recorded, 'SpyBankRepository.before.ets'))), observed.observations[0].pre_sha256);
    assert.equal(sha(fs.readFileSync(path.join(recorded, 'project', spy))), observed.observations[0].post_sha256);
    const modelChange = events.find(event => event.type === 'phase_write_observed' && event.invoke_id === 'coding-i3').owned.find((entry: { path: string }) => entry.path === bankInfo);
    assert.equal(sha(fs.readFileSync(path.join(recorded, 'BankInfo.before.ets'))), modelChange.pre_sha256);
    assert.equal(events.find(event => event.type === 'run_end').halt_reason, 'content_retry_exhausted');
    const review = fs.readFileSync(path.join(recorded, 'phases/review/harness/review-report.md'), 'utf8');
    const verification = fs.readFileSync(path.join(recorded, 'phases/review/harness/verifier.report.md'), 'utf8');
    assert(review.includes('| CR-002 | MAJOR | 视觉保真 |'));
    assert(verification.includes('- issue: CR-002\n  verdict: confirmed'));
  } },
  { name: '179a73 real two-line fixture repair preserves old tests; changed assertions, skips and unknown originals cannot acquire coding permission', run() {
    const before = fs.readFileSync(path.join(recorded, 'SpyBankRepository.before.ets'), 'utf8');
    const after = fs.readFileSync(path.join(recorded, 'project', spy), 'utf8');
    assert.equal(compareExistingTestPreservation(before, after).preserved, true);
    const test = "describe('old', () => { it('keeps assertion', 0, () => { expect(value).assertEqual(1); }); });\n";
    for (const changed of [test.replace('assertEqual(1)', 'assertEqual(2)'), test.replace("it('keeps", "it.skip('keeps"), test + "it('new', 0, () => {});\n"]) {
      assert.equal(compareExistingTestPreservation(test, changed).preserved, false);
    }
    assert.equal(compareExistingTestPreservation(undefined, after).preserved, false);
  } },
  { name: 'snapshot research registers each actual stage delta, merges same-stage tables, and preserves the original baseline', run: () => withRecordedProject(root => {
    const file = featureFilePath(root, feature, 'context/facts.md');
    const original = fs.readFileSync(path.join(recorded, 'facts.spec-original.md'), 'utf8');
    const admission = historyEvents().find(event => event.type === 'agent_invoke_start' && event.invoke_id === 'coding-i5').facts_context as FactsInvocationContext;
    const context = structuredClone(admission);
    for (const dep of context.baseline!.dependencies) dep.path = path.join(root, path.win32.relative('D:\\1.code\\SimulatedWalletForHmos', dep.path).replace(/\\/g, '/'));
    context.source_paths = [spy];
    for (const phase of ['spec', 'plan', 'coding', 'review', 'ut', 'testing']) {
      const other = phase === 'ut' ? 'coding' : 'ut';
      const initial = original + `\n## phase_delta: ${other}\n| 路径 | 事实 | 影响 |\n|---|---|---|\n| ${spy} | old stage read | old |\n`;
      fs.writeFileSync(file, initial);
      const checks = () => checkFactsArtifact(root, feature, phase, { frameworkRoot, profileName: 'generic', factsContext: context });
      assert(checks().some(check => check.id === 'context_exploration_facts_scope_coverage' && check.status === 'FAIL'), `${phase}: other stage does not cover current target`);
      researchSnapshotFacts(root, file, phase, context);
      const updated = fs.readFileSync(file, 'utf8');
      assert.equal(factsBaselineFingerprint(updated), context.baseline!.fingerprint);
      assert(findPhaseDeltaSection(parseContextExploration(updated).body, phase, true).content.includes(`| ${spy} |`));
      assert(!checks().some(check => check.id === 'context_exploration_facts_scope_coverage' && check.status === 'FAIL'), `${phase}: production coverage accepts this stage's row`);
      researchSnapshotFacts(root, file, phase, context);
      assert.equal(fs.readFileSync(file, 'utf8'), updated, 'repeat call consumes merged same-stage sections');
    }
    fs.writeFileSync(file, original);
    context.source_paths = [];
    researchSnapshotFacts(root, file, 'testing', context);
    assert.equal(findPhaseDeltaSection(parseContextExploration(fs.readFileSync(file, 'utf8')).body, 'testing', true).content, 'none');
  }) },
  { name: '179a73 before i6 keeps observed coding source hashes and the original spec admission through the production baseline loader', run: () => withRecordedProject((root, events) => {
    const original = events.find(event => event.type === 'agent_invoke_start' && event.invoke_id === 'coding-i5').facts_context;
    assert.equal(original.baseline.dependencies.length, 22);
    for (const dependency of original.baseline.dependencies) assert.equal(sha(fs.readFileSync(dependency.path)), dependency.sha256, dependency.path);
    const evidence = loadPhaseEvidenceManifest(root, feature, 'spec');
    assert(evidence?.integrityOk, JSON.stringify(evidence));
    const copiedManifestPath = path.join(root, featureDir, 'spec/reports/phase-evidence-manifest.json');
    const manifestBefore = fs.readFileSync(copiedManifestPath);
    const reader = createObservedSourceHashReader(root, feature, { frameworkRoot, runId });
    const sourceEntries = evidence.manifest.inputs.filter(entry => entry.owner_phase === 'coding' && entry.exists);
    assert(sourceEntries.some(entry => reader(entry, 'spec')), 'production reader must recognize original coding-i3 writes even while coding is failing');
    const currentRules = fs.readFileSync(path.join(frameworkRoot, 'specs/phase-rules/spec-rules.yaml'));
    const recordedRules = fs.readFileSync(path.join(recorded, 'spec-rules.original.yaml'));
    assert.deepStrictEqual(YAML.parse(recordedRules.toString('utf8')), YAML.parse(currentRules.toString('utf8')), 'historical environment adaptation is limited to the recorded comment-only rule change');
    if (computeGateFingerprint(frameworkRoot, 'spec') !== evidence.manifest.environment.gate_fingerprint) {
      assert.equal(loadCompletedFactsBaseline({ projectRoot: root, frameworkRoot, feature, featuresDir: 'doc/features', phase: 'coding', goalRunId: runId, goalAttemptId: 'i6' }, runId, frameworkRoot), undefined);
      assert(recomputePhaseEvidenceStaleness(root, feature, ['spec'], { frameworkRoot, runId })[0].changed_paths.includes('<environment:gate_fingerprint>'), 'current environment must still reject the original old gate');
    }
    const replayFramework = provisionFrameworkUnder(root).frameworkRoot;
    const specs = path.join(replayFramework, 'specs');
    assert(fs.lstatSync(specs).isSymbolicLink());
    fs.unlinkSync(specs);
    fs.cpSync(path.join(frameworkRoot, 'specs'), specs, { recursive: true });
    const ruleFile = path.join(specs, 'phase-rules/spec-rules.yaml');
    fs.writeFileSync(ruleFile, recordedRules);
    assert.equal(computeGateFingerprint(replayFramework, 'spec'), evidence.manifest.environment.gate_fingerprint, 'copy the historical environment, never forge an evidence fingerprint');
    const load = () => loadCompletedFactsBaseline({ projectRoot: root, frameworkRoot: replayFramework, feature, featuresDir: 'doc/features', phase: 'coding', goalRunId: runId, goalAttemptId: 'i6' }, runId, replayFramework);
    const restored = load();
    assert(restored?.baseline, JSON.stringify(recomputePhaseEvidenceStaleness(root, feature, ['spec'], { frameworkRoot: replayFramework, runId })));
    assert.equal(restored.baseline.established_by, 'spec');
    assert.equal(restored.baseline.fingerprint, original.baseline.fingerprint);
    assert.equal(assessFeature(root, feature, { ...resolveChangeUnitExpectedExecution(root, feature, false, replayFramework), frameworkRoot: replayFramework }).complete, false, 'restoring facts does not close original review FAIL or independent CR-002');
    const facts = path.join(root, featureDir, 'context/facts.md');
    fs.appendFileSync(facts, '\n## phase_delta: ut\nnone\n');
    assert.equal(load()?.baseline?.fingerprint, original.baseline.fingerprint, 'later append-only reports do not erase the establishing identity');
    const sourceFile = path.join(root, original.source_paths[0]);
    const sourceBefore = fs.readFileSync(sourceFile);
    fs.appendFileSync(sourceFile, '\n// unknown external change\n');
    assert.equal(computeGateFingerprint(replayFramework, 'spec'), evidence.manifest.environment.gate_fingerprint);
    assert.equal(load(), undefined, 'unknown source mutation is not inherited');
    const sourceFailure = recomputePhaseEvidenceStaleness(root, feature, ['spec'], { frameworkRoot: replayFramework, runId })[0];
    assert(sourceFailure.changed_paths.includes(original.source_paths[0]) && !sourceFailure.changed_paths.some(file => file.startsWith('<environment:')), 'source negative must reach the business-input check, not fail at an environment gate');
    fs.writeFileSync(sourceFile, sourceBefore);
    const factsBefore = fs.readFileSync(facts, 'utf8');
    const alteredFacts = factsBefore.replace('ready_to_produce: true', 'ready_to_produce: false');
    assert.notEqual(alteredFacts, factsBefore);
    fs.writeFileSync(facts, alteredFacts);
    assert.equal(load(), undefined, 'changing the original baseline cannot be hidden by matching environment');
    fs.writeFileSync(facts, factsBefore);
    const alteredRules = YAML.parse(recordedRules.toString('utf8'));
    assert(Number.isFinite(alteredRules.exploration_thresholds.min_files_inspected));
    alteredRules.exploration_thresholds.min_files_inspected++;
    fs.writeFileSync(ruleFile, YAML.stringify(alteredRules));
    assert.equal(load(), undefined, 'a real rule change remains stale');
    assert(recomputePhaseEvidenceStaleness(root, feature, ['spec'], { frameworkRoot: replayFramework, runId })[0].changed_paths.includes('<environment:gate_fingerprint>'));
    assert(fs.readFileSync(copiedManifestPath).equals(manifestBefore), 'the copied historical manifest is never rewritten');
  }) },
  { name: '179a73 verified CR-001 and formal coding gate agree on finite compatibility; real assertion work remains verification', run: () => withRecordedProject((root, _events, manifest) => {
    const savedRun = process.env.MAISON_GOAL_RUN_ID;
    const savedDiff = process.env.HARNESS_DIFF_BASE_REF;
    try {
      delete process.env.MAISON_GOAL_RUN_ID;
      process.env.HARNESS_DIFF_BASE_REF = 'working';
      fs.copyFileSync(path.join(recorded, 'SpyBankRepository.before.ets'), path.join(root, spy));
      fs.copyFileSync(path.join(recorded, 'BankInfo.before.ets'), path.join(root, bankInfo));
      git(root, ['init', '-q']); git(root, ['add', '-A']); git(root, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'captured fixture before finite repair']);
      fs.copyFileSync(path.join(recorded, 'project', spy), path.join(root, spy));
      fs.copyFileSync(path.join(recorded, 'project', bankInfo), path.join(root, bankInfo));
      const loader = new SpecLoader(root, undefined, undefined, frameworkRoot);
      const ctx: CheckContext = { projectRoot: root, frameworkRoot, frameworkRel: 'framework', harnessRoot: path.join(frameworkRoot, 'harness'), feature, phase: 'coding',
        phaseRule: loader.loadPhaseRule('coding'), featureSpec: loader.loadFeatureSpec(feature), resolvedProfile: loadResolvedProfile(root, loadFrameworkConfig(root), frameworkRoot) };
      const checks = checkCodingExistingTestPreserved(ctx);
      assert(checks.some(check => check.id === 'coding_existing_test_preserved' && check.status === 'PASS' && check.details?.includes(spy)), JSON.stringify(checks));
      const report = fs.readFileSync(path.join(recorded, 'phases/review/harness/review-report.md'), 'utf8');
      const verifier = fs.readFileSync(path.join(recorded, 'phases/review/harness/verifier.report.md'), 'utf8');
      const responsibility = { projectRoot: root, frameworkRoot, feature, executionScope: manifest.execution_scope };
      const candidates = collectReviewRepairCandidates({ responsibility, reportText: report, verifierReportText: verifier, reportValidityBlocked: false });
      assert(candidates.some(candidate => candidate.id === 'CR-001' && candidate.category === 'coding' && candidate.files.includes(spy)), JSON.stringify(candidates));
      const pathOwnerVerifier = verifier.replace(/(- issue: CR-001\r?\n\s+verdict: confirmed)/, '$1\n  repair_owner: ut');
      assert.notEqual(pathOwnerVerifier, verifier, '反例必须确实给当前已核实CR001填入原测试产物owner');
      const pathOwnerCandidates = collectReviewRepairCandidates({ responsibility, reportText: report, verifierReportText: pathOwnerVerifier, reportValidityBlocked: false });
      assert(pathOwnerCandidates.some(candidate => candidate.id === 'CR-001' && candidate.category === 'coding' && candidate.files.includes(spy)), '已核验原测试owner不应抹掉共享resolver确认的合法兼容修改者：' + JSON.stringify(pathOwnerCandidates));
      const reviewOnly = { ...manifest.execution_scope!, completion_target: 'request' as const, requested_results: ['review'], phase_chain: ['review'], reused_phases: [], obligations: [], unresolved: [] };
      assert(!collectReviewRepairCandidates({ responsibility: { ...responsibility, executionScope: reviewOnly }, reportText: report, verifierReportText: pathOwnerVerifier, reportValidityBlocked: false })
        .some(candidate => candidate.id === 'CR-001'), '产物owner与验证签发者一致不能为review-only授coding修改权');
      fs.appendFileSync(path.join(root, spy), "\nexport function extraAssertion(): void { expect(true).assertTrue(); }\n");
      assert(checkCodingExistingTestPreserved(ctx).some(check => check.id === 'coding_existing_test_preserved' && check.status === 'FAIL' && check.repair_owner === 'ut'));
      const changedAssertion = collectReviewRepairCandidates({ responsibility, reportText: report, verifierReportText: pathOwnerVerifier, reportValidityBlocked: false });
      assert(changedAssertion.some(candidate => candidate.id === 'CR-001' && candidate.category === 'verification')
        && !changedAssertion.some(candidate => candidate.id === 'CR-001' && candidate.category === 'coding'), '改断言后不能沿角色一致性取得有限兼容许可');
      const repair = 'UT 责任：增加旧替身的边界用例并补断言';
      const testReport = `# Review\n\n## 问题清单\n| 编号 | 严重程度 | 分类 | 问题描述 | 涉及文件 | 修复建议 |\n|---|---|---|---|---|---|\n| CR-UT | MAJOR | 测试缺口 | 缺少边界断言 | ${spy} | ${repair} |\n\n## 结论\n审查结论：不通过\n`;
      const testVerifier = `\`\`\`issue-verification\n- issue: CR-UT\n  verdict: confirmed\n  evidence: SpyBankRepository.ets | ${repair}\n\`\`\``;
      const testCandidates = collectReviewRepairCandidates({ responsibility, reportText: testReport, verifierReportText: testVerifier, reportValidityBlocked: false });
      assert(testCandidates.some(candidate => candidate.id === 'CR-UT' && candidate.category === 'verification'), JSON.stringify(testCandidates));
      assert(!testCandidates.some(candidate => candidate.category === 'coding'));
      const revision = scopeRevisionInputFromRepairCandidates(testCandidates, { projectRoot: root, frameworkRoot, feature, runId });
      const inputDiagnostics = resolveCapabilityInputs({ projectRoot: root, frameworkRoot, feature, phase: 'ut', track: 'full', testTargets: [spy],
        inputContext: { schema_version: '1.1', subject: { feature }, obligations: {}, required_outputs: [] } }).inputs?.values;
      fs.writeFileSync(path.join(frameworkRoot, 'harness/reports/c2f7a91e/verification-scope-target.json'), JSON.stringify({ revision,
        inputs: Object.fromEntries(Object.entries(inputDiagnostics ?? {}).map(([id, value]) => [id, value.state === 'resolved' ? { state: value.state, binding: value.binding } : value])),
      }, null, 2) + '\n');
      assert(revision, 'verified test work must produce the real scope-revision binding');
      assert(revision.candidateIds.includes('CR-UT'));
      const testFact = revision.input.facts.find(fact => fact.id === 'unit-evidence:CR-UT');
      assert(testFact?.basis.some(binding => binding.source.kind === 'derive' && binding.source.provider_id === 'derive.test-targets'), 'UT repair targets must remain test-target inputs rather than becoming production code inputs');
      const variant = provisionFrameworkUnder(root);
      const skills = path.join(variant.frameworkRoot, 'skills');
      assert(fs.lstatSync(skills).isSymbolicLink());
      fs.unlinkSync(skills);
      fs.cpSync(path.join(frameworkRoot, 'skills'), skills, { recursive: true });
      const contractFile = path.join(skills, 'feature/business-ut/contract.yaml');
      const contract = YAML.parse(fs.readFileSync(contractFile, 'utf8'));
      contract.phases.ut.inputs.reverse();
      fs.writeFileSync(contractFile, YAML.stringify(contract));
      const reordered = scopeRevisionInputFromRepairCandidates(testCandidates, { projectRoot: root, frameworkRoot: variant.frameworkRoot, feature, runId });
      assert(reordered?.input.facts.find(fact => fact.id === 'unit-evidence:CR-UT')?.basis.some(binding => binding.source.kind === 'derive' && binding.source.provider_id === 'derive.test-targets'), 'declared input order must not turn a UT repair into a production code binding');
    } finally {
      if (savedRun === undefined) delete process.env.MAISON_GOAL_RUN_ID; else process.env.MAISON_GOAL_RUN_ID = savedRun;
      if (savedDiff === undefined) delete process.env.HARNESS_DIFF_BASE_REF; else process.env.HARNESS_DIFF_BASE_REF = savedDiff;
    }
  }) },
  { name: '179a73 CR-001 adapted real runner repairs original fixture bytes, carries facts through reentry, rechecks review/UT and completes its isolated scope', run: () => replayCR001Runtime() },
  { name: 'real UT validates misassigned assertion bytes without rewriting them; absent adoption and later unauthorized changes remain blocked', run: () => replayCR001Runtime(true) },
];

export async function runSelectedCases(selector?: string): Promise<SelectedUnitCases> {
  const results: UnitCaseResult[] = []; const timings: UnitExecutionTiming[] = [];
  for (const test of cases.filter(item => matchesUnitCase(item.name, selector))) {
    const stop = startCaseTiming([test.name], timings);
    try { await test.run(); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: (error as Error).stack }); }
    finally { stop(); }
  }
  return selectedUnitCases(results, selector, timings);
}

export async function runAll(): Promise<UnitCaseResult[]> { return (await runSelectedCases()).results; }
