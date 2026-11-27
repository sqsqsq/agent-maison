import { runUnitCasesAsync } from '../utils/unit-cases';
/**
 * plan a7c3e9d2 t3：goal 作者 prompt 注入 extension knowledge 索引。
 *  t2 buildPhasePrompt 注入位与读取指令（formatter 本身由 extension-runtime 套件覆盖）
 *  t3 manifest → 注入的 invoke 实收 prompt 的送达接线（主断言在 invoke 回调内）
 *  t4 manifest 非法：warn、不注入、invoke 仍发生  t5 extensionInputsForPhase 三态顺序
 */
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { mock } from 'node:test';
import type { UnitCaseResult } from '../run-unit';
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
import { setupMinimalHost } from '../utils/existing-goal-delivery-fixture';
import { inferRepoLayout } from '../../repo-layout';
import { clearFrameworkConfigCache } from '../../config';
import { withRuntimeTest } from '../utils/runtime-test-control';
import { loadAuthoritativeEvents } from '../../scripts/utils/goal-runner-phase';
import { readExecutionRequestOriginal } from '../../scripts/utils/session-execution-handoff';
import { changeExtension, withExtensionWrite } from '../../scripts/utils/extension-lifecycle';
import { releaseLock, tryAcquireLock } from '../../scripts/utils/goal-run-lock';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const READ_INSTRUCTION =
  "Before writing this phase's artifacts, read the knowledge inputs below that apply to this phase.";
