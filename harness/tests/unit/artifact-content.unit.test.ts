import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import * as YAML from 'yaml';
import { Module } from 'module';
import * as ts from 'typescript';
import { spawnSync } from 'child_process';
import { resolveArtifactContent, ArtifactSchemaError } from '../../scripts/utils/artifact-content';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { readBoundInput, resolveCapabilityInputs, type PhaseInputContext } from '../../scripts/utils/capability-resolution';
import { stableStringify } from '../../scripts/utils/phase-evidence-manifest';
import { scanNamedBusinessHandler } from '../../../profiles/hmos-app/harness/named-handler';
import { buildUiEntryBindings } from '../../scripts/utils/testing-trace-gates';
import { auditSchemaSupport, validateLiteSchema } from '../../scripts/utils/lite-json-schema';
import { clearFrameworkConfigCache, featurePhaseReportsDir, resolveFeatureArtifact } from '../../config';
import { deriveBlueprintSkillInput } from '../../scripts/utils/blueprint-skill-projection';
import { loadRefElementsFile } from '../../scripts/utils/fidelity-shared';
import { checkUseCaseSpecSchema } from '../../scripts/check-ut';
import { checkUiEntryCoverage } from '../../scripts/check-testing';
import { executeCheck } from '../../scripts/utils/check-execution';
import { fixture as blueprintFixture } from './blueprint-skill-projection.unit.test';
import { provisionFrameworkUnder } from '../utils/real-chain-host';
import type { CheckContext, UseCasesSpec } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';

