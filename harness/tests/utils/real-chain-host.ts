// ============================================================================
// real-chain-host.ts — plan d4a1f7c3 §4.1 的真实夹具工程构建代码
// ----------------------------------------------------------------------------
// 消费者：`tests/unit/real-chain.unit.test.ts`（正例，§4）与后续
// `real-chain-seams.unit.test.ts`（负例，§5）。两者共用构建代码、各自造工程。
//
// 造法由 plan §10.1 的 T0 实验钉死，**不得改回轻法**：
//   N：Node 对模块路径做 realpath，junction 的 `framework/harness` 会被解开、
//      子进程 `detectRepoLayout(__dirname)` 解析回源仓并往源仓写产物。故 harness
//      必须**整拷**（`*.ts` + tsconfig* + package.json + 九个子目录），只 junction
//      `harness/node_modules`。`profiles/` 同样整拷——profile 侧模块用
//      `createRequire('../../../harness/harness-runner.ts')`，junction 会让它们
//      realpath 回源仓、与入口形成两套模块级状态。
//   P：框架根必须坐落在宿主根之下（`<hostRoot>/framework`），否则
//      `detectRepoLayout` 把 projectRoot 解析成框架那个 tmp 根，run manifest 找不到。
//      宿主 `.gitignore` 必须含 `framework/`，否则 `git add -A` 把整份框架纳入基线。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { prepareFeatureScopeCandidate } from '../../scripts/utils/feature-track';

export const SOURCE_REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/** 整拷（provision 实测 0.6–0.7 s，见 plan §10.1 N）。 */
function copyDir(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else if (ent.isFile()) fs.copyFileSync(s, d);
  }
}

