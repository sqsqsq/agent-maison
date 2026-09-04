// execution-key.unit.test.ts — plan 07a41ec6 T6：执行键、同键复用判定、稳定性统计（含失败轮）

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  FROZEN_RUN_ARTIFACTS,
  buildStabilityReport,
  computeExecutionKey,
  decideReuse,
  restoreFrozenRunArtifacts,
  refreshStabilityForNewestRun,
  writeExecutionKeyRecord,
  type ExecutionKeyInputs,
} from '../../../profiles/hmos-app/harness/execution-key';
import type { UnitCaseResult } from '../run-unit';
import { resolveAuthoritativeHylyreTracePath } from '../../scripts/utils/testing-trace-gates';

const BASE_INPUTS: ExecutionKeyInputs = {
  hap_sha256_full: 'a'.repeat(64), derived_plan_sha256: 'b'.repeat(64), device: '3UJ0', display_env: '',
  reset_mode: 'cold_restart', hylyre_version: '0.5.1', manifest_version: '0.5.1', profile: 'hmos-app',
  tool_config_sha256: 'c'.repeat(64), flags: ['--skip-assert-expected'],
};

function assertionStep(index: number, id: string, status: 'passed' | 'failed', present: boolean) {
  return {
    index, kind: 'wait_for', role: 'assertion', duration_ms: 1, device_session: null, artifacts: [], diagnostic: null, extensions: {},
    outcome: { status, observation: { kind: 'assertion', assertion_type: 'presence', facts: { observed_present: present, candidate_count: present ? 1 : 0 } } },
    selector: { request: { kind: 'by_id', value: id }, resolution: { state: present ? 'unique' : 'not_found', candidate_count: present ? 1 : 0, selected: present ? { id } : null, candidates: [] } },
  };
}

