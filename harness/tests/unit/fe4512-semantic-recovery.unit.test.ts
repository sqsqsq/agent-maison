import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
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
import { checkAuthoritativeContentAligned, deriveBlueprintSkillInput, designScopeRevisionChecks, projectionContentEqual } from '../../scripts/utils/blueprint-skill-projection';
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
export function assertFe4512Tail(root: string, runId: string, expected: 'recovered' | 'dropped', evidence: { unitAssertions?: number; subjectCalls?: number } = {}) {
  root = path.resolve(root);
  const reports = (phase: string) => featurePhaseReportsDir(root, feature, phase, frameworkRoot);
  const summary = (phase: string) => JSON.parse(fs.readFileSync(path.join(reports(phase), 'summary.json'), 'utf8'));
  const dir = path.join(root, featureDir, 'goal-runs', runId);
  const goal = JSON.parse(fs.readFileSync(path.join(dir, 'goal-report.json'), 'utf8'));
  const events = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  assert(!events.some(event => event.type === 'run_end' && event.status === 'INTERRUPTED'), '无关异常不能算恢复或变异命中');
  if (expected === 'dropped') {
    assert.equal(goal.status, 'HALTED');
    const publications = events.filter(event => event.type === 'design_authority_repair' && event.stage === 'published');
    assert.equal(publications.length, 0, '变异后真实设计发布必须缺失');
    assert(goal.phases.length > 0 && goal.phases.every((item: { phase: string }) => item.phase === 'plan'), '实际修复链仍停在plan');
    const current = summary('plan');
    const report = fs.readFileSync(path.join(reports('plan'), verifierReportMdFilename(current.verifier_subject_id)), 'utf8');
    assert.equal(parseVerifierCheckStatus(report, 'reference_crosscheck'), 'FAIL');
    const finding = YAML.parse(/```yaml\s*\n([\s\S]*?)```/.exec(report)![1]).verification_result.checks.find((item: { id: string }) => item.id === 'reference_crosscheck');
    assert(finding.acceptance_ids.includes('AC-3') && finding.affected_files.includes(blueprintFile), '必须保留同一AC-3设计矛盾');
    const verified = parseIssueVerificationBlock(report);
    assert(verified.ok && verified.entries.some(item => item.issue === 'reference_crosscheck' && item.verdict === 'confirmed' && item.repair_owner === 'external'));
    assert(current.blockers.some((item: { id: string; source: string }) => item.id === 'plan:reference_crosscheck' && item.source === 'issue-verification'));
    if (evidence.subjectCalls !== undefined) assert(evidence.subjectCalls > 0, '动态替换必须实际被读取');
    return { status: goal.status, subject: current.verifier_subject_id, confirmed: true, publications: 0,
      subjectCalls: evidence.subjectCalls ?? null, originalSpyRecorded: evidence.subjectCalls !== undefined };
  }
  const phases = ['plan', 'coding', 'review', 'ut'].map(phase => {
    const value = summary(phase);
    assert.equal(value.verdict, 'PASS', `${phase}真实summary须PASS`);
    assert.equal(value.closure_status, 'closed', `${phase}须真实closed`);
    return { phase, verdict: value.verdict, closure: value.closure_status };
  });
  assert.equal(evidence.unitAssertions, 8, '真实业务UT须执行8条成功断言');
  const ut = JSON.parse(fs.readFileSync(path.join(reports('ut'), 'script-report.json'), 'utf8'));
  assert(ut.checks.some((item: CheckResult) => item.id === 'ut_hvigor_test' && item.status === 'PASS'));
  assert(['COMPLETED', 'PARTIAL'].includes(goal.status), '恢复到UT不能把任意HALT当通过');
  const testing = summary('testing');
  const pending = ['asset', 'visual'].filter(axis => testing.quality_axes?.[axis]?.required_for_release
    && ['STALE', 'UNVERIFIED', 'FAIL', 'BLOCKED'].includes(testing.quality_axes[axis].verdict));
  if (goal.status === 'PARTIAL') {
    assert.equal(testing.completion_status, 'FUNCTIONALLY_COMPLETE_VISUAL_PENDING');
    assert(pending.length > 0, 'PARTIAL须对应实际记录的未完成资产/视觉义务');
  }
  return { status: goal.status, phases, unitAssertions: evidence.unitAssertions, pending,
    qualityAxes: testing.quality_axes, completion: testing.completion_status };
}

