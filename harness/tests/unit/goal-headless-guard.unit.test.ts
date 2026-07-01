// goal-headless-guard.unit.test.ts — failure classifier, sentinel, no-progress guard

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  artifactsProgressed,
  classifyFailureKind,
  extractBlockerSignature,
  extractDeterministicAffectedFiles,
  shouldHaltNoProgress,
  snapshotArtifacts,
} from '../../scripts/utils/goal-failure-classifier';
import { buildSummaryBlockers } from '../../scripts/utils/summary-blockers';
import type { CheckResult } from '../../scripts/utils/types';
import { parseHeadlessInteractionSentinel } from '../../scripts/utils/goal-headless-sentinel';
import { buildPhasePrompt } from '../../scripts/goal-runner';
import type { GoalManifest } from '../../scripts/utils/goal-manifest';
import type { UnitCaseResult } from '../run-unit';

const FRAMEWORK_ROOT = path.resolve(__dirname, '../../..');

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const MINIMAL_MANIFEST: GoalManifest = {
  schema_version: '1.0',
  start_phase: 'spec',
  end_phase: 'testing',
  feature: 'demo-feature',
  requirement: 'test req',
  adapter: 'chrys',
  budget: { max_retries_per_phase: 2, max_total_turns: 30, wall_clock_minutes: 480 },
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

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  const cases: Array<{ name: string; run: () => void }> = [
    {
      name: 'classifyFailureKind: spec_file_exists → deterministic_gate',
      run: () => {
        const k = classifyFailureKind({
          verdict: 'FAIL',
          blockers: [{ id: 'spec_file_exists', affected_files: ['doc/features/f/spec/spec.md'] }],
        });
        assert(k === 'deterministic_gate_or_artifact_missing', k);
      },
    },
    {
      name: 'classifyFailureKind: review_report_exists → deterministic_gate',
      run: () => {
        const k = classifyFailureKind({
          verdict: 'FAIL',
          blockers: [{ id: 'review_report_exists', affected_files: ['doc/features/f/review/review-report.md'] }],
        });
        assert(k === 'deterministic_gate_or_artifact_missing', k);
      },
    },
    {
      name: 'classifyFailureKind: trace_json_file_not_found → deterministic_gate',
      run: () => {
        const k = classifyFailureKind({
          verdict: 'FAIL',
          blockers: [{ id: 'trace_json_file_not_found' }],
        });
        assert(k === 'deterministic_gate_or_artifact_missing', k);
      },
    },
    {
      name: 'classifyFailureKind: ghost acceptance_yaml_exists → code_regression',
      run: () => {
        const k = classifyFailureKind({
          verdict: 'FAIL',
          blockers: [{ id: 'acceptance_yaml_exists' }],
        });
        assert(k === 'code_regression', k);
      },
    },
    {
      name: 'classifyFailureKind: unknown blocker → code_regression (prefer retry)',
      run: () => {
        const k = classifyFailureKind({
          verdict: 'FAIL',
          blockers: [{ id: 'some_new_lint_rule' }],
        });
        assert(k === 'code_regression', k);
      },
    },
    {
      name: 'T6 classifyFailureKind: device_test_build → toolchain（不再 code_regression）',
      run: () => {
        const k = classifyFailureKind({ verdict: 'FAIL', blockers: [{ id: 'device_test_build' }] });
        assert(k === 'toolchain', k);
      },
    },
    {
      name: 'T6 classifyFailureKind: visual_diff_capture → capture',
      run: () => {
        const k = classifyFailureKind({ verdict: 'FAIL', blockers: [{ id: 'visual_diff_capture' }] });
        assert(k === 'capture', k);
      },
    },
    {
      name: 'T6 classifyFailureKind: visual_diff / layout_divergence / 越界 → visual_gap',
      run: () => {
        assert(classifyFailureKind({ verdict: 'FAIL', blockers: [{ id: 'visual_diff' }] }) === 'visual_gap', 'visual_diff');
        assert(
          classifyFailureKind({ verdict: 'FAIL', blockers: [{ id: 'visual_diff_layout_divergence' }] }) === 'visual_gap',
          'layout_divergence',
        );
        assert(
          classifyFailureKind({ verdict: 'FAIL', blockers: [{ id: 'visual_diff_out_of_bounds_element' }] }) === 'visual_gap',
          'out_of_bounds',
        );
      },
    },
    {
      name: 'T6 classifyFailureKind: 互斥优先级——toolchain 与 visual 共存时 toolchain 胜（下游全废）',
      run: () => {
        const k = classifyFailureKind({
          verdict: 'FAIL',
          blockers: [{ id: 'visual_diff' }, { id: 'device_test_build' }],
        });
        assert(k === 'toolchain', k);
      },
    },
    {
      name: 'T6 (review#2): device_test_run 用例失败（无 device_toolchain 标）→ code_regression（须改码可重试）',
      run: () => {
        const k = classifyFailureKind({ verdict: 'FAIL', blockers: [{ id: 'device_test_run' }] });
        assert(k === 'code_regression', k);
      },
    },
    {
      name: 'T6 (review#2): device_test_run 崩溃（blocking_class=device_toolchain）→ toolchain（早 halt 修环境）',
      run: () => {
        const k = classifyFailureKind({
          verdict: 'FAIL',
          blockers: [{ id: 'device_test_run', blocking_class: 'device_toolchain' }],
        });
        assert(k === 'toolchain', k);
      },
    },
    {
      name: 'T6 (review#2): device_test_run 崩溃 + visual 共存 → toolchain 胜',
      run: () => {
        const k = classifyFailureKind({
          verdict: 'FAIL',
          blockers: [{ id: 'visual_diff' }, { id: 'device_test_run', blocking_class: 'device_toolchain' }],
        });
        assert(k === 'toolchain', k);
      },
    },
    {
      // review#3 端到端链路：check 层 blocking_class 必须经 buildSummaryBlockers 保真进 summary.blockers[]，
      // 再被 classifyFailureKind 读到。修复前 mapping 丢字段 → 真实运行 device_test_run 崩溃误落 code_regression。
      name: 'T6 (review#3): CheckResult.blocking_class → summary.blockers[] → classifyFailureKind=toolchain（链路保真）',
      run: () => {
        const checks: CheckResult[] = [
          {
            id: 'device_test_run',
            category: 'structure',
            description: '真机自动化',
            severity: 'BLOCKER',
            status: 'FAIL',
            blocking_class: 'device_toolchain',
            details: '真机自动化执行失败：exit=1（runner 崩溃）',
          },
        ];
        const blockers = buildSummaryBlockers(checks, t => t, () => undefined);
        assert(blockers.length === 1, 'should produce 1 blocker');
        assert(blockers[0].blocking_class === 'device_toolchain', `blocking_class 丢失：${JSON.stringify(blockers[0])}`);
        // 把映射出的 summary blocker 直接喂分类器（与 goal-runner 读 summary.json 后同形）
        const k = classifyFailureKind({ verdict: 'FAIL', blockers });
        assert(k === 'toolchain', `链路末端应 toolchain，实得 ${k}`);
      },
    },
    {
      name: 'T6 (review#3): 无 blocking_class 的 device_test_run 用例失败 → 链路末端 code_regression',
      run: () => {
        const checks: CheckResult[] = [
          {
            id: 'device_test_run',
            category: 'structure',
            description: '真机自动化',
            severity: 'BLOCKER',
            status: 'FAIL',
            details: '自动化产物未达标（用例失败）',
          },
        ];
        const blockers = buildSummaryBlockers(checks, t => t, () => undefined);
        assert(blockers[0].blocking_class === undefined, 'should not invent blocking_class');
        const k = classifyFailureKind({ verdict: 'FAIL', blockers });
        assert(k === 'code_regression', `用例失败应 code_regression，实得 ${k}`);
      },
    },
    {
      name: 'shouldHaltNoProgress: terminology + spec.md content change → no halt',
      run: () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-term-'));
        const rel = 'doc/features/f/spec/spec.md';
        const abs = path.join(tmp, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, 'draft-v1', 'utf-8');
        const priorSnap = snapshotArtifacts(tmp, [rel]);
        fs.writeFileSync(abs, 'draft-v2', 'utf-8');
        const currentSnap = snapshotArtifacts(tmp, [rel]);
        const sig = 'terminology_mapping_table';
        assert(
          !shouldHaltNoProgress({
            failureKind: 'deterministic_gate_or_artifact_missing',
            priorBlockerSignature: sig,
            currentBlockerSignature: sig,
            priorArtifactSnapshot: priorSnap,
            currentArtifactSnapshot: currentSnap,
          }),
          'spec content progressed — should not halt',
        );
        fs.rmSync(tmp, { recursive: true, force: true });
      },
    },
    {
      name: 'shouldHaltNoProgress: same signature + missing file → halt',
      run: () => {
        const sig = 'spec_file_exists';
        const snap = { 'doc/features/f/spec/spec.md': { exists: false, contentHash: '' } };
        assert(
          shouldHaltNoProgress({
            failureKind: 'deterministic_gate_or_artifact_missing',
            priorBlockerSignature: sig,
            currentBlockerSignature: sig,
            priorArtifactSnapshot: snap,
            currentArtifactSnapshot: snap,
          }),
          'expected halt',
        );
      },
    },
    {
      name: 'shouldHaltNoProgress: code_regression never halts via guard',
      run: () => {
        assert(
          !shouldHaltNoProgress({
            failureKind: 'code_regression',
            priorBlockerSignature: 'x',
            currentBlockerSignature: 'x',
            priorArtifactSnapshot: {},
            currentArtifactSnapshot: {},
          }),
          'code_regression should not guard-halt',
        );
      },
    },
    {
      name: 'T6 shouldHaltNoProgress: toolchain 同 signature 重复 → halt（不吃视觉预算）',
      run: () => {
        assert(
          shouldHaltNoProgress({
            failureKind: 'toolchain',
            priorBlockerSignature: 'device_test_build',
            currentBlockerSignature: 'device_test_build',
            priorArtifactSnapshot: {},
            currentArtifactSnapshot: {},
          }),
          'toolchain 反复应 halt',
        );
      },
    },
    {
      name: 'T6 shouldHaltNoProgress: capture 同 signature 重复 → halt',
      run: () => {
        assert(
          shouldHaltNoProgress({
            failureKind: 'capture',
            priorBlockerSignature: 'visual_diff_capture',
            currentBlockerSignature: 'visual_diff_capture',
            priorArtifactSnapshot: {},
            currentArtifactSnapshot: {},
          }),
          'capture 反复应 halt',
        );
      },
    },
    {
      name: 'T6 shouldHaltNoProgress: visual_gap 同门禁 signature 重复（无改善）→ 熔断 halt',
      run: () => {
        assert(
          shouldHaltNoProgress({
            failureKind: 'visual_gap',
            priorBlockerSignature: 'visual_diff|visual_diff_layout_divergence',
            currentBlockerSignature: 'visual_diff|visual_diff_layout_divergence',
            priorArtifactSnapshot: {},
            currentArtifactSnapshot: {},
          }),
          'visual_gap 同门禁无改善应熔断',
        );
      },
    },
    {
      name: 'T6 shouldHaltNoProgress: visual_gap signature 变化（移除一项门禁=有改善）→ 不 halt',
      run: () => {
        assert(
          !shouldHaltNoProgress({
            failureKind: 'visual_gap',
            priorBlockerSignature: 'visual_diff|visual_diff_layout_divergence',
            currentBlockerSignature: 'visual_diff',
            priorArtifactSnapshot: {},
            currentArtifactSnapshot: {},
          }),
          'visual 门禁减少=有进展，应继续重试',
        );
      },
    },
    {
      name: 'artifactsProgressed: mtime-only refresh without content change → false',
      run: () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-artifact-'));
        const rel = 'doc/features/f/spec/spec.md';
        const abs = path.join(tmp, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, 'v1', 'utf-8');
        const prior = snapshotArtifacts(tmp, [rel]);
        fs.utimesSync(abs, new Date(), new Date());
        const current = snapshotArtifacts(tmp, [rel]);
        assert(!artifactsProgressed(prior, current), 'hash unchanged despite mtime bump');
        fs.rmSync(tmp, { recursive: true, force: true });
      },
    },
    {
      name: 'artifactsProgressed: content change → true',
      run: () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-artifact-'));
        const rel = 'doc/features/f/spec/spec.md';
        const abs = path.join(tmp, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, 'v1', 'utf-8');
        const prior = snapshotArtifacts(tmp, [rel]);
        fs.writeFileSync(abs, 'v2', 'utf-8');
        const current = snapshotArtifacts(tmp, [rel]);
        assert(artifactsProgressed(prior, current), 'content changed');
        fs.rmSync(tmp, { recursive: true, force: true });
      },
    },
    {
      name: 'parseHeadlessInteractionSentinel: multi-line scan hits middle line',
      run: () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-sentinel-'));
        const logPath = path.join(tmp, 'agent-output.log');
        fs.writeFileSync(
          logPath,
          ['noise', '{"code":"headless_interaction_required","error":"请确认术语"}', 'tail'].join('\n'),
          'utf-8',
        );
        const hit = parseHeadlessInteractionSentinel(logPath);
        assert(hit !== null, 'expected hit');
        assert(hit!.error.includes('请确认'), hit!.error);
        fs.rmSync(tmp, { recursive: true, force: true });
      },
    },
    {
      name: 'buildPhasePrompt: includes Unattended block + approval_mode',
      run: () => {
        const prompt = buildPhasePrompt(MINIMAL_MANIFEST, 'spec', FRAMEWORK_ROOT, []);
        assert(prompt.includes('Unattended execution'), 'missing unattended section');
        assert(prompt.includes('approval_mode: **never**'), 'missing approval_mode');
        assert(prompt.includes('overrides'), 'missing override language');
        assert(prompt.includes('§9'), 'missing §9 reference');
      },
    },
    {
      name: 'buildPhasePrompt: deterministic priorFailure omits revert-first',
      run: () => {
        const prior = 'Verdict: FAIL\n- spec_file_exists';
        const prompt = buildPhasePrompt(
          MINIMAL_MANIFEST,
          'spec',
          FRAMEWORK_ROOT,
          [],
          prior,
          'deterministic_gate_or_artifact_missing',
        );
        assert(!prompt.includes('revert that change first'), 'should not revert for gate failure');
        assert(prompt.includes('confirmation gate'), 'gate-specific guidance');
      },
    },
    {
      name: 'buildPhasePrompt: code_regression priorFailure keeps revert-first',
      run: () => {
        const prior = 'Verdict: FAIL\n- ut_compile';
        const prompt = buildPhasePrompt(
          MINIMAL_MANIFEST,
          'spec',
          FRAMEWORK_ROOT,
          [],
          prior,
          'code_regression',
        );
        assert(prompt.includes('revert that change first'), 'should keep revert for code regression');
      },
    },
    {
      name: 'buildPhasePrompt: P1-B 超时 partial 产物注入续作块',
      run: () => {
        const prompt = buildPhasePrompt(
          MINIMAL_MANIFEST,
          'review',
          FRAMEWORK_ROOT,
          [],
          undefined,
          undefined,
          ['doc/features/x/review/review-report.md', 'doc/features/x/review/context-exploration.md'],
        );
        assert(prompt.includes('TIMED OUT'), '缺超时续作标题');
        assert(prompt.includes('do NOT redo exploration'), '缺"勿从零重做探索"指令');
        assert(prompt.includes('review-report.md'), '缺 partial 产物清单');
      },
    },
    {
      name: 'buildPhasePrompt: 无 partial 产物时不注入续作块',
      run: () => {
        const prompt = buildPhasePrompt(MINIMAL_MANIFEST, 'review', FRAMEWORK_ROOT, [], undefined, undefined, []);
        assert(!prompt.includes('TIMED OUT'), '空清单不应注入续作块');
      },
    },
    {
      name: 'extractDeterministicAffectedFiles: from blockers',
      run: () => {
        const files = extractDeterministicAffectedFiles({
          blockers: [{ id: 'spec_file_exists', affected_files: ['doc/features/x/spec/spec.md'] }],
        });
        assert(files.length === 1 && files[0].includes('spec.md'), files.join(','));
      },
    },
    {
      name: 'extractBlockerSignature: stable sorted ids',
      run: () => {
        const sig = extractBlockerSignature({
          blockers: [{ id: 'b' }, { id: 'a' }],
        });
        assert(sig === 'a|b', sig);
      },
    },
  ];

  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}
