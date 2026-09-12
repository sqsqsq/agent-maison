import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { spawnSync } from 'child_process';
import { fixture, tree } from './request-entry.unit.test';
import { clearFrameworkConfigCache } from '../../config';
import { resolveGraphModule } from '../../code-graph/module-graph-probe';
import { resolveExecutionScope } from '../../scripts/utils/execution-scope';
import { loadWorkflowSpec } from '../../workflow-loader';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { loadResolvedProfile } from '../../profile-loader';
import { loadFrameworkConfig } from '../../config';
import catalogChecker from '../../scripts/check-catalog';
import glossaryChecker from '../../scripts/check-glossary';
import graphChecker from '../../scripts/check-module-graph';
import docsChecker from '../../scripts/check-docs';
import { loadSkillsIndex } from '../../scripts/utils/resolve-skill-path';
import type { CheckContext } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';

const repo = path.resolve(__dirname, '../../..');
function write(root: string, file: string, value: unknown): void {
  const abs = path.join(root, file); fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, typeof value === 'string' ? value : YAML.stringify(value));
}
function context(f: ReturnType<typeof fixture>, phase: string): CheckContext {
  return { phase, feature: '_global', projectRoot: f.root, frameworkRoot: f.framework, frameworkRel: 'framework', harnessRoot: path.join(f.framework, 'harness'), layoutKind: 'consumer',
    featureSpec: { feature: '_global' }, phaseRule: new SpecLoader(repo).loadPhaseRule(phase), resolvedProfile: loadResolvedProfile(f.root, loadFrameworkConfig(f.root), f.framework) };
}
const card = (name: string) => ({ name, format: 'library', layer: '02-Feature', sub_layer: null, one_liner: '余额', responsibilities: ['余额'], NOT_responsible_for: ['支付', '开户'], typical_business_terms: ['余额'], easily_confused_with: [], key_exports: [], entry_file: 'src/value.js' });
function cli(f: ReturnType<typeof fixture>, script: string, args: string[], cwd = f.root) {
  return spawnSync(process.execPath, [require.resolve('ts-node/dist/bin.js'), '--transpile-only', path.join(repo, 'harness', script), '--project-root', f.root, ...args], {
    cwd, encoding: 'utf8', timeout: 60000, env: { ...process.env, TS_NODE_PROJECT: path.join(repo, 'harness/tsconfig.json') },
  });
}
const cases: Array<{ name: string; run(f: ReturnType<typeof fixture>): void | Promise<void> }> = [
  { name: 'selected catalog checks preserve other modules and still validate cross-module references', async run(f) {
    const selected = { ...card('Wallet'), easily_confused_with: [{ module: 'Other', disambiguation: 'unidirectional' }] };
    write(f.root, 'doc/module-catalog.yaml', { schema_version: '1.0', modules: [selected, { ...card('Other'), one_liner: '' }] });
    const before = fs.readFileSync(path.join(f.root, 'doc/module-catalog.yaml'), 'utf8');
    const ctx = { ...context(f, 'catalog'), module: 'Wallet' };
    const checks = await catalogChecker.check(ctx);
    assert(!checks.some(c => c.status === 'FAIL'), JSON.stringify(checks.filter(c => c.status === 'FAIL')));
    assert.equal(fs.readFileSync(path.join(f.root, 'doc/module-catalog.yaml'), 'utf8'), before);
    selected.easily_confused_with[0].module = 'Missing';
    write(f.root, 'doc/module-catalog.yaml', { schema_version: '1.0', modules: [selected, card('Other')] });
    assert((await catalogChecker.check(ctx)).some(c => c.id === 'easily_confused_references_exist' && c.status === 'FAIL'));
    assert((await catalogChecker.check({ ...ctx, module: 'Missing' })).some(c => c.status === 'FAIL'));
  } },
  { name: 'selected glossary uses existing owner and preserves alias collision checks', async run(f) {
    write(f.root, 'doc/module-catalog.yaml', { schema_version: '1.0', modules: [card('Wallet')] });
    const term = { term: '余额', aliases: ['钱'], canonical_module: 'Wallet', owner_layer: '02-Feature', easily_confused_with: [], disambiguation: '账户剩余金额' };
    write(f.root, 'doc/glossary.yaml', { schema_version: '1.0', terms: [term, { ...term, term: '无关', aliases: [], canonical_module: 'Missing' }] });
    const ctx = { ...context(f, 'glossary'), term: '余额' };
    write(f.root, 'doc/glossary-seed.txt', 'UnrelatedManager');
    const checks = await glossaryChecker.check(ctx);
    assert(!checks.some(c => c.status === 'FAIL'), JSON.stringify(checks.filter(c => c.status === 'FAIL')));
    assert.equal(checks.find(c => c.id === 'seed_no_technical_words')?.status, 'PASS');
    write(f.root, 'doc/glossary.yaml', { schema_version: '1.0', terms: [term, { ...term, term: '无关' }] });
    assert((await glossaryChecker.check(ctx)).some(c => c.id === 'alias_unique_across_terms' && c.status === 'FAIL'));
  } },
  { name: 'docs selection checks only requested inventory paths and reports missing targets', async run(f) {
    const isolated = path.join(f.root, 'isolated-framework');
    write(isolated, 'docs/DOC_INVENTORY.yaml', { schema_version: '1.0', docs: [
      { path: 'framework/docs/selected.md', role: 'selected', sources: ['framework/src/value.ts'] },
      { path: 'framework/docs/unrelated.md', role: 'other', sources: [] },
    ] });
    write(isolated, 'docs/selected.md', '# selected'); write(isolated, 'src/value.ts', 'export const value = 1;');
    const ctx = { ...context(f, 'docs'), projectRoot: isolated, frameworkRoot: isolated, frameworkRel: '', layoutKind: 'standalone' as const, docPath: 'framework/docs/selected.md' };
    const checks = await docsChecker.check(ctx);
    assert(!checks.some(c => c.status === 'FAIL'), JSON.stringify(checks));
    assert(!checks.some(c => JSON.stringify(c).includes('unrelated.md')), JSON.stringify(checks));
    assert((await docsChecker.check({ ...ctx, docPath: 'framework/docs/missing.md' })).some(c => c.status === 'FAIL'));
  } },
  { name: 'inventory covers current project Skill and workflow global entries', run() {
    const doc = fs.readFileSync(path.join(repo, 'docs/operations/project-entry.md'), 'utf8');
    for (const skill of loadSkillsIndex(repo).skills.filter(s => s.scope === 'project')) assert(doc.includes(skill.id), skill.id);
    for (const phase of loadWorkflowSpec(repo, 'spec-driven').artifacts.filter(a => a.scope === 'global')) assert(doc.includes(phase.id), phase.id);
  } },
  { name: 'Graph accepts explicit source without optional catalog but rejects configured missing/corrupt source', run(f) {
    assert.equal(resolveGraphModule(f.root, 'Wallet', 'src').packagePath, 'src');
    assert.throws(() => resolveGraphModule(f.root, 'Wallet'), /不存在|加载|catalog/);
    const config = JSON.parse(fs.readFileSync(path.join(f.root, 'framework.config.json'), 'utf8'));
    config.paths.module_catalog = 'doc/missing.yaml'; write(f.root, 'framework.config.json', JSON.stringify(config)); clearFrameworkConfigCache();
    assert.throws(() => resolveGraphModule(f.root, 'Wallet', 'src'));
    write(f.root, 'doc/missing.yaml', 'modules: [');
    assert.throws(() => resolveGraphModule(f.root, 'Wallet', 'src'));
    assert.throws(() => resolveGraphModule(f.root, 'Wallet', 'framework/harness'));
  } },
  { name: 'actual Graph generation and global CLI check share override from root and harness cwd without Feature writes', async run(f) {
    write(f.framework, 'profiles/request-test/harness/graph-extractor.js', `exports.graphExtractor={profileId:'request-test',extractModule(root,pkg){require('fs').readFileSync(require('path').join(root,pkg,'value.js'));return {signatures:[],import_edges:[],call_edges:[]}}};`);
    const config = JSON.parse(fs.readFileSync(path.join(f.root, 'framework.config.json'), 'utf8'));
    config.materialized_adapters = ['codex']; config.paths.reports_dir_pattern = 'doc/reports/<feature>/<phase>'; write(f.root, 'framework.config.json', JSON.stringify(config));
    write(f.root, 'framework.local.json', JSON.stringify({ schema_version: '1.0', agent_adapter: 'codex' }));
    write(f.root, 'AGENTS.md', '# Test adapter entry'); clearFrameworkConfigCache();
    const before = tree(path.join(f.root, 'doc/features'));
    const generated = cli(f, 'scripts/bootstrap-code-graph.ts', ['--module', 'Wallet', '--package-path', 'src']);
    assert.equal(generated.status, 0, generated.stdout + generated.stderr);
    assert(fs.existsSync(path.join(f.root, 'src/code-graph.yaml')));
    assert((await graphChecker.check({ ...context(f, 'module-graph'), module: 'Wallet', packagePath: 'src' })).every(c => c.status !== 'FAIL'));
    for (const cwd of [f.root, path.join(f.framework, 'harness')]) {
      const checked = cli(f, 'harness-runner.ts', ['--phase', 'module-graph', '--module', 'Wallet', '--package-path', 'src'], cwd);
      assert.equal(checked.status, 0, checked.stdout + checked.stderr);
      assert(checked.stdout.includes('"phase_chain":["module-graph"]'), checked.stdout);
    }
    assert.deepEqual(tree(path.join(f.root, 'doc/features')), before);
    assert(!fs.existsSync(path.join(f.root, 'doc/module-catalog.yaml')));
    assert(!fs.existsSync(path.join(f.root, 'doc/glossary.yaml')));
    write(f.root, 'src/code-graph.yaml', 'nodes: [');
    const failed = cli(f, 'scripts/bootstrap-code-graph.ts', ['--module', 'Wallet', '--package-path', 'src']);
    assert.notEqual(failed.status, 0); assert.equal(fs.readFileSync(path.join(f.root, 'src/code-graph.yaml'), 'utf8'), 'nodes: [');
  } },
  { name: 'global request obligations do not infer catalog or Feature continuation', run() {
    const workflow = loadWorkflowSpec(repo, 'spec-driven');
    for (const phase of workflow.artifacts.filter(a => a.scope === 'global')) {
      const scope = resolveExecutionScope({ request: { completion_target: 'request', requested_results: [phase.id], requested_phases: [phase.id] }, facts: [], contract_fingerprints: [] }, workflow);
      assert.deepEqual(scope.phase_chain, [phase.id]); assert.equal(scope.completion_target, 'request'); assert.deepEqual(scope.unresolved, []);
    }
  } },
];
export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const test of cases) {
    const f = fixture();
    try { clearFrameworkConfigCache(); await test.run(f); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: (error as Error).stack }); }
    finally { fs.rmSync(f.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  }
  return results;
}