const UNIT_READ_INSTRUCTION =
  "Before writing this work unit's artifacts, read the knowledge inputs below that apply to this work unit.";

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
  beforeAuthorSignature?: (root: string, prompt: string) => void,
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
  const write = fs.writeFileSync;
  const observePrompt = beforeAuthorSignature ? mock.method(require('fs') as typeof fs, 'writeFileSync', (...args: Parameters<typeof write>) => {
    write(...args);
    const [file, data] = args;
    if (typeof file === 'string' && path.basename(file) === 'prompt.md' && file.includes('work-unit-author')) {
      beforeAuthorSignature(root, String(data));
    }
  }) : undefined;
  process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'trust-cp');
  try {
    __testing_setInvokeAgent((async (_plan: unknown, _root: unknown, o: unknown) => {
      const phase = (o as { extraEnv?: Record<string, string> })?.extraEnv?.MAISON_GOAL_ATTEMPT_PHASE;
      if (phase === 'work-unit-author') {
        const plan = _plan as { stdin?: string; argv?: string[] };
        prompts.push(plan.stdin ?? (plan.argv ?? []).join('\n'));
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
    const exitCode = await withRuntimeTest({ root: root }, () => goalMain());
    return { exitCode, prompts, warns: warn.warns, root };
  } finally {
    observePrompt?.mock.restore();
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
    name: 'CU waits for extension management, rebuilds stale material, and signs automatically in the same run',
    run: async () => {
      const feature = 'author-extension-race';
      const body = '竞态夹具的旧知识正文';
      let oldPrompts = 0;
      let managementCompletedAt: number | undefined;
      let managementError: unknown;
      const r = await driveSpecRun(feature, {
        'doc/extensions/manifest.yaml': [
          'schema_version: "2.0"', 'name: test-race', 'provides: {}', 'bindings:', '  guide:',
          '    read: {at: feature.before_phase_work@1, phase: spec, kind: knowledge, ref: knowledge/guide.md, enabled_by_default: true}',
        ].join('\n'),
        'doc/extensions/knowledge/guide.md': body,
        'framework/specs/instance-extension-manifest.schema.yaml':
          fs.readFileSync(path.join(REPO_ROOT, 'specs/instance-extension-manifest.schema.yaml'), 'utf8'),
      }, (root, prompt) => {
        if (!prompt.includes(body)) return;
        oldPrompts++;
        const file = path.join(root, 'doc/extensions/.manifest.lock');
        const lock = tryAcquireLock(file, {});
        assert(lock);
        setTimeout(() => {
          releaseLock(file, lock.ownerId);
          try {
            const closed = withExtensionWrite(root, REPO_ROOT, () => changeExtension('disable', {
              projectRoot: root, frameworkRoot: REPO_ROOT, ability: 'guide',
            }));
            assert.equal(closed.outcomes[0]?.state, 'disabled');
            assert.equal(closed.requestIds?.length ?? 0, 0);
            managementCompletedAt = Date.now();
          } catch (error) { managementError = error; }
        }, 400);
      });
      try {
        if (managementError) throw managementError;
        assert(managementCompletedAt);
        assert.equal(oldPrompts, 1, 'old material was assembled before management closed selection');
        assert(r.prompts.length > 0 && r.prompts.every(prompt => !prompt.includes(body)));
        const runs = path.join(r.root, 'doc/features', feature, 'goal-runs');
        const runDir = path.join(runs, fs.readdirSync(runs).find(name => !name.startsWith('.'))!);
        const events = loadAuthoritativeEvents(path.join(runDir, 'events.jsonl'));
        const start = events.find(event => event.type === 'agent_invoke_start' && event.phase === 'work-unit-author');
        assert(start?.handoff_request, 'direct transport must append the first original reference');
        assert(Date.parse(start.ts!) >= managementCompletedAt, 'the start must timestamp actual issuance after the lock releases');
        assert(!events.slice(0, events.indexOf(start)).some(event => event.type === 'phase_halt' || event.type === 'run_end'));
        const issued = readExecutionRequestOriginal(runDir, start.invoke_id, events);
        assert(issued && !issued.request.context.instruction?.includes(body));
        assert(!issued.request.context.workInput?.material.segments.some(segment => JSON.stringify(segment).includes('extension_feature_bindings')));
      } finally { fs.rmSync(r.root, { recursive: true, force: true }); }
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
  {
    name: 't3 送达接线：1.1 manifest 的 audience 命中 knowledge → 注入的 invoke 实收 prompt 含标题 / 路径 / 读取指令；落盘 prompt.md 同内容',
    run: async () => {
      const feature = 'ext-author-inputs';
      const r = await driveSpecRun(feature, {
        'doc/extensions/manifest.yaml':
          'schema_version: "1.1"\nname: ext-author-inputs\nprovides:\n  knowledge:\n    - { path: knowledge/spec-author.md, summary: spec 作者要求, audience: [spec] }\n',
        'doc/extensions/knowledge/spec-author.md': '# spec 作者要求\n- 写 spec 前必读\n',
        'doc/glossary.yaml': 'schema_version: "1.0"\nterms:\n  - term: 作者前置输入\n    canonical_module: Demo\n    aliases: [送达测试]\n    easily_confused_with: [{ term: 后置核对, module: Review, disambiguation: 动笔之前发现，不等价于完成审查 }]\n',
      });
      try {
        assert(r.prompts.length > 0, `专用作者的正式 invoke 必须发生，exit=${r.exitCode}`);
        const p = r.prompts[0];
        assert(p.includes(UNIT_READ_INSTRUCTION), '读取指令句须在单元作者实收 prompt 中');
        assert(p.includes('## Instance extension inputs') && p.includes('### Knowledge index'), '主干同款标题');
        assert(p.includes('- `doc/extensions/knowledge/spec-author.md`'), '相对路径须在作者实收 prompt 中');
        assert(p.includes('canonical_module') && p.includes('动笔之前发现，不等价于完成审查'), '原生术语候选与消歧也必须送达实际作者');
        assert(!r.warns.some(w => w.includes('作者前置输入诊断')), '合法 manifest 不得 warn');
        // 辅助断言：落盘 prompt.md 同内容
        const runsDir = path.join(r.root, 'doc', 'features', feature, 'goal-runs');
        const onDisk = fs.readdirSync(runsDir)
          .filter(n => !n.startsWith('.'))
          .flatMap(n => {
            const runDir = path.join(runsDir, n);
            return fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean)
              .map(line => JSON.parse(line) as { type?: string; phase?: string; invoke_id?: string })
              .filter(event => event.type === 'agent_invoke_start' && event.phase === 'work-unit-author' && event.invoke_id)
              .map(event => path.join(runDir, 'phases', event.phase!, event.invoke_id!, 'prompt.md'));
          })
          .filter(f => fs.existsSync(f));
        assert(onDisk.length > 0, '落盘 prompt.md 须存在');
        assert(fs.readFileSync(onDisk[0], 'utf-8').includes('- `doc/extensions/knowledge/spec-author.md`'));
      } finally {
        fs.rmSync(r.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: '5247db24 actual signed Feature author receives extension text and the retained action resource location',
    run: async () => {
      const feature = 'signed-feature-extensions';
      const r = await driveSpecRun(feature, {
        'doc/extensions/manifest.yaml': [
          'schema_version: "2.0"', 'name: actual-feature-bindings', 'provides:', '  skills: [design-intake]',
          'bindings:', '  design-intake:',
          '    facts: {at: feature.before_phase_work@1, phase: spec, kind: knowledge, ref: knowledge/facts.md, enabled_by_default: true}',
          '    action: {at: feature.before_phase_work@1, phase: spec, kind: action, ref: design-intake, enabled_by_default: true}',
        ].join('\n'),
        'doc/extensions/knowledge/facts.md': '# 当前作者的唯一验收材料',
        'doc/extensions/skills/design-intake/SKILL.md': '# 已安装动作',
      });
      try {
        assert(r.prompts[0]?.includes('当前作者的唯一验收材料'));
        assert(r.prompts[0]?.includes('doc/extensions/skills/design-intake/SKILL.md'));
        const runsDir = path.join(r.root, 'doc/features', feature, 'goal-runs');
        const first = fs.readdirSync(runsDir).filter(name => !name.startsWith('.')).flatMap(name => {
          const runDir = path.join(runsDir, name);
          const events = loadAuthoritativeEvents(path.join(runDir, 'events.jsonl'));
          const start = events.find(event => event.type === 'agent_invoke_start' && event.phase === 'work-unit-author');
          return start?.invoke_id ? [readExecutionRequestOriginal(runDir, start.invoke_id, events)] : [];
        })[0];
        const segments = first?.request.context.workInput?.material.segments as Array<Record<string, unknown>> | undefined;
        const signed = segments?.find(segment => typeof segment === 'object' && 'extension_feature_bindings' in segment);
        assert.deepEqual(signed?.extension_feature_bindings, [
          { source: 'actual-feature-bindings', ability: 'design-intake', id: 'facts', at: 'feature.before_phase_work@1',
            kind: 'knowledge', ref: 'knowledge/facts.md', phase: 'spec', path: 'doc/extensions/knowledge/facts.md', delivery: 'inline' },
          { source: 'actual-feature-bindings', ability: 'design-intake', id: 'action', at: 'feature.before_phase_work@1',
            kind: 'action', ref: 'design-intake', phase: 'spec', path: 'doc/extensions/skills/design-intake/SKILL.md', delivery: 'action' },
        ]);
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
          'schema_version: "1.1"\nname: ext-bad\nprovides:\n  knowledge:\n    - { path: knowledge/missing.md, summary: 缺文件, audience: [spec] }\n',
      });
      try {
        assert(r.prompts.length > 0, `manifest 非法不得阻止作者 invoke，exit=${r.exitCode}`);
        assert(!r.prompts[0].includes('Instance extension inputs'), '非法 manifest 不注入');
        assert(
          r.warns.some(w => w.includes('作者前置输入诊断') && w.includes('--phase extensions')),
          `须 warn 并指向 --phase extensions，实际 warns=${JSON.stringify(r.warns)}`,
        );
      } finally {
        fs.rmSync(r.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 't5 extensionInputsForPhase 三态顺序：无 manifest 保留原生知识且静默；errors 出声（先于 manifestPath）；正常渲染',
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
        assert(!extensionInputsForPhase(root, 'spec').includes('Instance extension inputs'));
        assert.strictEqual(warn.warns.length, 0, '无 manifest 不出声');

        const ext = path.join(root, 'doc', 'extensions');
        fs.mkdirSync(path.join(ext, 'knowledge'), { recursive: true });
        fs.writeFileSync(path.join(ext, 'manifest.yaml'),
          'schema_version: "1.1"\nname: x\nprovides:\n  knowledge:\n    - { path: knowledge/missing.md, summary: 缺文件, audience: [spec] }\n');
        clearFrameworkConfigCache();
        assert(!extensionInputsForPhase(root, 'spec').includes('Instance extension inputs'));
        assert(warn.warns.some(w => w.includes('knowledge_missing') && w.includes('作者前置输入诊断')), 'errors 须出声');

        fs.writeFileSync(path.join(ext, 'knowledge', 'plan-author.md'), '# plan\n');
        fs.writeFileSync(path.join(ext, 'manifest.yaml'),
          'schema_version: "1.1"\nname: x\nprovides:\n  knowledge:\n    - { path: knowledge/plan-author.md, summary: plan 作者要求, audience: [plan] }\n');
        clearFrameworkConfigCache();
        const out = extensionInputsForPhase(root, 'plan');
        assert(out.includes('## Instance extension inputs'), `正常渲染，实际=${out.slice(0, 60)}`);
        assert(out.includes('- `doc/extensions/knowledge/plan-author.md`'));
      } finally {
        warn.restore();
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
];

export async function runAll(): Promise<UnitCaseResult[]> {
  return runUnitCasesAsync(cases);
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
