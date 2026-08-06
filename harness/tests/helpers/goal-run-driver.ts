// ============================================================================
// goal-run-driver.ts — 在**子进程**里跑一次真实 goal run（e5d8a2c4 T4）
// ----------------------------------------------------------------------------
// 为什么必须是子进程（2026-08-06 实测，别再退回进程内）：
//   `goalMain()` 会 `setupSignalHandlers()` 等一系列**进程级**动作。run 正常返回时
//   清理路径会跑；而本 driver 要回放的恰恰是**异常终止**（"第一死"从 runChain 里
//   裸 throw），清理没走 → 信号处理器/定时器留在测试进程里 → 后续套件一碰，
//   **整个 run-unit 进程 SIGINT 退出（exit 130）**，连汇总都打不出来。
//   实测：摘掉该用例 3047/0 全绿，加上它 exit 130；单跑却通过——典型的全局态污染。
//
// 为什么不 spawn `goal-runner.ts` 本体：`inferRepoLayout` 会把 framework 根解析到
//   脚本自身所在的仓，与目标宿主不匹配，config 读不到 `materialized_adapters`，
//   卡在 adapter 物化门（实测 `adapter BLOCKER: … 不在已物化候选 []`）。
//   所以子进程里仍要走 `__testing_setRepoLayout` 注入——**"子进程 + 进程内注入缝"**
//   才是可行姿势，两者缺一不可。
//
// 输出：stdout 末尾一行 `<<goal-run-result>>{json}`，调用方据此断言。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

export const RESULT_MARK = '<<goal-run-result>>';

/** 缺省 framework 根＝本开发仓（单测用）；smoke 会显式传 clone 出来的发布件根。 */
const DEV_FRAMEWORK_ROOT = path.resolve(__dirname, '../../..');

/**
 * **从指定 framework 根动态加载被测实现**（codex 第八批 P1）。
 *
 * 初版是静态 `import ... from '../../scripts/goal-runner'`，即恒锚在开发仓；而
 * `harness/tests/**` 又被 `release-excludes.json:11` 排除、根本不进发布件。
 * 两条合起来：本 driver 作为单测 driver 有效，但**不可能**用来验 `--zip` 解出的
 * candidate——总纲里"smoke 直接喂 scenario 即可"那句记账因此是错的。
 * 现在 goal-runner / repo-layout / config 三者都从 `frameworkRoot` 取，
 * smoke 传 `ctx.clonedFrameworkRoot` 即验的是发布件本身。
 *
 * 三个模块必须来自**同一个根**：它们共享模块级状态（config 缓存、注入缝、
 * vision MAC 口径），混用两个根等于混用两份状态。
 */
function loadFrameworkModules(frameworkRoot: string): {
  goal: Record<string, unknown>;
  config: { clearFrameworkConfigCache(): void };
} {
  const req = (rel: string): Record<string, unknown> =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require(path.join(frameworkRoot, rel)) as Record<string, unknown>;
  return {
    goal: req('harness/scripts/goal-runner'),
    config: req('harness/config') as unknown as { clearFrameworkConfigCache(): void },
  };
}

export interface DerivedRepoLayout {
  kind: 'standalone' | 'consumer';
  projectRoot: string;
  frameworkRoot: string;
  /** framework 相对 projectRoot 的 posix 路径；standalone 为空串 */
  frameworkRel: string;
}

/**
 * 由**两个根的关系**派生 layout，不再硬编码（codex 第十批 P1）。
 *
 * 初版恒注入 `kind:'standalone'` + `frameworkRel:''`。单测形态下它恰好是对的
 * （宿主是临时目录、framework 在开发仓，两者无包含关系）；但 smoke 的真实组合是
 * `projectRoot = ctx.cloneRoot`、`frameworkRoot = ctx.cloneRoot/framework`
 * ——**嵌套形态，语义是 consumer**。伪装成 standalone 的后果：
 *   · consumer 专属的 `RELEASE-MANIFEST` 校验被跳过；
 *   · `harnessPrefixRel` 生成成 `harness` 而不是 `framework/harness`（给人的指引指错路）。
 * 而当前 #8 单测用的是外置开发仓，**覆盖不到这个错**——所以另加结构断言钉住
 * consumer 组合（见 smoke-lifecycle-registry 套件）。
 *
 * **值空间是闭集，不得放宽**（codex 第十一批 P2）：`RepoLayout.frameworkRel` 的契约
 * 注释就写着「'' 或 'framework'」（`harness/repo-layout.ts:17`），且 `:126` 正是靠
 * `frameworkRel === 'framework'` 反推 kind。初版写成"任意子目录皆 consumer"，
 * 于是 `/host` + `/host/cache/framework` 会派生出 `frameworkRel='cache/framework'`
 * ——一个既有契约不支持的状态。标准 smoke 路径碰巧落在合法值上，所以不会当场出事，
 * 但那是**悄悄扩大下游值空间**，与本纲刚删掉的 `precondition_unmet` 兜底类同款。
 * 故：只认 `framework`，其余内部嵌套 **fail-fast**。
 */
