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
      const correctedTouch = '{"touch":{"by_text":"Pay","match":"exact"}}';
      const correctedRow = (id: string, expected?: string): string => row(id, expected)
        .replace('{"touch":{"by_id":"pay_button"}}', correctedTouch);
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
      corrected.cases[0].steps[0].selector.request = { kind: 'by_text', value: 'Pay', match: 'exact', constraints: {} };
      corrected.cases[0].steps[1].selector = structuredClone(corrected.cases[0].steps[0].selector);
      corrected.cases[0].steps[1].selector.request = { kind: 'by_id', value: 'result', match: null, constraints: {} };
      corrected.cases[0].steps[1].selector.resolution.selected.id = 'result';
      corrected.cases[0].steps[1].selector.resolution.candidates[0].id = 'result';
      assert(requireV1ForGate(corrected, { frameworkRoot }).ok);
      publish('02', corrected, correctedRow('TC-901'), 10);
      assert.equal(pending().length, 0, 'verifier disabled: the native alias uniquely resolved the old literal target and preserved its real assertions');
      assert.equal(pending('b'.repeat(64)).length, 1, 'a corrected selector still needs the current HAP');
      const switchedActionTarget = structuredClone(corrected);
      switchedActionTarget.cases[0].steps[0].selector.resolution.selected.id = 'other_pay_button';
      switchedActionTarget.cases[0].steps[0].selector.resolution.candidates[0].id = 'other_pay_button';
      assert(requireV1ForGate(switchedActionTarget, { frameworkRoot }).ok);
      publish('02', switchedActionTarget, correctedRow('TC-901'), 10);
      assert.equal(pending().length, 1, 'the same new alias and same assertions cannot close when native resolution switched target');
      const callsFromSteps = (trace: any): void => { trace.tool_calls = trace.cases.flatMap((test: any) => test.steps.map((step: any) => ({
        case: test.id, index: step.index, kind: step.kind, role: step.role, outcome: { status: step.outcome.status, ...(step.outcome.failure ? { failure: step.outcome.failure } : {}) },
      }))); assert(requireV1ForGate(trace, { frameworkRoot }).ok, JSON.stringify(requireV1ForGate(trace, { frameworkRoot }))); };
      const strengthened = structuredClone(corrected), absence = read(path.join(goldens, '../../step/valid/passed-assertion-absence.json'));
      absence.index = 2; absence.selector.request.value = 'busy_overlay'; strengthened.cases[0].steps.push(absence); callsFromSteps(strengthened);
      const strengthenedPlan = correctedRow('TC-901').replace('{"wait_for":{"by_id":"result"}}',
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
        '{"wait_for":{"by_text":"result label","match":"exact"}} ; ' + correctedTouch);
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
      const indexedPlan = (id: string, index: number) => correctedRow(id)
        .replace('{"wait_for":{"by_id":"result"}}', `{"wait_for":{"by_text":"result label","match":"exact","index":${index}}}`);
      publish('01', prepare(indexedFailure, 'TC-18'), indexedPlan('TC-18', 1), 5);
      publish('02', indexedSuccess, indexedPlan('TC-901', 0), 10);
      assert.equal(pending().length, 1, 'an old diagnostic hit count cannot identify the missing original selector target');
      publish('01', failure, row('TC-18'), 5);
      publish('02', corrected, correctedRow('TC-901').replace('"by_id":"result"', '"by_id":"weaker_result"'), 10);
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
      publish('01', productFailure, correctedRow('TC-19'), 5);
      publish('02', corrected, correctedRow('TC-901'), 10);
      assert.equal(pending().length, 0, 'product failure closes on the original trigger and actual equivalent current-build success');
      publish('02', corrected, row('TC-901', 'original visible result', 'other_action'), 10);
      assert.equal(pending().length, 1, 'TC-19 product failure cannot borrow the test-owned action repair exception');
      publish('02', corrected, correctedRow('TC-901', 'weakened visible result'), 10);
      assert.equal(pending().length, 1, 'TC-19 same label and a changed observable expectation stay pending');
      publish('02', corrected, correctedRow('TC-901').replace('original precondition', 'other precondition'), 10);
      assert.equal(pending().length, 1, 'TC-19 changed precondition stays pending');
      publish('02', corrected, correctedRow('TC-901'), 10);
      assert.equal(pending('b'.repeat(64)).length, 1, 'TC-19 old HAP stays pending');
      publish('02', corrected, '# Plan\n## 测试用例\n', 10);
      assert.equal(pending().length, 1, 'TC-19 deletion stays pending with verifier disabled');
      assert.deepEqual(readPendingTestingRetests({ projectRoot: root, feature: manifest.feature, frameworkRoot, currentHapSha256: hap }), [], 'no request means no guessed historical ownership');
    } finally {
      clearFrameworkConfigCache(); assert(root.startsWith(fs.realpathSync(os.tmpdir()) + path.sep)); fs.rmSync(root, { recursive: true, force: true });
    }
  } }];
}
