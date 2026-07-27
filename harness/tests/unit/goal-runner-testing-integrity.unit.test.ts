// ============================================================================
// goal-runner-testing-integrity.unit.test.ts — v23 最小闭环 8 项验收
// ----------------------------------------------------------------------------
// 唯一被测目标：**testing 不改码 → 产出可信缺陷 → runner 回 coding → 修好重测 →
// run 正常完成**。用 __testing_set* 注入缝在进程内跑真实 phase 循环：
// 注入 agent（可编程每轮行为）+ spy gate harness（记录调用并写 PASS 产物）。
//
// 验收清单（plan d8c5f3a7 v23）：
//   E2E-1 pre-existing dirty 合法（不误伤新 goal 的未提交需求/源码）
//   E2E-2 testing 改产品源码或 SSOT → gate 不运行、halt、精确报文件
//   E2E-3 PASS + 新鲜 must_fix → 回 coding，**第二次 coding prompt 含原始 must_fix**，
//         修复后 run 正常完成（outcomes 对齐）
//   E2E-4 本 run 新增 crash 归档 → 回 coding + prompt 含 crash 指令与诊断路径；
//         旧 run 残留 → 不回退
//   E2E-5 素材确定性事实 → coding 门禁档位无关 FAIL（直接函数断言）
//   R-6a  identity 不匹配的 stale must_fix 不回退
//   R-6b  上一 run 但 build+截图一致 → 仍回退（保护 visual-diff 跨轮持久化设计）
//   R-7   testing_write_violation 后同 run --resume 被拒
//   R-8   进程重启后同 roundFingerprint 仍熔断（从事件 round_fingerprint 恢复）
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  __testing_resetGoalRunnerSeams,
  __testing_setInvokeAgent,
  __testing_setRepoLayout,
  __testing_setRunHarnessPhase,
  __testing_setValidateReceipt,
  main as goalMain,
} from '../../scripts/goal-runner';
import { inferRepoLayout } from '../../repo-layout';
import { clearFrameworkConfigCache } from '../../config';
import { writeReviewClosureAttestation } from '../../scripts/utils/closure-attestation';
import {
  resolvePhaseEvidenceManifest,
  writePhaseEvidenceManifest,
} from '../../scripts/utils/phase-evidence-manifest';
import { writeReceiptManifestPointer } from '../../scripts/utils/phase-evidence-manifest';
import { hashScreenshotFile } from '../../../profiles/hmos-app/harness/visual-diff-check';
import { readCodingBase, readPassSnapshotHead } from '../../scripts/utils/pass-snapshot';
import { computeRunRequirementSha } from '../../scripts/utils/fidelity-shared';
import type { UnitCaseResult } from '../run-unit';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PRODUCT_FILE = '02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets';
const FEATURE = 'bc-openCard';

function layoutFieldsForTmpHost(root: string): ReturnType<typeof inferRepoLayout> {
  return { kind: 'standalone', projectRoot: root, frameworkRoot: REPO_ROOT, frameworkRel: '' } as ReturnType<typeof inferRepoLayout>;
}

