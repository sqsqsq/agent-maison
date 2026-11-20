import { freezeExistingGoalDelivery } from '../utils/existing-goal-delivery-fixture';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { prepareSessionCliProject } from '../utils/session-cli-project';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, type UnitExecutionTiming } from '../utils/unit-case-selection';
import { clearFrameworkConfigCache } from '../../config';
import {
  assertAttendedRunMode,
  buildPhaseExecuteRequest,
  defaultGoalModeFrameworkRoot,
  deriveInSessionFingerprint,
  prepareGoalModeRun,
  parseSessionReportResult,
  runGoalModeHostBridge as runGoalModeHostBridgeUnchecked,
} from '../../scripts/goal-mode-entry';
import {
  formatGoalRoundStatus,
  handoffSessionToDetached,
  resolveGoalRunModeIntent,
  type InSessionRoundResult,
} from '../../scripts/utils/goal-in-session-driver';
import { loadGoalManifestFromRun } from '../../scripts/utils/goal-manifest';
import {
  casAcquireRunOwner,
  ensureRunControl,
  readRunControl,
} from '../../scripts/utils/goal-run-control';
import { projectCanonicalLifecycle } from '../../scripts/utils/goal-canonical-lifecycle';
import { readHandoffRequest } from '../../scripts/utils/goal-handoff';
import { resolveWorkflowSpec } from '../../workflow-loader';
import {
  runGoalRuntimeChain,
  setupGoalRuntimeHost,
} from './goal-runner-testing-integrity.unit.test';

// M5A：CU Feature 路径 SSOT 与 goal 自引用排除（主干 3.1.0 矩阵用例）
import { deriveChangeUnitFeatureId } from '../../scripts/utils/change-unit-path';
import { featureRelativePath } from '../../scripts/utils/feature-identity';
import { goalFeatureSelfReferencePrefix } from '../../scripts/utils/goal-preflight';
import { dereferenceRequirementDocs } from '../../scripts/utils/fidelity-shared';
import { runRuntimeTestChild, withRuntimeTest, type RuntimeTestControl } from '../utils/runtime-test-control';
const runGoalModeHostBridge = (options: Parameters<typeof runGoalModeHostBridgeUnchecked>[0], testControl: RuntimeTestControl = {}) =>
  withRuntimeTest({ root: options.projectRoot, ...testControl }, () => runGoalModeHostBridgeUnchecked(options));


const FRAMEWORK_ROOT = path.resolve(__dirname, '../../..');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

interface TestCase { name: string; run: () => Promise<void> | void }

