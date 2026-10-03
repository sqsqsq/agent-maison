import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { spawnSync, execFileSync } from 'child_process';
import { assembleKnowledge, knowledgeContextFiles, renderKnowledge } from '../../scripts/utils/knowledge-context';
import { clearFrameworkConfigCache, featureFilePath, featurePhaseReportsDir } from '../../config';
import { collectContextFiles } from '../../harness-runner';
import { resolveCapabilityInputs } from '../../scripts/utils/capability-resolution';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { buildVerifierMaterialView } from '../../scripts/utils/verifier-material';
import { assembleAIPrompt } from '../../scripts/utils/report-generator';
import { materializeExtensions } from '../../scripts/extension';
import { inspectInstanceExtensions } from '../../scripts/utils/extension-inspect';
import { validateProfileSkillAssetsForProject } from '../../scripts/utils/profile-skill-assets';
import { setupRunlessProject } from './execution-scope.unit.test';
import { fixture as requestFixture } from './request-entry.unit.test';
import { type UnitCaseResult } from '../run-unit';
import { ensureFeatureExecutionScopeFrozen } from '../../scripts/utils/feature-execution-scope';
import { checkDiffWithinScope } from '../../scripts/check-coding';
import { type CheckContext } from '../../scripts/utils/types';
import { prepareFeatureScopeCandidate } from '../../scripts/utils/feature-track';

const frameworkRoot = path.resolve(__dirname, '../../..');
const put = (root: string, file: string, text: string) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text, 'utf8'); };
const cli = (root: string, script: string, args: string[], preload?: string) => spawnSync(process.execPath,
  [...(preload ? ['--require', preload] : []), require.resolve('ts-node/dist/bin.js'), '--transpile-only', path.join(frameworkRoot, 'harness', script), ...args],
  { cwd: root, encoding: 'utf8', timeout: 60000, env: { ...process.env, TS_NODE_PROJECT: path.join(frameworkRoot, 'harness/tsconfig.json'), MAISON_GOAL_RUN_ID: '', MAISON_GOAL_RUNNER: '' } });

function seed(root: string) {
  const configFile = path.join(root, 'framework.config.json');
  const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : { project_profile: { name: 'generic' } };
  config.paths = { ...config.paths, module_catalog: 'knowledge/modules.yaml', glossary: 'knowledge/terms.yaml',
    conventions: 'knowledge/practices.md', architecture_md: 'knowledge/architecture.md', component_index: 'knowledge/components.yaml',
    component_catalog: 'knowledge/curated.yaml', module_graphs_dir: 'knowledge/graphs/<module>.yaml', extension_dir: 'custom/extensions' };
  put(root, 'framework.config.json', JSON.stringify(config));
  put(root, 'knowledge/modules.yaml', YAML.stringify({ schema_version: '1.0', modules: [
    { name: 'demo', layer: 'src', one_liner: '余额来源', responsibilities: ['余额'], NOT_responsible_for: ['账单'], typical_business_terms: ['余额'], easily_confused_with: [{ module: 'ledger', disambiguation: '账单是流水，余额是当前值' }], key_exports: [], entry_file: 'src/demo/value.ts' },
    { name: 'ledger', layer: 'src', one_liner: '账单来源', responsibilities: [], NOT_responsible_for: [], typical_business_terms: ['账单'], easily_confused_with: [], key_exports: [], entry_file: 'src/ledger/index.ts' },
  ] }));
  put(root, 'knowledge/terms.yaml', YAML.stringify({ schema_version: '1.0', terms: [{ term: '余额', aliases: ['balance'], canonical_module: 'demo', owner_layer: 'src', easily_confused_with: [{ term: '账单', module: 'ledger', disambiguation: '余额不是交易列表' }] }] }));
  put(root, 'knowledge/practices.md', '# 惯例\n\n## shared-value\n规则：读共享值。\n范例：`src/demo/value.ts#value`\n');
  put(root, 'knowledge/architecture.md', '# 架构\n当前模块负责余额。\n');
  put(root, 'knowledge/components.yaml', 'schema_version: "1.0"\ncomponents: []\n');
  put(root, 'knowledge/curated.yaml', 'schema_version: "1.0"\ncomponents: []\n');
  put(root, 'src/demo/value.ts', 'export const value = 1;\n');
  put(root, 'knowledge/graphs/src/demo.yaml', YAML.stringify({ schema_version: '1.0', module: 'demo', nodes: [
    { id: 'noncore-value', core: false, intent: '查询余额', anchor: { file: 'src/demo/value.ts', symbol: 'value', content_hash: 'x' } },
  ] }));
  clearFrameworkConfigCache();
  return config;
}

