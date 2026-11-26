import * as fs from 'fs';

import * as os from 'os';

import * as path from 'path';

import { spawnSync } from 'child_process';

import { clearFrameworkConfigCache, loadFrameworkConfig } from '../../config';

import { loadResolvedProfile } from '../../profile-loader';

import { __testing_setVisualDiffOcrFn, checkVisualDiff, hashScreenshotFile } from '../../../profiles/hmos-app/harness/visual-diff-check';

import { type HarnessFidelityContextFields } from '../../harness-runner';

import type { CheckContext, CheckResult } from '../../scripts/utils/types';

import { resolveExecutionScope, executionScopeFingerprint } from '../../scripts/utils/execution-scope';
import { freezeFeatureExecutionScope } from '../../scripts/utils/feature-execution-scope';

/** Existing stage delivery only; fixtures that author a 1.2 candidate must freeze that candidate themselves. */
export function freezeExistingGoalDelivery(projectRoot: string, feature: string): void {
  const phases = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];
  const scope = resolveExecutionScope({ contract_fingerprints: [], request: { completion_target: 'feature', requested_results: ['既有开卡交付'], requested_phases: phases }, facts: [] }, {
    schema_version: '1.2', name: 'fixture-existing-delivery', auto_chain: phases,
    artifacts: phases.map(id => ({ id, scope: 'feature', requires: [], obligation_provider_id: `obligations.${id}` })),
  });
  freezeFeatureExecutionScope({ projectRoot, feature, scope, candidateFingerprint: executionScopeFingerprint(scope) });
}

const REPO_ROOT = path.resolve(__dirname, '../../..');

export const PRODUCT_FILE = '02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets';

export const FEATURE = 'bc-openCard';

function git(root: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
}

export function writeFile(root: string, rel: string, content: string): void {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

export function setupGoalRuntimeHost(adapter = 'cursor', existingDelivery = true): { root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-v23-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  writeFile(root, 'framework.config.json', JSON.stringify({
    schema_version: '1.1',
    project_name: 'IntTest',
    active_workflow: 'spec-driven',
    project_profile: { name: 'hmos-app', sub_variant: 'app' },
    architecture: {
      outer_layers: [{ id: '02-Feature', can_depend_on: [], intra_layer_deps: 'dag' }],
      module_inner_layers: ['shared'],
      inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ets',
    },
    paths: { features_dir: 'doc/features', docs_committed: false, reports_dir_pattern: 'doc/features/<feature>/<phase>/reports' },
    materialized_adapters: [adapter],
  }, null, 2));
  writeFile(root, 'AGENTS.md', '# AGENTS\n');
  const deveco = path.join(root, 'fake-deveco');
  const hvigorBin = path.join(
    deveco, 'tools', 'hvigor', 'bin',
    process.platform === 'win32' ? 'hvigorw.bat' : 'hvigorw',
  );
  fs.mkdirSync(path.dirname(hvigorBin), { recursive: true });
  fs.writeFileSync(hvigorBin, '');
  writeFile(root, 'framework.local.json', JSON.stringify({
    schema_version: '1.0',
    agent_adapter: adapter,
    toolchain: { devEcoStudio: { installPath: deveco.split(path.sep).join('/') } },
    vision: {
      canary: {
        adapter, verdict: 'tool_read', probed_at: new Date().toISOString(),
        probed_via: 'interactive', probe_version: 2,
      },
    },
  }, null, 2));
  fs.mkdirSync(path.join(root, 'framework', 'workflows'), { recursive: true });
  writeFile(root, PRODUCT_FILE, 'struct AllBanksPage { build() { Text("x") } }');
  writeFile(root, 'build-profile.json5', JSON.stringify({
    app: { products: [{ name: 'default' }] },
    modules: [{ name: 'FinancialCard', srcPath: './02-Feature/FinancialCard' }],
  }, null, 2));
  // d9e4b7c1 T1：生成物分类器按模块根 oh-package.json5 核 HAR_VERSION——夹具补齐
  writeFile(root, '02-Feature/FinancialCard/oh-package.json5',
    '{ "name": "financialcard", "version": "1.0.0" }');
  clearFrameworkConfigCache();
  // build 身份（P1-1 谓词④）：actionable 要求当前 build fingerprint 可算且与
  // evaluated_build_fingerprint 相等。生产口径 = device-test-install.meta.json 的
  // hapPath 内容哈希前 12 hex——夹具按同口径造。
  writeFile(root, 'build/default/app.hap', 'hap-bytes-v1');
  writeFile(root, `doc/features/${FEATURE}/testing/reports/device-test-install.meta.json`,
    JSON.stringify({ hapPath: 'build/default/app.hap' }));
  writeFile(root, `doc/features/${FEATURE}/spec/spec.md`, '# spec\n');
  writeFile(root, `doc/features/${FEATURE}/acceptance.yaml`, `feature: ${FEATURE}\ncriteria: []\n`);
  // c4e8b1d3 G1-1：plan 正常 PASS advance 前 runner 必建 pass snapshot——PASS 态要求
  // plan.md + contracts.yaml 在盘（缺任一 = 不变量违例 halt）。夹具按真实 plan PASS 形态造。
  writeFile(root, `doc/features/${FEATURE}/plan/plan.md`, [
    '# plan',
    '## Scope 声明与继承',
    '```yaml',
    'in_scope_modules:',
    '  - FinancialCard',
    'out_of_scope_modules: []',
    'rationale: integration fixture',
    '```',
  ].join('\n'));
  writeFile(root, `doc/features/${FEATURE}/contracts.yaml`,
    `feature: ${FEATURE}\nmodules:\n  - name: FinancialCard\n    package_path: 02-Feature/FinancialCard\nfiles:\n  - ${PRODUCT_FILE}\n`);
  // These stage tests resume an existing standalone delivery, not a new design request.
  // Freeze its explicitly requested duties with the production scope resolver/writer.
  if (existingDelivery) {
    freezeExistingGoalDelivery(root, FEATURE);
  }
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'init']);
  return { root };
}