function link(target: string, linkPath: string): void {
  fs.symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

export function writeHostFile(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

export function git(root: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
}

/**
 * 在 `<hostRoot>/framework` 下 provision 一份可被真 harness 子进程使用的框架根。
 * 返回 harness 目录（子进程 cwd）。
 */
export function provisionFrameworkUnder(hostRoot: string): { frameworkRoot: string; harnessDir: string } {
  const fw = path.join(hostRoot, 'framework');
  const harness = path.join(fw, 'harness');
  fs.mkdirSync(harness, { recursive: true });
  const srcHarness = path.join(SOURCE_REPO_ROOT, 'harness');
  for (const f of fs.readdirSync(srcHarness)) {
    if (f.endsWith('.ts') || f.startsWith('tsconfig') || f === 'package.json') {
      fs.copyFileSync(path.join(srcHarness, f), path.join(harness, f));
    }
  }
  for (const d of ['scripts', 'schemas', 'templates', 'prompts', 'code-graph', 'framework', 'graph-extractor', 'state', 'trace']) {
    copyDir(path.join(srcHarness, d), path.join(harness, d));
  }
  link(path.join(srcHarness, 'node_modules'), path.join(harness, 'node_modules'));
  // framework 资产：其中无 `__dirname` 根检测，junction 安全且省 IO。
  for (const d of ['skills', 'workflows', 'specs', 'templates', 'agents', 'docs']) {
    link(path.join(SOURCE_REPO_ROOT, d), path.join(fw, d));
  }
  // profiles 整拷（见顶部 N）。
  copyDir(path.join(SOURCE_REPO_ROOT, 'profiles'), path.join(fw, 'profiles'));
  fs.copyFileSync(path.join(SOURCE_REPO_ROOT, 'package.json'), path.join(fw, 'package.json'));
  return { frameworkRoot: fw, harnessDir: harness };
}

/**
 * 合成 `profiles/test-chain`：只改 provider 指向，不改任何生产解析。
 *
 * - `spec.*` / `*.visual_parity` / `device_test.visual_diff` 走 **shim**（`require` 回 hmos-app
 *   的真实 provider），使 spec/plan/coding 的视觉链与逐屏判定留在生产实现上；
 * - `device_test.run` 是手写替身（单测里没有真机/hylyre）；
 * - **不声明 `device_capabilities`**（plan §1.1/§8：设备侧零覆盖，就绪门不进）；
 * - UT 执行经 `ut-host-impl.js` 返定值（plan §4.2，照 coverage-evidence 先例）。
 */
export function synthesizeTestChainProfile(frameworkRoot: string): void {
  const dir = path.join(frameworkRoot, 'profiles', 'test-chain');
  const hmos = path.join(frameworkRoot, 'profiles', 'hmos-app');
  fs.mkdirSync(path.join(dir, 'harness', 'providers'), { recursive: true });
  link(path.join(hmos, 'skills'), path.join(dir, 'skills'));

  const cap = (provider: string, severity: string): string => `{ provider: ${provider}, severity: ${severity} }`;
  fs.writeFileSync(path.join(dir, 'profile.yaml'), [
    'name: test-chain',
    'display_name: 确定性输入下的生产验证链',
    'catalog_allowed_module_formats:',
    '  - HAP',
    '  - HAR',
    'detect:',
    '  signature_files: []',
    'phases_disabled: []',
    'capabilities:',
    `  coding.compile: ${cap('none', 'SKIP')}`,
    `  coding.deps_install: ${cap('none', 'SKIP')}`,
    `  coding.lint: ${cap('none', 'SKIP')}`,
    `  ut.compile: ${cap('hvigor_ohostest', 'BLOCKER')}`,
    `  ut.run: ${cap('hvigor_hypium', 'BLOCKER')}`,
    `  device_test.run: ${cap('hylyre', 'BLOCKER')}`,
    `  device_test.build: ${cap('hvigor_app', 'BLOCKER')}`,
    `  device_test.install: ${cap('hdc_app', 'BLOCKER')}`,
    `  spec.visual_handoff: ${cap('script', 'BLOCKER')}`,
    `  spec.ui_spec: ${cap('script_ui_spec', 'BLOCKER')}`,
    `  spec.asset_acquisition: ${cap('script_asset_acquisition', 'MAJOR')}`,
    `  plan.visual_parity: ${cap('script_visual_parity_plan', 'MAJOR')}`,
    `  coding.visual_parity: ${cap('script_visual_parity', 'MAJOR')}`,
    `  device_test.visual_diff: ${cap('hylyre_visual_diff', 'MAJOR')}`,
    'personal_prerequisites: {}',
    '',
  ].join('\n'), 'utf-8');

  // shim：spec/plan/coding 的视觉 provider 与 device_test.visual_diff 留在 hmos-app 的
  // 真实实现上（`checkVisualDiff` 等是纯读盘判定，不碰设备）。
  for (const base of [
    'spec-visual-handoff', 'spec-ui-spec', 'spec-asset-acquisition',
    'plan-visual-parity', 'coding-visual-parity', 'device-test-visual-diff',
  ]) {
    fs.writeFileSync(
      path.join(dir, 'harness', 'providers', `${base}.js`),
      `module.exports = require(${JSON.stringify(path.join(hmos, 'harness', 'providers', base + '.ts'))});\n`,
      'utf-8',
    );
  }

  // device_test 的三个**可执行替身**（build 落 .hap、install 回 hapSha256Full、run 落
  // 合契约的 native trace）。它们太长、且要被人读懂，所以是 `real-chain-providers/` 下的
  // 真文件而不是这里拼出来的字符串；`capability-registry.ts:117-131` 逐项校验
  // id / capability / exports，metadata 以 hmos-app 同名 provider 为准。
  for (const base of ['device-test-build', 'device-test-install', 'device-test-run']) {
    fs.copyFileSync(
      path.join(__dirname, 'real-chain-providers', `${base}.js`),
      path.join(dir, 'harness', 'providers', `${base}.js`),
    );
  }

  // coding host（契约 §3-D②，`profile-host-loader.ts:111` `tryLoadProfileCodingHost`）：
  // 结构 / 溯源两组检查**留在 hmos-app 的真实实现**上，只把 `checkCodingCompile` 换成返定值
  // ——单测里没有 DevEco/hvigor（test-chain 的 `coding.compile` 亦声明 SKIP）。
  fs.writeFileSync(path.join(dir, 'harness', 'coding-host-rules.js'), [
    `const base = require(${JSON.stringify(path.join(hmos, 'harness', 'coding-host-rules.ts'))}).profileCodingHost;`,
    'exports.profileCodingHost = Object.assign({}, base, {',
    '  checkCodingCompile: () => [{',
    "    id: 'coding_compile', category: 'structure', severity: 'BLOCKER', status: 'PASS',",
    "    description: 'coding compile (real-chain seam)', details: 'real-chain seam: 单测无 DevEco/hvigor',",
    '  }],',
    '});',
    '',
  ].join('\n'), 'utf-8');

  // UT 根约定（照 coverage-evidence.unit.test.ts:189 先例）。
  fs.writeFileSync(
    path.join(dir, 'harness', 'profile-path-conventions.js'),
    "exports.resolveUtSourceRoots=(root,modules)=>modules.map(m=>require('path').join(root,m.package_path,'src','ohosTest'));"
    + ' exports.diffExcludeTestPathRegexes=[/\\/src\\/ohosTest\\//];\n',
    'utf-8',
  );

  // UT 执行替身（plan §8 第 2 条：命名/导入/注册三项同样返定值，覆盖面如实记账）。
  fs.writeFileSync(path.join(dir, 'harness', 'ut-host-impl.js'), [
    "const fs=require('fs'),path=require('path');",
    "const pass=id=>[{id,category:'structure',severity:'BLOCKER',status:'PASS',description:id,details:'real-chain seam'}];",
    "const walk=d=>fs.existsSync(d)?fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):/\\.test\\.ets$/.test(e.name)?[path.join(d,e.name)]:[]):[];",
    'exports.utHostImpl={',
    "  loadUtFiles:c=>c.featureSpec.contracts.modules.flatMap(m=>walk(path.join(c.projectRoot,m.package_path,'src','ohosTest','ets','test')).map(p=>({path:path.relative(c.projectRoot,p).replace(/\\\\/g,'/'),content:fs.readFileSync(p,'utf8')}))),",
    "  partitionUtFiles:(c,a)=>({all:a,scoped:a,scopeSources:['production-test-profile']}),",
    "  checkUtFileNaming:()=>pass('ut_file_naming'),",
    "  checkUtFrameworkImport:()=>pass('ut_framework_import'),",
    "  checkUtTscCompiles:()=>pass('ut_tsc_compiles'),",
    "  checkUtHvigorBuild:()=>pass('ut_hvigor_build'),",
    "  checkUtHvigorTest:()=>pass('ut_hvigor_test'),",
    "  checkTestRegistration:()=>pass('test_registration'),",
    '  isSuiteEntryShim:()=>false,',
    '};',
    '',
  ].join('\n'), 'utf-8');
}

export interface RealChainProject {
  root: string;
  /**
   * 本次 goal run 的 id。workflow 1.2 下 `context/facts.md` 的**身份位**必须是它
   * （context-facts.ts:203-205：run 载体的建立事实须绑真实 run_id；无 run 才绑冻结范围指纹）。
   * 由各阶段的 agent 回调从 `ctx.runId` 填——它是 agent 本来就拿得到的调用身份，不是指纹。
   */
  runId?: string;
  frameworkRoot: string;
  harnessDir: string;
  feature: string;
  module: string;
  modulePath: string;
}

export const REAL_CHAIN_FEATURE = 'demo-card';
/**
 * 需求正文的**唯一**出处：候选（`--prepare-scope`）与 goal run 的 `--requirement`
 * 必须逐字相同，否则 `assertCandidateRequirementProvenance` 判 `input binding stale`。
 */
export const REAL_CHAIN_REQUIREMENT = '实现全部银行页的银行列表展示与开卡入口';
const MODULE = 'FinancialCard';
const MODULE_PATH = `02-Feature/${MODULE}`;
export const REAL_CHAIN_SOURCE = `${MODULE_PATH}/src/main/ets/AllBanksPage.ets`;
export const REAL_CHAIN_SOURCE_2 = `${MODULE_PATH}/src/main/ets/BankRepository.ets`;
export const REAL_CHAIN_MODEL = `${MODULE_PATH}/src/main/ets/BankModel.ets`;
export const REAL_CHAIN_SERVICE = `${MODULE_PATH}/src/main/ets/BankService.ets`;
export const REAL_CHAIN_INDEX = `${MODULE_PATH}/index.ets`;
export const REAL_CHAIN_NEW_SOURCE = `${MODULE_PATH}/src/main/ets/BankListItem.ets`;
export const REAL_CHAIN_TEST = `${MODULE_PATH}/src/ohosTest/ets/test/AllBanksPage.test.ets`;

/**
 * 宿主前置（**不是**作者材料）：工程骨架 + git 基线。
 * `module-catalog.yaml` 在此写——`check-spec.ts:1009` → `catalog-parser.ts:69` 把它当工程级前置。
 */
export function scaffoldRealChainHost(project: RealChainProject, adapter = 'codex'): string[] {
  const { root } = project;
  writeHostFile(root, 'framework.config.json', JSON.stringify({
    schema_version: '1.1',
    project_name: 'RealChain',
    // **必须与真实宿主/模板默认一致**：`templates/framework.config.template.json:62` 与
    // `D:\1.code\SimulatedWalletForHmos\framework.config.json:122` 都是 `obligation-driven`
    //（workflow schema **1.2**）。夹具早先写死 `spec-driven`（1.1），
    // 而 1.1 下 `resolveEffectiveScopeSource` 取不到冻结范围，
    // `capability-resolution-entry-input.ts` 的整段冻结范围分支（codeTargets / testTargets /
    // factsContext 源码读集）**根本不执行**——W1/W3 要回归的正是那条 1.2 路径，
    // 在 1.1 下跑绿等于没测。**不得改回 1.1。**
    active_workflow: 'obligation-driven',
    project_profile: { name: 'test-chain' },
    architecture: {
      outer_layers: [{ id: '02-Feature', can_depend_on: [], intra_layer_deps: 'dag' }],
      module_inner_layers: ['main'],
      inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ets',
    },
    paths: {
      features_dir: 'doc/features',
      module_catalog: 'doc/module-catalog.yaml',
      glossary: 'doc/glossary.yaml',
      glossary_seed: 'doc/glossary-seed.txt',
      architecture_md: 'doc/architecture.md',
      docs_committed: false,
      reports_dir_pattern: 'doc/features/<feature>/<phase>/reports',
    },
    materialized_adapters: [adapter],
  }, null, 2));
  // 父进程 profile 回落补偿（见文件尾「已知上限」注）：goal-runner 进程内的
  // `FRAMEWORK_DIR` 是模块常量（profile-loader.ts:24 `path.resolve(__dirname,'..')`），
  // 指向**源仓**，那里没有 `profiles/test-chain` → `profile-loader.ts:199-205` 静默回落
  // hmos-app，于是父进程 preflight 按 hmos-app 的 `personal_prerequisites` 要 DevEco。
  // 子进程（真 harness）在 provision 出来的框架根里正确解析 test-chain。
  // 照 `goal-runner-testing-integrity.unit.test.ts:118-124` 先例给一个假工具链路径。
  const deveco = path.join(root, 'fake-deveco');
  const hvigorBin = path.join(deveco, 'tools', 'hvigor', 'bin',
    process.platform === 'win32' ? 'hvigorw.bat' : 'hvigorw');
  fs.mkdirSync(path.dirname(hvigorBin), { recursive: true });
  fs.writeFileSync(hvigorBin, '');
  writeHostFile(root, 'framework.local.json', JSON.stringify({
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
  writeHostFile(root, 'AGENTS.md', '# AGENTS\n');
  // 装机候选身份（`hdc-runner.ts` 的 `loadAppInstallCandidateMeta`）：bundleName 是
  // device_test.run 的预启身份与 hylyre lint 的同源输入，缺它 testing 拿不到 bundle。
  writeHostFile(root, 'AppScope/app.json5', JSON.stringify({
    app: { bundleName: 'com.example.realchain', versionCode: 1, versionName: '1.0.0' },
  }, null, 2));
  // 原始需求正文（plan §4.1）：spec 阶段的 `requirement_ref.snippet` 要逐字回指它
  // （`p0-semantic-gates.ts:155-171` 读源文档核对引文，伪造/漂移即 BLOCKER）。
  writeHostFile(root, `doc/features/${REAL_CHAIN_FEATURE}/requirements/requirement.md`, [
    '# 全部银行页开卡需求',
    '',
    '全部银行页展示可开卡银行列表。点击银行条目进入开卡流程。',
    '',
  ].join('\n'));
  writeHostFile(root, 'doc/module-catalog.yaml', [
    'schema_version: "1.0"',
    'modules:',
    `  - name: "${MODULE}"`,
    '    layer: "02-Feature"',
    '    sub_layer: null',
    '    format: "HAR"',
    '    one_liner: "银行卡开卡流程"',
    '    responsibilities: []',
    '    NOT_responsible_for: []',
    '    typical_business_terms: []',
    '    easily_confused_with: []',
    '    key_exports: []',
    `    entry_file: "${MODULE_PATH}/index.ets"`,
    '',
  ].join('\n'));
  writeHostFile(root, 'doc/glossary.yaml', [
    'schema_version: "1.0"',
    'terms:',
    '  - term: "银行卡"',
    `    canonical_module: "${MODULE}"`,
    '    aliases: []',
    '    definition: "可开卡的银行卡产品"',
    '',
  ].join('\n'));
  writeHostFile(root, 'doc/architecture.md', '# architecture\n');
  writeHostFile(root, 'build-profile.json5', JSON.stringify({
    app: { products: [{ name: 'default' }] },
    modules: [{ name: MODULE, srcPath: `./${MODULE_PATH}` }],
  }, null, 2));
  writeHostFile(root, `${MODULE_PATH}/oh-package.json5`, '{ "name": "financialcard", "version": "1.0.0" }');
  writeHostFile(root, REAL_CHAIN_INDEX, "export { AllBanksPage } from './src/main/ets/AllBanksPage';\n");
  writeHostFile(root, REAL_CHAIN_SOURCE,
    '@Component\nexport struct AllBanksPage {\n  build() {\n    Text("全部银行")\n  }\n}\n');
  writeHostFile(root, REAL_CHAIN_SOURCE_2,
    'export class BankRepository {\n  list(): string[] { return []; }\n}\n');
  writeHostFile(root, REAL_CHAIN_MODEL,
    'export interface BankModel {\n  id: string;\n  name: string;\n}\n');
  writeHostFile(root, REAL_CHAIN_SERVICE,
    'export class BankService {\n  openCard(id: string): Promise<boolean> { return Promise.resolve(!!id); }\n}\n');
  // P（plan §10.1）：framework/ 必须 ignore，否则 git add -A 把整份框架纳入基线。
  // `build/` 是 device_test.build 替身落 .hap 的地方（真工程同样不入库）。
  writeHostFile(root, '.gitignore', 'framework/\nbuild/\n');
  // workflow 1.2 的运行前责任：先有候选，首次阶段调用才冻结得出 `execution-scope.json`。
  // 放在 git 基线之前，使工程开跑时工作树干净（真实宿主也是先 prepare-scope 再起 run）。
  const prepared = prepareRealChainScopeCandidate(project, {
    requirement: REAL_CHAIN_REQUIREMENT,
    requestedResults: ['银行列表展示与开卡入口'],
    requestedPhases: ['spec', 'plan', 'coding', 'review', 'ut', 'testing'],
  });
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'real-chain@test']);
  git(root, ['config', 'user.name', 'real-chain']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'baseline']);
  // 1.2 下**范围是权威**：`goal-phase-runtime.ts:4988` 要求 `--start/--end` 与解析出的
  // 出生链首尾逐字相等（不匹配即抛 `start/end must match the resolved scope`）。
  // 出生链天然是短的（验收/契约都还没产出），随 spec/plan 的范围修订自行延长——
  // 调用方据此起 run，**不得**再用 --end 去截断链。
  return prepared.scope.phase_chain.map(String);
}

/**
 * workflow 1.2 的运行前入口：用**生产函数** `prepareFeatureScopeCandidate` 生成
 * `doc/features/<f>/feature.yaml` 候选（`--prepare-scope` CLI 走的是同一个函数，
 * `goal-mode-entry.ts:498`）。冻结记录 `doc/features/<f>/execution-scope.json`
 * 由**首次阶段调用**的生产链自己落（`ensureFeatureExecutionScopeFrozen`），夹具不碰。
 *
 * `requirement` 必须与 goal run 的 `--requirement` **逐字相同**：
 * `resolveFeatureExecutionScope`（feature-track.ts:119-121）与
 * `assertCandidateRequirementProvenance` 都按它核 provenance，分叉即 `input binding stale`。
 * 候选本身一个字段都不手写（§4.4）——只给四项输入：完成终点、请求结果、请求阶段、需求。
 */
export function prepareRealChainScopeCandidate(
  project: RealChainProject,
  input: { requirement: string; requestedPhases: string[]; requestedResults: string[]; completionTarget?: 'feature' | 'request' },
): ReturnType<typeof prepareFeatureScopeCandidate> {
  return prepareFeatureScopeCandidate({
    projectRoot: project.root,
    frameworkRoot: project.frameworkRoot,
    feature: project.feature,
    completionTarget: input.completionTarget ?? 'feature',
    requestedResults: input.requestedResults,
    requestedPhases: input.requestedPhases,
    requirement: input.requirement,
    overwrite: true,
  });
}

/** 造一个空壳宿主 + 框架 + test-chain profile（作者材料由调用方按阶段写）。 */
export function provisionRealChainProject(): RealChainProject {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'real-chain-')));
  const { frameworkRoot, harnessDir } = provisionFrameworkUnder(root);
  synthesizeTestChainProfile(frameworkRoot);
  return {
    root, frameworkRoot, harnessDir,
    feature: REAL_CHAIN_FEATURE, module: MODULE, modulePath: MODULE_PATH,
  };
}

