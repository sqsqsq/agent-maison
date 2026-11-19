import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { clearFrameworkConfigCache } from '../../config';
import { readPendingTestingRetests } from '../../scripts/utils/testing-trace-gates';
import { requireV1ForGate } from '../../scripts/utils/hylyre-result-protocol';
import { buildVerifierMaterialView, writeVerifierMaterial } from '../../scripts/utils/verifier-material';
import { publishFixtureVerifierEvidence } from './verifier-evidence-fixture';
import { copyC6HostReplay } from './c6-host-replay';
import * as YAML from 'yaml';
import { resolveCapabilityInputs } from '../../scripts/utils/capability-resolution';
import { createGoalRun, resolveEffectiveScopeSource } from '../../scripts/utils/goal-run-creation';
import { readScopeAcceptance } from '../../scripts/utils/feature-track';
import { currentEvidenceEntryHash, loadPhaseEvidenceManifest, recomputeManifestAggregate, writePhaseEvidenceManifest } from '../../scripts/utils/phase-evidence-manifest';
import { computeExecutionKey, sha256Text, utExecutionModules } from '../../../profiles/hmos-app/harness/execution-key';
import { currentUtExecutionInputs } from '../../../profiles/hmos-app/harness/ut-host-impl';
import { parseHypiumStdout } from '../../../profiles/hmos-app/harness/hdc-runner';
import { extractUtItBlocks } from '../../scripts/utils/ut-it-blocks';
import { executedUtChecks } from '../../scripts/utils/ut-execution-evidence';