function writeRun(base: string, stamp: string, key: string, opts: { outcome: string; tc002Pass?: boolean; timingComplete?: boolean; withRecord?: boolean }) {
  const runDir = path.join(base, stamp, 'hylyre');
  fs.mkdirSync(runDir, { recursive: true });
  const tracePath = path.join(runDir, 'trace.json');
  const ok2 = opts.tc002Pass !== false;
  fs.writeFileSync(tracePath, JSON.stringify({
    schema_version: '0.4-p0', result_protocol: 'hylyre.step-outcome/1', feature: 'f', phase: 'testing', outcome: opts.outcome,
    cases: [
      { id: 'TC-001', status: '通过', steps: [assertionStep(1, 'a', 'passed', true)] },
      { id: 'TC-002', status: ok2 ? '通过' : '失败', steps: [assertionStep(1, 'b', 'passed', true), assertionStep(2, 'c', ok2 ? 'passed' : 'failed', ok2)] },
    ],
  }), 'utf-8');
  if (opts.withRecord !== false) {
    for (const f of FROZEN_RUN_ARTIFACTS) fs.writeFileSync(path.join(runDir, f.frozen), '{}', 'utf-8');
    writeExecutionKeyRecord(runDir, {
      schema_version: '1.0', execution_key: key, inputs: BASE_INPUTS, trace_path: tracePath,
      run_started_at: `2026-09-03T0${stamp.slice(-1)}:00:00.000Z`, outcome: opts.outcome, trace_sha256: null,
      timing_complete: opts.timingComplete !== false,
      frozen_files: FROZEN_RUN_ARTIFACTS.map(f => f.frozen),
    });
  }
  return runDir;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: '执行键：输入相同（flags 顺序无关）→ 同键；任一输入变（HAP/派生计划/设备/复位/版本/flags）→ 不同键',
    run: () => {
      const k = computeExecutionKey(BASE_INPUTS);
      assert.strictEqual(computeExecutionKey({ ...BASE_INPUTS, flags: [...BASE_INPUTS.flags].reverse() }), k);
      for (const over of [
        { hap_sha256_full: 'd'.repeat(64) }, { derived_plan_sha256: 'e'.repeat(64) }, { device: 'other' },
        { reset_mode: 'warm' }, { hylyre_version: '0.5.2' }, { flags: ['--skip-assert-expected', 'HARNESS_DEVICE_TEST_COLD_RESTART=0'] },
      ] as Array<Partial<ExecutionKeyInputs>>) {
        assert.notStrictEqual(computeExecutionKey({ ...BASE_INPUTS, ...over }), k, JSON.stringify(over));
      }
    },
  },
  {
    name: '复用判定：只看最新 execution-key attempt；同键成功完整才复用，更新的别键/同键失败/timing 不完整均不复用；无键目录不参与；复用回填冻结产物',
    run: () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-exec-key-'));
      try {
        const key = computeExecutionKey(BASE_INPUTS);
        writeRun(base, '20260903-000001', key, { outcome: 'success' });
        assert.ok(decideReuse(base, key).reusable, '同键成功应复用');
        assert.strictEqual(decideReuse(base, 'other-key').reusable, null, '不同键不复用');
        writeRun(base, '20260903-000002', key, { outcome: 'failed', tc002Pass: false });
        const laterFailed = decideReuse(base, key);
        assert.strictEqual(laterFailed.reusable, null, '更晚失败不得复用更早成功');
        assert.ok(/outcome=failed/.test(laterFailed.reason), laterFailed.reason);
        writeRun(base, '20260903-000003', 'another', { outcome: 'success' });
        const laterOtherKey = decideReuse(base, key);
        assert.strictEqual(laterOtherKey.reusable, null, '更新的别键必须阻止复用旧 A');
        assert.ok(/其他 execution key/.test(laterOtherKey.reason), laterOtherKey.reason);
        writeRun(base, '20260903-000004', key, { outcome: 'success', timingComplete: false });
        assert.ok(/timing/.test(decideReuse(base, key).reason));
        writeRun(base, '20260903-000005', key, { outcome: 'success' });
        assert.strictEqual(decideReuse(base, key).reusable?.dirStamp, '20260903-000005');
        writeRun(base, '20260903-000006', key, { outcome: 'success', withRecord: false });
        assert.strictEqual(decideReuse(base, key).reusable?.dirStamp, '20260903-000005', '更新的无键目录不参与最新真实 attempt 判断');
        assert.strictEqual(resolveAuthoritativeHylyreTracePath(base), path.join(base, '20260903-000005', 'hylyre', 'trace.json'), '报告/verifier 共用最新真实 attempt，不选无键目录');
        const stabilityPath = refreshStabilityForNewestRun(base)!;
        assert.strictEqual(JSON.parse(fs.readFileSync(stabilityPath, 'utf8')).execution_key, key);
        const top = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-exec-top-'));
        try {
          const restored = restoreFrozenRunArtifacts(path.join(base, '20260903-000005', 'hylyre'), top);
          assert.deepStrictEqual(restored.sort(), ['device-test-run.meta.json', 'device-test-timing.json'], '复用须回填冻结的 timing/meta');
        } finally {
          fs.rmSync(top, { recursive: true, force: true });
        }
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    },
  },
  {
    name: '稳定性：同键分组含失败轮，基线=最新轮；一致轮数与首个分歧 step 如实；不同键的 run 不入组',
    run: () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-exec-key-'));
      try {
        const key = computeExecutionKey(BASE_INPUTS);
        writeRun(base, '20260903-000001', key, { outcome: 'success' });
        writeRun(base, '20260903-000002', key, { outcome: 'failed', tc002Pass: false });
        writeRun(base, '20260903-000003', 'other', { outcome: 'success' });
        writeRun(base, '20260903-000004', key, { outcome: 'success' });
        const report = buildStabilityReport(base, key, () => new Date('2026-09-03T01:00:00.000Z'));
        assert.strictEqual(report.runs.length, 3, '同键 3 轮（含 1 轮失败），别的键不入组');
        const tc1 = report.rows.find(r => r.tc_id === 'TC-001')!;
        const tc2 = report.rows.find(r => r.tc_id === 'TC-002')!;
        assert.deepStrictEqual([tc1.rounds, tc1.consistent, tc1.first_divergent_step], [3, 3, null]);
        assert.deepStrictEqual([tc2.rounds, tc2.consistent, tc2.first_divergent_step], [3, 2, 2], JSON.stringify(tc2));
        assert.deepStrictEqual(tc2.outcomes, ['通过', '失败', '通过'], '失败轮不被过滤');
        const p = refreshStabilityForNewestRun(base);
        assert.ok(p && fs.existsSync(p), '按最新 run 的键刷新 stability.json');
        const doc = JSON.parse(fs.readFileSync(p!, 'utf-8')) as { execution_key: string; rows: unknown[] };
        assert.strictEqual(doc.execution_key, key);
        assert.strictEqual(doc.rows.length, 2);
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (err) {
      results.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  }
  return results;
}