export function deriveRepoLayout(projectRoot: string, frameworkRoot: string): DerivedRepoLayout {
  const rel = path.relative(projectRoot, frameworkRoot).split(path.sep).join('/');
  // 同一路径 / 仓外 → standalone（单测形态：framework 在开发仓，宿主在临时目录）
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    return { kind: 'standalone', projectRoot, frameworkRoot, frameworkRel: '' };
  }
  if (rel !== 'framework') {
    throw new Error(
      `[goal-run-driver] 不支持的嵌套形态：frameworkRoot 相对 projectRoot 为 "${rel}"。`
      + 'RepoLayout 契约只允许 frameworkRel ∈ {"", "framework"}（repo-layout.ts:17）——'
      + '在此放宽等于凭空造出下游无人处理的状态。',
    );
  }
  return { kind: 'consumer', projectRoot, frameworkRoot, frameworkRel: 'framework' };
}

export interface GoalRunOutcome {
  /** goalMain 的返回码；抛异常时为 null */
  exitCode: number | null;
  /** 裸 throw 的消息（"不裸崩"的判据就是它为 null） */
  error: string | null;
  /** events.jsonl 的事件类型序列（按 run 目录合并） */
  eventTypes: string[];
  /** 注入 agent 被调用次数——死在 phase 之前时应为 0 */
  agentCalls: number;
}