const cases: Array<{ name: string; run: () => Promise<void> }> = [];
function test(name: string, run: () => Promise<void>): void {
  cases.push({ name, run });
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function git(root: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
}
function writeFile(root: string, rel: string, content: string): void {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

/** 最小可跑宿主（git 仅为 layout 惯例保留；v23 快照已不依赖 git） */
function setupHost(): { root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-v23-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  writeFile(root, 'framework.config.json', JSON.stringify({
    schema_version: '1.1',
    project_name: 'IntTest',
    project_profile: { name: 'hmos-app', sub_variant: 'app' },
    architecture: {
      outer_layers: [{ id: '02-Feature', can_depend_on: [], intra_layer_deps: 'dag' }],
      module_inner_layers: ['shared'],
      inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ets',
    },
    paths: { features_dir: 'doc/features', docs_committed: false, reports_dir_pattern: 'doc/features/<feature>/<phase>/reports' },
    materialized_adapters: ['cursor'],
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
    agent_adapter: 'cursor',
    toolchain: { devEcoStudio: { installPath: deveco.split(path.sep).join('/') } },
    vision: {
      canary: {
        adapter: 'cursor', verdict: 'tool_read', probed_at: new Date().toISOString(),
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
  writeFile(root, `doc/features/${FEATURE}/plan/plan.md`, '# plan\n');
  writeFile(root, `doc/features/${FEATURE}/contracts.yaml`,
    `feature: ${FEATURE}\nfiles:\n  - ${PRODUCT_FILE}\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'init']);
  return { root };
}

/** 当前 build fingerprint（生产口径：hap 内容 sha256 前 12）——夹具与收集器同源 */
function currentBuildFpOf(root: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resolveCurrentBuildFingerprint } = require('../../../profiles/hmos-app/harness/build-fingerprint') as {
    resolveCurrentBuildFingerprint: (r: string, f: string, ph?: string) => string | null;
  };
  const fp = resolveCurrentBuildFingerprint(root, FEATURE, 'testing');
  assert(!!fp, '夹具须能算出 build fingerprint（install meta + hap 已造）');
  return fp!;
}

/** 屏条目：verdict/must_fix + 截图/build 双身份（新鲜=③④ 成立）；可按维度打破 */
function writeVisualDiff(
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
    };
  });
  writeFile(
    root,
    `doc/features/${FEATURE}/device-testing/device-screenshots/visual-diff.json`,
    JSON.stringify({ schema_version: '1.0', screens: rows }, null, 2),
  );
}

interface AgentCtx {
  root: string;
  phase: string;
  /** 该 phase 第几次被 invoke（1 起） */
  attempt: number;
  prompt: string;
  runId: string;
}

interface RunProbe {
  invokedPhases: string[];
  harnessPhases: string[];
  codingPrompts: string[];
  exitCode: number;
  root: string;
  reportDir: string;
  events: Array<Record<string, unknown>>;
}

/**
 * 跑一次 goal run（spec→testing 全链）。testing 轮行为由 onTesting 编程：
 * 按 attempt 决定写什么产物（模拟"发现缺陷→回退→修复后干净"的两轮形态）。
 */
async function runChain(
  root: string,
  opts: {
    onTesting?: (ctx: AgentCtx) => void;
    onCoding?: (ctx: AgentCtx) => void;
    resume?: string;
    forceResume?: boolean;
  } = {},
): Promise<RunProbe> {
  const invokedPhases: string[] = [];
  const harnessPhases: string[] = [];
  const codingPrompts: string[] = [];
  const attempts = new Map<string, number>();
  const prevArgv = process.argv;
  const prevCwd = process.cwd();
  // c4e8b1d3：plan PASS advance 会建 pass snapshot——trust 目录隔离到宿主内，绝不写用户主目录
  const prevTrustDir = process.env.MAISON_GOAL_CHECKPOINT_DIR;
  process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'trust-cp');
  try {
    __testing_setInvokeAgent((async (plan: unknown, _root: unknown, o: unknown) => {
      const logPath = String((o as { outputLogPath?: string })?.outputLogPath ?? '')
        .split(path.sep).join('/');
      const phase = /\/phases\/([a-z-]+)\//.exec(logPath)?.[1] ?? '';
      invokedPhases.push(phase);
      const n = (attempts.get(phase) ?? 0) + 1;
      attempts.set(phase, n);
      // prompt 在 HeadlessInvokePlan 的 argv/stdin 里（没有 .prompt 字段）
      const pl = plan as { argv?: string[]; stdin?: string };
      const prompt = [...(pl.argv ?? []), pl.stdin ?? ''].join('\n');
      if (phase === 'coding') codingPrompts.push(prompt);
      const extraEnv = (o as { extraEnv?: Record<string, string> })?.extraEnv ?? {};
      const ctx: AgentCtx = {
        root, phase, attempt: n, prompt,
        runId: extraEnv.MAISON_GOAL_RUN_ID ?? '',
      };
      if (phase === 'testing') opts.onTesting?.(ctx);
      if (phase === 'coding') opts.onCoding?.(ctx);
      return { exitCode: 0, stdout: 'done', stderr: '', command: 'fake-agent' };
    }) as never);
    __testing_setRepoLayout(layoutFieldsForTmpHost(root));
    __testing_setValidateReceipt(((_hr: string, _pr: string, ph: string, feat: string) => ({
      status: 'passed' as const,
      receipt_path: `doc/features/${feat}/${ph}/phase-completion-receipt.md`,
      exit_code: 0,
    })) as never);
    __testing_setRunHarnessPhase(async (pr, _fr, ph, feat, _dry, gm) => {
      harnessPhases.push(String(ph));
      const phaseDir = path.join(pr, 'doc', 'features', feat, String(ph));
      const dir = path.join(phaseDir, 'reports');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(phaseDir, 'phase-completion-receipt.md'), [
        `# ${String(ph)} 阶段完成回执`, '',
        `- 模块: ${feat}`, `- 阶段: ${String(ph)}`, '- 结论: PASS',
        '- 脚本 harness: 退出码 0，零 BLOCKER', '- verifier: PASS', '',
      ].join('\n'), 'utf-8');
      fs.writeFileSync(path.join(dir, 'verifier.report.md'), '# verifier\nverdict: PASS\n', 'utf-8');
      if (String(ph) === 'review') {
        writeReviewClosureAttestation({
          projectRoot: pr, feature: feat, expectProductSources: true,
          gateFingerprint: 'integration-spy', runIdentity: null,
        });
      }
      // v1.1 完整契约 summary（clean-pass 巡检 validateSummaryV11 全字段校验；
      // 手搓半 summary 会被判 needs_fix → PARTIAL，链到不了 clean completion）
      const axis = (verdict: string): Record<string, unknown> => ({
        applicable: true, required_for_release: true, verdict,
        blocking_class: null, source_checks: [], resolution: null,
      });
      // receipt_status/closure_status/next_action 预置为 runner patch 后的终值——
      // applyClosurePatchFromReceiptValidation 会在 manifest 落盘后回写这三键，
      // 值相同则字节不变（幂等），manifest 哈希才不 stale（生产链同一时序）。
      fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
        schema_version: '1.1',
        verdict: 'PASS', receipt_status: 'passed', closure_status: 'closed',
        next_action: 'phase_closed_wait_user',
        report_validity: 'PASS', release_readiness: 'READY',
        completion_status: 'complete',
        quality_axes: {
          functional: axis('PASS'), visual: axis('PASS'),
          asset: axis('PASS'), evidence: axis('PASS'),
        },
        blockers: [], checks: [],
      }, null, 2), 'utf-8');
      // phase-evidence-manifest + 回执指针（生产 writer 同源；lineage_fresh 巡检消费）。
      // frameworkRoot 不传——verify 侧重算 environment 时也是 guess 口径，两侧必须同源，
      // 否则 gate_fingerprint/framework_version 恒 stale；requirementSha 绑定当前 run
      //（记录 null 会被判 requirement_unbound，fail-closed 正确但非本套被测对象）。
      try {
        const manifest = resolvePhaseEvidenceManifest({
          projectRoot: pr, feature: feat, phase: String(ph),
          extraInputs: [], extraOutputs: [],
          requirementSha: gm?.run_id
            ? computeRunRequirementSha(pr, feat, gm.run_id, 'doc/features')
            : null,
        });
        const written = writePhaseEvidenceManifest(pr, manifest);
        const rel = path.relative(pr, written.absPath).split(path.sep).join('/');
        writeReceiptManifestPointer(pr, feat, String(ph), rel, written.sha256);
      } catch { /* manifest 失败 → clean-pass 会如实判 needs_fix（非本套被测对象） */ }
      return { exitCode: 0, timedOut: false };
    });
    process.argv = opts.resume
      ? [
          'node', 'goal-runner.ts', '--resume', opts.resume, '--feature', FEATURE,
          '--foreground-ok', '--force',
          // 无 HMAC 测试宿主的 resume 须弱 ack vision 账本（生产合法路径；终态封顶人工复核）
          ...(opts.forceResume ? ['--force-resume', '--ack-unverified-ledgers'] : []),
        ]
      : [
          'node', 'goal-runner.ts',
          '--feature', FEATURE,
          '--requirement', '真机测试银行卡开卡流程',
          '--start', 'spec', '--end', 'testing',
          '--adapter', 'cursor',
          '--foreground-ok', '--force',
        ];
    process.chdir(root);
    clearFrameworkConfigCache();
    const exitCode = await goalMain();
    const runsDir = path.join(root, 'doc/features', FEATURE, 'goal-runs');
    const runs = fs.existsSync(runsDir)
      ? fs.readdirSync(runsDir).filter(n => !n.startsWith('.'))
      : [];
    const reportDir = runs.length > 0 ? path.join(runsDir, runs.sort().slice(-1)[0]) : '';
    return {
      invokedPhases, harnessPhases, codingPrompts, exitCode, root, reportDir,
      events: readEvents(reportDir),
    };
  } finally {
    __testing_resetGoalRunnerSeams();
    process.argv = prevArgv;
    if (prevTrustDir === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR;
    else process.env.MAISON_GOAL_CHECKPOINT_DIR = prevTrustDir;
    try { process.chdir(prevCwd); } catch { /* ignore */ }
  }
}

function readEvents(reportDir: string): Array<Record<string, unknown>> {
  const p = path.join(reportDir, 'events.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf-8').split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l) as Record<string, unknown>; } catch { return {}; }
  });
}
function hasEvent(events: Array<Record<string, unknown>>, type: string): boolean {
  return events.some(e => e.type === type);
}
function runEndStatus(events: Array<Record<string, unknown>>): string {
  const end = [...events].reverse().find(e => e.type === 'run_end');
  return String((end as { status?: string } | undefined)?.status ?? '');
}
/**
 * "run 正常到达终点"断言（outcomes 对齐语义）。
 * 测试宿主未配 MAISON_HMAC_GOAL_CHECKPOINT——既有 vision 信任封顶会把 UI 相关 run 的
 * clean completion 钳成 PARTIAL（正交防线，fail-closed 正确行为，不是本套被测对象）。
 * 故接受：CHAIN_SLICE_COMPLETED / COMPLETED，或 PARTIAL 且带 vision_trust_completion_cap。
 */
