#!/usr/bin/env node
// ============================================================================
// smoke-consumer-lifecycle.mjs — 发布件**整机链**（e5d8a2c4 T4 骨架）
// ----------------------------------------------------------------------------
// 为什么必须有这一层（本纲判读原文）：前四批全是「叶子修法 + 单测同步落绿」，
// 而 plan 自己写着"T4 七用例先行铺红"。零件绿、整机没人验过，正是漏风一直没被
// 拦住的原因。两个实锤（都不是我自己发现的）：
//   · 断言挂在生产**到不了**的分支上——单测照绿；
//   · 判据拿原值比**指纹**，生产上恒 false，而夹具手写原值——3041 个绿穿过四轮 review。
// 这两类都有一个共同特征：**验收对着夹具，不对着生产接线**。整机链没有夹具可骗——
// 真实 zip、真实 git、真实 checkout、真实旧 HEAD→新发布件覆盖与 catalog。
//
// 本文件是**骨架**：生命周期各段真跑；事故回放用例**显式注册但暂 skip**。
// skip 不是静默的——注册表缺项会直接失败（见 assertCaseRegistryComplete），
// 且每次运行都打印 skip 清单与"骨架/完整"横幅。参照既有硬学习：
// 「CORE_SUITES 显式注册表——新套件不注册 = 假绿」。
//
// 与旧 smoke-consumer-staging.mjs 的关系：**已合并，旧脚本退役**。
// 我最初把它做成了第二套 smoke 并写"两者不互相调用"——那直接违反 plan 原文
// 「扩展既有 release:smoke-consumer，**不新建**测试台体系」，而且我**没有当场上报
// 这处偏离**（codex 第七批 P2 抓出）。旧脚本的唯一独有能力是发布件自带的
// `npm test`（= check:global），已作为 stage `checkGlobal` 吸收进来，且改在 clone
// 出来的副本上跑。入口仍是 `npm run release:smoke-consumer`，文档引用不受影响。
//
// 两种输入：
//   · `--zip <path>`  ——  用 candidate 的**同一字节** zip（**这才是"验的是要发的字节"**）；
//   · 不给 `--zip`    ——  就地重 pack，仅供改代码时的快速回归，**不构成发布证据**。
// ============================================================================

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// 真实事故回放用例的**权威注册表**
// ---------------------------------------------------------------------------

/**
 * id 与 plan 的事故回放用例一一对应（#1–#7 为初版七条，#8 由总纲 A【P0】增补），
 * **顺序与编号不得改**。
 *
 * `status`：
 *   · `covered`   —— 由下面某个生命周期 stage 真跑覆盖（stage 红即本用例红）
 *   · `pending`   —— 尚未实现（骨架期）。**不是通过**，会计入 skip 并打印。
 *   · `retired`   —— 该事故类别已不属于 Maison 职责，不再由本链验证；必须写明
 *                    `retiredReason`。编号保留，避免注册表出现空洞。
 */
const CASE_REGISTRY = [
  {
    id: 1,
    name: '发布文件被宿主 .gitignore 吞掉（已退役：宿主 SCM 配置不属于 Maison 职责）',
    status: 'retired',
    retiredReason:
      'plan 33714d0c：framework-init 不再读取、诊断、创建或修改宿主的忽略配置，' +
      '相关 S3 任务、writer 与 canonical host 规则整体退场。宿主是否忽略 framework ' +
      '运行时目录由宿主自行决定。Maison 侧仍然成立的是发布件文件集合本身——' +
      '由 release verify 与 stage clone 的存在性断言保护。',
    note: '编号保留以免注册表空洞；本链不再合成宿主历史宽规则，也不再运行任何宿主忽略配置 writer',
  },
  {
    id: 2,
    name: 'CRLF checkout 不触发普通 phase 发布件复核',
    status: 'covered',
    coveredBy: 'checkGlobal',
    note: 'autocrlf=true clone 通道确实生效，随后普通 global phases 不运行发布件 hash/Git integrity',
  },
  {
    id: 3,
    name: 'reset 已消费、设备停放后 resume 成功',
    status: 'covered',
    coveredBy: 'goal',
    // 垂直恢复闭环（2026-08-06）落地后由棘轮翻转为目标断言：fresh+reset 消费 →
    // 四阶段 PASS → 设备 WAITING 停放 → 无 HMAC resume **零 ack 过门** → 最早未完成的
    // WAITING(external) phase（ut）**真正重新执行** → 设备仍锁如实再停放。
    // 判据=phaseStartsThisCall 含 'ut'（start_index 收口形态在此必挂，T4#3 收紧判据）。
    note: 'goal stage 端到端：park（reset 消费+停放）→ resume（零 ack + ut 真重跑）',
  },
  { id: 4, name: '全链推进不依赖任何场外快照缓存（pass snapshot 已退役）', status: 'covered', coveredBy: 'goal',
    note: 'runner-owned-machine-facts：pass snapshot 机制整体退役——goal stage 全链（fresh→park→resume→ready 收官）在零快照世界端到端跑通即覆盖本用例；原"cache miss 自动丢弃重跑"场景不复存在' },
  { id: 5, name: 'UT 改源码 → 自动回 coding', status: 'covered', coveredBy: 'goal',
    note: 'goal driver 在 UT agent 窗口真实改产品源码，runner 以 source-drift 原子失效回 coding 后重新闭环' },
  { id: 6, name: '恢复中途各崩溃窗口：阶段不漏失效 + 交接上下文不丢', status: 'covered', coveredBy: 'goal',
    note: 'goal driver 在 atomic invalidation record 落盘后崩溃，随后同一 run resume 验证 plan/coding 不漏失效' },
  { id: 7, name: 'build 失败归因与空转重试', status: 'covered', coveredBy: 'goal',
    note: 'goal driver 真实写入 ut_hvigor_build/test FAIL，验证 toolchain 归因与重复签名熔断' },
  // #8 是总纲「A【P0】T4 增用例 #8」后补的（plan 481 行），**初版注册表把它漏了**，
  // 而单测还硬断言"恰好七条"——等于把漏洞钉死：已知 pending 项不在册，门禁照绿。
  // 这正是本文件声称要防的假绿形态，被 codex 当场抓出（第七批 P1）。
  {
    id: 8,
    name: 'fresh + head 失配 → 自动续跑收官，不 TERMINAL 不裸崩',
    status: 'covered',
    coveredBy: 'goal',
    // T2 5a-1（2026-08-07）落地后由棘轮第二次翻转转正：decide 对失配三条 invocation
    // 路径统一 recover(reset_lineage)；启动期 tamper+裸 throw 分支删除。
    // 整机面=goal stage 第四段（独立 feature first-death：种失配 head → 自动
    // discontinuity（declared_by=auto_mismatch_recovery）→ spec 真跑收官，无 tamper
    // 无 uncaught_exception）；行为面=goal-lineage-first-death 目标断言。
    note: 'goal stage 第四段：失配自动重建续跑（宿主 run1"第一死"的整机级根治）',
  },
  {
    id: 9,
    name: '旧发布件 HEAD → 完整新发布件 M/D/?? 覆盖，不提交仍可通过 framework-init UPDATE',
    status: 'covered',
    coveredBy: 'upgradeOverlay',
    note: '临时 consumer 合成旧 HEAD，镜像恢复当前完整发布件，断言 M/D/?? 后执行真实 init-orchestrate UPDATE，并保留五态 catalog 矩阵',
  },
];