// ============================================================================
// 已知上限（plan d4a1f7c3 §10.4，全部实跑取证，不得当成"以后再说"）
// ----------------------------------------------------------------------------
// 1. **父进程 profile 静默回落 hmos-app。** `profile-loader.ts:24` 的
//    `FRAMEWORK_DIR = path.resolve(__dirname, '..')` 是模块常量；进程内跑 `goal-runner` 时它
//    指向**源仓**，那里没有 `profiles/test-chain` → `:199-205` 只 warn 不抛、回落 hmos-app。
//    子进程（真 harness，`__dirname` 落在 provision 出来的框架根下）解析正确，正例套件对每个
//    阶段断言 `phase-evidence-manifest.json` 的 `environment.profile === 'test-chain'` 锁住这点。
//    两个后果：(a) 父进程 preflight 按 hmos-app 的 `personal_prerequisites` 要 DevEco，故上面写
//    了假工具链路径；(b) 父进程按 hmos-app 的 `device_capabilities` 判 `phaseRequiresDevice`
//    为真，驱动默认注入的 READY 桩**确实执行了**——结论仍是零真实设备覆盖，但 plan §1.1/§8
//    写的"设备门根本不进"这条机制在本链不成立。
// 2. **device_test 三段是可执行替身，不是真机**（`real-chain-providers/*.js`）：build 不编译、
//    install 不装机、run 不操作设备，只产出下游要消费的三件事实（.hap 字节、装前完整摘要、
//    一份合冻结契约的 native trace）。被真实覆盖的是 trace→evidence→P0 五数→报告这条消费链
//    ——`parseHylyreTrace` / `evaluateHylyreNativeEvidenceGate` / `composeDeviceTestEvidence`
//    全部 shim 回 hmos-app 生产实现，trace 三轴与 tool_calls 由生产 reducer 反推。
//    失败/阻塞形态的 StepResult 与责任路由分支**未覆盖**（trace 恒全通过），归 plan §5 的负例。
// 3. UT 执行（含命名/框架导入/测试注册）与编译是返定值替身；`coding-host-rules` 只覆盖
//    `checkCodingCompile`，结构与溯源两组检查留在 hmos-app 的真实实现上。
// ============================================================================