export function currentBuildFpOf(root: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resolveCurrentBuildFingerprint } = require('../../../profiles/hmos-app/harness/build-fingerprint') as {
    resolveCurrentBuildFingerprint: (r: string, f: string, ph?: string) => string | null;
  };
  const fp = resolveCurrentBuildFingerprint(root, FEATURE, 'testing');
  assert(!!fp, '夹具须能算出 build fingerprint（install meta + hap 已造）');
  return fp!;
}

export function writeVisualDiff(
  root: string,
  screens: Array<{
    id: string; verdict: string; mustFix: string[];
    freshHash?: boolean; hashOverride?: string;
    /** false=不写 evaluated_build_fingerprint（缺身份）；字符串=错误值 */
    buildFp?: boolean | string;
    /** false=不写 evaluated_screenshot_hash（缺身份） */
    withEvalHash?: boolean;
    /** true=evaluation_invalidated（评估被判无效待重评） */
    invalidated?: boolean;
    /** visual-confirm 人签通道：真人人签（isHumanVerified 谓词校验） */
    confirmed_by?: string;
    /** adjudicated-repair-loop：结构化 defects（进入 signal@1 身份 + defect-review 复核） */
    defects?: Array<{
      class?: string; element?: string; bbox?: number[]; severity: string; note: string;
      must_fix_refs?: number[];
    }>;
  }>,
): void {
  const rows = screens.map(sc => {
    const shotRel = `doc/features/${FEATURE}/device-testing/device-screenshots/shot-${sc.id}.png`;
    writeFile(root, shotRel, `png-bytes-${sc.id}`);
    const realHash = hashScreenshotFile(path.join(root, shotRel));
    const fp = sc.buildFp === false ? undefined
      : typeof sc.buildFp === 'string' ? sc.buildFp : currentBuildFpOf(root);
    return {
      screen_id: sc.id,
      screenshot_path: shotRel,
      verdict: sc.verdict,
      must_fix: sc.mustFix,
      screenshot_hash: realHash,
      ...(sc.withEvalHash === false ? {} : {
        evaluated_screenshot_hash: sc.hashOverride ?? (sc.freshHash === false ? 'deadbeefdeadbeef' : realHash),
      }),
      ...(fp === undefined ? {} : { evaluated_build_fingerprint: fp }),
      ...(sc.invalidated ? { evaluation_invalidated: true } : {}),
      ...(sc.confirmed_by ? { confirmed_by: sc.confirmed_by } : {}),
      ...(sc.defects ? { defects: sc.defects } : {}),
    };
  });
  writeFile(
    root,
    `doc/features/${FEATURE}/device-testing/device-screenshots/visual-diff.json`,
    JSON.stringify({ schema_version: '1.0', screens: rows }, null, 2),
  );
}

export function runRealVisualGate(root: string, feature: string, fields: Partial<HarnessFidelityContextFields>): CheckResult {
  const ctx = {
    phase: 'testing', feature, projectRoot: root, frameworkRoot: REPO_ROOT,
    phaseRule: { phase: 'testing', structure_checks: { visual_diff: { description: 'visual diff' } } },
    featureSpec: { feature },
    resolvedProfile: loadResolvedProfile(root, loadFrameworkConfig(root)),
    ...fields,
  } as unknown as CheckContext;
  __testing_setVisualDiffOcrFn((() => ({ ok: false, error: 'ocr worker produced no output' })) as never);
  let gate: CheckResult | undefined;
  try {
    gate = checkVisualDiff(ctx).find(c => (c.structured as { kind?: string } | undefined)?.kind === 'visual_diff');
  } finally {
    __testing_setVisualDiffOcrFn(null);
  }
  assert(!!gate, '真实 gate 须产出 visual_diff 结论');
  return gate!;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

export function setupMinimalHost(feature: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-drv-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  writeFile(root, 'framework.config.json', JSON.stringify({
    schema_version: '1.1',
    project_name: 'GoalDriverHost',
    active_workflow: 'spec-driven',
    project_profile: { name: 'generic' },
    paths: { features_dir: 'doc/features', docs_committed: false },
    materialized_adapters: ['cursor'],
  }, null, 2));
  writeFile(root, 'AGENTS.md', '# AGENTS\n');
  writeFile(root, 'framework.local.json', JSON.stringify({ schema_version: '1.0', agent_adapter: 'cursor' }, null, 2));
  writeFile(root, 'doc/module-catalog.yaml', 'schema_version: "1.0"\nmodules: []\n');
  writeFile(root, 'doc/glossary.yaml', 'schema_version: "1.0"\nterms: []\n');
  writeFile(root, `doc/features/${feature}/spec/spec.md`, '# spec\n');
  // spec PASS 冻结清单要求（T2 5a-1：#8 翻转后 seed 场景要真跑通 spec 收官）
  writeFile(root, `doc/features/${feature}/acceptance.yaml`, `feature: ${feature}\ncriteria: []\n`);
  // 部分 utils 在 phase 期自调 inferRepoLayout（不走注入缝）——generic 场景现在也要
  // 跑真 phase（#8 续跑收官），同样需要 framework tree 喂饱探测（与 hmos 段同理由）
  fs.mkdirSync(path.join(root, 'framework', 'workflows'), { recursive: true });
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'init']);
  return root;
}