/**
 * 注册表完整性——**这是防"假绿"的那道门**。
 *
 * 硬学习原文：显式注册表 + 新套件不注册 = 假绿。这里反过来用：**少注册也是假绿**
 * （悄悄删掉一个用例，整机 smoke 照样 PASS）。
 */
export function assertCaseRegistryComplete(registry = CASE_REGISTRY, stages = STAGES) {
  const ids = registry.map(c => c.id).sort((a, b) => a - b);
  // **报告分母不再硬编码**（codex 第七批 P1）：初版写死"恰好 1..7"，于是 plan 后补的
  // #8 不在册也照绿——门禁把自己的漏洞钉死了。现在形状约束＝"连续、无重复、无空洞"，
  // 分母由注册表自身派生。
  // **但下限 MIN_KNOWN_CASES 仍是硬编码**（见下），那是**有意保留**的"少登记即抛"闸，
  // 不是遗漏——所以别再宣称"已消除全部硬编码总数"（codex 第八批 P3 订正措辞）。
  const contiguous = ids.every((id, i) => id === i + 1);
  if (ids.length === 0 || !contiguous) {
    throw new Error(
      `[smoke] 用例编号必须从 1 起连续无空洞、无重复，实得 [${ids.join(',')}]`,
    );
  }
  // 已知下限：当前 plan 明确定义到 #9（#9 为 2026-09-01 发布件升级事故）。
  // 少于它一定是漏登记——**这是"少注册也是假绿"的那道门**，plan 再增用例时须同步上调。
  const MIN_KNOWN_CASES = 9;
  if (ids.length < MIN_KNOWN_CASES) {
    throw new Error(
      `[smoke] plan 已定义到 #${MIN_KNOWN_CASES}，注册表只有 ${ids.length} 条——有用例未登记`,
    );
  }
  const stageIds = new Set(stages.map((s) => s.id));
  for (const c of registry) {
    if (c.status === 'retired' && !c.retiredReason) {
      throw new Error(`[smoke] 用例 #${c.id} 标为 retired 却未写明 retiredReason`);
    }
    if (c.status === 'covered' && !c.coveredBy) {
      throw new Error(`[smoke] 用例 #${c.id} 声称 covered 却未指明由哪个 stage 覆盖`);
    }
    if (c.status === 'covered' && !stageIds.has(c.coveredBy)) {
      throw new Error(
        `[smoke] 用例 #${c.id} 声称由 stage:${c.coveredBy} 覆盖，但该 stage 不存在` +
        `（stages=${[...stageIds].join(',')}）`,
      );
    }
  }
  return registry;
}

// ---------------------------------------------------------------------------
// 宿主侧夹具
// ---------------------------------------------------------------------------

/**
 * **测试基础设施**用的最小 .gitignore（plan 33714d0c）。
 *
 * 它只排除 fixture 自己 `npm install` 出来的 `node_modules` 与 lockfile——否则 commit
 * stage 要把上万个依赖文件塞进临时仓，慢且与被测行为无关。
 *
 * 明确**不来自** Maison、也不来自 framework-init：init 已不再读取、诊断、创建或修改
 * 宿主忽略配置。这里不得恢复 canonical host writer，也不得重新合成"历史宽规则"
 * 夹具——那条事故类别（用例 #1）已随宿主 SCM 权责一并退役。
 */
const TEST_ONLY_GITIGNORE = [
  '# --- 仅为 smoke fixture 服务；不是 Maison / framework-init 产物 ---',
  'framework/harness/node_modules/',
  'framework/harness/package-lock.json',
  '',
].join('\n');

const MODULE_CATALOG_YAML = 'schema_version: "1.0"\nmodules: []\n';
const GLOSSARY_YAML = 'schema_version: "1.0"\nterms: []\n';
const FRAMEWORK_CONFIG_JSON = `{
  "schema_version": "1.1",
  "project_name": "smoke-consumer",
  "active_workflow": "spec-driven",
  "project_profile": {
    "name": "generic"
  },
  "materialized_adapters": ["generic"],
  "architecture": {
    "outer_layers": [{ "id": "app", "can_depend_on": [], "intra_layer_deps": "forbid" }],
    "module_inner_layers": ["shared"],
    "inner_dependency_direction": "upward",
    "cross_module_exports_file": "index.ets"
  },
  "paths": {
    "features_dir": "doc/features",
    "module_catalog": "doc/module-catalog.yaml",
    "glossary": "doc/glossary.yaml",
    "glossary_seed": "doc/glossary-seed.txt",
    "architecture_md": "doc/architecture.md",
    "extension_dir": "doc/extensions",
    "state_file": "framework/harness/state/.current-phase.json",
    "receipt_dir_pattern": "doc/features/<feature>/<phase>",
    "reports_dir_pattern": "doc/features/<feature>/<phase>/reports"
  }
}
`;

// ---------------------------------------------------------------------------
// 进程工具
// ---------------------------------------------------------------------------

function run(cmd, args, opts = {}) {
  const isWin = process.platform === 'win32';
  // Windows 上 npm/git 走 shim，直接 spawn 会找不到；统一经 cmd /c
  const r = isWin && /^(npm|npx)$/.test(cmd)
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', [cmd, ...args].join(' ')], {
        encoding: 'utf-8', ...opts, shell: false,
      })
    : spawnSync(cmd, args, { encoding: 'utf-8', ...opts, shell: false });
  return r;
}

function mustRun(label, cmd, args, opts = {}) {
  const r = run(cmd, args, opts);
  if (r.error || r.status !== 0) {
    if (r.error) console.error(r.error.message);
    if (r.stdout) console.error(r.stdout);
    if (r.stderr) console.error(r.stderr);
    throw new Error(`${label} 失败（exit ${r.status ?? 'spawn error'}）`);
  }
  return r;
}

function git(cwd, ...args) {
  return mustRun(`git ${args[0]}`, 'git', args, { cwd });
}

// ---------------------------------------------------------------------------
// 生命周期各段
// ---------------------------------------------------------------------------

/**
 * S1 install —— 把**发布件**装进一个临时宿主工程。
 *
 * `zipPath` 在场时用它（candidate 的同一字节）；否则本地重 pack（快速模式）。
 * 前者才是"验的是要发的字节"，后者只适合改代码时的快速回归。
 */