export function testingRetestCases(): Array<{ name: string; run(): void }> {
  return [{ name: '4c8d73b1 failed behavior survives deletion changed assertions old builds and skips while renamed equivalent evidence closes', run() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'testing-retest-')));
    const fixture = path.resolve(__dirname, '../fixtures/host-recovery-history/20261024-fe4512-s1');
    const relative = 'doc/features/bc-openCard-2/bank-card-opening-flow', runId = '20261023T044016Z-fe4512';
    const frameworkRoot = path.resolve(__dirname, '../../..');
    const read = (file: string): any => JSON.parse(fs.readFileSync(file, 'utf8'));
    const hash = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
    const write = (file: string, bytes: string): void => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
    try {
      fs.copyFileSync(path.join(fixture, 'framework.config.json'), path.join(root, 'framework.config.json'));
      for (const file of ['manifest.json', 'events.jsonl']) write(path.join(root, relative, 'goal-runs', runId, file),
        fs.readFileSync(path.join(fixture, relative, 'goal-runs', runId, file), 'utf8'));
      const manifest = read(path.join(root, relative, 'goal-runs', runId, 'manifest.json'));
      const goldens = path.join(frameworkRoot, 'profiles/hmos-app/vendor/hylyre/src/hylyre/contracts/golden/trace/valid');
      const failure = read(path.join(goldens, 'capture-unavailable-evidence-incomplete.json'));
      const success = read(path.join(goldens, 'all-passed.json'));
      const selector = success.cases[0].steps[0].selector;
      selector.request.value = 'pay_button';
      selector.resolution.selected.id = 'pay_button';
      for (const candidate of selector.resolution.candidates) candidate.id = 'pay_button';
      const prepare = (trace: any, id: string): any => {
        trace.feature = manifest.feature; trace.cases[0].id = id; trace.cases[0].name = 'same visible label';
        for (const call of trace.tool_calls) call.case = id;
        assert(requireV1ForGate(trace, { frameworkRoot }).ok, 'test input must obey the real native protocol');
        return trace;
      };
      prepare(failure, 'TC-18'); prepare(success, 'TC-901');
      const row = (id: string, expected = 'original visible result', selector = 'pay_button'): string =>
        '# Plan\n## 测试用例\n| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC |\n| --- | --- | --- | --- | --- | --- | --- |\n'
        + `| ${id} | same visible label | original precondition | {"touch":{"by_id":"${selector}"}} ; {"wait_for":{"by_id":"result"}} | ${expected} | P0 | AC-7 |\n`;
      const hap = 'a'.repeat(64), reports = path.join(root, relative, 'testing/reports');
      const publish = (stamp: string, trace: any, plan: string, seconds: number): void => {
        const dir = path.join(reports, stamp, 'hylyre'), tracePath = path.join(dir, 'trace.json');
        const bytes = JSON.stringify(trace);
        write(tracePath, bytes); write(path.join(dir, 'test-plan.hylyre.md'), plan);
        const inputs = { hap_sha256_full: hap, derived_plan_sha256: hash(plan), profile: 'hmos-app', device: 'isolated-test',
          display_env: '', reset_mode: 'warm', hylyre_version: null, manifest_version: null, tool_config_sha256: '', flags: [] };
        write(path.join(dir, 'execution-key.json'), JSON.stringify({ schema_version: '1.0', execution_key: computeExecutionKey(inputs),
          run_started_at: new Date(Date.parse(manifest.created_at) + seconds * 1000).toISOString(), trace_path: tracePath,
          trace_sha256: hash(bytes), inputs, outcome: trace.outcome }));
      };
      const pending = (currentHapSha256: string | null = hap) => readPendingTestingRetests({ projectRoot: root,
        feature: manifest.feature, runId, frameworkRoot, currentHapSha256 });
      const countReads = () => {
        const nodeFs = require('fs') as typeof fs, original = nodeFs.readFileSync, counts = new Map<string, number>();
        const material = require('../../scripts/utils/verifier-material') as typeof import('../../scripts/utils/verifier-material');
        const matchesCurrent = material.verifierMaterialFileMatchesCurrent, checks = new Map<string, number>();
        nodeFs.readFileSync = ((file: fs.PathOrFileDescriptor, ...args: any[]) => {
          if (typeof file === 'string') { const key = path.resolve(file); counts.set(key, (counts.get(key) ?? 0) + 1); }
          return Reflect.apply(original, nodeFs, [file, ...args]);
        }) as typeof fs.readFileSync;
        material.verifierMaterialFileMatchesCurrent = (input) => {
          checks.set(input.file, (checks.get(input.file) ?? 0) + 1); return matchesCurrent(input);
        };
        try { return { findings: pending(), reads: (file: string) => counts.get(path.resolve(file)) ?? 0,
          applicabilityChecks: (file: string) => checks.get(file) ?? 0 }; }
        finally { nodeFs.readFileSync = original; material.verifierMaterialFileMatchesCurrent = matchesCurrent; }
      };
      publish('01', failure, row('TC-18'), 5);
      assert.equal(pending().length, 1, 'original failure must remain before any retest');
      publish('02', success, row('TC-901'), 10);
      assert.equal(pending().length, 0, 'renumbering does not change identical observed behavior');
      assert.equal(pending('b'.repeat(64)).length, 1, 'a different build cannot borrow the old success');
      publish('02', success, row('TC-901', 'different assertion'), 10);
      assert.equal(pending().length, 1, 'same label with different expected behavior is not equivalent');
      const repeated = structuredClone(success);
      repeated.cases = ['TC-901', 'TC-902', 'TC-903'].map(id => ({ ...structuredClone(success.cases[0]), id }));
      repeated.tool_calls = repeated.cases.flatMap((test: any) => success.tool_calls.map((call: any) => ({ ...structuredClone(call), case: test.id })));
      assert(requireV1ForGate(repeated, { frameworkRoot }).ok);
      const repeatedPlan = row('TC-901', 'different assertion') + ['TC-902', 'TC-903']
        .map(id => row(id, 'different assertion').split('\n').find(line => line.startsWith(`| ${id} |`))!).join('\n') + '\n';
      publish('02', repeated, repeatedPlan, 10);
      write(path.join(reports, 'summary.json'), '{}');
      const missingIndependent = countReads();
      assert.equal(missingIndependent.findings.length, 1);
      assert.equal(missingIndependent.reads(path.join(reports, 'summary.json')), 1, 'one invocation reads an unavailable verifier subject once across candidate cases');
      publish('02', success, row('TC-901', 'different assertion'), 10);
      const evidencePaths = ['01/hylyre/trace.json', '01/hylyre/test-plan.hylyre.md', '02/hylyre/trace.json', '02/hylyre/test-plan.hylyre.md']
        .map(file => path.relative(root, path.join(reports, file)).replace(/\\/g, '/'));
      const proof = publishFixtureVerifierEvidence({ projectRoot: root, feature: manifest.feature, phase: 'testing', reportsDir: reports,
        reportText: '```issue-verification\n- issue: testing_failure_routing_TC-18_s0\n  verdict: refuted\n  evidence: >-\n    原行为 TC-18 的触发与预期现由等价 TC-901 真实覆盖。'
          + evidencePaths.join(' ') + '\n```\n' });
      const materialPath = writeVerifierMaterial(reports, proof.subjectId, buildVerifierMaterialView({ projectRoot: root, feature: manifest.feature, phase: 'testing', frameworkRoot,
        gateFingerprint: null, phaseRuleText: '', templateText: '', checks: [],
        contextFiles: [{ label: '(current acceptance evidence)', content: 'fixture independent semantic decision' },
          ...evidencePaths.map(label => ({ label, kind: 'path' as const, content: 'actual evidence' }))] }));
      const verified = countReads();
      assert.equal(verified.findings.length, 0, 'a current independent equivalent-behavior decision may approve corrected test steps or expected wording');
      assert.equal(verified.reads(path.join(reports, 'summary.json')), 1);
      assert.equal(verified.reads(proof.mdPath), 1, 'one invocation reads the same independent report once');
      assert.equal(verified.reads(materialPath), 1, 'one invocation reads the same independent material once');
      for (const file of evidencePaths) assert.equal(verified.applicabilityChecks(file), 1, 'overlapping original/new evidence receives one shared applicability check per invocation');
      const proofText = fs.readFileSync(proof.mdPath, 'utf8');
      write(proof.mdPath, proofText.replace('verdict: refuted', 'verdict: unclear'));
      assert.equal(pending().length, 1, 'the next call must observe a changed verdict in the same report file');
      write(proof.mdPath, proofText);
      assert.equal(pending().length, 0, 'the next call must reload restored current independent evidence');
      publish('02', success, row('TC-901', 'original visible result', 'different_trigger'), 10);
      assert.equal(pending().length, 1, 'same expected text with a different trigger is not equivalent; the previous verifier is stale');
      write(path.join(reports, 'summary.json'), JSON.stringify({ verifier_plan: { mode: 'disabled' } }));
      const corrected = structuredClone(success);
      corrected.cases[0].steps[0].selector.request.value = 'corrected_pay_button';
      corrected.cases[0].steps[0].selector.resolution.selected.id = 'corrected_pay_button';
      corrected.cases[0].steps[0].selector.resolution.candidates[0].id = 'corrected_pay_button';
      corrected.cases[0].steps[1].selector = structuredClone(corrected.cases[0].steps[0].selector);
      corrected.cases[0].steps[1].selector.request.value = 'result';
      corrected.cases[0].steps[1].selector.resolution.selected.id = 'result';
      corrected.cases[0].steps[1].selector.resolution.candidates[0].id = 'result';
      assert(requireV1ForGate(corrected, { frameworkRoot }).ok);
      publish('02', corrected, row('TC-901', 'original visible result', 'corrected_pay_button'), 10);
      assert.equal(pending().length, 0, 'verifier disabled: a corrected action selector with preserved real observable assertions closes a test-owned failure');
      assert.equal(pending('b'.repeat(64)).length, 1, 'a corrected selector still needs the current HAP');
      const callsFromSteps = (trace: any): void => { trace.tool_calls = trace.cases.flatMap((test: any) => test.steps.map((step: any) => ({
        case: test.id, index: step.index, kind: step.kind, role: step.role, outcome: { status: step.outcome.status, ...(step.outcome.failure ? { failure: step.outcome.failure } : {}) },
      }))); assert(requireV1ForGate(trace, { frameworkRoot }).ok, JSON.stringify(requireV1ForGate(trace, { frameworkRoot }))); };
      const strengthened = structuredClone(corrected), absence = read(path.join(goldens, '../../step/valid/passed-assertion-absence.json'));
      absence.index = 2; absence.selector.request.value = 'busy_overlay'; strengthened.cases[0].steps.push(absence); callsFromSteps(strengthened);
      const strengthenedPlan = row('TC-901', 'original visible result', 'corrected_pay_button').replace('{"wait_for":{"by_id":"result"}}',
        '{"wait_for":{"by_id":"result"}} ; {"wait_gone":{"by_id":"busy_overlay"}}');
      const onlyExtra = structuredClone(corrected); onlyExtra.cases[0].steps[1] = { ...structuredClone(absence), index: 1 }; callsFromSteps(onlyExtra);
      const aliasFailure = structuredClone(failure), aliasSuccess = structuredClone(corrected);
      aliasFailure.cases[0].steps = [{ ...structuredClone(corrected.cases[0].steps[1]), index: 0 }, { ...structuredClone(failure.cases[0].steps[0]), index: 1 }];
      aliasSuccess.cases[0].steps = [{ ...structuredClone(corrected.cases[0].steps[1]), index: 0 }, { ...structuredClone(corrected.cases[0].steps[0]), index: 1 }];
      aliasSuccess.cases[0].steps[0].selector.request = { kind: 'by_text', value: 'result label', match: 'exact', constraints: {} };
      callsFromSteps(aliasFailure); callsFromSteps(aliasSuccess);
      const aliasBefore = row('TC-18').replace('{"touch":{"by_id":"pay_button"}} ; {"wait_for":{"by_id":"result"}}',
        '{"wait_for":{"by_id":"result"}} ; {"touch":{"by_id":"pay_button"}}');
      const aliasAfter = row('TC-901').replace('{"touch":{"by_id":"pay_button"}} ; {"wait_for":{"by_id":"result"}}',
        '{"wait_for":{"by_text":"result label","match":"exact"}} ; {"touch":{"by_id":"corrected_pay_button"}}');
      for (const verifierState of ['disabled', 'malformed']) {
        write(path.join(reports, 'summary.json'), JSON.stringify({ verifier_plan: { mode: verifierState === 'disabled' ? 'disabled' : 'enabled' } }));
        if (verifierState === 'malformed') {
          const bad = publishFixtureVerifierEvidence({ projectRoot: root, feature: manifest.feature, phase: 'testing', reportsDir: reports });
          write(bad.mdPath, '# Current independent reply without a terminal result block\n');
          const loaded = require('../../scripts/utils/verifier-evidence').loadVerifierEvidence(root, manifest.feature, 'testing', { frameworkRoot });
          assert(!loaded.ok && loaded.code === 'block_unparseable');
        }
        publish('01', failure, row('TC-18'), 5);
        publish('02', strengthened, strengthenedPlan, 10);
        assert.equal(pending().length, 0, `${verifierState}: all original predicates retained and passed plus an additional real assertion closes`);
        assert.equal(pending('b'.repeat(64)).length, 1, `${verifierState}: stronger assertions on an old HAP do not close`);
        publish('02', onlyExtra, strengthenedPlan.replace('{"wait_for":{"by_id":"result"}} ; ', ''), 10);
        assert.equal(pending().length, 1, `${verifierState}: deleting the old assertion and keeping only a new assertion is unsafe`);
        publish('01', aliasFailure, aliasBefore, 5); publish('02', aliasSuccess, aliasAfter, 10);
        assert.equal(pending().length, 0, `${verifierState}: a selector alias closes only when both native observations uniquely identify the same object and predicate`);
        const otherObject = structuredClone(aliasSuccess);
        otherObject.cases[0].steps[0].selector.resolution.selected.id = 'other_result';
        otherObject.cases[0].steps[0].selector.resolution.candidates[0].id = 'other_result'; callsFromSteps(otherObject);
        publish('02', otherObject, aliasAfter, 10);
        assert.equal(pending().length, 1, `${verifierState}: the same selector text resolving to a different real object cannot close`);
        const unresolved = structuredClone(aliasFailure); unresolved.cases[0].steps[0].selector = null; callsFromSteps(unresolved);
        publish('01', unresolved, aliasBefore, 5); publish('02', aliasSuccess, aliasAfter, 10);
        assert.equal(pending().length, 1, `${verifierState}: an unresolved old object cannot be replaced by an asserted alias identity`);
        const weakened = structuredClone(aliasSuccess); weakened.cases[0].steps[0] = { ...structuredClone(absence), index: 0 };
        weakened.cases[0].steps[0].selector.request.value = 'result'; callsFromSteps(weakened);
        publish('01', aliasFailure, aliasBefore, 5); publish('02', weakened, aliasAfter.replace('{"wait_for":{"by_text":"result label","match":"exact"}}', '{"wait_gone":{"by_id":"result"}}'), 10);
        assert.equal(pending().length, 1, `${verifierState}: changing the original presence predicate to absence does not close`);
      }
      write(path.join(reports, 'summary.json'), JSON.stringify({ verifier_plan: { mode: 'disabled' } }));
      const indexedSuccess = structuredClone(corrected), indexedFailure = structuredClone(corrected);
      const indexedRequest = { kind: 'composite', value: 'result label', match: 'exact', constraints: { primary: 'by_text', index: 0 } };
      indexedSuccess.cases[0].steps[1].selector.request = indexedRequest;
      const failedIndex = read(path.join(goldens, '../../step/valid/failed-selector-not-found.json'));
      Object.assign(indexedFailure, { outcome: 'failed' });
      Object.assign(indexedFailure.cases[0], { status: '失败', execution: 'aborted', verification: 'failed' });
      Object.assign(indexedFailure.cases[0].steps[1], {
        outcome: { status: failedIndex.outcome.status, failure: failedIndex.outcome.failure }, artifacts: failedIndex.artifacts,
        diagnostic: 'index 1 out of range for 1 hit(s)', selector: { request: { ...indexedRequest, constraints: { ...indexedRequest.constraints, index: 1 } },
          resolution: { state: 'not_found', candidate_count: 0, selected: null, candidates: [] } } });
      callsFromSteps(indexedFailure); callsFromSteps(indexedSuccess);
      const indexedPlan = (id: string, index: number) => row(id, 'original visible result', 'corrected_pay_button')
        .replace('{"wait_for":{"by_id":"result"}}', `{"wait_for":{"by_text":"result label","match":"exact","index":${index}}}`);
      publish('01', prepare(indexedFailure, 'TC-18'), indexedPlan('TC-18', 1), 5);
      publish('02', indexedSuccess, indexedPlan('TC-901', 0), 10);
      assert.equal(pending().length, 1, 'an old diagnostic hit count cannot identify the missing original selector target');
      publish('01', failure, row('TC-18'), 5);
      publish('02', corrected, row('TC-901', 'original visible result', 'corrected_pay_button').replace('"by_id":"result"', '"by_id":"weaker_result"'), 10);
      assert.equal(pending().length, 1, 'unchanged expected prose cannot hide a weakened executable assertion');
      publish('02', success, '# Plan\n## 测试用例\n', 10);
      assert.equal(pending().length, 1, 'deleting or merely declaring a new layer cannot close the original failure');
      const skipped = prepare(read(path.join(goldens, 'expected-disabled.json')), 'TC-901');
      publish('02', skipped, row('TC-901'), 10);
      assert.equal(pending().length, 1, 'an inconclusive or skipped execution is not a passed behavior');
      const record = path.join(reports, '02/hylyre/execution-key.json'), foreign = read(record);
      foreign.goal_invocation = { run_id: 'another-request', phase: 'work-unit-author', attempt_id: 'i1' };
      publish('02', success, row('TC-901'), 10); write(record, JSON.stringify({ ...read(record), goal_invocation: foreign.goal_invocation }));
      assert.equal(pending().length, 1, 'another request cannot clear the current original finding');
      const productFailure = prepare(structuredClone(corrected), 'TC-19');
      productFailure.outcome = 'failed';
      Object.assign(productFailure.cases[0], { status: '失败', execution: 'aborted', verification: 'failed' });
      const failedAssertion = read(path.join(goldens, '../../step/valid/failed-assertion-mismatch-presence.json'));
      Object.assign(productFailure.cases[0].steps[1], { outcome: failedAssertion.outcome, artifacts: failedAssertion.artifacts });
      productFailure.tool_calls[1].outcome = { status: 'failed', failure: failedAssertion.outcome.failure };
      assert(requireV1ForGate(productFailure, { frameworkRoot }).ok, JSON.stringify(requireV1ForGate(productFailure, { frameworkRoot })));
      publish('01', productFailure, row('TC-19', 'original visible result', 'corrected_pay_button'), 5);
      publish('02', corrected, row('TC-901', 'original visible result', 'corrected_pay_button'), 10);
      assert.equal(pending().length, 0, 'product failure closes on the original trigger and actual equivalent current-build success');
      publish('02', corrected, row('TC-901', 'original visible result', 'other_action'), 10);
      assert.equal(pending().length, 1, 'TC-19 product failure cannot borrow the test-owned action repair exception');
      publish('02', corrected, row('TC-901', 'weakened visible result', 'corrected_pay_button'), 10);
      assert.equal(pending().length, 1, 'TC-19 same label and a changed observable expectation stay pending');
      publish('02', corrected, row('TC-901', 'original visible result', 'corrected_pay_button').replace('original precondition', 'other precondition'), 10);
      assert.equal(pending().length, 1, 'TC-19 changed precondition stays pending');
      publish('02', corrected, row('TC-901', 'original visible result', 'corrected_pay_button'), 10);
      assert.equal(pending('b'.repeat(64)).length, 1, 'TC-19 old HAP stays pending');
      publish('02', corrected, '# Plan\n## 测试用例\n', 10);
      assert.equal(pending().length, 1, 'TC-19 deletion stays pending with verifier disabled');
      assert.deepEqual(readPendingTestingRetests({ projectRoot: root, feature: manifest.feature, frameworkRoot, currentHapSha256: hap }), [], 'no request means no guessed historical ownership');
    } finally {
      clearFrameworkConfigCache(); assert(root.startsWith(fs.realpathSync(os.tmpdir()) + path.sep)); fs.rmSync(root, { recursive: true, force: true });
    }
  } }, unitOnlyRetestCase()];
}