function assertRunReachedEnd(probe: RunProbe, label: string): void {
  const st = runEndStatus(probe.events);
  const capped = hasEvent(probe.events, 'vision_trust_completion_cap');
  assert(
    st === 'CHAIN_SLICE_COMPLETED' || st === 'COMPLETED' || (st === 'PARTIAL' && capped),
    `${label}：run 须到达终点（实得 status=${st}, visionCap=${capped}, exit=${probe.exitCode}）`,
  );
  assert(!probe.events.some(e => e.type === 'phase_halt'), `${label}：不得有 phase_halt`);
}

/** 干净 testing 轮的标准产物：全 pass、无 must_fix（advance 条件） */
function writeCleanTesting(root: string): void {
  writeVisualDiff(root, [{ id: 'all_banks', verdict: 'pass', mustFix: [] }]);
}

const MUST_FIX_TEXT = '添卡首页左侧银行 logo 全部缺失——恢复 media 下 cmb_bank_logo.png 并检查 $r 引用';

// ---------------------------------------------------------------------------

test('E2E-1 pre-existing dirty 合法：invoke 前已有未提交 acceptance/源码改动，testing 不写 → 正常放行', async () => {
  const { root } = setupHost();
  // 模拟"新 goal 的未提交需求 + 用户手上的源码 dirty"（v22 前的 dirty-vs-HEAD 判据会误伤这里）
  writeFile(root, `doc/features/${FEATURE}/acceptance.yaml`, `feature: ${FEATURE}\ncriteria:\n  - id: c1\n    desc: 用户刚写的验收\n`);
  writeFile(root, PRODUCT_FILE, 'struct AllBanksPage { build() { Text("user-dirty") } }');
  const probe = await runChain(root, { onTesting: ({ root: r }) => writeCleanTesting(r) });
  assert(!hasEvent(probe.events, 'testing_write_violation'),
    `pre-existing dirty 不得判越权：${JSON.stringify(probe.events.filter(e => e.type === 'testing_write_violation'))}`);
  assertRunReachedEnd(probe, 'E2E-1');
});