async function stageInstall(ctx) {
  const { consumerRoot, zipPath, tmpOut } = ctx;
  fs.mkdirSync(path.join(consumerRoot, 'doc'), { recursive: true });
  fs.writeFileSync(path.join(consumerRoot, 'doc', 'module-catalog.yaml'), MODULE_CATALOG_YAML, 'utf8');
  fs.writeFileSync(path.join(consumerRoot, 'doc', 'glossary.yaml'), GLOSSARY_YAML, 'utf8');
  fs.writeFileSync(path.join(consumerRoot, 'doc', 'glossary-seed.txt'), '账户\n', 'utf8');
  fs.writeFileSync(path.join(consumerRoot, 'doc', 'architecture.md'), '# Architecture\n', 'utf8');
  fs.mkdirSync(path.join(consumerRoot, 'doc', 'features'), { recursive: true });
  fs.writeFileSync(path.join(consumerRoot, 'framework.config.json'), FRAMEWORK_CONFIG_JSON, 'utf8');
  // 仅为 fixture 自身服务的最小忽略规则（不是 Maison / init 产物，见常量注释）
  fs.writeFileSync(path.join(consumerRoot, '.gitignore'), TEST_ONLY_GITIGNORE, 'utf8');

  const frameworkDest = path.join(consumerRoot, 'framework');
  if (zipPath) {
    // **zip 自带顶层 `framework/`**（pack-release 的 archive.directory(stagingRoot,
    // FRAMEWORK_DIR_NAME)）——所以解到 consumerRoot，不是解到 consumerRoot/framework。
    // 初版解错了一层，`--zip` 这条路**从来没跑通过**，而我只跑了 repack 就宣称支持
    // candidate 同字节（codex 第七批 P1，用真 candidate 实跑复现）。
    ctx.log(`install：解包 candidate zip（同一字节）${path.basename(zipPath)}`);
    const { default: extract } = await import('extract-zip');
    await extract(zipPath, { dir: consumerRoot });
  } else {
    ctx.log('install：就地重 pack（快速回归模式，**不构成发布证据**）');
    const { packRelease } = await import('./pack-release.mjs');
    const { stagingRoot } = await packRelease({ dryRun: false, stageOnly: true, outDir: tmpOut });
    if (!stagingRoot || !fs.existsSync(stagingRoot)) throw new Error('packRelease --stage-only 未产出 stagingRoot');
    // stagingRoot 本身就是 `<out>/release-staging/framework`，故拷成 consumer/framework
    fs.cpSync(stagingRoot, frameworkDest, { recursive: true });
  }
  // **两条路径必须落到同一形状**——上面那个 bug 正是两路布局不一致且只跑了其中一条。
  const pkg = path.join(frameworkDest, 'harness', 'package.json');
  if (!fs.existsSync(pkg)) {
    throw new Error(
      `发布件布局不符：期望 ${path.relative(consumerRoot, pkg)}；` +
      `consumer 下实有 [${fs.readdirSync(consumerRoot).join(', ')}]`,
    );
  }
  ctx.frameworkRoot = frameworkDest;
}

/**
 * S2 depsHost —— 在**宿主副本**上装依赖。
 *
 * 为什么 clone 之前就要装：clone 阶段要在**发布件内**读 runtime-artifact policy，
 * 而 `evalInShipped` 需要发布件自带的 ts-node。顺带也证明了发布件的 harness/package.json
 * 真的装得起来。clone 之后会**再装一次**（node_modules 被 fixture 忽略，克隆不带），
 * 那一次才是"换机后的消费者"，见 stageDepsClone。
 */
function stageDepsHost(ctx) {
  const harnessRoot = path.join(ctx.frameworkRoot, 'harness');
  mustRun('npm install(host)', 'npm', ['install'], { cwd: harnessRoot });
  ctx.harnessRoot = harnessRoot;
}

/**
 * S5 depsClone —— 在 clone 出来的副本上装依赖，并**把执行根切过去**。
 *
 * 这一条是 codex 第七批 P1 补的：初版 `ctx.harnessRoot` 绑在 clone **之前**的副本上，
 * 于是 clone 之后的 `evalInShipped` 仍从旧副本加载实现，只是把 clone 路径**当参数**
 * 传进去检查——那不是"换机后的消费者在运行"，被 CRLF 改写过的代码从未真正执行过。
 */
function stageDepsClone(ctx) {
  const harnessRoot = path.join(ctx.clonedFrameworkRoot, 'harness');
  if (!fs.existsSync(path.join(harnessRoot, 'package.json'))) {
    throw new Error('clone 后缺 harness/package.json——换机形态不成立');
  }
  mustRun('npm install(clone)', 'npm', ['install'], { cwd: harnessRoot });
  ctx.harnessRoot = harnessRoot;   // **执行根切到 clone**：此后所有 evalInShipped 跑的是它
}

/**
 * S3 commit —— git init + commit，为后续 clone（换机形态）准备真实历史。
 *
 * plan 33714d0c：本段不再运行任何 Maison gitignore writer，也不再断言"宿主 Git 收编"
 * ——宿主 SCM 配置不属于 Maison 契约。发布件文件集合本身仍由 release verify 与
 * stage clone 的存在性断言保护。
 */
function stageCommit(ctx) {
  const { consumerRoot } = ctx;
  git(consumerRoot, 'init', '-q');
  git(consumerRoot, 'config', 'user.email', 'smoke@example.invalid');
  git(consumerRoot, 'config', 'user.name', 'smoke');
  git(consumerRoot, 'config', 'commit.gpgsign', 'false');

  git(consumerRoot, 'add', '-A');
  git(consumerRoot, 'commit', '-q', '-m', 'smoke: consumer initial commit');

  const tracked = new Set(
    git(consumerRoot, 'ls-files').stdout.split('\n').map(s => s.trim()).filter(Boolean),
  );
  ctx.trackedFiles = tracked;

  ctx.log(`commit：${tracked.size} 个文件进索引`);
}

/**
 * S4 clone —— **checkout 时**开 autocrlf 模拟换机。
 *
 * `git -c core.autocrlf=true clone`：配在 clone 上才作用于 checkout。
 * 配错位置（比如 clone 完再 config）等于测了个寂寞——工作区文件早已按旧设置落盘。
 */
function stageClone(ctx) {
  const cloneRoot = path.join(ctx.workRoot, 'cloned');
  mustRun('git clone', 'git', [
    '-c', 'core.autocrlf=true', 'clone', '-q', ctx.consumerRoot, cloneRoot,
  ]);
  ctx.cloneRoot = cloneRoot;
  ctx.clonedFrameworkRoot = path.join(cloneRoot, 'framework');

  // 换机后发布件仍须齐全：runtime 目录内的发布件属于 release 文件集合，与宿主是否
  // 忽略这些目录无关（plan 33714d0c）。
  const shipped = ctx.shippedFilesInRuntimeDirs();
  if (shipped.length === 0) {
    throw new Error(
      '被测发布件的 runtime-artifact-policy 未声明 shipped_files_in_runtime_dirs——' +
      '本断言在这个包上**无可验对象**（多半是拿了 schema 1.0 的旧包来测）。',
    );
  }
  const missing = shipped.filter(rel => !fs.existsSync(path.join(ctx.clonedFrameworkRoot, rel)));
  if (missing.length > 0) {
    throw new Error(`事故①回归：clone 后发布件缺失 —— ${missing.join(', ')}`);
  }

  // CRLF 通道必须真实生效：#2 要证明 CRLF checkout 后普通 global phases 仍不启动
  // 发布件 Git/hash 复核，而不是在纯 LF 夹具上轻松通过。
  const probe = path.join(ctx.clonedFrameworkRoot, 'RELEASE-MANIFEST.json');
  if (!fs.existsSync(probe)) throw new Error(`clone 后缺 RELEASE-MANIFEST.json：${probe}`);
  const raw = fs.readFileSync(probe);
  ctx.autocrlfObserved = raw.includes(Buffer.from('\r\n', 'utf-8'));
  if (!ctx.autocrlfObserved) {
    throw new Error(
      `autocrlf 通道未生效：${path.basename(probe)} 在 clone 后仍是纯 LF。` +
      '用例 #2 的 CRLF→ordinary phase 路径等于没验——' +
      '不得放行。（检查 clone 是否真的带了 -c core.autocrlf=true、发布件是否有 .gitattributes 锁 LF）',
    );
  }
  ctx.log('clone：autocrlf checkout 完成，探针文件已确认含 CRLF');
}

