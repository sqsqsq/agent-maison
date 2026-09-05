/**
 * plan a7c3e9d2 t3：goal 作者 prompt 注入 extension knowledge 索引。
 *  t1 formatter（分支 1.0 语义）      t2 buildPhasePrompt 注入位与读取指令
 *  t3 manifest → 注入的 invoke 实收 prompt 的送达接线（主断言在 invoke 回调内）
 *  t4 manifest 非法：warn、不注入、invoke 仍发生  t5 extensionInputsForPhase 三态顺序
 */
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { UnitCaseResult } from '../run-unit';
import { formatExtensionPhasePrompt } from '../../scripts/utils/extension-runtime';
import type { ExtensionBundle } from '../../scripts/utils/types';
import type { GoalManifest } from '../../scripts/utils/goal-manifest';
import {
  __testing_resetGoalRunnerSeams,
  __testing_setDeviceReadinessGate,
  __testing_setInvokeAgent,
  __testing_setRepoLayout,
  __testing_setRunHarnessPhase,
  __testing_setValidateReceipt,
  buildPhasePrompt,
  extensionInputsForPhase,
  main as goalMain,
} from '../../scripts/goal-runner';
import { setupMinimalHost } from '../helpers/goal-run-driver';
import { inferRepoLayout } from '../../repo-layout';
import { clearFrameworkConfigCache } from '../../config';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const READ_INSTRUCTION =
  "Before writing this phase's artifacts, read the instance extension inputs below that apply to this phase.";

const MINIMAL_MANIFEST: GoalManifest = {
  schema_version: '1.0',
  start_phase: 'spec',
  end_phase: 'spec',
  feature: 'demo-feature',
  requirement: 'test req',
  adapter: 'cursor',
  budget: {
    max_retries_per_phase: 2,
    max_total_turns: 30,
    wall_clock_minutes: 480,
    max_transient_api_retries: 3,
  },
  dependency_policy: {
    deferrable_blocking_classes: ['externalBlocked'],
    deferrable_failure_kinds: ['device_blocked'],
    propagate_to_downstream: true,
  },
  unattended: {
    write_mode: 'workspace-write',
    approval_mode: 'never',
    timeout_seconds: 3600,
  },
  run_id: '20260101T000000Z',
  report_dir: 'doc/features/demo-feature/goal-runs/20260101T000000Z',
  created_at: '2026-01-01T00:00:00.000Z',
};

function fakeBundle(root: string, over: Partial<ExtensionBundle>): ExtensionBundle {
  return {
    rootDir: path.join(root, 'doc', 'extensions'),
    manifestPath: path.join(root, 'doc', 'extensions', 'manifest.yaml'),
    skills: [],
    knowledgePaths: [],
    hooks: {},
    extensionCapabilities: {},
    phaseRuleOverlayPaths: {},
    skillAssetAbsPaths: {},
    errors: [],
    ...over,
  };
}

function captureWarn(): { warns: string[]; restore: () => void } {
  const warns: string[] = [];
  const prev = console.warn;
  console.warn = (...args: unknown[]) => {
    warns.push(args.map(String).join(' '));
  };
  return { warns, restore: () => { console.warn = prev; } };
}

/**
 * 驱动一次 spec-only goal run（seam 布置同 goal-canary-hard-cli-d7f3a9c4）；主断言材料是
 * 注入的 invoke 回调内读到的 prompt——先写盘再 invoke（runtime :6639），只查落盘不够，
 * 其后仍可能在能力检查处停下而未调作者。
 */
