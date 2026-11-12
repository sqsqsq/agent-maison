// ============================================================================
// generic profile：无 coding-host 时 check-coding 必须返回 coding_host_missing
// ============================================================================

import * as path from 'path';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as YAML from 'yaml';
import { spawnSync } from 'child_process';
import { clearFrameworkConfigCache } from '../../config';
import { AstAnalyzer } from '../../scripts/utils/ast-analyzer';
import { checkArchitectureFiles } from '../../scripts/check-coding';
import type { CheckContext } from '../../scripts/utils/types';
import codingChecker from '../../scripts/check-coding';
import { withDefaultLayoutFields } from '../utils/layout-test-helper';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const PROFILES_ROOT = path.resolve(__dirname, '..', '..', '..', '..', 'framework', 'profiles');
const genericProfileDir = path.join(PROFILES_ROOT, 'generic');

function architectureProbe(run: (root: string, check: (source: string) => ReturnType<typeof checkArchitectureFiles>) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-module-exports-'));
  const write = (file: string, content: string): void => { const abs = path.join(root, file); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, content); };
  try {
    clearFrameworkConfigCache();
    write('framework.config.json', JSON.stringify({ project_profile: { name: 'generic' }, architecture: {
      outer_layers: [{ id: 'src', can_depend_on: [], intra_layer_deps: 'dag' }], module_inner_layers: ['shared'],
      inner_dependency_direction: 'upward', cross_module_exports_file: 'index.ts' } }));
    write('doc/module-catalog.yaml', YAML.stringify({ schema_version: '1.0', modules: ['A', 'B'].map(name => ({ name, layer: 'src', entry_file: `src/${name}/index.ts` })) }));
    for (const name of ['A', 'B']) { write(`src/${name}/private.ts`, 'export const value = 1;\n'); write(`src/${name}/index.ts`, "export { value } from './private';\n"); }
    write('src/B/oh-package.json5', '{"name":"@sample/b"}');
    write('package.json', '{"dependencies":{"external-lib":"1.0.0"}}');
    write('src/A/main.ts', '');
    run(root, source => { write('src/A/main.ts', source); return checkArchitectureFiles(root, ['src/A/main.ts'], { phase: 'coding', structure_checks: {} } as any); });
  } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
}

