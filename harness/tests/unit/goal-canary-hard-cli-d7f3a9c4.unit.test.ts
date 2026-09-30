// ============================================================================
// goal-canary-hard-cli-d7f3a9c4.unit.test.ts — plan d7f3a9c4 t4
// 金丝雀 CLI 硬失败前置 BLOCKER（child spawn race / CLI/config 参数不兼容）
// ----------------------------------------------------------------------------
// 覆盖（对照 plan t4 验收 + review 三项）：
//  A. resolveCanaryHardCliFailure 纯函数正反例——spawn_error / 四签名 / Usage 不单独触发 /
//     auth·quota·API 不误升 / exit0·timeout·silent·skipped 不命中 / 10KB 长行无回溯。
//  B. "无有效 stdout"=有效金丝雀答卷（复用 parseCanaryAnswer SSOT）——CLI banner + 明确
//     unknown-argument 签名 → 仍命中 hard_cli_failure（review P2）。
//  C. 真实 spawn 生产者链路——真实 child spawn 不存在二进制 → child 'error' → spawn_error
//     （review P3：不经手搓 invokeFn）。
//  D. runVisionCanaryProbe 集成（真实 action='probe' 流程）：child spawn error / unknown
//     argument / config load error → hard_cli_failure；auth·quota / 普通非零 / 无效答卷 /
//     banner+签名 不写盘分类；有效答卷 → valid_cached。
//  E. runner main() 真实路径终态（review P1）：hard_cli_failure → 落 phase_halt + 
//     run_end{HALTED} + return 1；无正式 phase invoke；事件已落盘。
//  F. skip 路径不调用分类；既有 binary 门禁不变（回归 + 源码断言）。
// ============================================================================

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { UnitCaseResult } from '../run-unit';
import {
  resolveCanaryHardCliFailure,
  resolveCanaryCacheDecision,
  VISION_CANARY_PROBE_VERSION,
} from '../../scripts/utils/vision-canary';
import {
  decideVisionCanaryProbe,
  runVisionCanaryProbe,
} from '../../scripts/utils/goal-preflight';
import {
  invokeAgentHeadless,
  type HeadlessInvokePlan,
} from '../../scripts/utils/agent-invoke';
type InvokeFnType = typeof invokeAgentHeadless;
import { loadLocalConfig, writeLocalConfig } from '../../scripts/utils/framework-local-config';
import type { GoalManifest } from '../../scripts/utils/goal-manifest';
import { FIXTURE_CANARY_KEY } from '../utils/canary-fixture-key';
import {
  __testing_resetGoalRunnerSeams,
  __testing_setCanaryProbeInvoke,
  __testing_setDeviceReadinessGate,
  __testing_setInvokeAgent,
  __testing_setRepoLayout,
  __testing_setRunHarnessPhase,
  __testing_setValidateReceipt,
  main as goalMain,
} from '../../scripts/goal-runner';
import { FINALIZE_RESERVE_MS, resolveWallClockMs } from '../../scripts/utils/goal-timeout';
import { loadAuthoritativeEvents, resolveResumedBudget } from '../../scripts/utils/goal-runner-phase';
import * as goalRunnerMod from '../../scripts/goal-runner';
import { setupMinimalHost } from '../helpers/goal-run-driver';
import { inferRepoLayout } from '../../repo-layout';
import { clearFrameworkConfigCache } from '../../config';

const REPO_ROOT = path.resolve(__dirname, '../../..');

const UI_REQ = '银行卡开卡需求，含7个页面，参考图还原布局。';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'goal-canary-hard-cli-'));
}

function baseManifest(over: Partial<GoalManifest> = {}): GoalManifest {
  return {
    schema_version: '1.0',
    run_id: 'run-R2',
    feature: 'demo',
    requirement: UI_REQ,
    adapter: 'claude',
    start_phase: 'spec',
    end_phase: 'spec',
    report_dir: 'doc/features/demo/goal-runs/run-R2',
    created_at: '2026-06-09T00:00:00Z',
    unattended: { write_mode: 'workspace-write', approval_mode: 'never' },
    budget: {
      max_total_turns: 10,
      max_retries_per_phase: 1,
      wall_clock_minutes: 60,
      max_transient_api_retries: 3,
    },
    dependency_policy: { deferrable_blocking_classes: [], deferrable_failure_kinds: [], propagate_to_downstream: true },
    ...over,
  };
}

function claudeFrameworkFixture(root: string): string {
  const fw = path.join(root, 'fw');
  const adapterDir = path.join(fw, 'agents', 'claude');
  fs.mkdirSync(adapterDir, { recursive: true });
  fs.writeFileSync(
    path.join(adapterDir, 'adapter.yaml'),
    [
      'adapter_name: claude',
      'goal_capability:',
      '  mode: native_goal',
      '  native_goal:',
      '    goal_condition_template: templates/goal-condition.md',
      '    supports_resume: false',
      '  external_runner:',
      '    headless_invoke: \'claude -p "{{PROMPT}}"\'',
      '    unattended:',
      '      write_mode: accept-edits',
      '      approval_mode: never',
    ].join('\n'),
    'utf-8',
  );
  return fw;
}

const FULL_ANSWER =
  'TOP_LEFT_COLOR=red\nTOP_RIGHT_COLOR=blue\nBOTTOM_LEFT_COLOR=green\nBOTTOM_RIGHT_COLOR=yellow\nTEXT_TOKEN=MAISON7X3Q';

const AUTH_QUOTA_STDOUT = 'ActionRequiredError: You have hit your usage limit. Get Pro for more.';

// 2026-09-26 宿主 run 0457a6：未钉 --adapter-model 时 codex 走 ~/.codex/config.toml 默认模型，
// ChatGPT 账号下 400。invoke 边界产出 terminal_failure_observed + 解析后的 excerpt。
const HOST_400_MESSAGE = "The 'gpt-6-sol' model is not supported when using Codex with a ChatGPT account.";
function codexTurnFailedInvoke(message: string, status: number, errType: string) {
  const inner = JSON.stringify({ type: 'error', status, error: { type: errType, message } });
  return {
    exitCode: 1,
    stdout: `${JSON.stringify({ type: 'turn.failed', error: { message: inner } })}\n`,
    stderr: '',
    command: 'fake-codex',
    terminal_failure_observed: true,
    terminal_error_excerpt: `turn.failed: ${inner}`,
  };
}

