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
// 真实 zip、真实 git、真实 checkout、真实 integrity。
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
// M5A §4.3：逻辑 featureId → 物理相对路径唯一 SSOT（零依赖 CJS；dev 脚本直接静态消费，不带副本）
import { featureRelativePath } from '../harness/scripts/utils/feature-identity.js';

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
 */
const CASE_REGISTRY = [
  {
    id: 1,
    name: '发布文件被宿主 .gitignore 吞掉',
    status: 'covered',
    coveredBy: 'commit',
    note: '历史宽规则预置在 stage install，commit 后核对发布件是否真的进了索引',
  },
  {
    id: 2,
    name: 'sidecar CRLF 假失败',
    status: 'covered',
    coveredBy: 'integrity',
    note: 'autocrlf=true clone 后跑 framework_integrity，CRLF 通道是真的走过的',
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
];

/**
 * 注册表完整性——**这是防"假绿"的那道门**。
 *
 * 硬学习原文：显式注册表 + 新套件不注册 = 假绿。这里反过来用：**少注册也是假绿**
 * （悄悄删掉一个用例，整机 smoke 照样 PASS）。
 */
export function assertCaseRegistryComplete(registry = CASE_REGISTRY) {
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
  // 已知下限：plan 明确定义到 #8（七个回放用例 + A【P0】增补的 #8）。
  // 少于它一定是漏登记——**这是"少注册也是假绿"的那道门**，plan 再增用例时须同步上调。
  const MIN_KNOWN_CASES = 8;
  if (ids.length < MIN_KNOWN_CASES) {
    throw new Error(
      `[smoke] plan 已定义到 #${MIN_KNOWN_CASES}，注册表只有 ${ids.length} 条——有用例未登记`,
    );
  }
  for (const c of registry) {
    if (c.status === 'covered' && !c.coveredBy) {
      throw new Error(`[smoke] 用例 #${c.id} 声称 covered 却未指明由哪个 stage 覆盖`);
    }
  }
  return registry;
}

// ---------------------------------------------------------------------------
// 宿主侧夹具
// ---------------------------------------------------------------------------

/**
 * 2026-04-25 由 framework-init 写入宿主的**历史宽规则**（事故① 的真实起点）。
 *
 * 这不是编出来的：`canonical-gitignore.ts:100` 的注释就在说它——updater 只追加
 * 不删除，所以这条目录式规则会一直在宿主的 .gitignore 里。派生形状必须**压得过它**，
 * 而 git 的硬规则是：父目录被排除时，子文件的 `!` 再写也没用。
 */
const HISTORICAL_GITIGNORE = [
  '# --- 宿主既有内容（2026-04-25 framework-init 写入，updater 只追加不删）---',
  'node_modules/',
  'framework/harness/reports/',
  'framework/harness/state/',
  'framework/harness/trace/',
  '',
].join('\n');

const MODULE_CATALOG_YAML = 'schema_version: "1.0"\nmodules: []\n';
const GLOSSARY_YAML = 'schema_version: "1.0"\nterms: []\n';
const FRAMEWORK_CONFIG_JSON = `{
  "schema_version": "1.1",
  "project_profile": {
    "name": "generic"
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
 * S1 install —— 把**发布件**装进一个带历史 .gitignore 的临时宿主。
 *
 * `zipPath` 在场时用它（candidate 的同一字节）；否则本地重 pack（快速模式）。
 * 前者才是"验的是要发的字节"，后者只适合改代码时的快速回归。
 */
async function stageInstall(ctx) {
  const { consumerRoot, zipPath, tmpOut } = ctx;
  fs.mkdirSync(path.join(consumerRoot, 'doc'), { recursive: true });
  fs.writeFileSync(path.join(consumerRoot, 'doc', 'module-catalog.yaml'), MODULE_CATALOG_YAML, 'utf8');
  fs.writeFileSync(path.join(consumerRoot, 'doc', 'glossary.yaml'), GLOSSARY_YAML, 'utf8');
  fs.writeFileSync(path.join(consumerRoot, 'framework.config.json'), FRAMEWORK_CONFIG_JSON, 'utf8');
  // **先**写历史 .gitignore：宿主的真实时间线就是"先有旧规则，后装新框架"
  fs.writeFileSync(path.join(consumerRoot, '.gitignore'), HISTORICAL_GITIGNORE, 'utf8');

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
 * 为什么 clone 之前就要装：commit 阶段要跑**发布件内的** `ensureCanonicalGitignore`，
 * 而 `evalInShipped` 需要发布件自带的 ts-node。顺带也证明了发布件的 harness/package.json
 * 真的装得起来。clone 之后会**再装一次**（node_modules 被 .gitignore，克隆不带），
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
 * S3 commit —— git init + canonical gitignore + commit，然后**核对发布件真的进了索引**。
 *
 * 事故① 的整机断言就在这里：历史宽规则把 `framework/harness/trace/` 整目录排除，
 * 而发布件里有 `trace.schema.json` / `gap-notes.template.md`。派生形状若压不过
 * 那条历史规则，这些文件根本不会进 commit——宿主换机 clone 后就少文件。
 */
function stageCommit(ctx) {
  const { consumerRoot } = ctx;
  git(consumerRoot, 'init', '-q');
  git(consumerRoot, 'config', 'user.email', 'smoke@example.invalid');
  git(consumerRoot, 'config', 'user.name', 'smoke');
  git(consumerRoot, 'config', 'commit.gpgsign', 'false');

  // framework-init 的 gitignore 收编（发布件内的实现，不是源码仓的）
  ctx.applyCanonicalGitignore(consumerRoot);

  git(consumerRoot, 'add', '-A');
  git(consumerRoot, 'commit', '-q', '-m', 'smoke: consumer initial commit');

  const tracked = new Set(
    git(consumerRoot, 'ls-files').stdout.split('\n').map(s => s.trim()).filter(Boolean),
  );
  ctx.trackedFiles = tracked;

  const shipped = ctx.shippedFilesInRuntimeDirs();
  // **非空转断言**：`shipped` 为空时 `filter` 恒得空集，这一格就什么都没验——
  // 拿 3.0.0 之前的 dist zip 实跑时正是如此（旧包的 policy 还是 schema 1.0、
  // 无 `shipped_files_in_runtime_dirs`），"0 个全部收编"看着还挺像通过的。
  // 空集只可能是两种情况，都必须停下来说清楚，不能静默放行。
  if (shipped.length === 0) {
    throw new Error(
      '被测发布件的 runtime-artifact-policy 未声明 shipped_files_in_runtime_dirs——' +
      '用例 #1 在这个包上**无可验对象**。要么它早于 schema 1.1（拿了旧包来测），' +
      '要么发布件确实不再有落在 ignored 目录内的文件（那需要回头修订用例 #1 本身）。',
    );
  }
  const swallowed = shipped.filter(rel => !tracked.has(`framework/${rel}`));
  if (swallowed.length > 0) {
    throw new Error(
      `事故①回归：历史 .gitignore 吞掉了发布件 —— ${swallowed.join(', ')}\n` +
      '（派生形状必须压得过 2026-04-25 的目录式宽规则：`!<dir>/` 前置 + `<dir>/*` + 逐文件 `!`）',
    );
  }
  ctx.log(`commit：${tracked.size} 个文件进索引，${shipped.length} 个 ignored 目录内发布件全部收编`);
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

  // 换机后发布件仍须齐全（事故① 的另一半：commit 进去了、clone 出来也要在）
  const shipped = ctx.shippedFilesInRuntimeDirs();
  const missing = shipped.filter(rel => !fs.existsSync(path.join(ctx.clonedFrameworkRoot, rel)));
  if (missing.length > 0) {
    throw new Error(`事故①回归：clone 后发布件缺失 —— ${missing.join(', ')}`);
  }

  // CRLF 通道确实生效了吗？——**必须断言，不能只打印**（codex 第七批 P1）。
  // 初版只把结果记进 ctx 就放行：万一 checkout 通道没生效（.gitattributes 锁 LF、
  // git 配置被覆盖…），后面的 integrity 会在**纯 LF 文件**上轻松通过，而用例 #2
  // 仍被静态标成 covered——一条什么都没验的绿。
  // 探针选 `RELEASE-MANIFEST.json`：它是**用例 #2 真正关心的那个文件**（sidecar
  // 自检比的就是它的字节），且任何发布件里都必然存在。初版拿 trace.schema.json 当探针，
  // 那文件恰好是"可能被 gitignore 吞掉"的那批之一——上一格若空转放行，这里就以
  // ENOENT 崩掉而不是给出可读结论。
  const probe = path.join(ctx.clonedFrameworkRoot, 'RELEASE-MANIFEST.json');
  if (!fs.existsSync(probe)) throw new Error(`clone 后缺 RELEASE-MANIFEST.json：${probe}`);
  const raw = fs.readFileSync(probe);
  ctx.autocrlfObserved = raw.includes(Buffer.from('\r\n', 'utf-8'));
  if (!ctx.autocrlfObserved) {
    throw new Error(
      `autocrlf 通道未生效：${path.basename(probe)} 在 clone 后仍是纯 LF。` +
      '此时 integrity 是在 LF 文件上通过的，用例 #2（CRLF 假失败）等于没验——' +
      '不得放行。（检查 clone 是否真的带了 -c core.autocrlf=true、发布件是否有 .gitattributes 锁 LF）',
    );
  }
  ctx.log('clone：autocrlf checkout 完成，探针文件已确认含 CRLF');
}

/**
 * S5 integrity —— 在**CRLF 化的工作区**上跑 framework_integrity。
 *
 * 事故② 就是在这一幕出现的：per-file 早已 EOL 归一，唯独 sidecar 仍按原始字节比对，
 * 于是 autocrlf 一开就报 tampered。这里跑的是**发布件里的**实现，不是源码仓的。
 */
function stageIntegrity(ctx) {
  const r = ctx.runIntegrityPreflight(ctx.clonedFrameworkRoot, ctx.cloneRoot);
  const blocking = r.filter(x => x.severity === 'BLOCKER' && x.status === 'FAIL');
  if (blocking.length > 0) {
    throw new Error(
      `事故②回归：CRLF 工作区上 framework_integrity 报 BLOCKER —— ` +
      // 字段名是 `details`（发布件 CheckResult）——初版写 `detail ?? message`，
      // 两个都不存在，失败文案退化成 JSON 兜底（fable 第七批 P3）
      blocking.map(b => b.details ?? JSON.stringify(b)).join(' | '),
    );
  }
  ctx.log(`integrity：${r.length} 项检查，无 BLOCKER FAIL（CRLF 通道未产生假失败）`);
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
  // M5A §4.3：读发布件宿主上的报告——feature 逻辑 id 经唯一 SSOT 展开为物理相对路径
  const reportPath = path.join(ctx.cloneRoot, 'doc', 'features', featureRelativePath(feature), 'goal-runs',
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
  const utMutationFeature = 'ut-source-mutation';
  runDriver('provision', null, utMutationFeature);
  const utMutation = runDriver('ut_source_mutation', null, utMutationFeature);
  const mutationRecord = utMutation.invalidationRecords.find(r =>
    r.reason === 'untrusted_source_drift_revalidation'
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
 * 顺序即宿主的真实时间线。**装依赖分两次**：clone 前那次是为了跑发布件内的
 * gitignore 收编（也证明包能装），clone 后那次才是"换机后的消费者"，
 * 且执行根随之切到 clone——否则后面验的还是旧副本（codex 第七批 P1）。
 */
const STAGES = [
  { id: 'install', run: stageInstall, async: true },
  { id: 'depsHost', run: stageDepsHost },
  { id: 'commit', run: stageCommit },
  { id: 'clone', run: stageClone },
  { id: 'depsClone', run: stageDepsClone },
  { id: 'integrity', run: stageIntegrity },
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
  ctx.applyCanonicalGitignore = projectRoot => evalInShipped(ctx,
    `const m = require('./scripts/utils/canonical-gitignore');
     return m.ensureCanonicalGitignore(${JSON.stringify(projectRoot)});`);
  ctx.shippedFilesInRuntimeDirs = () => evalInShipped(ctx,
    `const m = require('./scripts/utils/canonical-gitignore');
     return m.loadRuntimeArtifactPolicy().shipped_files_in_runtime_dirs ?? [];`);
  ctx.runIntegrityPreflight = (frameworkRoot, projectRoot) => evalInShipped(ctx,
    `const m = require('./scripts/utils/framework-integrity');
     return m.runFrameworkIntegrityPreflight({
       frameworkRoot: ${JSON.stringify(frameworkRoot)},
       projectRoot: ${JSON.stringify(projectRoot)},
     }).map(r => ({ id: r.id, severity: r.severity, status: r.status, details: r.details }));`);
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
    }
  } finally {
    if (!opts.keepWorkdir) fs.rmSync(ctx.workRoot, { recursive: true, force: true });
    else console.log(`[smoke/lifecycle] 保留工作目录：${ctx.workRoot}`);
  }

  // ---- 收口报告：skip **必须刺眼**，否则骨架期的绿会被当成闭环 ----
  const pending = CASE_REGISTRY.filter(c => c.status !== 'covered');
  const covered = CASE_REGISTRY.filter(c => c.status === 'covered');
  const skippedStages = stageResults.filter(s => s.skipped).map(s => s.id);

  console.log('');
  console.log('─'.repeat(72));
  for (const c of covered) console.log(`  [covered] #${c.id} ${c.name}  ←  stage:${c.coveredBy}`);
  for (const c of pending) console.log(`  [PENDING] #${c.id} ${c.name}`);
  if (skippedStages.length > 0) console.log(`  未实现的 stage：${skippedStages.join(', ')}`);
  console.log('─'.repeat(72));

  const complete = pending.length === 0 && skippedStages.length === 0;
  console.log(
    complete
      ? `[smoke/lifecycle] PASS（完整：${CASE_REGISTRY.length} 条用例全部由真跑 stage 覆盖）`
      // 分母**由注册表派生**——散落硬编码是 #8 漏登记后仍能"7/7 看着挺满"的帮凶。
      // （注：MIN_KNOWN_CASES 仍是硬编码**下限**，plan 增用例时须手工上调——
      //   那是有意保留的"少登记即抛"闸，不是遗漏的硬编码总数。）
      : `[smoke/lifecycle] PASS（**骨架**：${covered.length}/${CASE_REGISTRY.length} 用例已覆盖，` +
        `${pending.length} 项待实现）——**不构成发布门**，promote 门须要求 complete=true`,
  );
  return { complete, covered: covered.map(c => c.id), pending: pending.map(c => c.id), stageResults };
}

function parseArgs(argv) {
  const opts = { zipPath: null, keepWorkdir: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--zip') opts.zipPath = path.resolve(argv[i + 1] ?? '');
    else if (argv[i] === '--keep-workdir') opts.keepWorkdir = true;
  }
  if (opts.zipPath && !fs.existsSync(opts.zipPath)) {
    throw new Error(`--zip 指向的文件不存在：${opts.zipPath}`);
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

export { CASE_REGISTRY, STAGES, HISTORICAL_GITIGNORE, REPO_ROOT };
