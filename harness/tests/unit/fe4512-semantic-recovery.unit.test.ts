import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import * as crypto from 'crypto';
import * as YAML from 'yaml';
import * as ts from 'typescript';
import { execFileSync } from 'child_process';
import { clearFrameworkConfigCache, featurePhaseReportsDir, loadFrameworkConfig } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
import { generateScriptReport } from '../../scripts/utils/report-generator';
import { writeRunSummaryBase } from '../../harness-runner';
import { setupGoalRuntimeHost, runGoalRuntimeChain } from './goal-runner-testing-integrity.unit.test';
import { currentFinding, confirm } from './verifier-semantic-handoff.unit.test';
import { prepareFeatureScopeCandidate, featureScopeCandidateFingerprint } from '../../scripts/utils/feature-track';
import { freezeFeatureExecutionScope } from '../../scripts/utils/feature-execution-scope';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { scanNamedBusinessHandler } from '../../scripts/utils/named-handler';
import { checkAcceptanceContent } from '../../scripts/utils/check-acceptance';
import { checkAuthoritativeContentAligned, deriveBlueprintSkillInput, designScopeRevisionChecks } from '../../scripts/utils/blueprint-skill-projection';
import { checkChangeUnitFeatureProjection } from '../../scripts/utils/change-unit-feature-projection';
import { loadCanonicalChangeUnit, createChangeUnitRef } from '../../scripts/utils/change-unit-path';
import { parseIssueVerificationBlock, parseVerifierCheckStatus, readVerifierSemanticIssues } from '../../scripts/utils/repair-candidates';
import { buildVerifierMaterialView } from '../../scripts/utils/verifier-material';
import { verifierReportMdFilename } from '../../scripts/utils/verifier-subject';
import { readRunBoundContracts, resolveCapabilityInputs } from '../../scripts/utils/capability-resolution';
import { resolveCapabilityResolutionEntryInput } from '../../scripts/utils/capability-resolution-entry-input';
import type { CheckContext, CheckResult, ContractsSpec } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';
import { startCaseTiming, type UnitExecutionTiming } from '../utils/unit-case-selection';
import { loadGoalManifestFromRun } from '../../scripts/utils/goal-manifest';
import { provisionFrameworkUnder, git } from '../utils/real-chain-host';
import { publishFixtureVerifierEvidence } from '../utils/verifier-evidence-fixture';

const frameworkRoot = path.resolve(__dirname, '../../..');
const source = path.join(__dirname, '../fixtures/host-recovery-history/20261023/20261023T044016Z-fe4512/project');
const feature = 'cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93';
const featureDir = 'doc/features/bc-openCard-2/bank-card-opening-flow';
const blueprintFile = 'doc/features/bc-openCard-2/blueprint/component-blueprint.yaml';
const serviceDir = '02-Feature/WalletMain/src/main/ets/domain/service';
const utFile = '02-Feature/WalletMain/src/ohosTest/ets/test/fe4512_recovery.test.ets';
const otpSource = `export class OtpService {
  private deadline: number = 0;
  async sendMockCode(_mobile: string): Promise<void> { return Promise.resolve(); }
  startCountdown(now: number): void { this.deadline = now + 60000; }
  remainingSeconds(now: number): number { return Math.max(0, Math.ceil((this.deadline - now) / 1000)); }
  canResend(now: number): boolean { return this.remainingSeconds(now) === 0; }
}\n`;
const navigationSource = `export class OpeningNavigationService {
  finish(success: boolean): string { return success ? 'home' : 'AddBankCardPage'; }
}\n`;

function write(root: string, file: string, content: string): void {
  const absolute = path.join(root, file); fs.mkdirSync(path.dirname(absolute), { recursive: true }); fs.writeFileSync(absolute, content);
}
function moduleValue(root: string, file: string, assertionPassed?: () => void): Record<string, any> {
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const holder = { exports: {} };
  vm.runInNewContext(compiled.outputText, { exports: holder.exports, module: holder, require: (name: string) => {
    if (name === '@ohos/hypium') return {
      describe: (_name: string, run: () => void) => run(), it: (_name: string, _timeout: number, run: () => void) => run(),
      expect: (actual: unknown) => ({ assertEqual: (expected: unknown) => { assert.strictEqual(actual, expected); assertionPassed?.(); } }),
    };
    const target = path.resolve(path.dirname(file), name + '.ets');
    assert(target.startsWith(root + path.sep), 'UT loader only reads this replay copy');
    return moduleValue(root, target, assertionPassed);
  } }, { filename: file });
  return holder.exports;
}

export function executeFe4512BusinessUt(root: string): number {
  const resolved = path.resolve(root);
  let assertions = 0;
  moduleValue(resolved, path.join(resolved, utFile), () => assertions++).default();
  return assertions;
}

/** Assertions also run against saved real outcomes; they never change the outcomes. */
export function assertFe4512Tail(root: string, runId: string, evidence: { unitAssertions?: number } = {}) {
  root = path.resolve(root);
  const reports = (phase: string) => featurePhaseReportsDir(root, feature, phase, frameworkRoot);
  const summary = (phase: string) => JSON.parse(fs.readFileSync(path.join(reports(phase), 'summary.json'), 'utf8'));
  const dir = path.join(root, featureDir, 'goal-runs', runId);
  const events = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  const intervalStart = events.map(event => event.type === 'resume' || event.type === 'run_start').lastIndexOf(true);
  assert(intervalStart >= 0, '执行片段须有真实启动/续接边界');
  const currentInterval = events.slice(intervalStart);
  assert(!events.some(event => event.type === 'run_end' && event.status === 'INTERRUPTED'), '无关异常不能算恢复或变异命中');
  const phases = ['plan', 'coding', 'review', 'ut'].map(phase => {
    const value = summary(phase);
    assert.equal(value.verdict, 'PASS', `${phase}真实summary须PASS`);
    assert.equal(value.closure_status, 'closed', `${phase}须真实closed`);
    return { phase, verdict: value.verdict, closure: value.closure_status };
  });
  assert.equal(evidence.unitAssertions, 8, '真实业务UT须执行8条成功断言');
  const ut = JSON.parse(fs.readFileSync(path.join(reports('ut'), 'script-report.json'), 'utf8'));
  assert(ut.checks.some((item: CheckResult) => item.id === 'ut_hvigor_test' && item.status === 'PASS'));
  assert(!currentInterval.some(event => event.type === 'run_end' || event.type === 'feature_completion_generated'), '本次UT执行片段应协作交回，不签发整单终态；历史合法停机不冒充本次终点');
  assert(!events.some(event => event.type === 'agent_invoke_start' && event.phase === 'testing'), '既有轮边界须在UT闭环后交回');
  return { status: 'YIELDED_AT_UT', phases, unitAssertions: evidence.unitAssertions, completionTarget: 'feature', invocationFragment: true };
}

