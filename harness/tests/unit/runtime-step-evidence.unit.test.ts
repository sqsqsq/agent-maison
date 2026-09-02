// runtime-step-evidence.unit.test.ts — P0 runtime fidelity evidence matrix

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

import { clearFrameworkConfigCache } from '../../config';
import {
  deviceTestEvidencePath,
  type DeviceTestEvidenceDoc,
} from '../../scripts/utils/device-test-evidence-shared';
import {
  composeRuntimeFidelityEvidence,
  runtimeStepHashFromText,
  validateRuntimeFidelityEvidenceDocument,
} from '../../scripts/utils/runtime-step-evidence';
import {
  resolvePhaseEvidenceManifest,
  writePhaseEvidenceManifest,
} from '../../scripts/utils/phase-evidence-manifest';
import { probeHylyreEvidenceCapability } from '../../../profiles/hmos-app/harness/providers/device-test-run';
import type { UnitCaseResult } from '../run-unit';

const FEATURE = 'runtime-demo';
const RUN_ID = 'run-runtime-1';
const ATTEMPT_ID = 'i1';
const TARGET = { serial: 'SERIAL-1', target_kind: 'physical', session_id: 'session-1' };
const HAP_SHA = 'a'.repeat(64);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function write(root: string, rel: string, content: string): string {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
  return abs;
}

function pythonStepHash(stepText: string): string {
  const repoRoot = path.resolve(__dirname, '../../..');
  const vendorDir = path.join(repoRoot, 'profiles', 'hmos-app', 'vendor', 'hylyre');
  // 双模：源码树 vendor 直接把 src 目录入 sys.path；legacy 布局回落 whl zipimport
  const srcRoot = path.join(vendorDir, 'src');
  const importRoot = fs.existsSync(path.join(srcRoot, 'hylyre', '__init__.py'))
    ? srcRoot
    : path.join(vendorDir, 'hylyre-0.3.1-py3-none-any.whl');
  const script = [
    'import hashlib, sys',
    'import_root, step = sys.argv[1:3]',
    'sys.path.insert(0, import_root)',
    'from hylyre.scenario.step_text import normalize_planned_step_text',
    'print(hashlib.sha256(normalize_planned_step_text(step).encode("utf-8")).hexdigest())',
  ].join('; ');
  // -B（评审 3 P0）：whl zipimport 不写 bytecode 缓存，但源码目录 import 默认会向
  // vendor src 写 __pycache__ —— 弄脏工作树并制造 manifest 清单外杂物，必须抑制。
  const result = spawnSync(
    process.env.MAISON_PYTHON || 'python',
    ['-B', '-c', script, importRoot, stepText],
    { encoding: 'utf-8' },
  );
  assert(result.status === 0, `Python parity helper failed: ${result.stderr || result.stdout}`);
  if (importRoot === srcRoot) {
    assert(
      !fs.existsSync(path.join(srcRoot, 'hylyre', '__pycache__')),
      'vendor src 内不得出现 __pycache__（-B 失效或被旁路）',
    );
  }
  return result.stdout.trim();
}

interface Fixture {
  root: string;
  reportsDir: string;
  tracePath: string;
  trace: Record<string, any>;
}

function fixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-step-evidence-'));
  write(root, 'framework.config.json', JSON.stringify({
    schema_version: '1.1',
    project_name: 'runtime-step-evidence',
    project_profile: { name: 'hmos-app', sub_variant: 'app' },
    architecture: {
      outer_layers: [{ id: '02-Feature', can_depend_on: [], intra_layer_deps: 'dag' }],
      module_inner_layers: ['shared'],
      inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ets',
    },
    paths: {
      features_dir: 'doc/features',
      docs_committed: false,
      reports_dir_pattern: 'doc/features/<feature>/<phase>/reports',
    },
    materialized_adapters: ['cursor'],
  }, null, 2));
  write(root, `doc/features/${FEATURE}/acceptance.yaml`, `flows:
  checkout:
    screens: [home, success]
criteria:
  - id: AC-1
    priority: P0
    ut_layer: device
    linked_flow: checkout
    checkpoint:
      pre_screen: home
      action: { type: touch, target_element_id: pay_button }
      post_screen: success
      required_element_ids: [success_title]
      forbidden_element_ids: [error_banner]
`);
  write(root, `doc/features/${FEATURE}/spec/ui-spec.yaml`, `schema_version: '1.0'
verified: unverified
screens:
  - id: home
    priority: P0
    must_have_elements: [pay_button]
    root:
      type: page
      order: 0
      children:
        - { id: pay_button, type: interactive, order: 0 }
  - id: success
    priority: P0
    must_have_elements: [success_title]
    root:
      type: page
      order: 0
      children:
        - { id: success_title, type: content_display, order: 0 }
        - { id: error_banner, type: content_display, order: 1 }
tokens: {}
assets: []
`);
  write(root, `doc/features/${FEATURE}/testing/test-plan.md`, `# 测试计划

## 测试用例

| 用例编号 | 测试步骤 | 优先级 | 关联 AC |
| --- | --- | --- | --- |
| TC-001 | 点击支付 | P0 | AC-1 |
`);
  const reportsDir = path.join(root, 'doc', 'features', FEATURE, 'testing', 'reports');
  const runDir = path.join(reportsDir, '20260827T000000Z', 'hylyre');
  const steps = [
    { touch: { by_id: 'pay_button' } },
    { wait_for: { by_id: 'success_title' } },
  ];
  const stepTexts = steps.map(step => JSON.stringify(step));
  write(root, path.relative(root, path.join(runDir, 'test-plan.hylyre.md')), `# Hylyre

| 用例编号 | 测试步骤 | 优先级 | 关联 AC |
| --- | --- | --- | --- |
| TC-001 | ${stepTexts.join('; ')} | P0 | AC-1 |
`);
  const screen = (signature: string, ids: string[]) => ({
    signature_sha256: signature.repeat(64),
    observed_element_ids: ids,
  });
  const trace: Record<string, any> = {
    schema_version: '0.2-p4',
    feature: FEATURE,
    phase: 'testing',
    outcome: 'success',
    cases: [{ id: 'TC-001', status: '通过', priority: 'P0', ac_ref: 'AC-1' }],
    runtime_step_telemetry: {
      schema_version: '1.0',
      provider: {
        id: 'hylyre', version: '0.3.1',
        collector: 'maison-hylyre-runtime-telemetry', collector_version: '1.0',
      },
      goal_run_id: RUN_ID,
      attempt_id: ATTEMPT_ID,
      device_target: TARGET,
      steps: [
        {
          case_id: 'TC-001', step_index: 0, action_kind: 'touch', step_sha256: runtimeStepHashFromText(stepTexts[0]),
          declared_target: { kind: 'by_id', value: 'pay_button' },
          actual_hit: { stable_node_id: 'pay_button', bounds: [10, 20, 110, 80] },
          pre_screen: screen('1', ['pay_button']),
          post_screen: screen('2', ['success_title']),
          outcome: 'passed', capture_error: null,
        },
        {
          case_id: 'TC-001', step_index: 1, action_kind: 'wait_for', step_sha256: runtimeStepHashFromText(stepTexts[1]),
          declared_target: { kind: 'by_id', value: 'success_title' },
          actual_hit: null,
          pre_screen: screen('2', ['success_title']),
          post_screen: screen('3', ['success_title']),
          outcome: 'passed', capture_error: null,
        },
      ],
    },
  };
  const tracePath = write(root, path.relative(root, path.join(runDir, 'trace.json')), `${JSON.stringify(trace, null, 2)}\n`);
  clearFrameworkConfigCache();
  return { root, reportsDir, tracePath, trace };
}

