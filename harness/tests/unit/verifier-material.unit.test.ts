// verifier-material.unit.test.ts — plan 07a41ec6 T7：审前材料视图（subject 寻址材料）与差异登记

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';

import { clearFrameworkConfigCache, featurePhaseReportsDir, relFeaturesDir, resolveFeatureArtifact, loadFrameworkConfig } from '../../config';
import {
  buildVerifierMaterialView,
  collectCurrentAcceptanceEvidence,
  currentAcceptanceExecutionKeyMatcher,
  diffVerifierMaterial,
  readVerifierMaterialOrNull,
  verifierMaterialFilename,
  writeVerifierMaterial,
} from '../../scripts/utils/verifier-material';
import type { ContextFileEntry } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';
import { copyC6HostReplay } from '../utils/c6-host-replay';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { collectContextFiles, writeRunSummaryBase } from '../../harness-runner';
import { publishFixtureVerifierEvidence } from '../utils/verifier-evidence-fixture';
import { readCurrentDispositionInput } from '../../scripts/utils/verify-feature-completion';
import { resolveCurrentDisposition } from '../../scripts/utils/check-disposition';
import { resolveCapabilityResolutionEntryInput } from '../../scripts/utils/capability-resolution-entry-input';
import { resolveCapabilityInputs } from '../../scripts/utils/capability-resolution';
import { designScopeRevisionChecks } from '../../scripts/utils/blueprint-skill-projection';
import type { CheckContext } from '../../scripts/utils/types';
import { readPhaseRepairIssues, verifierSemanticChecks } from '../../scripts/utils/repair-candidates';
import { finalizePhaseClosure } from '../../scripts/utils/phase-closure-finalizer';
import { computeGateFingerprint } from '../../scripts/utils/gate-fingerprint';
import { phaseCompletionProblems } from '../../scripts/utils/check-disposition';
import { setupRunlessProject } from './execution-scope.unit.test';
import { ensureFeatureExecutionScopeFrozen } from '../../scripts/utils/feature-execution-scope';
import { loadResolvedProfile } from '../../profile-loader';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, type UnitExecutionTiming } from '../utils/unit-case-selection';

const FEATURE = 'vm-fixture';

function mkProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-verifier-material-'));
  clearFrameworkConfigCache();
  return root;
}

function put(root: string, rel: string, content: string): string {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
  return abs;
}

const CHECKS = [
  { id: 'a', status: 'PASS', severity: 'MAJOR' },
  { id: 'b', status: 'WARN', severity: 'MINOR' },
];

