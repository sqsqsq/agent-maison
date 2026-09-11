import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { stableStringify, loadPhaseEvidenceManifest } from '../../scripts/utils/phase-evidence-manifest';
import { setupGoalRuntimeHost, runGoalRuntimeChain } from './goal-runner-testing-integrity.unit.test';
import { clearFrameworkConfigCache, featureFilePath } from '../../config';
import { deriveChangeUnitFeatureId, loadCanonicalChangeUnit, asChangeUnitArtifact } from '../../scripts/utils/change-unit-path';
import { observeChangeUnitCompletion } from '../../scripts/utils/change-unit-completion';
import { verifyFeatureCompletion, verifyReusedExecutionScope, executionScopeEvidenceIssues } from '../../scripts/utils/verify-feature-completion';
import { loadFrozenExecutionScope } from '../../scripts/utils/goal-run-creation';
import { codingBasePath } from '../../scripts/utils/pass-snapshot';
import * as os from 'os';
import type { AcceptanceSpec } from '../../scripts/utils/types';
import { resolveExecutionScope, validateExecutionScope, type ExecutionScopeInput } from '../../scripts/utils/execution-scope';
import type { WorkflowSpec } from '../../workflow-loader';
import type { UnitCaseResult } from '../run-unit';

const workflow: WorkflowSpec = {
  schema_version: '1.2', name: 'scoped', auto_chain: ['spec', 'plan', 'coding', 'review', 'ut', 'testing'],
  artifacts: ['spec', 'plan', 'coding', 'review', 'ut', 'testing'].map(id => ({ id, scope: 'feature', requires: [], obligation_provider_id: `obligations.${id}` })),
};
function request(phases: string[], completion_target: 'request' | 'feature' = 'request'): ExecutionScopeInput {
  return { request: { completion_target, requested_results: ['requested-result'], requested_phases: phases }, facts: [], contract_fingerprints: [] };
}
const cases: Array<{ name: string; run(): void | Promise<void> }> = [
  { name: 'fully reused request verifies existing bindings without an empty run; stale data is rejected', run() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-reuse-'));
    try {
      const file = path.join(root, 'contracts.yaml'); fs.writeFileSync(file, 'files: []');
      const hash = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      const binding = { input_id: 'contracts', source: { kind: 'artifact' as const, artifact: 'contracts@1' }, source_refs: ['contracts.yaml'], content_fingerprint: hash, dependencies: [{ path: file, exists: true, sha256: hash, role: 'artifact' as const }] };
      const input = request(['plan']); input.facts.push({ id: 'design:existing', kind: 'design-context', applicability: 'required', reason: 'existing design answers requested result', basis: [binding], satisfied_by: [binding] });
      const scope = resolveExecutionScope(input, workflow); assert.deepStrictEqual(scope.phase_chain, []);
      assert(verifyReusedExecutionScope(root, 'demo', scope).complete); assert(!fs.existsSync(path.join(root, 'doc')));
      fs.writeFileSync(file, 'files: [changed]'); assert(!verifyReusedExecutionScope(root, 'demo', scope).complete);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  } },
  { name: 'real control dependencies remain ordered and cannot be replaced by information alone', run() {
    const binding = { input_id: 'control', source: { kind: 'artifact' as const, artifact: 'contracts@1' }, dependencies: [], source_refs: ['contracts.yaml'], content_fingerprint: 'a'.repeat(64) };
    const input = request(['coding', 'plan']); input.control_edges = [{ before: 'plan', after: 'coding', basis: [binding] }];
    const scope = resolveExecutionScope(input, workflow); assert.deepStrictEqual(scope.phase_chain, ['plan', 'coding']);
    assert.throws(() => validateExecutionScope({ ...scope, phase_chain: ['coding', 'plan'] }), /控制顺序/);
    input.request.requested_phases = ['coding']; assert.throws(() => resolveExecutionScope(input, workflow), /控制前置/);
  } },
  { name: 'acceptance layers use the existing gate; invalid layers remain unknown and implementation requires review', run() {
    const binding = { input_id: 'acceptance', source: { kind: 'artifact' as const, artifact: 'acceptance@1' }, dependencies: [], source_refs: ['acceptance.yaml'], content_fingerprint: 'a'.repeat(64) };
    const build = (layer: string) => resolveExecutionScope(request(['coding'], 'feature'), workflow, { value: { criteria: [{ id: 'AC-1', priority: 'P1', ut_layer: layer }] } as AcceptanceSpec, binding });
    assert.deepStrictEqual(build('unit').phase_chain, ['coding', 'review', 'ut']);
    assert.deepStrictEqual(build('device').phase_chain, ['coding', 'review', 'testing']);
    const invalid = build('invalid'); assert(!invalid.phase_chain.includes('testing')); assert(invalid.unresolved.length);
  } },
  { name: 'explicit UT request neither expands phases nor claims Feature completion', run() {
    const scope = resolveExecutionScope(request(['ut']), workflow);
    assert.deepStrictEqual(scope.phase_chain, ['ut']); assert.equal(scope.completion_target, 'request');
  } },
  { name: 'acceptance is review context, explicit verification stays bounded, and missing Feature evidence remains unknown', run() {
    const binding = { input_id: 'acceptance', source: { kind: 'artifact' as const, artifact: 'acceptance@1' }, dependencies: [], source_refs: ['acceptance.yaml'], content_fingerprint: 'a'.repeat(64) };
    for (const ut_layer of ['unit', 'both']) {
      const acceptance = { value: { criteria: [{ id: 'AC-1', priority: 'P1', ut_layer }] } as AcceptanceSpec, binding };
      assert.deepStrictEqual(resolveExecutionScope(request(['review']), workflow, acceptance).phase_chain, ['review']);
      assert.deepStrictEqual(resolveExecutionScope(request(['ut']), workflow, acceptance).phase_chain, ['ut']);
      assert.deepStrictEqual(resolveExecutionScope(request(['testing']), workflow, acceptance).phase_chain, ['testing']);
    }
    const scope = resolveExecutionScope(request(['coding'], 'feature'), workflow);
    assert.deepStrictEqual(scope.unresolved.map(gap => gap.obligation_id).sort(), ['device-evidence:pending', 'unit-evidence:pending']);
    assert.equal(executionScopeEvidenceIssues('.', 'demo', scope).length, 2);
    assert.deepStrictEqual(scope.phase_chain, ['coding', 'review']);
    assert.equal(resolveExecutionScope(request(['review']), workflow).unresolved.length, 0);
  } },
  { name: 'empty performance is absent; real undecided performance retains unknown', run() {
    const binding = { input_id: 'acceptance', source: { kind: 'artifact' as const, artifact: 'acceptance@1' }, dependencies: [], source_refs: ['acceptance.yaml'], content_fingerprint: 'a'.repeat(64) };
    const value = { criteria: [{ id: 'AC-1', priority: 'P1', ut_layer: 'unit' }] } as AcceptanceSpec;
    const resolve = (acceptance: AcceptanceSpec) => resolveExecutionScope(request(['coding'], 'feature'), workflow, { value: acceptance, binding });
    assert.deepStrictEqual(resolve(value), resolve({ ...value, performance: [] }));
    assert(resolve({ ...value, performance: [{ id: 'NFR-1', metric: 'latency', threshold: '100', unit: 'ms', description: 'response latency' }] }).unresolved.some(gap => gap.obligation_id === 'device-evidence:acceptance'));
  } },
  { name: 'same normalized input produces identical range and reasons', run() {
    const input = request(['coding', 'review', 'ut'], 'feature');
    assert.deepStrictEqual(resolveExecutionScope(input, workflow), resolveExecutionScope(structuredClone(input), structuredClone(workflow)));
    assert.deepStrictEqual(resolveExecutionScope(input, workflow).phase_chain, ['coding', 'review', 'ut']);
  } },
  { name: 'unknown downstream obligation does not stop safe spec investigation or become completion', run() {
    const input = request(['spec']);
    input.facts.push({ id: 'device:pending', kind: 'device-evidence', applicability: 'unknown', reason: 'acceptance not yet known', basis: [] });
    const scope = resolveExecutionScope(input, workflow);
    assert.deepStrictEqual(scope.phase_chain, ['spec']); assert.equal(scope.unresolved.length, 1);
    assert.throws(() => validateExecutionScope({ ...scope, unresolved: [] }), /未知义务被删除/);
  } },
  { name: 'new custom phase without registered rule fails instead of disappearing', run() {
    const custom: WorkflowSpec = { ...workflow, artifacts: [...workflow.artifacts, { id: 'custom', scope: 'feature', requires: [] }] };
    assert.throws(() => resolveExecutionScope(request(['ut']), custom), /缺少已注册义务/);
  } },
  { name: 'failure observations do not change scope', run() {
    const input = request(['testing']);
    const expected = resolveExecutionScope(input, workflow);
    for (const verdict of ['FAIL', 'offline', 'manual', 'report_failed']) assert.deepStrictEqual(resolveExecutionScope({ ...input, verdict } as ExecutionScopeInput, workflow), expected);
  } },
  { name: 'corrupt new scope cannot become legacy full', run() {
    for (const value of [null, {}, { schema_version: '9' }]) assert.throws(() => validateExecutionScope(value));
  } },
];
async function runScopeScenario(mode: 'direct' | 'successor' | 'intent' | 'released' | 'born' | 'design-gap' | 'detached' | 'detached-harness' | 'detached-explicit' | 'request-ut' | 'testing-fail' | 'unresolved'): Promise<void> {
  const repo = path.resolve(__dirname, '../../..');
  const { root } = setupGoalRuntimeHost('codex');
  const frameworkRoot = path.join(root, 'framework');
  try {
    for (const dir of ['harness', 'profiles', 'agents', 'skills', 'specs', 'templates', 'docs']) fs.symlinkSync(path.join(repo, dir), path.join(frameworkRoot, dir), process.platform === 'win32' ? 'junction' : 'dir');
    fs.copyFileSync(path.join(repo, 'package.json'), path.join(frameworkRoot, 'package.json'));
    fs.copyFileSync(path.join(repo, 'workflows/spec-driven.workflow.yaml'), path.join(frameworkRoot, 'workflows/spec-driven.workflow.yaml'));
    const source = YAML.parse(fs.readFileSync(path.join(repo, 'workflows/spec-driven.workflow.yaml'), 'utf8'));
    source.schema_version = '1.2'; delete source.auto_chain_by_track;
    source.artifacts = source.artifacts.filter((a: { id: string }) => !['change', 'exit'].includes(a.id));
    for (const artifact of source.artifacts) { delete artifact.tracks; delete artifact.requires_by_track; artifact.obligation_provider_id = artifact.scope === 'global' ? 'obligations.project' : `obligations.${artifact.id}`; }
    fs.writeFileSync(path.join(frameworkRoot, 'workflows/scoped.workflow.yaml'), YAML.stringify(source));
    const configPath = path.join(root, 'framework.config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8')); config.active_workflow = 'scoped';
    fs.writeFileSync(configPath, JSON.stringify(config)); clearFrameworkConfigCache();
    const fixture = path.join(repo, 'harness/tests/fixtures/component-blueprint/valid');
    fs.cpSync(path.join(fixture, 'doc/features/ledger-app-blueprint'), path.join(root, 'doc/features/ledger-app-blueprint'), { recursive: true });
    const feature = deriveChangeUnitFeatureId('ledger-app-blueprint', 'ledger-refresh');
    if (mode === 'direct') {
      fs.rmSync(featureFilePath(root, feature, 'spec/spec.md'), { force: true });
      fs.rmSync(featureFilePath(root, feature, 'plan/plan.md'), { force: true });
    }
    const input = request(mode === 'request-ut' ? ['ut'] : mode === 'testing-fail' ? ['testing'] : ['direct', 'design-gap'].includes(mode) ? ['coding', 'review', 'ut'] : ['spec'], mode === 'request-ut' ? 'request' : 'feature');
    const contractsFile = featureFilePath(root, feature, 'contracts.yaml');
    const binding = { input_id: 'contracts', source: { kind: 'artifact' as const, artifact: 'contracts@1' }, source_refs: [path.relative(root, contractsFile)], dependencies: [{ path: contractsFile, exists: true, sha256: createHash('sha256').update(fs.readFileSync(contractsFile)).digest('hex'), role: 'artifact' as const }], content_fingerprint: createHash('sha256').update(stableStringify(YAML.parse(fs.readFileSync(contractsFile, 'utf8')))).digest('hex') };
    input.facts.push({ id: 'design:cu', kind: 'design-context', applicability: 'required', reason: 'existing admitted CU construction projection', basis: [binding], satisfied_by: [binding] });
    const codeFile = path.join(root, '02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets');
    if (mode === 'direct') {
      const code = { ...binding, input_id: 'code', source: { kind: 'derive' as const, provider_id: 'derive.codebase' as const }, dependencies: [{ path: codeFile, exists: true, sha256: createHash('sha256').update(fs.readFileSync(codeFile)).digest('hex'), role: 'derive' as const }] };
      input.facts.push({ id: 'implementation:source', kind: 'implementation', applicability: 'required', reason: 'authorized source edit', basis: [code] });
    }
    if (['direct', 'design-gap'].includes(mode)) input.facts.push({ id: 'device:impact', kind: 'device-evidence', applicability: 'not_applicable', reason: 'fixture impact requires unit verification only', basis: [binding] });
    if (mode === 'testing-fail') input.facts.push({ id: 'unit:impact', kind: 'unit-evidence', applicability: 'not_applicable', reason: 'fixture requests device result only', basis: [binding] });
    if (!['direct', 'design-gap', 'request-ut', 'testing-fail'].includes(mode)) input.facts.push({ id: 'device:pending', kind: 'device-evidence', applicability: 'unknown', reason: 'spec will determine device acceptance', basis: [] });
    fs.writeFileSync(featureFilePath(root, feature, 'feature.yaml'), YAML.stringify({ execution_scope: input }));
    if (!mode.startsWith('detached')) {
    const cli = spawnSync(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'), path.join(repo, 'harness/scripts/goal-mode-entry.ts'), '--prepare-run', '--run-mode', 'attended', '--adapter', 'codex', '--feature', feature, '--run-id', 'p2-attended', '--requirement', 'fixture delivery', '--project-root', root, '--framework-root', frameworkRoot], { cwd: root, encoding: 'utf8', timeout: 30000, env: { ...process.env, TS_NODE_PROJECT: path.join(repo, 'harness/tsconfig.json') } });
    assert.equal(cli.status, 0, cli.stderr + cli.stdout);
    }
    if (mode === 'direct') {
      fs.writeFileSync(featureFilePath(root, feature, 'feature.yaml'), 'track: lite\nexecution_scope: {broken candidate');
      source.auto_chain = [...source.auto_chain].reverse();
      fs.writeFileSync(path.join(frameworkRoot, 'workflows/scoped.workflow.yaml'), YAML.stringify(source));
    }
    let injected = false;
    let designGap = false;
    let detachedStarted = false;
    let recoveryMarker: string | undefined;
    const execute = () => runGoalRuntimeChain(root, { frameworkRoot, featureId: feature, resume: mode.startsWith('detached') && !detachedStarted ? undefined : 'p2-attended', runId: 'p2-attended', freshStartPhase: 'spec', freshEndPhase: 'spec', skipLegacySeal: true, viaHostBridge: !mode.startsWith('detached'), viaRuntimeClass: mode.startsWith('detached'), adapter: 'codex',
      launchCwd: ['successor', 'detached-harness', 'detached-explicit'].includes(mode) ? path.join(frameworkRoot, 'harness') : root,
      launchArgs: mode === 'detached-explicit' ? ['--project-root', root, '--framework-root', frameworkRoot] : undefined,
      onCoding: () => { if (mode === 'direct') fs.appendFileSync(codeFile, '\n// authorized P2 implementation\n'); },
      onHarnessSummary: ({ phase }) => {
        if (mode === 'testing-fail') return { checks: [{ id: 'device_result_failed', category: 'structure', description: 'device evidence failed', severity: 'BLOCKER', status: 'FAIL', details: 'observed failure', suggestion: 'repair the actual failure' }] };
        if (mode !== 'design-gap' || phase !== 'coding' || designGap) return null;
        designGap = true;
        const file = path.join(root, '02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets');
        const fresh = { ...binding, input_id: 'code', source: { kind: 'derive' as const, provider_id: 'derive.codebase' as const }, source_refs: [path.relative(root, file)], dependencies: [{ path: file, exists: true, sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'), role: 'derive' as const }] };
        const revision = request(['plan', 'coding', 'review', 'ut'], 'feature');
        revision.facts.push(...input.facts, { id: 'design:new-api', kind: 'design-decision', applicability: 'required', reason: 'new public interface requires design owner', basis: [fresh] });
        return { checks: [{ id: 'scope_design_gap', category: 'structure', description: 'new design fact', severity: 'BLOCKER', status: 'FAIL', details: 'public interface decision is missing', suggestion: 'return to plan owner', scope_revision_input: revision }] };
      },
      onSpec: () => {
        fs.writeFileSync(featureFilePath(root, feature, 'acceptance.yaml'), 'criteria: [{id: AC-DEVICE, priority: P1, ut_layer: device, desc: device verification}]\n');
      },
      afterHarnessPass: ({ phase, runId }) => {
        if (phase !== 'spec' || ['direct', 'design-gap', 'unresolved'].includes(mode)) return;
        const file = featureFilePath(root, feature, 'acceptance.yaml');
        const fresh = { ...binding, source_refs: [path.relative(root, file)], content_fingerprint: createHash('sha256').update(stableStringify(YAML.parse(fs.readFileSync(file, 'utf8')))).digest('hex'), input_id: 'acceptance', source: { kind: 'artifact' as const, artifact: 'acceptance@1' }, dependencies: [{ path: file, exists: true, sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'), role: 'artifact' as const }] };
        const revision = request(['coding', 'review', 'ut', 'testing'], 'feature');
        revision.facts.push(...input.facts.filter(fact => fact.kind === 'design-context'), { id: 'device:pending', kind: 'device-evidence', applicability: 'required', reason: 'spec produced device acceptance', basis: [fresh] });
        fs.writeFileSync(featureFilePath(root, feature, 'spec/reports/script-report.json'), JSON.stringify({ checks: [{ id: 'spec_scope_facts', status: 'PASS', scope_revision_input: revision }] }));
      },
      onScopeHandoff: boundary => {
        if (boundary === 'intent' && !recoveryMarker) {
          recoveryMarker = codingBasePath(root, feature, 'p2-attended');
          fs.mkdirSync(path.dirname(recoveryMarker), { recursive: true }); fs.writeFileSync(recoveryMarker, '{}');
        }
        if (recoveryMarker && boundary !== 'intent') assert(fs.existsSync(recoveryMarker), 'source recovery state removed before successor completion');
        if (!injected && boundary === mode) { injected = true; throw new Error('injected handoff cut: ' + boundary); }
      },
    });
    let probe: Awaited<ReturnType<typeof execute>>;
    try { probe = await execute(); } catch (error) {
      if (!injected) throw error;
      probe = await execute();
    }
    if (probe.exitCode !== 0 && injected) probe = await execute();
    if (mode === 'unresolved') {
      assert.notEqual(probe.exitCode, 0);
      assert(probe.events.some(event => event.type === 'phase_halt' && event.halt_reason === 'execution_scope_unresolved'), 'unknown scope was mislabeled as framework failure');
      assert(!fs.existsSync(featureFilePath(root, feature, 'feature-completion.json')));
      return;
    }
    if (mode === 'testing-fail') {
      assert.notEqual(probe.exitCode, 0);
      assert.deepStrictEqual(loadFrozenExecutionScope(root, feature, 'p2-attended')!.phase_chain, ['testing']);
      assert(!probe.events.some(event => event.type === 'scope_revision_requested'));
      assert(!fs.existsSync(featureFilePath(root, feature, 'feature-completion.json')));
      return;
    }
    assert.equal(probe.exitCode, 0, JSON.stringify(probe.events.slice(-5)));
    if (mode === 'request-ut') {
      assert.deepStrictEqual(probe.invokedPhases, ['ut']);
      assert(!fs.existsSync(featureFilePath(root, feature, 'feature-completion.json')), 'request created Feature completion');
      return;
    }
    detachedStarted = true;
    if (mode === 'direct') {
      assert.deepStrictEqual(probe.invokedPhases, ['coding', 'review', 'ut']);
      for (const skipped of ['spec', 'plan', 'testing']) assert(!fs.existsSync(featureFilePath(root, feature, `${skipped}/reports/summary.json`)), 'invented out-of-scope phase summary');
    }
    else {
      const sourceEvents = fs.readFileSync(featureFilePath(root, feature, 'goal-runs/p2-attended/events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
      const intents = sourceEvents.filter(event => event.type === 'scope_revision_requested');
      assert.equal(intents.length, 1, 'duplicate handoff intent');
      assert.equal(sourceEvents.filter(event => event.type === 'agent_invoke_start' && event.phase === (mode === 'design-gap' ? 'coding' : 'spec')).length, 1, 'source phase repeated');
      const successor = JSON.parse(fs.readFileSync(featureFilePath(root, feature, 'goal-runs/' + intents[0].successor_run_id + '/manifest.json'), 'utf8'));
      assert.deepStrictEqual(successor.phase_chain, mode === 'design-gap' ? ['plan', 'coding', 'review', 'ut'] : ['coding', 'review', 'ut', 'testing']);
      assert.equal(successor.end_phase, mode === 'design-gap' ? 'ut' : 'testing'); assert.equal(successor.successor_of, 'p2-attended');
      const nextEvents = fs.readFileSync(featureFilePath(root, feature, 'goal-runs/' + successor.run_id + '/events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
      assert(nextEvents.find(event => event.type === 'agent_invoke_start')?.invoke_id.endsWith('-i2'), 'successor reset consumed turns');
      assert.equal(nextEvents.filter(event => event.type === 'run_created').length, 1, 'duplicate successor birth');
      const before = fs.readFileSync(featureFilePath(root, feature, 'goal-runs/p2-attended/manifest.json'), 'utf8');
      assert.equal(JSON.parse(before).execution_scope.unresolved.length, mode === 'design-gap' ? 0 : 2, 'source scope rewritten');
      if (mode === 'design-gap') assert.equal(sourceEvents.filter(event => event.type === 'run_end').at(-1).status, 'PARTIAL', 'failure source was washed into success');
      const again = await execute(); assert.equal(again.invokedPhases.length, 0, 'completed successor invoked again');
      assert(recoveryMarker && !fs.existsSync(recoveryMarker), 'completed scope lineage leaked temporary recovery state');
    }
    const verified = verifyFeatureCompletion({ projectRoot: root, feature, expectedChain: ['coding', 'review', 'ut'], expectedTrack: 'full' });
    assert.equal(verified.verdict, 'VALID', JSON.stringify(verified));
    const cu = loadCanonicalChangeUnit(root, 'ledger-app-blueprint', 'ledger-refresh');
    const cuCompletion = observeChangeUnitCompletion(root, asChangeUnitArtifact(cu.changeUnit));
    assert.equal(cuCompletion.state, 'VALID');
    assert.deepStrictEqual(cuCompletion.expectedChain, mode === 'direct' ? ['coding', 'review', 'ut'] : mode === 'design-gap' ? ['plan', 'coding', 'review', 'ut'] : ['spec', 'coding', 'review', 'ut', 'testing']);
    if (mode === 'direct') {
      const previous = loadFrozenExecutionScope(root, feature, 'p2-attended')!;
      const reuseInput = request(['coding', 'review', 'ut'], 'feature');
      reuseInput.facts = previous.obligations.map(obligation => obligation.applicability !== 'required' ? obligation : ({ ...obligation, satisfied_by: obligation.satisfied_by ?? [{ phase: obligation.owner_phase, run_id: 'p2-attended', evidence_manifest_aggregate: loadPhaseEvidenceManifest(root, feature, obligation.owner_phase)!.manifest.aggregate_sha256 }] }));
      const reused = resolveExecutionScope(reuseInput, workflow);
      assert.deepStrictEqual(reused.phase_chain, []);
      assert(verifyReusedExecutionScope(root, feature, reused).complete, 'fully reused Feature evidence did not validate');
      const designBytes = fs.readFileSync(contractsFile);
      fs.appendFileSync(contractsFile, '\n# stale design contract\n');
      assert.notEqual(verifyFeatureCompletion({ projectRoot: root, feature, expectedChain: previous.phase_chain, expectedTrack: 'full' }).verdict, 'VALID', 'stale design contract accepted');
      fs.writeFileSync(contractsFile, designBytes);
      const codeBytes = fs.readFileSync(codeFile);
      fs.appendFileSync(codeFile, '\n// changed after validated execution\n');
      assert(!verifyReusedExecutionScope(root, feature, reused).complete, 'stale reused execution accepted');
      fs.writeFileSync(codeFile, codeBytes);
      assert(!verifyReusedExecutionScope(root, feature, { ...reused, requested_results: ['different result'] }).complete, 'old evidence silently satisfied a new goal');
      assert.equal(fs.readdirSync(featureFilePath(root, feature, 'goal-runs')).length, 1, 'reuse created an empty run');
      const projectionFile = featureFilePath(root, feature, 'feature-completion.json');
      const projection = JSON.parse(fs.readFileSync(projectionFile, 'utf8'));
      const original = path.join(root, projection.original_path);
      const record = JSON.parse(fs.readFileSync(original, 'utf8'));
      record.chain = ['ut']; record.phases = record.phases.filter((phase: { phase: string }) => phase.phase === 'ut');
      const bytes = JSON.stringify(record); fs.writeFileSync(original, bytes);
      fs.writeFileSync(projectionFile, JSON.stringify({ ...projection, original_sha256: createHash('sha256').update(bytes).digest('hex') }));
      assert.equal(verifyFeatureCompletion({ projectRoot: root, feature, expectedChain: ['ut'], expectedTrack: 'full' }).verdict, 'INVALID', 'self-authored completion chain bypassed frozen scope');
      const manifestFile = featureFilePath(root, feature, 'goal-runs/p2-attended/manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); delete manifest.execution_scope;
      fs.writeFileSync(manifestFile, JSON.stringify(manifest));
      assert.throws(() => loadFrozenExecutionScope(root, feature, 'p2-attended'), /出生摘要|scope/);
    }
  } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
}
for (const mode of ['direct', 'successor', 'intent', 'released', 'born', 'design-gap', 'detached', 'detached-harness', 'detached-explicit', 'request-ut', 'testing-fail', 'unresolved'] as const) cases.push({ name: 'real prepare CLI / bridge scope lifecycle: ' + mode, run: () => runScopeScenario(mode) });
export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const test of cases) { try { await test.run(); results.push({ name: test.name, ok: true }); } catch (error) { results.push({ name: test.name, ok: false, error: String(error) }); } }
  return results;
}
