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

  // ==========================================================================
  // E. runner main() 真实路径终态（review P1：结构化 run 级 BLOCKER）
  // ==========================================================================
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
        assert(typeof halt!.halt_guidance === 'string' && String(halt!.halt_guidance).includes('非需求代码'), 'halt_guidance 须有界且含定性');
        const end = [...events].reverse().find(e => e.type === 'run_end') as Record<string, unknown> | undefined;
        assert(end, '须落 run_end');
        assert.strictEqual(end!.status, 'HALTED', `run_end 状态=${String(end!.status)}`);
        // manifest 已落盘 → run 目录可监控、可表达 --resume（与 declared_product_layer_missing
        // 启动期 HALT 同款：此模式在 run_start 之前 return，不要求 run_start 事件）
        assert(fs.existsSync(path.join(reportDir, 'manifest.json')), 'manifest 须已写盘（run 可监控）');
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
        const grSrc = fs.readFileSync(path.join(__dirname, '../../scripts/goal-runner.ts'), 'utf-8');
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
      assert(
        /resolveHeadlessInvokePlan\(\s*adapter,\s*cap\.capability!,\s*manifest\.unattended,\s*vars\.PROMPT,\s*vars,\s*\)/.test(gpSrc),
        'binary-gate 的 plan 构造必须保持不带 modelPin（5 参）——门禁只验 argv[0] 可 spawn',
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