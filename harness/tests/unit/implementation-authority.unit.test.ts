import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as YAML from 'yaml';
import { clearFrameworkConfigCache } from '../../config';
import coding, { checkDiffWithinScope } from '../../scripts/check-coding';
import { checkContractFileReferenceClosure } from '../../scripts/check-plan';
import { compareAuthoritativeContent } from '../../scripts/utils/blueprint-skill-projection';
import { implementationFiles, implementationChangeContext, resolveImplementationScope } from '../../scripts/utils/diff-scope';
import { resolvePhaseWriteBoundary, resolvePhasePathOwnership } from '../../scripts/utils/phase-write-boundary';
import { buildGoalManifestFromInput } from '../../scripts/utils/goal-manifest';
import { createGoalRun } from '../../scripts/utils/goal-run-creation';
import { profileCodingHost } from '../../../profiles/hmos-app/harness/coding-host-rules';
import type { CheckContext, ContractsSpec } from '../../scripts/utils/types';

const frameworkRoot = path.resolve(__dirname, '../../..');
const history = path.resolve(__dirname, '../fixtures/host-recovery-history/20261020/20261020T093340Z-1a0796');
const feature = 'implementation-authority';
const modulePath = '02-Feature/WalletMain';
const resource = `${modulePath}/src/main/resources/base/element/string.json`;
const page = `${modulePath}/src/main/ets/pages/CardPage.ets`;

function write(root: string, file: string, contents: string): void {
  const dest = path.join(root, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, contents);
}
function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
async function withProject(run: (ctx: CheckContext) => void | Promise<void>): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'implementation-authority-'));
  const oldRun = process.env.MAISON_GOAL_RUN_ID;
  delete process.env.MAISON_GOAL_RUN_ID;
  try {
    write(root, 'framework.config.json', JSON.stringify({ schema_version: '1.1', project_name: 'authority',
      project_profile: { name: 'hmos-app', sub_variant: 'app' }, materialized_adapters: ['cursor'],
      architecture: { outer_layers: [{ id: '02-Feature', can_depend_on: [], intra_layer_deps: 'dag' }],
        module_inner_layers: ['shared', 'presentation'], inner_dependency_direction: 'upward', cross_module_exports_file: 'Index.ets' },
      paths: { features_dir: 'doc/features' } }));
    write(root, resource, '{"string":[]}');
    write(root, '02-Feature/AccountManager/src/main/ets/Account.ets', 'export class Account {}');
    git(root, 'init', '-q'); git(root, 'config', 'user.name', 'test'); git(root, 'config', 'user.email', 'test@test');
    git(root, 'config', 'commit.gpgsign', 'false'); git(root, 'add', '-A'); git(root, 'commit', '-qm', 'base');
    clearFrameworkConfigCache();
    const contracts: ContractsSpec = { feature, source: 'test', version: '1.0', module_dependencies: {}, data_models: [], interfaces: [], components: [], files: [page], modules: [{ name: 'WalletMain', package_path: modulePath, layer: '02-Feature', format: 'HAR', change_type: 'modify' }] };
    await run({ projectRoot: root, frameworkRoot, feature, phase: 'coding', phaseRule: {},
      resolvedProfile: { name: 'hmos-app', capabilities: { 'coding.visual_parity': { severity: 'SKIP' }, 'coding.compile': { severity: 'SKIP' } }, profileDir: path.join(frameworkRoot, 'profiles/hmos-app') },
      featureSpec: { feature, contracts } } as CheckContext);
  } finally {
    if (oldRun === undefined) delete process.env.MAISON_GOAL_RUN_ID; else process.env.MAISON_GOAL_RUN_ID = oldRun;
    clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true });
  }
}