export async function replayFe4512SemanticRecovery(dropVerifiedFindings = false, resume?: { root: string; runId: string }): Promise<void> {
  const root = path.resolve(resume?.root ?? setupGoalRuntimeHost('codex', false).root);
  const beforeCalls = fs.readFileSync(path.join(source, featureDir, 'use-cases.yaml'));
  const originalContracts = YAML.parse(fs.readFileSync(path.join(source, featureDir, 'contracts.yaml'), 'utf8'));
  const repairModule = require('../../scripts/utils/repair-candidates') as typeof import('../../scripts/utils/repair-candidates');
  const originalSubjectReader = repairModule.phaseIssuesForVerifierSubject;
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
      const resolution = resolveCapabilityInputs({ purpose: 'design-authority-probe', projectRoot: root, frameworkRoot, feature, phase, track: 'full', ...entry });
      const loader = new SpecLoader(root, undefined, undefined, frameworkRoot);
      return { projectRoot: root, frameworkRoot, feature, phase, phaseRule: loader.loadPhaseRule(phase as CheckContext['phase']),
        featureSpec: loader.loadFeatureSpec(feature, resolution.inputs), resolvedInputs: resolution.inputs, factsContext: entry.factsContext,
        resolvedProfile: loadResolvedProfile(root, loadFrameworkConfig(root), frameworkRoot) } as unknown as CheckContext;
    };
    const writePlan = (): void => {
      planCalls++;
      const projection = deriveBlueprintSkillInput(root, feature, frameworkRoot, 'contracts');
      assert.equal(projection.state, 'resolved', projection.detail);
      if (!resume && planCalls === 1) {
        assert(!fs.existsSync(path.join(root, featureDir, 'acceptance.yaml')), 'plan准备不得跨写spec验收');
        for (const [artifact, name] of [['contracts@1', 'contracts.yaml'], ['use-cases@1', 'use-cases.yaml']]) {
          const file = path.join(root, featureDir, name);
          assert(fs.existsSync(file), `${name}须由真实runtime在plan作者调用前准备`);
          assert(projectionContentEqual(YAML.parse(fs.readFileSync(file, 'utf8')), projection.artifacts![artifact]), `${name}准备必须是当前确定投影`);
        }
      }
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
    if (dropVerifiedFindings) repairModule.phaseIssuesForVerifierSubject = () => { droppedSubjectCalls++; return null; };
    const probe = await runGoalRuntimeChain(root, { frameworkRoot, featureId: feature, adapter: 'codex', noAutoForce: true, viaRuntimeClass: true,
      freshRequirement: requirement, freshStartPhase: initialChain[0] as 'spec', freshEndPhase: initialChain[initialChain.length - 1],
      onSpec: () => { phases.push('spec'); }, onPlan: () => { phases.push('plan'); writePlan(); },
      onCoding: () => {
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
      onOutOfChain: ({ phase, prompt }) => {
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
          } else report = confirm(root, data.report).text;
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
      },
    });
    const interrupted = events().filter(event => event.type === 'run_end' && event.status === 'INTERRUPTED');
    assert.equal(interrupted.length, 0, `组合不能以无关框架异常充当变异命中：${JSON.stringify(interrupted)}`);
    if (dropVerifiedFindings) assert(droppedSubjectCalls > 0 && confirmedFindingSubjects.length > 0,
      `候选入口变异须实际消费同一真实语义发现：${JSON.stringify({ droppedSubjectCalls, confirmedFindingSubjects, phases, exit: probe.exitCode })}`);
    if (dropVerifiedFindings) assertFe4512Tail(root, path.basename(probe.reportDir), 'dropped', { subjectCalls: droppedSubjectCalls });
    const repairs = semanticRepairs();
    const totalPlanCalls = events().filter(event => event.type === 'agent_invoke_start' && event.phase === 'plan').length;
    console.log('[fe4512-result]', JSON.stringify({ phases, planCalls, totalPlanCalls, unitExecuted, exit: probe.exitCode, semanticPublications: repairs.length }));
    assert(repairs.length > 0, `原语义发现未到真实设计发布：${JSON.stringify(events().filter(event => ['phase_halt', 'run_end', 'design_authority_repair'].includes(String(event.type))))}`);
    assert(totalPlanCalls >= 2 && phases.includes('coding') && phases.includes('ut') && unitExecuted,
      `发布后必须继续plan/coding/真实UT：${JSON.stringify({ phases, planCalls, totalPlanCalls, unitExecuted, exit: probe.exitCode })}`);
    const rebound = readRunBoundContracts(root, frameworkRoot, feature, path.basename(probe.reportDir));
    assert(rebound.interfaces?.find(item => item.class === 'OtpService')?.methods.some(method => method.name === 'canResend'), '后继必须真实消费重签后的施工绑定');
    assertFe4512Tail(root, path.basename(probe.reportDir), 'recovered', { unitAssertions });
    assert(fs.readFileSync(path.join(source, featureDir, 'use-cases.yaml')).equals(beforeCalls), '原始现场输入不可改写');
  } finally {
    repairModule.phaseIssuesForVerifierSubject = originalSubjectReader;
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
    { name: '7d9c2e41 fe4512 structured finding drives real design publication and plan coding UT continuation', run: () => replayFe4512SemanticRecovery() },
    { name: '7d9c2e41 production mutation dropping verified findings breaks the same fe4512 continuation', run: async () => {
      await assert.rejects(replayFe4512SemanticRecovery(true), /原语义发现未到真实设计发布/, '撤掉生产候选入口后同一闭环应变红');
    } },
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