async function driveSpecRun(
  feature: string,
  extFiles: Record<string, string>,
): Promise<{ exitCode: number; prompts: string[]; warns: string[]; root: string }> {
  const root = setupMinimalHost(feature);
  for (const [rel, body] of Object.entries(extFiles)) {
    const abs = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, 'utf-8');
  }
  const { spawnSync } = require('child_process') as typeof import('child_process');
  spawnSync('git', ['add', '-A'], { cwd: root, encoding: 'utf-8' });
  spawnSync('git', ['commit', '-qm', 'ext'], { cwd: root, encoding: 'utf-8' });

  const prompts: string[] = [];
  const prevArgv = process.argv;
  const prevCwd = process.cwd();
  const prevTrustDir = process.env.MAISON_GOAL_CHECKPOINT_DIR;
  const warn = captureWarn();
  process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'trust-cp');
  try {
    __testing_setInvokeAgent((async (_plan: unknown, _root: unknown, o: unknown) => {
      const logPath = String((o as { outputLogPath?: string })?.outputLogPath ?? '');
      const phase = /\/phases\/([a-z-]+)\//.exec(logPath.split(path.sep).join('/'))?.[1] ?? '';
      if (phase === 'spec') {
        // 作者实收的 prompt 文件与 agent-output.log 同目录（runtime :6139 / :6679）
        const promptPath = path.join(path.dirname(logPath), 'prompt.md');
        prompts.push(fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf-8') : '');
      }
      return { exitCode: 0, stdout: 'done', stderr: '', command: 'fake-agent' };
    }) as never);
    __testing_setRunHarnessPhase((async () => ({ exitCode: 0, timedOut: false })) as never);
    __testing_setRepoLayout({
      kind: 'standalone', projectRoot: root, frameworkRoot: REPO_ROOT, frameworkRel: '',
    } as ReturnType<typeof inferRepoLayout>);
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
      '--feature', feature,
      '--requirement', '作者前置输入送达测试：非 UI 需求',
      '--start', 'spec', '--end', 'spec',
      '--adapter', 'cursor',
      '--foreground-ok', '--force',
    ];
    process.chdir(root);
    clearFrameworkConfigCache();
    const exitCode = await goalMain();
    return { exitCode, prompts, warns: warn.warns, root };
  } finally {
    __testing_resetGoalRunnerSeams();
    process.argv = prevArgv;
    process.chdir(prevCwd);
    if (prevTrustDir === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR;
    else process.env.MAISON_GOAL_CHECKPOINT_DIR = prevTrustDir;
    warn.restore();
  }
}