/**
 * S6 upgradeOverlay —— 合成旧发布件 HEAD，再镜像覆盖当前完整发布件。
 * 覆盖后必须同时有 M/D/??，不 add/stage/commit，直接运行 catalog。
 */
function stageUpgradeOverlay(ctx) {
  const repo = ctx.cloneRoot;
  const targetFramework = ctx.clonedFrameworkRoot;
  const currentFramework = ctx.frameworkRoot;
  const modifiedRel = 'README.md';
  const addedRel = 'MIGRATION.md';
  const legacyRel = 'legacy-only-from-old-release.txt';
  for (const rel of [modifiedRel, addedRel]) {
    if (!fs.existsSync(path.join(targetFramework, rel))) {
      throw new Error(`upgradeOverlay 缺发布件探针：${rel}`);
    }
  }

  // 当前 clone 先改造成“旧发布件”并提交为 HEAD。
  fs.writeFileSync(path.join(targetFramework, modifiedRel), 'synthetic old release\n', 'utf8');
  fs.rmSync(path.join(targetFramework, addedRel));
  fs.writeFileSync(path.join(targetFramework, legacyRel), 'legacy only\n', 'utf8');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'smoke: synthetic old framework release');

  // 镜像恢复当前发布件声明的全部文件；runtime node_modules 不参与。
  const manifest = JSON.parse(fs.readFileSync(path.join(currentFramework, 'RELEASE-MANIFEST.json'), 'utf8'));
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  if (files.length === 0) throw new Error('upgradeOverlay 当前发布件 manifest.files 为空');
  for (const entry of files) {
    const rel = String(entry.path ?? '');
    if (!rel) continue;
    const src = path.join(currentFramework, rel);
    const dst = path.join(targetFramework, rel);
    if (!fs.existsSync(src)) throw new Error(`upgradeOverlay 当前发布件缺 manifest 文件：${rel}`);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  for (const rel of ['RELEASE-MANIFEST.json', 'RELEASE-MANIFEST.sha256']) {
    fs.copyFileSync(path.join(currentFramework, rel), path.join(targetFramework, rel));
  }
  fs.rmSync(path.join(targetFramework, legacyRel));

  const status = git(repo, 'status', '--porcelain=v1', '--untracked-files=all', '--', 'framework').stdout
    .split(/\r?\n/)
    .filter(Boolean);
  const xy = status.map((line) => line.slice(0, 2));
  if (!xy.some((s) => s.includes('M')) || !xy.some((s) => s.includes('D')) || !xy.includes('??')) {
    throw new Error(`upgradeOverlay 未真实形成 M/D/??：${status.slice(0, 20).join(' | ')}`);
  }

  // 真实事故出口：framework-init UPDATE → task executor → run-global-phases → catalog。
  const initRunsRoot = path.join(targetFramework, 'harness', 'reports', '_global', 'init-orchestrate');
  const beforeRuns = new Set(fs.existsSync(initRunsRoot) ? fs.readdirSync(initRunsRoot) : []);
  mustRun(
    'upgradeOverlay framework-init UPDATE',
    'npx',
    [
      'ts-node', 'scripts/init-orchestrate.ts', '--execute', '--smart-auto',
      '--scope', 'project', '--project-root', repo, '--materialized-adapters', 'generic',
    ],
    { cwd: path.join(targetFramework, 'harness') },
  );
  const afterRuns = fs.readdirSync(initRunsRoot);
  const createdRuns = afterRuns.filter((name) => !beforeRuns.has(name));
  const runDirName = (createdRuns.length > 0 ? createdRuns : afterRuns)
    .sort((a, b) => fs.statSync(path.join(initRunsRoot, b)).mtimeMs - fs.statSync(path.join(initRunsRoot, a)).mtimeMs)[0];
  if (!runDirName) throw new Error('framework-init UPDATE 未产生 init-orchestrate run 目录');
  const initRunDir = path.join(initRunsRoot, runDirName);
  const initLog = JSON.parse(fs.readFileSync(path.join(initRunDir, 'run-log.json'), 'utf8'));
  const globalEntry = (initLog.entries ?? []).find((entry) => entry.task_id === 'run-global-phases');
  if (!globalEntry || globalEntry.status !== 'executed') {
    throw new Error(`framework-init run-global-phases 未成功：${JSON.stringify(globalEntry ?? null)}`);
  }
  const initSummary = fs.readFileSync(path.join(initRunDir, 'summary.md'), 'utf8');
  if (/run-global-phases[^\n]*failed/i.test(initSummary)) {
    throw new Error(`framework-init summary 错误记录 run-global-phases failed：${initSummary.slice(-1200)}`);
  }
  const catalogAfterInit = JSON.parse(fs.readFileSync(
    path.join(targetFramework, 'harness', 'reports', '_global', 'catalog', 'script-report.json'),
    'utf8',
  ));
  const retiredIds = [
    ['framework', 'integrity'].join('_'),
    ['framework', 'control', 'plane', 'dirty'].join('_'),
  ];
  const retiredHit = (catalogAfterInit.checks ?? []).find(
    (check) => retiredIds.includes(check.id) || retiredIds.includes(check.failure_kind),
  );
  if (retiredHit) throw new Error(`framework-init catalog 仍含退役 Framework Git result：${JSON.stringify(retiredHit)}`);

  const reportPath = path.join(targetFramework, 'harness', 'reports', '_global', 'catalog', 'script-report.json');
  const runCatalogSnapshot = (label) => {
    mustRun(`upgradeOverlay catalog (${label})`, 'npm', ['run', 'check:catalog'], {
      cwd: path.join(targetFramework, 'harness'),
      env: { ...process.env, HARNESS_INIT_INTERNAL_GLOBAL_RUN: '1' },
    });
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    return JSON.stringify({
      verdict: report.summary?.verdict,
      checks: (report.checks ?? [])
        .map((c) => ({
          id: c.id,
          status: c.status,
          severity: c.severity,
          failure_kind: c.failure_kind ?? null,
          blocking_class: c.blocking_class ?? null,
        }))
        .sort((a, b) => String(a.id).localeCompare(String(b.id))),
    });
  };

  const snapshots = [];
  snapshots.push(['tracked_dirty', runCatalogSnapshot('tracked_dirty')]);
  git(repo, 'add', '-A', '--', 'framework');
  snapshots.push(['staged', runCatalogSnapshot('staged')]);
  git(repo, 'commit', '-q', '-m', 'smoke: integrated current framework release');
  snapshots.push(['committed', runCatalogSnapshot('committed')]);

  git(repo, 'rm', '-q', '-r', '--cached', 'framework');
  git(repo, 'commit', '-q', '-m', 'smoke: host does not track framework');
  snapshots.push(['untracked', runCatalogSnapshot('untracked')]);

  const gitDir = path.join(repo, '.git');
  const hiddenGitDir = path.join(repo, '.git-smoke-hidden');
  fs.renameSync(gitDir, hiddenGitDir);
  try {
    snapshots.push(['non_git', runCatalogSnapshot('non_git')]);
  } finally {
    fs.renameSync(hiddenGitDir, gitDir);
  }

  const baseline = snapshots[0][1];
  const unequal = snapshots.filter(([, snapshot]) => snapshot !== baseline).map(([label]) => label);
  if (unequal.length > 0) {
    throw new Error(`upgradeOverlay 五种 Git 环境的 catalog 裁决不一致：${unequal.join(', ')}`);
  }

  // 后续 goal smoke 需要稳定 Git 基线；恢复跟踪不属于 #9 的被测运行。
  git(repo, 'add', '-A', '--', 'framework');
  git(repo, 'commit', '-q', '-m', 'smoke: restore framework tracking for later goal cases');
  ctx.upgradeOverlayStatus = status;
  ctx.log(`upgradeOverlay/#9：M/D/?? 下真实 framework-init UPDATE/run-global-phases PASS；五态 catalog 裁决逐字段相同`);
}

