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
  listExecutionKeyRuns,
  restoreFrozenRunArtifacts,
  utFrozenRunArtifacts,
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
  {
    // V8（plan 5e1c7a93 D3）：冻结件分两组——派生组缺失走重建通道（仍返回该 run），
    // 执行事实组缺失直接拒绝复用。只丢一份 timing 副本不得再落回真机重跑。
    name: 'V8 冻结件分组：删派生组→evidenceRebuildRequired 仍返回该 run；删执行事实组→拒绝复用并出词',
    run: () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-exec-group-'));
      try {
        const key = computeExecutionKey(BASE_INPUTS);
        const runDir = writeRun(base, '20260903-000001', key, { outcome: 'success' });
        assert.ok(decideReuse(base, key).reusable, '前置：齐备时可复用');
        assert.strictEqual(decideReuse(base, key).evidenceRebuildRequired, undefined, '齐备时不该要求重建');

        // ③真实删掉派生组文件
        fs.rmSync(path.join(runDir, 'frozen.device-test-timing.json'));
        const derivedGone = decideReuse(base, key);
        assert.ok(derivedGone.reusable, '派生组缺失仍应返回该 run（走重建通道）');
        assert.strictEqual(derivedGone.evidenceRebuildRequired, true, derivedGone.reason);
        assert.ok(/派生冻结件缺失/.test(derivedGone.reason), derivedGone.reason);

        // ④真实删掉执行事实组文件
        fs.rmSync(path.join(runDir, 'frozen.device-test-run.meta.json'));
        const execGone = decideReuse(base, key);
        assert.strictEqual(execGone.reusable, null, '执行事实组缺失必须拒绝复用');
        assert.ok(/执行事实冻结件缺失/.test(execGone.reason), execGone.reason);

        // ①timing_complete=false → 同样只是重建通道，不再直接拒绝
        writeRun(base, '20260903-000002', key, { outcome: 'success', timingComplete: false });
        const rebuild = decideReuse(base, key);
        assert.ok(rebuild.reusable, 'timing_complete=false 不得再直接拒绝复用');
        assert.strictEqual(rebuild.evidenceRebuildRequired, true, rebuild.reason);
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    },
  },
  {
    // codex review 第 1 轮 #3：记录覆盖必须是**原子替换**。原地 writeFileSync 先截断——
    // 失败轮覆盖前置 'started' 时若写到一半挂掉（磁盘满 / 进程被杀），盘上留下空文件或半份
    // JSON，listExecutionKeyRuns 把它当损坏记录跳过，最新一条又变回**更早的成功** → 洗绿。
    name: '记录写出原子替换：写失败保留完整的 started 记录，旧成功仍不被复用（codex #3）',
    run: () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-exec-atomic-'));
      try {
        const key = computeExecutionKey(BASE_INPUTS);
        // ①上一轮的同键成功
        writeRun(base, '20260903-000001', key, { outcome: 'success' });
        assert.ok(decideReuse(base, key).reusable, '前置：上一轮成功本来可复用');

        // ②本轮 dispatch 之前先落一条非成功前置记录
        const runDir = path.join(base, '20260903-000002', 'hylyre');
        writeExecutionKeyRecord(runDir, {
          schema_version: '1.0', execution_key: key, inputs: BASE_INPUTS, trace_path: '',
          run_started_at: '2026-09-03T02:00:00.000Z', outcome: 'started', trace_sha256: null,
          timing_complete: false, frozen_files: [],
        });
        const recordPath = path.join(runDir, 'execution-key.json');
        const before = fs.readFileSync(recordPath, 'utf-8');

        // ③覆盖时"截断之后才失败"：模拟 ENOSPC / 进程被杀。原地写会把目标清空，
        //   原子替换只会把临时件清空，目标一字不动。
        // 生产代码经 CommonJS 的 fs 模块导出对象取 writeFileSync，故补丁打在它身上
        const fsMod = require('fs') as { writeFileSync: typeof fs.writeFileSync };
        const realWrite = fsMod.writeFileSync;
        fsMod.writeFileSync = ((file: fs.PathOrFileDescriptor) => {
          realWrite(file, '', 'utf-8');
          throw new Error('ENOSPC (simulated)');
        }) as typeof fs.writeFileSync;
        try {
          assert.throws(() => writeExecutionKeyRecord(runDir, {
            schema_version: '1.0', execution_key: key, inputs: BASE_INPUTS, trace_path: '',
            run_started_at: '2026-09-03T02:00:01.000Z', outcome: 'failed', trace_sha256: null,
            timing_complete: false, frozen_files: [],
          }), '写失败必须如实抛出，不得静默吞掉');
        } finally {
          fsMod.writeFileSync = realWrite;
        }

        assert.strictEqual(fs.readFileSync(recordPath, 'utf-8'), before, '写失败不得截断已有记录');
        assert.strictEqual(JSON.parse(before).outcome, 'started');
        assert.ok(
          !fs.readdirSync(runDir).some(f => f.endsWith('.tmp')),
          `临时件不得残留：${fs.readdirSync(runDir).join(',')}`,
        );

        // ④下一轮：最新一条仍是完整的 started → 拒绝复用，旧成功不被洗绿
        const next = decideReuse(base, key, { excludeRunDir: path.join(base, '20260903-000003', 'hylyre') });
        assert.strictEqual(next.reusable, null, '截断/写失败之后绝不能回头复用更早的成功');
        assert.ok(/outcome=started/.test(next.reason), next.reason);
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    },
  },
  {
    // plan 5e1c7a93 D2：leg 决定 run 目录段名；UT 冻结件逐模块展开且全部属执行事实组；
    // excludeRunDir 让"记录前置"的本轮 'started' 记录不把自己算成最新。
    name: 'UT leg：目录段名/逐模块冻结件/记录前置排除自身（5e1c7a93 D2）',
    run: () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-exec-ut-'));
      try {
        const key = computeExecutionKey(BASE_INPUTS);
        const mods = ['Beta', 'Alpha'];
        const artifacts = utFrozenRunArtifacts(mods);
        assert.deepStrictEqual(
          artifacts.map(a => a.frozen),
          ['frozen.ut-result.Alpha.json', 'frozen.hdc-test.Alpha.log', 'frozen.ut-result.Beta.json', 'frozen.hdc-test.Beta.log'],
          '逐模块冻结件按模块名排序展开',
        );
        assert.ok(artifacts.every(a => a.group === 'execution'), 'UT 冻结件全部属执行事实组');

        const okRun = path.join(base, '20260903-000001', 'ut');
        fs.mkdirSync(okRun, { recursive: true });
        for (const a of artifacts) fs.writeFileSync(path.join(okRun, a.frozen), '{}', 'utf-8');
        writeExecutionKeyRecord(okRun, {
          schema_version: '1.0', execution_key: key, inputs: BASE_INPUTS, trace_path: '',
          run_started_at: '2026-09-03T01:00:00.000Z', outcome: 'success', trace_sha256: null,
          timing_complete: true, frozen_files: artifacts.map(a => a.frozen),
        });
        // hylyre leg 看不到 ut 目录，反之亦然
        assert.strictEqual(listExecutionKeyRuns(base, 'hylyre').length, 0, 'ut 目录不得进 hylyre leg');
        assert.strictEqual(listExecutionKeyRuns(base, 'ut').length, 1);
        assert.ok(decideReuse(base, key, { leg: 'ut', artifacts }).reusable, 'UT 同键成功且逐模块冻结件齐备应复用');
        // trace_path 为空串（UT 无 trace）不得被判成"trace 缺失"
        assert.ok(!/trace 缺失/.test(decideReuse(base, key, { leg: 'ut', artifacts }).reason));

        // 记录前置：本轮先落一条 'started'，它是最新的——不排除自身则复用恒不命中；
        // 排除自身后仍能命中上一轮成功，而**下一轮**会看到它并拒绝复用（抛异常轮的洗绿口）。
        const selfRun = path.join(base, '20260903-000002', 'ut');
        fs.mkdirSync(selfRun, { recursive: true });
        writeExecutionKeyRecord(selfRun, {
          schema_version: '1.0', execution_key: key, inputs: BASE_INPUTS, trace_path: '',
          run_started_at: '2026-09-03T02:00:00.000Z', outcome: 'started', trace_sha256: null,
          timing_complete: false, frozen_files: [],
        });
        const withoutExclude = decideReuse(base, key, { leg: 'ut', artifacts });
        assert.strictEqual(withoutExclude.reusable, null, '未排除自身时最新是本轮 started');
        assert.ok(/outcome=started/.test(withoutExclude.reason), withoutExclude.reason);
        assert.strictEqual(
          decideReuse(base, key, { leg: 'ut', artifacts, excludeRunDir: selfRun }).reusable?.dirStamp,
          '20260903-000001',
          '排除自身后应命中上一轮成功',
        );
        // 未被覆盖的 started（抛异常/写不出结果的那轮）必须挡住更早的成功
        const nextRound = path.join(base, '20260903-000003', 'ut');
        assert.strictEqual(
          decideReuse(base, key, { leg: 'ut', artifacts, excludeRunDir: nextRound }).reusable,
          null,
          '上一轮遗留的 started 必须挡住更早的成功（不得洗绿）',
        );
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