/** Drive the same authorized request one existing runtime boundary at a time; short queues may not contain UT yet. */
export async function runFe4512UtFragment(root: string, options: NonNullable<Parameters<typeof runGoalRuntimeChain>[1]>) {
  let resume = options.resume;
  for (;;) {
    (require('../../scripts/goal-phase-runtime') as typeof import('../../scripts/goal-phase-runtime')).__testing_setCanaryProbeInvoke(async () => ({
      exitCode: 1, stdout: '', stderr: 'Explicit unavailable visual model substitute for the UT execution fragment.', command: 'test-model-substitute',
    }));
    const probe = await runGoalRuntimeChain(root, { ...options, ...(resume ? { resume } : {}),
      noAutoForce: true, viaRuntimeClass: true,
      hostAuthorization: { mode: 'goal_mode', autonomyAuthorized: true } });
    assert.equal(probe.exitCode, 0, '局部执行片段必须沿真实恢复入口继续，不能忽略正式失败：' + JSON.stringify(
      probe.events.filter(event => ['phase_halt', 'phase_verdict', 'run_end', 'phase_write_violation'].includes(String(event.type))).slice(-5)));
    const utFile = path.join(featurePhaseReportsDir(root, options.featureId ?? feature, 'ut', options.frameworkRoot ?? frameworkRoot), 'summary.json');
    const ut = fs.existsSync(utFile) ? JSON.parse(fs.readFileSync(utFile, 'utf8')) : null;
    if (ut?.verdict === 'PASS' && ut.closure_status === 'closed') return probe;
    assert(probe.invokedPhases.length > 0 || probe.harnessPhases.length > 0, '同请求续接不得在零执行、零验证的交回点空转');
    resume = path.basename(probe.reportDir);
  }
}