const cases: TestCase[] = [
  {
    name: '1804 report-result explicit file input keeps inline JSON, BOM and the run boundary',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'session-report-input-'));
      const runDir = path.join(root, 'run'); fs.mkdirSync(runDir);
      try {
        const report = { status: 'waiting', phase: 'coding', details: '真实结果' };
        const json = JSON.stringify(report);
        fs.writeFileSync(path.join(runDir, 'result.json'), '\uFEFF' + json);
        const expected = path.join(runDir, 'result.json');
        assert(JSON.stringify(parseSessionReportResult(json, runDir, expected)) === json, 'inline report changed');
        assert(JSON.stringify(parseSessionReportResult('@result.json', runDir, expected)) === json, 'BOM file report changed');
        fs.writeFileSync(path.join(runDir, 'other.json'), json);
        fs.writeFileSync(path.join(root, 'outside.json'), json);
        for (const input of ['@../outside.json', '@other.json', 'result.json', '@result.json/../missing.json']) {
          let rejected = false;
          try { parseSessionReportResult(input, runDir, expected); } catch { rejected = true; }
          assert(rejected, `invalid report input accepted: ${input}`);
        }
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: '1804 generated PowerShell 5.1 report command handles spaces and current interruption overrides historical waiting',
    run: async () => {
      if (process.platform !== 'win32') return;
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'maison cli quoting-'));
      const root = path.join(temporary, 'host with spaces');
      const oldTrust = process.env.MAISON_GOAL_CHECKPOINT_DIR;
      try {
        prepareSessionCliProject(root, 'claude', false);
        const harness = path.join(root, 'framework/harness');
        const runDir = path.join(root, 'doc/features/clamp/goal-runs/session-cli');
        const env = { ...process.env, MAISON_GOAL_CHECKPOINT_DIR: path.join(root, '.trust') };
        const args = [path.join(harness, 'node_modules/ts-node/dist/bin.js'), '--project', path.join(harness, 'tsconfig.json'),
          path.join(harness, 'scripts/goal-mode-entry.ts'), '--project-root', root, '--framework-root', path.join(root, 'framework'),
          '--feature', 'clamp', '--run-id', 'session-cli', '--adapter', 'claude', '--run-mode', 'attended', '--authorize-autonomy', '--next'];
        const next = runRuntimeTestChild({ root }, () => spawnSync(process.execPath, args, { cwd: harness, env, encoding: 'utf8', timeout: 60_000, windowsHide: true }));
        assert(next.status === 0, next.stderr + next.stdout);
        const issued = JSON.parse(next.stdout.trim());
        const request = JSON.parse(fs.readFileSync(issued.request.path, 'utf8'));
        const resultFile = path.join(path.dirname(issued.request.path), `result-e${request.context.owner.epoch}.json`);
        fs.writeFileSync(resultFile, '\uFEFF' + JSON.stringify({ status: 'waiting', phase: request.context.phase, details: 'unfinished fixture work' }));
        const psScript = path.join(temporary, 'generated command.ps1');
        fs.writeFileSync(psScript, `$PSVersionTable.PSVersion.ToString()\n${issued.next_command}\nexit $LASTEXITCODE\n`);
        const reported = runRuntimeTestChild({ root }, () => spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psScript],
          { cwd: harness, env, encoding: 'utf8', timeout: 60_000, windowsHide: true }));
        assert(reported.status === 0, reported.stderr + reported.stdout);
        assert(/^5\.1\./.test(reported.stdout), 'test must use Windows PowerShell 5.1');
        const waiting = JSON.parse(reported.stdout.trim().split(/\r?\n/).at(-1)!);
        assert(waiting.result.status === 'waiting' && waiting.exit_code === 0, JSON.stringify(waiting));
        const historicalEvents = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
        const historicalEnd = [...historicalEvents].reverse().find(event => event.type === 'run_end');
        assert(!!historicalEnd, 'the real prior waiting return must precede the current startup fault');
        const times = historicalEvents.map(event => Date.parse(event.ts));
        assert(times.every((time, index) => index === 0 || time >= times[index - 1]), 'production-written fixture history must stay chronological');
        const fault = path.join(temporary, 'startup-fault.cjs');
        fs.writeFileSync(fault, `const fs=require('fs'),append=fs.appendFileSync;let fired=false;fs.appendFileSync=function(file,data,...args){if(!fired&&String(file).endsWith('events.jsonl')&&String(data).includes('"type":"run_start"')){fired=true;throw new Error('current startup write failure');}return append.call(this,file,data,...args)};`);
        const interrupted = runRuntimeTestChild({ root, expectedInterruption: 'current startup write failure' }, () => spawnSync(process.execPath, args, { cwd: harness, env: { ...env, NODE_OPTIONS: `--require ${JSON.stringify(fault)}` }, encoding: 'utf8', timeout: 60_000, windowsHide: true }));
        assert(interrupted.status === 1, interrupted.stderr + interrupted.stdout);
        const result = JSON.parse(interrupted.stdout.trim());
        assert(result.result.status === 'fused' && result.exit_code === 1, JSON.stringify(result));
        assert(result.recovery.reason === 'uncaught_exception' && result.recovery.guidance.includes('current startup write failure'), JSON.stringify(result));
        assert(!result.next_command && !JSON.stringify(result).includes('unfinished fixture work'), 'old waiting reason or blind retry escaped');
        const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
        assert(events.at(-1).status === 'INTERRUPTED', 'runtime terminal must remain authoritative');
      } finally {
        if (oldTrust === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR; else process.env.MAISON_GOAL_CHECKPOINT_DIR = oldTrust;
        fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        clearFrameworkConfigCache();
      }
    },
  },
  {
    name: 'goal-mode CLI default framework root contains workflows',
    run: () => {
      const resolved = defaultGoalModeFrameworkRoot(path.join(FRAMEWORK_ROOT, 'harness', 'scripts'));
      assert(resolved === FRAMEWORK_ROOT, `默认 framework root 错误：${resolved}`);
      assert(fs.existsSync(path.join(resolved, 'workflows')), '默认 framework root 下必须存在 workflows/');
    },
  },
  {
    name: 'phase executor protocol carries run, attempt, owner fence and recommendation',
    run: () => {
      const request = buildPhaseExecuteRequest({
        runId: 'run-1', phase: 'spec', attemptId: 'attempt-2', ownerId: 'owner-4', ownerEpoch: 4,
      }, { action: 'run_phase' });
      assert(request.type === 'phase_execute_request', 'request type');
      assert(request.run_id === 'run-1' && request.phase === 'spec', 'run/phase identity');
      assert(request.attempt_id === 'attempt-2', 'attempt identity');
      assert(request.owner_id === 'owner-4' && request.owner_epoch === 4, 'owner fence');
      assert((request.recommendation as { action?: string }).action === 'run_phase', 'recommendation');
    },
  },
  {
    name: 'run-mode intent and user-facing status keep transport terms private',
    run: () => {
      const { userControl } = require('../../../agents/shared/native-request.cjs') as { userControl: (text: string) => { transport?: string } };
      const declarations = [
        ['我离开一会，继续跑', 'unattended'], ['不用等我', 'unattended'],
        ['遇到问题先问我', 'attended'], ['遇到问题，先问我', 'attended'], ['遇到问题停下来问我', 'attended'], ['请不要后台继续', 'attended'],
        ['帮我完成目标', null], ['我不在', null], ['我离开一会，别继续跑', null], ['我不在乎是否开后台', null],
        ['请实现后台运行按钮', null], ['应用切到后台继续播放', null], ['本次任务要求应用切到后台继续播放', null],
        ['请你在后台继续完成本次任务', 'unattended'], ['本次任务切到后台继续', 'unattended'], ['后台继续到验收', 'unattended'],
        ['帮我开发无人值守售货机的支付页面', null],
        ['新增一个无人值守模式的开关页面', null],
        ['给无人值守门店做的会员卡页面，请完成开发', null],
        ['请开发无人值守的自助服务', null],
        ['无人值守执行引擎需要添加开关', null],
        ['应用以无人值守方式执行门禁校验', null],
        ['帮我开发一个以无人值守方式执行盘点的应用', null],
        ['以无人值守方式运行的自助售货机需要支付页面', null],
        ['请不要无人值守。', 'attended'],
        ['不用问我，后台跑完', 'unattended'],
        ['请无人值守地执行本次任务。', 'unattended'],
        ['请以无人值守方式完成开发。', 'unattended'],
        ['无人值守方式完成本次任务', 'unattended'],
        ['请以无人值守方式执行本次任务', 'unattended'],
        ['请无人值守交付本次任务。', 'unattended'],
        ['无人值守自主完成开发、测试和验收，结束后汇报最终结果。', 'unattended'],
        ['无人值守完成开发和测试', 'unattended'],
        ['Please run in the background.', 'unattended'],
        ['发布件已回灌，工程已恢复到需求实施前的干净基线。请按doc/features/原始需求/1-2-银行卡/原始需求.md 及同目录参考图，从头完成 bc-openCard-2。\n无人值守，自主完成开发、测试和验收，结束后汇报最终结果。', 'unattended'],
        ['讨论如果我离开一会，继续跑', null], ['“无人值守，后台继续”', null],
        ['遇到问题不要先问我', null], ['不需要停下来', null], ['> 无人值守，后台继续', null], ['```sh\nfoo --detach\n```', null],
        ['~~~\n无人值守\n~~~', null], ['```log\n后台继续', null],
      ] as const;
      for (const [text, mode] of declarations) {
        assert(resolveGoalRunModeIntent(text) === mode && (userControl(text).transport ?? null) === mode, `unexpected intent: ${text}`);
      }
      assert(resolveGoalRunModeIntent('我会看着', true) === 'unattended', 'explicit detach remains authoritative');
      const line = formatGoalRoundStatus({ feature: 'demo', phase: 'spec', round: 1, mode: 'attended' });
      assert(!/in-session|headless|tier|batch/.test(line), `internal terms leaked: ${line}`);
      assertAttendedRunMode('attended');
      let rejected = false;
      try { assertAttendedRunMode('unattended'); } catch { rejected = true; }
      assert(rejected, 'unattended attach declaration was accepted');
    },
  },
  {
    name: 'compatibility fingerprint excludes volatile attempt identifiers',
    run: () => {
      const make = (details: string): InSessionRoundResult => ({
        status: 'executed', assessment: null,
        outcome: { status: 'failed', phase: 'coding', details }, status_line: details,
      });
      assert(deriveInSessionFingerprint(make('same')) === deriveInSessionFingerprint(make('same')),
        'stable outcome fingerprint drift');
      assert(deriveInSessionFingerprint(make('same')) !== deriveInSessionFingerprint(make('changed')),
        'semantic outcome change was ignored');
    },
  },
  {
    name: 'prepare-run uses production createGoalRun and refuses duplicate birth',
    run: () => {
      const root = setupGoalRuntimeHost('codex').root;
      try {
        const prepared = prepareGoalModeRun({
          projectRoot: root, frameworkRoot: FRAMEWORK_ROOT,
          feature: 'bc-openCard', runId: 'attended-birth', adapter: 'codex',
          requirement: 'attended birth', endPhase: 'spec',
        });
        const events = fs.readFileSync(path.join(prepared.runDir, 'events.jsonl'), 'utf8')
          .trim().split(/\r?\n/).map(line => JSON.parse(line) as { type?: string });
        assert(events.length === 1 && events[0].type === 'run_created', 'birth is not exactly once');
        assert(readRunControl(prepared.runDir, prepared.manifest.run_id)?.owner === null,
          'prepared run started owned');
        let duplicate = false;
        try {
          prepareGoalModeRun({
            projectRoot: root, frameworkRoot: FRAMEWORK_ROOT,
            feature: 'bc-openCard', runId: 'attended-birth', adapter: 'codex',
            requirement: 'duplicate', endPhase: 'spec',
          });
        } catch { duplicate = true; }
        assert(duplicate, 'duplicate birth overwrote existing run');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'prepare-run shares fresh continuation guard and existing --force override audit',
    run: () => {
      const root = setupGoalRuntimeHost('codex').root;
      try {
        const prior = prepareGoalModeRun({
          projectRoot: root, frameworkRoot: FRAMEWORK_ROOT,
          feature: 'bc-openCard', runId: 'attended-failed', adapter: 'codex',
          requirement: 'same inline request', endPhase: 'spec',
        });
        fs.appendFileSync(path.join(prior.runDir, 'events.jsonl'), `${JSON.stringify({
          ts: '2026-09-20T10:00:00.000Z', type: 'run_end', status: 'HALTED', halt_reason: 'framework_bug',
        })}\n`);
        // plan 4e6fb3b6 §7：prepare-run 先走接续决策。同一请求 → 重新接入原 run（不新建）。
        const same = prepareGoalModeRun({
          projectRoot: root, frameworkRoot: FRAMEWORK_ROOT,
          feature: 'bc-openCard', runId: 'attended-same', adapter: 'codex',
          requirement: 'same inline request', endPhase: 'spec',
        });
        assert(same.continuation.kind === 'rejoin' && same.manifest.run_id === 'attended-failed', `同一请求须重新接入原 run：${JSON.stringify(same.continuation)}`);
        // 全量回归裁定（甲）：原 run 从未正式开始过（没有执行证据可继承），改写过的需求按新开出生——不继承、不合并。
        // 有人在场入口起后继（R4）由 successor-exit 的"快照完成 run 持有范围"用例覆盖。
        const rewritten = prepareGoalModeRun({
          projectRoot: root, frameworkRoot: FRAMEWORK_ROOT,
          feature: 'bc-openCard', runId: 'attended-rewritten', adapter: 'codex',
          requirement: 'rewritten inline request', endPhase: 'spec',
        });
        assert(rewritten.continuation.kind === 'fresh' && rewritten.manifest.run_id === 'attended-rewritten' && !rewritten.manifest.successor_of,
          `从未开始过的 run + 需求不同须新开：${JSON.stringify(rewritten.continuation)}`);
        assert(rewritten.manifest.requirement === 'rewritten inline request', `新开不合并旧需求：${rewritten.manifest.requirement}`);
        const forced = prepareGoalModeRun({
          projectRoot: root, frameworkRoot: FRAMEWORK_ROOT,
          feature: 'bc-openCard', runId: 'attended-forced', adapter: 'codex',
          requirement: 'same inline request', endPhase: 'spec', forceFresh: true,
        });
        const events = fs.readFileSync(path.join(forced.runDir, 'events.jsonl'), 'utf8');
        assert(events.includes('"type":"fresh_run_override"') && events.includes('"verified_grant":false'), 'force override audit missing');
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'production host bridge executes the canonical runtime and real gate sequence',
    run: async () => {
      const root = setupGoalRuntimeHost('codex').root;
      try {
        const probe = await runGoalRuntimeChain(root, {
          viaHostBridge: true, adapter: 'codex', runId: 'host-bridge-runtime',
        });
        assert(probe.exitCode === 0, `host bridge exit=${probe.exitCode}`);
        assert(probe.invokedPhases.join(',') === 'work-unit-author', `host bridge authors=${probe.invokedPhases.join(',')}`);
        assert(probe.harnessPhases.join(',') === 'spec,plan,coding,review,ut,testing',
          'one dedicated author must still receive every actual canonical check');
        const projection = projectCanonicalLifecycle(probe.events);
        assert(projection[0]?.type === 'run_created', 'host bridge lost birth');
        assert(projection.at(-1)?.type === 'run_end', 'host bridge lost close');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'production host bridge manual authorization performs zero agent or gate invokes',
    run: async () => {
      const root = setupGoalRuntimeHost('codex').root;
      try {
        const probe = await runGoalRuntimeChain(root, {
          viaHostBridge: true,
          adapter: 'codex',
          runId: 'host-manual-zero',
          hostAuthorization: { mode: 'manual' },
        });
        assert(probe.exitCode === 2, `manual authorization must return waiting, exit=${probe.exitCode}`);
        assert(probe.invokedPhases.length === 0, `manual invoked=${probe.invokedPhases.join(',')}`);
        assert(probe.harnessPhases.length === 0, `manual gates=${probe.harnessPhases.join(',')}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'attended adapter without phase isolation executes the shared dedicated transport and preserves independent verification',
    run: async () => {
      const root = setupGoalRuntimeHost('generic').root;
      try {
        let prompt = '';
        const probe = await runGoalRuntimeChain(root, { adapter: 'generic', runId: 'host-main-context',
          freshEndPhase: 'spec', viaSessionStep: true, onAuthor: ctx => { prompt = ctx.prompt; } });
        assert(probe.exitCode === 0, JSON.stringify(probe.events.filter(event => event.type === 'phase_halt')));
        assert(probe.invokedPhases.join(',') === 'work-unit-author' && probe.harnessPhases.join(',') === 'spec', 'dedicated execution must still use the formal gate');
        assert(prompt.includes('本单元持续的专用作者') && prompt.includes('依真实授权') && prompt.includes('独立核验')
          && prompt.includes('检查通过与任务完成不同'), 'the dedicated author receives its actual scope and verification responsibilities');
        assert(probe.events.some(event => event.type === 'agent_invoke_end' && event.handoff_report), 'the public session result must be archived');
        assert(!probe.events.some(event => event.type === 'agent_process_settled'), 'main context cannot manufacture process settlement');
        assert(readRunControl(probe.reportDir, 'host-main-context')?.owner?.state === 'released', 'completed session releases its owner');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'modern attach refuses late legacy recovery when birth chain lacks the required prefix',
    run: async () => {
      const root = setupGoalRuntimeHost('codex').root;
      try {
        const prepared = prepareGoalModeRun({
          projectRoot: root, frameworkRoot: FRAMEWORK_ROOT,
          feature: 'bc-openCard', runId: 'late-recovery-corrupt', adapter: 'codex',
          requirement: 'late recovery must not alter birth', startPhase: 'coding', endPhase: 'testing',
        });
        fs.appendFileSync(path.join(prepared.runDir, 'events.jsonl'), `${JSON.stringify({
          type: 'phase_backtrack_requested',
          reason: 'legacy_fidelity_ssot',
          from_phase: 'coding',
          to_phase: 'spec',
          legacy_source: 'legacy_receipt',
          ts: new Date().toISOString(),
        })}\n`, 'utf8');
        let invoked = 0;
        const result = await runGoalModeHostBridge({
          projectRoot: root, frameworkRoot: FRAMEWORK_ROOT,
          feature: 'bc-openCard', runId: prepared.manifest.run_id,
          adapter: 'codex', runMode: 'attended',
          executePhase: async phase => {
            invoked += 1;
            return { status: 'passed', phase };
          },
        });
        assert(result.status === 'fused', JSON.stringify(result));
        assert(invoked === 0, `corrupt birth invoked=${invoked}`);
        const events = fs.readFileSync(path.join(prepared.runDir, 'events.jsonl'), 'utf8')
          .split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
        assert(events.some(event =>
          event.type === 'phase_halt' && event.reason === 'phase_chain_birth_mismatch'),
        `missing birth mismatch halt: ${JSON.stringify(events)}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'production host bridge legacy batch phase metadata cannot grant a whole work-unit request',
    run: async () => {
      const root = setupGoalRuntimeHost('codex').root;
      try {
        const probe = await runGoalRuntimeChain(root, {
          viaHostBridge: true,
          adapter: 'codex',
          runId: 'host-batch-coding',
          hostAuthorization: { mode: 'batch_authorized', through_phase: 'coding' },
        });
        assert(probe.exitCode === 2, `legacy batch boundary exit=${probe.exitCode}`);
        assert(probe.invokedPhases.length === 0 && probe.harnessPhases.length === 0,
          'a retired phase ceiling cannot silently expand into whole-unit execution authority');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'production host bridge attended transport preserves an explicitly unauthorised request without dispatch',
    run: async () => {
      const root = setupGoalRuntimeHost('codex').root;
      try {
        const probe = await runGoalRuntimeChain(root, {
          viaHostBridge: true,
          adapter: 'codex',
          runId: 'host-mode-no-grant',
          hostAuthorization: { mode: 'manual', autonomyAuthorized: false },
        });
        assert(probe.invokedPhases.length === 0 && probe.harnessPhases.length === 0,
          'transport/mode declarations do not grant execution authority');
        assert(!probe.events.some(event => event.type === 'agent_invoke_start'
          || event.type === 'run_end' && ['COMPLETED', 'CHAIN_SLICE_COMPLETED'].includes(String(event.status))),
          'missing authority cannot produce an author or completion');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'host bridge rejects run-mode and adapter drift before owner CAS or event append',
    run: async () => {
      const root = setupGoalRuntimeHost('codex').root;
      try {
        const prepared = prepareGoalModeRun({
          projectRoot: root, frameworkRoot: FRAMEWORK_ROOT,
          feature: 'bc-openCard', runId: 'attach-guard', adapter: 'codex',
          requirement: 'attach guard', endPhase: 'spec',
        });
        const eventsBefore = fs.readFileSync(path.join(prepared.runDir, 'events.jsonl'));
        for (const variant of [
          { runMode: 'unattended', adapter: 'codex' },
          { runMode: 'attended', adapter: 'claude' },
        ]) {
          let rejected = false;
          try {
            await runGoalModeHostBridge({
              projectRoot: root, frameworkRoot: FRAMEWORK_ROOT,
              feature: 'bc-openCard', runId: 'attach-guard',
              adapter: variant.adapter, runMode: variant.runMode,
              executePhase: async phase => ({ status: 'passed', phase }),
            });
          } catch { rejected = true; }
          assert(rejected, `attach guard accepted ${JSON.stringify(variant)}`);
        }
        assert(eventsBefore.equals(fs.readFileSync(path.join(prepared.runDir, 'events.jsonl'))),
          'attach guard appended an event');
        assert(readRunControl(prepared.runDir, 'attach-guard')?.owner === null,
          'attach guard mutated owner');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'compatibility driver is a thin bridge with no assess/gate/advance loop',
    run: () => {
      const driver = fs.readFileSync(path.resolve(__dirname, '../../scripts/utils/goal-in-session-driver.ts'), 'utf8');
      const compatibility = fs.readFileSync(path.resolve(__dirname, '../../scripts/utils/goal-phase-runtime.ts'), 'utf8');
      const host = fs.readFileSync(path.resolve(__dirname, '../../scripts/goal-mode-entry.ts'), 'utf8');
      assert(!/assessFeature|runHarnessPhase|phase_verdict|for\s*\(let round|while\s*\(/.test(driver),
        'driver retained private lifecycle');
      assert(!/assessFeature|runHarnessPhase|phase_verdict|for\s*\(let round|while\s*\(/.test(compatibility),
        'compatibility runtime retained private lifecycle');
      assert(host.includes('new GoalPhaseRuntime'), 'host does not delegate to canonical runtime');
    },
  },
  {
    name: 'session handoff compatibility API publishes request without consuming or releasing owner',
    run: () => {
      const root = setupGoalRuntimeHost('codex').root;
      try {
        const prepared = prepareGoalModeRun({
          projectRoot: root, frameworkRoot: FRAMEWORK_ROOT,
          feature: 'bc-openCard', runId: 'handoff-source', adapter: 'codex',
          requirement: 'handoff source', endPhase: 'spec',
        });
        const control = ensureRunControl(prepared.runDir, prepared.manifest.run_id);
        const acquired = casAcquireRunOwner(prepared.runDir, prepared.manifest.run_id, control.current_epoch, {
          kind: 'session', owner_id: 'session-owner', lease_ms: 60_000,
        });
        assert(acquired.ok, 'session owner acquisition failed');
        const eventsBefore = fs.readFileSync(path.join(prepared.runDir, 'events.jsonl'), 'utf8');
        if ('initial_design' in prepared.manifest) throw new Error('Existing scoped fixture must use a construction manifest');
        const requestId = handoffSessionToDetached({
          projectRoot: root, frameworkRoot: FRAMEWORK_ROOT,
          runDir: prepared.runDir, token: acquired.token, manifest: prepared.manifest,
          workflow: resolveWorkflowSpec(root, { frameworkRoot: FRAMEWORK_ROOT }),
          adapter: 'codex', mode: 'attended', authorization: { mode: 'goal_mode' },
        });
        assert(requestId.length > 0, 'handoff request identity missing');
        const request = readHandoffRequest(prepared.runDir);
        assert(request?.status === 'pending' && request.request_id === requestId,
          `handoff request was consumed outside runtime: ${JSON.stringify(request)}`);
        assert(readRunControl(prepared.runDir, prepared.manifest.run_id)?.owner?.state === 'active',
          'request-only compatibility API changed owner lifecycle');
        assert(fs.readFileSync(path.join(prepared.runDir, 'events.jsonl'), 'utf8') === eventsBefore,
          'request-only compatibility API appended a lifecycle or telemetry event');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'persisted manifest remains load-only at host attach boundary',
    run: () => {
      const root = setupGoalRuntimeHost('codex').root;
      try {
        const prepared = prepareGoalModeRun({
          projectRoot: root, frameworkRoot: FRAMEWORK_ROOT,
          feature: 'bc-openCard', runId: 'load-only', adapter: 'codex',
          requirement: 'load only', endPhase: 'spec',
        });
        const loaded = loadGoalManifestFromRun(root, prepared.manifest.run_id, { feature: 'bc-openCard' });
        assert(loaded.run_id === prepared.manifest.run_id, 'host attach changed run identity');
        assert(loaded.created_at === prepared.manifest.created_at, 'host attach reparsed creation time');
        assert(loaded.run_base_sha === undefined, 'spec-only run invented a git baseline');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'goal path matrix: default/custom features_dir × legacy/CU covers prepare, attach, self exclusion',
    run: async () => {
      const matrix = [
        { featuresDir: 'doc/features', feature: 'demo', physical: 'demo' },
        { featuresDir: 'requirements/features', feature: 'demo', physical: 'demo' },
        {
          featuresDir: 'doc/features',
          feature: deriveChangeUnitFeatureId('bp-demo', 'unit-a'),
          physical: 'bp-demo/unit-a',
        },
        {
          featuresDir: 'requirements/features',
          feature: deriveChangeUnitFeatureId('bp-demo', 'unit-a'),
          physical: 'bp-demo/unit-a',
        },
      ];
      for (const row of matrix) {
        // 3.0.0 统一运行时：host bridge attach 前跑完整 preflight（adapter 物化、personal 字段外迁
        // framework.local.json、toolchain、vision canary…）——复用生产级宿主夹具，只按行改 features_dir。
        const root = setupGoalRuntimeHost('codex').root;
        try {
          const cfgPath = path.join(root, 'framework.config.json');
          const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { paths: Record<string, unknown> };
          cfg.paths = {
            ...cfg.paths,
            features_dir: row.featuresDir,
            reports_dir_pattern: `${row.featuresDir}/<feature>/<phase>/reports`,
          };
          fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
          fs.mkdirSync(path.join(root, ...row.featuresDir.split('/'), ...row.physical.split('/')), { recursive: true });
          clearFrameworkConfigCache();
          freezeExistingGoalDelivery(root, row.feature);
          const prepared = prepareGoalModeRun({
            projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, feature: row.feature,
            runId: 'matrix-run', adapter: 'codex', requirement: 'matrix requirement',
            startPhase: 'spec', endPhase: 'spec',
          });
          const expectedRunSuffix = `${row.featuresDir}/${row.physical}/goal-runs/matrix-run`;
          assert(
            prepared.runDir.replace(/\\/g, '/').endsWith(expectedRunSuffix),
            `prepare 落点错误：${prepared.runDir} expected ${expectedRunSuffix}`,
          );
          assert(featureRelativePath(row.feature) === row.physical, `feature SSOT 错误：${row.feature}`);

          let invoked = false;
          const result = await runGoalModeHostBridge({
            projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, feature: row.feature,
            runId: 'matrix-run', adapter: 'codex', runMode: 'attended',
            executePhase: async (phase) => {
              invoked = true;
              return { status: 'passed', phase };
            },
          });
          assert(invoked, `attach 未执行：${row.featuresDir}/${row.physical}`);
          const events = fs.readFileSync(path.join(prepared.runDir, 'events.jsonl'), 'utf8')
            .split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
          assert(result.exit_code !== 0 && result.status === 'waiting' && result.recovery?.guidance, JSON.stringify(result));
          assert(events.filter(event => event.type === 'agent_invoke_start').length === 1
            && events.filter(event => event.type === 'harness_end').length === 1
            && !events.some(event => event.type === 'run_end' && event.status === 'INTERRUPTED'),
            'a session gate without a current conclusion must naturally yield without another author or repeated gate');

          const selfRel = `${row.featuresDir}/${row.physical}/self.md`;
          fs.writeFileSync(path.join(root, ...selfRel.split('/')), 'SHOULD_NOT_DEREFERENCE', 'utf8');
          const deref = dereferenceRequirementDocs(root, `see ${selfRel}`, {
            featuresDirRel: row.featuresDir,
            excludePrefixes: [goalFeatureSelfReferencePrefix(row.featuresDir, row.feature)],
          });
          assert(deref.resolvedPaths.length === 0 && !deref.combined.includes('SHOULD_NOT_DEREFERENCE'),
            `自引用排除失败：${row.featuresDir}/${row.physical}`);
        } finally {
          clearFrameworkConfigCache();
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    },
  },
];

export interface UnitCaseResult { name: string; ok: boolean; error?: string }

export function getCases() { return cases; }
export async function runSelectedCases(filter?: string) {
  const results: UnitCaseResult[] = [];
  const timings: UnitExecutionTiming[] = [];
  for (const testCase of cases) {
    if (!matchesUnitCase(testCase.name, filter)) continue;
    const finish = startCaseTiming([testCase.name], timings);
    try {
      await testCase.run();
      results.push({ name: testCase.name, ok: true });
    } catch (error) {
      results.push({ name: testCase.name, ok: false, error: (error as Error).stack ?? String(error) });
    } finally { finish(); }
  }
  return selectedUnitCases(results, filter, timings);
}
export async function runAll(): Promise<UnitCaseResult[]> { return (await runSelectedCases()).results; }