const cases: Array<{ name: string; run: () => Promise<void> }> = [
  {
    name: 't1 formatter：1.0 knowledgePaths → 主干同款标题与相对路径；errors 非空 / undefined / 空 knowledge → 空串',
    run: async () => {
      const root = path.resolve('a7c3e9d2-proj');
      const b = fakeBundle(root, {
        knowledgePaths: [
          path.join(root, 'doc', 'extensions', 'knowledge', 'spec-author.md'),
          path.join(root, 'doc', 'extensions', 'knowledge', 'plan-author.md'),
        ],
      });
      const lines = formatExtensionPhasePrompt(b, 'spec', root).split('\n');
      assert.strictEqual(lines[0], '## Instance extension inputs');
      assert(lines.includes('### Knowledge index'), '须有 Knowledge index 小节');
      assert(lines.includes('- `doc/extensions/knowledge/spec-author.md`'), '路径须为相对项目根的 posix 形态');
      assert(lines.includes('- `doc/extensions/knowledge/plan-author.md`'));
      assert.strictEqual(
        formatExtensionPhasePrompt(fakeBundle(root, {
          knowledgePaths: [path.join(root, 'x.md')],
          errors: [{ severity: 'MAJOR', code: 'knowledge_missing', message: 'y' }],
        }), 'spec', root),
        '',
        'errors 非空 → 空串（出声归调用入口）',
      );
      assert.strictEqual(formatExtensionPhasePrompt(undefined, 'spec', root), '');
      assert.strictEqual(formatExtensionPhasePrompt(fakeBundle(root, {}), 'spec', root), '', 'knowledge 为空 → 空串');
    },
  },
  {
    name: 't2 buildPhasePrompt：extensionInputs 注入在 Skill absolute path 之后，读取指令先于索引；缺省不注入',
    run: async () => {
      const inputs = '## Instance extension inputs\n\n### Knowledge index\n\n- `doc/extensions/knowledge/spec-author.md`';
      const prompt = buildPhasePrompt(
        MINIMAL_MANIFEST, REPO_ROOT, 'spec', REPO_ROOT, [],
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        inputs,
      );
      const iSkill = prompt.indexOf('Skill absolute path:');
      const iInstr = prompt.indexOf(READ_INSTRUCTION);
      const iIndex = prompt.indexOf('## Instance extension inputs');
      assert(
        iSkill >= 0 && iInstr > iSkill && iIndex > iInstr,
        `顺序应为 skill 路径 < 读取指令 < 索引，实际 ${iSkill}/${iInstr}/${iIndex}`,
      );
      assert(prompt.includes('- `doc/extensions/knowledge/spec-author.md`'));
      const clean = buildPhasePrompt(MINIMAL_MANIFEST, REPO_ROOT, 'spec', REPO_ROOT, []);
      assert(!clean.includes('Instance extension inputs') && !clean.includes(READ_INSTRUCTION), '缺省不注入');
    },
  },
  // cp→main: 本用例（t3）的 1.0 manifest 在主干 formatter 下不注入——cp 时改为 1.1 manifest（knowledge 对象 + audience: [spec]），保留"路径与读取指令出现在作者实收 prompt"的送达断言；t5 的正常渲染样例同样改为 1.1 manifest（主干对 1.0 返回空串）；t1 的 1.0 断言 cp 时删除；fakeBundle 缺主干 ExtensionBundle 新增的必填字段（manifestVersion / featurePhases / knowledge / phaseBindings / mcpActions 等），cp 时补齐或改用主干 loader 产出的真 bundle，否则 TS2322。
  {
    name: 't3 送达接线：1.0 manifest 的 knowledge → 注入的 invoke 实收 prompt 含标题 / 路径 / 读取指令；落盘 prompt.md 同内容',
    run: async () => {
      const feature = 'ext-author-inputs';
      const r = await driveSpecRun(feature, {
        'doc/extensions/manifest.yaml':
          'schema_version: "1.0"\nname: ext-author-inputs\nprovides:\n  knowledge:\n    - knowledge/spec-author.md\n',
        'doc/extensions/knowledge/spec-author.md': '# spec 作者要求\n- 写 spec 前必读\n',
      });
      try {
        assert(r.prompts.length > 0, `spec 阶段的正式 invoke 必须发生（作者被调用），exit=${r.exitCode}`);
        const p = r.prompts[0];
        assert(p.includes(READ_INSTRUCTION), '读取指令句须在作者实收 prompt 中');
        assert(p.includes('## Instance extension inputs') && p.includes('### Knowledge index'), '主干同款标题');
        assert(p.includes('- `doc/extensions/knowledge/spec-author.md`'), '相对路径须在作者实收 prompt 中');
        assert(!r.warns.some(w => w.includes('作者前置输入未注入')), '合法 manifest 不得 warn');
        // 辅助断言：落盘 prompt.md 同内容
        const runsDir = path.join(r.root, 'doc', 'features', feature, 'goal-runs');
        const onDisk = fs.readdirSync(runsDir)
          .filter(n => !n.startsWith('.'))
          .map(n => path.join(runsDir, n, 'phases', 'spec', 'prompt.md'))
          .filter(f => fs.existsSync(f));
        assert(onDisk.length > 0, '落盘 prompt.md 须存在');
        assert(fs.readFileSync(onDisk[0], 'utf-8').includes('- `doc/extensions/knowledge/spec-author.md`'));
      } finally {
        fs.rmSync(r.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 't4 manifest 非法（knowledge 文件不存在）：warn 指向 --phase extensions，不注入，invoke 仍发生',
    run: async () => {
      const r = await driveSpecRun('ext-author-inputs-bad', {
        'doc/extensions/manifest.yaml':
          'schema_version: "1.0"\nname: ext-bad\nprovides:\n  knowledge:\n    - knowledge/missing.md\n',
      });
      try {
        assert(r.prompts.length > 0, `manifest 非法不得阻止作者 invoke，exit=${r.exitCode}`);
        assert(!r.prompts[0].includes('Instance extension inputs'), '非法 manifest 不注入');
        assert(
          r.warns.some(w => w.includes('作者前置输入未注入') && w.includes('--phase extensions')),
          `须 warn 并指向 --phase extensions，实际 warns=${JSON.stringify(r.warns)}`,
        );
      } finally {
        fs.rmSync(r.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 't5 extensionInputsForPhase 三态顺序：无 manifest 静默空；errors 出声（先于 manifestPath）；正常渲染',
    run: async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a7c3e9d2-'));
      fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
        schema_version: '1.1',
        project_name: 'x',
        project_profile: { name: 'generic' },
        paths: { features_dir: 'doc/features' },
      }));
      const warn = captureWarn();
      try {
        clearFrameworkConfigCache();
        assert.strictEqual(extensionInputsForPhase(root, 'spec'), '');
        assert.strictEqual(warn.warns.length, 0, '无 manifest 不出声');

        const ext = path.join(root, 'doc', 'extensions');
        fs.mkdirSync(path.join(ext, 'knowledge'), { recursive: true });
        fs.writeFileSync(path.join(ext, 'manifest.yaml'),
          'schema_version: "1.0"\nname: x\nprovides:\n  knowledge:\n    - knowledge/missing.md\n');
        clearFrameworkConfigCache();
        assert.strictEqual(extensionInputsForPhase(root, 'spec'), '');
        assert(warn.warns.some(w => w.includes('knowledge_missing') && w.includes('作者前置输入未注入')), 'errors 须出声');

        fs.writeFileSync(path.join(ext, 'knowledge', 'plan-author.md'), '# plan\n');
        fs.writeFileSync(path.join(ext, 'manifest.yaml'),
          'schema_version: "1.0"\nname: x\nprovides:\n  knowledge:\n    - knowledge/plan-author.md\n');
        clearFrameworkConfigCache();
        const out = extensionInputsForPhase(root, 'plan');
        assert(out.startsWith('## Instance extension inputs'), `正常渲染，实际=${out.slice(0, 60)}`);
        assert(out.includes('- `doc/extensions/knowledge/plan-author.md`'));
      } finally {
        warn.restore();
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
];

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