const frameworkRoot = path.resolve(__dirname, '../../..');
const history = path.resolve(__dirname, '../fixtures/host-recovery-history/20261023/20261023T044016Z-fe4512/project');
const featurePath = 'doc/features/bc-openCard-2/bank-card-opening-flow';
const read = (relative: string): any => YAML.parse(fs.readFileSync(path.join(history, relative), 'utf8'));
const original = (): any => read(featurePath + '/use-cases.yaml');
const context = (root: string, value: unknown): CheckContext => ({ projectRoot: root, feature: 'demo', featureSpec: { feature: 'demo', useCases: value } } as CheckContext);
const hash = (value: unknown): string => crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
function temporary(run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-content-'));
  try { run(root); } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
}
function write(root: string, file: string, value: unknown): void {
  const absolute = path.join(root, file); fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, typeof value === 'string' ? value : YAML.stringify(value));
}
function loadedModule(file: string, source: string, overrides: Record<string, unknown> = {}): any {
  const mod = new Module(file, module);
  mod.filename = file; (mod as any).paths = (Module as any)._nodeModulePaths(path.dirname(file));
  const originalRequire = mod.require.bind(mod);
  mod.require = (id: string) => Object.prototype.hasOwnProperty.call(overrides, id) ? overrides[id] : originalRequire(id);
  (mod as any)._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
  return mod.exports;
}
const cases: Array<{ name: string; run(): void }> = [
  { name: 'real-chain framework assets and executed content loader stay in the isolated copy without source junctions', run() { temporary(root => {
    const before = process.env.NODE_PATH;
    try {
      delete process.env.NODE_PATH; (Module as any)._initPaths();
      const started = Date.now();
      const copied = provisionFrameworkUnder(root);
      const copiedMs = Date.now() - started;
      let dependencyBytes = 0, dependencyFiles = 0;
      const inventory = (dir: string): void => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name); if (entry.isDirectory()) inventory(file); else if (entry.isFile()) { dependencyBytes += fs.statSync(file).size; dependencyFiles++; }
      } };
      inventory(path.join(copied.harnessDir, 'node_modules'));
      console.log(`[framework-copy] provision_ms=${copiedMs} dependency_files=${dependencyFiles} dependency_bytes=${dependencyBytes}; NODE_PATH unset`);
      for (const relative of ['skills', 'workflows', 'specs', 'templates', 'agents', 'docs', 'harness', 'harness/node_modules']) {
        const file = path.join(copied.frameworkRoot, relative);
        assert.equal(fs.lstatSync(file).isSymbolicLink(), false, relative);
        assert.equal(fs.realpathSync(file), file);
      }
      const contentFile = path.join(copied.harnessDir, 'scripts/utils/artifact-content.ts');
      const script = `const fs=require('fs'); const file=${JSON.stringify(contentFile)}; const m=require(file); const result=m.resolveArtifactContent('use-cases@1',{use_cases:[]}); if(result.issues.length)throw Error(JSON.stringify(result.issues)); const loader=require('./profile-host-loader'); if(!loader.tryLoadProfileCodingHost('../profiles/hmos-app')) throw Error(loader.getLastProfileHarnessLoadError()); process.stdout.write(JSON.stringify({file:require.resolve(file),yaml:require.resolve('yaml'),tsnode:require.resolve('ts-node')}));`;
      const child = spawnSync(process.execPath, ['-r', 'ts-node/register', '-e', script], { cwd: copied.harnessDir, env: process.env, encoding: 'utf8' });
      assert.equal(child.status, 0, child.stderr); assert.equal(JSON.parse(child.stdout).file, contentFile);
      assert(JSON.parse(child.stdout).yaml.startsWith(path.join(copied.harnessDir, 'node_modules')));
      const direct = spawnSync(process.execPath, [path.join(copied.harnessDir, 'node_modules/ts-node/dist/bin.js'), 'harness-runner.ts', '--help'],
        { cwd: copied.harnessDir, env: process.env, encoding: 'utf8' });
      assert.equal(direct.status, 0, direct.stderr); assert(direct.stdout.includes('harness-runner.ts'), direct.stdout);
      const cli = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--no-install', 'ts-node', 'harness-runner.ts', '--help'],
        { cwd: copied.harnessDir, env: process.env, encoding: 'utf8', shell: process.platform === 'win32' });
      assert.equal(cli.status, 0, cli.stderr);
      assert(cli.stdout.includes('harness-runner.ts'), cli.stdout);
      const sourceSchema = path.join(frameworkRoot, 'specs/artifact-schemas/use-cases.schema.yaml');
      assert.deepEqual(fs.readFileSync(path.join(copied.frameworkRoot, 'specs/artifact-schemas/use-cases.schema.yaml')), fs.readFileSync(sourceSchema));
    } finally {
      if (before === undefined) delete process.env.NODE_PATH; else process.env.NODE_PATH = before;
      (Module as any)._initPaths();
    }
  }); } },
  { name: 'historical top-level journey summaries retain their strings while use-case actions remain typed', run() {
    const file = path.resolve(__dirname, '../fixtures/host-recovery-history/20261020/20261020T093340Z-1a0796/component-blueprint.yaml');
    const before = fs.readFileSync(file);
    const blueprint = YAML.parse(before.toString('utf8'));
    const documents: any[] = [];
    const visit = (value: any): void => {
      if (!value || typeof value !== 'object') return;
      if (value.coordinator === 'BankCardOpeningService' && Array.isArray(value.use_cases) && value.ui_bindings?.[0]?.role === 'journey_entry') documents.push(value);
      Object.values(value).forEach(visit);
    };
    visit(blueprint); assert.equal(documents.length, 1);
    const raw = documents[0];
    const valid = resolveArtifactContent('use-cases@1', raw);
    assert.deepEqual(valid.issues, []); assert.deepEqual((valid.value as any).ui_bindings, raw.ui_bindings);
    assert.deepEqual((valid.value as any).use_cases[0].ui_bindings[0].user_actions[0].calls, ['BankCardOpeningService.start']);
    assert.deepEqual((valid.value as any).ui_bindings[1].user_actions, ['input_code', 'resend', 'submit']);
    const invalid = structuredClone(raw); invalid.use_cases[0].ui_bindings[0].user_actions = ['tap_bank'];
    assert(resolveArtifactContent('use-cases@1', invalid).issues.some(issue => issue.path === '$.use_cases[0].ui_bindings[0].user_actions[0]'));
    assert(fs.readFileSync(file).equals(before));
  } },
  { name: 'testing consumes actual blueprint-derived memory without a use-cases file and checks every calls entry', run() {
    const f = blueprintFixture();
    try {
      const bp = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8'));
      const visit = (value: any): void => {
        if (!value || typeof value !== 'object') return;
        if (value.use_cases?.use_cases) value.use_cases.use_cases[0].ui_bindings = ['PageA', 'PageB'].map(ui => ({ ui, role: 'entry', user_actions: [{ trigger: 'tap', calls: ['LedgerFeature.first', 'LedgerFeature.second'] }] }));
        Object.values(value).forEach(visit);
      };
      visit(bp); fs.writeFileSync(f.blueprintFile, YAML.stringify(bp)); f.bind();
      const derived = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts');
      assert.equal(derived.state, 'resolved', derived.detail);
      const physical = resolveFeatureArtifact(f.root, f.feature, 'use-cases.yaml').actualPath;
      assert(!fs.existsSync(physical), 'this test requires genuine memory-only derived input');
      const context: PhaseInputContext = { schema_version: '1.1', subject: { feature: f.feature }, obligations: {}, required_outputs: [] };
      const featureSpec = new SpecLoader(f.root, undefined, undefined, frameworkRoot).loadFeatureSpec(f.feature,
        { context, phase: 'testing', values: {}, artifacts: derived.artifacts! });
      const ctx = { projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'testing', featureSpec, phaseRule: {} } as CheckContext;
      const plan = path.join(featurePhaseReportsDir(f.root, f.feature, 'testing', frameworkRoot), '20261023T000000Z-test/hylyre/test-plan.hylyre.md');
      const writePlan = (second: boolean): void => {
        const derived_cases = [{ tc_id: 'TC-1', entry_ui: 'PageA', calls: ['LedgerFeature.first', 'LedgerFeature.second'] },
          { tc_id: 'TC-2', entry_ui: 'PageB', calls: second ? ['LedgerFeature.first', 'LedgerFeature.second'] : ['LedgerFeature.first'] }];
        fs.mkdirSync(path.dirname(plan), { recursive: true }); fs.writeFileSync(plan, `---\n${YAML.stringify({ derived_cases })}---\n# 派生计划\n\n| 编号 | 操作 |\n|---|---|\n| TC-1 | 点击 |\n| TC-2 | 点击 |\n`);
      };
      writePlan(false);
      const failed = checkUiEntryCoverage(ctx);
      assert(failed.some(result => result.status === 'FAIL' && result.details?.includes('LedgerFeature.second') && result.details.includes('PageB')), JSON.stringify(failed));
      writePlan(true); assert(checkUiEntryCoverage(ctx).every(result => result.status === 'PASS'));
      assert(!fs.existsSync(physical));
    } finally { clearFrameworkConfigCache(); fs.rmSync(f.root, { recursive: true, force: true }); }
  } },
  { name: 'testing malformed file input is repairable plan content before missing-plan checks and recovers on reread', run() { temporary(root => {
    write(root, 'framework.config.json', JSON.stringify({ paths: { features_dir: 'doc/features' }, project_profile: { name: 'generic' } }));
    const raw = original(); raw.feature = 'demo'; raw.use_cases[0].ui_bindings[0].user_actions[0].calls = { invalid: true };
    write(root, 'doc/features/demo/use-cases.yaml', raw);
    const load = (): CheckContext => ({ projectRoot: root, frameworkRoot, feature: 'demo', phase: 'testing', phaseRule: {},
      featureSpec: new SpecLoader(root, undefined, undefined, frameworkRoot).loadFeatureSpec('demo') } as CheckContext);
    const ctx = load(); const failures = executeCheck(ctx, () => checkUiEntryCoverage(ctx), 'ui_entry_coverage');
    assert.equal(failures.length, 1); assert.equal(failures[0].status, 'FAIL'); assert.equal(failures[0].repair_owner, 'plan');
    assert(failures[0].details?.includes('$.use_cases[0].ui_bindings[0].user_actions[0].calls'));
    assert.notEqual(failures[0].failure_kind, 'framework_bug');
    raw.use_cases[0].ui_bindings[0].user_actions[0].calls = ['openCardTypeSheet']; write(root, 'doc/features/demo/use-cases.yaml', raw);
    const repaired = load(); const results = executeCheck(repaired, () => checkUiEntryCoverage(repaired), 'ui_entry_coverage');
    assert(results.every(result => result.status === 'SKIP' && result.details?.includes('无有效派生')), JSON.stringify(results));
  }); } },
  { name: 'fe4512 historical split and trim errors remain reproducible; unchanged originals pass current production consumers', run() {
    const raw = original();
    const oldNamedFile = path.join(frameworkRoot, 'profiles/hmos-app/harness/named-handler.ts');
    const oldNamed = loadedModule(oldNamedFile, fs.readFileSync(path.join(history, 'framework/profiles/hmos-app/harness/named-handler.ts'), 'utf8'));
    assert.throws(() => oldNamed.scanNamedBusinessHandler(context(history, raw)), /split/);
    const oldTraceFile = path.join(frameworkRoot, 'harness/scripts/utils/testing-trace-gates.ts');
    const oldTrace = loadedModule(oldTraceFile, fs.readFileSync(path.join(history, 'framework/harness/scripts/utils/testing-trace-gates.ts'), 'utf8'));
    assert.throws(() => oldTrace.buildUiEntryBindings(raw), /trim/);
    assert.deepEqual(scanNamedBusinessHandler(context(history, raw)), { skip: false, issues: [] });
    assert.equal(buildUiEntryBindings(raw).length, 4);
    assert.deepEqual(original(), raw, 'source data must remain unchanged');
  } },
  { name: 'calls preserve order and duplicates; each missing implementation and each UI trace entry is consumed', run() {
    const raw = original(); raw.use_cases[0].ui_bindings[0].user_actions[0].calls = ['openCardTypeSheet', 'missingSecondHandler', 'openCardTypeSheet'];
    const normalized = resolveArtifactContent('use-cases@1', raw);
    assert.deepEqual(normalized.issues, []);
    assert.deepEqual((normalized.value as UseCasesSpec).use_cases[0].ui_bindings[0].user_actions[0].calls, raw.use_cases[0].ui_bindings[0].user_actions[0].calls);
    assert(scanNamedBusinessHandler(context(history, raw)).issues.some(issue => issue.includes('missingSecondHandler')));
    assert.deepEqual(buildUiEntryBindings(raw).slice(0, 3).map(entry => entry.call), raw.use_cases[0].ui_bindings[0].user_actions[0].calls);
  } },
  { name: 'fe4512 original blueprint and change unit derive canonical calls through the production projection', run() {
    const result = deriveBlueprintSkillInput(history, original().feature, frameworkRoot, 'contracts');
    assert.equal(result.state, 'resolved', result.detail);
    const useCases = result.artifacts?.['use-cases@1'] as UseCasesSpec;
    assert.deepEqual(useCases.use_cases[0].ui_bindings[0].user_actions[0].calls, ['openCardTypeSheet']);
    assert.equal(buildUiEntryBindings(useCases).length, 4);
  } },
  { name: 'invalid calls and scalar coordinator/ui/trigger yield field paths and recover after the owner repairs the same input', run() {
    for (const invalid of [[], {}, 42, null, undefined, ['ok', 42], [''], '']) {
      const raw = original(); raw.use_cases[0].ui_bindings[0].user_actions[0].calls = invalid;
      const result = resolveArtifactContent('use-cases@1', raw);
      assert(result.issues.some(issue => issue.path.includes('calls')), JSON.stringify({ invalid, issues: result.issues }));
      assert(scanNamedBusinessHandler(context(history, raw)).issues.length > 0);
      raw.use_cases[0].ui_bindings[0].user_actions[0].calls = 'openCardTypeSheet';
      assert.deepEqual(resolveArtifactContent('use-cases@1', raw).issues, []);
    }
    for (const field of ['coordinator', 'ui', 'trigger']) {
      const raw = original(), uc = raw.use_cases[0];
      const target = field === 'coordinator' ? uc : field === 'ui' ? uc.ui_bindings[0] : uc.ui_bindings[0].user_actions[0];
      target[field] = ['not-a-scalar'];
      assert(resolveArtifactContent('use-cases@1', raw).issues.some(issue => issue.path.endsWith('.' + field)));
    }
  } },
  { name: 'file, supplied memory and direct loader use one contract and preserve old legal string bindings while real changes become stale', run() { temporary(root => {
    const raw = original(); raw.feature = 'demo';
    for (const binding of [...(raw.ui_bindings ?? []), ...raw.use_cases.flatMap((uc: any) => uc.ui_bindings)]) for (const action of binding.user_actions) action.calls = action.calls[0];
    write(root, 'doc/features/demo/use-cases.yaml', raw);
    write(root, 'framework.config.json', JSON.stringify({ active_workflow: 'spec-driven', paths: { features_dir: 'doc/features' }, project_profile: { name: 'generic' } }));
    const direct = new SpecLoader(root, undefined, undefined, frameworkRoot).loadFeatureSpec('demo');
    const context: PhaseInputContext = { schema_version: '1.1', subject: { feature: 'demo' }, obligations: {}, required_outputs: [] };
    const memory = new SpecLoader(root, undefined, undefined, frameworkRoot).loadFeatureSpec('demo', { context, phase: 'ut', values: {}, artifacts: { 'use-cases@1': raw } });
    assert.deepEqual(memory.useCases, direct.useCases); assert.deepEqual(memory.shape_issues, undefined);
    const binding = { input_id: 'use_cases', source: { kind: 'artifact' as const, artifact: 'use-cases@1' }, source_refs: ['doc/features/demo/use-cases.yaml'], dependencies: [{ path: path.join(root, 'doc/features/demo/use-cases.yaml'), role: 'artifact' as const, exists: true, sha256: 'old-byte-hash' }], content_fingerprint: hash(raw) };
    const options = { projectRoot: root, frameworkRoot, feature: 'demo', phase: 'ut', track: 'full' as const };
    assert.deepEqual(readBoundInput(options, binding), direct.useCases);
    write(root, 'doc/features/demo/use-cases.yaml', direct.useCases);
    assert.deepEqual(readBoundInput(options, binding), direct.useCases, 'legal string/list difference must not invalidate the old binding');
    const changed = structuredClone(direct.useCases!); changed.use_cases[0].coordinator = 'DifferentBusinessOwner'; write(root, 'doc/features/demo/use-cases.yaml', changed);
    assert.throws(() => readBoundInput(options, binding), /input binding stale/);
    changed.use_cases[0].coordinator = ['invalid'] as any; write(root, 'doc/features/demo/use-cases.yaml', changed);
    assert(new SpecLoader(root, undefined, undefined, frameworkRoot).loadFeatureSpec('demo').shape_issues?.some(issue => issue.includes('coordinator')));
  }); } },
  { name: 'real capability resolver reports malformed input and accepts the owner repair through its normal artifact path', run() { temporary(root => {
    const framework = path.join(root, 'maison');
    for (const relative of ['skills/feature', 'skills/legacy', 'workflows', 'specs/artifact-schemas']) fs.cpSync(path.join(frameworkRoot, relative), path.join(framework, relative), { recursive: true });
    write(root, 'framework.config.json', JSON.stringify({ active_workflow: 'spec-driven', paths: { features_dir: 'doc/features' }, project_profile: { name: 'generic' } }));
    write(framework, 'skills/feature/code-review/contract.yaml', { schema_version: '1.1', skill: 'code-review', skill_doc: 'SKILL.md', phases: { review: {
      inputs: [{ id: 'payload', sources: [{ kind: 'artifact', artifact: 'use-cases@1' }] }], capabilities: [{ id: 'capability_review_payload', axis: 'functional', inputs: ['payload'], obligation_kinds: ['review-context'], on_missing: 'fail' }], produces: [{ artifact: 'review-report@1' }], verifies: { check: 'check-review.ts' },
    } } });
    const inputContext: PhaseInputContext = { schema_version: '1.1', subject: { feature: 'demo' }, obligations: { 'review-context': 'required' }, required_outputs: [] };
    const options = { projectRoot: root, frameworkRoot: framework, feature: 'demo', phase: 'review', track: 'full' as const, inputContext };
    const raw = original(); raw.feature = 'demo'; raw.use_cases[0].coordinator = ['invalid']; write(root, 'doc/features/demo/use-cases.yaml', raw);
    const invalid = resolveCapabilityInputs(options); assert.equal(invalid.report.assurance, 'blocked'); assert(JSON.stringify(invalid.report).includes('coordinator'));
    raw.use_cases[0].coordinator = 'BankCardOpeningService'; write(root, 'doc/features/demo/use-cases.yaml', raw);
    const valid = resolveCapabilityInputs(options); assert.equal(valid.report.assurance, 'full'); assert.deepEqual((valid.inputs?.values.payload as any).value.use_cases[0].ui_bindings[0].user_actions[0].calls, ['openCardTypeSheet']);
    const first = valid.inputs!.values.payload;
    assert.equal(first.state, 'resolved'); if (first.state !== 'resolved') throw new Error('payload unresolved');
    const oldValue = structuredClone(first.value) as any; for (const parent of [oldValue, ...oldValue.use_cases]) for (const ui of parent.ui_bindings ?? []) for (const action of ui.user_actions) action.calls = action.calls[0];
    assert.equal(resolveCapabilityInputs({ ...options, inputContext: { ...inputContext, expected_bindings: [{ ...first.binding, content_fingerprint: hash(oldValue) }] } }).report.assurance, 'full');
  }); } },
  { name: 'real capability supplied entry rejects malformed memory, resolves repaired calls and detects bypassing its own validation', run() { temporary(root => {
    const framework = path.join(root, 'maison');
    for (const relative of ['skills/feature', 'skills/legacy', 'workflows', 'specs/artifact-schemas']) fs.cpSync(path.join(frameworkRoot, relative), path.join(framework, relative), { recursive: true });
    write(root, 'framework.config.json', JSON.stringify({ active_workflow: 'spec-driven', paths: { features_dir: 'doc/features' }, project_profile: { name: 'generic' } }));
    write(framework, 'skills/feature/code-review/contract.yaml', { schema_version: '1.1', skill: 'code-review', skill_doc: 'SKILL.md', phases: { review: {
      inputs: [{ id: 'design', sources: [{ kind: 'derive', provider_id: 'derive.blueprint-contracts' }] }, { id: 'payload', sources: [{ kind: 'artifact', artifact: 'use-cases@1' }] }],
      capabilities: [{ id: 'capability_review_payload', axis: 'functional', inputs: ['design', 'payload'], obligation_kinds: ['review-context'], on_missing: 'fail' }], produces: [{ artifact: 'review-report@1' }], verifies: { check: 'check-review.ts' },
    } } });
    const inputContext: PhaseInputContext = { schema_version: '1.1', subject: { feature: 'demo' }, obligations: { 'review-context': 'required' }, required_outputs: [] };
    const options = { projectRoot: root, frameworkRoot: framework, feature: 'demo', phase: 'review', track: 'full' as const, inputContext };
    const file = path.join(frameworkRoot, 'harness/scripts/utils/capability-resolution.ts');
    const source = fs.readFileSync(file, 'utf8');
    let supplied: any;
    // Inject only the upstream memory producer so the public resolver must validate the supplied branch itself.
    const load = (text: string): typeof import('../../scripts/utils/capability-resolution') => loadedModule(file, text, {
      './blueprint-skill-projection': { ...require('../../scripts/utils/blueprint-skill-projection'), deriveBlueprintSkillInput: () => ({
        state: 'resolved', value: { interfaces: [] }, dependencies: [], artifacts: { 'use-cases@1': structuredClone(supplied) },
      }) },
    });
    const verify = (resolver: ReturnType<typeof load>): void => {
      supplied = original(); supplied.feature = 'demo'; supplied.use_cases[0].coordinator = ['invalid'];
      assert.equal(resolveFeatureArtifact(root, 'demo', 'use-cases.yaml').exists, false);
      const invalid = resolver.resolveCapabilityInputs(options);
      assert.equal(invalid.report.assurance, 'blocked');
      assert.equal(invalid.inputs?.values.payload.state, 'invalid');
      const attempt = invalid.report.capabilities[0].inputs.find(input => input.id === 'payload')!.attempts[0];
      assert.equal(attempt.state, 'invalid');
      assert.equal(JSON.parse(attempt.detail!).some((issue: { path: string }) => issue.path === '$.use_cases[0].coordinator'), true);
      supplied.use_cases[0].coordinator = 'BankCardOpeningService';
      supplied.use_cases[0].ui_bindings[0].user_actions[0].calls = 'openCardTypeSheet';
      const valid = resolver.resolveCapabilityInputs(options);
      assert.equal(valid.report.assurance, 'full');
      const payload = valid.inputs!.values.payload;
      assert.equal(payload.state, 'resolved'); if (payload.state !== 'resolved') throw new Error('supplied payload unresolved');
      assert.deepEqual((payload.value as UseCasesSpec).use_cases[0].ui_bindings[0].user_actions[0].calls, ['openCardTypeSheet']);
    };
    verify(load(source));
    const bypassed = source.replace('resolveArtifactContent(source.artifact, supplied.value, { frameworkRoot })', '({ value: supplied.value, issues: [] })');
    assert.notEqual(bypassed, source);
    assert.throws(() => verify(load(bypassed)), assert.AssertionError);
  }); } },
  { name: 'unchanged legacy bindings retain exact raw mixed string/list and surrounding whitespace evidence', run() { temporary(root => {
    const raw = original(); raw.feature = 'demo'; raw.use_cases[0].ui_bindings[0].user_actions[0].calls = ' openCardTypeSheet ';
    write(root, 'framework.config.json', JSON.stringify({ paths: { features_dir: 'doc/features' }, project_profile: { name: 'generic' } }));
    write(root, 'doc/features/demo/use-cases.yaml', raw);
    const binding = { input_id: 'use_cases', source: { kind: 'artifact' as const, artifact: 'use-cases@1' }, source_refs: ['doc/features/demo/use-cases.yaml'], dependencies: [{ path: path.join(root, 'doc/features/demo/use-cases.yaml'), role: 'artifact' as const, exists: true, sha256: 'old-byte-hash' }], content_fingerprint: hash(raw) };
    const options = { projectRoot: root, frameworkRoot, feature: 'demo', phase: 'ut', track: 'full' as const };
    const parsed = readBoundInput(options, binding) as UseCasesSpec;
    assert.deepEqual(parsed.use_cases[0].ui_bindings[0].user_actions[0].calls, ['openCardTypeSheet']);
    raw.use_cases[0].ui_bindings[1].user_actions[0].calls = ['differentBusinessCall']; write(root, 'doc/features/demo/use-cases.yaml', raw);
    assert.throws(() => readBoundInput(options, binding), /input binding stale/);
  }); } },
  { name: 'legacy optional empty/null collections and focus lists remain shape-valid while completeness stays with the owning check', run() {
    const raw = original();
    raw.use_cases[0].ui_bindings[0].subscribes = [];
    raw.use_cases[0].branches[0].not_called = [];
    raw.use_cases[0].branches[0].expected_port_calls = [];
    assert.deepEqual(resolveArtifactContent('use-cases@1', raw).issues, []);
    assert.deepEqual(resolveArtifactContent('acceptance@1', { criteria: [{ id: 'AC-1', ut_focus: ['legacy focus'] }], boundaries: null }).issues, []);
    assert.equal((resolveArtifactContent('contracts@1', { interfaces: null }).value as any).interfaces, null);
    const construction = { components: [{ name: 'LegacyPage', state: ['selected: string'], props: ['value: string'], events: ['tap', { name: 'close' }] }] };
    const compatible = resolveArtifactContent('contracts@1', construction);
    assert.deepEqual(compatible.issues, []); assert.deepEqual(compatible.value, construction);
    assert.deepEqual(resolveArtifactContent('use-cases@1', { use_cases: [] }).issues, []);
    const empty = context(history, { use_cases: [] }); empty.frameworkRoot = frameworkRoot; empty.phaseRule = {} as any;
    assert.equal(checkUseCaseSpecSchema(empty)[0].status, 'FAIL');
    delete raw.schema_version;
    assert.deepEqual(resolveArtifactContent('use-cases@1', raw).issues, []);
    const missing = context(history, raw); missing.frameworkRoot = frameworkRoot; missing.phaseRule = {} as any;
    assert(checkUseCaseSpecSchema(missing)[0].details?.includes('schema_version'));
  } },
  { name: 'fragments omit derived identity; existing UI schema and reference parser share executable shape rules', run() {
    assert.deepEqual(resolveArtifactContent('acceptance@1', { boundaries: [] }, { mode: 'fragment' }).issues, []);
    assert(resolveArtifactContent('acceptance@1', { boundaries: [] }).issues.some(issue => issue.path === '$.criteria'));
    const uiSchema = JSON.parse(fs.readFileSync(path.join(frameworkRoot, 'harness/schemas/ui-spec.schema.json'), 'utf8'));
    assert.deepEqual(auditSchemaSupport(uiSchema), []);
    assert(resolveArtifactContent('ui-spec@1', { schema_version: '1.0', screens: [{ id: 's', priority: 'P0' }], tokens: {}, assets: [] }).issues.some(issue => issue.message.includes('minProperties')));
    assert(validateLiteSchema({}, { type: 'object', minProperties: 1 }).length > 0);
    assert(validateLiteSchema({ a: 1 }, { type: 'object', maxProperties: 0 }).length > 0);
    assert.equal(validateLiteSchema('ok', { $ref: '#/$defs/text', $defs: { text: { type: 'string' } } }).length, 0);
    assert(auditSchemaSupport({ unexpectedKeyword: true }).length > 0);
    const refs = resolveArtifactContent('ref-elements@1', { elements: [{ element_id: 'old-reference' }] });
    assert.deepEqual(refs.issues, []); assert.equal((refs.value as any).elements[0].disposition, 'implement');
  } },
  { name: 'broken schema remains a framework error rather than an author issue', run() { temporary(root => {
    fs.cpSync(path.join(frameworkRoot, 'specs/artifact-schemas'), path.join(root, 'specs/artifact-schemas'), { recursive: true });
    fs.appendFileSync(path.join(root, 'specs/artifact-schemas/use-cases.schema.yaml'), '\nunknownConstraint: true\n');
    assert.throws(() => resolveArtifactContent('use-cases@1', original(), { frameworkRoot: root }), ArtifactSchemaError);
  }); } },
  { name: 'reference loader keeps invalid input diagnostics and the excluded obligation instead of silently dropping the ledger', run() { temporary(root => {
    const file = path.join(root, 'ref-elements.yaml');
    fs.writeFileSync(file, YAML.stringify({ elements: [{ element_id: 'title', disposition: 'excluded', requirement_quote: ['not-a-string'] }] }));
    const parsed = loadRefElementsFile(file)!;
    assert(parsed.shape_issues?.some(issue => issue.includes('requirement_quote')));
    assert.equal(parsed.elements[0].disposition, 'excluded');
    fs.writeFileSync(file, '42\n'); assert(loadRefElementsFile(file)?.shape_issues?.length);
  }); } },
  { name: 'production mutations bypassing loader contract or checking only the first calls item turn the corresponding assertions red', run() { temporary(root => {
    const raw = original(); raw.feature = 'demo'; raw.use_cases[0].coordinator = ['invalid'];
    write(root, 'doc/features/demo/use-cases.yaml', raw);
    const loaderFile = path.join(frameworkRoot, 'harness/scripts/utils/spec-loader.ts');
    const source = fs.readFileSync(loaderFile, 'utf8');
    const bypassed = source.replace('resolveArtifactContent(artifact, raw, { frameworkRoot: this.frameworkRoot })', '({ value: raw, issues: [] })');
    assert.notEqual(source, bypassed);
    const mutant = loadedModule(loaderFile, bypassed);
    assert.throws(() => assert(new mutant.SpecLoader(root, undefined, undefined, frameworkRoot).loadFeatureSpec('demo').shape_issues?.some((issue: string) => issue.includes('coordinator'))), assert.AssertionError);
    const namedFile = path.join(frameworkRoot, 'profiles/hmos-app/harness/named-handler.ts');
    const namedSource = fs.readFileSync(namedFile, 'utf8'); const firstOnly = namedSource.replace('for (const call of ua.calls ?? [])', 'for (const call of (ua.calls ?? []).slice(0, 1))');
    assert.notEqual(namedSource, firstOnly);
    const namedMutant = loadedModule(namedFile, firstOnly);
    const multiple = original(); multiple.use_cases[0].ui_bindings[0].user_actions[0].calls = ['openCardTypeSheet', 'missingSecondHandler'];
    assert.throws(() => assert(namedMutant.scanNamedBusinessHandler(context(history, multiple)).issues.some((issue: string) => issue.includes('missingSecondHandler'))), assert.AssertionError);
  }); } },
];

function runCases(filter?: string): UnitCaseResult[] {
  return cases.filter(item => filter === undefined || item.name.includes(filter)).map(item => {
    try { item.run(); return { name: item.name, ok: true }; } catch (error) { return { name: item.name, ok: false, error: String(error) }; }
  });
}
export const runAll = (): UnitCaseResult[] => runCases();
export const runSelectedCases = (filter?: string) => { const results = runCases(filter); return { results, matchedCaseCount: results.length, executionTimings: [] }; };