/**
 * S7 checkGlobal —— 发布件自己的 `npm test`（= `check:global`）。
 *
 * 这一环**吸收自旧 smoke-consumer-staging.mjs**：它原本是那个脚本存在的唯一理由
 * （见 docs/skills/rename-tail-allowlist.md 把 `release:smoke-consumer` 列为发版前流程）。
 * 搬过来之后旧脚本再无独有能力，遂退役、入口合并——plan 原文本来就写着
 * 「扩展既有 release:smoke-consumer，**不新建**测试台体系」。
 * 且比原来强一点：跑在**clone 出来的**副本上，而不是刚解包的那份。
 */
function stageCheckGlobal(ctx) {
  mustRun('npm test(check:global)', 'npm', ['test'], {
    cwd: ctx.harnessRoot,
    env: { ...process.env, HARNESS_INIT_INTERNAL_GLOBAL_RUN: '1' },
  });
  ctx.log('check:global：发布件自带的 npm test 在换机副本上通过');
}

/** S8 goal —— 完整 goal 生命周期（骨架期占位；用例 #3–#8 挂在它下面） */
/**
 * S8 goal —— 在 clone 宿主上跑**真实 goal 生命周期**（e5d8a2c4 步骤 1，driver 薄编排）。
 *
 * 场景=宿主 fa0663 实锤链：`fresh 全链 → ut/testing 设备 WAITING 停放（PARTIAL）
 * → 无 HMAC resume`。当前对 resume 的断言是**棘轮**（现状=被 checkpoint ack 门拦、
 * ut 不重跑）；垂直恢复闭环（plan 步骤 3）落地后棘轮必红，届时翻成目标断言
 * （零拦截 + ut 真正重跑）并把注册表 #3 改 covered。
 *
 * 薄编排纪律：仅 spawn 既有 goal-run-driver 三次（provision / device_park /
 * resume_after_park）+ 断言——**不得**在此生长 DSL、第二状态机或持久化层。
 * driver 从**发布件根**动态加载 goal-runner（验的是要发的字节）。
 */