function countAcceptanceCollections<T>(run: () => T): { result: T; count: number } {
  const material = require('../../scripts/utils/verifier-material') as typeof import('../../scripts/utils/verifier-material');
  const original = material.collectCurrentAcceptanceEvidence;
  let count = 0;
  material.collectCurrentAcceptanceEvidence = input => { count += 1; return original(input); };
  try { return { result: run(), count }; }
  finally { material.collectCurrentAcceptanceEvidence = original; }
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'current acceptance anchors use the profile filename and preserve original or unavailable profile semantics',
    run: () => {
      const root = mkProject(), frameworkRoot = path.resolve(__dirname, '../../..');
      const native = require('../../../profiles/hmos-app/harness/execution-key') as { EXECUTION_KEY_FILE: string | undefined };
      const original = native.EXECUTION_KEY_FILE;
      const originalPath = `doc/features/${FEATURE}/ut/reports/run/ut/${original}`;
      try {
        put(root, originalPath, '{}');
        const options = { projectRoot: root, frameworkRoot };
        const build = (label: string, selectedFrameworkRoot = frameworkRoot) => buildVerifierMaterialView({ ...options, frameworkRoot: selectedFrameworkRoot,
          feature: FEATURE, phase: 'plan', gateFingerprint: null, phaseRuleText: 'rule', templateText: 'template', checks: [],
          contextFiles: [{ label, content: 'native proof' }] });
        assert(currentAcceptanceExecutionKeyMatcher(options)(originalPath));
        native.EXECUTION_KEY_FILE = 'native-ut-key.json';
        const matches = currentAcceptanceExecutionKeyMatcher(options);
        const variantPath = `doc/features/${FEATURE}/ut/reports/run/ut/native-ut-key.json`;
        put(root, variantPath, '{}');
        assert(matches(variantPath));
        assert(!matches(originalPath));
        assert(!matches(variantPath.replace('/ut/native-ut-key.json', '/other/native-ut-key.json')));
        const repair = require('../../scripts/utils/repair-candidates') as typeof import('../../scripts/utils/repair-candidates');
        const readIssues = repair.readPhaseRepairIssues;
        let collections = 0;
        repair.readPhaseRepairIssues = () => { collections += 1; return null; };
        try {
          build(variantPath);
          assert.equal(collections, 0, 'the material producer recognizes a profile-named anchor already in context');
        } finally { repair.readPhaseRepairIssues = readIssues; }
        native.EXECUTION_KEY_FILE = undefined;
        assert(!currentAcceptanceExecutionKeyMatcher(options)(variantPath));
        native.EXECUTION_KEY_FILE = original;
        assert(currentAcceptanceExecutionKeyMatcher(options)(originalPath), 'original material naming remains compatible');
        assert(build(originalPath).files.some(file => file.path === originalPath));
        put(root, 'framework.config.json', JSON.stringify({ project_profile: { name: 'minimal' } }));
        put(root, 'framework/profiles/minimal/profile.yaml', 'name: minimal\n');
        clearFrameworkConfigCache();
        assert(!currentAcceptanceExecutionKeyMatcher({ projectRoot: root, frameworkRoot: path.join(root, 'framework') })(originalPath));
        assert(build(originalPath, path.join(root, 'framework')).files.some(file => file.path === originalPath), 'missing native support does not erase supplied material');
      } finally { native.EXECUTION_KEY_FILE = original; fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
    },
  },
  {
    name: 'a same-path semantic contract change still reaches the original design-scope producer',
    run: () => {
      const f = setupRunlessProject({ chain: ['plan', 'coding', 'review', 'ut'] });
      try {
        assert.equal(ensureFeatureExecutionScopeFrozen({ projectRoot: f.root, frameworkRoot: f.frameworkRoot, feature: f.feature }).status, 'frozen');
        const options = { projectRoot: f.root, frameworkRoot: f.frameworkRoot, feature: f.feature, phase: 'plan', track: 'full' as const };
        const entry = resolveCapabilityResolutionEntryInput({ ...options, featuresDir: relFeaturesDir(f.root) });
        const inputs = resolveCapabilityInputs({ ...options, ...entry }).inputs!;
        const loader = new SpecLoader(f.root, undefined, undefined, f.frameworkRoot);
        const ctx: CheckContext = { ...options, phase: 'plan', resolvedInputs: inputs, featureSpec: loader.loadFeatureSpec(f.feature, inputs), factsContext: entry.factsContext,
          phaseRule: loader.loadPhaseRule('plan'), resolvedProfile: loadResolvedProfile(f.root, loadFrameworkConfig(f.root), f.frameworkRoot),
          harnessRoot: path.join(f.frameworkRoot, 'harness'), frameworkRel: 'framework' };
        assert.deepEqual(designScopeRevisionChecks(ctx, []), []);
        const contracts = resolveFeatureArtifact(f.root, f.feature, 'contracts.yaml').actualPath;
        const updated = YAML.parse(fs.readFileSync(contracts, 'utf8'));
        updated.interfaces = [{ class: 'DemoPort', file: 'src/demo/value.ts', methods: [{ name: 'readValue', params: [], return: 'number' }] }];
        fs.writeFileSync(contracts, YAML.stringify(updated));
        const produced = resolveCapabilityInputs({ ...options,
          inputContext: { schema_version: '1.1', subject: { feature: f.feature }, obligations: {}, required_outputs: [] } }).inputs!;
        assert(produced.values.contracts.state === 'resolved');
        assert(designScopeRevisionChecks({ ...ctx, resolvedInputs: produced, featureSpec: loader.loadFeatureSpec(f.feature, produced) }, [])
          .some(check => check.scope_revision_input), 'path rebasing must not hide a real new interface contract');
      } finally { fs.rmSync(f.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
    },
  },
  {
    name: 'S2 shared entry and producer select current assertions and frozen proof, retain them after refutation and refresh real changes',
    run: () => {
      const f = copyC6HostReplay();
      const frameworkRoot = path.resolve(__dirname, '../../..');
      const reports = featurePhaseReportsDir(f.root, f.feature, 'plan', frameworkRoot);
      const options = { projectRoot: f.root, feature: f.feature, phase: 'plan', frameworkRoot };
      const current = () => resolveCurrentDisposition(readCurrentDispositionInput({ ...options, chain: ['plan'], runId: f.runId }));
      try {
        const beforeFiles = fs.readdirSync(reports).sort();
        const originalIssues = readPhaseRepairIssues(f.root, f.feature, 'plan', { frameworkRoot })!;
        assert(originalIssues.rows.some(row => row.id === 'acceptance_to_interface'));
        const evidence = collectCurrentAcceptanceEvidence(options);
        assert(evidence.some(file => file.label.endsWith('bank_open_card_ut.test.ets') && file.content.includes('expect(')), 'real assertions, beyond a test label');
        assert(evidence.some(file => file.label.endsWith('OtpService.ets') && file.content.includes('OtpVerificationState')));
        assert(evidence.some(file => file.label.endsWith('BankCardOpeningService.ets') && file.content.includes('tickOtp')));
        assert(evidence.some(file => file.label.endsWith('frozen.ut-result.WalletMain.json')));
        const nativeHost = require('../../../profiles/hmos-app/harness/ut-host-impl') as typeof import('../../../profiles/hmos-app/harness/ut-host-impl');
        const nativeFacts = nativeHost.currentUtExecutionInputs;
        try {
          nativeHost.currentUtExecutionInputs = undefined as unknown as typeof nativeFacts;
          assert.deepEqual(collectCurrentAcceptanceEvidence(options), [], 'a profile without current native facts retains ordinary verification semantics');
        } finally { nativeHost.currentUtExecutionInputs = nativeFacts; }
        assert(!evidence.some(file => /\/(?:summary|script-report|ac-coverage)\.json$/.test(file.label)), 'mutable latest reports are not plan materials');
        const countedEntry = countAcceptanceCollections(current);
        assert(countedEntry.result.completionBlocking.some(problem => problem.id === 'open_finding:acceptance_to_interface' && problem.action === 'verify'));
        assert.equal(countedEntry.count, 1, 'one read-only entry assembles current counterevidence once');
        assert.deepEqual(fs.readdirSync(reports).sort(), beforeFiles, 'read-only entry cannot issue requests');
        const loader = new SpecLoader(f.root, undefined, undefined, frameworkRoot);
        const entry = resolveCapabilityResolutionEntryInput({ ...options, featuresDir: relFeaturesDir(f.root), goalRunId: f.runId, goalAttemptId: 'i28' });
        const resolvedInputs = resolveCapabilityInputs({ ...options, track: 'full', ...entry }).inputs;
        assert(resolvedInputs, 'use the real CU/run-resolved producer input');
        const scopeContext = { ...options, featureSpec: loader.loadFeatureSpec(f.feature, resolvedInputs), resolvedInputs, factsContext: entry.factsContext } as CheckContext;
        const eventsFile = path.join(f.root, f.featureDir, 'goal-runs', f.runId, 'events.jsonl'), eventsBytes = fs.readFileSync(eventsFile);
        assert.deepEqual(designScopeRevisionChecks(scopeContext, []), [], 'moving an unchanged contracts binding cannot publish a new design fact or refresh birth code observations');
        const contractsFile = resolveFeatureArtifact(f.root, f.feature, 'contracts.yaml').actualPath, contractsBytes = fs.readFileSync(contractsFile);
        fs.appendFileSync(contractsFile, '\n# explanatory text only\n');
        const commentInputs = resolveCapabilityInputs({ ...options, track: 'full', ...entry }).inputs!;
        assert.deepEqual(designScopeRevisionChecks({ ...scopeContext, resolvedInputs: commentInputs,
          featureSpec: loader.loadFeatureSpec(f.feature, commentInputs) }, []), [], 'a comment cannot manufacture an empty design revision after valid descendant proofs are retained');
        fs.writeFileSync(contractsFile, contractsBytes);
        assert(fs.readFileSync(eventsFile).equals(eventsBytes), 'design-fact comparison cannot rewrite historical scope or events');
        const context = () => collectContextFiles(loader, { kind: 'consumer', projectRoot: f.root, frameworkRoot, frameworkRel: 'framework' }, 'plan', f.feature, loader.loadFeatureSpec(f.feature, resolvedInputs), { resolvedInputs, factsContext: entry.factsContext });
        const contexts = context();
        for (const file of evidence) assert(contexts.some(entry => entry.label === file.label), `real producer omitted ${file.label}`);
        const script = JSON.parse(fs.readFileSync(path.join(reports, 'script-report.json'), 'utf8'));
        const build = () => buildVerifierMaterialView({ ...options, resolvedInputs, factsContext: entry.factsContext, gateFingerprint: computeGateFingerprint(frameworkRoot, 'plan'), phaseRuleText: 'c6 material binding', templateText: 'current producer', checks: script.checks, contextFiles: context() });
        const view = build();
        const issued = writeRunSummaryBase(f.root, script, frameworkRoot, { verifierMaterial: view,
          verifierPlan: { mode: 'enabled', reason: 'policy_required', verifier_prompt: 'prompts/verify-plan.md', message: 'production material test' } });
        assert(issued.verifier_subject_id);
        publishFixtureVerifierEvidence({ projectRoot: f.root, reportsDir: reports, feature: f.feature, phase: 'plan', subjectId: issued.verifier_subject_id,
          reportText: '```issue-verification\n- issue: acceptance_to_interface\n  verdict: refuted\n  evidence: Current AC-3/BD-2 assertions drive OtpVerificationState through the production service.\n```', skipSummaryPatch: true });
        const countedWriter = countAcceptanceCollections(() => writeRunSummaryBase(f.root, script, frameworkRoot, { verifierMaterial: view,
          verifierPlan: { mode: 'enabled', reason: 'policy_required', verifier_prompt: 'prompts/verify-plan.md', message: 'production material test' } }));
        const reviewed = countedWriter.result;
        assert.equal(countedWriter.count, 1, 'subject validation and disposition reuse one read view when no revision is written');
        assert(!reviewed.repair_candidates?.length, 'the real producer consumes the independent refutation');
        assert.equal(build().material_sha256, view.material_sha256, 'closing the finding cannot remove its counterevidence');
        assert(!current().completionBlocking.some(problem => problem.id === 'open_finding:acceptance_to_interface'), 'current semantic/facts inputs cannot reopen an already reviewed counterevidence claim');
        const native = evidence.find(file => file.label.endsWith('/ut/execution-key.json'))!;
        const latest = path.join(path.dirname(path.dirname(path.dirname(path.join(f.root, native.label)))), '20991026T000000Z-000', 'ut');
        fs.mkdirSync(path.dirname(latest), { recursive: true }); fs.cpSync(path.dirname(path.join(f.root, native.label)), latest, { recursive: true });
        const keyFile = path.join(latest, 'execution-key.json');
        const key = JSON.parse(fs.readFileSync(keyFile, 'utf8')); key.run_started_at = '2099-10-26T00:00:00Z'; fs.writeFileSync(keyFile, JSON.stringify(key));
        assert.equal(build().material_sha256, view.material_sha256, 'routine same-key UT runs keep the original frozen anchor');
        for (const label of ['02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets', '02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets']) {
          const file = path.join(f.root, label), bytes = fs.readFileSync(file);
          fs.appendFileSync(file, '\n// changed executable input\n');
          try { assert.notEqual(build().material_sha256, view.material_sha256, label); }
          catch (error) { assert.match((error as Error).message, /input binding stale:/, 'changed bound inputs must refresh or fail their existing binding'); }
          assert(current().completionBlocking.some(problem => problem.id === 'open_finding:acceptance_to_interface' && problem.action === 'verify'), 'a refuted finding still requires fresh proof after real input changes');
          fs.writeFileSync(file, bytes);
        }
        const config = path.join(f.root, 'hvigor/hvigor-config.json5'), configBytes = fs.readFileSync(config);
        fs.appendFileSync(config, '\n// tool configuration changed\n');
        assert(collectCurrentAcceptanceEvidence(options).some(file => file.label.startsWith('(') && file.content.includes('配置')));
        const changedView = build();
        assert.notEqual(changedView.material_sha256, view.material_sha256);
        assert.equal(require('../../scripts/utils/repair-candidates').phaseIssuesForVerifierSubject(f.root, f.feature, 'plan', issued.verifier_subject_id, frameworkRoot), null, 'the old subject cannot certify changed execution conditions');
        const changed = writeRunSummaryBase(f.root, script, frameworkRoot, { verifierMaterial: changedView,
          verifierPlan: { mode: 'enabled', reason: 'policy_required', verifier_prompt: 'prompts/verify-plan.md', message: 'production changed inputs' } });
        assert.notEqual(changed.verifier_subject_id, issued.verifier_subject_id, 'invalidated evidence must issue a new real request');
        assert.equal(build().material_sha256, changedView.material_sha256, 'a pending request retains the historical anchor and current gap');
        assert(current().completionBlocking.some(problem => problem.id === 'open_finding:acceptance_to_interface' && problem.action === 'verify'), 'the changed-subject producer cannot erase the pending original verification');
        assert.equal(require('../../scripts/utils/repair-candidates').phaseIssuesForVerifierSubject(f.root, f.feature, 'plan', changed.verifier_subject_id, frameworkRoot), null);
        const refutedBody = '```issue-verification\n- issue: acceptance_to_interface\n  verdict: refuted\n  evidence: Original verifier assessed the current configuration gap and all bound materials; the old plan concern is not a remaining acceptance obligation.\n```';
        publishFixtureVerifierEvidence({ projectRoot: f.root, reportsDir: reports, feature: f.feature, phase: 'plan', subjectId: changed.verifier_subject_id,
          reportText: refutedBody, skipSummaryPatch: true });
        const close = () => finalizePhaseClosure({ ...options, phase: 'plan', resolvedInputs, factsContext: entry.factsContext,
          goalRunId: f.runId, persistPhaseState: () => undefined });
        assert.equal(close().summary.closure_status, 'closed', 'a real reply on the changed subject must close the original verification lifecycle');
        assert(!current().completionBlocking.some(problem => problem.id === 'open_finding:acceptance_to_interface'));
        fs.appendFileSync(config, '// another current configuration change\n');
        assert(current().completionBlocking.some(problem => problem.id === 'open_finding:acceptance_to_interface' && problem.action === 'verify'));
        const confirmedView = build();
        const confirmedRequest = writeRunSummaryBase(f.root, script, frameworkRoot, { verifierMaterial: confirmedView,
          verifierPlan: { mode: 'enabled', reason: 'policy_required', verifier_prompt: 'prompts/verify-plan.md', message: 'second changed configuration' } });
        const issueRow = originalIssues.rows.find(row => row.id === 'acceptance_to_interface')!;
        const finding = verifierSemanticChecks(originalIssues.reportText, 'plan', f.feature).find(row => row.id === issueRow.id)!;
        const confirmedBody = '```yaml\n' + YAML.stringify({ verification_result: { feature: f.feature, phase: 'plan', checks: [finding],
          summary: { pass: 0, fail: 1, blockers: 0, verdict: 'PASS' } } }) + '```\n```issue-verification\n- issue: ' + issueRow.id
          + '\n  verdict: confirmed\n  repair_owner: plan\n  evidence: plan.md contracts.yaml | ' + issueRow.summary + '\n```';
        publishFixtureVerifierEvidence({ projectRoot: f.root, reportsDir: reports, feature: f.feature, phase: 'plan', subjectId: confirmedRequest.verifier_subject_id,
          reportText: confirmedBody, skipSummaryPatch: true });
        const confirmed = writeRunSummaryBase(f.root, script, frameworkRoot, { verifierMaterial: confirmedView,
          verifierPlan: { mode: 'enabled', reason: 'policy_required', verifier_prompt: 'prompts/verify-plan.md', message: 'current independent confirmation' } });
        assert(confirmed.repair_candidates?.some(candidate => candidate.id === issueRow.id));
        const ownerTasks = phaseCompletionProblems(current(), ['plan']);
        assert(ownerTasks.some(problem => problem.id === 'open_finding:' + issueRow.id && problem.action === 'repair' && problem.owner === 'plan'), 'persisted author dispatch must see the original verifier confirmation as owner repair');
        assert(!ownerTasks.every(problem => problem.action === 'verify'), 'the real runtime verifier-only predicate must yield to the current owner task');
        assert.equal(confirmed.next_action, 'fix_verifier_findings_then_rerun_harness');
        assert.throws(close, /open_finding:acceptance_to_interface/, 'confirmed required work cannot close before its author repairs it');
        // A bounded native-execution substitute publishes the existing frozen result under the actual new configuration key.
        const nativeApi = require('../../../profiles/hmos-app/harness/execution-key') as typeof import('../../../profiles/hmos-app/harness/execution-key');
        const newRun = path.join(path.dirname(path.dirname(latest)), '20991027T000000Z-000', 'ut');
        fs.mkdirSync(path.dirname(newRun), { recursive: true }); fs.cpSync(latest, newRun, { recursive: true });
        const newRecord = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
        const modules = newRecord.frozen_files.flatMap((name: string) => /^frozen\.ut-result\.(.+)\.json$/.exec(name)?.[1] ?? []);
        newRecord.inputs.tool_config_sha256 = nativeApi.sha256Text(modules.sort().map((module: string) => `${module}=${nativeHost.utBuildCollectorKey(f.root, module, 'default')}`).join('\n'));
        newRecord.execution_key = nativeApi.computeExecutionKey(newRecord.inputs); newRecord.run_started_at = '2099-10-27T00:00:00Z';
        nativeApi.writeExecutionKeyRecord(newRun, newRecord);
        const refreshed = collectCurrentAcceptanceEvidence(options);
        assert(refreshed.some(file => file.label === path.relative(f.root, path.join(newRun, 'execution-key.json')).replace(/\\/g, '/')), 'unusable prior anchors cannot hide a newly valid frozen execution');
        assert(!refreshed.some(file => file.label === native.label), 'the current selected native anchor must actually refresh');
        const refreshedView = build();
        const refreshedRequest = writeRunSummaryBase(f.root, script, frameworkRoot, { verifierMaterial: refreshedView,
          verifierPlan: { mode: 'enabled', reason: 'policy_required', verifier_prompt: 'prompts/verify-plan.md', message: 'current native evidence refresh' } });
        publishFixtureVerifierEvidence({ projectRoot: f.root, reportsDir: reports, feature: f.feature, phase: 'plan', subjectId: refreshedRequest.verifier_subject_id,
          reportText: refutedBody, skipSummaryPatch: true });
        assert.equal(close().summary.closure_status, 'closed');
        assert.equal(build().material_sha256, refreshedView.material_sha256, 'the refreshed anchor stays stable after the original verifier reply');
        assert(!current().completionBlocking.some(problem => problem.id === 'open_finding:acceptance_to_interface'));
        fs.writeFileSync(config, configBytes);
        writeRunSummaryBase(f.root, script, frameworkRoot, { verifierMaterial: view,
          verifierPlan: { mode: 'enabled', reason: 'policy_required', verifier_prompt: 'prompts/verify-plan.md', message: 'restore original test configuration' } });
        const frozen = path.join(f.root, evidence.find(file => file.label.endsWith('frozen.ut-result.WalletMain.json'))!.label);
        fs.appendFileSync(frozen, '\n');
        assert(collectCurrentAcceptanceEvidence(options).some(file => file.label.startsWith('(') && file.content.includes('字节变化')));
        assert(current().completionBlocking.some(problem => problem.action === 'verify'));
        const frozenView = build();
        const frozenRequest = writeRunSummaryBase(f.root, script, frameworkRoot, { verifierMaterial: frozenView,
          verifierPlan: { mode: 'enabled', reason: 'policy_required', verifier_prompt: 'prompts/verify-plan.md', message: 'changed frozen native bytes' } });
        assert.equal(build().material_sha256, frozenView.material_sha256, 'issuing a request cannot discard the configuration inputs selected for its frozen-evidence diagnosis');
        publishFixtureVerifierEvidence({ projectRoot: f.root, reportsDir: reports, feature: f.feature, phase: 'plan', subjectId: frozenRequest.verifier_subject_id,
          reportText: refutedBody, skipSummaryPatch: true });
        assert.equal(close().summary.closure_status, 'closed');
        assert(!current().completionBlocking.some(problem => problem.id === 'open_finding:acceptance_to_interface'));
      } finally { fs.rmSync(f.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
    },
  },
  {
    name: '材料视图：同材料两次构建同指纹；上下文文件内容/脚本 check 状态/规则/模板变了才换；reports 运行期产物不入材料',
    run: () => {
      const root = mkProject();
      try {
        put(root, 'src/a.ets', 'a v1');
        put(root, `doc/features/${FEATURE}/review/reports/20260903-000001/hylyre/trace.json`, '{"cases":[]}');
        const ctx: ContextFileEntry[] = [
          { label: 'src/a.ets', kind: 'path', content: '4 字节' },
          // verifier 必读的运行期证据由 runner 以路径条目显式送入 → 入材料（codex review）
          { label: `doc/features/${FEATURE}/review/reports/20260903-000001/hylyre/trace.json`, kind: 'path', content: '' },
          { label: '(truncated)', content: '...' },
        ];
        const base = {
          projectRoot: root, feature: FEATURE, phase: 'review', gateFingerprint: '3.0.0:abcdef012345',
          phaseRuleText: 'rule: 1', templateText: '# template', checks: CHECKS, contextFiles: ctx,
        };
        const v1 = buildVerifierMaterialView(base);
        const v2 = buildVerifierMaterialView(base);
        assert.strictEqual(v1.material_sha256, v2.material_sha256, '同材料必须同指纹');
        assert.ok(v1.files.some(f => f.path === 'src/a.ets'), '上下文源码按路径入材料');
        assert.ok(v1.files.some(f => f.path.endsWith('hylyre/trace.json')), '显式送入的最新 run trace 须入材料');
        assert.ok(!v1.files.some(f => f.path.endsWith('summary.json')), 'manifest 侧的 reports 运行期产物（summary 等）不入材料');
        assert.deepStrictEqual(v1.script_checks, ['a=PASS/MAJOR', 'b=WARN/MINOR']);

        put(root, 'src/a.ets', 'a v2');
        assert.notStrictEqual(buildVerifierMaterialView(base).material_sha256, v1.material_sha256, '源码内容变 → 换指纹');
        put(root, 'src/a.ets', 'a v1');
        assert.notStrictEqual(
          buildVerifierMaterialView({ ...base, checks: [{ id: 'a', status: 'FAIL', severity: 'MAJOR' }, CHECKS[1]] }).material_sha256,
          v1.material_sha256, 'check 状态变 → 换指纹',
        );
        assert.notStrictEqual(buildVerifierMaterialView({ ...base, phaseRuleText: 'rule: 2' }).material_sha256, v1.material_sha256, '规则变 → 换指纹');
        assert.notStrictEqual(buildVerifierMaterialView({ ...base, templateText: '# template v2' }).material_sha256, v1.material_sha256, '模板变 → 换指纹');
        assert.strictEqual(buildVerifierMaterialView({ ...base, contextFiles: [...ctx, { label: '(multimodal-degraded)', content: 'x' }] }).material_sha256, v1.material_sha256, '伪标签条目不入材料');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: '差异登记：文件改/增/删与规则/模板/check 投影逐项列出；上一份缺失时如实标 unavailable',
    run: () => {
      const root = mkProject();
      try {
        put(root, 'src/a.ets', 'a');
        put(root, 'src/b.ets', 'b');
        const mk = (files: ContextFileEntry[], extra?: { phaseRuleText?: string; checks?: typeof CHECKS }) =>
          buildVerifierMaterialView({
            projectRoot: root, feature: FEATURE, phase: 'review', gateFingerprint: null,
            phaseRuleText: extra?.phaseRuleText ?? 'r', templateText: 't', checks: extra?.checks ?? CHECKS, contextFiles: files,
          });
        const prev = mk([{ label: 'src/a.ets', kind: 'path', content: '' }, { label: 'src/b.ets', kind: 'path', content: '' }]);
        put(root, 'src/a.ets', 'a2');
        put(root, 'src/c.ets', 'c');
        const curr = mk(
          [{ label: 'src/a.ets', kind: 'path', content: '' }, { label: 'src/c.ets', kind: 'path', content: '' }],
          { phaseRuleText: 'r2', checks: [{ id: 'a', status: 'FAIL', severity: 'MAJOR' }] },
        );
        const diff = diffVerifierMaterial(prev, curr);
        assert.deepStrictEqual(diff, ['phase_rules', 'script_report_checks', 'src/a.ets', '+src/c.ets', '-src/b.ets'], JSON.stringify(diff));
        assert.deepStrictEqual(diffVerifierMaterial(null, curr), ['(prior material manifest unavailable)']);
        assert.deepStrictEqual(diffVerifierMaterial(prev, prev), []);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: '落盘：按 subject 分区读写往返；非法 subject 拒绝造文件名',
    run: () => {
      const root = mkProject();
      try {
        const subject = 'c'.repeat(64);
        const view = buildVerifierMaterialView({
          projectRoot: root, feature: FEATURE, phase: 'plan', gateFingerprint: null,
          phaseRuleText: 'r', templateText: 't', checks: [], contextFiles: [],
        });
        writeVerifierMaterial(root, subject, view);
        assert.deepStrictEqual(readVerifierMaterialOrNull(root, subject), view);
        assert.strictEqual(readVerifierMaterialOrNull(root, 'd'.repeat(64)), null);
        assert.throws(() => verifierMaterialFilename('short'));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: '扩展输入入材料（cp c7e2a9f4 §2.6）：只改 extensionInstructions → 指纹变且 diff 标 extension_instructions；knowledge（audience 命中 / 仅 binding 引入）以 path 条目入材料，改正文即点名路径',
    run: () => {
      const root = mkProject();
      try {
        put(root, 'src/a.ets', 'a');
        put(root, 'doc/extensions/knowledge/spec-author.md', '# spec v1');
        put(root, 'doc/extensions/knowledge/plan-only.md', '# plan v1');
        const knowledge = (): ContextFileEntry[] => [
          { label: 'src/a.ets', kind: 'path', content: '' },
          // audience 命中的 knowledge 与仅由 phase_bindings 引入的 knowledge 同样按 path 条目送入（harness-runner 接线）
          { label: 'doc/extensions/knowledge/spec-author.md', kind: 'path', content: 'spec 作者要求' },
          { label: 'doc/extensions/knowledge/plan-only.md', kind: 'path', content: 'plan 惯例' },
        ];
        const mk = (extensionInstructions?: string) => buildVerifierMaterialView({
          projectRoot: root, feature: FEATURE, phase: 'spec', gateFingerprint: null,
          phaseRuleText: 'r', templateText: 't', checks: CHECKS, contextFiles: knowledge(), extensionInstructions,
        });
        const base = mk('## Instance extension inputs\n\n### Knowledge index\n\n- `doc/extensions/knowledge/spec-author.md`');
        assert.strictEqual(base.extension_sha256.length, 64, '有扩展输入时 extension_sha256 须为 sha256');
        assert.strictEqual(mk().extension_sha256, '', '无扩展输入时为空串');
        const instrChanged = mk('## Instance extension inputs\n\n### before_phase_work\n\n- mcp `fetch` → tool `host.fetch`; usage v2');
        assert.notStrictEqual(instrChanged.material_sha256, base.material_sha256, '只改扩展指令也必须换材料指纹');
        assert.deepStrictEqual(diffVerifierMaterial(base, instrChanged), ['extension_instructions']);
        // 旧材料文件没有 extension_sha256 字段：按空串对账，不视为不可用
        const legacy = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
        delete legacy.extension_sha256;
        assert.deepStrictEqual(diffVerifierMaterial(legacy as never, mk()), []);
        assert.deepStrictEqual(diffVerifierMaterial(legacy as never, base), ['extension_instructions']);
        // audience 命中的 knowledge 改正文 → 点名路径
        put(root, 'doc/extensions/knowledge/spec-author.md', '# spec v2');
        const specChanged = mk(base.extension_sha256 && '## Instance extension inputs\n\n### Knowledge index\n\n- `doc/extensions/knowledge/spec-author.md`');
        assert.deepStrictEqual(diffVerifierMaterial(base, specChanged), ['doc/extensions/knowledge/spec-author.md']);
        // 仅由 binding 引入（audience 属别的阶段）的 knowledge 改正文 → 同样点名路径
        put(root, 'doc/extensions/knowledge/plan-only.md', '# plan v2');
        const boundChanged = mk(base.extension_sha256 && '## Instance extension inputs\n\n### Knowledge index\n\n- `doc/extensions/knowledge/spec-author.md`');
        assert.deepStrictEqual(diffVerifierMaterial(specChanged, boundChanged), ['doc/extensions/knowledge/plan-only.md']);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    // 金值 = 引入目标简报分量之前的 computeMaterialSha256 对同一输入的产出（改动前实跑取得）。
    name: '目标简报分量（plan 33784ed1 §3.4）：简报为空 → material_sha256 与改动前逐字节相同；有简报 → 换指纹且 diff 只标 goal_brief',
    run: () => {
      const root = mkProject();
      try {
        const GOLDEN_WITHOUT_BRIEF = '4c01c04e4e085143e62744c7293b577ecbe897a5e2fa7a959ecc83337820e54c';
        const mk = (goalBriefText?: string) => buildVerifierMaterialView({
          projectRoot: root, feature: FEATURE, phase: 'plan', gateFingerprint: '3.0.0:abcdef012345',
          phaseRuleText: 'rule: 1', templateText: '# template', checks: CHECKS, contextFiles: [],
          ...(goalBriefText === undefined ? {} : { goalBriefText }),
        } as Parameters<typeof buildVerifierMaterialView>[0]);
        const none = mk();
        assert.strictEqual(none.material_sha256, GOLDEN_WITHOUT_BRIEF, '未传简报时材料指纹必须与改动前相同');
        assert.strictEqual(mk('').material_sha256, GOLDEN_WITHOUT_BRIEF, '简报为空串时材料指纹必须与改动前相同');
        const withBrief = mk('## 目标简报（goal brief）\n\n### 判定办法\n\n按目标裁决。');
        const briefSha = (withBrief as unknown as { goal_brief_sha256?: string }).goal_brief_sha256 ?? '';
        assert.strictEqual(briefSha.length, 64, '有简报时分量为 sha256');
        assert.notStrictEqual(withBrief.material_sha256, GOLDEN_WITHOUT_BRIEF, '简报进入材料指纹');
        assert.deepStrictEqual(diffVerifierMaterial(none, withBrief), ['goal_brief']);
        assert.notStrictEqual(mk('## 目标简报（goal brief）\n\n### 判定办法\n\n按目标裁决。\n- 新排除项').material_sha256,
          withBrief.material_sha256, '简报内容变 → 换指纹');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
];

export function runSelectedCases(filter?: string) {
  const results: UnitCaseResult[] = [];
  const timings: UnitExecutionTiming[] = [];
  for (const c of cases.filter(test => matchesUnitCase(test.name, filter))) {
    const finish = startCaseTiming([c.name], timings);
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (err) {
      results.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    } finally { finish(); }
  }
  return selectedUnitCases(results, filter, timings);
}

export function runAll(): UnitCaseResult[] { return runSelectedCases().results; }