const cases: Array<{ name: string; run: () => void | Promise<void> }> = [
  { name: 'entry main_pages does not falsely reject a dynamically dispatched NavDestination in views', run: () => withProject(ctx => {
    ctx.featureSpec.contracts!.files = [];
    write(ctx.projectRoot, page, '@Entry @Component struct CardPage { build() { Navigation() {} } }');
    write(ctx.projectRoot, modulePath + '/src/main/ets/views/Detail.ets', '@Component struct Detail { build() { NavDestination() {} } }');
    write(ctx.projectRoot, modulePath + '/src/main/module.json5', JSON.stringify({ module: { type: 'entry', pages: '$profile:main_pages' } }));
    write(ctx.projectRoot, modulePath + '/src/main/resources/base/profile/main_pages.json', JSON.stringify({ src: ['pages/CardPage'] }));
    const gate = () => profileCodingHost.runStructureChecks(ctx, []).find(check => check.id === 'page_registration')!;
    assert.equal(gate().status, 'WARN', gate().details);
    write(ctx.projectRoot, modulePath + '/src/main/resources/base/profile/main_pages.json', JSON.stringify({ src: [] }));
    assert.equal(gate().status, 'FAIL', 'an actual Entry page without a main_pages registration still fails');
  }) },
  { name: 'deleted and renamed code remains visible as baseline evidence in the actual review material', run: () => withProject(ctx => {
    const old = '02-Feature/AccountManager/src/main/ets/Account.ets';
    const next = '02-Feature/AccountManager/src/main/ets/Renamed.ets';
    fs.renameSync(path.join(ctx.projectRoot, old), path.join(ctx.projectRoot, next));
    const context = implementationChangeContext(ctx.projectRoot, feature);
    assert(context.some(file => file.content.includes(old) && file.label.includes('actual')));
    assert(context.some(file => file.label.includes(old) && file.content.includes('class Account')));
  }) },
  { name: '1a0796 original contracts and compiler evidence retain the omitted resource; real check permits the repair', run: () => withProject(ctx => {
    const original = YAML.parse(fs.readFileSync(path.join(history, 'contracts.yaml'), 'utf8')) as ContractsSpec;
    assert(!original.files.includes(resource));
    assert(fs.readFileSync(path.join(history, 'hvigor-build.log'), 'utf8').includes('opening_'));
    const recorded = fs.readFileSync(path.join(history, 'coding-agent-line47.json'), 'utf8');
    assert(recorded.includes('coding_compile') && recorded.includes('diff_within_scope'));
    write(ctx.projectRoot, resource, '{"string":[{"name":"opening_title","value":"银行卡"}]}');
    ctx.featureSpec.contracts = original;
    assert.equal(checkDiffWithinScope(ctx)[0].status, 'PASS');
    assert(implementationFiles(ctx.projectRoot, feature, original).includes(resource));
    assert.equal(checkContractFileReferenceClosure(ctx)[0].status, 'PASS');
  }) },
  { name: 'forecast module exclusions do not deny an actual necessary project change', run: () => withProject(ctx => {
    write(ctx.projectRoot, '02-Feature/AccountManager/src/main/ets/Account.ets', 'export class Account { opened = true }');
    const result = checkDiffWithinScope(ctx)[0]; assert.equal(result.status, 'PASS', result.details);
    assert(implementationFiles(ctx.projectRoot, feature, ctx.featureSpec.contracts).some(file => file.includes('Account.ets')));
  }) },
  { name: 'an explicit original request Scope remains a boundary, irrespective of planning extensions', run: () => withProject(ctx => {
    const requirement = '# Scope\n```yaml\nin_scope_modules: [WalletMain]\nout_of_scope_modules: [AccountManager]\nrationale: 用户明确限定\n```';
    const manifest = buildGoalManifestFromInput({ feature, run_id: 'explicit-scope', requirement, start_phase: 'plan', end_phase: 'coding', unattended: { write_mode: 'full-access', approval_mode: 'never' } }, { projectRoot: ctx.projectRoot });
    createGoalRun({ projectRoot: ctx.projectRoot, manifest, chain: ['plan', 'coding'] });
    const scope = resolveImplementationScope(ctx.projectRoot, feature, ctx.featureSpec.contracts!.modules, manifest.run_id);
    assert(scope.explicit); assert(!scope.allowedPrefixes.some(prefix => prefix.includes('AccountManager')));
  }) },
  { name: 'private file/component/state forecasts can change while real interface contracts remain strict', run() {
    const expected = { files: ['old.ets'], components: [{ name: 'OldPage', file: 'old.ets', linked_functions: ['open-card'] }],
      state_management: [{ data: 'oldState', holder: 'OldPage' }], interfaces: [{ class: 'CardApi', methods: [{ name: 'open', return: 'Card' }] }] };
    const actual = { ...expected, files: ['new.ets', 'helper.ets'], components: [{ name: 'NewPage', file: 'new.ets', linked_functions: ['open-card'] }], state_management: [] };
    assert.equal(compareAuthoritativeContent(expected, actual).state, 'aligned');
    assert.equal(compareAuthoritativeContent({ state_management: [{ data: 'private', publications: ['snapshot'] }] }, { state_management: [{ data: 'renamed', publications: [] }] }).state, 'drift', 'real runtime publication obligations must remain strict');
    assert.equal(compareAuthoritativeContent(expected, { ...actual, interfaces: [{ class: 'CardApi', methods: [{ name: 'open', return: 'void' }] }] }).state, 'drift');
  } },
  { name: 'real page absent from predictions is inspected via module metadata; wrong builder and missing route fail', run: () => withProject(ctx => {
    ctx.featureSpec.contracts!.files = []; ctx.featureSpec.contracts!.components = [];
    write(ctx.projectRoot, page, '@Component struct CardPage { build() { NavDestination() {} } }\n@Builder export function CardPageBuilder() { CardPage() }');
    write(ctx.projectRoot, `${modulePath}/src/main/module.json5`, '{"module":{"type":"har","routerMap":"$profile:route_map"}}');
    const routeFile = `${modulePath}/src/main/resources/base/profile/route_map.json`;
    const route = { name: 'CardPage', pageSourceFile: 'src/main/ets/pages/CardPage.ets', buildFunction: 'CardPageBuilder' };
    const gate = () => profileCodingHost.runStructureChecks(ctx, []).find(check => check.id === 'page_registration')!;
    write(ctx.projectRoot, routeFile, JSON.stringify({ routerMap: [route] })); assert.equal(gate().status, 'PASS', gate().details);
    write(ctx.projectRoot, routeFile, JSON.stringify({ routerMap: [{ ...route, buildFunction: 'MissingBuilder' }] })); assert.equal(gate().status, 'FAIL');
    write(ctx.projectRoot, routeFile, '{"routerMap":[]}'); assert.equal(gate().status, 'FAIL');
  }) },
  { name: 'a missing navigation declaration does not obscure a real unreadable registration file', run: () => withProject(ctx => {
    write(ctx.projectRoot, page, '@Entry @Component struct CardPage { build() { NavDestination() {} } }');
    write(ctx.projectRoot, `${modulePath}/src/main/module.json5`, '{"module":{"pages":"$profile:main_pages"}}');
    const result = profileCodingHost.runStructureChecks(ctx, []).find(check => check.id === 'page_registration')!;
    assert.equal(result.status, 'FAIL'); assert(result.details.includes('main_pages'));
  }) },
  { name: 'coding checker analyzes new unpredicted source instead of a blank planned file set', run: () => withProject(async ctx => {
    ctx.featureSpec.contracts!.files = [];
    const source = `${modulePath}/src/main/ets/shared/NewCode.ets`;
    write(ctx.projectRoot, source, 'export function load(): any { return 1; }');
    const prior = process.env.HARNESS_SKIP_HVIGOR; process.env.HARNESS_SKIP_HVIGOR = '1';
    try {
      const checks = await coding.check(ctx);
      assert(!checks.some(check => ['file_completeness', 'plan_file_to_code'].includes(check.id) && check.status === 'SKIP' && check.severity === 'BLOCKER'), 'empty forecasts must not block the coding exit');
      assert.equal(checks.find(check => check.id === 'layer_compliance')?.status, 'PASS', 'root AST must analyze the actual unpredicted source');
      const any = checks.find(check => check.id === 'no_any_type');
      assert(any && any.status !== 'PASS' && any.status !== 'SKIP', JSON.stringify(checks.map(check => [check.id, check.status])));
      assert(any.affected_files?.includes(source));
    } finally { if (prior === undefined) delete process.env.HARNESS_SKIP_HVIGOR; else process.env.HARNESS_SKIP_HVIGOR = prior; }
  }) },
  { name: 'source ownership covers a new actual module but keeps UT/artifact/framework domains separate', run: () => withProject(ctx => {
    write(ctx.projectRoot, `doc/features/${feature}/plan/plan.md`, '# Scope\n```yaml\nin_scope_modules: [WalletMain]\nout_of_scope_modules: []\nrationale: forecast\n```');
    write(ctx.projectRoot, `doc/features/${feature}/contracts.yaml`, YAML.stringify(ctx.featureSpec.contracts));
    const boundary = resolvePhaseWriteBoundary({ projectRoot: ctx.projectRoot, frameworkRoot, feature,
      phaseOrder: ['spec', 'plan', 'coding', 'review', 'ut', 'testing'], track: 'full', profileDir: path.join(frameworkRoot, 'profiles/hmos-app'),
      productLayerDirs: ['02-Feature'], resolveUtSourceRoots: (_root, modules) => modules.map(module => path.join(ctx.projectRoot, module.package_path, 'src/ohosTest')) });
    assert.equal(resolvePhasePathOwnership(boundary, '02-Feature/AccountManager/src/main/ets/New.ets').owner, 'coding');
    assert.equal(resolvePhasePathOwnership(boundary, `${modulePath}/src/ohosTest/Test.ets`).owner, 'ut');
    assert.notEqual(resolvePhasePathOwnership(boundary, `doc/features/${feature}/spec/acceptance.yaml`).owner, 'coding');
    assert.notEqual(resolvePhasePathOwnership(boundary, 'framework/harness/harness-runner.ts').owner, 'coding');
  }) },
];

export async function runAll(): Promise<Array<{ name: string; ok: boolean; error?: string }>> {
  const results = [];
  for (const test of cases) {
    try { await test.run(); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: (error as Error).stack ?? String(error) }); }
  }
  return results;
}