test('⑤ c4e8b1d3：正常 plan PASS（非 advance_blocked）也建快照，且首次 coding 前锚定 coding_base_sha', async () => {
  const { root } = setupHost();
  let codingRunId = '';
  const probe = await runChain(root, {
    onCoding: ctx => { codingRunId = ctx.runId; },
    onTesting: ({ root: r }) => writeCleanTesting(r),
  });
  assertRunReachedEnd(probe, '⑤');
  const types = probe.events.map(e => e.type);
  const snapIdx = probe.events.findIndex(e => e.type === 'pass_snapshot_taken' && e.phase === 'plan');
  assert(snapIdx >= 0, `plan 正常 PASS 须落 pass_snapshot_taken(plan)：${types.join(',')}`);
  const baseEv = probe.events.find(e => e.type === 'coding_base_recorded') as
    { base_sha?: string } | undefined;
  assert(!!baseEv && /^[0-9a-f]{40}$/.test(String(baseEv.base_sha ?? '')),
    `coding_base_recorded 须带 40-hex base_sha：${JSON.stringify(baseEv)}`);
  // 时序：plan 快照先于首次 coding agent invoke（pre-coding 锚定语义）
  const codingInvokeIdx = probe.events.findIndex(
    e => e.type === 'agent_invoke_start' && e.phase === 'coding',
  );
  assert(codingInvokeIdx > snapIdx, `plan 快照须先于 coding agent invoke（snap@${snapIdx}, invoke@${codingInvokeIdx}）`);
  // trust 文件真值（不只信事件）：head active + base_sha 与事件一致
  assert(!!codingRunId, 'coding attempt 须带 MAISON_GOAL_RUN_ID');
  const prevTrust = process.env.MAISON_GOAL_CHECKPOINT_DIR;
  process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'trust-cp');
  try {
    const head = readPassSnapshotHead(root, FEATURE, codingRunId, 'plan');
    assert(head.body?.state === 'active', `plan snapshot head 须 active：mac=${head.mac}`);
    const base = readCodingBase(root, FEATURE, codingRunId);
    assert(base.body?.base_sha === String(baseEv!.base_sha), 'trust 文件 base_sha 须与事件一致');
  } finally {
    if (prevTrust === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR;
    else process.env.MAISON_GOAL_CHECKPOINT_DIR = prevTrust;
  }
});

test('E2E-2a testing 改产品源码 → violation：gate 不运行、halt、精确报文件', async () => {
  const { root } = setupHost();
  const probe = await runChain(root, {
    onTesting: ({ root: r }) => {
      writeCleanTesting(r);
      writeFile(r, PRODUCT_FILE, 'struct AllBanksPage { build() { Text("x").id("hacked") } }');
    },
  });
  const v = probe.events.find(e => e.type === 'testing_write_violation') as
    { changed?: string[] } | undefined;
  assert(!!v, `须落 testing_write_violation：${probe.events.map(e => e.type).join(',')}`);
  assert((v!.changed ?? []).some(c => c.includes('AllBanksPage.ets')),
    `须精确点名被改文件：${JSON.stringify(v!.changed)}`);
  assert(probe.harnessPhases.filter(p => p === 'testing').length === 0,
    `violation 轮 testing 的 gate 必须零调用，实得 [${probe.harnessPhases.join(',')}]`);
  assert(probe.exitCode !== 0 && runEndStatus(probe.events) === 'HALTED', 'run 须 halt（终止态）');
});

test('E2E-2b testing 改需求 SSOT（acceptance.yaml）→ 同样 violation（fs 快照覆盖 doc 域）', async () => {
  const { root } = setupHost();
  const probe = await runChain(root, {
    onTesting: ({ root: r }) => {
      writeCleanTesting(r);
      writeFile(r, `doc/features/${FEATURE}/acceptance.yaml`, `feature: ${FEATURE}\ncriteria:\n  - relaxed\n`);
    },
  });
  const v = probe.events.find(e => e.type === 'testing_write_violation') as
    { changed?: string[] } | undefined;
  assert(!!v && (v.changed ?? []).some(c => c.includes('acceptance.yaml')),
    `SSOT 改写须被点名（docs_committed:false 宿主旧 git 实现全盲）：${JSON.stringify(v?.changed)}`);
  assert(probe.harnessPhases.filter(p => p === 'testing').length === 0, 'gate 不得运行');
});