export async function runAll(): Promise<UnitCaseResult[]> {
  const cases: Array<{ name: string; run: () => Promise<void> }> = [
    {
      name: 'check-coding: generic 无 profileCodingHost → coding_host_missing BLOCKER',
      run: async () => {
        const ctx: CheckContext = withDefaultLayoutFields({
          phase: 'coding',
          feature: 'probe',
          projectRoot: process.cwd(),
          phaseRule: {
            phase: 'coding',
            structure_checks: {},
            semantic_checks: {},
            traceability_checks: {},
          } as any,
          featureSpec: {
            feature: 'probe',
            contracts: {
              feature: 'probe',
              source: 'plan.md',
              version: '1',
              module_dependencies: [],
              files: [],
              modules: [],
            } as any,
          },
          resolvedProfile: {
            name: 'generic',
            profileDir: genericProfileDir,
            yaml: {} as any,
            phasesDisabled: new Set(),
            capabilities: {},
            personalPrerequisites: {},
          },
        });
        const results = await codingChecker.check(ctx);
        const hit = results.find(r => r.id === 'coding_host_missing');
        assert.ok(hit, '必须产出 coding_host_missing');
        assert.strictEqual(hit!.status, 'FAIL');
        assert.strictEqual(hit!.severity, 'BLOCKER');
      },
    },
  ];

  cases.push(
    { name: 'cross-module exports: ArkTS SDK import passes direct architecture CLI without swallowing vendor scopes', run: async () => architectureProbe((root, check) => {
      assert.equal(check("import { collections } from '@arkts.collections';\n").find(item => item.id === 'inter_module_dependency')?.status, 'PASS');
      const cli = spawnSync(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'), path.resolve(__dirname, '../../scripts/compile.ts'),
        '--project-root', root, '--architecture-only', '--target', 'src/A/main.ts', '--json'], { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', timeout: 30000 });
      assert.equal(cli.status, 0, cli.stderr + cli.stdout); assert.equal(JSON.parse(cli.stdout).status, 'PASS');
      assert.equal(check("import vendor from '@arkts-vendor/api';\n").find(item => item.id === 'inter_module_dependency')?.status, 'WARN');
    }) },
    { name: 'cross-module exports: unresolved target cannot hide a proven illegal internal layer direction', run: async () => architectureProbe((root) => {
      const configFile = path.join(root, 'framework.config.json'), config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      config.architecture.module_inner_layers = ['shared', 'data', 'domain', 'presentation'];
      fs.writeFileSync(configFile, JSON.stringify(config)); clearFrameworkConfigCache();
      fs.mkdirSync(path.join(root, 'src/data'), { recursive: true });
      fs.writeFileSync(path.join(root, 'src/data/bad.ts'), "import { Bad } from '../presentation/bad';\nexport const bad = Bad;\n");
      assert(!fs.existsSync(path.join(root, 'src/presentation/bad.ts')));
      const checks = checkArchitectureFiles(root, ['src/data/bad.ts'], { phase: 'coding', structure_checks: {} } as any);
      assert.equal(checks.find(check => check.id === 'layer_compliance')?.status, 'FAIL');
      assert.equal(checks.find(check => check.id === 'inter_module_dependency')?.status, 'WARN');
    }) },
    { name: 'cross-module exports: same-layer deep import fails the shared Feature/direct predicate', run: async () => architectureProbe((root, check) => {
      const results = check("import {\n value\n} from '../B/private';\n");
      assert.equal(results.find(item => item.id === 'inter_module_dependency')?.status, 'FAIL');
      const analyzer = new AstAnalyzer(root);
      assert(analyzer.checkArchLayerCompliance(analyzer.analyzeFile('src/A/main.ts')).some(item => item.message.includes('必须经出口')));
      assert.equal(check("import * as B from '@sample/b/private';\n").find(item => item.id === 'inter_module_dependency')?.status, 'FAIL');
    }) },
    { name: 'cross-module exports: same-module, SDK, external package and real public entries remain valid', run: async () => architectureProbe((_root, check) => {
      const results = check("import { value } from './private';\nimport { value as other } from '../B';\nimport * as B from '@sample/b';\nimport { UIContext } from '@kit.ArkUI';\nimport lib from 'external-lib';\n");
      assert.equal(results.find(item => item.id === 'inter_module_dependency')?.status, 'PASS', JSON.stringify(results));
    }) },
    { name: 'cross-module exports: configured TS aliases resolve, opaque aliases and dynamic targets remain unverified', run: async () => architectureProbe((root, check) => {
      fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@local/*': ['src/*'] } } }));
      assert.equal(check("import { value } from '@local/B/private';\n").find(item => item.id === 'inter_module_dependency')?.status, 'FAIL');
      assert.equal(check("import { value } from '@local/B/index';\n").find(item => item.id === 'inter_module_dependency')?.status, 'PASS');
      const unresolved = check("import { value } from '@opaque/alias';\nconst module = import(target);\n").find(item => item.id === 'inter_module_dependency');
      assert.equal(unresolved?.status, 'WARN'); assert(unresolved?.details.includes('<dynamic import>'));
    }) },
    { name: 'cross-module exports: existing local file dependency aliases keep the same entry boundary', run: async () => architectureProbe((root, check) => {
      fs.writeFileSync(path.join(root, 'src/A/oh-package.json5'), '{"dependencies":{"@alias/b":"file:../B"}}');
      assert.equal(check("import { value } from '@alias/b/private';\n").find(item => item.id === 'inter_module_dependency')?.status, 'FAIL');
      assert.equal(check("import { value } from '@alias/b';\n").find(item => item.id === 'inter_module_dependency')?.status, 'PASS');
    }) },
  );
  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      await c.run();
      out.push({ name: c.name, ok: true });
    } catch (err) {
      out.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  }
  return out;
}
