import { unitCaseGroups } from '../utils/unit-case-selection';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import * as YAML from 'yaml';
import { clearFrameworkConfigCache, featureFilePath, featurePhaseReportsDir, loadFrameworkConfig } from '../../config';
import { checkFactsArtifact, factsBaselineFingerprint, factsPhaseFingerprint, findPhaseDeltaSection, type FactsInvocationContext } from '../../scripts/utils/context-facts';
import { loadGoalManifestFromRun } from '../../scripts/utils/goal-manifest';
import { resolveCapabilityInputs } from '../../scripts/utils/capability-resolution';
import { parseContextExploration } from '../../scripts/utils/context-exploration';
import { loadCompletedFactsBaseline, loadFactsInvocationContext, resolveCapabilityResolutionEntryInput } from '../../scripts/utils/capability-resolution-entry-input';
import { loadPhaseEvidenceManifest, recomputePhaseEvidenceStaleness } from '../../scripts/utils/phase-evidence-manifest';
import { compareExistingTestPreservation, codingTestPreservation, repairResponsibilityContext, workUnitMayWritePath } from '../../scripts/utils/repair-responsibility';
import { checkCodingExistingTestPreserved } from '../../scripts/check-coding';
import { collectReviewRepairCandidates, scopeRevisionInputFromRepairCandidates, testStrengthVerification } from '../../scripts/utils/repair-candidates';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { loadResolvedProfile } from '../../profile-loader';
import type { CheckContext } from '../../scripts/utils/types';
import { researchSnapshotFacts } from '../fixtures/host-snapshot-3.1.0/migrate';
import { copyTree } from '../fixtures/host-snapshot-3.1.0/generate';
import { provisionRealChainProject, provisionFrameworkUnder, scaffoldRealChainHost, git, writeHostFile, REAL_CHAIN_REQUIREMENT } from '../utils/real-chain-host';
import { writeSpecMaterials, writePlanMaterials, writeCodingMaterials, writeReviewMaterials, writeUtMaterials, writeTestPlan, publishRequestedVerifier, readDeliveredVerifierRequest, readSummary, dumpPhase } from './real-chain.unit.test';
import { readVerifierMaterialOrNull, computeMaterialSha256, verifierMaterialFileMatchesCurrent } from '../../scripts/utils/verifier-material';
import { loadVerifierEvidenceForSubject, verifierReportMdPath } from '../../scripts/utils/verifier-evidence';
import { runGoalRuntimeChain } from './goal-runner-testing-integrity.unit.test';
import { publishFixtureVerifierEvidence } from '../utils/verifier-evidence-fixture';
import { loadAuthoritativeEvents } from '../../scripts/utils/goal-runner-phase';
import { assessFeature } from '../../scripts/utils/feature-assessment';
import { resolveChangeUnitExpectedExecution } from '../../scripts/utils/change-unit-completion';
import { phaseCompletionProblems } from '../../scripts/utils/check-disposition';
import { parseVerifierRequest } from '../../scripts/utils/verifier-request';
import { computeGateFingerprint } from '../../scripts/utils/gate-fingerprint';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, type SelectedUnitCases, type UnitExecutionTiming } from '../utils/unit-case-selection';
import type { UnitCaseResult } from '../run-unit';

const frameworkRoot = path.resolve(__dirname, '../../..');
// The worker replaces TMP/TEMP and deletes that whole tree; retained originals use the system Temp.
const evidenceTemp = process.platform === 'win32' && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Temp') : os.tmpdir();
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