test('E2E-3 PASS+新鲜 must_fix → 回 coding（prompt 含原始 must_fix）→ 修复后 run 正常完成', async () => {
  const { root } = setupHost();
  const probe = await runChain(root, {
    onTesting: ({ root: r, attempt }) => {
      if (attempt === 1) {
        // 第一轮：gate PASS（best_effort 下视觉缺陷=warn），但 must_fix 非空且新鲜
        writeVisualDiff(r, [{ id: 'add_card_home', verdict: 'warn', mustFix: [MUST_FIX_TEXT] }]);
      } else {
        // 回退修复后的第二轮：干净
        writeCleanTesting(r);
      }
    },
  });
  assert(hasEvent(probe.events, 'phase_backtrack_requested'),
    `PASS+must_fix 须回退（旧实现 PASS 先行 return 的致命错误）：${probe.events.map(e => e.type).join(',')}`);
  // 缺陷交接：第二次 coding prompt 必须含原始 must_fix 文本（闭环最后一段电线）
  assert(probe.codingPrompts.length >= 2, `coding 须被调 2 次，实得 ${probe.codingPrompts.length}`);
  assert(probe.codingPrompts[1].includes(MUST_FIX_TEXT),
    '第二次 coding prompt 必须包含首轮 testing 的原始 must_fix（fake agent 无法靠改文件绕过本断言）');
  assert(probe.codingPrompts[1].includes('Testing defects to fix'),
    'prompt 须含必做段标题');
  // 修复后正常到达终点：outcomes 对齐（被失效阶段旧条目已剔除，否则 length 必超）
  assertRunReachedEnd(probe, 'E2E-3');
});

test('E2E-4 本 run crash 归档 → 回 coding（prompt 含 crash 指令+诊断路径）；旧 run 残留 → 不回退', async () => {
  // 4a：本 run 归档 → 回退且交接
  {
    const { root } = setupHost();
    const probe = await runChain(root, {
      onTesting: ({ root: r, attempt, runId }) => {
        const diagRel = `doc/features/${FEATURE}/device-testing/reports/crash-diagnostics/all_banks.json`;
        if (attempt === 1) {
          writeCleanTesting(r);
          writeFile(r, diagRel, JSON.stringify({
            schema_version: '1.2', screen_or_case: 'all_banks', run_id: runId,
            diagnosis: { kind: 'crash_suspected', bundleName: 'com.x', faultFiles: ['cppcrash-com.x-1'], excerpt: 'SIGSEGV' },
          }));
        } else {
          // 修复轮：模拟 capture 侧清理（真实链路 capture 开始时清本 run 旧归档）
          fs.rmSync(path.join(r, diagRel), { force: true });
          writeCleanTesting(r);
        }
      },
    });
    assert(hasEvent(probe.events, 'phase_backtrack_requested'),
      `crash 须触发回退：${probe.events.map(e => e.type).join(',')}`);
    assert(probe.codingPrompts.length >= 2 && probe.codingPrompts[1].includes('即崩溃'),
      '第二次 coding prompt 须含 crash 修复指令');
    assert(probe.codingPrompts[1].includes('crash-diagnostics/all_banks.json'),
      'prompt 须含诊断归档路径（runner 拼接，非产物自报）');
    assertRunReachedEnd(probe, 'E2E-4a');
  }
  // 4b：旧 run 残留 → 不回退
  {
    const { root } = setupHost();
    writeFile(root, `doc/features/${FEATURE}/device-testing/reports/crash-diagnostics/all_banks.json`,
      JSON.stringify({
        schema_version: '1.2', screen_or_case: 'all_banks', run_id: '20260701T000000Z-OLDRUN',
        diagnosis: { kind: 'crash_suspected', bundleName: 'com.x', faultFiles: ['cppcrash-com.x-0'], excerpt: '' },
      }));
    const probe = await runChain(root, { onTesting: ({ root: r }) => writeCleanTesting(r) });
    assert(!hasEvent(probe.events, 'phase_backtrack_requested'),
      `旧 run 残留不得回退：${probe.events.filter(e => e.type === 'phase_backtrack_requested').length} 次`);
    assertRunReachedEnd(probe, 'E2E-4b');
  }
});