function compose(f: Fixture) {
  return composeRuntimeFidelityEvidence({
    projectRoot: f.root,
    feature: FEATURE,
    tracePath: f.tracePath,
    hapSha256Full: HAP_SHA,
    goalRunId: RUN_ID,
    attemptId: ATTEMPT_ID,
    deviceTarget: TARGET,
  });
}

function materializeDoc(f: Fixture): DeviceTestEvidenceDoc {
  const result = compose(f);
  assert(result.ok && result.applicable, JSON.stringify(result));
  const doc: DeviceTestEvidenceDoc = {
    schema_version: '1.1',
    goal_run_id: RUN_ID,
    attempt_id: ATTEMPT_ID,
    device_target: TARGET,
    hap_sha256_full: HAP_SHA,
    install_executed: true,
    install_ok: true,
    trace_path: f.tracePath,
    run_failure_kind: null,
    written_at: new Date().toISOString(),
    cases: [],
    runtime_fidelity: result.evidence,
  };
  fs.mkdirSync(f.reportsDir, { recursive: true });
  fs.writeFileSync(deviceTestEvidencePath(f.reportsDir), `${JSON.stringify(doc, null, 2)}\n`, 'utf-8');
  return doc;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: '跨语言 step hash：整数形小数、普通小数与指数文本均绑定同一计划字节',
    run: () => {
      for (const stepText of [
        '{"wait":{"seconds":1.0}}',
        '{"wait":{"seconds":0.25}}',
        '{"wait":{"seconds":1e-7}}',
      ]) {
        assert(
          pythonStepHash(stepText) === runtimeStepHashFromText(stepText),
          `Python/TypeScript step hash mismatch: ${stepText}`,
        );
      }
    },
  },
  {
    name: 'provider handshake：0.5.0 native PASS；旧 collector 不再作为新 run 能力',
    run: () => {
      const native = probeHylyreEvidenceCapability({ hylyreVersion: '0.5.0', manifestVersion: '0.5.0' });
      assert(native.mode === 'native' && native.native, JSON.stringify(native));
      const legacy = probeHylyreEvidenceCapability({ hylyreVersion: '0.3.1', manifestVersion: '0.3.1' });
      assert(legacy.mode === 'unsupported' && !legacy.legacy, JSON.stringify(legacy));
      const drift = probeHylyreEvidenceCapability({ hylyreVersion: '0.3.1', manifestVersion: '0.3.0' });
      assert(drift.mode === 'unsupported', JSON.stringify(drift));
    },
  },
  {
    name: '有效 runtime evidence：命中/bounds/屏签/required/forbidden/全步序均绑定',
    run: () => {
      const f = fixture();
      const result = compose(f);
      assert(result.ok && result.applicable, JSON.stringify(result));
      assert(result.evidence.checkpoints.length === 1, 'checkpoint count');
      assert(result.evidence.checkpoints[0].actual_hit.stable_node_id === 'pay_button', 'actual target');
      assert(result.evidence.checkpoints[0].required_observations[0].present, 'required present');
      assert(!result.evidence.checkpoints[0].forbidden_observations[0].present, 'forbidden absent');
    },
  },
  {
    name: 'provider 声明支持但 telemetry 缺失/采集失败 → FAIL，不伪装 capability missing',
    run: () => {
      const missing = fixture();
      delete missing.trace.runtime_step_telemetry;
      fs.writeFileSync(missing.tracePath, `${JSON.stringify(missing.trace, null, 2)}\n`, 'utf-8');
      const missingResult = compose(missing);
      assert(!missingResult.ok && missingResult.reason.includes('runtime_step_telemetry'), JSON.stringify(missingResult));

      const failed = fixture();
      failed.trace.runtime_step_telemetry.steps[0].capture_error = 'pre:dump failed';
      fs.writeFileSync(failed.tracePath, `${JSON.stringify(failed.trace, null, 2)}\n`, 'utf-8');
      const failedResult = compose(failed);
      assert(!failedResult.ok && failedResult.reason.includes('步序/内容'), JSON.stringify(failedResult));
    },
  },
  {
    name: '乱序、错 target、跨 run/attempt/device replay 全部拒绝',
    run: () => {
      const unordered = fixture();
      unordered.trace.runtime_step_telemetry.steps.reverse();
      fs.writeFileSync(unordered.tracePath, `${JSON.stringify(unordered.trace, null, 2)}\n`, 'utf-8');
      const orderResult = compose(unordered);
      assert(!orderResult.ok && orderResult.reason.includes('乱序'), JSON.stringify(orderResult));

      const wrong = fixture();
      wrong.trace.runtime_step_telemetry.steps[0].actual_hit.stable_node_id = 'other';
      fs.writeFileSync(wrong.tracePath, `${JSON.stringify(wrong.trace, null, 2)}\n`, 'utf-8');
      const wrongResult = compose(wrong);
      assert(!wrongResult.ok && wrongResult.reason.includes('命中'), JSON.stringify(wrongResult));

      const replay = fixture();
      replay.trace.runtime_step_telemetry.goal_run_id = 'old-run';
      fs.writeFileSync(replay.tracePath, `${JSON.stringify(replay.trace, null, 2)}\n`, 'utf-8');
      const replayResult = compose(replay);
      assert(!replayResult.ok && replayResult.reason.includes('run/attempt'), JSON.stringify(replayResult));
    },
  },
  {
    name: 'evidence 伪造/stale 重算失配；phase manifest 必须同时绑定 evidence 与权威 trace',
    run: () => {
      const stale = fixture();
      const staleDoc = materializeDoc(stale);
      fs.appendFileSync(
        path.join(stale.root, 'doc', 'features', FEATURE, 'acceptance.yaml'),
        '\n# changed\n',
        'utf-8',
      );
      const staleIssue = validateRuntimeFidelityEvidenceDocument({
        projectRoot: stale.root, feature: FEATURE, doc: staleDoc, requirePhaseManifestBinding: false,
      });
      assert(staleIssue?.includes('重算结果不一致'), String(staleIssue));

      const bound = fixture();
      const boundDoc = materializeDoc(bound);
      const missingManifest = validateRuntimeFidelityEvidenceDocument({
        projectRoot: bound.root, feature: FEATURE, doc: boundDoc, requirePhaseManifestBinding: true,
      });
      assert(missingManifest?.includes('phase-evidence-manifest 缺失'), String(missingManifest));
      writePhaseEvidenceManifest(bound.root, resolvePhaseEvidenceManifest({
        projectRoot: bound.root, feature: FEATURE, phase: 'testing',
      }));
      const valid = validateRuntimeFidelityEvidenceDocument({
        projectRoot: bound.root,
        feature: FEATURE,
        doc: boundDoc,
        expectedGoalRunId: RUN_ID,
        expectedAttemptId: ATTEMPT_ID,
        requirePhaseManifestBinding: true,
      });
      assert(valid === null, String(valid));

      bound.trace.runtime_step_telemetry.steps[0].actual_hit.bounds = [0, 0, 1, 1];
      fs.writeFileSync(bound.tracePath, `${JSON.stringify(bound.trace, null, 2)}\n`, 'utf-8');
      const forged = validateRuntimeFidelityEvidenceDocument({
        projectRoot: bound.root, feature: FEATURE, doc: boundDoc, requirePhaseManifestBinding: true,
      });
      assert(forged !== null, 'forged trace must be rejected');
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(test => {
    try {
      test.run();
      return { name: test.name, ok: true };
    } catch (error) {
      return { name: test.name, ok: false, error: (error as Error).message };
    }
  });
}

if (require.main === module) {
  const results = runAll();
  for (const result of results) {
    console.log(result.ok ? `PASS ${result.name}` : `FAIL ${result.name}: ${result.error}`);
  }
  process.exit(results.every(result => result.ok) ? 0 : 1);
}
