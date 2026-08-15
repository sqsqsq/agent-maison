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
  /** 宿主 goal-runs 下最新 run 的 id（park→resume 两段式场景用；无 run 目录为 null） */
  runId: string | null;
  /**
   * 恢复场景的精确判据（e5d8a2c4 T4#3 收紧后）：resume 后指定 phase 是否真的
   * **重新开始执行**（`phase_start` 在本次调用期间新增）——只看"启动门过了"会把
   * `start_index=6 直接收口`（fa0663 实测形态）误判为成功。
   */
  phaseStartsThisCall: string[];
  /** 最后一条 run_end 的 reason / error（T1① 优雅收口后，死因在事件里而非 throw） */
  runEndReason: string | null;
  runEndError: string | null;
  failureKinds?: string[];
  phaseHalts: Array<{
    phase?: string;
    halt_reason?: string;
    detail?: string;
    failure_kind_classified?: string;
  }>;
  /** 5c：原子失效 record 的关键上下文，供 smoke 直接核对交接未丢。 */
  invalidationRecords: Array<{
    reason?: string;
    invalidated_phases?: string[];
    to_phase?: string;
    files?: string[];
    defects?: unknown[];
    fingerprint?: string | null;
  }>;
  /** T3：由生产 supervisor CLI 做出的动作与实际 spawn 参数。 */
  supervisorAction?: string | null;
  supervisorRunnerArgs?: string[];
  /** fresh successor 场景的最终 manifest（由生产 runner 写盘后读取）。 */
  manifest?: Record<string, unknown> | null;
}

function w(root: string, rel: string, content: string): void {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

function git(root: string, args: string[]): void {
  spawnSync('git', args, { cwd: root, encoding: 'utf-8' });
}

/**
 * hmos-app goal 场景的宿主夹具（设备停放/恢复场景专用；smoke 对 cloneRoot 也铺同一套）。
 *
 * 逐项都是实证出来的（缺一项就 halt 在对应门上，别删）：
 * - hmos-app profile + hvigorBin 存在性（personal-setup-gate.ts:129 `fs.existsSync`）；
 * - config-defaults 的五个产品层目录（缺→`declared_product_layer_missing`）；
 * - `framework/workflows`：部分 utils 在 phase 期**自调** `inferRepoLayout(projectRoot)`，
 *   不走 goal-runner 注入缝（cloneRoot 天然有发布件树，此处只为裸宿主兜底）；
 * - PASS 冻结清单：spec 要 acceptance.yaml、plan 要 plan.md+contracts.yaml（G1-1）、
 *   review closure 要产品源在盘（清单与 goal-runner-testing-integrity 宿主同源）；
 * - canary 声明（vision 链 spec 期消费）。
 */
export function provisionHmosGoalFixture(root: string, feature: string): void {
  w(root, 'framework.config.json', JSON.stringify({
    schema_version: '1.1',
    project_name: 'GoalDriverHost',
    project_profile: { name: 'hmos-app' },
    paths: { features_dir: 'doc/features', docs_committed: false },
    materialized_adapters: ['cursor'],
  }, null, 2));
  // cursor 的 agent_entry_file.target_path = AGENTS.md（agents/cursor/adapter.yaml）
  w(root, 'AGENTS.md', '# AGENTS\n');
  w(root, 'fake-tools/hvigor.js', '// fake hvigor for device scenarios\n');
  w(root, 'framework.local.json', JSON.stringify({
    schema_version: '1.0',
    agent_adapter: 'cursor',
    toolchain: { devEcoStudio: { hvigorBin: path.join(root, 'fake-tools', 'hvigor.js') } },
    vision: {
      canary: {
        adapter: 'cursor', verdict: 'tool_read', probed_at: new Date().toISOString(),
        probed_via: 'interactive', probe_version: 2,
      },
    },
  }, null, 2));
  for (const layer of ['01-Product', '02-Feature', '03-CommonBusiness', '04-BusinessBase', '05-SystemBase']) {
    w(root, `${layer}/.gitkeep`, '');
  }
  fs.mkdirSync(path.join(root, 'framework', 'workflows'), { recursive: true });
  const productFile = '02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets';
  w(root, productFile, 'struct AllBanksPage { build() { Text("x") } }');
  w(root, 'build-profile.json5', JSON.stringify({
    app: { products: [{ name: 'default' }] },
    modules: [{ name: 'FinancialCard', srcPath: './02-Feature/FinancialCard' }],
  }, null, 2));
  w(root, '02-Feature/FinancialCard/oh-package.json5',
    '{ "name": "financialcard", "version": "1.0.0" }');
  w(root, 'doc/module-catalog.yaml', 'schema_version: "1.0"\nmodules: []\n');
  w(root, 'doc/glossary.yaml', 'schema_version: "1.0"\nterms: []\n');
  w(root, `doc/features/${feature}/spec/spec.md`, '# spec\n');
  w(root, `doc/features/${feature}/acceptance.yaml`, `feature: ${feature}\ncriteria: []\n`);
  w(root, `doc/features/${feature}/plan/plan.md`, '# plan\n');
  w(root, `doc/features/${feature}/contracts.yaml`,
    `feature: ${feature}\nfiles:\n  - ${productFile}\n`);
}

/**
 * 最小可跑宿主。
 * - `generic`（缺省）：coding/ut/testing 全禁，够跑到 vision head 裁决点（#8 用）；
 * - `hmos-app`：唯一带 `device_capabilities` 的发布 profile——设备停放/恢复场景
 *   必须用它（generic 无设备语义，phaseRequiresDevice 恒 false，注入的设备门
 *   根本不会被调用）。capability gate 由注入桩放行（见 goal-runner 缝头注）。
 */
export function setupMinimalHost(feature: string, profile: 'generic' | 'hmos-app' = 'generic'): string {
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
  w(root, 'AGENTS.md', '# AGENTS\n');
  w(root, 'framework.local.json', JSON.stringify({ schema_version: '1.0', agent_adapter: 'cursor' }, null, 2));
  w(root, 'doc/module-catalog.yaml', 'schema_version: "1.0"\nmodules: []\n');
  w(root, 'doc/glossary.yaml', 'schema_version: "1.0"\nterms: []\n');
  w(root, `doc/features/${feature}/spec/spec.md`, '# spec\n');
  // spec PASS 冻结清单要求（T2 5a-1：#8 翻转后 seed 场景要真跑通 spec 收官）
  w(root, `doc/features/${feature}/acceptance.yaml`, `feature: ${feature}\ncriteria: []\n`);
  // 部分 utils 在 phase 期自调 inferRepoLayout（不走注入缝）——generic 场景现在也要
  // 跑真 phase（#8 续跑收官），同样需要 framework tree 喂饱探测（与 hmos 段同理由）
  fs.mkdirSync(path.join(root, 'framework', 'workflows'), { recursive: true });
  if (profile === 'hmos-app') provisionHmosGoalFixture(root, feature);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'init']);
  return root;
}