test('E2E-5 素材确定性事实 → coding 门禁档位无关 FAIL（$r 悬空直接函数断言）', async () => {
  const { root } = setupHost();
  // 源码引用不存在的 media → checkMediaReferenceIntegrity 必 FAIL（BLOCKER，与档位无关）
  writeFile(root, PRODUCT_FILE,
    "struct AllBanksPage { build() { Image($r('app.media.cmb_bank_logo')) } }");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { checkMediaReferenceIntegrity } = require('../../../profiles/hmos-app/harness/visual-parity-backstop') as {
    checkMediaReferenceIntegrity: (ctx: unknown) => Array<{ id: string; status: string; severity: string; details: string }>;
  };
  const ctx = {
    projectRoot: root,
    feature: FEATURE,
    phase: 'coding',
    phaseRule: { structure_checks: {} },
    featureSpec: {
      feature: FEATURE,
      contracts: { modules: [{ name: 'FinancialCard', package_path: '02-Feature/FinancialCard' }] },
    },
  };
  const rs = checkMediaReferenceIntegrity(ctx);
  const r = rs.find(x => x.id === 'media_reference_integrity');
  assert(!!r && r.status === 'FAIL' && r.severity === 'BLOCKER',
    `悬空 $r 须 BLOCKER FAIL：${JSON.stringify(rs)}`);
  assert(r!.details.includes('cmb_bank_logo'), `须点名悬空 key：${r!.details}`);
});

test('E2E-2c ledger+源码并发篡改 → 两类事件都落（源码取证不因 ledger 早退丢失）+ resume 仍被拒', async () => {
  // review 第 10 轮 P2：旧时序 ledger tamper 检查在前且 continue 早退——同时改 ledger+源码
  // 时源码 violation 不落事件、resume 不受终止态保护。现在源码检测先落事件再裁决 halt。
  const { root } = setupHost();
  const first = await runChain(root, {
    onTesting: ({ root: r }) => {
      writeCleanTesting(r);
      writeFile(r, PRODUCT_FILE, 'struct AllBanksPage { build() { Text("both") } }');
      writeFile(r, `doc/features/${FEATURE}/vision/artifact-attestations.jsonl`,
        '{"forged":true}\n');
    },
  });
  assert(hasEvent(first.events, 'testing_write_violation'),
    `源码 violation 事件必须在场（不因 ledger tamper 早退丢失）：${first.events.map(e => e.type).join(',')}`);
  assert(hasEvent(first.events, 'vision_ledger_tamper'),
    `ledger tamper 事件也必须在场：${first.events.map(e => e.type).join(',')}`);
  assert(first.harnessPhases.filter(p => p === 'testing').length === 0, 'gate 不得运行');
  // review 第 12 轮：锁死 halt **优先级**——source violation 在场时终止态为主。旧的错误
  // 实现（ledger 分支先 halt 并提示 --resume）同样能过"两类事件都在"的断言，必须按
  // halt_reason 断言才防回潮。
  const haltReasons = first.events.filter(e => e.type === 'phase_halt')
    .map(e => (e as { halt_reason?: string }).halt_reason);
  assert(haltReasons.includes('testing_write_violation'),
    `最终 halt 须为 testing_write_violation：${JSON.stringify(haltReasons)}`);
  assert(!haltReasons.includes('vision_ledger_tampered'),
    `violation 在场时不得以 ledger halt 为主（那会提示 --resume 又拒 resume）：${JSON.stringify(haltReasons)}`);
  // resume 终止态保护按 violation **事件**判（不看 halt reason 归谁）
  const runId = path.basename(first.reportDir);
  const second = await runChain(root, { resume: runId, forceResume: true, onTesting: ({ root: r }) => writeCleanTesting(r) });
  assert(second.exitCode !== 0 && second.invokedPhases.length === 0,
    `并发篡改后的 resume 仍须被拒，实得 exit=${second.exitCode} phases=[${second.invokedPhases.join(',')}]`);
});

test('R-6a identity 不匹配/缺失的 must_fix 一律不回退（③④ 缺身份=fail-closed）', async () => {
  // 三个反例（review 第 10 轮：isStaleVisualDiffVerdict 对缺 eval hash 返回"不 stale"、
  // currentFp 算不出跳过 build 校验——收集器必须显式要求身份齐备且匹配）
  const scenarios: Array<{ tag: string; screen: Parameters<typeof writeVisualDiff>[1][0] }> = [
    { tag: 'hash 不匹配', screen: { id: 'add_card_home', verdict: 'warn', mustFix: [MUST_FIX_TEXT], freshHash: false } },
    { tag: '缺 evaluated_screenshot_hash', screen: { id: 'add_card_home', verdict: 'warn', mustFix: [MUST_FIX_TEXT], withEvalHash: false } },
    { tag: 'build fingerprint 错误', screen: { id: 'add_card_home', verdict: 'warn', mustFix: [MUST_FIX_TEXT], buildFp: 'wrongfp00000' } },
  ];
  for (const sc of scenarios) {
    const { root } = setupHost();
    const probe = await runChain(root, {
      onTesting: ({ root: r }) => writeVisualDiff(r, [sc.screen]),
    });
    assert(!hasEvent(probe.events, 'phase_backtrack_requested'),
      `【${sc.tag}】不得回退：${probe.events.map(e => e.type).join(',')}`);
    // review 第 12 轮统一口径：缺失/不可算/**不匹配**一律 unverified——"mismatch=正常
    // 代谢"的前提是重评真的发生；best_effort 下 stale gate 只 WARN，重评没发生时已知
    // must_fix 会假绿完成。三场景都：不回退、不完成，retry 耗尽 halt。
    assert(hasEvent(probe.events, 'unverifiable_must_fix'),
      `【${sc.tag}】须落 unverifiable_must_fix 事件：${probe.events.map(e => e.type).join(',')}`);
    assert(runEndStatus(probe.events) === 'HALTED',
      `【${sc.tag}】身份未核实的 must_fix 不得让 run 完成，实得 ${runEndStatus(probe.events)}`);
  }
});