function stageGoal(ctx) {
  const feature = 'recovery-park';
  const driver = path.join(REPO_ROOT, 'harness', 'tests', 'helpers', 'goal-run-driver.ts');
  const tsNode = path.join(ctx.harnessRoot, 'node_modules', 'ts-node', 'dist', 'bin.js');
  const RESULT = '<<goal-run-result>>';
  const runDriver = (scenario, extra, featOverride) => {
    const r = mustRun(`goal driver ${scenario}`, process.execPath, [
      tsNode, '--transpile-only', driver,
      scenario, featOverride ?? feature, ctx.clonedFrameworkRoot, ctx.cloneRoot, ...(extra ? [extra] : []),
    ], { cwd: ctx.harnessRoot });
    const at = (r.stdout ?? '').lastIndexOf(RESULT);
    if (at < 0) throw new Error(`goal driver ${scenario} 未返回结果：${(r.stdout ?? '').slice(-400)}`);
    return JSON.parse((r.stdout ?? '').slice(at + RESULT.length));
  };

  runDriver('provision');
  const park = runDriver('device_park');
  if (park.error !== null || park.exitCode !== 2) {
    throw new Error(`goal/park：应 PARTIAL 停放（exit 2、无异常），实得 ${JSON.stringify(park)}`);
  }
  const phases = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];
  if (!phases.every(p => park.phaseStartsThisCall.includes(p)) || park.agentCalls !== 4) {
    throw new Error(`goal/park：六 phase start、前四真跑后二被设备门拦（agent=4），实得 ${JSON.stringify(park)}`);
  }
  ctx.log(`goal/park：四阶段 PASS → ut/testing 设备 WAITING 停放（run=${park.runId}）`);

  // T3①：停放 run 的同源 device_readiness probe 转绿后，supervisor 必须自动
  // 重新入队同一 run；这个调用仍经 goal-run-driver 子进程，并走发布件 CLI。
  const probeWake = runDriver('supervisor_probe_wake', park.runId);
  const probeArgs = probeWake.supervisorRunnerArgs ?? [];
  if (probeWake.error !== null || probeWake.exitCode !== 0
    || probeWake.supervisorAction !== 'resume'
    || !probeArgs.includes('--resume') || !probeArgs.includes(park.runId)
    || probeArgs.includes('--supersede')) {
    throw new Error(
      'goal/T3①：同源 device_readiness probe 转绿必须自动 resume 同一 run，实得 '
      + JSON.stringify(probeWake),
    );
  }
  ctx.log('goal/T3①：supervisor 周期 probe 转绿后自动 resume 同一 run（无人工确认/无 supersede）');

  // T3① 后继分支：用真实 crash 窗留下 RECOVERY_PENDING，再由 supervisor 消费
  // 既有 phase_halt 的 successor_required 交接，生产 CLI 必须自动改走 --supersede，
  // 并把责任阶段作为新 run 起点。
  const successorFeature = 'supervisor-successor';
  runDriver('provision', null, successorFeature);
  const truncated = runDriver('successor_source_crash', null, successorFeature);
  const successorWake = truncated.runId
    ? runDriver('supervisor_successor_wake', truncated.runId, successorFeature)
    : null;
  const successorArgs = successorWake?.supervisorRunnerArgs ?? [];
  if (!successorWake || successorWake.error !== null || successorWake.exitCode !== 0
    || successorWake.supervisorAction !== 'resume'
    || !successorArgs.includes('--start') || !successorArgs.includes('coding')
    || !successorArgs.includes('--supersede') || !successorArgs.includes(truncated.runId)
    || !successorArgs.includes('--force') || !successorArgs.includes('--detach')) {
    throw new Error(
      'goal/T3①：截断链不可回退时 supervisor 应自动 supersede 并从 coding 起后继。实得 '
      + JSON.stringify({ truncated, successorWake }),
    );
  }
  // 参数只是 supervisor 的意图；再启动一次真实 goal-runner，读取生产 writer
  // 写出的最终 successor manifest，钉住一次性出生字段不会被整对象深拷贝带过来。
  //
  // 2026-08-17：删去两条 `vision_lineage` 断言（源须为 'reset'、后继须不带该字段）。
  // 该字段随 e5d8a2c4 T2 5a **有意净删除 vision 认证控制面**（提交 7792165c）一并退役
  // ——签名维度整体退出、checkpoint 退化为账本恢复缓存。全仓生产代码现零引用，
  // 只剩此处断言，于是它永远索取一个再也不会被写出的字段，成为发版死结。
  // 机制已删而断言留存属遗留清理，不是放宽验证：successor 身份仍由 successor_of
  // 绑定 + 新 runId + 从 coding 起步三条钉住。
  const successorRun = runDriver('successor_manifest_probe', truncated.runId, successorFeature);
  const successorManifest = successorRun.manifest;
  if (successorRun.error !== null || !successorRun.runId || successorRun.runId === truncated.runId
    || !successorRun.phaseStartsThisCall.includes('coding')
    || !successorManifest
    || successorManifest.successor_of !== truncated.runId) {
    throw new Error(
      'goal/T3①：真实后继必须新起 run、从 coding 起步并写出 successor_of 绑定的 manifest。实得 '
      + JSON.stringify({ truncated, successorWake, successorRun }),
    );
  }
  ctx.log('goal/T3①：截断链自动 supersede，真实后继从 coding 起步且 successor_of 绑定源 run');

  const resume = runDriver('resume_after_park', park.runId);
  // ---- 目标断言（2026-08-06 垂直闭环落地，棘轮翻转而来；fa0663 的解）：
  // 无 HMAC resume 零拦截（不求 ack）；最早未完成的 WAITING(external) phase（ut）
  // **真正重新执行**（start_index 收口形态在此必挂）；设备仍锁 → 如实再停放。
  const goalBehavior = resume.error === null && resume.exitCode === 2
    && resume.runEndReason === null && resume.runEndError === null
    && resume.phaseStartsThisCall.includes('ut');
  if (!goalBehavior) {
    throw new Error(
      'goal/resume（T4#3 判据）：resume 应零 ack 过门且 ut 真正重新执行后如实再停放'
      + '（PARTIAL exit 2）。实得 ' + JSON.stringify(resume),
    );
  }
  ctx.log('goal/resume：零 ack 过门，WAITING(external) 重新入队，ut 真正重跑后如实再停放（#3 覆盖）');

  // 第三段（codex 第九批 P0 后半闭环）：设备恢复 READY → 同一 run 无钥匙**真正完成**。
  // 此前只证明了"仍锁时能再次停放"；这一段证明"设备好了就能收官"——
  // exit 0 + 报告无 WAITING 残留（旧 halt 被后续 PASS 清除）+ 完成态不封顶人工复核。
  const ready = runDriver('resume_with_device_ready', park.runId);
  const readyOk = ready.error === null && ready.exitCode === 0
    && ready.phaseStartsThisCall.includes('ut') && ready.phaseStartsThisCall.includes('testing');
  if (!readyOk) {
    throw new Error(
      'goal/ready：设备 READY 后同一 run 应无钥匙完整收官（exit 0，ut/testing 真跑）。实得 '
      + JSON.stringify(ready),
    );
  }
  // codex 第九批收尾 P2：注释声称的两条必须真的断言——**读发布件宿主上的报告**
  // （开发仓 unit 验过一遍不算数：这里验的是 clone 出来的字节跑出的报告）
  const reportPath = path.join(ctx.cloneRoot, 'doc', 'features', feature, 'goal-runs',
    park.runId, 'goal-report.json');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (report.status !== 'CHAIN_SLICE_COMPLETED') {
    throw new Error(`goal/ready：无钥匙完成态应为 CHAIN_SLICE_COMPLETED（不封顶人工复核），实得 ${report.status}`);
  }
  const staleWaiting = (report.phases ?? []).filter(p => p.run_disposition === 'WAITING');
  if (staleWaiting.length > 0) {
    throw new Error('goal/ready：报告不得残留 WAITING 投影（旧 halt 须被后续 PASS 清除）：'
      + JSON.stringify(staleWaiting));
  }
  ctx.log('goal/ready：设备恢复后同一 run 无钥匙完整收官（报告 CHAIN_SLICE_COMPLETED、零 WAITING 残留）');

  // 【第五段已删除 · pass snapshot 退役（runner-owned-machine-facts）】原"cache miss
  // 自动丢弃重跑"场景不复存在——#4 的新语义（全链推进零场外快照依赖）由上面
  // fresh→park→resume→ready 全链真跑天然覆盖。
  ctx.log('goal/#4：pass snapshot 已退役——全链零场外快照依赖（前四段覆盖）');

  // 第六段（T4#5）：UT agent 窗口真实改产品源码。runner 必须把 review closure
  // 后的漂移作为未受信事实，原子失效 coding/review/ut 并自动回 coding；不得把它
  // 变成 testing_write_violation 或人工签字循环。
  //
  // 2026-09-03 路由校准（**只改期望的 reason 字面量，实质保证一个不减**）：
  // 未受信源码漂移有两条都活着的生产路径——
  //   · `phase_write_violation`：改写落在 agent invoke 窗口内，由 pre/post hash 直接
  //     归属到该次 invocation（goal-phase-runtime.ts:7504）。这是本场景（UT agent
  //     在自己窗口里改产品源码）的确定性路由，也是 MIGRATION「视觉闭环二期 S4」
  //     写明的 3.0.0 语义：作废本 invocation 与旧 closure，自动 backtrack 回 coding 全量重验。
  //   · `untrusted_source_drift_revalidation`：ut/testing **harness 之后**由
  //     `reconcileMutablePhaseSourceDrift` 比对 review closure 基线发现（同文件 :9340），
  //     覆盖「不在任何 invoke 窗口内的漂移」。该路由由 adjudication.unit.test.ts 保持覆盖。
  // 本用例钉前者（写窗口内），不写成 OR：路由静默改道应当让这条门红，而不是被兜住。
  const utMutationFeature = 'ut-source-mutation';
  runDriver('provision', null, utMutationFeature);
  const utMutation = runDriver('ut_source_mutation', null, utMutationFeature);
  const mutationRecord = utMutation.invalidationRecords.find(r =>
    r.reason === 'phase_write_violation'
      && r.to_phase === 'coding'
      && r.invalidated_phases?.includes('coding')
      && r.invalidated_phases?.includes('review'));
  if (utMutation.error !== null || utMutation.exitCode !== 0
    || !mutationRecord
    || !utMutation.phaseStartsThisCall.includes('coding')
    || utMutation.eventTypes.includes('testing_write_violation')
    || utMutation.phaseHalts.some(h => h.halt_reason === 'awaiting_human_review')) {
    throw new Error(
      'goal/#5：UT 改源码应自动回 coding 并重新闭环，不得求人/终局。实得 '
      + JSON.stringify(utMutation),
    );
  }
  ctx.log('goal/#5：UT 源码漂移经原子失效自动回 coding，重跑后收官');

  // 第六段（T2 5c）：唯一原子失效记录落盘后立即模拟进程崩溃，再用同一 run 恢复。
  // 断言 crash 窗只有 requested、没有 pending/completed 二态；resume 仍从 plan 起步，
  // 并保留 files/defects/fingerprint 交接上下文。
  const crashFeature = 'atomic-invalidation-crash';
  runDriver('provision', null, crashFeature);
  const crashed = runDriver('crash_scope_in_run', null, crashFeature);
  const crashRecord = crashed.invalidationRecords.find(r =>
    r.reason === 'plan_authority_unverifiable' && r.invalidated_phases?.includes('plan'));
  const crashContext = crashRecord
    && Array.isArray(crashRecord.files)
    && Array.isArray(crashRecord.defects)
    && Object.prototype.hasOwnProperty.call(crashRecord, 'fingerprint');
  if (crashed.error !== null || crashed.exitCode !== 1
    || crashed.runEndReason !== 'uncaught_exception'
    || !crashed.eventTypes.includes('phase_backtrack_requested')
    || crashed.eventTypes.includes('phase_backtrack_started')
    || !crashContext || !crashed.runId) {
    throw new Error(
      'goal/#6：原子失效记录落盘后崩溃应可恢复，且不得出现第二态。实得 '
      + JSON.stringify(crashed),
    );
  }
  const resumedCrash = runDriver('resume_after_crash_scope', crashed.runId, crashFeature);
  if (resumedCrash.error !== null || resumedCrash.exitCode !== 0
    || !resumedCrash.phaseStartsThisCall.includes('plan')
    || !resumedCrash.phaseStartsThisCall.includes('coding')
    || resumedCrash.invalidationRecords.length !== 1
    || resumedCrash.invalidationRecords[0]?.invalidated_phases?.includes('plan') !== true) {
    throw new Error(
      'goal/#6：resume 必须消费同一条失效记录并从 plan/coding 继续，交接不得丢失。实得 '
      + JSON.stringify(resumedCrash),
    );
  }
  ctx.log('goal/#6：原子失效记录 crash-safe，resume 同一 run 从 plan/coding 继续');

  // 第七段（T4#7）：真实 phase verdict 写入 UT build blocker。`ut_hvigor_build`
  // 的无结构化 device_toolchain 标注仍是可回修的 code_regression；相同内容失败
  // 只允许在既有 phase retry 上限内收口，不能误归 toolchain 或无限空转。
  const buildFailureFeature = 'ut-build-failure';
  runDriver('provision', null, buildFailureFeature);
  const buildFailure = runDriver('ut_build_failure', null, buildFailureFeature);
  const buildFailureOk = buildFailure.error === null
    && buildFailure.exitCode === 1
    && (buildFailure.failureKinds?.length ?? 0) > 0
    && buildFailure.failureKinds.every(k => k === 'code_regression')
    && buildFailure.phaseHalts.some(h => h.halt_reason === 'content_retry_exhausted')
    && !buildFailure.eventTypes.includes('phase_backtrack_requested')
    && buildFailure.agentCalls < 8;
  if (!buildFailureOk) {
    throw new Error(
      'goal/#7：build FAIL 应归 code_regression 并在 phase retry 上限收口，不得误判 toolchain/无限重试。实得 '
      + JSON.stringify(buildFailure),
    );
  }
  ctx.log('goal/#7：build 失败保留 code_regression 归因，在 phase retry 上限收口且不无限空转');

  // 第四段（#8 整机面）：fresh + head 失配 → **自动续跑**，不 TERMINAL 不裸崩
  // ——宿主 run1"第一死"的整机级回放。独立 feature（first-death），与 recovery-park
  // 的 head 文件天然隔离。
  //
  // 2026-08-17：删去 `lineage_discontinuity` / `vision_ledger_tamper` 两个事件断言。
  // vision lineage 全家（feature head / 世代计数 / lineage_discontinuity）已由
  // plan a1f4d8e6「视觉机制减法」整体剪除，全仓生产代码零引用；这两个事件再也不会
  // 被发出，前者遂成永久失败、后者恒真。**被验的行为本身没变也没放宽**：失配后
  // 仍须自动续跑（spec 真跑）、不裸崩、正常收口——只是不再索取已退役的事件名。
  const fd = runDriver('seed_head_mismatch', null, 'first-death');
  const fdOk = fd.error === null && (fd.exitCode === 0 || fd.exitCode === 2)
    && fd.phaseStartsThisCall.includes('spec')
    && fd.runEndReason !== 'uncaught_exception';
  if (!fdOk) {
    throw new Error(
      'goal/#8：head 失配应自动续跑（spec 真跑、不裸崩、正常收口）。实得 '
      + JSON.stringify(fd),
    );
  }
  ctx.log('goal/#8：head 失配自动续跑收官（第一死根治，整机面）');
}