export async function replayFe4512SemanticRecovery(dropVerifiedFindings = false, resume?: { root: string; runId: string }): Promise<void> {
  const root = path.resolve(resume?.root ?? setupGoalRuntimeHost('codex', false).root);
  const beforeCalls = fs.readFileSync(path.join(source, featureDir, 'use-cases.yaml'));
  const originalContracts = YAML.parse(fs.readFileSync(path.join(source, featureDir, 'contracts.yaml'), 'utf8'));
  const repairModule = require('../../scripts/utils/repair-candidates') as typeof import('../../scripts/utils/repair-candidates');
  const originalDesignReader = repairModule.readVerifiedPhaseDesignFindings;
  const runtimeFile = require.resolve('../../scripts/goal-phase-runtime');
  console.log('[fe4512-runtime-source]', JSON.stringify({ frameworkRoot,
    runtimeSha256: crypto.createHash('sha256').update(fs.readFileSync(runtimeFile)).digest('hex'),
    repairCandidatesSha256: crypto.createHash('sha256').update(fs.readFileSync(require.resolve('../../scripts/utils/repair-candidates'))).digest('hex'),
    loadedExplicitReaderIdentity: /readPhaseRepairIssues[\s\S]{0,250}runId:\s*manifest\.run_id/.test(
      (require('../../scripts/goal-phase-runtime') as typeof import('../../scripts/goal-phase-runtime')).main.toString()),
  }));
  const previousNodePath = process.env.NODE_PATH;
  const requirement = fs.readFileSync(path.join(source, 'doc/features/原始需求/1-2-银行卡/原始需求.md'), 'utf8');
  let initialChain: string[] = [];
  try {
    process.env.NODE_PATH = path.join(frameworkRoot, 'harness/node_modules'); require('module').Module._initPaths();
    if (!resume) {
      fs.cpSync(source, root, { recursive: true });
      // Assemble current runtime assets in the replay copy, without reports, fixtures or directory links.
      for (const directory of ['workflows', 'specs', 'skills', 'harness', 'profiles', 'templates', 'agents', 'docs']) fs.cpSync(path.join(frameworkRoot, directory), path.join(root, 'framework', directory), {
        recursive: true, filter: file => !/(?:^|[\\/])(?:node_modules|reports|tests|vendor)(?:[\\/]|$)/.test(file),
      });
      execFileSync('git', ['config', '--local', 'core.autocrlf', 'false'], { cwd: root });
      execFileSync('git', ['config', '--local', 'core.eol', 'lf'], { cwd: root });
      for (const layer of loadFrameworkConfig(root).architecture.outer_layers) fs.mkdirSync(path.join(root, layer.id), { recursive: true });
      // Fresh development replay: keep business bytes, discard copied runtime state and output proofs.
      for (const name of ['goal-runs', 'execution-scope.json']) fs.rmSync(path.join(root, featureDir, name), { recursive: true, force: true });
      for (const phase of ['spec', 'plan', 'coding', 'review', 'ut', 'testing']) {
        fs.rmSync(path.join(root, featureDir, phase, 'reports'), { recursive: true, force: true });
        fs.rmSync(path.join(root, featureDir, phase, 'phase-completion-receipt.md'), { force: true });
      }
      for (const name of ['acceptance.yaml', 'contracts.yaml', 'use-cases.yaml', 'feature.yaml']) fs.rmSync(path.join(root, featureDir, name), { force: true });
      clearFrameworkConfigCache();
      execFileSync('git', ['add', '-A'], { cwd: root }); execFileSync('git', ['commit', '-qm', 'fe4512 development replay business baseline'], { cwd: root });
      const prepared = prepareFeatureScopeCandidate({ projectRoot: root, frameworkRoot, feature, completionTarget: 'feature',
        requestedResults: ['原始银行卡开卡请求的设计、实现与验证'], requestedPhases: ['spec', 'plan', 'coding', 'review', 'ut', 'testing'],
        requirement, overwrite: true, impact: { userVisibleBehaviorChange: true, reason: '原请求新增开卡界面与状态', basisPaths: ['02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets'] } });
      freezeFeatureExecutionScope({ projectRoot: root, feature, scope: prepared.scope, candidateFingerprint: featureScopeCandidateFingerprint(root, feature) });
      initialChain = prepared.scope.phase_chain;
    } else {
      const manifest = loadGoalManifestFromRun(root, resume.runId, { feature });
      assert(manifest.phase_chain?.length, '保存点须保留真实冻结阶段链');
      initialChain = manifest.phase_chain;
    }
    let unitExecuted = false, unitAssertions = 0, planCalls = 0;
    let droppedSubjectCalls = 0;
    const confirmedFindingSubjects: string[] = [];
    const events = (): Array<Record<string, unknown>> => {
      const dir = path.join(root, featureDir, 'goal-runs');
      return fs.existsSync(dir) ? fs.readdirSync(dir).flatMap(run => {
        const file = path.join(dir, run, 'events.jsonl');
        return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
      }) : [];
    };
    const semanticRepairs = (): Array<Record<string, unknown>> => events().filter(event => event.type === 'design_authority_repair' && event.stage === 'published'
      && Array.isArray(event.checks) && event.checks.some(check => check.check === 'plan:reference_crosscheck'));
    const published = (): boolean => semanticRepairs().length > 0;
    const phases: string[] = [];
    const context = (phase: string): CheckContext => {
      const entry = resolveCapabilityResolutionEntryInput({ purpose: 'design-authority-probe', projectRoot: root, frameworkRoot, feature, phase,
        featuresDir: 'doc/features', goalRunId: process.env.MAISON_GOAL_RUN_ID });
      const resolution = resolveCapabilityInputs({ purpose: 'design-authority-probe', projectRoot: root, frameworkRoot, feature, phase, track: 'full',
        goalRunId: process.env.MAISON_GOAL_RUN_ID, ...entry });
      const loader = new SpecLoader(root, undefined, undefined, frameworkRoot);
      return { projectRoot: root, frameworkRoot, feature, phase, phaseRule: loader.loadPhaseRule(phase as CheckContext['phase']),
        featureSpec: loader.loadFeatureSpec(feature, resolution.inputs), resolvedInputs: resolution.inputs, factsContext: entry.factsContext,
        resolvedProfile: loadResolvedProfile(root, loadFrameworkConfig(root), frameworkRoot) } as unknown as CheckContext;
    };
    const writePlan = (): void => {
      planCalls++;
      const projection = deriveBlueprintSkillInput(root, feature, frameworkRoot, 'contracts');
      assert.equal(projection.state, 'resolved', projection.detail);
      const contracts = structuredClone(projection.value) as ContractsSpec;
      contracts.components = structuredClone(originalContracts.components);
      contracts.change_unit = structuredClone(originalContracts.change_unit);
      const loaded = loadCanonicalChangeUnit(root, 'bc-openCard-2', 'bank-card-opening-flow');
      contracts.change_unit!.change_unit_ref = createChangeUnitRef(loaded);
      for (const mapping of contracts.change_unit!.design_ref_mappings) {
        mapping.design_ref = structuredClone((loaded.changeUnit.design_refs as typeof mapping.design_ref[]).find(ref => JSON.stringify(ref.target) === JSON.stringify(mapping.design_ref.target))!);
        mapping.verification_refs = mapping.verification_refs.map(ref => ref.replace(featureDir + '/acceptance.yaml', blueprintFile));
      }
      write(root, featureDir + '/contracts.yaml', YAML.stringify(contracts));
      write(root, featureDir + '/use-cases.yaml', YAML.stringify(projection.artifacts!['use-cases@1']));
    };
    if (dropVerifiedFindings) repairModule.readVerifiedPhaseDesignFindings = (...args) => {
      const findings = originalDesignReader(...args);
      if (findings.some(finding => finding.check === 'plan:reference_crosscheck')) droppedSubjectCalls++;
      return findings.filter(finding => finding.check !== 'plan:reference_crosscheck');
    };
    const probe = await runFe4512UtFragment(root, { frameworkRoot, featureId: feature, adapter: 'codex', resume: resume?.runId,
      freshRequirement: requirement, freshStartPhase: initialChain[0] as 'spec', freshEndPhase: initialChain[initialChain.length - 1],
      onSpec: () => {
        phases.push('spec');
        const projection = deriveBlueprintSkillInput(root, feature, frameworkRoot, 'acceptance');
        assert.equal(projection.state, 'resolved', projection.detail);
        write(root, featureDir + '/acceptance.yaml', YAML.stringify(projection.value));
      }, onPlan: () => { phases.push('plan'); writePlan(); },
      onCoding: () => {
        if (!dropVerifiedFindings && !published()) return;
        phases.push('coding'); if (!dropVerifiedFindings) assert(published(), '实现必须等待真实设计发布');
        write(root, serviceDir + '/OtpService.ets', otpSource); write(root, serviceDir + '/OpeningNavigationService.ets', navigationSource);
        const otpUi = '02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets';
        write(root, otpUi, fs.readFileSync(path.join(root, otpUi), 'utf8')
          .replace('this.countdownSeconds > 0 || this.mobile.length', '!this.otpService.canResend(Date.now()) || this.mobile.length')
          .replace('this.countdownSeconds = BankConstants.OTP_COUNTDOWN_SECONDS;', 'this.otpService.startCountdown(Date.now());\n    this.countdownSeconds = this.otpService.remainingSeconds(Date.now());')
          .replace('this.countdownSeconds -= 1;', 'this.countdownSeconds = this.otpService.remainingSeconds(Date.now());'));
        const resultUi = '02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardOpeningResultPage.ets';
        write(root, resultUi, "import { BankOpeningCompletionContext } from '../../data/model/BankOpeningCompletionContext';\n" + fs.readFileSync(path.join(root, resultUi), 'utf8')
          .replace('this.navigationService.finish(NavPathContext.stack(), this.result());', `const result = this.result();
    const destination = this.navigationService.finish(result.success);
    if (destination === 'home') {
      BankOpeningCompletionContext.publish(result.fullCardNumber);
      NavPathContext.stack().clear(false);
    } else {
      BankOpeningCompletionContext.clear();
      NavPathContext.stack().popToName(destination, false);
    }`));
      },
      onReview: () => { phases.push('review'); },
      onUt: () => {
        phases.push('ut');
        write(root, utFile, `import { describe, it, expect } from '@ohos/hypium';
import { OtpService } from '../../../main/ets/domain/service/OtpService';
import { OpeningNavigationService } from '../../../main/ets/domain/service/OpeningNavigationService';
export default function Fe4512RecoveryTests(): void {
 describe('opening business', () => {
  it('AC-3 countdown resend and pure navigation decisions', 0, () => {
   const otp = new OtpService(); otp.startCountdown(1000);
   expect(otp.remainingSeconds(1000)).assertEqual(60); expect(otp.canResend(1000)).assertEqual(false);
   expect(otp.remainingSeconds(60000)).assertEqual(1); expect(otp.canResend(60000)).assertEqual(false);
   expect(otp.remainingSeconds(61000)).assertEqual(0); expect(otp.canResend(61000)).assertEqual(true);
   const navigation = new OpeningNavigationService();
   expect(navigation.finish(true)).assertEqual('home'); expect(navigation.finish(false)).assertEqual('AddBankCardPage');
  });
 });
}\n`);
      },
      onOutOfChain: ({ phase, prompt, runId }) => {
        console.log('[fe4512-out-of-chain]', phase);
        if (phase === 'plan-verifier-format-repair') {
          const data = currentFinding(root);
          const proposal = readVerifierSemanticIssues(root, feature, 'plan', data.report, '(current verifier)', frameworkRoot, runId);
          assert(proposal?.rows.length, '当前run的原语义发现必须可核实');
          let reply = data.report + '\n```issue-verification\n- issue: reference_crosscheck\n  verdict: confirmed\n  repair_owner: external\n  evidence: component-blueprint.yaml | ' + proposal.rows[0].summary + '\n```\n';
          if (published()) {
            const reviewed = YAML.parse(/```yaml\s*\n([\s\S]*?)```/.exec(data.report)![1]);
            reviewed.verification_result.checks = []; reviewed.verification_result.summary.fail = 0; reviewed.verification_result.summary.pass = 10;
            reply = '```yaml\n' + YAML.stringify(reviewed) + '```\n';
          }
          const reportsDir = featurePhaseReportsDir(root, feature, 'plan', frameworkRoot);
          const current = JSON.parse(fs.readFileSync(path.join(reportsDir, 'summary.json'), 'utf8'));
          assert(prompt.includes(current.verifier_subject_id), '补核实必须消费当前生产 verifier request');
          publishFixtureVerifierEvidence({ projectRoot: root, reportsDir, feature, phase: 'plan', subjectId: current.verifier_subject_id,
            skipSummaryPatch: true, reportText: reply.replace(/<!-- maison-verifier-result:v1 -->[\s\S]*?<!-- \/maison-verifier-result:v1 -->/g, '') });
          return;
        }
        assert(phase.startsWith('design-repair-'), `旧局部模型替身不支持未声明的链外职责：${phase}`);
        const draft = /草稿文件[^：\n]*：(.+)$/m.exec(prompt)![1].trim();
        const doc = YAML.parse(fs.readFileSync(draft, 'utf8'));
        if (phase === 'design-repair-author') {
          const walk = (value: any): void => {
            if (!value || typeof value !== 'object') return;
            if (value.class === 'OtpService') value.methods.push(
              { name: 'startCountdown', params: [{ name: 'now', type: 'number' }], return: 'void' },
              { name: 'remainingSeconds', params: [{ name: 'now', type: 'number' }], return: 'number' },
              { name: 'canResend', params: [{ name: 'now', type: 'number' }], return: 'boolean' });
            if (value.class === 'OpeningNavigationService') value.methods = [{ name: 'finish', params: [{ name: 'success', type: 'boolean' }], return: 'string' }];
            if (Array.isArray(value.ordered_steps)) value.ordered_steps = value.ordered_steps.map((text: string) => text
              .replace('并启动 60 秒倒计时', '并调用 OtpService.startCountdown(now)，用 remainingSeconds(now)/canResend(now) 驱动 60 秒倒计时与重发门禁')
              .replace('OpeningNavigationService.finish(stack, result)', 'OpeningNavigationService.finish(result.success) 返回纯导航决策，由结果页对真实栈执行'));
            for (const child of Object.values(value)) walk(child);
          };
          walk(doc);
        } else {
          const canonical = YAML.parse(fs.readFileSync(path.join(root, blueprintFile), 'utf8'));
          doc.review_summary.questioning = { ...structuredClone(canonical.review_summary.questioning), provider_id: 'design-repair-questioning' };
        }
        fs.writeFileSync(draft, YAML.stringify(doc));
      },
      onHarnessSummary: ({ phase }): { checks: CheckResult[]; writerOptions?: Parameters<typeof writeRunSummaryBase>[3] } => {
        console.log('[fe4512-stage]', JSON.stringify({ phase, event: 'harness', at: new Date().toISOString() }));
        try {
        const ctx = context(phase);
        if (phase === 'spec') return { checks: checkAcceptanceContent(ctx) };
        if (phase === 'plan') {
          const checks = [...checkAuthoritativeContentAligned(ctx, 'contracts'), ...checkChangeUnitFeatureProjection(ctx, 'plan')];
          checks.push(...designScopeRevisionChecks(ctx, checks));
          const data = currentFinding(root);
          let report: string;
          if (published()) {
            const contracts = ctx.featureSpec.contracts!;
            assert(contracts.interfaces!.find(item => item.class === 'OtpService')!.methods.some(method => method.name === 'canResend'));
            assert(!contracts.interfaces!.find(item => item.class === 'OpeningNavigationService')!.methods[0].params.some(parameter => parameter.type === 'NavPathStack'));
            const reviewed = YAML.parse(/```yaml\s*\n([\s\S]*?)```/.exec(data.report)![1]);
            reviewed.verification_result.checks = []; reviewed.verification_result.summary.fail = 0; reviewed.verification_result.summary.pass = 10;
            report = '```yaml\n' + YAML.stringify(reviewed) + '```\n';
          } else {
            report = confirm(root, data.report).text;
            const finding = YAML.parse(/```yaml\s*\n([\s\S]*?)```/.exec(report)![1]).verification_result.checks.find((item: { id: string }) => item.id === 'reference_crosscheck');
            assert(finding.acceptance_ids.includes('AC-3') && finding.affected_files.includes(blueprintFile), '两条执行片段必须消费同一AC-3设计矛盾');
            const verified = parseIssueVerificationBlock(report);
            assert(verified.ok && verified.entries.some(item => item.issue === 'reference_crosscheck' && item.verdict === 'confirmed' && item.repair_owner === 'external'),
              '原独立发现须真实confirmed并保设计owner责任');
          }
          const issues = readVerifierSemanticIssues(root, feature, 'plan', data.report, '(prior semantic findings)', frameworkRoot);
          const dir = featurePhaseReportsDir(root, feature, 'plan', frameworkRoot); fs.mkdirSync(dir, { recursive: true });
          const template = fs.readFileSync(path.join(frameworkRoot, 'harness/prompts/verify-plan.md'), 'utf8');
          write(root, path.relative(root, path.join(dir, 'ai-prompt.md')), template + '\n\n原始独立发现：\n' + data.original
            + '\n当前证据：\n' + (issues?.evidenceFiles ?? []).map(file => `${file.label}\n${file.content}`).join('\n\n'));
          const verifierMaterial = buildVerifierMaterialView({ projectRoot: root, frameworkRoot, feature, phase: 'plan', gateFingerprint: null,
            phaseRuleText: YAML.stringify(ctx.phaseRule), templateText: template, checks, contextFiles: issues?.evidenceFiles ?? [], resolvedInputs: ctx.resolvedInputs });
          const writerOptions: Parameters<typeof writeRunSummaryBase>[3] = { verifierMaterial, resolvedInputs: ctx.resolvedInputs,
            verifierPlan: { mode: 'enabled', reason: 'policy_required', verifier_prompt: 'harness/prompts/verify-plan.md', message: 'independent original semantic finding replay' } };
          const generated = generateScriptReport(path.join(frameworkRoot, 'harness'), 'plan', feature, root, checks, frameworkRoot);
          const summary = writeRunSummaryBase(root, generated, frameworkRoot, writerOptions);
          assert(summary.verifier_subject_id, '真实writer必须签发当前subject');
          const text = published() ? report + `\n<!-- maison-verifier-result:v1 -->\nverifier_subject_id: ${summary.verifier_subject_id}\nverdict: PASS\nblocker_count: 0\n<!-- /maison-verifier-result:v1 -->\n`
            : report.replace(/verifier_subject_id: [a-f0-9]{64}/g, `verifier_subject_id: ${summary.verifier_subject_id}`);
          fs.writeFileSync(path.join(dir, verifierReportMdFilename(summary.verifier_subject_id!)), text);
          if (dropVerifiedFindings && issues?.rows.some(row => row.id === 'reference_crosscheck')) confirmedFindingSubjects.push(summary.verifier_subject_id!);
          return { checks, writerOptions };
        }
        if (phase === 'coding' || phase === 'ut') {
          const named = scanNamedBusinessHandler(ctx);
          const checks: CheckResult[] = [{ id: 'named_business_handler', category: 'structure', description: '真实命名入口扫描', severity: 'BLOCKER', status: named.issues.length ? 'FAIL' : 'PASS', details: named.issues.join('; ') || 'all declared calls located' }];
          if (phase === 'ut') {
            let details = 'actual UI-free business entry assertions executed', status: 'PASS' | 'FAIL' = 'PASS';
            try { unitAssertions = executeFe4512BusinessUt(root); unitExecuted = true; details += `; ${unitAssertions} assertions`; } catch (error) { status = 'FAIL'; details = String(error); }
            checks.push({ id: 'ut_hvigor_test', category: 'structure', description: '隔离执行当前真实业务与UT源码（设备工具替身）', severity: 'BLOCKER', status, details });
          }
          return { checks };
        }
        return { checks: checkAcceptanceContent(ctx) };
        } catch (error) { throw new Error(`[fe4512-harness:${phase}] ${(error as Error).stack ?? String(error)}`); }
      },
    });
    const interrupted = events().filter(event => event.type === 'run_end' && event.status === 'INTERRUPTED');
    assert.equal(interrupted.length, 0, `组合不能以无关框架异常充当变异命中：${JSON.stringify(interrupted)}`);
    if (dropVerifiedFindings) assert(droppedSubjectCalls > 0 && confirmedFindingSubjects.length > 0,
      `候选入口变异须实际消费同一真实语义发现：${JSON.stringify({ droppedSubjectCalls, confirmedFindingSubjects, phases, exit: probe.exitCode })}`);
    const repairs = semanticRepairs();
    const totalPlanCalls = events().filter(event => event.type === 'agent_invoke_start' && event.phase === 'plan').length;
    console.log('[fe4512-result]', JSON.stringify({ phases, planCalls, totalPlanCalls, unitExecuted, exit: probe.exitCode, semanticPublications: repairs.length }));
    assert(repairs.length > 0, `原语义发现未到真实设计发布：${JSON.stringify(events().filter(event => ['phase_halt', 'run_end', 'design_authority_repair'].includes(String(event.type))))}`);
    assert(totalPlanCalls >= 2 && phases.includes('coding') && phases.includes('ut') && unitExecuted,
      `发布后必须继续plan/coding/真实UT：${JSON.stringify({ phases, planCalls, totalPlanCalls, unitExecuted, exit: probe.exitCode })}`);
    const rebound = readRunBoundContracts(root, frameworkRoot, feature, path.basename(probe.reportDir));
    assert(rebound.interfaces?.find(item => item.class === 'OtpService')?.methods.some(method => method.name === 'canResend'), '后继必须真实消费重签后的施工绑定');
    assertFe4512Tail(root, path.basename(probe.reportDir), { unitAssertions });
    assert(fs.readFileSync(path.join(source, featureDir, 'use-cases.yaml')).equals(beforeCalls), '原始现场输入不可改写');
  } finally {
    repairModule.readVerifiedPhaseDesignFindings = originalDesignReader;
    if (previousNodePath === undefined) delete process.env.NODE_PATH; else process.env.NODE_PATH = previousNodePath;
    require('module').Module._initPaths();
    clearFrameworkConfigCache();
    if (process.env.REAL_CHAIN_DEBUG === '1') {
      const snapshot = resume ? root : path.join(process.env.LOCALAPPDATA!, 'Temp', `fe4512-preserved-${path.basename(root)}`);
      if (!resume) fs.cpSync(root, snapshot, { recursive: true });
      console.log(`[fe4512-replay] kept ${snapshot}`);
    }
    else fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

export async function runSelectedCases(selector?: string) {
  const results: UnitCaseResult[] = [];
  const executionTimings: UnitExecutionTiming[] = [];
  const cases = [
    { name: '7d9c2e41 fe4512 S0 old plan finding drives real design publication and plan coding UT continuation', run: () => replayFe4512SemanticRecovery() },
    { name: '7d9c2e41 dropping one verified-design reader export retains owner publication and UT through the shared production path', run: () => replayFe4512SemanticRecovery(true) },
    { name: '6fd6c8c1 S0 fe4512 halt without phase_halt derives validation-only from the real settled fact', run: () => assertS0ValidationOnlyEligibility() },
    { name: '6fd6c8c1 S1 fe4512 final state reaches ordinary Feature completion, CU VALID and release BLOCKED without re-running authors or devices', run: () => assertS1OrdinaryCompletion() },
  ];
  for (const test of cases.filter(item => selector === undefined || item.name.includes(selector))) {
    const { name } = test;
    const wallStart = Date.now(), cpuStart = process.cpuUsage(), stopTiming = startCaseTiming([name], executionTimings);
    try { await test.run(); results.push({ name, ok: true }); }
    catch (error) { results.push({ name, ok: false, error: (error as Error).stack }); }
    finally { stopTiming(); console.log('[fe4512-timing]', JSON.stringify({ name, wallMs: Date.now() - wallStart, cpu: process.cpuUsage(cpuStart) })); }
  }
  return { results, matchedCaseCount: results.length, executionTimings };
}
export const runAll = async () => (await runSelectedCases()).results;

// ============================================================================
// plan 6fd6c8c1 t1/t7：S0/S1 两个时间截面的生产回放
// ----------------------------------------------------------------------------
// S0（10-23 旧 framework_bug 停机 + 旧 plan 发现）验证：没有 phase_halt 时，真实
// settled + harness_end + phase_verdict(action=halt, framework_bug) 也能派生验证优先资格。
// S1（10-24 最终收尾）验证：不重跑作者/设备，正式完成原件、Feature 复核、CU 推进与
// 接续判断一致；视觉/P0 债务披露而 release 仍 BLOCKED。
// 开发副本整拷当前发布树；恢复、正式 gate、closure、完成生成均由真实 runtime 执行。
// ============================================================================

const S0_ROOT = path.join(__dirname, '../fixtures/host-recovery-history/20261023/20261023T044016Z-fe4512/project');
const S1_ROOT = path.join(__dirname, '../fixtures/host-recovery-history/20261024-fe4512-s1');
const FE4512_CHAIN = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];

function assertS0ValidationOnlyEligibility(): void {
  const facts = require('../../scripts/utils/goal-runner-phase') as typeof import('../../scripts/utils/goal-runner-phase');
  const eventsPath = path.join(S0_ROOT, featureDir, 'goal-runs', '20261023T044016Z-fe4512', 'events.jsonl');
  const events = fs.readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  const halt = events.find((event: { type?: string }) => event.type === 'phase_halt');
  assert.equal(halt, undefined, 'S0 原件的形状前提：没有 phase_halt');
  const eligible = facts.resolveValidationOnlyEligibility(events, { requireInterrupt: true });
  assert.deepEqual(eligible, { phase: 'coding', invoke_id: 'coding-i3' },
    '缺少 phase_halt 不得妨碍识别已完成作者，只补正式 gate 核验');
  // 旧 plan 发现的实质修订由独立的 S0 组合用例验收；新输入可依法使旧作者失效。
}

async function assertS1OrdinaryCompletion(): Promise<void> {
  const vfc = require('../../scripts/utils/verify-feature-completion') as typeof import('../../scripts/utils/verify-feature-completion');
  const goalRunCreation = require('../../scripts/utils/goal-run-creation') as typeof import('../../scripts/utils/goal-run-creation');
  const executionScope = require('../../scripts/utils/execution-scope') as typeof import('../../scripts/utils/execution-scope');
  const assessment = require('../../scripts/utils/feature-assessment') as typeof import('../../scripts/utils/feature-assessment');
  const featureTrack = require('../../scripts/utils/feature-track') as typeof import('../../scripts/utils/feature-track');
  const driver = require('../../scripts/utils/assess') as typeof import('../../scripts/utils/assess');
  const changeUnit = require('../../scripts/utils/change-unit-path') as typeof import('../../scripts/utils/change-unit-path');
  const changeUnitCompletion = require('../../scripts/utils/change-unit-completion') as typeof import('../../scripts/utils/change-unit-completion');
  const runId = '20261023T044016Z-fe4512';
  const preserve = process.env.REAL_CHAIN_DEBUG === '1';
  const tempDir = preserve && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Temp') : os.tmpdir();
  const root = fs.mkdtempSync(path.join(tempDir, 'fe4512-s1-'));
  const previousHdc = process.env.HARNESS_HDC_EXE;
  const sourceEventsBytes = fs.readFileSync(path.join(S1_ROOT, featureDir, 'goal-runs', runId, 'events.jsonl'));
  try {
    console.log('[fe4512-s1-root]', root);
    fs.cpSync(S1_ROOT, root, { recursive: true });
    const captured = JSON.parse(fs.readFileSync(path.join(root, 'sources.json'), 'utf8')) as {
      files: Array<{ file: string; normalization?: string; source_sha256?: string }>;
    };
    const restoredEol = captured.files.filter(row => row.normalization === 'CRLF->LF only');
    for (const row of restoredEol) {
      const file = path.join(root, row.file);
      const original = Buffer.from(fs.readFileSync(file, 'utf8').replace(/\r?\n/g, '\r\n'));
      assert.equal(crypto.createHash('sha256').update(original).digest('hex'), row.source_sha256, `历史原件行尾恢复须严格匹配来源哈希：${row.file}`);
      fs.writeFileSync(file, original);
    }
    console.log('[fe4512-s1-historical-eol]', restoredEol.length);
    const { frameworkRoot } = provisionFrameworkUnder(root);
    write(root, 'AGENTS.md', '# Captured S1 development recovery copy\n');
    write(root, 'no-device.cmd', '@echo off\necho blocked>>"%~dp0device-operations.log"\nexit /b 97\n');
    process.env.HARNESS_HDC_EXE = path.join(root, 'no-device.cmd');
    for (const layer of loadFrameworkConfig(root).architecture.outer_layers) fs.mkdirSync(path.join(root, layer.id), { recursive: true });
    git(root, ['init', '-q']);
    git(root, ['config', 'core.autocrlf', 'false']);
    git(root, ['config', 'core.eol', 'lf']);
    write(root, '.gitignore', 'framework/\ntrust-cp/\nobservations/\n');
    git(root, ['add', '-A']);
    git(root, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'Captured S1 recovery inputs']);
    const featureRoot = path.join(root, featureDir);
    const eventsPath = path.join(featureRoot, 'goal-runs', runId, 'events.jsonl');
    const originalEventsBytes = fs.readFileSync(eventsPath);
    const events = originalEventsBytes.toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
    const isPhaseAuthor = (event: { type?: string; phase?: string }) => event.type === 'agent_invoke_start' && FE4512_CHAIN.includes(event.phase ?? '');
    const authorCallsBefore = events.filter(isPhaseAuthor).length;
    const deviceRunsBefore = fs.readdirSync(path.join(featureRoot, 'testing/reports'))
      .filter(name => /^\d{8}T\d{6}Z-/.test(name)).length;

    const scope = goalRunCreation.loadEffectiveExecutionScope(root, feature, runId, frameworkRoot)!;
    // 完成链 = 消费侧与生成侧共用的**同一有效范围**（复用阶段可能不在本轮 replay 链里，
    // 但仍是完成原件必须覆盖的阶段）。
    const effectiveScope = goalRunCreation.resolveEffectiveScopeSource(root, feature, runId)!.scope;
    const completionChain = executionScope.executionCompletionPhases(effectiveScope);
    assert(completionChain.includes('spec') && completionChain.includes('testing'),
      `S1 有效完成链异常：${JSON.stringify(completionChain)}`);
    assert.equal(events.some((event: { type?: string; status?: string }) => event.type === 'run_end' && event.status === 'PARTIAL'),
      true, '原件历史 run_end PARTIAL 必须保留（不回写旧原件）');
    const unexpectedAuthor = (ctx: { phase: string }): never => { throw new Error(`S1 有效工作不得重派作者：${ctx.phase}`); };
    const proofDiagnostics: unknown[] = [];
    const observeProofs = (stage: string): void => {
      if (!preserve) return;
      const evidence = require('../../scripts/utils/phase-evidence-manifest') as typeof import('../../scripts/utils/phase-evidence-manifest');
      const facts = fs.readFileSync(path.join(featureRoot, 'context/facts.md'), 'utf8');
      const coding = evidence.loadPhaseEvidenceManifest(root, feature, 'coding');
      proofDiagnostics.push({ stage, at: new Date().toISOString(),
        facts_sha256: crypto.createHash('sha256').update(facts).digest('hex'),
        facts_baseline_fingerprint: (require('../../scripts/utils/context-facts') as typeof import('../../scripts/utils/context-facts')).factsBaselineFingerprint(facts),
        coding_manifest_aggregate: coding?.manifest.aggregate_sha256,
        coding_facts_entries: coding && [...coding.manifest.inputs, ...coding.manifest.outputs].filter(row => row.path.includes('facts.md')),
        freshness: evidence.recomputePhaseEvidenceStaleness(root, feature, FE4512_CHAIN, { frameworkRoot, runId }),
      });
      write(root, 'observations/s1-proof-digests.json', JSON.stringify(proofDiagnostics, null, 2) + '\n');
    };
    observeProofs('before-model-research');
    // Model investigation boundary: supply read facts only, leaving scope/gates/closure authoritative.
    const admitted = resolveCapabilityResolutionEntryInput({ purpose: 'design-authority-probe', projectRoot: root, frameworkRoot,
      feature, phase: 'plan', featuresDir: 'doc/features', goalRunId: runId }).factsContext;
    assert(admitted, '当前正式 plan 核验须有生产 facts 调查上下文');
    const originalFacts = fs.readFileSync(path.join(featureRoot, 'context/facts.md'), 'utf8');
    const originalOwner = /established_by:\s*["']?([a-z]+)/.exec(originalFacts)?.[1];
    (require('../fixtures/host-snapshot-3.1.0/migrate') as typeof import('../fixtures/host-snapshot-3.1.0/migrate'))
      .researchSnapshotFacts(root, path.join(featureRoot, 'context/facts.md'), 'plan', admitted);
    const researchedOwner = /established_by:\s*["']?([a-z]+)/.exec(fs.readFileSync(path.join(featureRoot, 'context/facts.md'), 'utf8'))?.[1];
    const expectedOwner = !admitted.baseline && admitted.first_phase === 'plan' ? 'plan' : originalOwner;
    assert.equal(researchedOwner, expectedOwner, '调查建立阶段必须采用生产baseline准入；没有有效baseline时按本次真实调查职责重建');
    console.log('[fe4512-s1-research]', JSON.stringify({ originalOwner, researchedOwner, validBaseline: !!admitted.baseline,
      purpose: 'Read current source/UT evidence for required plan verification; never rewrites business or machine proofs.' }));
    observeProofs('after-model-research');
    (require('../../scripts/goal-phase-runtime') as typeof import('../../scripts/goal-phase-runtime')).__testing_setCanaryProbeInvoke(async () => ({
      exitCode: 1, stdout: '', stderr: 'Explicit unavailable visual model substitute; never grants visual PASS.', command: 'test-model-substitute',
    }));
    const probe = await runGoalRuntimeChain(root, { frameworkRoot, featureId: feature, adapter: 'codex', resume: runId,
      realHarness: true, viaRuntimeClass: true, noAutoForce: true, skipLegacySeal: true, forceResume: true,
      onSpec: unexpectedAuthor, onPlan: unexpectedAuthor, onCoding: unexpectedAuthor,
      onReview: unexpectedAuthor, onUt: unexpectedAuthor, onTesting: unexpectedAuthor,
      onOutOfChain: ctx => {
        assert.equal(ctx.phase, 'plan-verifier-format-repair', '只替代当前原 plan 验证方的补核实');
        observeProofs('after-first-plan-gate');
        const otp = fs.readFileSync(path.join(root, serviceDir, 'OtpService.ets'), 'utf8');
        const businessUt = fs.readFileSync(path.join(root, '02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets'), 'utf8');
        const ui = fs.readFileSync(path.join(root, '02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets'), 'utf8');
        const service = fs.readFileSync(path.join(root, serviceDir, 'BankCardOpeningService.ets'), 'utf8');
        const acceptance = YAML.parse(fs.readFileSync(path.join(featureRoot, 'acceptance.yaml'), 'utf8'));
        assert(otp.includes('class OtpVerificationState') && otp.includes('resend()') && otp.includes('tick()'), '当前真实业务已提供可驱动倒计时');
        assert(businessUt.includes('[AC-3][BD-2]') && businessUt.includes('state.resend()') && businessUt.includes('state.tick()'), '已有业务UT须真实覆盖状态机');
        assert(ui.includes('this.openingService.resendOtp()') && ui.includes('this.openingService.tickOtp()')
          && service.includes('this.otpState.resend()') && service.includes('this.otpState.tick()'), '既有UT对象必须位于实际UI生产调用链');
        assert.equal(acceptance.criteria.find((criterion: { id: string }) => criterion.id === 'AC-5').ut_layer, 'device');
        const reportsDir = featurePhaseReportsDir(root, feature, 'plan', frameworkRoot);
        const current = JSON.parse(fs.readFileSync(path.join(reportsDir, 'summary.json'), 'utf8'));
        assert(ctx.prompt.includes(current.verifier_subject_id), '核实必须绑定生产当前request');
        publishFixtureVerifierEvidence({ projectRoot: root, reportsDir, feature, phase: 'plan', subjectId: current.verifier_subject_id,
          skipSummaryPatch: true, reportText: 'Independent verifier model substitute rechecked current authored evidence.\n'
            + '```yaml\nverification_result:\n  checks:\n    - id: reference_crosscheck\n      status: PASS\n      severity: MAJOR\n      evidence: 当前 OtpVerificationState 已由业务UT隔离驱动；AC-5 的真实导航按 device 层核验，ut_focus 的可用纯函数不是必需接口。\n  summary: { pass: 1, fail: 0 }\n```\n'
            + '```issue-verification\n- issue: reference_crosscheck\n  verdict: refuted\n  evidence: OtpService.ets 的 OtpVerificationState.start/resend/tick 与 bank_open_card_ut.test.ets 的 AC-3/BD-2 已覆盖旧缺口；acceptance.yaml 的 AC-5.ut_layer=device，不把可选纯函数升级为义务。\n```\n' });
      },
    });
    observeProofs('after-runtime');
    const tail = probe.events.slice(events.length);
    const status = [...tail].reverse().find(event => event.type === 'run_end')?.status;
    console.log('[fe4512-s1-runtime]', JSON.stringify({ exitCode: probe.exitCode, invoked: probe.invokedPhases,
      tail: tail.map(({ type, phase, status, halt_reason, reason, trigger }) => ({ type, phase, status, halt_reason, reason, trigger })) }));
    assert(['CHAIN_SLICE_COMPLETED', 'COMPLETED'].includes(String(status)), 'S1 必须经真实恢复入口抵达 finalizer');
    const completion = JSON.parse(fs.readFileSync(path.join(featureRoot, 'goal-runs', runId, 'feature-completion.json'), 'utf8'));
    assert.deepEqual(completion.chain, completionChain, '真实 finalizer 的完成原件必须携带同一有效完成链');
    const record = vfc.inspectCompletionRecord({ projectRoot: root, feature, expectedChain: completionChain, expectedTrack: 'full', frameworkRoot });
    assert.equal(record.verdict, 'VALID', `完成原件复核失败：${record.reasons.join('；')}`);
    assert.deepEqual(record.drift, [], '有效证据不得被判过期');
    const currentPlan = JSON.parse(fs.readFileSync(path.join(featureRoot, 'plan/reports/summary.json'), 'utf8'));
    assert.equal(typeof currentPlan.verifier_report, 'string', '旧设计发现必须有当前原验证方正式回复');
    const currentPlanReply = fs.readFileSync(path.resolve(root, currentPlan.verifier_report), 'utf8');
    assert.equal(parseVerifierCheckStatus(currentPlanReply, 'reference_crosscheck'), 'PASS',
      '旧设计发现必须由当前原验证方明确复核已解决，不能靠无关scope事件消失');

    // ③ Feature 复核 + CU 推进 + 接续判断一致。
    const assessed = assessment.assessFeature(root, feature, { expectedChain: completionChain, expectedTrack: 'full', frameworkRoot });
    assert.equal(assessed.complete, true, `Feature 未完成：${assessment.assessmentReasons(assessed).join('；')}`);
    const canonical = changeUnit.loadCanonicalChangeUnit(root, 'bc-openCard-2', 'bank-card-opening-flow');
    const cu = changeUnitCompletion.observeChangeUnitCompletion(root, changeUnit.asChangeUnitArtifact(canonical.changeUnit));
    assert.equal(cu.state, 'VALID', `CU 完成未推进：${cu.reasons.join('；')}`);
    const workflow = require('../../workflow-loader').resolveWorkflowSpec(root, { frameworkRoot });
    const view = featureTrack.resolveCurrentScopeView({ projectRoot: root, frameworkRoot, feature, workflow, previous: scope, currentRunId: runId });
    assert.deepEqual(view.phase_chain, [], '接续不得重派有效工作');
    const next = driver.assessFeature({ projectRoot: root, feature, frameworkRoot, authorization: { mode: 'batch_authorized' } });
    assert.equal(next.recommendation.action, 'feature_completed', `当前状态/下一步不一致：${JSON.stringify(next.recommendation)}`);
    driver.writeNextProjection(root, feature, next);
    assert.equal(JSON.parse(fs.readFileSync(path.join(featureRoot, 'next.json'), 'utf8')).recommendation.action, 'feature_completed');
    const goalReport = JSON.parse(fs.readFileSync(path.join(featureRoot, 'goal-runs', runId, 'goal-report.json'), 'utf8'));
    assert.equal(goalReport.status, status, '报告与当前状态必须一致');
    const live = (require('../../scripts/utils/goal-progress') as typeof import('../../scripts/utils/goal-progress')).buildLiveGoalStatusSnapshot({
      projectRoot: root, manifest: loadGoalManifestFromRun(root, runId, { feature }), workflow,
      featuresDir: 'doc/features', feature, runId,
    });
    assert.equal(live.run_disposition, 'TERMINAL', 'goal-status 必须采用已完成处置');
    assert.equal(live.next_action, 'read_goal_report', 'goal-status 不得再提示旧返修或续接');
    assert.equal(live.recovery, undefined, '完成后不能残留旧诊断');
    const reduced = (require('../../scripts/utils/run-state-reducer') as typeof import('../../scripts/utils/run-state-reducer')).reduceRunState(probe.events);
    assert.equal(reduced.run_disposition, 'TERMINAL');
    assert.equal(reduced.recovery, undefined);

    // ④ 披露与发布限制：视觉/P0 债务保留、release 仍 BLOCKED、不伪造视觉 PASS。
    const testing = JSON.parse(fs.readFileSync(path.join(featureRoot, 'testing/reports/summary.json'), 'utf8'));
    assert.equal(testing.release_readiness, 'BLOCKED', '释放限制不得被完成洗掉');
    assert.equal(testing.quality_axes.visual.verdict, 'UNVERIFIED', '不得把视觉 UNVERIFIED 改成 PASS');
    const debt = JSON.parse(fs.readFileSync(path.join(featureRoot, 'visual-debt.json'), 'utf8'));
    assert(debt.entries.some((entry: { status: string }) => entry.status !== 'closed'), '视觉债务必须保留披露');

    // ⑤ 已有有效执行事实不重跑：没有新增作者调用/设备执行，原件字节未被改写。
    const afterEvents = fs.readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
    assert.equal(afterEvents.filter(isPhaseAuthor).length, authorCallsBefore,
      '完成不得新增作者调用');
    assert.equal(fs.readdirSync(path.join(featureRoot, 'testing/reports')).filter(name => /^\d{8}T\d{6}Z-/.test(name)).length,
      deviceRunsBefore, '完成不得新增设备执行轮次');
    assert(!fs.existsSync(path.join(root, 'device-operations.log')), '有效设备结果接续不得调用设备；开发副本永远不接真实HDC');
    assert(fs.readFileSync(path.join(S1_ROOT, featureDir, 'goal-runs', runId, 'events.jsonl')).equals(sourceEventsBytes),
      '夹具原件不得被改写');
    const formalGateMs = tail.reduce((total, event, index) => {
      if (event.type !== 'harness_start') return total;
      const end = tail.slice(index + 1).find(next => next.type === 'harness_end' && next.invoke_id === event.invoke_id && next.phase === event.phase);
      return end ? total + Math.max(0, Date.parse(String(end.ts)) - Date.parse(String(event.ts))) : total;
    }, 0);
    console.log('[fe4512-s1-completion]', JSON.stringify({ status, complete: assessed.complete, cu: cu.state,
      newAuthors: afterEvents.filter(isPhaseAuthor).length - authorCallsBefore,
      fixtureResearchPreparations: 1,
      verifierCalls: tail.filter(event => event.type === 'agent_invoke_start' && String(event.phase).endsWith('-verifier-format-repair')).map(event => event.phase),
      canaryCalls: tail.filter(event => event.type === 'agent_invoke_start' && event.purpose === 'vision_canary').length,
      deviceExecutions: 0, formalGateMs,
      formalGates: tail.filter(event => event.type === 'harness_start').map(event => event.phase),
      release: testing.release_readiness, currentAction: live.next_action }));
  } finally {
    if (previousHdc === undefined) delete process.env.HARNESS_HDC_EXE; else process.env.HARNESS_HDC_EXE = previousHdc;
    if (preserve) console.log('[fe4512-s1-preserved]', root);
    else fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