test('R-6a2 缺 evaluated_build_fingerprint / build 身份不可算 → 不回退**也不完成**（halt unverifiable_must_fix）', async () => {
  // 缺 evaluated_build_fingerprint
  {
    const { root } = setupHost();
    const probe = await runChain(root, {
      onTesting: ({ root: r }) => writeVisualDiff(r, [
        { id: 'add_card_home', verdict: 'warn', mustFix: [MUST_FIX_TEXT], buildFp: false },
      ]),
    });
    assert(!hasEvent(probe.events, 'phase_backtrack_requested'), '缺 build 身份不得回退');
    assert(hasEvent(probe.events, 'unverifiable_must_fix'), '须落 unverifiable_must_fix 事件');
    assert(runEndStatus(probe.events) === 'HALTED', `不得完成，实得 ${runEndStatus(probe.events)}`);
  }
  // 当前 build fingerprint 不可算（删 install meta——install ok 但 meta 写失败的生产路径）
  {
    const { root } = setupHost();
    const probe = await runChain(root, {
      onTesting: ({ root: r, attempt }) => {
        // 只在首轮写（writeVisualDiff 会现算 currentFp——meta 在时先写、再删，复刻
        // "评估时有身份、collector 消费时身份丢失"）；retry 轮不动盘保持缺身份态
        if (attempt > 1) return;
        writeVisualDiff(r, [{ id: 'add_card_home', verdict: 'warn', mustFix: [MUST_FIX_TEXT] }]);
        fs.rmSync(path.join(r, `doc/features/${FEATURE}/testing/reports/device-test-install.meta.json`), { force: true });
      },
    });
    assert(!hasEvent(probe.events, 'phase_backtrack_requested'), 'build 身份不可算不得回退（无 HAP 身份=fail-closed）');
    assert(hasEvent(probe.events, 'unverifiable_must_fix'), '须落 unverifiable_must_fix 事件');
    const halts = probe.events.filter(e => e.type === 'phase_halt')
      .map(e => (e as { halt_reason?: string }).halt_reason);
    assert(halts.includes('unverifiable_must_fix'),
      `重试耗尽后须以 unverifiable_must_fix halt，实得 ${JSON.stringify(halts)}`);
  }
});

test('R-6a3 身份有效 + verdict=pass + evaluation_invalidated=true → 不回退、不完成、耗尽 HALTED（review 第 13 轮）', async () => {
  // 洞：invalidated 检查若在 verdict/must_fix 之后，pass 屏在①就被跳过——评估被判无效
  //（待 critic 重评）却照样 CHAIN_SLICE_COMPLETED。best_effort 回归。
  const { root } = setupHost();
  const probe = await runChain(root, {
    onTesting: ({ root: r }) => writeVisualDiff(r, [
      { id: 'add_card_home', verdict: 'pass', mustFix: [], invalidated: true },
    ]),
  });
  assert(!hasEvent(probe.events, 'phase_backtrack_requested'),
    `评估失效不得驱动回退：${probe.events.map(e => e.type).join(',')}`);
  assert(hasEvent(probe.events, 'unverifiable_must_fix'),
    `须落 unverifiable_must_fix 事件：${probe.events.map(e => e.type).join(',')}`);
  const halts = probe.events.filter(e => e.type === 'phase_halt')
    .map(e => (e as { halt_reason?: string }).halt_reason);
  assert(halts.includes('unverifiable_must_fix'),
    `重试耗尽后须 halt，实得 ${JSON.stringify(halts)}`);
  assert(runEndStatus(probe.events) === 'HALTED',
    `评估不可采信不得完成，实得 ${runEndStatus(probe.events)}`);
});

test('R-6b 上一 run 遗留但 build+截图一致的 must_fix → 仍回退（identity 判新鲜，不看 run_id）', async () => {
  const { root } = setupHost();
  // 模拟上一 run 的产物：visual-diff 与截图在 run 开始前就在盘上、identity 完全一致
  writeVisualDiff(root, [{ id: 'add_card_home', verdict: 'warn', mustFix: [MUST_FIX_TEXT] }]);
  const probe = await runChain(root, {
    onTesting: ({ root: r, attempt }) => {
      if (attempt > 1) writeCleanTesting(r);   // 修复后干净；第一轮不动盘上遗留（agent 只采证）
    },
  });
  assert(hasEvent(probe.events, 'phase_backtrack_requested'),
    `同 build+截图的跨 run must_fix 仍是真缺陷，须回退：${probe.events.map(e => e.type).join(',')}`);
  assertRunReachedEnd(probe, 'R-6b');
});