function w(root: string, rel: string, content: string): void {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

function git(root: string, args: string[]): void {
  spawnSync('git', args, { cwd: root, encoding: 'utf-8' });
}

/** 最小可跑宿主：generic profile（coding/ut/testing 全禁），够跑到 vision head 裁决点 */
export function setupMinimalHost(feature: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-drv-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  w(root, 'framework.config.json', JSON.stringify({
    schema_version: '1.1',
    project_name: 'GoalDriverHost',
    project_profile: { name: 'generic' },
    paths: { features_dir: 'doc/features', docs_committed: false },
    materialized_adapters: ['cursor'],
  }, null, 2));
  // cursor 的 agent_entry_file.target_path = AGENTS.md（agents/cursor/adapter.yaml）
  w(root, 'AGENTS.md', '# AGENTS\n');
  w(root, 'framework.local.json', JSON.stringify({ schema_version: '1.0', agent_adapter: 'cursor' }, null, 2));
  w(root, 'doc/module-catalog.yaml', 'schema_version: "1.0"\nmodules: []\n');
  w(root, 'doc/glossary.yaml', 'schema_version: "1.0"\nterms: []\n');
  w(root, `doc/features/${feature}/spec/spec.md`, '# spec\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'init']);
  return root;
}

function readEventTypes(root: string, feature: string): string[] {
  const runsDir = path.join(root, 'doc/features', feature, 'goal-runs');
  if (!fs.existsSync(runsDir)) return [];
  const types: string[] = [];
  for (const r of fs.readdirSync(runsDir).filter(n => !n.startsWith('.'))) {
    const f = path.join(runsDir, r, 'events.jsonl');
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf-8').split('\n').filter(Boolean)) {
      try { types.push((JSON.parse(line) as { type?: string }).type ?? '?'); } catch { types.push('?'); }
    }
  }
  return types;
}

/**
 * 场景：`seed_head_mismatch` —— 种一份与当前账本快照失配的 feature head，
 * 然后 fresh 启动且**不声明** `--vision-lineage=reset`。这就是宿主主仓 run1
 * （6a969a）"启动 11 秒即死"的形态：head 存场外、账本在 repo 内，跨存储域失配
 * 是结构常态而非攻击信号。
 */
async function runScenario(args: {
  scenario: string;
  feature: string;
  /** 被测 framework 根：smoke 传 clone 出来的发布件根；单测传开发仓 */
  frameworkRoot: string;
  /**
   * 被测**宿主工程**根——由调用方创建并拥有（codex 第九批 P1）。
   *
   * driver **不再自建宿主**：初版内部 `setupMinimalHost()`，于是即便 smoke 传对了
   * frameworkRoot，形态仍是「宿主 A：install→commit→autocrlf clone→integrity ／
   * 宿主 B：新建最小宿主→goal run」——**两个半链各自绿**，宿主 A 上的 gitignore、
   * CRLF、配置、冻结状态全没被 goal 消费，正是本纲要治的假绿形态。
   * 现在 smoke 直接传 `ctx.cloneRoot`，单测传自己建的最小宿主，一条链一个宿主。
   * 顺带解决目录归属：谁建谁删，父进程 `finally` 兜得住超时/解析失败。
   */
  projectRoot: string;
}): Promise<GoalRunOutcome> {
  const { scenario, feature, frameworkRoot, projectRoot: root } = args;
  const { goal, config } = loadFrameworkModules(frameworkRoot);
  process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'trust-cp');

  if (scenario === 'seed_head_mismatch') {
    // **用生产 writer 种 head**，不手拼 JSON：writer 与 reader 同源，
    // 否则又是"夹具与真实 writer 形状不符"（第五批 P0 的原样重演）。
    (goal.writeVisionFeatureHead as (a: unknown) => unknown)({
      projectRoot: root,
      feature,
      runId: 'seeded-prior-run',
      files: [{ path: `doc/features/${feature}/ux-reference/vision-ledger.json`, sha256: 'f'.repeat(64) }],
      generation: 3,
    });
  }

  (goal.__testing_setRepoLayout as (l: unknown) => void)(deriveRepoLayout(root, frameworkRoot));
  let agentCalls = 0;
  (goal.__testing_setInvokeAgent as (f: unknown) => void)(async () => {
    agentCalls += 1;
    return { exitCode: 0, timedOut: false, stdout: '', stderr: '', command: 'noop' };
  });
  (goal.__testing_setRunHarnessPhase as (f: unknown) => void)(async () => ({ verdict: 'PASS', blockers: [] }));

  process.argv = [
    'node', 'goal-runner.ts',
    '--feature', feature,
    '--requirement', `T4 driver scenario=${scenario}`,
    '--start', 'spec', '--end', 'spec',
    '--adapter', 'cursor',
    '--foreground-ok', '--force',
  ];
  process.chdir(root);
  config.clearFrameworkConfigCache();

  let exitCode: number | null = null;
  let error: string | null = null;
  try {
    exitCode = await (goal.main as () => Promise<number>)();
  } catch (e) {
    error = (e as Error).message;
  }
  const out: GoalRunOutcome = {
    exitCode,
    error,
    eventTypes: readEventTypes(root, feature),
    agentCalls,
  };
  (goal.__testing_resetGoalRunnerSeams as () => void)();
  // 宿主目录**不在此删**——谁建谁删，见 runScenario 的 projectRoot 注释
  return out;
}

if (require.main === module) {
  const [, , scenario, feature, frameworkRootArg, projectRootArg] = process.argv;
  if (!scenario || !feature || !projectRootArg) {
    process.stderr.write(
      'usage: goal-run-driver.ts <scenario> <feature> <frameworkRoot|-> <projectRoot>\n'
      + '  projectRoot **必填**：driver 不自建宿主，一条整机链只能有一个宿主。\n',
    );
    process.exit(2);
  }
  runScenario({
    scenario,
    feature,
    // `-` = 用开发仓（单测形态）；smoke 传 clone 出来的发布件根
    frameworkRoot: frameworkRootArg && frameworkRootArg !== '-'
      ? path.resolve(frameworkRootArg)
      : DEV_FRAMEWORK_ROOT,
    projectRoot: path.resolve(projectRootArg),
  })
    .then(out => {
      process.stdout.write(`\n${RESULT_MARK}${JSON.stringify(out)}\n`);
      process.exit(0);
    })
    .catch(e => {
      process.stdout.write(`\n${RESULT_MARK}${JSON.stringify({ driverError: (e as Error).message })}\n`);
      process.exit(0);
    });
}