/**
 * 顺序即宿主的真实时间线。**装依赖分两次**：clone 前那次是为了在发布件内读
 * runtime-artifact policy（也证明包能装），clone 后那次才是"换机后的消费者"，
 * 且执行根随之切到 clone——否则后面验的还是旧副本（codex 第七批 P1）。
 */
const STAGES = [
  { id: 'install', run: stageInstall, async: true },
  { id: 'depsHost', run: stageDepsHost },
  { id: 'commit', run: stageCommit },
  { id: 'clone', run: stageClone },
  { id: 'depsClone', run: stageDepsClone },
  { id: 'upgradeOverlay', run: stageUpgradeOverlay },
  { id: 'checkGlobal', run: stageCheckGlobal },
  { id: 'goal', run: stageGoal },
];

// ---------------------------------------------------------------------------
// 驱动：所有框架能力都从**发布件里**取，不从源码仓取
// ---------------------------------------------------------------------------

/**
 * 在消费者 harness 里用**发布件自带的 ts-node** 求值一段 TS，取回 JSON。
 *
 * 这一条是整机链的要害：如果这里图省事 `import` 源码仓的 ts 模块，那验的又是
 * 源码而不是发布件——回到"源码仓内自证"，本 stage 就白跑了。
 */
/** 结果分隔符：发布件的 check 代码会往 stdout 打日志，必须能把返回值切出来 */
const RESULT_MARK = "<<smoke-result>>";