interface DriverEvent {
  type: string;
  phase?: string;
  reason?: string;
  halt_reason?: string;
  detail?: string;
  error?: string;
  invalidated_phases?: string[];
  to_phase?: string;
  files?: string[];
  defects?: unknown[];
  fingerprint?: string | null;
  failure_kind_classified?: string;
  probe?: string;
  run_disposition?: string;
  run_wait_kind?: string;
  action?: string;
  successor_required?: boolean;
  successor_start_phase?: string;
}

/** 按 run 目录名排序合并读全部 events（run id 前缀是 UTC 时间戳，字典序=时间序） */
function readEvents(root: string, feature: string): DriverEvent[] {
  const runsDir = path.join(root, 'doc/features', feature, 'goal-runs');
  if (!fs.existsSync(runsDir)) return [];
  const out: DriverEvent[] = [];
  for (const r of fs.readdirSync(runsDir).filter(n => !n.startsWith('.')).sort()) {
    const f = path.join(runsDir, r, 'events.jsonl');
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf-8').split('\n').filter(Boolean)) {
      try {
        const e = JSON.parse(line) as DriverEvent;
        out.push({
          type: e.type ?? '?',
          ...(typeof e.phase === 'string' ? { phase: e.phase } : {}),
          ...(typeof e.reason === 'string' ? { reason: e.reason } : {}),
          ...(typeof e.halt_reason === 'string' ? { halt_reason: e.halt_reason } : {}),
          ...(typeof e.detail === 'string' ? { detail: e.detail } : {}),
          ...(typeof e.error === 'string' ? { error: e.error } : {}),
          ...(Array.isArray(e.invalidated_phases) ? { invalidated_phases: e.invalidated_phases } : {}),
          ...(typeof e.to_phase === 'string' ? { to_phase: e.to_phase } : {}),
          ...(Array.isArray(e.files) ? { files: e.files } : {}),
          ...(Array.isArray(e.defects) ? { defects: e.defects } : {}),
          ...((typeof e.fingerprint === 'string' || e.fingerprint === null)
            ? { fingerprint: e.fingerprint } : {}),
          ...(typeof e.failure_kind_classified === 'string'
            ? { failure_kind_classified: e.failure_kind_classified } : {}),
          ...(typeof e.probe === 'string' ? { probe: e.probe } : {}),
          ...(typeof e.run_disposition === 'string' ? { run_disposition: e.run_disposition } : {}),
          ...(typeof e.run_wait_kind === 'string' ? { run_wait_kind: e.run_wait_kind } : {}),
          ...(typeof e.action === 'string' ? { action: e.action } : {}),
          ...(e.successor_required === true ? { successor_required: true } : {}),
          ...(typeof e.successor_start_phase === 'string'
            ? { successor_start_phase: e.successor_start_phase } : {}),
        });
      } catch { out.push({ type: '?' }); }
    }
  }
  return out;
}