test('R-7 violation 后同 run --resume 被拒绝（run 终止态；防遗留修改被当合法基线洗白）', async () => {
  const { root } = setupHost();
  const first = await runChain(root, {
    onTesting: ({ root: r }) => {
      writeCleanTesting(r);
      writeFile(r, PRODUCT_FILE, 'struct AllBanksPage { build() { Text("hacked") } }');
    },
  });
  assert(hasEvent(first.events, 'testing_write_violation'), '前置：首轮须 violation');
  const runId = path.basename(first.reportDir);
  // --force-resume 绕过 cooldown（review 第 10 轮：否则 5 分钟 cooldown 会先拦下 resume，
  // 测试断言的其实是 cooldown 而不是 violation 终止态——假绿）
  const second = await runChain(root, { resume: runId, forceResume: true, onTesting: ({ root: r }) => writeCleanTesting(r) });
  assert(second.exitCode !== 0, 'resume 须被拒绝（非零退出）');
  assert(second.invokedPhases.length === 0,
    `resume 被拒后不得调用任何 agent，实得 [${second.invokedPhases.join(',')}]`);
  // 拒绝理由必须是 violation 终止态（事件留痕，可测）
  const rej = readEvents(first.reportDir).filter(e => e.type === 'resume_rejected');
  assert(rej.length >= 1 && (rej[0] as { reason?: string }).reason === 'testing_write_violation_terminal',
    `拒绝须落 resume_rejected(testing_write_violation_terminal)：${JSON.stringify(rej)}`);
});

test('R-8 进程重启后同 roundFingerprint 仍熔断；集合变化不熔断', async () => {
  const { root } = setupHost();
  // 第一次 run：testing 每轮都产出**同一条** must_fix（coding 修不动）→ 回退 1 次后
  // 第二次 testing 同集合 → 同进程熔断 halt
  const first = await runChain(root, {
    onTesting: ({ root: r }) => {
      writeVisualDiff(r, [{ id: 'add_card_home', verdict: 'warn', mustFix: [MUST_FIX_TEXT] }]);
    },
  });
  assert(runEndStatus(first.events) === 'HALTED', `修不动须 halt，实得 ${runEndStatus(first.events)}`);
  const bt1 = first.events.filter(e => e.type === 'phase_backtrack_requested');
  assert(bt1.length === 1, `同集合只允许回退一次，实得 ${bt1.length}`);
  assert(
    first.events.some(e => e.type === 'phase_halt' &&
      (e as { halt_reason?: string }).halt_reason === 'backtrack_fingerprint_repeat'),
    `halt 原因须为同集合熔断：${JSON.stringify(first.events.filter(e => e.type === 'phase_halt'))}`,
  );
  const rf = (bt1[0] as { round_fingerprint?: string }).round_fingerprint;
  assert(typeof rf === 'string' && rf.length > 0, '回退事件须持久化完整 round_fingerprint');

  // "重启"：--resume 同一 run（新一次 goalMain 调用 = priorEvents 从盘上恢复）。
  // 同缺陷再现 → 不得再回退（seenRoundFingerprints 从事件 round_fingerprint 字段恢复）。
  const repeatHalts1 = first.events.filter(e => e.type === 'phase_halt' &&
    (e as { halt_reason?: string }).halt_reason === 'backtrack_fingerprint_repeat').length;
  const runId = path.basename(first.reportDir);
  // cooldown 是硬防线（判定在 forceResume 之前，force 只解 terminal 拒绝）——不为测试
  // 改语义。模拟"5 分钟后真实重启"：把 run_end 时间戳回拨 10 分钟（时间流逝的正当模拟）。
  {
    const evPath = path.join(first.reportDir, 'events.jsonl');
    const lines = fs.readFileSync(evPath, 'utf-8').split('\n');
    const patched = lines.map(l => {
      if (!l.trim()) return l;
      try {
        const e = JSON.parse(l) as { type?: string; ts?: string };
        if (e.type === 'run_end' && e.ts) {
          e.ts = new Date(Date.parse(e.ts) - 10 * 60 * 1000).toISOString();
          return JSON.stringify(e);
        }
      } catch { /* keep */ }
      return l;
    });
    fs.writeFileSync(evPath, patched.join('\n'), 'utf-8');
  }
  const second = await runChain(root, {
    resume: runId,
    forceResume: true,
    onTesting: ({ root: r }) => {
      writeVisualDiff(r, [{ id: 'add_card_home', verdict: 'warn', mustFix: [MUST_FIX_TEXT] }]);
    },
  });
  assert(second.invokedPhases.includes('testing'),
    `resume 须真正重入 testing，实得 [${second.invokedPhases.join(',')}]`);
  const bt2 = second.events.filter(e => e.type === 'phase_backtrack_requested');
  assert(bt2.length === bt1.length,
    `重启后同集合不得再回退（事件数须不变），实得 ${bt2.length} vs ${bt1.length}`);
  const repeatHalts2 = second.events.filter(e => e.type === 'phase_halt' &&
    (e as { halt_reason?: string }).halt_reason === 'backtrack_fingerprint_repeat').length;
  assert(repeatHalts2 === repeatHalts1 + 1,
    `resume 后须**新增一条** repeat 熔断（${repeatHalts1} → ${repeatHalts2}）——从事件 round_fingerprint 恢复生效的直接证据`);
});

// ---------------------------------------------------------------------------

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      await c.run();
      results.push({ name: c.name, ok: true });
    } catch (err) {
      results.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  }
  return results;
}