function unitOnlyRetestCase(): { name: string; run(): void } {
  return { name: '4c8d73b1 verifier disabled pure logic closes only with current scoped formal UT source build and exact native case proof', run() {
    const f = copyC6HostReplay(), { root, feature, featureDir } = f, frameworkRoot = path.resolve(__dirname, '../../..');
    const read = (file: string): any => JSON.parse(fs.readFileSync(file, 'utf8'));
    const hash = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
    const write = (file: string, bytes: string): void => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
    try {
      // Controlled producer inputs: the native source/assertions/logs are captured originals;
      // unit-only attribution and tiny build bytes are explicit substitutes, not a host rerun.
      const acceptanceFile = path.join(root, featureDir, 'acceptance.yaml');
      const acceptance = YAML.parse(fs.readFileSync(acceptanceFile, 'utf8'));
      acceptance.boundaries.find((item: any) => item.id === 'BD-3').ut_layer = 'unit';
      fs.writeFileSync(acceptanceFile, YAML.stringify(acceptance));
      const produced = resolveCapabilityInputs({ projectRoot: root, feature, frameworkRoot, phase: 'coding', track: 'full',
        inputContext: { schema_version: '1.1', subject: { feature }, obligations: { 'acceptance-context': 'required' }, required_outputs: [] } }).inputs!;
      const acc = produced.values.acceptance, contracts = produced.values.contracts;
      assert(acc.state === 'resolved' && contracts.state === 'resolved');
      const manifest = read(path.join(root, featureDir, 'goal-runs', f.runId, 'manifest.json'));
      manifest.run_id = '20261024T190000Z-unit'; manifest.created_at = '2026-10-24T19:00:00.000Z';
      manifest.report_dir = `${featureDir}/goal-runs/${manifest.run_id}`; manifest.requirement = 'controlled scoped logical rollback retest';
      for (const obligation of manifest.execution_scope.obligations) for (const key of ['basis', 'satisfied_by']) {
        if (obligation[key]) obligation[key] = obligation[key].map((binding: any) => binding.input_id === 'acceptance' ? acc.binding : binding.input_id === 'contracts' ? contracts.binding : binding);
      }
      createGoalRun({ projectRoot: root, frameworkRoot, manifest, chain: manifest.phase_chain, resolveHead: () => 'a'.repeat(40),
        continuation: { kind: 'fresh', explicit: false, reason: 'controlled regression birth' } as any });
      const scope = resolveEffectiveScopeSource(root, feature, manifest.run_id)!.scope;
      assert.equal(readScopeAcceptance(root, { facts: scope.obligations }, { feature, frameworkRoot })!.value.boundaries!.find(item => item.id === 'BD-3')!.ut_layer, 'unit');
      const reports = path.join(root, featureDir, 'testing/reports'), failureDir = path.join(reports, '01/hylyre');
      const failure = read(path.join(frameworkRoot, 'profiles/hmos-app/vendor/hylyre/src/hylyre/contracts/golden/trace/valid/capture-unavailable-evidence-incomplete.json'));
      failure.feature = feature; failure.cases[0].id = 'TC-18'; failure.cases[0].ac_ref = 'BD-3';
      for (const call of failure.tool_calls) call.case = 'TC-18';
      assert(requireV1ForGate(failure, { frameworkRoot }).ok);
      const plan = '# Plan\n## 测试用例\n| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC |\n|---|---|---|---|---|---|---|\n'
        + '| TC-18 | save rollback | failed insert | {"touch":{"by_id":"test_driver"}} ; {"wait_for":{"by_id":"rollback"}} | no half write | P0 | BD-3 |\n';
      const tracePath = path.join(failureDir, 'trace.json'), traceBytes = JSON.stringify(failure);
      write(tracePath, traceBytes); write(path.join(failureDir, 'test-plan.hylyre.md'), plan);
      const failureInputs = { hap_sha256_full: 'a'.repeat(64), derived_plan_sha256: hash(plan), profile: 'hmos-app', device: 'isolated-test',
        display_env: '', reset_mode: 'warm', hylyre_version: null, manifest_version: null, tool_config_sha256: '', flags: [] };
      write(path.join(failureDir, 'execution-key.json'), JSON.stringify({ schema_version: '1.0', execution_key: computeExecutionKey(failureInputs),
        run_started_at: '2026-10-24T19:00:05.000Z', trace_path: tracePath, trace_sha256: hash(traceBytes), outcome: 'failed', inputs: failureInputs }));
      write(path.join(reports, 'summary.json'), JSON.stringify({ verifier_plan: { mode: 'disabled' } }));
      const utReports = path.join(root, featureDir, 'ut/reports'), nativeDir = path.join(utReports, '20261024T192859Z-969/ut');
      const keyFile = path.join(nativeDir, 'execution-key.json'), key = read(keyFile), modules = utExecutionModules(key);
      const contractValue = contracts.value as import('../../scripts/utils/types').ContractsSpec;
      const hapFiles = modules.sort().map(module => {
        const owner = contractValue.modules!.find(item => item.name === module)!;
        const prefix = path.join(root, owner.package_path, 'build/default/outputs/ohosTest', `${module}-ohosTest`);
        write(prefix + '-unsigned.hap', 'controlled build'); write(prefix + '-signed.hap', 'controlled signed build');
        return prefix + '-signed.hap';
      });
      key.inputs.hap_sha256_full = sha256Text(modules.map((module, i) => `${module}=${hash(fs.readFileSync(hapFiles[i]))}`).join('\n'));
      Object.assign(key.inputs, currentUtExecutionInputs(root, modules)); key.execution_key = computeExecutionKey(key.inputs);
      key.goal_invocation = { run_id: manifest.run_id, phase: 'business-ut', attempt_id: 'controlled-i1' }; write(keyFile, JSON.stringify(key));
      const formalFile = path.join(utReports, 'script-report.json'), formal = read(formalFile);
      const passed = modules.flatMap(module => parseHypiumStdout(fs.readFileSync(path.join(nativeDir, `frozen.hdc-test.${module}.log`), 'utf8'))!.passed_tests ?? []);
      const coverage = read(path.join(utReports, 'coverage-evidence.json'));
      const tests = [...new Set<string>(coverage.mappings.map((mapping: any) => mapping.evidence_ref))];
      const candidates = tests.flatMap(file => extractUtItBlocks(fs.readFileSync(path.join(root, file), 'utf8')).map(test => ({ path: file, test: test.name })));
      formal.checks.push(...executedUtChecks(root, candidates, passed)); write(formalFile, JSON.stringify(formal));
      const evidence = loadPhaseEvidenceManifest(root, feature, 'ut')!.manifest;
      for (const file of [...acc.binding.source_refs, ...contracts.binding.source_refs]) {
        let entry = evidence.inputs.find(entry => entry.path === file);
        if (!entry) { entry = { path: file, role: 'input', exists: true, sha256: null }; evidence.inputs.push(entry); }
        entry.sha256 = currentEvidenceEntryHash(root, entry, feature);
        assert(entry.sha256, `controlled formal input unavailable: ${file}`);
      }
      const reportEntry = evidence.outputs.find(entry => entry.path === path.relative(root, formalFile).replace(/\\/g, '/'))!;
      reportEntry.sha256 = hash(fs.readFileSync(formalFile)); evidence.aggregate_sha256 = recomputeManifestAggregate(evidence); writePhaseEvidenceManifest(root, evidence);
      const pending = () => readPendingTestingRetests({ projectRoot: root, feature, frameworkRoot, runId: manifest.run_id, currentHapSha256: null });
      assert.equal(pending().length, 0, 'real native tagged case, formal producer file#name, current scope/source/build together close pure logic without verifier or UI HAP');
      const savedHap = fs.readFileSync(hapFiles[0]); fs.appendFileSync(hapFiles[0], 'other build');
      assert.equal(pending().length, 1, 'same-file next call must reject a different current test HAP'); fs.writeFileSync(hapFiles[0], savedHap);
      const source = path.join(root, '02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets'), savedSource = fs.readFileSync(source);
      fs.appendFileSync(source, '\n// current logic changed\n'); assert.equal(pending().length, 1, 'old native success cannot certify changed production code'); fs.writeFileSync(source, savedSource);
      const testFile = path.join(root, tests[0]), savedTest = fs.readFileSync(testFile);
      fs.appendFileSync(testFile, '\n// assertions changed\n'); assert.equal(pending().length, 1, 'old native success cannot certify changed assertions'); fs.writeFileSync(testFile, savedTest);
      const savedKey = fs.readFileSync(keyFile); key.goal_invocation.run_id = 'other-request'; write(keyFile, JSON.stringify(key));
      assert.equal(pending().length, 1, 'foreign request cannot satisfy this request'); fs.writeFileSync(keyFile, savedKey);
      const configFile = path.join(root, 'hvigor/hvigor-config.json5'), savedConfig = fs.readFileSync(configFile);
      fs.appendFileSync(configFile, '\n// current build config changed\n'); assert.equal(pending().length, 1, 'old tool/config execution key cannot certify a current build'); fs.writeFileSync(configFile, savedConfig);
      const logFile = path.join(nativeDir, 'frozen.hdc-test.WalletMain.log'), savedLog = fs.readFileSync(logFile);
      fs.writeFileSync(logFile, savedLog.toString('utf8').replace(/\[BD-3\]/g, '[BD-30]'));
      assert.equal(pending().length, 1, 'a single matching label or formal report PASS cannot replace the exact native observed test'); fs.writeFileSync(logFile, savedLog);
      const formalBytes = fs.readFileSync(formalFile);
      const bindFormal = (): void => { reportEntry.sha256 = hash(fs.readFileSync(formalFile)); evidence.aggregate_sha256 = recomputeManifestAggregate(evidence); writePhaseEvidenceManifest(root, evidence); };
      write(formalFile, JSON.stringify({ ...formal, checks: formal.checks.filter((check: any) => !candidates.some(candidate => candidate.test === check.id)) })); bindFormal();
      assert.equal(pending().length, 1, 'a current formal round PASS without producer file#name observations is not a per-case proof'); fs.writeFileSync(formalFile, formalBytes); bindFormal();
      key.goal_invocation.run_id = manifest.run_id; key.run_started_at = '2026-10-24T19:00:04.000Z'; write(keyFile, JSON.stringify(key));
      assert.equal(pending().length, 1, 'UT before the original failure is not a new retest'); fs.writeFileSync(keyFile, savedKey);
      const failureRecordFile = path.join(failureDir, 'execution-key.json'), failureRecord = read(failureRecordFile);
      write(path.join(failureDir, 'test-plan.hylyre.md'), plan.replace('P0 | BD-3', 'P0 | BD-3, AC-4'));
      const mixedInputs = { ...failureRecord.inputs, derived_plan_sha256: hash(plan.replace('P0 | BD-3', 'P0 | BD-3, AC-4')) };
      write(failureRecordFile, JSON.stringify({ ...failureRecord, inputs: mixedInputs, execution_key: computeExecutionKey(mixedInputs) }));
      assert.equal(pending().length, 1, 'mixed device/both requirements cannot be reclassified as pure unit by one matching BD');
      write(path.join(failureDir, 'test-plan.hylyre.md'), plan); write(failureRecordFile, JSON.stringify(failureRecord));
      assert.equal(pending().length, 0, 'later calls observe restored current evidence rather than a cross-call negative cache');
      const product = structuredClone(failure), goldenDir = path.join(frameworkRoot, 'profiles/hmos-app/vendor/hylyre/src/hylyre/contracts/golden');
      product.cases[0].id = 'TC-19'; product.cases[0].execution = 'aborted'; product.cases[0].evidence = 'complete';
      product.cases[0].steps = [read(path.join(goldenDir, 'trace/valid/all-passed.json')).cases[0].steps[0], read(path.join(goldenDir, 'step/valid/failed-assertion-mismatch-presence.json'))];
      product.cases[0].steps[1].index = 1;
      product.tool_calls = product.cases[0].steps.map((step: any) => ({ case: 'TC-19', index: step.index, kind: step.kind, role: step.role,
        outcome: { status: step.outcome.status, ...(step.outcome.failure ? { failure: step.outcome.failure } : {}) } }));
      assert(requireV1ForGate(product, { frameworkRoot }).ok);
      const productBytes = JSON.stringify(product), productPlan = plan.replace(/TC-18/g, 'TC-19');
      write(tracePath, productBytes); write(path.join(failureDir, 'test-plan.hylyre.md'), productPlan);
      const productInputs = { ...failureRecord.inputs, derived_plan_sha256: hash(productPlan) };
      write(failureRecordFile, JSON.stringify({ ...failureRecord, trace_sha256: hash(productBytes), inputs: productInputs, execution_key: computeExecutionKey(productInputs) }));
      assert.equal(pending().length, 1, 'a product/UI failure is not closed by a unit-only label plus otherwise valid UT evidence');
      assert.equal(pending()[0].route.codingCandidate, true);
    } finally { clearFrameworkConfigCache(); assert(root.startsWith(fs.realpathSync(os.tmpdir()) + path.sep)); fs.rmSync(root, { recursive: true, force: true }); }
  } };
}