function latestRunId(root: string, feature: string): string | null {
  const runsDir = path.join(root, 'doc/features', feature, 'goal-runs');
  if (!fs.existsSync(runsDir)) return null;
  const runs = fs.readdirSync(runsDir).filter(n => !n.startsWith('.')).sort();
  return runs.length > 0 ? runs[runs.length - 1] : null;
}

/**
 * 场景清单（e5d8a2c4 步骤 1 起）：
 * - `device_park`：设备停放——hmos-app 宿主 + 注入设备门 BLOCKED（`WAITING(external)`
 *   + `halted:false`，与 fa0663 同形）→ run PARTIAL 停放。`--start ut`；
 * - `resume_after_park`：`--resume <extra=runId>`——恢复场景的行为面。
 *   垂直闭环（步骤 3）已落地：无 HMAC resume **零拦截**（认证状态仅记录），最早未完成
 *   的 WAITING(external) phase 重新入队，ut `phase_start` 重现（`phaseStartsThisCall`）；
 * - `resume_with_device_ready`：同上但设备门注入 READY——验证"设备恢复后同一 run
 *   无钥匙真正完成"（后半闭环）。
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
  /** 场景附加参数：resume_after_park 传要续跑的 runId */
  extra?: string;
}): Promise<GoalRunOutcome> {
  const { scenario, feature, frameworkRoot, projectRoot: root, extra } = args;
  const isSupervisorScenario = scenario === 'supervisor_probe_wake'
    || scenario === 'supervisor_successor_wake';
  const isSupervisorSuccessorScenario = scenario === 'supervisor_successor_wake';
  const { goal, config } = loadFrameworkModules(frameworkRoot);
  const scope = require(path.join(frameworkRoot, 'harness/scripts/utils/scope-replan')) as {
    __testing_setAfterInvalidationRequested?: (fn: (() => void) | null) => void;
  };
  process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'trust-cp');

  (goal.__testing_setRepoLayout as (l: unknown) => void)(deriveRepoLayout(root, frameworkRoot));
  let agentCalls = 0;
  let crashMutationInjected = false;
  let utSourceMutationInjected = false;
  let utSourceMutationBlockerEmitted = false;
  (goal.__testing_setInvokeAgent as (f: unknown) => void)(async (
    _plan: unknown, _agentRoot: unknown, invokeOpts: { outputLogPath?: string } = {},
  ) => {
    agentCalls += 1;
    const phase = /[\\/]phases[\\/]([a-z-]+)[\\/]/.exec(invokeOpts.outputLogPath ?? '')?.[1] ?? '';
    if ((scenario === 'crash_scope_in_run' || scenario === 'successor_source_crash')
      && phase === 'coding' && !crashMutationInjected) {
      crashMutationInjected = true;
      w(root, `doc/features/${feature}/contracts.yaml`, `feature: ${feature}\nfiles:\n  - 02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets\n  - 01-Product/WalletMain/src/main/ets/pages/HomeTabPage.ets\n`);
    }
    if (scenario === 'ut_source_mutation' && phase === 'ut' && !utSourceMutationInjected) {
      utSourceMutationInjected = true;
      w(root, '02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets',
        'struct AllBanksPage { build() { Text("mutated-during-ut") } }');
    }
    return { exitCode: 0, timedOut: false, stdout: '', stderr: '', command: 'noop' };
  });
  (goal.__testing_setRunHarnessPhase as (f: unknown) => void)(async () => ({ verdict: 'PASS', blockers: [] }));

  const isDeviceScenario = scenario === 'device_park' || scenario === 'resume_after_park'
    || scenario === 'resume_with_device_ready' || scenario === 'cache_miss_seed'
    || scenario === 'cache_miss_resume' || scenario === 'cache_miss_in_run'
    || scenario === 'crash_scope_in_run' || scenario === 'successor_source_crash'
    || scenario === 'successor_manifest_probe'
    || scenario === 'ut_source_mutation' || scenario === 'ut_build_failure'
    || scenario === 'crash_scope_seed' || scenario === 'crash_after_scope_event'
    || scenario === 'resume_after_crash_scope';
  const isSeedRunScenario = scenario === 'cache_miss_seed' || scenario === 'crash_scope_seed';
  // 写盘桩对全部场景统一；generic 宿主不会消费设备 capability，多注入不改变行为。
  {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const req = (rel: string): Record<string, unknown> =>
      require(path.join(frameworkRoot, rel)) as Record<string, unknown>;
    // ---- 写盘 harness 桩（与 goal-runner-testing-integrity 同源形态）----
    // 桩必须把 receipt/verifier/summary(1.2)/evidence-manifest 写到盘：runner 的
    // 截断链 preflight 与 closure finalizer 消费的是**文件**，内存 PASS 走不通全链。
    // 全部 writer 从 frameworkRoot 动态取（静态 import = 恒锚开发仓，第八批 P1 教训）。
    const closure = req('harness/scripts/utils/closure-attestation');
    const pem = req('harness/scripts/utils/phase-evidence-manifest');
    const fidelity = req('harness/scripts/utils/fidelity-shared');
    (goal.__testing_setRunHarnessPhase as (f: unknown) => void)(async (
      pr: string, _fr: string, ph: string, feat: string, _dry: boolean,
      gm?: { run_id?: string },
    ) => {
      const phaseDir = path.join(pr, 'doc', 'features', feat, String(ph));
      const dir = path.join(phaseDir, 'reports');
      fs.mkdirSync(dir, { recursive: true });
    const failureBlockers =
        scenario === 'ut_source_mutation' && String(ph) === 'ut'
          && utSourceMutationInjected && !utSourceMutationBlockerEmitted
          ? [{
              id: 'goal_post_review_source_mutation_unresolved',
              classification: 'goal_post_review_source_mutation_unresolved',
              affected_files: ['02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets'],
              details_excerpt: 'UT agent 在 review closure 后改写产品源码。',
            }]
          : scenario === 'ut_build_failure' && String(ph) === 'ut'
            ? [
                {
                  id: 'ut_hvigor_build',
                  classification: 'project_build',
                  details_excerpt: '注入：UT hvigor 编译失败。',
                },
                {
                  id: 'ut_hvigor_test',
                  classification: 'project_build',
                  details_excerpt: 'ut_hvigor_build 已 FAIL，test 阶段自动短路。',
                },
              ]
            : null;
      if (failureBlockers) {
        // 失败轮不写 receipt/closure；只留下与正式 summary 同形的 blocker，
        // 让 runner 真实走 source-drift / build-attribution 分支。
        if (scenario === 'ut_source_mutation') utSourceMutationBlockerEmitted = true;
        fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
          schema_version: '1.2', assurance: 'full',
          capability_resolutions: [], capability_resolution_contract_fingerprint: null,
          verdict: 'FAIL', blocker_count: failureBlockers.length,
          receipt_status: 'missing', closure_status: 'open', next_action: 'fix_blockers',
          report_validity: 'PASS', release_readiness: 'BLOCKED', completion_status: 'complete',
          blockers: failureBlockers, checks: [],
        }, null, 2), 'utf-8');
        return { exitCode: 1, timedOut: false };
      }
      fs.writeFileSync(path.join(phaseDir, 'phase-completion-receipt.md'), [
        `# ${String(ph)} 阶段完成回执`, '',
        `- 模块: ${feat}`, `- 阶段: ${String(ph)}`, '- 结论: PASS',
        '- 脚本 harness: 退出码 0，零 BLOCKER', '- verifier: PASS', '',
      ].join('\n'), 'utf-8');
      fs.writeFileSync(path.join(dir, 'verifier.report.md'), '# verifier\nverdict: PASS\n', 'utf-8');
      if (String(ph) === 'review') {
        (closure.writeReviewClosureAttestation as (a: unknown) => void)({
          projectRoot: pr, feature: feat, expectProductSources: true,
          gateFingerprint: 'goal-run-driver', runIdentity: null,
        });
      }
      const axis = (verdict: string): Record<string, unknown> => ({
        applicable: true, required_for_release: true, verdict,
        blocking_class: null, source_checks: [], resolution: null,
      });
      fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
        schema_version: '1.2', assurance: 'full',
        capability_resolutions: [], capability_resolution_contract_fingerprint: null,
        verdict: 'PASS', blocker_count: 0, receipt_status: 'missing', closure_status: 'open',
        next_action: 'run_receipt',
        report_validity: 'PASS', release_readiness: 'READY',
        completion_status: 'complete',
        quality_axes: {
          functional: axis('PASS'), visual: axis('PASS'),
          asset: axis('PASS'), evidence: axis('PASS'),
        },
        blockers: [], checks: [],
      }, null, 2), 'utf-8');
      try {
        const manifest = (pem.resolvePhaseEvidenceManifest as (a: unknown) => unknown)({
          projectRoot: pr, feature: feat, phase: String(ph),
          extraInputs: [], extraOutputs: [],
          requirementSha: gm?.run_id
            ? (fidelity.computeRunRequirementSha as (...a: unknown[]) => unknown)(pr, feat, gm.run_id, 'doc/features')
            : null,
        });
        const written = (pem.writePhaseEvidenceManifest as (r: string, m: unknown) => { absPath: string; sha256: string })(pr, manifest);
        const rel = path.relative(pr, written.absPath).split(path.sep).join('/');
        (pem.writeReceiptManifestPointer as (...a: unknown[]) => void)(pr, feat, String(ph), rel, written.sha256);
      } catch { /* manifest 失败 → 后续门如实红（非本场景被测对象） */ }
      return { exitCode: 0, timedOut: false };
    });
    // capability gate 桩（无缺口放行）——它排在设备门之前，而设备 capability 的
    // provider 恰是临时宿主必缺的设备工具链；不桩它就永远走不到设备门（缝头注详述）
    (goal.__testing_setInvokeCapabilityGate as (f: unknown) => void)(() => null);
    // 闭环探针桩——tryValidateReceipt 会 spawn 真 check-receipt 子进程，tmp host
    // 必然 error（closure_probe_error，实证）；缝头注自述它就是为此存在
    (goal.__testing_setValidateReceipt as (f: unknown) => void)(
      (_hr: string, _pr: string, ph: string, feat: string) => ({
        status: 'passed', receipt_path: `doc/features/${feat}/${ph}/phase-completion-receipt.md`, exit_code: 0,
      }),
    );
    if (scenario === 'cache_miss_in_run') {
      let corrupted = false;
      (goal.__testing_setAfterPassSnapshot as (f: (() => void) | null) => void)(() => {
        if (corrupted) return;
        corrupted = true;
        const passSnapshot = req('harness/scripts/utils/pass-snapshot');
        const headPath = (passSnapshot.passSnapshotHeadPath as (p: string, f: string, r: string, h: string) => string)(
          root, feature, (latestRunId(root, feature) ?? ''), 'plan',
        );
        fs.writeFileSync(headPath, '{"corrupt":true}\n', 'utf-8');
      });
    }
    // 设备门桩：两种形态——
    // · BLOCKED（halted:false + externalBlocked，fa0663 同形）：park / 仍锁 resume；
    // · READY（`resume_with_device_ready`，codex 第九批 P0）：验证"设备恢复后同一 run
    //   无钥匙**真正完成**"的后半闭环——此前 smoke 只证明了"仍锁时能再次停放"。
    //   target 自称 physical：模拟真机就绪（设备真实性封顶因此不触发，完成态可满）。
    const deviceReady = scenario === 'resume_with_device_ready'
      || scenario === 'cache_miss_resume' || scenario === 'cache_miss_in_run'
      || scenario === 'crash_scope_in_run' || scenario === 'successor_source_crash'
      || scenario === 'successor_manifest_probe' || scenario === 'crash_after_scope_event'
      || scenario === 'resume_after_crash_scope'
      || scenario === 'ut_source_mutation' || scenario === 'ut_build_failure';
    (goal.__testing_setDeviceReadinessGate as (f: unknown) => void)(
      async (opts: { phase: string; retries: number; emitEvent: (e: unknown) => void }) => {
        if (deviceReady) {
          return {
            env: {}, target: { serial: 'stub-device', targetKind: 'physical' },
            notes: ['injected-device-ready'],
          };
        }
        opts.emitEvent({
          type: 'phase_halt', phase: opts.phase, halt_reason: 'device_not_ready', probe: 'device_readiness',
          verdict: 'FAIL', reason: '注入：设备锁屏（smoke 恢复场景）', notes: ['injected-device-gate'],
        });
        return {
          outcome: {
            phase: opts.phase, verdict: 'FAIL', halted: false, retries: opts.retries,
            halt_reason: 'device_not_ready', halt_guidance: '注入：设备锁屏（smoke 恢复场景）',
            blocking_class: 'externalBlocked', failure_kind: 'device_blocked',
          },
          notes: ['injected-device-gate'],
        };
      },
    );
  }

  if (scenario === 'cache_miss_resume') {
    if (!extra) throw new Error('cache_miss_resume 需要 extra=runId');
    const passSnapshot = require(path.join(frameworkRoot, 'harness/scripts/utils/pass-snapshot')) as {
      passSnapshotHeadPath: (projectRoot: string, feature: string, runId: string, phase: string) => string;
    };
    const headPath = passSnapshot.passSnapshotHeadPath(root, feature, extra, 'plan');
    if (!fs.existsSync(headPath)) throw new Error(`cache_miss_resume 缺 plan head：${headPath}`);
    fs.writeFileSync(headPath, '{"corrupt":true}\n', 'utf-8');
  }

  if (scenario === 'crash_after_scope_event') {
    if (!extra) throw new Error('crash_after_scope_event 需要 extra=runId');
    w(root, `doc/features/${feature}/contracts.yaml`, `feature: ${feature}\nfiles:\n  - 02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets\n  - 01-Product/WalletMain/src/main/ets/pages/HomeTabPage.ets\n`);
    scope.__testing_setAfterInvalidationRequested?.(() => {
      throw new Error('injected crash after phase_backtrack_requested');
    });
  }

  if (scenario === 'crash_scope_in_run' || scenario === 'successor_source_crash') {
    scope.__testing_setAfterInvalidationRequested?.(() => {
      throw new Error('injected crash after phase_backtrack_requested');
    });
  }

  if (scenario === 'resume_after_crash_scope') {
    if (!extra) throw new Error('resume_after_crash_scope 需要 extra=runId');
    // 修复 live 漂移；恢复只消费已落盘的失效 record，不再重复制造新交接。
    w(root, `doc/features/${feature}/contracts.yaml`, `feature: ${feature}\nfiles:\n  - 02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets\n`);
  }

  if (scenario === 'successor_manifest_probe') {
    if (!extra) throw new Error('successor_manifest_probe 需要 extra=source runId');
    // 源 crash 场景故意在 coding agent 窗口制造 live contracts 漂移；
    // successor 的责任阶段就是 coding，先按既有 resume 夹具恢复上游 SSOT，
    // 让真实启动继续走到后继 manifest 与 coding，而不是把夹具缺口误报成产品门禁缺陷。
    w(root, `doc/features/${feature}/contracts.yaml`, `feature: ${feature}\nfiles:\n  - 02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets\n`);
  }

  let supervisorMain: (() => Promise<number>) | null = null;
  let supervisorReset: (() => void) | null = null;
  let supervisorSpawnRecord: string | null = null;
  if (isSupervisorScenario) {
    if (!extra) throw new Error('supervisor_probe_wake 闇€瑕 extra=parked runId');
    const supervisor = require(path.join(frameworkRoot, 'harness/scripts/goal-supervise')) as {
      __testing_main: () => Promise<number>;
      __testing_setRunnerScript: (scriptPath: string | null) => void;
      __testing_setConditionProbe: (
        probe: ((probe: string) => { ready: boolean; reason?: string }) | null,
      ) => void;
      __testing_appendSupervisorEvent?: (eventsPath: string, event: Record<string, unknown>) => void;
    };
    const stub = path.join(root, '.goal-supervisor-runner.js');
    supervisorSpawnRecord = path.join(root, '.goal-supervisor-spawn.json');
    fs.rmSync(supervisorSpawnRecord, { force: true });
    w(root, '.goal-supervisor-runner.js', [
      "const fs = require('fs');",
      `fs.writeFileSync(${JSON.stringify(supervisorSpawnRecord)}, JSON.stringify(process.argv.slice(2)));`,
    ].join('\n'));
    const beacon = require(path.join(frameworkRoot, 'harness/scripts/utils/liveness-beacon')) as {
      livenessBeaconPath: (projectRoot: string, reportDir: string) => string;
    };
    fs.rmSync(beacon.livenessBeaconPath(root, `doc/features/${feature}/goal-runs/${extra}`), { force: true });
    if (isSupervisorSuccessorScenario) {
      if (!supervisor.__testing_appendSupervisorEvent) {
        throw new Error('发布件 supervisor 缺少真实事件 writer seam');
      }
      supervisor.__testing_appendSupervisorEvent(
        path.join(root, 'doc', 'features', feature, 'goal-runs', extra!, 'events.jsonl'),
        {
          type: 'phase_halt',
          phase: 'coding',
          halt_reason: 'goal_review_closure_baseline_unavailable',
          run_disposition: 'RECOVERY_PENDING',
          successor_required: true,
        },
      );
      // supervisor writer 是真实 JSONL writer，但本夹具是在 crash 后才进入 supervisor
      // 进程，直接 append 会把 successor halt 写到 run_end 之后。生产 run_end 是封口，
      // reducer 必须忽略其后的旁路事件；把这条真实 writer 产出的记录移到封口前，
      // 复现生产事件序列，而不是放宽 reducer 去消费封口后的 stale 元数据。
      const eventsPath = path.join(root, 'doc', 'features', feature, 'goal-runs', extra!, 'events.jsonl');
      const lines = fs.readFileSync(eventsPath, 'utf-8').split(/\r?\n/).filter(Boolean);
      const successorLine = lines.pop();
      if (!successorLine) throw new Error('successor halt writer 未落盘');
      let runEndIndex = lines.length;
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        try {
          if ((JSON.parse(lines[i]) as { type?: string }).type === 'run_end') {
            runEndIndex = i;
            break;
          }
        } catch { /* malformed historical line remains in place */ }
      }
      lines.splice(runEndIndex, 0, successorLine);
      fs.writeFileSync(eventsPath, `${lines.join('\n')}\n`, 'utf-8');
    } else {
      supervisor.__testing_setConditionProbe(() => ({ ready: true, reason: 'injected device probe green' }));
    }
    supervisor.__testing_setRunnerScript(stub);
    supervisorMain = supervisor.__testing_main;
    supervisorReset = () => {
      supervisor.__testing_setRunnerScript(null);
      supervisor.__testing_setConditionProbe(null);
    };
  }

  const preCount = readEvents(root, feature).length;
  const argvBase = ['node', 'goal-runner.ts', '--feature', feature, '--adapter', 'cursor', '--foreground-ok'];
  if (isSupervisorScenario) {
    process.argv = [
      'node', 'goal-supervise.ts', '--feature', feature, '--run-id', extra!,
      '--project-root', root,
    ];
  } else if (scenario === 'resume_after_park' || scenario === 'resume_with_device_ready'
    || scenario === 'cache_miss_resume' || scenario === 'crash_after_scope_event'
    || scenario === 'resume_after_crash_scope') {
    if (!extra) throw new Error(`${scenario} 需要 extra=runId`);
    process.argv = [...argvBase, '--resume', extra];
  } else if (scenario === 'device_park') {
    // 全链启动：spec→review 由写盘桩 PASS 走过（截断链 preflight 消费的是文件，
    // `--start ut` 空宿主必被"上游 missing/stale"拒启——实证过），ut 撞设备门停放。
    process.argv = [
      ...argvBase,
      '--requirement', `T4 driver scenario=${scenario}`,
      '--start', 'spec', '--end', 'testing', '--force',
    ];
  } else if (scenario === 'successor_manifest_probe') {
    if (!extra) throw new Error('successor_manifest_probe 需要 extra=source runId');
    process.argv = [
      ...argvBase,
      '--requirement', `T4 driver scenario=${scenario}`,
      '--start', 'coding', '--end', 'testing', '--force', '--supersede', extra,
    ];
  } else if (scenario === 'cache_miss_in_run' || scenario === 'crash_scope_in_run'
    || scenario === 'successor_source_crash'
    || scenario === 'ut_source_mutation' || scenario === 'ut_build_failure' || isSeedRunScenario) {
    process.argv = [
      ...argvBase,
      '--requirement', `T4 driver scenario=${scenario}`,
      '--start', 'spec', '--end', 'testing', '--force',
    ];
  } else {
    process.argv = [
      ...argvBase,
      '--requirement', `T4 driver scenario=${scenario}`,
      '--start', 'spec', '--end', 'spec', '--force',
    ];
  }
  process.chdir(root);
  config.clearFrameworkConfigCache();

  let exitCode: number | null = null;
  let error: string | null = null;
  try {
    exitCode = isSupervisorScenario
      ? await supervisorMain!()
      : await (goal.main as () => Promise<number>)();
  } catch (e) {
    error = (e as Error).message;
  }
  if (isSupervisorScenario && supervisorSpawnRecord) {
    const deadline = Date.now() + 2_000;
    while (!fs.existsSync(supervisorSpawnRecord) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  const all = readEvents(root, feature);
  const lastRunEnd = [...all].reverse().find(e => e.type === 'run_end');
  const finalRunId = latestRunId(root, feature);
  let finalManifest: Record<string, unknown> | null = null;
  if (finalRunId) {
    try {
      finalManifest = JSON.parse(fs.readFileSync(
        path.join(root, 'doc/features', feature, 'goal-runs', finalRunId, 'manifest.json'),
        'utf-8',
      )) as Record<string, unknown>;
    } catch { /* no manifest: preserve the driver outcome for the caller */ }
  }
  const out: GoalRunOutcome = {
    exitCode,
    error,
    eventTypes: all.map(e => e.type),
    agentCalls,
    runId: finalRunId,
    phaseStartsThisCall: all.slice(preCount)
      .filter(e => e.type === 'phase_start' && typeof e.phase === 'string')
      .map(e => e.phase as string),
    runEndReason: lastRunEnd?.reason ?? null,
    runEndError: lastRunEnd?.error ?? null,
    failureKinds: all
      .filter(e => e.type === 'phase_verdict' && typeof e.failure_kind_classified === 'string')
      .map(e => e.failure_kind_classified as string),
    phaseHalts: all
      .filter(e => e.type === 'phase_halt' || (e.type === 'phase_verdict' && e.action === 'halt'))
      .map(e => ({
        ...(typeof e.phase === 'string' ? { phase: e.phase } : {}),
        ...(typeof (e as { halt_reason?: unknown }).halt_reason === 'string'
          ? { halt_reason: (e as { halt_reason: string }).halt_reason } : {}),
        ...(typeof (e as { detail?: unknown }).detail === 'string'
          ? { detail: (e as { detail: string }).detail } : {}),
        ...(typeof (e as { failure_kind_classified?: unknown }).failure_kind_classified === 'string'
          ? { failure_kind_classified: (e as { failure_kind_classified: string }).failure_kind_classified } : {}),
      })),
    invalidationRecords: all
      .filter(e => e.type === 'phase_backtrack_requested')
      .map(e => ({
        ...(typeof (e as { reason?: unknown }).reason === 'string'
          ? { reason: (e as { reason: string }).reason } : {}),
        ...(Array.isArray(e.invalidated_phases) ? { invalidated_phases: e.invalidated_phases } : {}),
        ...(typeof e.to_phase === 'string' ? { to_phase: e.to_phase } : {}),
        ...(Array.isArray(e.files) ? { files: e.files } : {}),
        ...(Array.isArray(e.defects) ? { defects: e.defects } : {}),
        ...((typeof e.fingerprint === 'string' || e.fingerprint === null)
          ? { fingerprint: e.fingerprint } : {}),
      })),
    manifest: finalManifest,
    ...(isSupervisorScenario
      ? {
          supervisorAction: [...all].reverse().find(e => e.type === 'supervisor_restart')?.action ?? null,
          ...(supervisorSpawnRecord && fs.existsSync(supervisorSpawnRecord)
            ? { supervisorRunnerArgs: JSON.parse(fs.readFileSync(supervisorSpawnRecord, 'utf-8')) as string[] }
            : {}),
        }
      : {}),
  };
  supervisorReset?.();
  (goal.__testing_resetGoalRunnerSeams as () => void)();
  scope.__testing_setAfterInvalidationRequested?.(null);
  // 宿主目录**不在此删**——谁建谁删，见 runScenario 的 projectRoot 注释
  return out;
}

if (require.main === module) {
  const [, , scenario, feature, frameworkRootArg, projectRootArg, extraArg] = process.argv;
  if (!scenario || !feature || !projectRootArg) {
    process.stderr.write(
      'usage: goal-run-driver.ts <scenario> <feature> <frameworkRoot|-> <projectRoot> [extra]\n'
      + '  projectRoot **必填**：driver 不自建宿主，一条整机链只能有一个宿主。\n'
      + '  extra：resume_after_park 传要续跑的 runId。\n',
    );
    process.exit(2);
  }
  // provision：只对既有宿主铺 hmos goal 夹具，不跑 run（smoke 对 cloneRoot 用）
  if (scenario === 'provision') {
    provisionHmosGoalFixture(path.resolve(projectRootArg), feature);
    process.stdout.write(`\n${RESULT_MARK}${JSON.stringify({ provisioned: true })}\n`);
    process.exit(0);
  }
  runScenario({
    scenario,
    feature,
    // `-` = 用开发仓（单测形态）；smoke 传 clone 出来的发布件根
    frameworkRoot: frameworkRootArg && frameworkRootArg !== '-'
      ? path.resolve(frameworkRootArg)
      : DEV_FRAMEWORK_ROOT,
    projectRoot: path.resolve(projectRootArg),
    ...(extraArg ? { extra: extraArg } : {}),
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
