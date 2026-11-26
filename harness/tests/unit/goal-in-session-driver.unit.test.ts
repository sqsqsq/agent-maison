import { beginUnitCase } from '../utils/unit-cases';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { assertAttendedRunMode, buildPhaseExecuteRequest, defaultGoalModeFrameworkRoot, deriveInSessionFingerprint, parseSessionReportResult } from '../../scripts/goal-mode-entry';
import { formatGoalRoundStatus, resolveGoalRunModeIntent, type InSessionRoundResult } from '../../scripts/utils/goal-in-session-driver';

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
];

export interface UnitCaseResult { name: string; ok: boolean; error?: string }

export function getCases() { return cases; }
export async function runAll() {
  const results: UnitCaseResult[] = [];
  for (const testCase of cases) {
    const endUnitCase = beginUnitCase(testCase.name);
    if (!endUnitCase) continue;
    try {
      await testCase.run();
      results.push({ name: testCase.name, ok: true });
    } catch (error) {
      results.push({ name: testCase.name, ok: false, error: (error as Error).stack ?? String(error) });
    } finally {  endUnitCase(); }
  }
  return results;
}