function evalInShipped(ctx, expr) {
  const tsNode = path.join(ctx.harnessRoot, 'node_modules', 'ts-node', 'dist', 'bin.js');
  if (!fs.existsSync(tsNode)) throw new Error(`发布件内缺 ts-node：${tsNode}`);
  const r = mustRun('shipped eval', process.execPath, [
    tsNode, '--transpile-only', '-e',
    `const __out = (() => { ${expr} })();`
    + `process.stdout.write(${JSON.stringify(RESULT_MARK)} + JSON.stringify(__out ?? null));`,
  ], { cwd: ctx.harnessRoot });
  const at = r.stdout.lastIndexOf(RESULT_MARK);
  if (at < 0) throw new Error(`发布件求值未返回结果：${r.stdout.slice(-400)}`);
  return JSON.parse(r.stdout.slice(at + RESULT_MARK.length));
}

function buildContext(opts) {
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-smoke-lc-'));
  const consumerRoot = path.join(workRoot, 'consumer');
  fs.mkdirSync(consumerRoot, { recursive: true });
  const lines = [];
  const ctx = {
    workRoot,
    consumerRoot,
    tmpOut: path.join(workRoot, 'packout'),
    zipPath: opts.zipPath,
    log: msg => { lines.push(msg); console.log(`[smoke/lifecycle] ${msg}`); },
    lines,
  };
  ctx.shippedFilesInRuntimeDirs = () => evalInShipped(ctx,
    `const m = require('./scripts/utils/runtime-artifact-policy');
     return m.loadRuntimeArtifactPolicy().shipped_files_in_runtime_dirs ?? [];`);
  return ctx;
}

export async function smokeConsumerLifecycle(opts = {}) {
  assertCaseRegistryComplete();
  const ctx = buildContext(opts);
  const stageResults = [];
  try {
    console.log(`[smoke/lifecycle] 模式=${opts.zipPath ? 'candidate zip（要发的字节）' : 'repack（本地快速）'}`);
    for (const stage of STAGES) {
      const t0 = Date.now();
      const out = stage.async ? await stage.run(ctx) : stage.run(ctx);
      stageResults.push({
        id: stage.id,
        skipped: Boolean(out && out.skipped),
        ms: Date.now() - t0,
      });
      if (opts.throughStage === stage.id) break;
    }
  } finally {
    if (!opts.keepWorkdir) fs.rmSync(ctx.workRoot, { recursive: true, force: true });
    else console.log(`[smoke/lifecycle] 保留工作目录：${ctx.workRoot}`);
  }

  // ---- 收口报告：skip **必须刺眼**，否则骨架期的绿会被当成闭环 ----
  //
  // 三态分账（2026-09-03 修）：`retired` 是**一等状态**，不是"待实现"。
  // `assertCaseRegistryComplete` 早已把它当一等公民（强制 `retiredReason`），但此处
  // 统计写的是 `status !== 'covered'`，于是 plan 33714d0c 退役 #1（宿主 SCM 权责不属
  // Maison）之后，`complete` **永久为 false**，`release:all` 的 promote 门再也过不去
  // ——因为 plan 发布门禁在第 1 步就把整条链拦住了，这个死结一直没被走到。
  //
  // 这不是放宽：用例仍**不可能被悄悄抹掉**——编号须连续无空洞、总数须 ≥ MIN_KNOWN_CASES、
  // 退役必须写明 `retiredReason`、covered 必须指向真实存在的 stage，四条约束原样保留，
  // 且退役项照常逐条打印（带理由），不进静默。
  const covered = CASE_REGISTRY.filter(c => c.status === 'covered');
  const retired = CASE_REGISTRY.filter(c => c.status === 'retired');
  const pending = CASE_REGISTRY.filter(c => c.status !== 'covered' && c.status !== 'retired');
  const skippedStages = stageResults.filter(s => s.skipped).map(s => s.id);

  console.log('');
  console.log('─'.repeat(72));
  for (const c of covered) console.log(`  [covered] #${c.id} ${c.name}  ←  stage:${c.coveredBy}`);
  for (const c of retired) console.log(`  [retired] #${c.id} ${c.name}  ←  ${c.retiredReason}`);
  for (const c of pending) console.log(`  [PENDING] #${c.id} ${c.name}`);
  if (skippedStages.length > 0) console.log(`  未实现的 stage：${skippedStages.join(', ')}`);
  console.log('─'.repeat(72));

  const focusedComplete = opts.throughStage
    ? stageResults.some((stage) => stage.id === opts.throughStage) && skippedStages.length === 0
    : null;
  const complete = focusedComplete ?? (pending.length === 0 && skippedStages.length === 0);
  console.log(
    opts.throughStage && complete
      ? `[smoke/lifecycle] PASS（focused：已真实执行到 stage:${opts.throughStage}）`
      : complete
      ? `[smoke/lifecycle] PASS（完整：${CASE_REGISTRY.length} 条用例中 ${covered.length} 条由真跑 stage 覆盖` +
        `${retired.length > 0 ? `，${retired.length} 条已登记退役` : ''}，零待实现）`
      // 分母**由注册表派生**——散落硬编码是 #8 漏登记后仍能"7/7 看着挺满"的帮凶。
      // （注：MIN_KNOWN_CASES 仍是硬编码**下限**，plan 增用例时须手工上调——
      //   那是有意保留的"少登记即抛"闸，不是遗漏的硬编码总数。）
      : `[smoke/lifecycle] PASS（**骨架**：${covered.length}/${CASE_REGISTRY.length} 用例已覆盖，` +
        `${pending.length} 项待实现）——**不构成发布门**，promote 门须要求 complete=true`,
  );
  return { complete, covered: covered.map(c => c.id), pending: pending.map(c => c.id), stageResults };
}

function parseArgs(argv) {
  const opts = { zipPath: null, keepWorkdir: false, throughStage: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--zip') opts.zipPath = path.resolve(argv[i + 1] ?? '');
    else if (argv[i] === '--keep-workdir') opts.keepWorkdir = true;
    else if (argv[i] === '--through') opts.throughStage = argv[i + 1] ?? null;
  }
  if (opts.zipPath && !fs.existsSync(opts.zipPath)) {
    throw new Error(`--zip 指向的文件不存在：${opts.zipPath}`);
  }
  if (opts.throughStage && !STAGES.some((stage) => stage.id === opts.throughStage)) {
    throw new Error(`--through 指向未知 stage：${opts.throughStage}`);
  }
  return opts;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  smokeConsumerLifecycle(parseArgs(process.argv.slice(2)))
    .then(result => {
      if (!result.complete) process.exitCode = 1;
    })
    .catch(err => {
      console.error('[smoke/lifecycle] FAIL:', err.message);
      process.exit(1);
    });
}

export { CASE_REGISTRY, STAGES, TEST_ONLY_GITIGNORE, REPO_ROOT };