const cases: Array<{ name: string; run: () => void | Promise<void> }> = [
  // ==========================================================================
  // A. 纯函数排序正反例
  // ==========================================================================
  {
    name: 't4 resolveCanaryHardCliFailure：spawn_error 在场即硬失败；四签名命中；Usage 单独不触发；exit0/timeout/silent/skipped 不命中',
    run: () => {
      const base = { exitCode: 1, stdout: '', stderr: '' };
      // ① child spawn race：结构化事实在场即硬失败（同 resolvedBinary 短路）
      assert.match(resolveCanaryHardCliFailure({ ...base, spawn_error: { code: 'EPERM', message: 'spawn EPERM' } }) ?? '', /child spawn error/);
      assert.match(resolveCanaryHardCliFailure({ ...base, spawn_error: { code: 'resolved_binary_unspawnable', message: 'preflight BLOCKER' } }) ?? '', /child spawn error/);
      // ② CLI/config 签名（行首锚定，/i 大小写不敏感，仅允许行首空白缩进）
      assert.match(resolveCanaryHardCliFailure({ ...base, stderr: "error: unknown argument '--model'" }) ?? '', /参数不兼容/);
      assert.match(resolveCanaryHardCliFailure({ ...base, stderr: "error: unexpected argument '--foo' found" }) ?? '', /参数不兼容/);
      assert.match(resolveCanaryHardCliFailure({ ...base, stderr: "error: unrecognized option '--sandbox'" }) ?? '', /参数不兼容/);
      assert.match(resolveCanaryHardCliFailure({ ...base, stderr: 'Error loading config: /path/to/config.toml' }) ?? '', /参数不兼容/);
      assert.match(resolveCanaryHardCliFailure({ ...base, stderr: 'error: Error loading config' }) ?? '', /参数不兼容/);
      assert.match(resolveCanaryHardCliFailure({ ...base, stderr: "Unknown argument '--x'" }) ?? '', /参数不兼容/, '大小写不敏感');
      // 多行：签名在带缩进的后续行（逐行匹配）
      assert.match(
        resolveCanaryHardCliFailure({ ...base, stderr: 'some log line\n  error: unexpected argument \'--y\'' }) ?? '',
        /参数不兼容/,
      );
      // Usage 单独出现不触发（辅助特征）
      assert.strictEqual(resolveCanaryHardCliFailure({ ...base, stderr: 'Usage: claude -p [options] [command]' }), null);
      // ④ 必要条件缺失 → 不命中
      assert.strictEqual(resolveCanaryHardCliFailure({ ...base, exitCode: 0, stderr: "error: unknown argument '--x'" }), null, 'exit0 不命中');
      assert.strictEqual(resolveCanaryHardCliFailure({ ...base, timed_out: true, stderr: "error: unknown argument '--x'" }), null, 'timeout 不命中');
      assert.strictEqual(resolveCanaryHardCliFailure({ ...base, silent_killed: true, stderr: "error: unknown argument '--x'" }), null, 'silent kill 不命中');
      assert.strictEqual(resolveCanaryHardCliFailure({ ...base, skipped: true, stderr: "error: unknown argument '--x'" }), null, 'skipped 不命中');
      // auth/quota/API 错误不误升
      assert.strictEqual(resolveCanaryHardCliFailure({ ...base, stderr: 'ActionRequiredError: You have hit your usage limit. Get Pro for more.' }), null);
      assert.strictEqual(resolveCanaryHardCliFailure({ ...base, stderr: 'error: authentication required' }), null, 'auth 不误升');
      assert.strictEqual(resolveCanaryHardCliFailure({ ...base, stderr: 'error: 500 Internal Server Error' }), null, 'API/模型服务错误不误升');
    },
  },
  {
    name: 't4 resolveCanaryHardCliFailure：10KB 长行 stderr 含签名 → 命中且快速（无回溯灾难）',
    run: () => {
      const long = 'x'.repeat(10 * 1024) + " error: unknown argument '--model'";
      const started = Date.now();
      const r = resolveCanaryHardCliFailure({ exitCode: 1, stdout: '', stderr: long });
      if (r === null) {
        // 签名在行尾（超 1024 截断后）——合法不命中；此时再验证"签名在行首 1024 内命中"
        const head = "error: unknown argument '--model'" + 'x'.repeat(10 * 1024);
        assert.match(resolveCanaryHardCliFailure({ exitCode: 1, stdout: '', stderr: head }) ?? '', /参数不兼容/);
      } else {
        assert.match(r, /参数不兼容/);
      }
      assert(Date.now() - started < 5_000, '10KB 长行判定须毫秒级完成（无回溯）');
    },
  },

  // ==========================================================================
  // B. "无有效 stdout" = 有效金丝雀答卷（review P2：banner 不压签名）
  // ==========================================================================
  {
    name: 't4 "有效 stdout"=有效答卷：CLI banner + 明确 unknown-argument → 仍命中硬失败（复用 parseCanaryAnswer）',
    run: () => {
      const banner = {
        exitCode: 1,
        stdout: 'Claude Code CLI\nBuild 2.1.0\nType /help for a list of commands.\n',
        stderr: "error: unknown argument '--model'",
      };
      // 带 answerKey：banner 不是有效答卷 → 不满足"有有效 stdout" → 命中硬失败
      assert.match(
        resolveCanaryHardCliFailure(banner, { answerKey: FIXTURE_CANARY_KEY }) ?? '',
        /参数不兼容/,
        'banner + unknown argument 必须命中 hard_cli_failure',
      );
      // 真答卷 + 签名 → 不命中（agent 作答了）
      const answered = { ...banner, stdout: FULL_ANSWER };
      assert.strictEqual(
        resolveCanaryHardCliFailure(answered, { answerKey: FIXTURE_CANARY_KEY }),
        null,
        '有效答卷不得判为参数错误',
      );
      // 无 answerKey 时保守沿用旧语义（非空 stdout 即"有有效 stdout"）
      assert.strictEqual(resolveCanaryHardCliFailure(banner), null);
    },
  },
  {
    name: 't4 集成：banner + unknown argument 走真实 probe → hard_cli_failure（不写盘）',
    run: async () => {
      const root = mkTmp();
      try {
        const fw = claudeFrameworkFixture(root);
        writeLocalConfig(root, { schema_version: '1.0', agent_adapter: 'claude' });
        const r = await runVisionCanaryProbe({
          projectRoot: root, frameworkRoot: fw, manifest: baseManifest(),
          invokeFn: (async () => ({ exitCode: 1, stdout: 'Codex CLI\nTelemetry: off\n', stderr: "error: unknown argument '--model'", command: 'fake' })) as InvokeFnType,
        });
        assert.strictEqual(r.outcome, 'hard_cli_failure', JSON.stringify(r));
        assert.match(r.error ?? '', /参数不兼容/);
        assert.strictEqual(loadLocalConfig(root)?.vision?.canary, undefined, '硬失败不写盘');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },

  // ==========================================================================
  // C. 真实 spawn 生产者链路（review P3：不经手搓 invokeFn）
  // ==========================================================================
  {
    name: 't4 真实链路：spawn 不存在二进制 → child error → invokeAgentHeadless.spawn_error（code=ENOENT 类）',
    run: async () => {
      const plan = {
        argv: [path.join(os.tmpdir(), 'maison-definitely-missing-cli-xyz'), '-p'],
        label: 'fake-missing-bin',
        adapterName: 'claude',
      } as unknown as HeadlessInvokePlan;
      const r = await invokeAgentHeadless(plan, os.tmpdir(), { timeoutMs: 8_000 });
      assert(r.exitCode === 1, `exitCode=${r.exitCode}`);
      assert(r.spawn_error, '真实 spawn race 必须产生结构化 spawn_error');
      assert.strictEqual(r.spawn_error?.code, 'ENOENT');
      assert.strictEqual(r.stdout, '');
      // 该 spawn_error 直接喂给硬失败分类 → hard_cli_failure（同一事实链路闭环）
      assert.match(resolveCanaryHardCliFailure(r) ?? '', /child spawn error/);
    },
  },
  {
    name: 't4 resolvedBinary 短路与真实 child error 同构（短路返回 spawn_error，消费侧判 hard_cli_failure）',
    run: () => {
      const src = fs.readFileSync(path.join(__dirname, '../../scripts/utils/agent-invoke.ts'), 'utf-8');
      assert(
        /spawn_error: \{ code: 'resolved_binary_unspawnable', message: stderr \}/.test(src),
        'resolvedBinary 短路须返回 spawn_error 结构化事实',
      );
      const r = resolveCanaryHardCliFailure({
        exitCode: 1, stdout: '', stderr: 'preflight BLOCKER',
        spawn_error: { code: 'resolved_binary_unspawnable', message: 'preflight BLOCKER' },
      });
      assert.match(r ?? '', /child spawn error/);
    },
  },

  // ==========================================================================
  // D. runVisionCanaryProbe 集成（真实 action=\'probe\' 流程）
  // ==========================================================================
  {
    name: 't4 集成：child spawn error → hard_cli_failure；unknown argument / config load error → hard_cli_failure',
    run: async () => {
      const root = mkTmp();
      try {
        const fw = claudeFrameworkFixture(root);
        writeLocalConfig(root, { schema_version: '1.0', agent_adapter: 'claude' });
        assert.deepStrictEqual(
          decideVisionCanaryProbe({ projectRoot: root, manifest: baseManifest(), chain: ['spec'], dryRun: false }),
          { action: 'probe' },
          '须走真实 probe 路径',
        );
        // child spawn error
        let r = await runVisionCanaryProbe({
          projectRoot: root, frameworkRoot: fw, manifest: baseManifest(),
          invokeFn: (async () => ({ exitCode: 1, stdout: '', stderr: '', command: 'fake', spawn_error: { code: 'EPERM', message: 'spawn EPERM' } })) as InvokeFnType,
        });
        assert.strictEqual(r.outcome, 'hard_cli_failure', JSON.stringify(r));
        assert.match(r.error ?? '', /child spawn error/);
        assert.strictEqual(loadLocalConfig(root)?.vision?.canary, undefined);
        // unknown argument / config load error
        for (const [stderr, expect] of [
          ["error: unknown argument '--model'", /unknown argument/],
          ['Error loading config: C:\\Users\\x\\.claude\\settings.json', /Error loading config/],
        ] as const) {
          r = await runVisionCanaryProbe({
            projectRoot: root, frameworkRoot: fw, manifest: baseManifest(),
            invokeFn: (async () => ({ exitCode: 1, stdout: '', stderr, command: 'fake' })) as InvokeFnType,
          });
          assert.strictEqual(r.outcome, 'hard_cli_failure', JSON.stringify({ stderr, r }));
          assert.match(r.error ?? '', /参数不兼容/);
          assert.match(r.error ?? '', expect);
          assert.strictEqual(loadLocalConfig(root)?.vision?.canary, undefined);
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 't4 集成：auth/quota·普通非零退出·无效答卷 不升 BLOCKER；有效答卷仍 valid_cached',
    run: async () => {
      const root = mkTmp();
      try {
        const fw = claudeFrameworkFixture(root);
        writeLocalConfig(root, { schema_version: '1.0', agent_adapter: 'claude' });
        // auth/quota（stdout 非空额度文本、exit0）→ invalid_not_cached（现状）
        let r = await runVisionCanaryProbe({
          projectRoot: root, frameworkRoot: fw, manifest: baseManifest(),
          invokeFn: (async () => ({ exitCode: 0, stdout: AUTH_QUOTA_STDOUT, stderr: '', command: 'fake' })) as InvokeFnType,
        });
        assert.strictEqual(r.outcome, 'invalid_not_cached', JSON.stringify(r));
        // 普通非零退出 + 无签名 stderr（API/auth 类）→ invoke_failed_not_cached（非阻断）
        r = await runVisionCanaryProbe({
          projectRoot: root, frameworkRoot: fw, manifest: baseManifest(),
          invokeFn: (async () => ({ exitCode: 1, stdout: '', stderr: 'error: 500 Internal Server Error\nplease retry', command: 'fake' })) as InvokeFnType,
        });
        assert.strictEqual(r.outcome, 'invoke_failed_not_cached', JSON.stringify(r));
        // 无效答卷（空输出）→ invalid_not_cached
        r = await runVisionCanaryProbe({
          projectRoot: root, frameworkRoot: fw, manifest: baseManifest(),
          invokeFn: (async () => ({ exitCode: 0, stdout: '', stderr: '', command: 'fake' })) as InvokeFnType,
        });
        assert.strictEqual(r.outcome, 'invalid_not_cached', JSON.stringify(r));
        // 有效答卷 → valid_cached（回归；parseCanaryAnswer 与判卷同源）
        r = await runVisionCanaryProbe({
          projectRoot: root, frameworkRoot: fw, manifest: baseManifest(),
          invokeFn: (async () => ({ exitCode: 0, stdout: FULL_ANSWER, stderr: '', command: 'fake' })) as InvokeFnType,
          answerKeyFn: () => FIXTURE_CANARY_KEY,
        });
        assert.strictEqual(r.outcome, 'valid_cached', JSON.stringify(r));
        assert.strictEqual(loadLocalConfig(root)?.vision?.canary?.verdict, 'tool_read');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },

  {
    name: '0457a6 集成：默认模型 400 model is not supported → hard_cli_failure 带原文与 --adapter-model 指引；普通 turn.failed 失败行带原文；钉可用模型仍 valid_cached',
    run: async () => {
      const root = mkTmp();
      try {
        const fw = claudeFrameworkFixture(root);
        writeLocalConfig(root, { schema_version: '1.0', agent_adapter: 'claude' });
        // (b) 未钉模型（有效模型=adapter 默认/用户配置回落）→ 硬失败
        let r = await runVisionCanaryProbe({
          projectRoot: root, frameworkRoot: fw, manifest: baseManifest(),
          invokeFn: (async () => codexTurnFailedInvoke(HOST_400_MESSAGE, 400, 'invalid_request_error')) as unknown as InvokeFnType,
        });
        assert.strictEqual(r.outcome, 'hard_cli_failure', JSON.stringify(r));
        assert.ok((r.error ?? '').includes(HOST_400_MESSAGE), `须带原文：${r.error}`);
        assert.ok((r.error ?? '').includes('--adapter-model'), `须给钉模型指引：${r.error}`);
        assert.strictEqual(loadLocalConfig(root)?.vision?.canary, undefined, '硬失败不写盘');
        // 非永久错误（500）仍是非阻断调用失败，但失败行须带 invoke 原文
        r = await runVisionCanaryProbe({
          projectRoot: root, frameworkRoot: fw, manifest: baseManifest(),
          invokeFn: (async () => codexTurnFailedInvoke('upstream overloaded', 500, 'server_error')) as unknown as InvokeFnType,
        });
        assert.strictEqual(r.outcome, 'invoke_failed_not_cached', JSON.stringify(r));
        assert.ok((r.error ?? '').includes('upstream overloaded'), `失败行须带原文：${r.error}`);
        // (c) 钉了可用模型 → 与现状一致：valid_cached 且 receipt 记钉值
        r = await runVisionCanaryProbe({
          projectRoot: root, frameworkRoot: fw,
          manifest: baseManifest({ adapter_model_pin: { adapter: 'claude', value: 'gpt-5.5' } }),
          invokeFn: (async () => ({ exitCode: 0, stdout: FULL_ANSWER, stderr: '', command: 'fake' })) as InvokeFnType,
          answerKeyFn: () => FIXTURE_CANARY_KEY,
        });
        assert.strictEqual(r.outcome, 'valid_cached', JSON.stringify(r));
        assert.strictEqual(loadLocalConfig(root)?.vision?.canary?.model, 'gpt-5.5');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },

  // ==========================================================================
  // E. runner main() 真实路径终态（review P1：结构化 run 级 BLOCKER）
  // ==========================================================================
  {
    name: '0457a6 runner main()：默认模型金丝雀 400 → canary_cli_hard_failure 启动期停机；无正式 phase invoke；run_end 带原文',
    run: async () => {
      const feature = 'canary-model-400';
      const root = setupMinimalHost(feature);
      const specAbs = path.join(root, 'doc', 'features', feature, 'spec', 'spec.md');
      fs.writeFileSync(specAbs, '```yaml\nui_change: new_or_changed\n```\n', 'utf-8');
      const { spawnSync } = require('child_process') as typeof import('child_process');
      spawnSync('git', ['add', '-A'], { cwd: root, encoding: 'utf-8' });
      spawnSync('git', ['commit', '-qm', 'ui'], { cwd: root, encoding: 'utf-8' });
      const invokedPhases: string[] = [];
      const prevArgv = process.argv;
      const prevCwd = process.cwd();
      const prevTrustDir = process.env.MAISON_GOAL_CHECKPOINT_DIR;
      process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'trust-cp');
      try {
        __testing_setCanaryProbeInvoke((async () =>
          codexTurnFailedInvoke(HOST_400_MESSAGE, 400, 'invalid_request_error')) as never);
        __testing_setInvokeAgent((async () => {
          invokedPhases.push('formal');
          return { exitCode: 0, stdout: 'done', stderr: '', command: 'fake-agent' };
        }) as never);
        __testing_setRunHarnessPhase((async () => ({ exitCode: 0, timedOut: false })) as never);
        __testing_setRepoLayout({ kind: 'standalone', projectRoot: root, frameworkRoot: REPO_ROOT, frameworkRel: '' } as ReturnType<typeof inferRepoLayout>);
        __testing_setDeviceReadinessGate((() => ({
          env: { HARNESS_HDC_TARGET: 'fake-device', MAISON_DEVICE_TARGET_KIND: 'physical' },
          target: { serial: 'fake-device', targetKind: 'physical' as const },
          notes: ['test seam'],
        })) as never);
        __testing_setValidateReceipt(((_hr: string, _pr: string, ph: string, feat: string) => ({
          status: 'passed' as const,
          receipt_path: `doc/features/${feat}/${ph}/phase-completion-receipt.md`,
          exit_code: 0,
        })) as never);
        process.argv = [
          'node', 'goal-runner.ts',
          '--feature', feature,
          '--requirement', UI_REQ,
          '--start', 'spec', '--end', 'spec',
          '--adapter', 'cursor',
          '--foreground-ok', '--force',
        ];
        process.chdir(root);
        clearFrameworkConfigCache();
        const exitCode = await goalMain();
        const runsDir = path.join(root, 'doc/features', feature, 'goal-runs');
        const runs = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter(n => !n.startsWith('.')) : [];
        const reportDir =
          runs.length > 0
            ? path.join(runsDir, runs.map(n => ({ n, t: fs.statSync(path.join(runsDir, n)).mtimeMs })).sort((a, b) => a.t - b.t).slice(-1)[0].n)
            : '';
        const events = readEvents(reportDir);
        assert.strictEqual(exitCode, 1, 'run 应以 1 退出');
        assert.deepStrictEqual(invokedPhases, [], '不得有任何正式 phase invoke');
        assert(!events.some(e => e.type === 'run_start'), '启动期停机：run 不出生（无 run_start）');
        const halt = events.find(e => e.type === 'phase_halt' && e.halt_reason === 'canary_cli_hard_failure') as Record<string, unknown> | undefined;
        assert(halt, '须落 phase_halt(canary_cli_hard_failure)');
        assert.ok(String(halt!.halt_guidance ?? '').includes('--adapter-model'), 'halt_guidance 须给钉模型指引');
        const end = [...events].reverse().find(e => e.type === 'run_end') as Record<string, unknown> | undefined;
        assert.strictEqual(end?.halt_reason, 'canary_cli_hard_failure');
        assert.ok(String(end?.error ?? '').includes(HOST_400_MESSAGE), `run_end 须带原文：${String(end?.error)}`);
      } finally {
        __testing_resetGoalRunnerSeams();
        process.argv = prevArgv;
        if (prevTrustDir === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR;
        else process.env.MAISON_GOAL_CHECKPOINT_DIR = prevTrustDir;
        try { process.chdir(prevCwd); } catch { /* ignore */ }
        try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    },
  },
  {
    name: 't4 runner main()：hard_cli_failure → 落 phase_halt(canary_cli_hard_failure)+run_end(HALTED)+return 1；无正式 phase invoke',
    run: async () => {
      const root = setupMinimalHost('canary-hard-cli');
      // resolveUiRelevanceForRun 优先读 spec.md 的 ui_change（spec.md 存在即不再回退 requirement
      // 文本）——覆盖为 UI 相关声明并提交，确保 decideVisionCanaryProbe 走真实 probe。
      const specAbs = path.join(root, 'doc', 'features', 'canary-hard-cli', 'spec', 'spec.md');
      fs.writeFileSync(specAbs, '```yaml\nui_change: new_or_changed\n```\n', 'utf-8');
      const { spawnSync } = require('child_process') as typeof import('child_process');
      spawnSync('git', ['add', '-A'], { cwd: root, encoding: 'utf-8' });
      spawnSync('git', ['commit', '-qm', 'ui'], { cwd: root, encoding: 'utf-8' });
      const invokedPhases: string[] = [];
      const harnessPhases: string[] = [];
      const prevArgv = process.argv;
      const prevCwd = process.cwd();
      const prevTrustDir = process.env.MAISON_GOAL_CHECKPOINT_DIR;
      process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'trust-cp');
      try {
        // probe 的 invoke 真实命中 child spawn race（结构化 spawn_error）
        __testing_setCanaryProbeInvoke((async (
          _plan: unknown, _cwd: string, _o?: Record<string, unknown>,
        ) => ({
          exitCode: 1, stdout: '', stderr: '', command: 'fake-probe',
          spawn_error: { code: 'ENOENT', message: 'spawn ENOENT' },
        })) as unknown as ReturnType<typeof goalRunnerMod.__testing_setCanaryProbeInvoke> extends never ? never : Parameters<typeof goalRunnerMod.__testing_setCanaryProbeInvoke>[0]);
        // phase invoke spy——断言"没有正式 phase invoke"
        __testing_setInvokeAgent((async (_plan: unknown, _root: unknown, o: unknown) => {
          const logPath = String((o as { outputLogPath?: string })?.outputLogPath ?? '').split(path.sep).join('/');
          const phase = /\/phases\/([a-z-]+)\//.exec(logPath)?.[1] ?? '';
          invokedPhases.push(phase);
          return { exitCode: 0, stdout: 'done', stderr: '', command: 'fake-agent' };
        }) as never);
        __testing_setRunHarnessPhase((async (_pr: string, _fr: string, ph: string) => {
          harnessPhases.push(String(ph));
          return { exitCode: 0, timedOut: false };
        }) as never);
        __testing_setRepoLayout({ kind: 'standalone', projectRoot: root, frameworkRoot: REPO_ROOT, frameworkRel: '' } as ReturnType<typeof inferRepoLayout>);
        // 临时宿主无真实设备——预设 READY 放行（链根本走不到设备门，防御性设置）
        __testing_setDeviceReadinessGate(((_o: { phase: string }) => ({
          env: { HARNESS_HDC_TARGET: 'fake-device', MAISON_DEVICE_TARGET_KIND: 'physical' },
          target: { serial: 'fake-device', targetKind: 'physical' as const },
          notes: ['test seam'],
        })) as never);
        __testing_setValidateReceipt(((_hr: string, _pr: string, ph: string, feat: string) => ({
          status: 'passed' as const,
          receipt_path: `doc/features/${feat}/${ph}/phase-completion-receipt.md`,
          exit_code: 0,
        })) as never);
        process.argv = [
          'node', 'goal-runner.ts',
          '--feature', 'canary-hard-cli',
          '--requirement', UI_REQ,
          '--start', 'spec', '--end', 'spec',
          '--adapter', 'cursor',
          '--foreground-ok', '--force',
        ];
        process.chdir(root);
        clearFrameworkConfigCache();
        const exitCode = await goalMain();
        const runsDir = path.join(root, 'doc/features', 'canary-hard-cli', 'goal-runs');
        const runs = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter(n => !n.startsWith('.')) : [];
        const reportDir =
          runs.length > 0
            ? path.join(runsDir, runs.map(n => ({ n, t: fs.statSync(path.join(runsDir, n)).mtimeMs })).sort((a, b) => a.t - b.t).slice(-1)[0].n)
            : '';
        const events = readEvents(reportDir);
        assert.strictEqual(exitCode, 1, `run 应以 1 退出（BLOCKER）`);
        assert.deepStrictEqual(invokedPhases, [], '不得有任何正式 phase invoke');
        assert.deepStrictEqual(harnessPhases, [], '不得有任何 gate harness spawn');
        // 结构化终态已落盘
        const halt = events.find(e => e.type === 'phase_halt' && e.halt_reason === 'canary_cli_hard_failure') as Record<string, unknown> | undefined;
        assert(halt, '须落 phase_halt(canary_cli_hard_failure)');
        assert(
          !events.some(e => e.type === 'phase_halt' && e.halt_reason === 'blind_visual_authorization_required'),
          't7：缺盲跑授权不得掩盖 canary hard CLI failure',
        );
        assert(typeof halt!.halt_guidance === 'string' && String(halt!.halt_guidance).includes('非需求代码'), 'halt_guidance 须有界且含定性');
        const end = [...events].reverse().find(e => e.type === 'run_end') as Record<string, unknown> | undefined;
        assert(end, '须落 run_end');
        assert.strictEqual(end!.status, 'HALTED', `run_end 状态=${String(end!.status)}`);
        // manifest 已落盘 → run 目录可监控、可表达 --resume（与 declared_product_layer_missing
        // 启动期 HALT 同款：此模式在 run_start 之前 return，不要求 run_start 事件）
        assert(fs.existsSync(path.join(reportDir, 'manifest.json')), 'manifest 须已写盘（run 可监控）');
        // t7（f3a8c6d2）异常退出残留：金丝雀 CLI 硬失败 return 1 后，
        // run-control 必须 released、.runner.lock 必须已回收（finally→releaseAllLocks）。
        // 根因核实：canaryHardCliFailure 分支在保护性 try 内 return 1（goal-runner.ts:4323），
        // finally（:8853）releaseAllLocks → releaseRunOwner(state=released) + releaseLock
        // （unlink .runner.lock）。此断言证明异常退出路径未漏锁、未残留 active 态。
        const control = JSON.parse(
          fs.readFileSync(path.join(reportDir, 'run-control.json'), 'utf-8'),
        ) as { owner?: { state?: string } };
        assert.strictEqual(
          control.owner?.state,
          'released',
          `run-control.owner.state 应为 released（金丝雀硬失败退出不得残留 active），实际=${String(control.owner?.state)}`,
        );
        assert(
          !fs.existsSync(path.join(reportDir, '.runner.lock')),
          '.runner.lock 不得残留（异常退出须回收）',
        );
      } finally {
        __testing_resetGoalRunnerSeams();
        process.argv = prevArgv;
        if (prevTrustDir === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR;
        else process.env.MAISON_GOAL_CHECKPOINT_DIR = prevTrustDir;
        try { process.chdir(prevCwd); } catch { /* ignore */ }
        try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    },
  },
  {
    name: 't3 runner 启动 smoke：UI blind 不再等待授权，直接交 requirement/capability 链裁决',
    run: async () => {
      const roots: string[] = [];
      const prevArgv = process.argv;
      const prevCwd = process.cwd();
      const prevTrustDir = process.env.MAISON_GOAL_CHECKPOINT_DIR;

      const prepareUiBlindHost = (feature: string): string => {
        const root = setupMinimalHost(feature);
        roots.push(root);
        const specAbs = path.join(root, 'doc', 'features', feature, 'spec', 'spec.md');
        fs.writeFileSync(specAbs, '```yaml\nui_change: new_or_changed\n```\n', 'utf-8');
        const { spawnSync } = require('child_process') as typeof import('child_process');
        spawnSync('git', ['add', '-A'], { cwd: root, encoding: 'utf-8' });
        spawnSync('git', ['commit', '-qm', 'ui'], { cwd: root, encoding: 'utf-8' });
        writeLocalConfig(root, {
          schema_version: '1.0',
          agent_adapter: 'cursor',
          vision: { image_input_override: 'none' },
        });
        return root;
      };

      const newestReportDir = (root: string, feature: string): string => {
        const runsDir = path.join(root, 'doc', 'features', feature, 'goal-runs');
        const runs = fs.readdirSync(runsDir).filter(n => !n.startsWith('.'));
        assert(runs.length > 0, `${feature}: 须创建可监控 run`);
        const newest = runs
          .map(n => ({ n, t: fs.statSync(path.join(runsDir, n)).mtimeMs }))
          .sort((a, b) => a.t - b.t)
          .slice(-1)[0].n;
        return path.join(runsDir, newest);
      };

      const installSeams = (root: string): void => {
        __testing_setRepoLayout({
          kind: 'standalone', projectRoot: root, frameworkRoot: REPO_ROOT, frameworkRel: '',
        } as ReturnType<typeof inferRepoLayout>);
        __testing_setInvokeAgent((async () => ({
          exitCode: 2,
          stdout: '',
          stderr: '[maison-guardian] CreateProcess(CREATE_SUSPENDED) 失败: 5（t7 smoke）\n',
          command: 'fake-guardian',
          spawn_error: {
            code: 'maison_guardian_containment_failed',
            message: '[maison-guardian] CreateProcess(CREATE_SUSPENDED) 失败: 5',
          },
        })) as never);
        __testing_setRunHarnessPhase((async () => {
          throw new Error('t7 startup smoke 不得进入 harness');
        }) as never);
        __testing_setDeviceReadinessGate((() => ({
          env: { HARNESS_HDC_TARGET: 'fake-device', MAISON_DEVICE_TARGET_KIND: 'physical' },
          target: { serial: 'fake-device', targetKind: 'physical' as const },
          notes: ['t7 smoke seam'],
        })) as never);
        __testing_setValidateReceipt((() => ({
          status: 'passed' as const,
          receipt_path: 'unused',
          exit_code: 0,
        })) as never);
        process.chdir(root);
        process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'trust-cp');
        clearFrameworkConfigCache();
      };

      const freshArgs = (feature: string, extra: string[] = []): string[] => [
        'node', 'goal-runner.ts',
        '--feature', feature,
        '--requirement', UI_REQ,
        '--start', 'spec', '--end', 'spec',
        '--adapter', 'cursor',
        '--foreground-ok', '--force',
        ...extra,
      ];

      try {
        // UI + primary blind + 无 provider：不再进入人工授权门；本例为非 hard pixel，
        // 因而越过 capability preflight，随后由注入的正式 invoke 硬失败收口。
        const deniedFeature = 't7-blind-denied';
        const deniedRoot = prepareUiBlindHost(deniedFeature);
        fs.mkdirSync(path.join(deniedRoot, 'app'), { recursive: true });
        installSeams(deniedRoot);
        process.argv = freshArgs(deniedFeature);
        assert.strictEqual(await goalMain(), 1);
        const deniedDir = newestReportDir(deniedRoot, deniedFeature);
        const deniedEvents = readEvents(deniedDir);
        assert(
          !deniedEvents.some(e => e.type === 'phase_halt' && e.halt_reason === 'blind_visual_authorization_required'),
          'blind capability 不得再创建人工授权 halt',
        );
        assert.strictEqual(
          deniedEvents.filter(e => e.type === 'agent_invoke_start').length,
          1,
          '非严格视觉需求应直接进入正式 phase invoke',
        );
        const deniedManifest = JSON.parse(fs.readFileSync(path.join(deniedDir, 'manifest.json'), 'utf-8')) as Record<string, unknown>;
        assert.strictEqual(deniedManifest.allow_blind_visual, undefined, '新 manifest 不得写盲跑授权键');

        // 合法 provider 同样进入正式 phase；provider 本身不在本 smoke 调用。
        const providerFeature = 't7-provider-allowed';
        const providerRoot = prepareUiBlindHost(providerFeature);
        fs.mkdirSync(path.join(providerRoot, 'app'), { recursive: true });
        installSeams(providerRoot);
        process.argv = freshArgs(providerFeature, [
          '--visual-adapter', 'claude', '--visual-model', 'smoke-vision-model',
        ]);
        assert.strictEqual(await goalMain(), 1);
        const providerDir = newestReportDir(providerRoot, providerFeature);
        const providerEvents = readEvents(providerDir);
        assert(!providerEvents.some(e => e.halt_reason === 'blind_visual_authorization_required'), '不得存在已退役的 blind 授权门');
        assert.strictEqual(providerEvents.filter(e => e.type === 'agent_invoke_start').length, 1, '合法 provider 后须进入正式 phase invoke');
        const providerManifest = JSON.parse(fs.readFileSync(path.join(providerDir, 'manifest.json'), 'utf-8')) as Record<string, unknown>;
        assert.strictEqual(providerManifest.allow_blind_visual, undefined, 'provider 路径不应伪造 blind 授权');
        assert.deepStrictEqual(providerManifest.visual_provider_pin, { adapter: 'claude', model: 'smoke-vision-model' });
      } finally {
        __testing_resetGoalRunnerSeams();
        process.argv = prevArgv;
        if (prevTrustDir === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR;
        else process.env.MAISON_GOAL_CHECKPOINT_DIR = prevTrustDir;
        try { process.chdir(prevCwd); } catch { /* ignore */ }
        for (const root of roots) {
          try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
        }
      }
    },
  },

  // ==========================================================================
  // F. skip 路径不调用分类；既有 binary 门禁不变
  // ==========================================================================
  {
    name: 't4 skip 路径：dry-run/无 UI phase/override/fresh cache 均不触发 probe（不调用分类）',
    run: () => {
      const root = mkTmp();
      try {
        assert.deepStrictEqual(
          decideVisionCanaryProbe({ projectRoot: root, manifest: baseManifest(), chain: ['spec'], dryRun: true }),
          { action: 'skip', reason: 'dry_run' },
        );
        assert.deepStrictEqual(
          decideVisionCanaryProbe({ projectRoot: root, manifest: baseManifest(), chain: ['ut'], dryRun: false }),
          { action: 'skip', reason: 'chain_has_no_ui_phase' },
        );
        writeLocalConfig(root, { schema_version: '1.0', vision: { image_input_override: 'none' } });
        assert.deepStrictEqual(
          decideVisionCanaryProbe({ projectRoot: root, manifest: baseManifest(), chain: ['spec'], dryRun: false }),
          { action: 'skip', reason: 'local_override_present' },
        );
        writeLocalConfig(root, { schema_version: '1.0', vision: { canary: { adapter: 'claude', verdict: 'tool_read', probed_at: new Date(Date.now() - 60_000).toISOString(), probed_via: 'goal', probe_version: VISION_CANARY_PROBE_VERSION, run_id: 'run-R2' } } });
        assert.deepStrictEqual(
          decideVisionCanaryProbe({ projectRoot: root, manifest: baseManifest(), chain: ['spec'], dryRun: false }),
          { action: 'skip', reason: 'fresh_cache_present' },
        );
        // 接线辅助：runner 只在 probe 分支记录 hard_cli_failure，且经终态发射（非 process.exit）
        const grSrc = fs.readFileSync(path.join(__dirname, '../../scripts/goal-phase-runtime.ts'), 'utf-8');
        assert(/if \(visionProbeDecision\.action === 'probe'\) \{[\s\S]*runVisionCanaryProbe/.test(grSrc), '只在 probe 分支调用 runVisionCanaryProbe');
        assert(/if \(canaryHardCliFailure\) \{[\s\S]*halt_reason: 'canary_cli_hard_failure'[\s\S]*runConcluded = true[\s\S]*return 1/.test(grSrc), 'hard_cli_failure 须经启动期 HALT 终态（非裸 process.exit）');
        assert(!/probeResult\.outcome === 'hard_cli_failure'[\s\S]{0,40}process\.exit\(1\)/.test(grSrc), '不得在 probe 块内直接 process.exit');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 't4 回归：既有 resolved-binary preflight 门禁（runGoalPreflight validateHeadlessBinaryForPlan）行为不变',
    run: () => {
      const gpSrc = fs.readFileSync(path.join(__dirname, '../../scripts/utils/goal-preflight.ts'), 'utf-8');
      // plan c4e8a1f7 T1a：plan 构造仍不带 modelPin（第 6 参 undefined）——门禁只验
      // argv[0] 可 spawn；第 7 参为 session resolved binary（null 时同旧语义现场解析）。
      assert(
        /resolveHeadlessInvokePlan\(\s*adapter,\s*cap\.capability!,\s*manifest\.unattended,\s*vars\.PROMPT,\s*vars,\s*undefined,\s*sessionBinary\.binary,\s*\)/.test(gpSrc),
        'binary-gate 的 plan 构造必须保持不带 modelPin（6 参 undefined）——门禁只验 argv[0] 可 spawn',
      );
      assert(/validateHeadlessBinaryForPlan\(adapter, plan\)/.test(gpSrc), 'binary gate 调用保持');
      // 消费侧不重复：resolveCanaryHardCliFailure 不判 binary（spawn_error/stderr 签名），
      // resolved-binary 不可 spawn 的普遍拦截仍只由 preflight 门禁承担。
      const vcSrc = fs.readFileSync(path.join(__dirname, '../../scripts/utils/vision-canary.ts'), 'utf-8');
      assert(!/headless-binary-resolve/.test(vcSrc), '硬失败分类不得重复实现 binary 门禁');
      assert(!/headlessBinarySpawnable/.test(vcSrc), '硬失败分类不得调用 binary 可 spawn 判据');
    },
  },
];

function readEvents(reportDir: string): Array<Record<string, unknown>> {
  const p = path.join(reportDir, 'events.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf-8').split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l) as Record<string, unknown>; } catch { return {}; }
  });
}

// ============================================================================
// plan 4e6fb3b6 §6（批二 t4）：获准替代模型——判断依据是**实际调用的型号**（从调用计划的 argv 取）
// ============================================================================

/** 调用计划里实际传给 adapter CLI 的型号；没有 --model = 用 adapter 的用户配置默认型号（null）。 */
function modelOf(plan: unknown): string | null {
  const argv = (plan as { argv?: string[] }).argv ?? [];
  const i = argv.indexOf('--model');
  return i >= 0 ? argv[i + 1] ?? null : null;
}

interface ModelChainProbe {
  exitCode: number;
  root: string;
  reportDir: string;
  events: Array<Record<string, unknown>>;
  canaryCalls: Array<{ model: string | null; timeoutMs: number }>;
  formalModels: Array<string | null>;
}

/** 生产 goalMain 真跑（cursor 宿主）；金丝雀与正式调用只替换调用传输，型号从调用计划读。 */
async function runModelChain(opts: {
  root: string;
  feature: string;
  ui: boolean;
  args: string[];
  canary?: (model: string | null, timeoutMs: number) => Promise<Record<string, unknown>> | Record<string, unknown>;
  formal?: (model: string | null, n: number) => Record<string, unknown>;
}): Promise<ModelChainProbe> {
  const { root, feature } = opts;
  const canaryCalls: ModelChainProbe['canaryCalls'] = [];
  const formalModels: Array<string | null> = [];
  const prevArgv = process.argv;
  const prevCwd = process.cwd();
  const prevTrustDir = process.env.MAISON_GOAL_CHECKPOINT_DIR;
  process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'trust-cp');
  try {
    __testing_setCanaryProbeInvoke((async (plan: unknown, _cwd: string, o?: { timeoutMs?: number }) => {
      const model = modelOf(plan);
      const timeoutMs = Number(o?.timeoutMs ?? -1);
      canaryCalls.push({ model, timeoutMs });
      return opts.canary
        ? await opts.canary(model, timeoutMs)
        : { exitCode: 0, stdout: 'CANNOT_SEE_IMAGE', stderr: '', command: 'fake-canary' };
    }) as never);
    __testing_setInvokeAgent((async (plan: unknown) => {
      const model = modelOf(plan);
      formalModels.push(model);
      return opts.formal?.(model, formalModels.length) ?? { exitCode: 0, stdout: 'done', stderr: '', command: 'fake-agent' };
    }) as never);
    __testing_setRunHarnessPhase((async () => ({ exitCode: 0, timedOut: false })) as never);
    __testing_setRepoLayout({ kind: 'standalone', projectRoot: root, frameworkRoot: REPO_ROOT, frameworkRel: '' } as ReturnType<typeof inferRepoLayout>);
    __testing_setDeviceReadinessGate((() => ({
      env: { HARNESS_HDC_TARGET: 'fake-device', MAISON_DEVICE_TARGET_KIND: 'physical' },
      target: { serial: 'fake-device', targetKind: 'physical' as const },
      notes: ['test seam'],
    })) as never);
    __testing_setValidateReceipt(((_hr: string, _pr: string, ph: string, feat: string) => ({
      status: 'passed' as const, receipt_path: `doc/features/${feat}/${ph}/phase-completion-receipt.md`, exit_code: 0,
    })) as never);
    process.argv = ['node', 'goal-runner.ts', '--feature', feature, '--adapter', 'cursor', '--foreground-ok', ...opts.args];
    process.chdir(root);
    clearFrameworkConfigCache();
    const exitCode = await goalMain();
    const runsDir = path.join(root, 'doc/features', feature, 'goal-runs');
    const runs = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter(n => !n.startsWith('.')) : [];
    const reportDir = runs.length > 0
      ? path.join(runsDir, runs.map(n => ({ n, t: fs.statSync(path.join(runsDir, n)).mtimeMs })).sort((a, b) => a.t - b.t).slice(-1)[0].n)
      : '';
    return { exitCode, root, reportDir, events: readEvents(reportDir), canaryCalls, formalModels };
  } finally {
    __testing_resetGoalRunnerSeams();
    process.argv = prevArgv;
    if (prevTrustDir === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR;
    else process.env.MAISON_GOAL_CHECKPOINT_DIR = prevTrustDir;
    try { process.chdir(prevCwd); } catch { /* ignore */ }
  }
}

/** 最小 cursor 宿主；ui=true 时 spec.md 声明 ui_change，启动期金丝雀真实走 probe 分支。 */
function modelHost(feature: string, approved: string[] | undefined, ui: boolean): string {
  const root = setupMinimalHost(feature);
  if (ui) {
    fs.writeFileSync(path.join(root, 'doc', 'features', feature, 'spec', 'spec.md'), '```yaml\nui_change: new_or_changed\n```\n', 'utf-8');
  }
  if (approved) {
    writeLocalConfig(root, { schema_version: '1.0', agent_adapter: 'cursor', adapters: { cursor: { approved_models: approved } } });
  }
  const { spawnSync } = require('child_process') as typeof import('child_process');
  spawnSync('git', ['add', '-A'], { cwd: root, encoding: 'utf-8' });
  spawnSync('git', ['commit', '-qm', 'model-host'], { cwd: root, encoding: 'utf-8' });
  return root;
}

/** 最近一条 run_end 连同它的会话起点一起往前平移（只为过恢复冷却，不改该段时长）。 */
function shiftLastRunEnd(reportDir: string, byMs: number): void {
  const p = path.join(reportDir, 'events.jsonl');
  const events = readEvents(reportDir);
  const i = events.map(e => e.type).lastIndexOf('run_end');
  const shift = (v: unknown): string => new Date(Date.parse(String(v)) - byMs).toISOString();
  events[i].ts = shift(events[i].ts);
  if (typeof events[i].session_started_at === 'string') events[i].session_started_at = shift(events[i].session_started_at);
  fs.writeFileSync(p, events.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
}

const UNSUPPORTED = (): Record<string, unknown> => codexTurnFailedInvoke(HOST_400_MESSAGE, 400, 'invalid_request_error');
const REQ_ARGS = (req: string): string[] => ['--requirement', req, '--start', 'spec', '--end', 'spec', '--force'];
const NON_UI_REQ = '整理后端对账脚本的日志格式。';

/** 回拨一个已结束 run 的会话：活跃时长 = consumedMs，run_end 早于现在 10 分钟（过恢复冷却）。 */
function backdateSession(reportDir: string, consumedMs: number): void {
  const p = path.join(reportDir, 'events.jsonl');
  const events = readEvents(reportDir);
  const endMs = Date.now() - 10 * 60_000;
  const lastEnd = events.map(e => e.type).lastIndexOf('run_end');
  const lastStart = events.map(e => e.type).lastIndexOf('run_start');
  assert.ok(lastEnd > lastStart && lastStart >= 0, '夹具：须是一个已结束的会话');
  events[lastStart].ts = new Date(endMs - consumedMs).toISOString();
  if (typeof events[lastStart].session_started_at === 'string') events[lastStart].session_started_at = events[lastStart].ts;
  events[lastEnd].ts = new Date(endMs).toISOString();
  fs.writeFileSync(p, events.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
}

cases.push(
  {
    name: 'P3 A8①：型号由用户显式钉死 → 不替换，交还并写明用户钉死；实际调用的型号只有钉值',
    run: async () => {
      const feature = 'model-alt-pinned';
      const root = modelHost(feature, ['gpt-alt-1'], true);
      try {
        const p = await runModelChain({
          root, feature, ui: true,
          args: [...REQ_ARGS(UI_REQ), '--adapter-model', 'gpt-user'],
          canary: () => UNSUPPORTED(),
        });
        assert.deepStrictEqual(p.canaryCalls.map(c => c.model), ['gpt-user'], JSON.stringify(p.canaryCalls));
        assert.deepStrictEqual(p.formalModels, [], '不得进入正式 phase');
        assert.ok(!p.events.some(e => e.type === 'adapter_model_substituted'), '不得有替代事件');
        const halt = p.events.find(e => e.type === 'phase_halt' && e.halt_reason === 'canary_cli_hard_failure');
        assert.ok(String(halt?.halt_guidance ?? '').includes('钉死') && String(halt?.halt_guidance ?? '').includes('gpt-user'),
          `说明须写明型号由用户钉死：${String(halt?.halt_guidance)}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'P3 A8②：未钉型号 + 获准清单 → 按序换型号、每次重探金丝雀，不支持就继续下一个；任务继续，正式调用用替代型号',
    run: async () => {
      const feature = 'model-alt-switch';
      const root = modelHost(feature, ['gpt-alt-1', 'gpt-alt-2', 'gpt-alt-3'], true);
      try {
        const p = await runModelChain({
          root, feature, ui: true, args: REQ_ARGS(UI_REQ),
          canary: (model) => (model === 'gpt-alt-2'
            ? { exitCode: 0, stdout: 'CANNOT_SEE_IMAGE', stderr: '', command: 'fake-canary' }
            : UNSUPPORTED()),
        });
        assert.deepStrictEqual(p.canaryCalls.map(c => c.model), [null, 'gpt-alt-1', 'gpt-alt-2'], JSON.stringify(p.canaryCalls));
        assert.ok(p.formalModels.length > 0 && p.formalModels.every(m => m === 'gpt-alt-2'),
          `正式调用须用替代型号：${JSON.stringify(p.formalModels)}`);
        const subs = p.events.filter(e => e.type === 'adapter_model_substituted');
        assert.deepStrictEqual(subs.map(e => [e.from, e.to, e.trigger]), [[null, 'gpt-alt-1', 'canary'], ['gpt-alt-1', 'gpt-alt-2', 'canary']]);
        const rebases = p.events.filter(e => e.type === 'manifest_identity_rebase' && e.authorized_by === 'approved_model_alternatives');
        assert.ok(rebases.length === 2 && rebases.every(e => JSON.stringify(e.changed_fields) === '["adapter_model_pin"]'),
          `身份改写只授权模型钉值：${JSON.stringify(rebases)}`);
        assert.ok(!p.events.some(e => e.type === 'phase_halt' && e.halt_reason === 'canary_cli_hard_failure'), '不得以金丝雀硬失败停机');
        const manifest = JSON.parse(fs.readFileSync(path.join(p.reportDir, 'manifest.json'), 'utf-8')) as GoalManifest;
        assert.deepStrictEqual(manifest.adapter_model_pin, { adapter: 'cursor', value: 'gpt-alt-2', source: 'approved_alternative' });
        // 恢复时身份基线是否前进到替代钉值，由 R3 用例经真实 --resume 验证（原先这里把原始事件直接交给基线函数，
        // 绕过了恢复读取链里的会话过滤——codex 批二 review R3）。
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'P3 A8③：清单为空 / 已全部试过 → 交还并列出试过的型号',
    run: async () => {
      for (const [feature, approved, want] of [
        ['model-alt-none', undefined, ['没有配置获准替代型号']],
        ['model-alt-used-up', ['gpt-alt-1'], ['已全部试过', '(adapter 默认型号)、gpt-alt-1']],
      ] as Array<[string, string[] | undefined, string[]]>) {
        const root = modelHost(feature, approved, true);
        try {
          const p = await runModelChain({ root, feature, ui: true, args: REQ_ARGS(UI_REQ), canary: () => UNSUPPORTED() });
          assert.deepStrictEqual(p.canaryCalls.map(c => c.model), [null, ...(approved ?? [])], JSON.stringify(p.canaryCalls));
          const guidance = String(p.events.find(e => e.type === 'phase_halt' && e.halt_reason === 'canary_cli_hard_failure')?.halt_guidance ?? '');
          for (const w of want) assert.ok(guidance.includes(w), `${feature} 说明须含「${w}」：${guidance}`);
          assert.deepStrictEqual(p.formalModels, [], '不得进入正式 phase');
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    },
  },
  {
    name: 'P3 A8④：其它 CLI 硬失败（spawn error）保持现状——有获准清单也不换型号',
    run: async () => {
      const feature = 'model-alt-other-hard';
      const root = modelHost(feature, ['gpt-alt-1'], true);
      try {
        const p = await runModelChain({
          root, feature, ui: true, args: REQ_ARGS(UI_REQ),
          canary: () => ({ exitCode: 1, stdout: '', stderr: '', command: 'fake', spawn_error: { code: 'ENOENT', message: 'spawn ENOENT' } }),
        });
        assert.deepStrictEqual(p.canaryCalls.map(c => c.model), [null]);
        assert.ok(!p.events.some(e => e.type === 'adapter_model_substituted'));
        assert.ok(p.events.some(e => e.type === 'phase_halt' && e.halt_reason === 'canary_cli_hard_failure'));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'P3 A8⑤ 正式调用：模型不受支持 → 换获准型号重跑同一 attempt，不消耗内容重试；实际调用型号依次为默认、替代',
    run: async () => {
      const feature = 'model-alt-formal';
      const root = modelHost(feature, ['gpt-alt-1'], false);
      try {
        const p = await runModelChain({
          root, feature, ui: false, args: REQ_ARGS(NON_UI_REQ),
          formal: (model) => (model === null ? UNSUPPORTED() : { exitCode: 0, stdout: 'done', stderr: '', command: 'fake-agent' }),
        });
        assert.deepStrictEqual(p.canaryCalls, [], '非 UI 需求不跑金丝雀');
        assert.deepStrictEqual(p.formalModels.slice(0, 2), [null, 'gpt-alt-1'], JSON.stringify(p.formalModels));
        const sub = p.events.find(e => e.type === 'adapter_model_substituted');
        assert.ok(sub && sub.trigger === 'invoke' && sub.to === 'gpt-alt-1' && sub.phase === 'spec', JSON.stringify(sub));
        assert.ok(!p.events.some(e => e.type === 'phase_halt' && e.halt_reason === 'adapter_cli_hard_failure'), '换上型号后不得以 CLI 硬失败停机');
        const firstStarts = p.events.filter(e => e.type === 'agent_invoke_start').slice(0, 2);
        assert.ok(firstStarts.length === 2, '须有第二次正式调用');
        const between = p.events.slice(p.events.indexOf(firstStarts[0]), p.events.indexOf(firstStarts[1]));
        assert.ok(!between.some(e => e.type === 'phase_verdict'), `替代重跑不产生 retry 裁决（不占内容重试）：${JSON.stringify(between.map(e => e.type))}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'P3 R3 启动期替代 → 正式会话 → 停机 → 真实 --resume：不报身份漂移并继续；恢复中"已授权预算改写 + 启动期再替代"后再恢复同样不漂移',
    run: async () => {
      const feature = 'model-alt-resume';
      const root = modelHost(feature, ['gpt-alt-1', 'gpt-alt-2'], true);
      const spawnFail = (): Record<string, unknown> =>
        ({ exitCode: 1, stdout: '', stderr: '', command: 'fake', spawn_error: { code: 'ENOENT', message: 'spawn ENOENT' } });
      const notCached = (): Record<string, unknown> => ({ exitCode: 1, stdout: '', stderr: 'boom', command: 'fake-canary' });
      const drift = (p: ModelChainProbe): unknown[] => p.events.filter(e => e.type === 'manifest_identity_drift');
      try {
        // 第一段：启动期默认型号不受支持 → 换 alt-1（金丝雀非硬失败、不写缓存）→ 正式调用 spawn 失败 → HALTED
        const first = await runModelChain({
          root, feature, ui: true, args: REQ_ARGS(UI_REQ),
          canary: (m) => (m === null ? UNSUPPORTED() : notCached()),
          formal: () => spawnFail(),
        });
        const runId = path.basename(first.reportDir);
        assert.deepStrictEqual(first.formalModels, ['gpt-alt-1'], JSON.stringify(first.formalModels));
        backdateSession(first.reportDir, 60_000);
        // 恢复 A（不带任何 override）：替代钉值有启动期授权事件 → 不漂移，继续执行
        const resumedA = await runModelChain({
          root, feature, ui: true, args: ['--resume', runId, '--force-resume'],
          canary: () => notCached(), formal: () => spawnFail(),
        });
        assert.deepStrictEqual(drift(resumedA), [], '启动期合法替代不得在恢复时被报成漂移');
        assert.deepStrictEqual(resumedA.formalModels, ['gpt-alt-1'], `恢复后须以替代型号继续执行：${JSON.stringify(resumedA.formalModels)}`);
        backdateSession(first.reportDir, 60_000);
        // 恢复 B：有权者改预算 + --override-manifest，同一次启动里 alt-1 被判不受支持 → 换 alt-2
        const manifestPath = path.join(first.reportDir, 'manifest.json');
        const m = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as GoalManifest;
        m.budget.max_total_turns = 31;
        fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n', 'utf-8');
        const resumedB = await runModelChain({
          root, feature, ui: true, args: ['--resume', runId, '--force-resume', '--override-manifest'],
          canary: (mm) => (mm === 'gpt-alt-1' ? UNSUPPORTED() : notCached()), formal: () => spawnFail(),
        });
        assert.deepStrictEqual(resumedB.formalModels, ['gpt-alt-2'], JSON.stringify(resumedB.formalModels));
        backdateSession(first.reportDir, 60_000);
        // 恢复 C（不带 override）：预算改写与恢复中替代都已授权 → 不漂移
        const resumedC = await runModelChain({
          root, feature, ui: true, args: ['--resume', runId, '--force-resume'],
          canary: () => notCached(), formal: () => spawnFail(),
        });
        assert.deepStrictEqual(drift(resumedC), [], '已授权的预算改写 + 恢复中替代之后再恢复不得漂移');
        assert.deepStrictEqual(resumedC.formalModels, ['gpt-alt-2']);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'P3 R3 已试型号含启动期记录：启动期拒绝过 alt-1 换到 alt-2，正式调用时 alt-2 也不受支持 → 选 alt-3，不再选 alt-1',
    run: async () => {
      const feature = 'model-alt-tried';
      const root = modelHost(feature, ['gpt-alt-1', 'gpt-alt-2', 'gpt-alt-3'], true);
      try {
        const p = await runModelChain({
          root, feature, ui: true, args: REQ_ARGS(UI_REQ),
          canary: (m) => (m === null || m === 'gpt-alt-1'
            ? UNSUPPORTED()
            : { exitCode: 0, stdout: 'CANNOT_SEE_IMAGE', stderr: '', command: 'fake-canary' }),
          formal: (m) => (m === 'gpt-alt-2' ? UNSUPPORTED() : { exitCode: 0, stdout: 'done', stderr: '', command: 'fake-agent' }),
        });
        assert.deepStrictEqual(p.formalModels.slice(0, 2), ['gpt-alt-2', 'gpt-alt-3'], `不得回到启动期已拒绝的 alt-1：${JSON.stringify(p.formalModels)}`);
        assert.ok(!p.formalModels.includes('gpt-alt-1'));
        assert.ok(!p.canaryCalls.slice(2).some(c => c.model === 'gpt-alt-1'), JSON.stringify(p.canaryCalls));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'P3 R4 本次调用显式给的型号恰好等于替代值：带/不带 --override-manifest 都按用户钉死处理，不调用其它型号',
    run: async () => {
      for (const withOverride of [false, true]) {
        const feature = withOverride ? 'model-alt-explicit-ovr' : 'model-alt-explicit';
        const root = modelHost(feature, ['gpt-alt-1', 'gpt-alt-2'], true);
        try {
          const first = await runModelChain({
            root, feature, ui: true, args: REQ_ARGS(UI_REQ),
            canary: (m) => (m === null ? UNSUPPORTED() : { exitCode: 0, stdout: 'CANNOT_SEE_IMAGE', stderr: '', command: 'fake-canary' }),
            formal: () => ({ exitCode: 1, stdout: '', stderr: '', command: 'fake', spawn_error: { code: 'ENOENT', message: 'spawn ENOENT' } }),
          });
          const runId = path.basename(first.reportDir);
          backdateSession(first.reportDir, 60_000);
          const resumed = await runModelChain({
            root, feature, ui: true,
            args: ['--resume', runId, '--force-resume', '--adapter-model', 'gpt-alt-1', ...(withOverride ? ['--override-manifest'] : [])],
            canary: () => UNSUPPORTED(),
            formal: () => UNSUPPORTED(),
          });
          const label = withOverride ? '带 override' : '不带 override';
          assert.ok([...resumed.formalModels, ...resumed.canaryCalls.map(c => c.model)].every(m => m === 'gpt-alt-1'),
            `${label}：不得调用其它型号：${JSON.stringify({ formal: resumed.formalModels, canary: resumed.canaryCalls })}`);
          const thisSession = resumed.events.slice(resumed.events.map(e => e.type).lastIndexOf('run_start'));
          assert.ok(!thisSession.some(e => e.type === 'adapter_model_substituted'), `${label}：不得替代`);
          const halt = resumed.events.filter(e => e.type === 'phase_halt').slice(-1)[0];
          assert.ok(String(halt?.halt_guidance ?? '').includes('用户') && String(halt?.halt_guidance ?? '').includes('gpt-alt-1'),
            `${label}：交还说明须写明型号由用户指定：${String(halt?.halt_guidance)}`);
          const pin = (JSON.parse(fs.readFileSync(path.join(first.reportDir, 'manifest.json'), 'utf-8')) as GoalManifest).adapter_model_pin;
          assert.deepStrictEqual(pin, withOverride
            ? { adapter: 'cursor', value: 'gpt-alt-1' }
            : { adapter: 'cursor', value: 'gpt-alt-1', source: 'approved_alternative' },
          `${label}：来源只在带 override 时改为用户（走身份授权路径），否则 manifest 不变`);
          assert.ok(!resumed.events.some(e => e.type === 'manifest_identity_drift'), `${label}：不得报漂移`);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    },
  },
  {
    name: 'P3 R3 反例：没有授权事件的钉值改动，恢复时仍报未授权漂移',
    run: async () => {
      const feature = 'model-alt-tamper';
      const root = modelHost(feature, ['gpt-alt-1'], true);
      try {
        const first = await runModelChain({
          root, feature, ui: true, args: REQ_ARGS(UI_REQ),
          canary: (m) => (m === null ? UNSUPPORTED() : { exitCode: 1, stdout: '', stderr: 'boom', command: 'fake-canary' }),
          formal: () => ({ exitCode: 1, stdout: '', stderr: '', command: 'fake', spawn_error: { code: 'ENOENT', message: 'spawn ENOENT' } }),
        });
        backdateSession(first.reportDir, 60_000);
        const manifestPath = path.join(first.reportDir, 'manifest.json');
        const m = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as GoalManifest;
        m.adapter_model_pin = { adapter: 'cursor', value: 'gpt-tampered', source: 'approved_alternative' };
        fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n', 'utf-8');
        await assert.rejects(
          runModelChain({ root, feature, ui: true, args: ['--resume', path.basename(first.reportDir), '--force-resume'] }),
          /漂移/,
        );
        assert.ok(readEvents(first.reportDir).some(e => e.type === 'manifest_identity_drift'), '须落 manifest_identity_drift');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'P3 A9 预算：剩余额度短于金丝雀固定时长 → 按剩余额度结束；耗尽后不试下一个型号；恢复与后继都不重置已消耗额度',
    run: async () => {
      const feature = 'model-alt-budget';
      const root = modelHost(feature, ['gpt-alt-1'], true);
      try {
        // 第一段：正式调用 spawn 失败（其它 CLI 硬失败）→ HALTED；金丝雀非硬失败（不写缓存，恢复时会重探）。
        // 金丝雀先花 1.5 秒——批二 review R1：正常进入正式会话时，run_start 之前的启动探测耗时须进已用时长。
        const first = await runModelChain({
          root, feature, ui: true, args: REQ_ARGS(UI_REQ),
          canary: async () => {
            await new Promise(r => setTimeout(r, 1_500));
            return { exitCode: 1, stdout: '', stderr: 'boom', command: 'fake' };
          },
          formal: () => ({ exitCode: 1, stdout: '', stderr: '', command: 'fake', spawn_error: { code: 'ENOENT', message: 'spawn ENOENT' } }),
        });
        const runId = path.basename(first.reportDir);
        assert.ok(first.events.some(e => e.type === 'run_end' && e.status === 'HALTED'), '夹具：第一段须 HALTED');
        {
          const start = first.events.find(e => e.type === 'run_start')!;
          const end = [...first.events].reverse().find(e => e.type === 'run_end')!;
          const counted = resolveResumedBudget(loadAuthoritativeEvents(path.join(first.reportDir, 'events.jsonl'))).priorActiveMs;
          const sinceRunStart = Date.parse(String(end.ts)) - Date.parse(String(start.ts));
          assert.ok(typeof start.session_started_at === 'string', 'run_start 须记录会话起点');
          assert.ok(counted >= sinceRunStart + 1_400,
            `启动期探测耗时须计入已用时长：counted=${counted} run_start→run_end=${sinceRunStart}`);
        }
        const manifest = JSON.parse(fs.readFileSync(path.join(first.reportDir, 'manifest.json'), 'utf-8')) as GoalManifest;
        const wallMs = resolveWallClockMs(manifest, ['spec']);
        const leftMs = 12_000;
        backdateSession(first.reportDir, wallMs - FINALIZE_RESERVE_MS - leftMs);

        // 恢复：剩余约 12 秒 → 金丝雀允许时长按剩余额度；它把额度用完后返回"不受支持" → 预算已尽，不试 gpt-alt-1
        const resumed = await runModelChain({
          root, feature, ui: true, args: ['--resume', runId, '--force-resume'],
          canary: async (_m, timeoutMs) => {
            await new Promise(r => setTimeout(r, Math.max(0, timeoutMs) + 50));
            return UNSUPPORTED();
          },
        });
        assert.strictEqual(resumed.canaryCalls.length, 1, `预算耗尽后不得再试下一个型号：${JSON.stringify(resumed.canaryCalls)}`);
        assert.ok(!resumed.events.some(e => e.type === 'adapter_model_substituted'),
          `预算耗尽后不得换型号：${JSON.stringify(resumed.events.filter(e => e.type === 'adapter_model_substituted'))}`);
        const t = resumed.canaryCalls[0].timeoutMs;
        assert.ok(t > 0 && t <= leftMs && t < 120_000, `金丝雀允许时长须取剩余额度（≤${leftMs}ms），实得 ${t}`);
        const guidance = String(resumed.events.find(e => e.type === 'phase_halt' && e.halt_reason === 'canary_cli_hard_failure')?.halt_guidance ?? '');
        assert.ok(guidance.includes('预算已尽') && guidance.includes('(adapter 默认型号)'), `说明须写明预算已尽并列出试过的型号：${guidance}`);

        // 批二 review R1：恢复里的探测提前退出（run_start 之前停机），它花掉的约 12 秒必须持久计入——
        // 再次恢复、以及起后继，都不能重新拿到探测额度（金丝雀一次都不该再被调用）。
        shiftLastRunEnd(first.reportDir, 10 * 60_000); // 只为过恢复冷却，保持该段时长不变
        const resumedAgain = await runModelChain({
          root, feature, ui: true, args: ['--resume', runId, '--force-resume'],
          canary: () => ({ exitCode: 0, stdout: 'CANNOT_SEE_IMAGE', stderr: '', command: 'fake-canary' }),
        });
        assert.deepStrictEqual(resumedAgain.canaryCalls, [], `预算耗尽后再次恢复不得重新获得探测额度：${JSON.stringify(resumedAgain.canaryCalls)}`);
        const successor = await runModelChain({
          root, feature, ui: true, args: [...REQ_ARGS(UI_REQ), '--supersede', runId],
          canary: () => ({ exitCode: 0, stdout: 'CANNOT_SEE_IMAGE', stderr: '', command: 'fake-canary' }),
        });
        assert.ok(path.basename(successor.reportDir) !== runId, '夹具：后继须是新 run');
        assert.deepStrictEqual(successor.canaryCalls, [], `后继不得重新获得探测额度：${JSON.stringify(successor.canaryCalls)}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
);

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      await c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

if (require.main === module) {
  void runAll().then((results) => {
    const failed = results.filter((r) => !r.ok);
    for (const r of results) {
      console.log(r.ok ? `PASS ${r.name}` : `FAIL ${r.name}: ${r.error}`);
    }
    process.exit(failed.length > 0 ? 1 : 0);
  });
}