async function replayCR001Runtime(): Promise<void> {
  const project = provisionRealChainProject();
  const reportsRoot = path.join(frameworkRoot, 'harness/reports/72b6f0d9/p3');
  fs.mkdirSync(reportsRoot, { recursive: true });
  const diagnostics = fs.mkdtempSync(path.join(reportsRoot, 'c-cr001-'));
  try {
    const birth = scaffoldRealChainHost(project);
    const adaptedSpy = spy.replace('02-Feature/WalletMain/', `${project.modulePath}/`);
    const before = fs.readFileSync(path.join(recorded, 'SpyBankRepository.before.ets'), 'utf8');
    const after = fs.readFileSync(path.join(recorded, 'project', spy), 'utf8');
    const repaired = "import { expect } from '@ohos/hypium';\n" + after
      + '\nexport function checkFixtureContract(): void { expect(true).assertTrue(); }\n';
    assert(repaired.includes(after), '原历史两行兼容修复字节完整保留，新增断言仍需当前独核');
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
    let fixed = false;
    let originalConfirmed = false;
    const repairAttempts: string[] = [];
    let adoptionPreservedBytes = false;
    let verifiedStrengthFailure = false;
    const admission = (ctx: { runId: string; goalAttemptId?: string; phase: string }): FactsInvocationContext | undefined =>
      resolveCapabilityResolutionEntryInput({ projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature,
        featuresDir: loadFrameworkConfig(project.root).paths.features_dir, phase: ctx.phase, goalRunId: ctx.runId, goalAttemptId: ctx.goalAttemptId }).factsContext;
    const authorMaterials = (ctx: { runId: string; goalAttemptId?: string; phase: string }, write: () => void, admitted = admission(ctx)): FactsInvocationContext | undefined => {
      const facts = featureFilePath(project.root, project.feature, 'context/facts.md');
      const prior = fs.existsSync(facts) ? fs.readFileSync(facts) : undefined;
      const header = prior ? parseContextExploration(prior.toString('utf8')).fm : undefined;
      const sameResearch = header && 'run_id' in header && header.run_id === ctx.runId
        && 'established_by' in header && header.established_by === admitted?.first_phase;
      const baseline = prior && (admitted?.baseline || sameResearch) ? prior : undefined;
      write();
      // 通用seed会写静态facts；真实模型保留已准入基线，只追加本阶段读到的当前事实。
      if (baseline) fs.writeFileSync(facts, baseline);
      if (admitted) researchSnapshotFacts(project.root, facts, ctx.phase, admitted);
      return admitted;
    };
    const probe = await runGoalRuntimeChain(project.root, {
      frameworkRoot: project.frameworkRoot, featureId: project.feature, realHarness: true, adapter: 'codex',
      freshStartPhase: birth[0] as 'spec', freshEndPhase: birth.at(-1), freshRequirement: REAL_CHAIN_REQUIREMENT,
      onAuthor: (ctx, actual) => {
        project.runId = ctx.runId;
        assert(actual.runId === ctx.runId && actual.feature === project.feature && actual.owner.run_id === ctx.runId,
          'all method work must belong to the actual original unit request and fence');
        assert(actual.factsContext, 'the dedicated author consumes its actual facts admission, never a phase-label replacement');
        assert(ctx.goalAttemptId === actual.attemptId, 'all method inputs retain the exact original invoke identity');
        const method = (phase: string, write: () => void) => {
          const methodContext = { ...ctx, phase };
          const admitted = admission(methodContext);
          assert(admitted, 'the actual unit request must resolve current facts for ' + phase);
          return authorMaterials(methodContext, write, admitted);
        };
        if (!fs.existsSync(featureFilePath(project.root, project.feature, 'spec/spec.md'))) method('spec', () => writeSpecMaterials(project));
        if (!fs.existsSync(featureFilePath(project.root, project.feature, 'plan/plan.md'))) method('plan', () => writePlanMaterials(project));
        const repair = originalConfirmed && ctx.prompt.includes('CR-001');
        method('coding', () => {
          writeCodingMaterials(project);
          writeHostFile(project.root, `${project.modulePath}/src/main/ets/data/model/BankInfo.ets`, fs.readFileSync(path.join(recorded, 'project', bankInfo), 'utf8'));
          if (repair) { writeHostFile(project.root, adaptedSpy, repaired); fixed = true; repairAttempts.push(actual.attemptId); }
        });
        const currentFacts = featureFilePath(project.root, project.feature, 'context/facts.md');
        fs.appendFileSync(currentFacts, `\n## phase_delta: coding\n| 路径 | 事实 | 影响 |\n|---|---|---|\n| ${project.modulePath}/src/main/ets/data/model/BankInfo.ets | 原接口新增必填 supportedCardTypes | 旧 typed fixture 必须兼容 |\n`);
        const reviewAdmission = method('review', () => writeReviewMaterials(project));
        const reviewFile = featureFilePath(project.root, project.feature, 'review/review-report.md');
        if (reviewAdmission) fs.writeFileSync(reviewFile, fs.readFileSync(reviewFile, 'utf8').replace('## 2. 审查维度',
          reviewAdmission.source_paths.map(source => '- ' + source).join('\n') + '\n\n## 2. 审查维度'));
        if (!fixed) fs.writeFileSync(reviewFile, fs.readFileSync(reviewFile, 'utf8').replace('| 编号 | 分类 | 严重程度 |', '| 编号 | 严重程度 | 分类 |')
          .replace(/^\| R-1 \|.*$/m, row).replace('| BLOCKER | 0 |', '| BLOCKER | 1 |').replace('| MINOR | 1 |', '| MINOR | 0 |')
          .replace('**审查结论**: 通过', '**审查结论**: 不通过'));
        const beforeUt = fs.readFileSync(path.join(project.root, adaptedSpy));
        method('ut', () => writeUtMaterials(project));
        if (fixed) adoptionPreservedBytes = beforeUt.equals(fs.readFileSync(path.join(project.root, adaptedSpy)));
        method('testing', () => writeTestPlan(project));
        for (const family of actual.chain) {
          const admitted = admission({ ...ctx, phase: family });
          assert(admitted, family + ': current facts inputs must remain readable');
          researchSnapshotFacts(project.root, currentFacts, family, admitted);
        }
        fs.appendFileSync(path.join(diagnostics, 'author-observation.jsonl'), JSON.stringify({ run: ctx.runId, attempt: actual.attemptId,
          repair, fixed, actualFeedbackContainsIssue: ctx.prompt.includes('CR-001'), originalConfirmed,
          spyHash: sha(fs.readFileSync(path.join(project.root, adaptedSpy))), expectedRepairedHash: sha(repaired) }) + '\n');
      },
      onOutOfChain: ctx => {
        const request = readDeliveredVerifierRequest(project, ctx); assert(request, `unexpected model purpose: ${ctx.phase}`);
        project.runId = ctx.runId;
        const reportsDir = featurePhaseReportsDir(project.root, project.feature, request.phase, project.frameworkRoot);
        const material = readVerifierMaterialOrNull(reportsDir, request.subject_id);
        assert(material && material.material_sha256 === request.material_sha256 && computeMaterialSha256(material) === request.material_sha256,
          'the independent callback must read the actual current material original');
        for (const file of material.files) {
          const absolute = path.resolve(project.root, file.path), relative = path.relative(project.root, absolute);
          assert(relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), 'material reads stay in the isolated project namespace');
          assert(verifierMaterialFileMatchesCurrent({ projectRoot: project.root, feature: project.feature, material, file: file.path }), file.path);
          if (file.sha256 !== null) fs.readFileSync(absolute);
        }
        if (fs.existsSync(verifierReportMdPath(reportsDir, request.subject_id))) {
          assert(publishRequestedVerifier(project, ctx), 'preserve the existing original verdict, never rewrite a negative answer to clear a loop');
          return;
        }
        let reportText = `# verifier — ${project.feature} / ${request.phase}\n\n读取当前请求与真实文件；本报告不替代尚未执行的UT/设备证据。\n`;
        if (request.phase === 'review' && !fixed) reportText += '\n```issue-verification\n'
          + confirmed.split('02-Feature/WalletMain').join(project.modulePath) + '\n```\n';
        if (request.phase === 'coding') {
          const script = JSON.parse(fs.readFileSync(path.join(reportsDir, 'script-report.json'), 'utf8'));
          const strength = script.checks.find((check: { id: string; affected_files?: string[] }) => check.id === 'coding_existing_test_preserved' && check.affected_files?.length);
          if (strength) {
            assert(typeof strength.details === 'string' && strength.details.trim());
            const promptBytes = fs.readFileSync(path.resolve(project.root, request.prompt_path));
            assert.equal(sha(promptBytes), request.prompt_sha256, 'independent judgment reads the actual bound prompt original');
            const attributionBlock = /### \(test invocation write attribution\)\s+```\s*([\s\S]*?)```/.exec(promptBytes.toString('utf8'));
            const attribution: unknown = attributionBlock ? JSON.parse(attributionBlock[1]) : undefined;
            const judgments: string[] = [];
            for (const file of strength.affected_files as string[]) {
              const absolute = path.resolve(project.root, file), relative = path.relative(project.root, absolute).replace(/\\/g, '/');
              assert(!relative.startsWith('../') && !path.isAbsolute(relative), 'the verifier reads only its actual isolated project');
              const bytes = fs.readFileSync(absolute, 'utf8');
              const preserved = codingTestPreservation({ projectRoot: project.root, feature: project.feature, runId: ctx.runId, file: relative }).preserved;
              const spyRepair = relative === adaptedSpy && bytes === repaired;
              const added = relative === `${project.modulePath}/src/ohosTest/ets/test/AllBanksPage.test.ets`
                && material.files.some(entry => entry.path === relative && entry.sha256 === sha(bytes))
                && Array.isArray(attribution) && attribution.some((entry: unknown) => entry && typeof entry === 'object'
                  && 'owned' in entry && Array.isArray(entry.owned) && entry.owned.some((write: unknown) => write && typeof write === 'object'
                    && 'path' in write && write.path === relative && 'how' in write && write.how === 'added'
                    && 'pre_sha256' in write && write.pre_sha256 === null
                    && 'post_sha256' in write && write.post_sha256 === sha(bytes)));
              if (added) {
                assert(['[AC-1]', '[AC-2]', "service.openCard('cmb')", "service.openCard('')", 'expect(opened).assertTrue()',
                  'expect(rejected).assertFalse()', 'expect(banks.length).assertEqual(0)'].every(fragment => bytes.includes(fragment)),
                'the actually new test retains its complete known business success/failure assertions');
                assert(!/\b(?:it|test|describe)\.(?:skip|todo|only)|\b(?:xit|xtest|xdescribe)\b/.test(bytes), 'the new business cases must not be disabled or focused');
              }
              assert(preserved || spyRepair || added, 'positive judgment requires preserved assertions, the exact Spy repair, or this bound genuinely new business test');
              judgments.push(added ? `${relative}：原绑定prompt确认added、pre=null，post/material/当前源码SHA=${sha(bytes)}；实际新文件无旧断言被删弱，已读完整业务正负用例。`
                : spyRepair ? `${relative}：当前字节逐字匹配已核Spy两行兼容修复与已知新增辅助断言，原用例未替换。`
                  : `${relative}：真实原前像对比确认既有用例与断言原样保留。`);
            }
            reportText += '\n```issue-verification\n' + YAML.stringify([{ issue: strength.id, verdict: 'refuted',
              evidence: `${strength.details}\n${strength.affected_files.join('\n')}\n${judgments.join('\n')}\n此裁决只反证当前条目的删弱疑义，不替无关Spy产品问题作结论，不将未执行的UT/设备结果签成通过；后续原review独核与真实检查仍必需。` }]) + '```\n';
          }
        }
        publishFixtureVerifierEvidence({ projectRoot: project.root, reportsDir, feature: project.feature, phase: request.phase,
          subjectId: request.subject_id, reportText, skipSummaryPatch: true });
        const accepted = loadVerifierEvidenceForSubject(project.root, project.feature, request.phase, request.subject_id, { frameworkRoot: project.frameworkRoot });
        assert(accepted.ok, JSON.stringify(accepted));
        if (request.phase === 'coding') {
          const script = JSON.parse(fs.readFileSync(path.join(reportsDir, 'script-report.json'), 'utf8'));
          const strength = script.checks.find((check: { id: string; affected_files?: string[] }) => check.id === 'coding_existing_test_preserved' && check.affected_files?.length);
          if (strength) {
            assert.equal(testStrengthVerification({ check: strength, verifierReportText: accepted.evidence.report_text,
              verifierSubjectCurrent: true })?.verdict, 'refuted', 'the current full comparison and every actual test file must have an independent judgment');
            if (strength.status === 'FAIL') verifiedStrengthFailure = true;
          }
        }
        if (request.phase === 'review' && !fixed) {
          const currentReport = fs.readFileSync(featureFilePath(project.root, project.feature, 'review/review-report.md'), 'utf8');
          const candidates = collectReviewRepairCandidates({ responsibility: { projectRoot: project.root, frameworkRoot: project.frameworkRoot,
            feature: project.feature, runId: ctx.runId, currentPhase: 'review' }, reportText: currentReport,
            verifierReportText: accepted.evidence.report_text, reportValidityBlocked: false, verifierSubjectCurrent: true });
          fs.writeFileSync(path.join(diagnostics, 'live-publisher.json'), JSON.stringify({
            request, candidates, verifier: accepted.evidence, currentReport,
          }, null, 2) + '\n');
          assert(candidates.some(candidate => candidate.id === 'CR-001'), 'the actual independent original must yield the original repair object: ' + JSON.stringify(candidates));
          originalConfirmed = true;
        }
      },
    });
    const failure = ['coding', 'review', 'ut', 'testing'].map(phase => dumpPhase(project, phase)).join('\n');
    assert.equal(probe.exitCode, 0, `${failure}\n${JSON.stringify(probe.events.slice(-8))}`);
    const reviewFail = probe.events.findIndex(event => event.type === 'phase_verdict' && event.phase === 'review' && event.verdict === 'FAIL');
    const { readExecutionRequestOriginal } = require('../../scripts/utils/session-execution-handoff') as typeof import('../../scripts/utils/session-execution-handoff');
    const reentry = probe.events.findIndex((event, index) => {
      if (index <= reviewFail || event.type !== 'agent_invoke_start' || event.phase !== 'work-unit-author'
        || typeof event.invoke_id !== 'string' || !event.invoke_id) return false;
      const request = readExecutionRequestOriginal(probe.reportDir, event.invoke_id);
      return !!request && repairAttempts.includes(request.request.context.attemptId);
    });
    assert(reviewFail >= 0 && reentry > reviewFail, 'verified original CR-001 must reach the original dedicated unit author');
    assert(typeof project.runId === 'string' && project.runId, 'the completed case retains its actual run identity');
    const born = loadGoalManifestFromRun(project.root, project.runId, { feature: project.feature });
    const establishing = born.phase_chain?.[0] ?? born.execution_scope?.phase_chain[0];
    assert(typeof establishing === 'string' && establishing, 'facts establishing authority comes from the immutable birth');
    const factsRaw = fs.readFileSync(featureFilePath(project.root, project.feature, 'context/facts.md'), 'utf8');
    for (const event of probe.events) {
      if (event.type !== 'agent_invoke_start' || event.phase !== 'work-unit-author') continue;
      assert(typeof event.invoke_id === 'string', 'every actual author has an original request identity');
      const original = readExecutionRequestOriginal(probe.reportDir, event.invoke_id);
      assert(original?.request.context.factsContext, 'every actual author retains its original facts admission');
      assert.equal(original.request.context.factsContext.first_phase, establishing, 'scope changes never move the original establishing anchor');
      if (original.request.context.factsContext.baseline) assert.equal(original.request.context.factsContext.baseline.fingerprint,
        factsBaselineFingerprint(factsRaw), 'an actually admitted inherited baseline is preserved byte-for-byte');
    }
    const qualified = loadPhaseEvidenceManifest(project.root, project.feature, establishing);
    assert(qualified?.integrityOk, 'the original qualified baseline must have a real intact machine manifest');
    const factsRelative = path.relative(project.root, featureFilePath(project.root, project.feature, 'context/facts.md')).replace(/\\/g, '/');
    const originalFacts = [...qualified.manifest.inputs, ...qualified.manifest.outputs].find(entry => entry.path === factsRelative && entry.facts_phase === establishing);
    assert(originalFacts?.exists && originalFacts.sha256, 'the machine manifest must bind the typed establishing facts original');
    assert.equal(originalFacts.sha256, factsPhaseFingerprint(factsRaw, establishing), 'repair retains the actual qualified facts baseline, allowing other methods\' registered deltas');
    const repairStartedAt = probe.events[reentry]?.ts;
    assert(typeof repairStartedAt === 'string' && Date.parse(qualified.manifest.generated_at) < Date.parse(repairStartedAt),
      'the qualified original predates product repair; a later re-sign cannot impersonate preservation');
    for (const phase of ['coding', 'review', 'ut', 'testing']) {
      if (phase === 'coding') assert(probe.events.some((event, index) => index > reentry && event.type === 'harness_end'
        && event.phase === phase && event.timed_out === false && typeof event.exit_code === 'number'),
      'coding must actually finish after repair; its disclosed raw FAIL is never rewritten as a phase PASS');
      else assert(probe.events.some((event, index) => index > reentry && event.type === 'phase_verdict' && event.phase === phase && event.verdict === 'PASS'), phase);
      assert.equal(readSummary(project, phase)?.closure_status, 'closed', phase);
    }
    for (const phase of ['spec', 'plan', 'coding', 'review', 'ut', 'testing']) {
      assert.equal(loadPhaseEvidenceManifest(project.root, project.feature, phase)?.manifest.environment.profile, 'test-chain', `${phase}: native operations must stay on the isolated transport profile`);
    }
    const assessment = assessFeature(project.root, project.feature, { ...resolveChangeUnitExpectedExecution(project.root, project.feature, false, project.frameworkRoot), frameworkRoot: project.frameworkRoot });
    assert(assessment.complete, JSON.stringify(assessment.obligations.filter(obligation => obligation.status === 'uncovered')));
    const codingReport = JSON.parse(fs.readFileSync(featureFilePath(project.root, project.feature, 'coding/reports/script-report.json'), 'utf8'));
    assert(codingReport.checks.some((check: { id: string; status: string }) => check.id === 'coding_existing_test_preserved'
      && check.status === 'FAIL'), 'the added assertion keeps its raw comparison FAIL; only the actual independent judgment may close that task');
    const currentCoding = readSummary(project, 'coding');
    assert(typeof currentCoding?.verifier_subject_id === 'string' && typeof currentCoding.verifier_request === 'string',
      'the repaired coding result must retain its actual current independent request');
    const codingRequest = parseVerifierRequest(fs.readFileSync(path.resolve(project.root, currentCoding.verifier_request), 'utf8'));
    assert(codingRequest && codingRequest.subject_id === currentCoding.verifier_subject_id && codingRequest.phase === 'coding'
      && codingRequest.feature === project.feature, 'the accepted independent conclusion belongs to this current result');
    const codingMaterial = readVerifierMaterialOrNull(featurePhaseReportsDir(project.root, project.feature, 'coding', project.frameworkRoot), codingRequest.subject_id);
    assert(codingMaterial && codingMaterial.material_sha256 === codingRequest.material_sha256 && computeMaterialSha256(codingMaterial) === codingRequest.material_sha256,
      'the current request binds the actual full independent material');
    assert(codingMaterial.files.some(file => file.path === adaptedSpy && file.sha256 === sha(repaired)), 'the current judgment covers the actual repaired Spy original');
    const codingIndependent = loadVerifierEvidenceForSubject(project.root, project.feature, 'coding', codingRequest.subject_id, { frameworkRoot: project.frameworkRoot });
    assert(codingIndependent.ok, JSON.stringify(codingIndependent));
    const currentStrength = codingReport.checks.find((check: { id: string }) => check.id === 'coding_existing_test_preserved');
    assert(currentStrength?.status === 'FAIL' && Array.isArray(currentStrength.affected_files) && currentStrength.affected_files.includes(adaptedSpy),
      'the actual changed Spy keeps its raw comparison FAIL');
    assert.equal(testStrengthVerification({ check: currentStrength, verifierReportText: codingIndependent.evidence.report_text,
      verifierSubjectCurrent: true })?.verdict, 'refuted', 'only the current bound independent refutation closes coding');
    assert(assessment.currentDisposition && phaseCompletionProblems(assessment.currentDisposition, ['coding']).length === 0,
      'the same current disposition has no unresolved coding completion issue');
    {
      assert(adoptionPreservedBytes, 'UT must actually validate and adopt these bytes without rewriting the original error');
      assert(verifiedStrengthFailure, 'retain the real raw comparison FAIL and current full-material independent refutation; an old phase order cannot replace either fact');
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
  } catch (error) {
    const snapshot = fs.mkdtempSync(path.join(evidenceTemp, 'cr001-failed-project-'));
    copyTree(project.root, snapshot, true);
    fs.cpSync(path.join(project.root, '.git'), path.join(snapshot, '.git'), { recursive: true });
    fs.writeFileSync(path.join(diagnostics, 'failed-project-reference.json'), JSON.stringify({
      path: snapshot, source: 'isolated test project, actual failed runtime originals; no framework junction', error: String(error),
    }, null, 2) + '\n');
    throw error;
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
      assert(!checks().some(check => check.id === 'context_exploration_facts_scope_coverage' && check.status === 'FAIL'), `${phase}: current readable target does not require an old ledger row`);
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
    const currentRules = fs.readFileSync(path.join(frameworkRoot, 'specs/phase-rules/spec-rules.yaml'));
    const recordedRules = fs.readFileSync(path.join(recorded, 'spec-rules.original.yaml'));
    if (computeGateFingerprint(frameworkRoot, 'spec') !== evidence.manifest.environment.gate_fingerprint) {
      assert(recomputePhaseEvidenceStaleness(root, feature, ['spec'], { frameworkRoot, runId })[0].changed_paths.includes('<environment:gate_fingerprint>'), 'current environment must still reject the original old gate');
    }
    const replayFramework = provisionFrameworkUnder(root).frameworkRoot;
    const specs = path.join(replayFramework, 'specs');
    assert(!fs.lstatSync(specs).isSymbolicLink() && fs.realpathSync(specs) === specs, 'historical rules are adapted only in the isolated framework copy');
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
    const sourceFailure = recomputePhaseEvidenceStaleness(root, feature, ['spec'], { frameworkRoot: replayFramework, runId })[0];
    assert(sourceFailure.changed_paths.includes(original.source_paths[0]) && !sourceFailure.changed_paths.some(file => file.startsWith('<environment:')), 'source negative must reach the business-input check, not fail at an environment gate');
    fs.writeFileSync(sourceFile, sourceBefore);
    const factsBefore = fs.readFileSync(facts, 'utf8');
    const alteredFacts = factsBefore.replace('ready_to_produce: true', 'ready_to_produce: false');
    assert.notEqual(alteredFacts, factsBefore);
    fs.writeFileSync(facts, alteredFacts);
    fs.writeFileSync(facts, factsBefore);
    const alteredRules = YAML.parse(recordedRules.toString('utf8'));
    assert(Number.isFinite(alteredRules.exploration_thresholds.min_files_inspected));
    alteredRules.exploration_thresholds.min_files_inspected++;
    fs.writeFileSync(ruleFile, YAML.stringify(alteredRules));
    assert(recomputePhaseEvidenceStaleness(root, feature, ['spec'], { frameworkRoot: replayFramework, runId })[0].changed_paths.includes('<environment:gate_fingerprint>'));
    assert(fs.readFileSync(copiedManifestPath).equals(manifestBefore), 'the copied historical manifest is never rewritten');
    assert(fs.readFileSync(path.join(frameworkRoot, 'specs/phase-rules/spec-rules.yaml')).equals(currentRules), 'historical rule adaptation must not change source framework bytes');
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
      const readonlyReview = repairResponsibilityContext({ ...responsibility, executionScope: reviewOnly, executionRole: 'verifier' });
      const readonlyCandidates = collectReviewRepairCandidates({ responsibility: readonlyReview, reportText: report, verifierReportText: pathOwnerVerifier, reportValidityBlocked: false });
      assert(readonlyCandidates.some(candidate => candidate.id === 'CR-001' && candidate.category === 'coding'),
        '独立诊断保留已核实的真实修改建议，不以phase队列裁掉问题：' + JSON.stringify(readonlyCandidates));
      assert(readonlyReview.contracts && !workUnitMayWritePath(readonlyReview.contracts, spy) && !workUnitMayWritePath(readonlyReview.contracts, bankInfo),
        '产物owner与验证签发者一致也不能为当前独立review授予测试或产品源码修改权');
      fs.appendFileSync(path.join(root, spy), "\nexport function extraAssertion(): void { expect(true).assertTrue(); }\n");
      assert(checkCodingExistingTestPreserved(ctx).some(check => check.id === 'coding_existing_test_preserved' && check.status === 'FAIL'
        && check.severity === 'BLOCKER' && check.repair_owner === undefined && check.affected_files?.includes(spy)));
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
      assert.equal(revision, null, 'repairing tests in the already approved unit does not purchase another scope grant');
      const testInput = (currentFrameworkRoot: string) => Object.values(resolveCapabilityInputs({ projectRoot: root, frameworkRoot: currentFrameworkRoot,
        feature, phase: 'ut', track: 'full', testTargets: testCandidates.flatMap(candidate => candidate.files),
        inputContext: { schema_version: '1.1', subject: { feature }, obligations: { 'unit-evidence': 'required' }, required_outputs: [] },
      }).inputs!.values).find(value => value.state === 'resolved' && value.binding.source.kind === 'derive' && value.binding.source.provider_id === 'derive.test-targets');
      const targets = testInput(frameworkRoot);
      assert(targets?.state === 'resolved' && targets.binding.dependencies.some(dependency => path.resolve(dependency.path) === path.join(root, spy)),
        'the actual verified Spy target remains a test-target input rather than becoming production code input');
      const variant = provisionFrameworkUnder(root);
      const skills = path.join(variant.frameworkRoot, 'skills');
      assert(!fs.lstatSync(skills).isSymbolicLink() && fs.realpathSync(skills) === skills, 'contract order is varied only in the isolated framework copy');
      const sourceContractFile = path.join(frameworkRoot, 'skills/feature/business-ut/contract.yaml');
      const sourceContractBefore = fs.readFileSync(sourceContractFile);
      const contractFile = path.join(skills, 'feature/business-ut/contract.yaml');
      const contract = YAML.parse(fs.readFileSync(contractFile, 'utf8'));
      contract.phases.ut.inputs.reverse();
      fs.writeFileSync(contractFile, YAML.stringify(contract));
      const reordered = scopeRevisionInputFromRepairCandidates(testCandidates, { projectRoot: root, frameworkRoot: variant.frameworkRoot, feature, runId });
      assert.equal(reordered, null, 'declared input order cannot require another scope grant for the same approved repair');
      const reorderedTargets = testInput(variant.frameworkRoot);
      assert(reorderedTargets?.state === 'resolved' && reorderedTargets.binding.dependencies.some(dependency => path.resolve(dependency.path) === path.join(root, spy)),
        'declared input order must not turn the actual UT repair target into a production code binding');
      assert(fs.readFileSync(sourceContractFile).equals(sourceContractBefore), 'contract-order variation must not change source framework bytes');
    } finally {
      if (savedRun === undefined) delete process.env.MAISON_GOAL_RUN_ID; else process.env.MAISON_GOAL_RUN_ID = savedRun;
      if (savedDiff === undefined) delete process.env.HARNESS_DIFF_BASE_REF; else process.env.HARNESS_DIFF_BASE_REF = savedDiff;
    }
  }) },
  { name: '179a73 CR-001 real runner repairs original fixture bytes, preserves facts and raw FAIL through independent refutation; real UT adopts unchanged assertions and rejects missing or stale adoption', run: () => replayCR001Runtime() },
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

export const listCaseGroups = () => unitCaseGroups(cases.map(c => c.name));