const cases: Array<{ name: string; run(): void | Promise<void> }> = [
  { name: 'typed scope rejects unbound graph writes and accepts authorized bootstrap while preserving curated nodes', run() {
    for (const authorized of [false, true]) {
    const { root, frameworkRoot: fw, feature } = setupRunlessProject();
    const priorBase = process.env.HARNESS_DIFF_BASE_REF, priorRun = process.env.MAISON_GOAL_RUN_ID;
    try {
      const config = JSON.parse(fs.readFileSync(path.join(root, 'framework.config.json'), 'utf8'));
      config.project_profile = { name: 'hmos-app' }; put(root, 'framework.config.json', JSON.stringify(config)); clearFrameworkConfigCache();
      const graphFile = 'src/demo/code-graph.yaml';
      const nodes = [{ id: 'curated-value', core: true, intent: '已确认的余额入口', invariant: '不可重复映射', anchor: { file: 'src/demo/value.ts', symbol: 'value', content_hash: 'keep-curated-anchor' } }];
      const derived = { signatures: [{ file: 'old.ts', symbol: 'old', signature: 'stale derived signature' }] };
      put(root, graphFile, YAML.stringify({ schema_version: '1.0', module: 'demo', derived, nodes }));
      if (authorized) {
        const contractsFile = featureFilePath(root, feature, 'contracts.yaml');
        const contracts = YAML.parse(fs.readFileSync(contractsFile, 'utf8'));
        contracts.files.push(graphFile); fs.writeFileSync(contractsFile, YAML.stringify(contracts));
        prepareFeatureScopeCandidate({ projectRoot: root, frameworkRoot: fw, feature, completionTarget: 'feature',
          requestedResults: ['value is 42'], requestedPhases: ['coding', 'review', 'ut'], requirement: '把 value 改成 42', overwrite: true,
          impact: { userVisibleBehaviorChange: false, reason: '仅内部取值变化', basisPaths: ['src/demo/value.ts'] } });
      }
      const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      git('init', '-q'); git('add', 'src', 'doc', 'framework.config.json'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'baseline');
      process.env.HARNESS_DIFF_BASE_REF = git('rev-parse', 'HEAD'); delete process.env.MAISON_GOAL_RUN_ID;
      assert.equal(ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot: fw, feature }).status, 'frozen');
      const resolved = resolveCapabilityInputs({ projectRoot: root, frameworkRoot: fw, feature, phase: 'coding', track: 'full',
        inputContext: { schema_version: '1.1', subject: { feature }, obligations: {}, required_outputs: [] } }).inputs!;
      const ctx = { projectRoot: root, frameworkRoot: fw, feature, phase: 'coding', resolvedInputs: resolved } as CheckContext;
      const graphBefore = fs.readFileSync(path.join(root, graphFile), 'utf8');
      assembleKnowledge({ projectRoot: root, frameworkRoot: fw, phase: 'coding', role: 'author', targetFiles: ['src/demo/value.ts'] });
      assert.equal(fs.readFileSync(path.join(root, graphFile), 'utf8'), graphBefore, '发现不得刷新图谱');
      const run = cli(root, 'scripts/bootstrap-code-graph.ts', ['--project-root', root, '--module', 'demo', '--package-path', 'src/demo']);
      assert.equal(run.status, 0, run.stderr + run.stdout);
      const refreshed = YAML.parse(fs.readFileSync(path.join(root, graphFile), 'utf8'));
      assert.deepEqual(refreshed.nodes, nodes, 'bootstrap 必须保留策展节点与原 anchor');
      assert.notDeepEqual(refreshed.derived, derived, '真实 bootstrap 必须刷新派生内容');
      const result = checkDiffWithinScope(ctx);
      if (authorized) assert(result.length > 0 && result.every(check => check.status === 'PASS'), JSON.stringify(result));
      else assert(result.some(check => check.status === 'FAIL' && check.details?.includes(graphFile)), JSON.stringify(result));
      const guidance = renderKnowledge(assembleKnowledge({ projectRoot: root, frameworkRoot: fw, phase: 'coding' }));
      assert(guidance.includes('不在 run 内擅自刷新图谱'));
    } finally {
      if (priorBase === undefined) delete process.env.HARNESS_DIFF_BASE_REF; else process.env.HARNESS_DIFF_BASE_REF = priorBase;
      if (priorRun === undefined) delete process.env.MAISON_GOAL_RUN_ID; else process.env.MAISON_GOAL_RUN_ID = priorRun;
      fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache();
    }
    }
  } },
  { name: 'custom paths, term/alias disambiguation, noncore navigation and budget preserve original sources', run() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-context-'));
    try {
      seed(root);
      const args = { projectRoot: root, frameworkRoot, phase: 'review', requirement: '显示 balance', targetFiles: ['src/demo/value.ts'] };
      const view = assembleKnowledge(args); const rendered = renderKnowledge(view);
      for (const expected of ['knowledge/terms.yaml', '余额不是交易列表', 'NOT_responsible_for', 'noncore-value', 'knowledge/graphs/src/demo.yaml']) assert(rendered.includes(expected), expected);
      for (const source of ['knowledge/terms.yaml', 'knowledge/modules.yaml', 'knowledge/graphs/src/demo.yaml']) {
        const entry = knowledgeContextFiles(view).find(file => file.label === source)!;
        assert(entry.content.startsWith('候选摘录，非全文，按路径读完整来源。'), source);
      }
      assert(view.entries.some(entry => entry.kind === 'convention-source' && entry.path === 'src/demo/value.ts'));
      const small = assembleKnowledge({ ...args, inlineBudgetChars: 0 });
      assert(small.entries.every(entry => entry.content === undefined));
      assert(renderKnowledge(small).includes('分批读取'));
      fs.unlinkSync(path.join(root, 'knowledge/graphs/src/demo.yaml'));
      const missing = renderKnowledge(assembleKnowledge({ ...args, requirement: '新词' }));
      assert(missing.includes('无术语字面候选') && missing.includes('回源码'));
      assert(missing.includes('knowledge/graphs/src/demo.yaml 不存在') && !missing.includes('ENOENT') && !missing.includes(root), '预期缺图只显示相对路径');
      assert(!fs.existsSync(path.join(root, 'knowledge/graphs/src/demo.yaml')), '发现不能自动建图');
      put(root, 'knowledge/graphs/src/demo.yaml', 'schema_version: [unterminated');
      const corrupt = assembleKnowledge({ ...args, requirement: '新词' });
      assert(corrupt.notices.some(notice => notice.includes('knowledge/graphs/src/demo.yaml') && notice.includes('解析失败')), '已有坏图必须保留解析诊断');
      assert(!corrupt.notices.some(notice => notice.includes('knowledge/graphs/src/demo.yaml 不存在')));
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  } },
  { name: 'review verifier keeps large architecture as a hashed pointer and leaves budget for component text', run() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-budget-'));
    try {
      seed(root);
      const catalogFile = path.join(root, 'knowledge/modules.yaml');
      const catalog = YAML.parse(fs.readFileSync(catalogFile, 'utf8')); catalog.modules[0].format = 'HAR';
      fs.writeFileSync(catalogFile, YAML.stringify(catalog));
      const id = 'demo/value.ts#Row';
      put(root, 'knowledge/components.yaml', YAML.stringify({ schema_version: '1.0', components: [{ id, module: 'demo', file: 'src/demo/value.ts', symbol: 'Row', kind: 'component', props: [], deprecated: false,
        source_fingerprint: 'sha256:' + '0'.repeat(64), static_checks: { scalable_font_unit: 'pass', no_hardcoded_hex_color: 'pass', declared_touch_target: 'pass' } }] }));
      put(root, 'knowledge/curated.yaml', YAML.stringify({ schema_version: '1.0', components: [{ id, intent: ['余额展示'], one_liner: 'normal-component-card', use_when: ['复用余额展示'], not_for: ['新的状态 owner'], easily_confused_with: [], status: 'recommended', notes: '读取既有余额，避免新增平行状态。' }] }));
      const architecture = '# 大架构背景\n' + 'x'.repeat(15_500);
      put(root, 'knowledge/architecture.md', architecture);
      const args = { projectRoot: root, frameworkRoot, phase: 'review', role: 'verifier' as const, targetFiles: ['src/demo/value.ts'] };
      const view = assembleKnowledge(args);
      const files = knowledgeContextFiles(view);
      assert.equal(files.find(file => file.label === 'knowledge/architecture.md')?.kind, 'path');
      assert(files.find(file => file.label === 'knowledge/components.yaml')?.content.includes('normal-component-card'));
      assert(files.find(file => file.label === 'knowledge/curated.yaml')?.content.includes('normal-component-card'));
      const material = buildVerifierMaterialView({ projectRoot: root, frameworkRoot, feature: 'demo', phase: 'review', gateFingerprint: null, phaseRuleText: '', templateText: '', checks: [], contextFiles: files });
      assert(material.files.some(file => file.path === 'knowledge/architecture.md' && file.sha256), 'architecture 路径仍绑定实际字节');
      assert.equal(assembleKnowledge({ ...args, role: 'author' }).entries.find(entry => entry.kind === 'architecture')?.content, architecture);
      assert.equal(assembleKnowledge({ ...args, phase: 'plan' }).entries.find(entry => entry.kind === 'architecture')?.content, architecture);
      assert.equal(assembleKnowledge({ ...args, phase: undefined, role: 'author', skill: 'component-design' }).entries.find(entry => entry.kind === 'architecture')?.content, architecture);
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  } },
  { name: 'design materialization consumes optional extension key before any blueprint; unconfigured asset does not fail docs', run() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-design-'));
    try {
      const config = seed(root); config.project_profile = { name: 'hmos-app' }; config.materialized_adapters = ['cursor', 'claude']; put(root, 'framework.config.json', JSON.stringify(config)); clearFrameworkConfigCache();
      materializeExtensions(root, frameworkRoot);
      assert(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8').includes('未声明可选资产'));
      const docs = validateProfileSkillAssetsForProject(root, { kind: 'standalone', projectRoot: root, frameworkRoot, frameworkRel: '' });
      assert(docs.ok, docs.errors.join('\n'));
      put(root, 'custom/extensions/knowledge/design.md', '# design fact\n须脱敏日志。');
      put(root, 'custom/extensions/manifest.yaml', 'schema_version: "1.1"\nname: knowledge-test\nprovides:\n  skill_assets:\n    component-design:\n      knowledge: knowledge/design.md\n');
      materializeExtensions(root, frameworkRoot);
      for (const file of ['AGENTS.md', 'CLAUDE.md']) assert(fs.readFileSync(path.join(root, file), 'utf8').includes('custom/extensions/knowledge/design.md'));
      const view = assembleKnowledge({ projectRoot: root, frameworkRoot, skill: 'component-design' });
      assert(renderKnowledge(view).includes('须脱敏日志'));
      assert(inspectInstanceExtensions(root, frameworkRoot).rows.some(row => row.source === 'custom/extensions/knowledge/design.md' && row.consumer.includes('P1 discovery')));
      assert(!fs.existsSync(path.join(root, 'doc/features')));
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  } },
  { name: 'typed and legacy verifier collectors share actual knowledge and source fingerprints', run() {
    const { root, frameworkRoot: fw, feature } = setupRunlessProject();
    try {
      seed(root);
      const specOnly = 'custom/extensions/knowledge/spec-only.md';
      put(root, specOnly, '# 仅 spec 使用的术语整理要求\n');
      put(root, 'custom/extensions/manifest.yaml', 'schema_version: "1.1"\nname: knowledge-isolation\nprovides:\n  knowledge:\n    - { path: knowledge/spec-only.md, summary: 仅 spec 使用, audience: [spec] }\n');
      const contractsFile = featureFilePath(root, feature, 'contracts.yaml');
      const contracts = YAML.parse(fs.readFileSync(contractsFile, 'utf8'));
      const targetFiles = ['src/demo/value.ts', ...Array.from({ length: 200 }, (_, index) => `src/demo/target-${index + 1}.ts`)];
      for (const file of targetFiles.slice(1)) put(root, file, 'export const target = 1;\n');
      contracts.files = targetFiles; fs.writeFileSync(contractsFile, YAML.stringify(contracts));
      const loader = new SpecLoader(root, undefined, undefined, fw);
      const resolved = resolveCapabilityInputs({ projectRoot: root, frameworkRoot: fw, feature, phase: 'review', track: 'full',
        inputContext: { schema_version: '1.1', subject: { feature }, obligations: {}, required_outputs: [] } }).inputs!;
      assert(resolved && Object.keys(resolved.values).length);
      const collect = (typed: boolean) => collectContextFiles(loader, { kind: 'consumer', projectRoot: root, frameworkRoot: fw, frameworkRel: 'framework' }, 'review', feature,
        loader.loadFeatureSpec(feature, typed ? resolved : undefined), typed ? { resolvedInputs: resolved } : undefined);
      for (const typed of [false, true]) {
        const files = collect(typed);
        for (const name of ['knowledge/practices.md', 'knowledge/architecture.md', 'knowledge/components.yaml', 'src/demo/value.ts']) assert(files.some(file => file.label === name), `${typed}: ${name}`);
        assert.equal(files.filter(file => targetFiles.includes(file.label)).length, 201, '合同明确的第 201 个目标不能丢失');
        const prompt = assembleAIPrompt(path.join(fw, 'harness'), root, 'review', feature, files, '{}', '', undefined, undefined, fw);
        assert(prompt.includes('shared-value') && prompt.includes('knowledge/architecture.md'));
        assert.equal(files.find(file => file.label === 'knowledge/architecture.md')?.kind, 'path');
      }
      const material = () => buildVerifierMaterialView({ projectRoot: root, frameworkRoot: fw, feature, phase: 'review', resolvedInputs: resolved,
        gateFingerprint: null, phaseRuleText: '', templateText: '', checks: [], contextFiles: collect(true) });
      const before = material(); put(root, 'src/demo/value.ts', 'export const value = 2;\n');
      assert.notEqual(material().material_sha256, before.material_sha256, '真实引用源码变化必须改变材料');
      assert(!collect(true).some(file => file.label === specOnly), 'spec-only 知识不得送入 review');
      const sourceChanged = material(); put(root, specOnly, '# 仅 spec 使用的新术语整理要求\n');
      assert.equal(material().material_sha256, sourceChanged.material_sha256, '真实不适用知识变化不能改变 review 材料');
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  } },
  { name: 'real prepare-scope CLI supplies author knowledge without freezing a new run', run() {
    const { root, frameworkRoot: fw, feature } = setupRunlessProject({ chain: ['spec'], completionTarget: 'request' });
    try {
      seed(root);
      const result = cli(root, 'scripts/goal-mode-entry.ts', ['--prepare-scope', '--completion-target', 'request', '--requested-phases', 'spec', '--requested-results', '显示余额',
        '--feature', feature, '--project-root', root, '--framework-root', fw, '--overwrite', '--requirement', '显示 balance']);
      assert.equal(result.status, 0, result.stderr + result.stdout);
      const output = JSON.parse(result.stdout);
      assert(output.knowledge.some((item: { instructions: string }) => item.instructions.includes('余额不是交易列表')));
      assert(!fs.existsSync(path.join(root, 'doc/features', feature, 'execution-scope.json')));
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  } },
  { name: 'prepare-scope reports knowledge after a real binding drift but keeps failure exit and written-candidate truth', run() {
    for (const stale of [false, true]) {
      const { root, frameworkRoot: fw, feature } = setupRunlessProject();
      try {
        seed(root);
        let preload: string | undefined;
        if (stale) {
          // 测试侧在真实 candidate 返回后改原文件，原 readBoundInput 仍执行全部校验；不加 production hook。
          preload = path.join(root, 'after-prepare.cjs');
          put(root, 'after-prepare.cjs', [
            `require(${JSON.stringify(require.resolve('ts-node/register/transpile-only'))});`,
            `const track = require(${JSON.stringify(require.resolve('../../scripts/utils/feature-track'))});`,
            'const prepare = track.prepareFeatureScopeCandidate;',
            'track.prepareFeatureScopeCandidate = input => {',
            '  const prepared = prepare(input);',
            "  if (!prepared.scope.obligations.some(item => item.basis.some(binding => binding.input_id === 'contracts'))) throw new Error('test requires a real contracts binding');",
            `  const file = ${JSON.stringify(featureFilePath(root, feature, 'contracts.yaml'))};`,
            `  const yaml = require(${JSON.stringify(require.resolve('yaml'))});`,
            "  const contracts = yaml.parse(require('fs').readFileSync(file, 'utf8'));",
            "  contracts.files.push('src/demo/after-prepare.ts');",
            "  require('fs').writeFileSync(file, yaml.stringify(contracts));",
            '  return prepared;',
            '};',
          ].join('\n'));
        }
        const result = cli(root, 'scripts/goal-mode-entry.ts', ['--prepare-scope', '--completion-target', 'feature', '--requested-phases', 'coding,review,ut', '--requested-results', '显示余额',
          '--feature', feature, '--project-root', root, '--framework-root', fw, '--overwrite', '--requirement', '显示 balance'], preload);
        const output = JSON.parse(result.stdout);
        assert(output.written && fs.existsSync(path.join(root, output.candidate)), '候选已写的事实应保留');
        assert(output.knowledge.some((item: { instructions: string }) => item.instructions.includes('knowledge/modules.yaml')), '原生索引仍须送达');
        if (stale) {
          assert.notEqual(result.status, 0, result.stderr);
          assert(output.explanation.includes('契约绑定读取失败') && output.explanation.includes('本次准备未通过'));
          assert(output.knowledge.every((item: { notices: string[] }) => item.notices.some(notice => notice.includes('以下仅提供无契约的知识索引'))));
          assert(result.stderr.includes('重新运行 --prepare-scope'));
        } else assert.equal(result.status, 0, result.stderr + result.stdout);
      } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
    }
  } },
  { name: 'real request prepare sends knowledge and preserves feature identity isolation', run() {
    const f = requestFixture();
    try {
      seed(f.root);
      put(f.root, f.options.requestFile, JSON.stringify({ ...f.request, requested_result: '核对 balance' }));
      const result = cli(f.root, 'harness-runner.ts', ['--project-root', f.root, '--framework-root', f.framework, '--phase', 'review', '--request-file', f.options.requestFile, '--report-dir', f.options.reportDir, '--prepare-request']);
      assert.equal(result.status, 0, result.stderr + result.stdout);
      const output = JSON.parse(result.stdout); assert(output.knowledge.instructions.includes('余额不是交易列表')); assert(!('feature' in output));
      assert.equal(fs.readFileSync(path.join(f.root, 'doc/features/live/context/facts.md'), 'utf8'), 'active Feature evidence\n');
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  } },
  { name: 'custom workflow global verifier reaches production Step 4 with global-only context', run() {
    const { root, frameworkRoot: fw } = setupRunlessProject();
    try {
      // 只移除本测试的 junction；仅链接已知只读代码/资产目录，其余 runtime 目录全部隔离。
      const harnessLink = path.join(fw, 'harness');
      assert(fs.lstatSync(harnessLink).isSymbolicLink());
      if (process.platform === 'win32') fs.rmdirSync(harnessLink); else fs.unlinkSync(harnessLink);
      fs.mkdirSync(harnessLink);
      const readonlyDirs = new Set(['code-graph', 'graph-extractor', 'node_modules', 'prompts', 'schemas', 'scripts', 'templates']);
      for (const entry of fs.readdirSync(path.join(frameworkRoot, 'harness'), { withFileTypes: true })) {
        const src = path.join(frameworkRoot, 'harness', entry.name), dest = path.join(harnessLink, entry.name);
        if (entry.isDirectory() && readonlyDirs.has(entry.name)) fs.symlinkSync(src, dest, process.platform === 'win32' ? 'junction' : 'dir');
        else if (entry.isDirectory()) fs.mkdirSync(dest);
        else fs.copyFileSync(src, dest);
      }
      for (const runtimeDir of ['reports', 'state', 'trace']) assert(!fs.lstatSync(path.join(harnessLink, runtimeDir)).isSymbolicLink(), runtimeDir);
      const config = seed(root); config.materialized_adapters = ['claude']; put(root, 'framework.config.json', JSON.stringify(config));
      put(root, 'framework.local.json', JSON.stringify({ schema_version: '1.0', agent_adapter: 'claude' })); put(root, 'CLAUDE.md', '# test');
      put(root, 'knowledge/modules.yaml', 'schema_version: "1.0"\nmodules: []\n');
      fs.unlinkSync(path.join(root, 'knowledge/components.yaml'));
      const workflow = YAML.parse(fs.readFileSync(path.join(fw, 'workflows/d1.workflow.yaml'), 'utf8'));
      workflow.artifacts.find((artifact: { id: string }) => artifact.id === 'catalog').verifier_prompt = 'prompts/verify-review.md';
      put(fw, 'workflows/d1.workflow.yaml', YAML.stringify(workflow));
      const result = cli(root, 'harness-runner.ts', ['--project-root', root, '--framework-root', fw, '--phase', 'catalog']);
      const reportDir = featurePhaseReportsDir(root, '_global', 'catalog', fw);
      assert(fs.existsSync(path.join(reportDir, 'ai-prompt.md')), result.stderr + result.stdout);
      const prompt = fs.readFileSync(path.join(reportDir, 'ai-prompt.md'), 'utf8');
      assert(prompt.includes('knowledge/modules.yaml') && prompt.includes('knowledge/terms.yaml'), result.stdout + '\nPROMPT\n' + prompt.slice(-6000));
      assert(!prompt.includes('knowledge/practices.md'), 'global 不得混入 Feature 资料');
      assert(fs.readdirSync(reportDir).some(file => /^verifier.material./.test(file)), 'Step 4 必须实际写材料');
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  } },
];

export async function runAll(): Promise<UnitCaseResult[]> {
  const out: UnitCaseResult[] = [];
  for (const test of cases) {
    try { await test.run(); out.push({ name: test.name, ok: true }); }
    catch (error) { out.push({ name: test.name, ok: false, error: (error as Error).stack }); }
  }
  return out;
}
