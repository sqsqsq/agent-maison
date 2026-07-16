// goal-headless-guard.unit.test.ts — failure classifier, sentinel, no-progress guard

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  artifactsProgressed,
  buildEffectiveBlockerSignature,
  classifyFailureKind,
  extractBlockerSignature,
  extractDeterministicAffectedFiles,
  extractIntegritySubtypes,
  hasIntegrityBlocker,
  isAllFrameworkBugBlockers,
  shouldHaltNoProgress,
  snapshotArtifacts,
  SIGNATURE_HALT_KINDS,
  isOperatorInterruptSignal,
  WINDOWS_CTRL_C_EXIT_CODE,
  CUMULATIVE_HALT_FAMILY,
  CUMULATIVE_HALT_THRESHOLD,
  ADVANCE_BLOCKED_HALT_THRESHOLD,
} from '../../scripts/utils/goal-failure-classifier';
import { buildSummaryBlockers } from '../../scripts/utils/summary-blockers';
import type { CheckResult } from '../../scripts/utils/types';
import {
  parseHeadlessApiError,
  parseHeadlessInteractionSentinel,
} from '../../scripts/utils/goal-headless-sentinel';
import {
  collectUncommittedVisualAttemptIds,
  collectVisualRoundRowHashes,
  countConsecutiveAgentTimeouts,
  countTransientApiRetries,
  countCumulativeAdvanceBlocked,
  countRepeatedSignatureInFamily,
  deriveContinuationFromEvents,
  findLatestEffectiveTimeoutMs,
  isAgentNoOutputSignal,
  lastPhaseVerdictTransientApiError,
  type GoalRunEvent,
} from '../../scripts/utils/goal-runner-phase';
import {
  buildPhasePrompt,
  extractPriorFailureContext,
  buildCapabilityBlock,
  resolvePhaseCapabilityAdvisory,
  TRANSIENT_API_BACKOFF_MS,
  VISUAL_GAP_RETRY_GUIDANCE,
  type CapabilityAdvisory,
} from '../../scripts/goal-runner';
import { buildAwaitHumanConfirmGuidance, buildClosureWallGuidance } from '../../scripts/utils/await-confirm-guidance';
import { clearFrameworkConfigCache } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
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

/**
 * E0 测试夹具：独立临时 projectRoot（不用 FRAMEWORK_ROOT 自身，避免污染仓库根 doc/）+
 * 真实 FRAMEWORK_ROOT 作 frameworkRoot（令 resolveContextAdapterImageInput 读到真实
 * agents/<adapter>/adapter.yaml；loadResolvedProfile 的 profileDir 解析独立于 projectRoot，
 * 恒指向真实仓库的 profiles/<name>，故可直接构造任意 profile 的 resolvedProfile）。
 */
function mkCapabilityProject(profileName: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e0-cap-'));
  fs.writeFileSync(
    path.join(root, 'framework.config.json'),
    JSON.stringify({
      schema_version: '1.0',
      project_name: 'demo',
      project_type: 'app',
      project_profile: { name: profileName },
      agent_adapter: 'chrys',
      architecture: {
        outer_layers: [{ id: '01-Product', can_depend_on: [], intra_layer_deps: 'forbid' }],
        module_inner_layers: ['shared', 'data', 'domain', 'presentation'],
        inner_dependency_direction: 'upward',
        cross_module_exports_file: 'index.ets',
      },
      paths: { features_dir: 'doc/features' },
    }),
    'utf-8',
  );
  return root;
}

function loadTestResolvedProfile(root: string) {
  clearFrameworkConfigCache();
  const fw = JSON.parse(fs.readFileSync(path.join(root, 'framework.config.json'), 'utf-8'));
  return loadResolvedProfile(root, fw);
}

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
    // ------------------------------------------------------------------
    // P0-5/P0-3（plan d9b4f7e2）freshness 决策表逐行 + 非超时轮归因
    // ------------------------------------------------------------------
    {
      name: 'P0-5 决策表: timedOut+stale+integrity → agent_timeout（旧证据不可信）',
      run: () => {
        const k = classifyFailureKind(
          {
            verdict: 'FAIL',
            blockers: [{ id: 'framework_integrity', blocking_class: 'integrity', classification: 'framework_drift' }],
          },
          undefined,
          { agentTimedOut: true, staleSummary: true },
        );
        assert(k === 'agent_timeout', k);
      },
    },
    {
      name: 'P0-5 决策表: timedOut+staleSummary 未传 → agent_timeout（fail-safe 视同 stale）',
      run: () => {
        const k = classifyFailureKind(
          {
            verdict: 'FAIL',
            blockers: [{ id: 'framework_integrity', blocking_class: 'integrity', classification: 'framework_drift' }],
          },
          undefined,
          { agentTimedOut: true },
        );
        assert(k === 'agent_timeout', k);
      },
    },
    {
      name: 'P0-5 决策表: timedOut+fresh+含 integrity（混内容 blocker）→ framework_integrity_block（integrity 不回落混装）',
      run: () => {
        const k = classifyFailureKind(
          {
            verdict: 'FAIL',
            blockers: [
              { id: 'framework_integrity', blocking_class: 'integrity', classification: 'framework_drift' },
              { id: 'required_chapters' },
            ],
          },
          undefined,
          { agentTimedOut: true, staleSummary: false },
        );
        assert(k === 'framework_integrity_block', k);
      },
    },
    {
      name: 'P0-3 决策表: timedOut+fresh+非空全 framework_bug → framework_bug',
      run: () => {
        const k = classifyFailureKind(
          {
            verdict: 'FAIL',
            blockers: [
              { id: 'ui_spec_structure', classification: 'framework_bug', blocking_class: 'framework_internal' },
              { id: 'asset_acquisition', classification: 'framework_bug', blocking_class: 'framework_internal' },
            ],
          },
          undefined,
          { agentTimedOut: true, staleSummary: false },
        );
        assert(k === 'framework_bug', k);
      },
    },
    {
      name: 'P0-3 决策表: timedOut+fresh+framework_bug 混 content → agent_timeout（依赖 P0-2 收敛）',
      run: () => {
        const k = classifyFailureKind(
          {
            verdict: 'FAIL',
            blockers: [
              { id: 'ui_spec_structure', classification: 'framework_bug', blocking_class: 'framework_internal' },
              { id: 'required_chapters' },
            ],
          },
          undefined,
          { agentTimedOut: true, staleSummary: false },
        );
        assert(k === 'agent_timeout', k);
      },
    },
    {
      name: 'P0-3 决策表: timedOut+fresh+空 blockers → agent_timeout（.every() 真空真值防误判）',
      run: () => {
        const k = classifyFailureKind(
          { verdict: 'FAIL', blockers: [] },
          undefined,
          { agentTimedOut: true, staleSummary: false },
        );
        assert(k === 'agent_timeout', k);
        assert(isAllFrameworkBugBlockers({ verdict: 'FAIL', blockers: [] }) === false, 'empty blockers must not be all-framework_bug');
      },
    },
    {
      name: 'P0-5 决策表: timedOut+fresh+纯 content → agent_timeout',
      run: () => {
        const k = classifyFailureKind(
          { verdict: 'FAIL', blockers: [{ id: 'required_chapters' }] },
          undefined,
          { agentTimedOut: true, staleSummary: false },
        );
        assert(k === 'agent_timeout', k);
      },
    },
    {
      name: 'P0-5 非超时轮: integrity 在场 → framework_integrity_block（i8/i9 形态不再落 code_regression）',
      run: () => {
        const k = classifyFailureKind({
          verdict: 'FAIL',
          blocking_class: 'integrity',
          failure_kind: 'framework_drift',
          blockers: [
            { id: 'framework_integrity', blocking_class: 'integrity', classification: 'framework_drift' },
            { id: 'visual_parity_coverage' },
          ],
        });
        assert(k === 'framework_integrity_block', k);
      },
    },
    {
      name: 'P0-5 复审: external+integrity 同场 → integrity 优先（完整性失守时 defer 归因不可信）',
      run: () => {
        const k = classifyFailureKind({
          verdict: 'FAIL',
          blocking_class: 'externalBlocked',
          failure_kind: 'device_blocked',
          blockers: [
            { id: 'device_test_run', blocking_class: 'externalBlocked', classification: 'device_blocked' },
            { id: 'framework_integrity', blocking_class: 'integrity', classification: 'framework_drift' },
          ],
        });
        assert(k === 'framework_integrity_block', `expect integrity halt got ${k}`);
      },
    },
    {
      name: 'P0-3 非超时轮: 全 framework_bug → framework_bug；混装走既有归因',
      run: () => {
        const pure = classifyFailureKind({
          verdict: 'FAIL',
          blockers: [{ id: 'ui_spec_structure', classification: 'framework_bug', blocking_class: 'framework_internal' }],
        });
        assert(pure === 'framework_bug', pure);
        const mixed = classifyFailureKind({
          verdict: 'FAIL',
          blockers: [
            { id: 'ui_spec_structure', classification: 'framework_bug', blocking_class: 'framework_internal' },
            { id: 'some_new_lint_rule' },
          ],
        });
        assert(mixed === 'code_regression', mixed);
      },
    },
    {
      name: 'P0-5 extractIntegritySubtypes: 三类共存全收集、去重、非 integrity classification 不混入',
      run: () => {
        const subtypes = extractIntegritySubtypes({
          verdict: 'FAIL',
          blockers: [
            { id: 'framework_manifest_selfcheck', blocking_class: 'integrity', classification: 'framework_manifest_sidecar_missing' },
            { id: 'framework_integrity', blocking_class: 'integrity', classification: 'framework_drift' },
            { id: 'framework_integrity', blocking_class: 'integrity', classification: 'framework_drift' },
            { id: 'framework_foreign_file', blocking_class: 'integrity', classification: 'framework_foreign_file' },
            { id: 'content_gate', classification: 'device_blocked' },
          ],
        });
        assert(subtypes.length === 3, `expect 3 got ${subtypes.length}: ${subtypes.join(',')}`);
        assert(subtypes.includes('framework_manifest_sidecar_missing'), 'sidecar_missing collected');
        assert(subtypes.includes('framework_drift'), 'drift collected');
        assert(subtypes.includes('framework_foreign_file'), 'foreign collected');
        assert(!subtypes.includes('device_blocked'), 'non-integrity classification must not leak in');
      },
    },
    {
      name: 'P0-5 extractIntegritySubtypes: 顶层回落带过滤（blocking_class 非 integrity 不回填）',
      run: () => {
        const ok = extractIntegritySubtypes({
          verdict: 'FAIL',
          blocking_class: 'integrity',
          failure_kind: 'framework_drift',
          blockers: [{ id: 'framework_integrity', blocking_class: 'integrity' }],
        });
        assert(ok.length === 1 && ok[0] === 'framework_drift', `fallback expected framework_drift got ${ok.join(',')}`);
        const rejected = extractIntegritySubtypes({
          verdict: 'FAIL',
          blocking_class: 'externalBlocked',
          failure_kind: 'device_blocked',
          blockers: [],
        });
        assert(rejected.length === 0, `content-class top-level must not be pushed: ${rejected.join(',')}`);
        assert(hasIntegrityBlocker({ verdict: 'FAIL', blocking_class: 'integrity' }), 'top-level integrity counts as present');
      },
    },
    {
      name: 'P0-3 buildSummaryBlockers: safeRun 的 framework_bug 归因保真传导到 blocker.classification',
      run: () => {
        const checks: CheckResult[] = [
          {
            id: 'ui_spec_structure',
            category: 'structure',
            description: 'ui_spec_structure 执行异常',
            severity: 'BLOCKER',
            status: 'FAIL',
            details: '[Harness 内部错误] x.map is not a function\nTypeError: ...',
            failure_kind: 'framework_bug',
            blocking_class: 'framework_internal',
          },
        ];
        const blockers = buildSummaryBlockers(checks, (t) => t, () => undefined);
        assert(blockers.length === 1, 'one blocker');
        assert(blockers[0].classification === 'framework_bug', String(blockers[0].classification));
        assert(blockers[0].blocking_class === 'framework_internal', String(blockers[0].blocking_class));
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
      name: 'round5 P1-B classifyFailureKind: visual_diff_screenshot_dedup → capture（非 visual_gap）',
      run: () => {
        const k = classifyFailureKind({ verdict: 'FAIL', blockers: [{ id: 'visual_diff_screenshot_dedup' }] });
        assert(k === 'capture', k);
      },
    },
    {
      name: 'round5 P0-A/X4 classifyFailureKind: visual_parity_ocr_unavailable → toolchain（非 code_regression）',
      run: () => {
        const k = classifyFailureKind({ verdict: 'FAIL', blockers: [{ id: 'visual_parity_ocr_unavailable' }] });
        assert(k === 'toolchain', k);
      },
    },
    {
      name: 'round5 反向断言：baked_text / icon_substitution 仍 code_regression（coding 可修，非环境类）',
      run: () => {
        assert(
          classifyFailureKind({ verdict: 'FAIL', blockers: [{ id: 'visual_parity_asset_baked_text' }] }) === 'code_regression',
          'baked_text',
        );
        assert(
          classifyFailureKind({ verdict: 'FAIL', blockers: [{ id: 'visual_parity_icon_substitution' }] }) === 'code_regression',
          'icon_substitution',
        );
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
      name: 'b4 ut_hvigor_test: device_toolchain 标注 → toolchain',
      run: () => {
        const kind = classifyFailureKind({
          verdict: 'FAIL',
          blockers: [{ id: 'ut_hvigor_test', blocking_class: 'device_toolchain' }],
        });
        assert(kind === 'toolchain', kind);
      },
    },
    {
      name: 'b4 ut_hvigor_test: 无结构化标注 → code_regression',
      run: () => {
        const kind = classifyFailureKind({ verdict: 'FAIL', blockers: [{ id: 'ut_hvigor_test' }] });
        assert(kind === 'code_regression', kind);
      },
    },
    {
      name: 'b4+d9: agentTimedOut 让位 agent_timeout，但 prior failure 签名诊断不丢',
      run: () => {
        const summary = {
          verdict: 'FAIL' as const,
          blockers: [
            {
              id: 'ut_hvigor_test',
              blocking_class: 'device_toolchain',
              classification: 'ohos_test_sign_gap',
              details_excerpt:
                'ohosTest 签名环境缺口：signingConfigs 未配置；宿主请补 signingConfigs 或通过自定义签名任务覆盖 ohosTest',
            },
          ],
        };
        const kind = classifyFailureKind(summary, undefined, { agentTimedOut: true });
        assert(kind === 'agent_timeout', kind);
        const prior = extractPriorFailureContext(summary as any);
        assert(prior.includes('signingConfigs 未配置'), prior);
        assert(prior.includes('自定义签名任务覆盖 ohosTest'), prior);
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
        const prompt = buildPhasePrompt(MINIMAL_MANIFEST, FRAMEWORK_ROOT, 'spec', FRAMEWORK_ROOT, []);
        assert(prompt.includes('Unattended execution'), 'missing unattended section');
        assert(prompt.includes('approval_mode: **never**'), 'missing approval_mode');
        assert(prompt.includes('overrides'), 'missing override language');
        assert(prompt.includes('§9'), 'missing §9 reference');
      },
    },
    {
      // P0-2（round6 收尾批·codex 意见）：visual_gap 重试指导必须含弃判禁令——
      // fail_signals 非空不得 pending、须转 must_fix 并在本轮修码重测（终局 run 实锤 agent 弃判）。
      name: 'VISUAL_GAP_RETRY_GUIDANCE: forbids verdict abandonment',
      run: () => {
        const text = VISUAL_GAP_RETRY_GUIDANCE.join('\n');
        assert(/verdict=fail/.test(text), 'missing verdict=fail instruction');
        assert(/must_fix/.test(text), 'missing must_fix conversion instruction');
        assert(/do NOT leave such screens pending/i.test(text), 'missing pending prohibition');
        assert(/confirmed_by/.test(text), 'missing PASS-candidate human-confirm boundary');
      },
    },
    {
      // P0-9b（plan e7a91b3c）：唯一阻塞=T2 真人确认 → 独立 kind（重试无意义，不入 no_progress 口径）
      name: 'classifyFailureKind: await_human_confirm wins over visual_gap id bucket',
      run: () => {
        const summary = {
          blockers: [
            { id: 'visual_diff', classification: 'await_human_confirm' },
            { id: 'testing_run_status' },
          ],
        } as never;
        assert(classifyFailureKind(summary) === 'await_human_confirm', 'await classification must win');
        // 无 await 标注的 visual_diff 仍归 visual_gap（回归保护）
        const plain = { blockers: [{ id: 'visual_diff' }] } as never;
        assert(classifyFailureKind(plain) === 'visual_gap', 'plain visual_diff stays visual_gap');
      },
    },
    {
      // P0-10a：引导话术机器生成——按 run 上下文注入、协议要素齐、零硬编码人名、含高保真 CLI
      name: 'buildAwaitHumanConfirmGuidance: run-context injection + protocol + no hardcoded name',
      run: () => {
        const text = buildAwaitHumanConfirmGuidance({
          feature: 'homepage',
          runId: '20260703T181220Z',
          phase: 'testing',
          screenshotsDirRel: 'doc/features/homepage/device-testing/device-screenshots',
          visualDiffJsonRel: 'doc/features/homepage/device-testing/device-screenshots/visual-diff.json',
          harnessPrefixRel: 'framework/harness',
        }).join('\n');
        // run 上下文注入
        assert(/homepage/.test(text), 'missing feature injection');
        assert(/20260703T181220Z/.test(text), 'missing run_id injection');
        // layout 完整命令 + resume 全参数（codex P2）
        assert(/npm --prefix framework\/harness run visual-confirm -- --feature homepage/.test(text), 'missing prefixed CLI command');
        assert(/--resume 20260703T181220Z --force-resume/.test(text), 'missing full resume command');
        // 协议要素
        assert(/confirmed_by/.test(text), 'missing confirmed_by instruction');
        assert(/user_requirement/.test(text), 'missing user_requirement-invalid warning (P0-6)');
        assert(/verdict.{0,4}fail|"fail"/.test(text), 'missing reject path');
        assert(/evaluated_build_fingerprint/.test(text), 'missing bind-field protection');
        // 信任层级（cursor 意见）
        assert(/软契约/.test(text) && /高保真/.test(text), 'missing trust-tier note');
        // 零硬编码人名（署名一律"当场提供"）
        assert(/当场/.test(text), 'signature must be prompted, not templated');
        assert(!/盛全|张三|alice|Alice/.test(text), 'must not embed a specific human name');
      },
    },
    {
      name: 'buildPhasePrompt: deterministic priorFailure omits revert-first',
      run: () => {
        const prior = 'Verdict: FAIL\n- spec_file_exists';
        const prompt = buildPhasePrompt(
          MINIMAL_MANIFEST,
          FRAMEWORK_ROOT,
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
          FRAMEWORK_ROOT,
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
      name: 'b4 buildPhasePrompt: toolchain 重试提示包含 signingConfigs 与自定义签名任务',
      run: () => {
        const prompt = buildPhasePrompt(
          MINIMAL_MANIFEST,
          FRAMEWORK_ROOT,
          'ut',
          FRAMEWORK_ROOT,
          [],
          'Verdict: FAIL\n- ut_hvigor_test [ohos_test_sign_gap]',
          'toolchain',
        );
        assert(prompt.includes('signing configuration'), '缺签名配置类别');
        assert(prompt.includes('signingConfigs'), '缺 signingConfigs 指引');
        assert(prompt.includes('custom signing task coverage'), '缺自定义签名任务覆盖指引');
        assert(!prompt.includes('revert that change first'), 'toolchain 不得引导回滚改码');
      },
    },
    {
      // P0-1（plan d9b4f7e2）契约更新：续作块由 continuation.cause 驱动（不再由清单非空驱动）。
      name: 'buildPhasePrompt: P1-B/P0-1 超时 continuation + partial 产物注入续作块',
      run: () => {
        const prompt = buildPhasePrompt(
          MINIMAL_MANIFEST,
          FRAMEWORK_ROOT,
          'review',
          FRAMEWORK_ROOT,
          [],
          undefined,
          undefined,
          ['doc/features/x/review/review-report.md', 'doc/features/x/review/context-exploration.md'],
          undefined,
          undefined,
          { cause: 'agent_timeout', process_resumed: false },
        );
        assert(prompt.includes('TIMED OUT'), '缺超时续作标题');
        assert(prompt.includes('do NOT redo exploration'), '缺"勿从零重做探索"指令');
        assert(prompt.includes('review-report.md'), '缺 partial 产物清单');
      },
    },
    {
      name: 'buildPhasePrompt: P0-1 无 continuation（干净首跑）→ 零注入；纯 partial 清单不再触发',
      run: () => {
        const clean = buildPhasePrompt(MINIMAL_MANIFEST, FRAMEWORK_ROOT, 'review', FRAMEWORK_ROOT, [], undefined, undefined, []);
        assert(!clean.includes('TIMED OUT') && !clean.includes('INTERRUPTED') && !clean.includes('CONNECTION DROP'), '干净首跑不得注入续作块');
        const listOnly = buildPhasePrompt(
          MINIMAL_MANIFEST, FRAMEWORK_ROOT, 'review', FRAMEWORK_ROOT, [],
          undefined, undefined, ['doc/features/x/review/review-report.md'], undefined, undefined, null,
        );
        assert(!listOnly.includes('TIMED OUT'), '无 continuation 时清单不得独立触发续作块');
      },
    },
    {
      name: 'buildPhasePrompt: P0-1 PASS+timeout 空 partial 也出续作块（空清单即信息）+ 预算提示',
      run: () => {
        const prompt = buildPhasePrompt(
          MINIMAL_MANIFEST, FRAMEWORK_ROOT, 'spec', FRAMEWORK_ROOT, [],
          undefined, undefined, [], [],
          undefined,
          { cause: 'agent_timeout', process_resumed: false },
          2700_000,
        );
        assert(prompt.includes('TIMED OUT'), 'PASS+timeout（无 priorFailure）也须出续作块');
        assert(prompt.includes('No partial phase artifacts'), '空清单须有 closure 提示行');
        assert(prompt.includes('Time budget: ~45 minutes'), `缺预算提示: ${prompt.match(/Time budget[^\n]*/)?.[0]}`);
      },
    },
    {
      name: 'buildPhasePrompt: P0-1 断流块头不谎称 TIMED OUT',
      run: () => {
        const prompt = buildPhasePrompt(
          MINIMAL_MANIFEST, FRAMEWORK_ROOT, 'spec', FRAMEWORK_ROOT, [],
          undefined, undefined, ['doc/features/x/spec/spec.md'], [],
          undefined,
          { cause: 'transient_api_error', process_resumed: false },
        );
        assert(prompt.includes('API CONNECTION DROP'), '缺断流块头');
        assert(!prompt.includes('TIMED OUT'), '断流不得写 TIMED OUT');
      },
    },
    {
      name: 'buildPhasePrompt: P0-1 unknown（崩溃段）块头 + process_resumed 磁盘为准注记',
      run: () => {
        const prompt = buildPhasePrompt(
          MINIMAL_MANIFEST, FRAMEWORK_ROOT, 'spec', FRAMEWORK_ROOT, [],
          undefined, undefined, [], [],
          undefined,
          { cause: 'unknown', process_resumed: true },
        );
        assert(prompt.includes('INTERRUPTED'), '缺 unknown 块头');
        assert(prompt.includes('--resume'), '缺 process_resumed 注记');
        assert(prompt.includes('trust the on-disk state'), '缺磁盘为准指令');
      },
    },
    {
      name: 'buildPhasePrompt: P0-1 content_retry 不出续作块（仅 priorFailure 通道）',
      run: () => {
        const prompt = buildPhasePrompt(
          MINIMAL_MANIFEST, FRAMEWORK_ROOT, 'spec', FRAMEWORK_ROOT, [],
          'Verdict: FAIL\n- ut_compile', 'code_regression', [], [],
          undefined,
          { cause: 'content_retry', process_resumed: false },
        );
        assert(!prompt.includes('TIMED OUT') && !prompt.includes('INTERRUPTED'), 'content_retry 不得出中断续作块');
        assert(prompt.includes('Prior attempt failure (retry context)'), 'priorFailure 通道保留');
      },
    },
    {
      name: 'buildPhasePrompt: P2 skip-lines + timeout continuation 注入续作块（无 artifacts 也生效）',
      run: () => {
        const prompt = buildPhasePrompt(
          MINIMAL_MANIFEST,
          FRAMEWORK_ROOT,
          'review',
          FRAMEWORK_ROOT,
          [],
          undefined,
          undefined,
          [],
          ['以下 3 个源文件上次已检视，勿重复 Read：', '  - src/a.ets'],
          undefined,
          { cause: 'agent_timeout', process_resumed: false },
        );
        assert(prompt.includes('TIMED OUT'), '仅 skip-lines 也应注入续作块');
        assert(prompt.includes('src/a.ets'), '缺 skip-list 文件');
      },
    },
    // ==========================================================================
    // P0-1 rev6：deriveContinuationFromEvents 五态窗口
    // ==========================================================================
    {
      name: 'P0-1 五态窗口: 无 start → null（resume 全新 phase 零注入）',
      run: () => {
        const events: GoalRunEvent[] = [
          { type: 'phase_start', phase: 'spec' },
          { type: 'agent_invoke_start', phase: 'spec', invoke_id: 'spec-i1' },
          { type: 'agent_invoke_end', phase: 'spec', invoke_id: 'spec-i1' },
          { type: 'phase_verdict', phase: 'spec', invoke_id: 'spec-i1', failure_kind_classified: 'code_regression' },
        ];
        assert(deriveContinuationFromEvents(events, 'plan') === null, '其他 phase 的历史不得触发 continuation');
        assert(deriveContinuationFromEvents([], 'spec') === null, '空 events → null');
      },
    },
    {
      name: 'P0-1 五态窗口: 有 start 无 end → unknown（崩于 agent 段）',
      run: () => {
        const c = deriveContinuationFromEvents(
          [{ type: 'agent_invoke_start', phase: 'spec', invoke_id: 'spec-i1' }],
          'spec',
        );
        assert(c?.cause === 'unknown', String(c?.cause));
      },
    },
    {
      name: 'P0-1 五态窗口: end timed_out 无 verdict → agent_timeout（timeout end 后 verdict 前崩溃，真因不丢）',
      run: () => {
        const c = deriveContinuationFromEvents(
          [
            { type: 'agent_invoke_start', phase: 'spec', invoke_id: 'spec-i1' },
            { type: 'agent_invoke_end', phase: 'spec', invoke_id: 'spec-i1', timed_out: true },
            { type: 'harness_start', phase: 'spec', invoke_id: 'spec-i1' },
          ],
          'spec',
        );
        assert(c?.cause === 'agent_timeout', String(c?.cause));
      },
    },
    {
      name: 'P0-1 五态窗口: end 正常无 verdict → unknown（agent end 后 harness 中崩溃）',
      run: () => {
        const c = deriveContinuationFromEvents(
          [
            { type: 'agent_invoke_start', phase: 'spec', invoke_id: 'spec-i1' },
            { type: 'agent_invoke_end', phase: 'spec', invoke_id: 'spec-i1' },
            { type: 'harness_start', phase: 'spec', invoke_id: 'spec-i1' },
          ],
          'spec',
        );
        assert(c?.cause === 'unknown', String(c?.cause));
      },
    },
    {
      name: 'P0-1 五态窗口: 有 verdict → 用其 classified cause（timeout/transient/content 三态）',
      run: () => {
        const mk = (fk: string): GoalRunEvent[] => [
          { type: 'agent_invoke_start', phase: 'spec', invoke_id: 'spec-i1' },
          { type: 'agent_invoke_end', phase: 'spec', invoke_id: 'spec-i1', timed_out: fk === 'agent_timeout' },
          { type: 'phase_verdict', phase: 'spec', invoke_id: 'spec-i1', failure_kind_classified: fk },
        ];
        assert(deriveContinuationFromEvents(mk('agent_timeout'), 'spec')?.cause === 'agent_timeout', 'timeout verdict');
        assert(deriveContinuationFromEvents(mk('transient_api_error'), 'spec')?.cause === 'transient_api_error', 'transient verdict');
        assert(deriveContinuationFromEvents(mk('code_regression'), 'spec')?.cause === 'content_retry', 'content verdict');
      },
    },
    {
      name: 'P0-1 五态窗口: 最新 attempt 优先——旧 timeout 不得盖过更新的 content FAIL',
      run: () => {
        const events: GoalRunEvent[] = [
          { type: 'agent_invoke_start', phase: 'spec', invoke_id: 'spec-i1' },
          { type: 'agent_invoke_end', phase: 'spec', invoke_id: 'spec-i1', timed_out: true },
          { type: 'phase_verdict', phase: 'spec', invoke_id: 'spec-i1', failure_kind_classified: 'agent_timeout' },
          { type: 'agent_invoke_start', phase: 'spec', invoke_id: 'spec-i2' },
          { type: 'agent_invoke_end', phase: 'spec', invoke_id: 'spec-i2' },
          { type: 'phase_verdict', phase: 'spec', invoke_id: 'spec-i2', failure_kind_classified: 'code_regression' },
        ];
        const c = deriveContinuationFromEvents(events, 'spec');
        assert(c?.cause === 'content_retry', `expect content_retry got ${c?.cause}`);
      },
    },
    {
      name: 'P0-1 五态窗口: 旧日志无 invoke_id 按事件顺序分窗 fallback',
      run: () => {
        const events: GoalRunEvent[] = [
          { type: 'agent_invoke_start', phase: 'spec' },
          { type: 'agent_invoke_end', phase: 'spec', timed_out: true },
          { type: 'phase_verdict', phase: 'spec', failure_kind_classified: 'agent_timeout' },
        ];
        assert(deriveContinuationFromEvents(events, 'spec')?.cause === 'agent_timeout', 'legacy windowing');
      },
    },
    // ==========================================================================
    // P0-4（plan d9b4f7e2）：连续超时计数 + effective_timeout_ms 单一事实源
    // ==========================================================================
    {
      name: 'P0-4 countConsecutiveAgentTimeouts: FAIL/PASS+unclosed 混排连续计数、非超时 verdict 归零',
      run: () => {
        const v = (fk: string): GoalRunEvent => ({
          type: 'phase_verdict',
          phase: 'spec',
          failure_kind_classified: fk,
        });
        // 07-13 形态：i1 FAIL(timeout) → i2 FAIL(timeout) → i3 PASS+unclosed(timeout) —— 3 连
        assert(
          countConsecutiveAgentTimeouts([v('agent_timeout'), v('agent_timeout'), v('agent_timeout')], 'spec') === 3,
          '三连超时（含 PASS+unclosed 型，分类同为 agent_timeout）',
        );
        // 中间被内容 FAIL 打断 → 只数尾部
        assert(
          countConsecutiveAgentTimeouts([v('agent_timeout'), v('code_regression'), v('agent_timeout')], 'spec') === 1,
          '非超时 verdict 重置连续计数',
        );
        // 其他 phase 的 verdict 不干扰
        assert(
          countConsecutiveAgentTimeouts(
            [v('agent_timeout'), { type: 'phase_verdict', phase: 'plan', failure_kind_classified: 'code_regression' }],
            'spec',
          ) === 1,
          '跨 phase 不串',
        );
        assert(countConsecutiveAgentTimeouts([], 'spec') === 0, '空 events');
      },
    },
    {
      name: 'P0-4 findLatestEffectiveTimeoutMs: 读最近 invoke 事件、旧日志无字段 → null（manifest fallback 口径）',
      run: () => {
        const events: GoalRunEvent[] = [
          { type: 'agent_invoke_start', phase: 'spec', effective_timeout_ms: 2_700_000 },
          { type: 'agent_invoke_start', phase: 'spec', effective_timeout_ms: 4_050_000 },
        ];
        assert(findLatestEffectiveTimeoutMs(events, 'spec') === 4_050_000, '取最近一次（升档后的值）');
        const legacy: GoalRunEvent[] = [{ type: 'agent_invoke_start', phase: 'spec' }];
        assert(findLatestEffectiveTimeoutMs(legacy, 'spec') === null, '旧日志无字段 → null（回落 manifest）');
        assert(findLatestEffectiveTimeoutMs([], 'spec') === null, '无事件 → null');
      },
    },
    // ==========================================================================
    // E0（多模态降级阶梯 plan d4a8f3c6）：能力感知 phase prompt
    // ==========================================================================
    {
      name: 'E0 buildCapabilityBlock: hasVision=true → 不含盲档工作法指令',
      run: () => {
        const advisory: CapabilityAdvisory = {
          hasVision: true,
          ocrAvailable: false,
          effectiveFidelity: 'pixel_1to1',
          fidelityClamped: false,
          ocrJsonPaths: [],
        };
        const text = buildCapabilityBlock(advisory).join('\n');
        assert(/Vision.*YES/.test(text), 'should declare vision YES');
        assert(!/do NOT have vision/i.test(text), 'hasVision=true 不应出现盲档指令');
        assert(!/auto-clamped/.test(text), '未钳制不应提示 auto-clamped');
        assert(!/headless-assumptions\.md/.test(text), '未钳制不应提示记录 headless-assumptions.md');
      },
    },
    {
      name: 'E0 buildCapabilityBlock: hasVision=false + ocrAvailable=true → 盲档工作法 + OCR JSON 列表',
      run: () => {
        const advisory: CapabilityAdvisory = {
          hasVision: false,
          ocrAvailable: true,
          effectiveFidelity: 'semantic_layout',
          fidelityClamped: true,
          ocrJsonPaths: ['doc/features/bc/spec/reports/ocr/home.ocr.json'],
        };
        const text = buildCapabilityBlock(advisory).join('\n');
        assert(/Vision.*NO/.test(text), 'should declare vision NO');
        assert(/do NOT have vision/i.test(text), '盲档应含"不要假装看图"指令');
        assert(/ground truth/i.test(text), '应指示 OCR JSON 为 ground truth');
        assert(/blind-review pending/i.test(text), '应指示登记待复核清单而非反复猜测');
        assert(text.includes('doc/features/bc/spec/reports/ocr/home.ocr.json'), '应列出 OCR JSON 路径');
        assert(/auto-clamped/.test(text), '钳制生效应提示 auto-clamped');
        assert(/headless-assumptions\.md/.test(text), 'cursor review：钳制决策应提示记录进 headless-assumptions.md（审计留痕）');
      },
    },
    {
      name: 'E0 buildCapabilityBlock: hasVision=false + ocrAvailable=false（reference_only 地板）→ 声明无 OCR JSON 可用',
      run: () => {
        const advisory: CapabilityAdvisory = {
          hasVision: false,
          ocrAvailable: false,
          effectiveFidelity: 'reference_only',
          fidelityClamped: true,
          ocrJsonPaths: [],
        };
        const text = buildCapabilityBlock(advisory).join('\n');
        assert(/reference_only/.test(text), '应声明有效档位 reference_only');
        assert(/No OCR JSON available/i.test(text), '应如实声明无 OCR JSON');
        assert(/requirement text only/i.test(text), '应指示仅凭需求文字工作');
        assert(/headless-assumptions\.md/.test(text), '钳制生效应提示记录进 headless-assumptions.md（即便无 OCR）');
      },
    },
    {
      name: 'E0 resolvePhaseCapabilityAdvisory: 非 UI 需求 → null（不注入能力块）',
      run: () => {
        const root = mkCapabilityProject('hmos-app');
        try {
          const resolvedProfile = loadTestResolvedProfile(root);
          const manifest: GoalManifest = {
            ...MINIMAL_MANIFEST,
            adapter: 'chrys',
            requirement: '实现一个定时批量导出 CSV 到对象存储的后台任务，失败重试 3 次。',
          };
          const advisory = resolvePhaseCapabilityAdvisory(manifest, root, FRAMEWORK_ROOT, resolvedProfile, 'spec');
          assert(advisory === null, '非 UI 需求不应注入能力块：' + JSON.stringify(advisory));
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'E0 resolvePhaseCapabilityAdvisory: 非 spec/plan/coding phase（review）→ null（即便 UI 需求）',
      run: () => {
        const root = mkCapabilityProject('hmos-app');
        try {
          const resolvedProfile = loadTestResolvedProfile(root);
          const manifest: GoalManifest = {
            ...MINIMAL_MANIFEST,
            adapter: 'chrys',
            requirement: '银行卡开卡需求，含7个页面，参考图截图设计，严格按参考图还原。',
          };
          const advisory = resolvePhaseCapabilityAdvisory(manifest, root, FRAMEWORK_ROOT, resolvedProfile, 'review');
          assert(advisory === null, 'review phase 不应注入能力块：' + JSON.stringify(advisory));
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
    {
      name: '宿主复验修复①②: plan/coding phase → advisory 非 null 且列出 spec 已产出的 ocr.json（不重跑 OCR、不再谎称无参考图）',
      run: () => {
        const root = mkCapabilityProject('hmos-app');
        try {
          const resolvedProfile = loadTestResolvedProfile(root);
          // 模拟 spec 阶段已产出的 ocr.json（plan/coding 只列出、不生产）
          const ocrDir = path.join(root, 'doc', 'features', 'demo-feature', 'spec', 'reports', 'ocr');
          fs.mkdirSync(ocrDir, { recursive: true });
          fs.writeFileSync(path.join(ocrDir, '1-首页.ocr.json'), '{"ok":true}', 'utf-8');
          fs.writeFileSync(path.join(ocrDir, '2-卡包.ocr.json'), '{"ok":true}', 'utf-8');
          // plan/coding 阶段 spec.md 必然已存在——写一份声明 UI 相关的 spec.md
          const specDir = path.join(root, 'doc', 'features', 'demo-feature', 'spec');
          fs.writeFileSync(path.join(specDir, 'spec.md'), '# spec\n\n```yaml\nui_change: new_or_changed\n```\n', 'utf-8');
          const manifest: GoalManifest = { ...MINIMAL_MANIFEST, adapter: 'chrys' };
          for (const phase of ['plan', 'coding'] as const) {
            const advisory = resolvePhaseCapabilityAdvisory(manifest, root, FRAMEWORK_ROOT, resolvedProfile, phase);
            assert(advisory !== null, `${phase} phase 应注入能力块（宿主复验修复②）`);
            assert(advisory!.hasVision === false, JSON.stringify(advisory));
            assert(
              advisory!.ocrJsonPaths.length === 2,
              `${phase} phase 应列出已存在的 2 份 ocr.json（宿主复验修复①）：${JSON.stringify(advisory!.ocrJsonPaths)}`,
            );
            assert(
              advisory!.ocrJsonPaths.every(p => p.startsWith('doc/features/demo-feature/spec/reports/ocr/')),
              JSON.stringify(advisory!.ocrJsonPaths),
            );
            // 措辞同源：unattended 块应走 blind-review pending 分支而非旧 pixel_1to1 人签死路
            const prompt = buildPhasePrompt(manifest, root, phase, FRAMEWORK_ROOT, [], undefined, undefined, undefined, undefined, advisory);
            assert(!prompt.includes('The only path through pixel_1to1 P0'), `${phase} prompt 不应出现旧 pixel_1to1 措辞`);
            assert(prompt.includes('blind-review'), `${phase} prompt 应含 blind-review pending 指引`);
            assert(prompt.includes('1-首页.ocr.json'), `${phase} prompt 应列出 ocr.json 清单`);
          }
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'E0 resolvePhaseCapabilityAdvisory: hasVision=true（claude adapter）+ 1:1 意图 → 不钳制，effective=pixel_1to1',
      run: () => {
        const root = mkCapabilityProject('hmos-app');
        try {
          const resolvedProfile = loadTestResolvedProfile(root);
          const manifest: GoalManifest = {
            ...MINIMAL_MANIFEST,
            adapter: 'claude', // agents/claude/adapter.yaml 声明 image_input: tool_read
            requirement: '银行卡开卡需求，含7个页面，严格按参考图还原结构、颜色、布局。',
          };
          const advisory = resolvePhaseCapabilityAdvisory(manifest, root, FRAMEWORK_ROOT, resolvedProfile, 'spec');
          assert(advisory !== null, '真实 UI 需求应注入能力块');
          assert(advisory!.hasVision === true, 'claude adapter 应判 hasVision=true');
          assert(advisory!.effectiveFidelity === 'pixel_1to1', 'hasVision=true 不应钳制：' + JSON.stringify(advisory));
          assert(advisory!.fidelityClamped === false, JSON.stringify(advisory));
          assert(advisory!.ocrJsonPaths.length === 0, '有视觉时不应跑 OCR 预扫描：' + JSON.stringify(advisory));
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'E0 resolvePhaseCapabilityAdvisory: hasVision=false（chrys）+ hmos-app profile（OCR 可用）→ 钳到 semantic_layout + OCR 预扫描产出 ocr.json',
      run: () => {
        const root = mkCapabilityProject('hmos-app');
        try {
          const resolvedProfile = loadTestResolvedProfile(root);
          const reqDir = path.join(root, 'doc', 'features', '原始需求', '1-银行卡');
          fs.mkdirSync(reqDir, { recursive: true });
          fs.writeFileSync(path.join(reqDir, 'home.png'), 'fake-png-bytes-not-real-image');
          const manifest: GoalManifest = {
            ...MINIMAL_MANIFEST,
            adapter: 'chrys', // agents/chrys/adapter.yaml 声明 image_input: none
            requirement: '银行卡开卡需求，含7个页面，参考图在doc/features/原始需求/1-银行卡/目录下，严格按参考图还原。',
          };
          const advisory = resolvePhaseCapabilityAdvisory(manifest, root, FRAMEWORK_ROOT, resolvedProfile, 'spec');
          assert(advisory !== null, '真实 UI 需求应注入能力块');
          assert(advisory!.hasVision === false, 'chrys adapter 应判 hasVision=false');
          // hmos-app 在本仓库真实带 tesseract.js + chi_sim.traineddata（已验证随发布件），
          // isOcrAvailable() 应为 true —— 断言与源仓真实环境一致。
          assert(advisory!.ocrAvailable === true, 'hmos-app profile 应判 OCR 可用（本仓库真实 OCR 环境）');
          assert(advisory!.effectiveFidelity === 'semantic_layout', '无视觉+OCR可用应钳至 semantic_layout：' + JSON.stringify(advisory));
          assert(advisory!.fidelityClamped === true, JSON.stringify(advisory));
          // fake-png 内容非真图，jimp/tesseract 可能解析失败——但 OCR 预扫描本身应尝试并落盘
          // （ocrImageWords 对损坏图片的失败处理属 ocr-toolkit 自身职责，非本函数断言范围）。
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'E6 OCR 预扫描产出：真实图片 → ocr.json 含聚类后 lines（候选真文本/列分组，与门禁同源）',
      run: () => {
        const root = mkCapabilityProject('hmos-app');
        try {
          const resolvedProfile = loadTestResolvedProfile(root);
          // 复用既有真实 OCR fixture（ocr-toolkit.unit.test.ts 同款，含可读中文"首页/我的"）——
          // 放进 ux-reference/ 回退发现路径（feature=demo-feature 匹配 MINIMAL_MANIFEST）。
          const uxRefDir = path.join(root, 'doc', 'features', 'demo-feature', 'ux-reference');
          fs.mkdirSync(uxRefDir, { recursive: true });
          const fixtureImg = path.join(
            FRAMEWORK_ROOT, 'profiles', 'hmos-app', 'harness', 'tests', 'fixtures', 'ocr', 'card_pack.png',
          );
          // 宿主复验修复③：用含 CJK 的图名——slug 应保留中文（不再清成匿名"1-"式编号）
          fs.copyFileSync(fixtureImg, path.join(uxRefDir, '1-卡包页.png'));
          const manifest: GoalManifest = {
            ...MINIMAL_MANIFEST,
            adapter: 'chrys',
            requirement: '银行卡开卡需求，含7个页面，参考图截图设计，严格按参考图还原。',
          };
          const advisory = resolvePhaseCapabilityAdvisory(manifest, root, FRAMEWORK_ROOT, resolvedProfile, 'spec');
          assert(advisory !== null, JSON.stringify(advisory));
          if (!advisory!.ocrAvailable) return; // 本机 OCR 环境不可用则跳过（仓库惯例：OCR 门禁自身已守卫）
          assert(advisory!.ocrJsonPaths.length === 1, `应产出 1 份 ocr.json：${JSON.stringify(advisory!.ocrJsonPaths)}`);
          // 宿主复验修复③：CJK 图名应保留在 slug 里（"1-卡包页"而非匿名"1-"）
          assert(
            advisory!.ocrJsonPaths[0].endsWith('/1-卡包页.ocr.json'),
            `slug 应保留 CJK：${advisory!.ocrJsonPaths[0]}`,
          );
          const ocrJsonAbs = path.join(root, advisory!.ocrJsonPaths[0]);
          const parsed = JSON.parse(fs.readFileSync(ocrJsonAbs, 'utf-8'));
          assert(parsed.ok === true, `OCR 应成功：${JSON.stringify(parsed).slice(0, 200)}`);
          // 宿主复验修复③：source_image 回指原参考图，盲 agent 可确定性对应图↔ocr.json
          assert(
            parsed.source_image === 'doc/features/demo-feature/ux-reference/1-卡包页.png',
            `应含 source_image 回指原图：${JSON.stringify(parsed.source_image)}`,
          );
          assert(Array.isArray(parsed.words) && parsed.words.length > 0, '应保留原始 words（完整性/可回溯）');
          assert(Array.isArray(parsed.lines) && parsed.lines.length > 0, `应产出聚类后 lines：${JSON.stringify(parsed).slice(0, 300)}`);
          const line = parsed.lines[0];
          assert(typeof line.text === 'string' && typeof line.y === 'number', JSON.stringify(line));
          // 与门禁同源：至少应能读出"首页"或"我的"（card_pack fixture 的已知内容）
          const hasKnownText = parsed.lines.some((l: { text: string }) => l.text.includes('首页') || l.text.includes('我的'));
          assert(hasKnownText, `应读出已知内容：${JSON.stringify(parsed.lines.map((l: { text: string }) => l.text))}`);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'E0 resolvePhaseCapabilityAdvisory: hasVision=false（chrys）+ generic profile（无 OCR）→ 钳到 reference_only 地板',
      run: () => {
        const root = mkCapabilityProject('generic');
        try {
          const resolvedProfile = loadTestResolvedProfile(root);
          const manifest: GoalManifest = {
            ...MINIMAL_MANIFEST,
            adapter: 'chrys',
            requirement: '银行卡开卡需求，含7个页面，参考图截图设计，严格按参考图还原。',
          };
          const advisory = resolvePhaseCapabilityAdvisory(manifest, root, FRAMEWORK_ROOT, resolvedProfile, 'spec');
          assert(advisory !== null, '真实 UI 需求应注入能力块');
          assert(advisory!.hasVision === false, JSON.stringify(advisory));
          assert(advisory!.ocrAvailable === false, 'generic profile 无 OCR 工具链，应为 false');
          assert(advisory!.effectiveFidelity === 'reference_only', '无视觉+无OCR应钳至地板：' + JSON.stringify(advisory));
          assert(advisory!.fidelityClamped === true, JSON.stringify(advisory));
          assert(advisory!.ocrJsonPaths.length === 0, 'OCR 不可用不应产出 ocr.json：' + JSON.stringify(advisory));
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'E0 buildPhasePrompt: 注入能力块 + unattended 块档位分支同源（盲档不再声称 pixel_1to1 P0 唯一出路）',
      run: () => {
        const blindAdvisory: CapabilityAdvisory = {
          hasVision: false,
          ocrAvailable: true,
          effectiveFidelity: 'semantic_layout',
          fidelityClamped: true,
          ocrJsonPaths: [],
        };
        const prompt = buildPhasePrompt(
          MINIMAL_MANIFEST,
          FRAMEWORK_ROOT,
          'spec',
          FRAMEWORK_ROOT,
          [],
          undefined,
          undefined,
          [],
          [],
          blindAdvisory,
        );
        assert(prompt.includes('Visual capability advisory'), '应注入能力块');
        assert(prompt.includes('do NOT have vision'.toUpperCase()) || /do NOT have vision/i.test(prompt), '应含盲档指令');
        // cursor 硬冲突修正核心断言：非 pixel_1to1 档不得再声称"唯一出路是 pixel_1to1 P0 屏人工确认"
        assert(!/only path through pixel_1to1 P0/i.test(prompt), '盲档下不应再声称 pixel_1to1 P0 是唯一出路：' + prompt);
        assert(/effective fidelity is \*\*semantic_layout\*\*/i.test(prompt), 'unattended 块应报告实际有效档位');
        assert(/blind-review/i.test(prompt), 'unattended 块盲档分支应指向 blind-review 清单');

        const pixelAdvisory: CapabilityAdvisory = {
          hasVision: true,
          ocrAvailable: false,
          effectiveFidelity: 'pixel_1to1',
          fidelityClamped: false,
          ocrJsonPaths: [],
        };
        const pixelPrompt = buildPhasePrompt(
          MINIMAL_MANIFEST,
          FRAMEWORK_ROOT,
          'spec',
          FRAMEWORK_ROOT,
          [],
          undefined,
          undefined,
          [],
          [],
          pixelAdvisory,
        );
        // 真视觉档下原文原样保留（回归保护）
        assert(/only path through pixel_1to1 P0/i.test(pixelPrompt), 'pixel_1to1 档应保留原 HALT for human 措辞');
      },
    },
    {
      name: 'E0 buildPhasePrompt: capabilityAdvisory 未传入（非 UI phase）时 unattended 块行为不变（回归保护）',
      run: () => {
        const prompt = buildPhasePrompt(MINIMAL_MANIFEST, FRAMEWORK_ROOT, 'review', FRAMEWORK_ROOT, []);
        assert(!prompt.includes('Visual capability advisory'), '未传 advisory 不应出现能力块');
        assert(/only path through pixel_1to1 P0/i.test(prompt), '未传 advisory 时应保留原文（向后兼容）');
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
    {
      name: 'f7a3 轮3：pending attempt 收窄（仅 testing、仅最后一个未提交）+ 期望集含 duplicate/recovered',
      run: () => {
        const events = [
          { type: 'agent_invoke_start', phase: 'coding', invoke_id: 'coding-i1' },
          { type: 'agent_invoke_start', phase: 'testing', invoke_id: 'testing-i2' },
          { type: 'visual_round', phase: 'testing', visual_attempt: 'i2', row_hash: 'aaaa000000000000', disposition: 'duplicate' },
          { type: 'agent_invoke_start', phase: 'testing', invoke_id: 'testing-i3' },
          { type: 'agent_invoke_start', phase: 'testing', invoke_id: 'testing-i4' },
        ];
        const pending = collectUncommittedVisualAttemptIds(events as never);
        assert(pending.length === 1 && pending[0] === 'i4', `仅最后一个 testing 未提交 invocation：${JSON.stringify(pending)}`);
        const withRecovery = [
          ...events,
          { type: 'visual_round', phase: 'testing', visual_attempt: 'i3', row_hash: 'bbbb000000000000', disposition: 'recovered' },
        ];
        const expected = collectVisualRoundRowHashes(withRecovery as never);
        assert(expected.includes('aaaa000000000000') && expected.includes('bbbb000000000000'), JSON.stringify(expected));
        const afterRecovery = collectUncommittedVisualAttemptIds(withRecovery as never);
        assert(afterRecovery.length === 1 && afterRecovery[0] === 'i4', 'recovery event 关闭旧 pending 身份');
      },
    },
    // ======================================================================
    // P0-D（b8f36a12）：API 断流哨兵——adapter 感知 + CLI 错误信封锚定
    // ======================================================================
    {
      name: 'P0-D parseHeadlessApiError: claude 81 字节现场原文命中（exit code 无关）',
      run: () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-api-'));
        const logPath = path.join(tmp, 'agent-output.log');
        fs.writeFileSync(
          logPath,
          'API Error: Connection closed mid-response. The response above may be incomplete.\n',
          'utf-8',
        );
        const hit = parseHeadlessApiError(logPath, 'claude');
        assert(hit !== null, 'expected hit');
        assert(hit!.code === 'transient_api_error', hit!.code);
        assert(hit!.matchedLine.includes('Connection closed'), hit!.matchedLine);
        fs.rmSync(tmp, { recursive: true, force: true });
      },
    },
    {
      name: 'f7a3d9c2/t3a stream-json 信封：api_retry 529 → transient；401 鉴权 → 不误归',
      run: () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-api-'));
        const logPath = path.join(tmp, 'agent-output.log');
        // ①529 overloaded：结构化 api_retry 事件 → transient 命中
        fs.writeFileSync(
          logPath,
          [
            JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }),
            JSON.stringify({ type: 'system', subtype: 'api_retry', attempt: 1, error_status: 529, error: 'overloaded' }),
          ].join('\n'),
          'utf-8',
        );
        const hit = parseHeadlessApiError(logPath, 'claude');
        assert(hit !== null && hit.code === 'transient_api_error', `529 应命中：${JSON.stringify(hit)}`);
        // ②401 authentication_failed（2026-07-11 宿主实采形状）：鉴权失败非断流，盲 backoff 会空转
        fs.writeFileSync(
          logPath,
          [
            JSON.stringify({ type: 'system', subtype: 'api_retry', attempt: 1, error_status: 401, error: 'authentication_failed' }),
            JSON.stringify({ type: 'result', subtype: 'success', is_error: true, api_error_status: 401, result: 'Failed to authenticate. API Error: 401 Invalid authentication credentials' }),
          ].join('\n'),
          'utf-8',
        );
        assert(parseHeadlessApiError(logPath, 'claude') === null, '401 鉴权失败不得归 transient_api_error');
        // ③result is_error + api_error_status 503 → transient
        fs.writeFileSync(
          logPath,
          JSON.stringify({ type: 'result', subtype: 'success', is_error: true, api_error_status: 503, result: 'service unavailable' }),
          'utf-8',
        );
        assert(parseHeadlessApiError(logPath, 'claude') !== null, 'result 503 应命中');
        fs.rmSync(tmp, { recursive: true, force: true });
      },
    },
    {
      name: 'P0-D 反向断言（成败点）：银行卡 spec 正文含 HTTP 500/ECONNRESET/连接超时 → 不误吞',
      run: () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-api-'));
        const logPath = path.join(tmp, 'agent-output.log');
        // 真实形态：agent result 正文讨论网络错误处理（E1 网络异常在验收场景里）
        fs.writeFileSync(
          logPath,
          [
            '已完成 spec.md 撰写，包含以下验收场景：',
            '- E1 网络异常：请求超时（ETIMEDOUT）或连接被重置（ECONNRESET）时展示重试页',
            '- E2 服务端异常：HTTP 500 / 502 / 503 返回统一错误页，支持 rate limit (429) 退避',
            '- E3 验证码过期：terminated session 需重新发起',
            'spec 文件已写入 doc/features/bc-openCard/spec/spec.md，harness 已通过。',
          ].join('\n'),
          'utf-8',
        );
        assert(parseHeadlessApiError(logPath, 'claude') === null, '正常 result 正文不得误判断流');
        fs.rmSync(tmp, { recursive: true, force: true });
      },
    },
    {
      name: 'P0-D 信封须尾部主导：行首 API Error 但其后仍有大量 result → 不命中（正文引用）',
      run: () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-api-'));
        const logPath = path.join(tmp, 'agent-output.log');
        const lines = ['API Error: rate limit (429) handling strategy is documented below.'];
        for (let i = 0; i < 10; i++) lines.push(`第 ${i + 1} 节：正常产出内容……`);
        fs.writeFileSync(logPath, lines.join('\n'), 'utf-8');
        assert(parseHeadlessApiError(logPath, 'claude') === null, '非尾部主导不得命中');
        fs.rmSync(tmp, { recursive: true, force: true });
      },
    },
    {
      name: 'P0-D adapter 感知：claude 纯文本串喂 chrys 路径不命中；chrys JSON error 命中',
      run: () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-api-'));
        const claudeLog = path.join(tmp, 'claude.log');
        fs.writeFileSync(
          claudeLog,
          'API Error: Connection closed mid-response. The response above may be incomplete.\n',
          'utf-8',
        );
        assert(parseHeadlessApiError(claudeLog, 'chrys') === null, 'chrys 走 JSON 解析，纯文本不命中');
        const chrysLog = path.join(tmp, 'chrys.log');
        fs.writeFileSync(
          chrysLog,
          ['noise', '{"code":"stream_error","error":"connection reset: ECONNRESET mid stream"}'].join('\n'),
          'utf-8',
        );
        const hit = parseHeadlessApiError(chrysLog, 'chrys');
        assert(hit !== null, 'chrys JSON error 带断流特征应命中');
        fs.rmSync(tmp, { recursive: true, force: true });
      },
    },
    {
      name: 'P0-D 保守面：0 字节 → null（走 agent_no_output 兜底）；未知 adapter → null（不承诺）',
      run: () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-api-'));
        const emptyLog = path.join(tmp, 'empty.log');
        fs.writeFileSync(emptyLog, '', 'utf-8');
        assert(parseHeadlessApiError(emptyLog, 'claude') === null, '0 字节不冒充断流');
        const codexLog = path.join(tmp, 'codex.log');
        fs.writeFileSync(codexLog, 'stream error: connection closed mid-response\n', 'utf-8');
        assert(parseHeadlessApiError(codexLog, 'codex') === null, 'codex 信封未实测，不承诺检测');
        fs.rmSync(tmp, { recursive: true, force: true });
      },
    },
    // ======================================================================
    // P0-B/P0-D：classifier 信号优先级 + 专用 signature + halt kinds
    // ======================================================================
    {
      name: 'P0-B classifyFailureKind: agentTimedOut 优先于 blocker（即便 spec_file_exists）',
      run: () => {
        const k = classifyFailureKind(
          { verdict: 'FAIL', blockers: [{ id: 'spec_file_exists' }] },
          undefined,
          { agentTimedOut: true },
        );
        assert(k === 'agent_timeout', k);
      },
    },
    {
      name: 'P0-D classifyFailureKind: agentApiError → transient_api_error（优先于 blocker）；B/D 并存 timeout 胜',
      run: () => {
        const kApi = classifyFailureKind(
          { verdict: 'FAIL', blockers: [{ id: 'spec_file_exists' }] },
          undefined,
          { agentApiError: true },
        );
        assert(kApi === 'transient_api_error', kApi);
        const kBoth = classifyFailureKind({ verdict: 'FAIL' }, undefined, {
          agentTimedOut: true,
          agentApiError: true,
        });
        assert(kBoth === 'agent_timeout', `B/D 并存应 agent_timeout，实得 ${kBoth}`);
      },
    },
    {
      name: 'P0-D classifyFailureKind: agentNoOutput → agent_no_output；无信号走原 blocker 归因',
      run: () => {
        const k = classifyFailureKind({ verdict: 'FAIL' }, undefined, { agentNoOutput: true });
        assert(k === 'agent_no_output', k);
        const kPlain = classifyFailureKind(
          { verdict: 'FAIL', blockers: [{ id: 'spec_file_exists' }] },
          undefined,
          {},
        );
        assert(kPlain === 'deterministic_gate_or_artifact_missing', `无信号回落 blocker：${kPlain}`);
      },
    },
    // ======================================================================
    // E4（多模态降级阶梯 plan d4a8f3c6）：案B chrys 银行卡实证 —— agentTimedOut 遮蔽人签墙
    // + operator_interrupt 误判 + 事件回放累计熔断
    // ======================================================================
    {
      name: 'E4 classifyFailureKind: agentTimedOut + blockers 全为 await_human_confirm → await_human_confirm（不再 agent_timeout）',
      run: () => {
        const k = classifyFailureKind(
          {
            verdict: 'FAIL',
            blockers: [
              { id: 'visual_diff', classification: 'await_human_confirm' },
              { id: 'visual_diff_2', classification: 'await_human_confirm' },
            ],
          },
          undefined,
          { agentTimedOut: true },
        );
        assert(k === 'await_human_confirm', `全 await_human 时应让位，实得 ${k}`);
      },
    },
    {
      name: 'E4 classifyFailureKind: agentTimedOut + blockers 混合(非全 await_human) → 仍 agent_timeout',
      run: () => {
        const k = classifyFailureKind(
          {
            verdict: 'FAIL',
            blockers: [
              { id: 'visual_diff', classification: 'await_human_confirm' },
              { id: 'spec_file_exists' },
            ],
          },
          undefined,
          { agentTimedOut: true },
        );
        assert(k === 'agent_timeout', `混合家族不应让位，实得 ${k}`);
        const kEmpty = classifyFailureKind({ verdict: 'PASS' }, undefined, { agentTimedOut: true });
        assert(kEmpty === 'agent_timeout', `无 blocker（PASS+超时）应仍 agent_timeout，实得 ${kEmpty}`);
      },
    },
    {
      name: 'E4 classifyFailureKind: operatorInterrupt 压过一切（含同时 agentTimedOut/agentApiError）',
      run: () => {
        const k = classifyFailureKind(
          { verdict: 'FAIL', blockers: [{ id: 'spec_file_exists' }] },
          undefined,
          { operatorInterrupt: true, agentTimedOut: true, agentApiError: true },
        );
        assert(k === 'operator_interrupt', `operator_interrupt 必须最高优先，实得 ${k}`);
      },
    },
    {
      name: 'E4 isOperatorInterruptSignal: Windows STATUS_CONTROL_C_EXIT / POSIX SIGINT / 均非',
      run: () => {
        assert(isOperatorInterruptSignal(WINDOWS_CTRL_C_EXIT_CODE, null) === true, 'win ctrl+c exit code');
        assert(isOperatorInterruptSignal(3221225786, undefined) === true, 'raw literal must match constant');
        assert(isOperatorInterruptSignal(1, 'SIGINT') === true, 'posix SIGINT');
        assert(isOperatorInterruptSignal(1, 'SIGTERM') === false, 'SIGTERM 是我方 tree-kill，非用户中断');
        assert(isOperatorInterruptSignal(1, null) === false, '普通失败不得误判');
      },
    },
    {
      name: 'E4 countCumulativeAdvanceBlocked: 跨 attempt 累计（不看具体 reason），忽略他 phase/非 phase_verdict',
      run: () => {
        const events: GoalRunEvent[] = [
          { type: 'phase_verdict', phase: 'spec', advance_blocked: true, advance_block_reason: 'closure_open' },
          { type: 'phase_verdict', phase: 'spec', advance_blocked: false },
          { type: 'phase_verdict', phase: 'spec', advance_blocked: true, advance_block_reason: 'agent_timeout_unclosed' },
          { type: 'phase_verdict', phase: 'plan', advance_blocked: true, advance_block_reason: 'closure_open' },
          { type: 'agent_invoke_end', phase: 'spec' },
        ];
        assert(countCumulativeAdvanceBlocked(events, 'spec') === 2, `应数到 2，reason 不同也累计；实得 ${countCumulativeAdvanceBlocked(events, 'spec')}`);
        assert(countCumulativeAdvanceBlocked(events, 'plan') === 1, '不同 phase 隔离统计');
        assert(countCumulativeAdvanceBlocked(events, 'coding') === 0, '未出现的 phase 为 0');
      },
    },
    {
      name: 'E4 countRepeatedSignatureInFamily: 同 signature 在家族内累计，非家族/异 signature 不计',
      run: () => {
        const sig = 'visual_parity_ocr_unavailable';
        const events: GoalRunEvent[] = [
          { type: 'phase_verdict', phase: 'spec', blocker_signature: sig, failure_kind_classified: 'toolchain' },
          { type: 'phase_verdict', phase: 'spec', blocker_signature: sig, failure_kind_classified: 'code_regression' }, // 非家族，不计
          { type: 'phase_verdict', phase: 'spec', blocker_signature: 'other_sig', failure_kind_classified: 'toolchain' }, // 异 signature，不计
          { type: 'phase_verdict', phase: 'spec', blocker_signature: sig, failure_kind_classified: 'toolchain' },
        ];
        const n = countRepeatedSignatureInFamily(events, 'spec', sig, CUMULATIVE_HALT_FAMILY);
        assert(n === 2, `应数到 2，实得 ${n}`);
        assert(countRepeatedSignatureInFamily(events, 'spec', '', CUMULATIVE_HALT_FAMILY) === 0, '空 signature 恒 0');
      },
    },
    {
      name: 'E4 阈值常量：ADVANCE_BLOCKED_HALT_THRESHOLD=2（首次给机会/第二次即halt）、CUMULATIVE_HALT_THRESHOLD=3',
      run: () => {
        assert(ADVANCE_BLOCKED_HALT_THRESHOLD === 2, String(ADVANCE_BLOCKED_HALT_THRESHOLD));
        assert(CUMULATIVE_HALT_THRESHOLD === 3, String(CUMULATIVE_HALT_THRESHOLD));
        assert(CUMULATIVE_HALT_FAMILY.has('toolchain'), 'toolchain in family');
        assert(CUMULATIVE_HALT_FAMILY.has('await_human_confirm'), 'await_human_confirm in family');
      },
    },
    {
      name: 'E4 buildClosureWallGuidance: 含 feature/run/receipt 路径/续跑命令，与 visual-confirm 引导独立',
      run: () => {
        const lines = buildClosureWallGuidance({
          feature: 'bc-openCard',
          runId: '20260708T023859Z',
          phase: 'spec',
          receiptPathRel: 'doc/features/bc-openCard/spec/phase-completion-receipt.md',
          harnessPrefixRel: 'framework/harness',
          receiptStatus: 'failed',
          cumulativeBlockedCount: 2,
        });
        const text = lines.join('\n');
        assert(text.includes('bc-openCard'), 'feature 名须出现');
        assert(text.includes('第 2 次'), '须报告累计次数');
        assert(text.includes('phase-completion-receipt.md'), '须指向 receipt 路径');
        assert(text.includes('--resume 20260708T023859Z --force-resume'), '须给续跑命令');
        assert(!text.includes('device-screenshots'), '不得混用 visual-confirm 的截图话术');
      },
    },
    {
      name: 'P0-B §七.3 buildEffectiveBlockerSignature: 无 blocker + agent_timeout → agent_timeout@<phase>',
      run: () => {
        const sig = buildEffectiveBlockerSignature({ verdict: 'PASS' }, 'agent_timeout', 'spec');
        assert(sig === 'agent_timeout@spec', sig);
        const withBlockers = buildEffectiveBlockerSignature(
          { blockers: [{ id: 'b' }, { id: 'a' }] },
          'agent_timeout',
          'spec',
        );
        assert(withBlockers === 'a|b', `有 blocker 保留原 signature：${withBlockers}`);
        const other = buildEffectiveBlockerSignature({ verdict: 'FAIL' }, 'code_regression', 'spec');
        assert(other === '', `非 timeout 空 blocker 仍空：${other}`);
      },
    },
    {
      name: 'P0-B/P0-D SIGNATURE_HALT_KINDS: agent_timeout 在；transient_api_error / agent_no_output 不在',
      run: () => {
        assert(SIGNATURE_HALT_KINDS.has('agent_timeout'), 'agent_timeout 应可零进展熔断');
        assert(!SIGNATURE_HALT_KINDS.has('transient_api_error'), 'transient 走独立 backoff，不熔断');
        assert(!SIGNATURE_HALT_KINDS.has('agent_no_output'), 'no_output 第一次即 halt，无需 signature 熔断');
      },
    },
    {
      name: 'P0-B shouldHaltNoProgress: agent_timeout 同专用 signature + 产物零变化 → halt；产物变化 → 续作',
      run: () => {
        const sig = 'agent_timeout@spec';
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-timeout-prog-'));
        const rel = 'doc/features/f/spec/spec.md';
        const abs = path.join(tmp, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, 'partial-v1', 'utf-8');
        const snap1 = snapshotArtifacts(tmp, [rel]);
        assert(
          shouldHaltNoProgress({
            failureKind: 'agent_timeout',
            priorBlockerSignature: sig,
            currentBlockerSignature: sig,
            priorArtifactSnapshot: snap1,
            currentArtifactSnapshot: snap1,
          }),
          '零进展连续超时应熔断（不再空 signature 逃逸）',
        );
        fs.writeFileSync(abs, 'partial-v2 更多章节', 'utf-8');
        const snap2 = snapshotArtifacts(tmp, [rel]);
        assert(
          !shouldHaltNoProgress({
            failureKind: 'agent_timeout',
            priorBlockerSignature: sig,
            currentBlockerSignature: sig,
            priorArtifactSnapshot: snap1,
            currentArtifactSnapshot: snap2,
          }),
          '产物内容有进展应放行续作',
        );
        fs.rmSync(tmp, { recursive: true, force: true });
      },
    },
    // ======================================================================
    // P0-D：runner 配套（backoff 表 / 跨 resume 计数 / prompt 指导）
    // ======================================================================
    {
      name: 'P0-D TRANSIENT_API_BACKOFF_MS = 5s→15s→45s（§六-5 拍板）',
      run: () => {
        assert(
          JSON.stringify([...TRANSIENT_API_BACKOFF_MS]) === JSON.stringify([5000, 15000, 45000]),
          TRANSIENT_API_BACKOFF_MS.join(','),
        );
      },
    },
    {
      name: 'P0-D countTransientApiRetries: 按 phase 从 events 派生（跨 continue/--resume 不清零）',
      run: () => {
        const events = [
          { type: 'run_start' },
          { type: 'transient_api_retry_scheduled', phase: 'spec' },
          { type: 'transient_api_retry_scheduled', phase: 'spec' },
          { type: 'transient_api_retry_scheduled', phase: 'plan' },
          { type: 'run_end' },
          { type: 'run_start' }, // resume 后计数不清零——事件流即 SSOT
        ];
        assert(countTransientApiRetries(events, 'spec') === 2, 'spec 应派生 2');
        assert(countTransientApiRetries(events, 'plan') === 1, 'plan 应派生 1');
        assert(countTransientApiRetries(events, 'coding') === 0, 'coding 应 0');
      },
    },
    {
      name: 'P0-D buildPhasePrompt: transient_api_error 指导"断流续作"，不指导 revert/修 blocker',
      run: () => {
        const prompt = buildPhasePrompt(
          MINIMAL_MANIFEST,
          FRAMEWORK_ROOT,
          'spec',
          FRAMEWORK_ROOT,
          [],
          'Verdict: FAIL\n- spec_file_exists',
          'transient_api_error',
        );
        assert(prompt.includes('CONNECTION DROP'), '缺断流定性');
        assert(!prompt.includes('revert that change first'), '断流不应指导回滚');
        assert(prompt.includes('do NOT redo exploration') || prompt.includes('partial work'), '缺续作指导');
      },
    },
    {
      name: 'P0-B buildPhasePrompt: agent_timeout 指导续作不回滚',
      run: () => {
        const prompt = buildPhasePrompt(
          MINIMAL_MANIFEST,
          FRAMEWORK_ROOT,
          'spec',
          FRAMEWORK_ROOT,
          [],
          'Verdict: FAIL\n- context_exploration_exists_false',
          'agent_timeout',
        );
        assert(prompt.includes('agent_timeout'), '缺超时定性');
        assert(!prompt.includes('revert that change first'), '超时不应指导回滚');
      },
    },
    // ======================================================================
    // P0-D round2（codex P1/P2）：跨 resume 断流语义恢复 + 空产出不吞 preflight 诊断
    // ======================================================================
    {
      name: 'codex P1 lastPhaseVerdictTransientApiError: 最近 verdict=transient → true；他因/无 verdict → false',
      run: () => {
        const events = [
          { type: 'phase_verdict', phase: 'spec', failure_kind_classified: 'code_regression' },
          { type: 'phase_verdict', phase: 'spec', failure_kind_classified: 'transient_api_error' },
        ];
        assert(lastPhaseVerdictTransientApiError(events, 'spec'), '最近一次 transient 应 true');
        const older = [
          { type: 'phase_verdict', phase: 'spec', failure_kind_classified: 'transient_api_error' },
          { type: 'phase_verdict', phase: 'spec', failure_kind_classified: 'deterministic_gate_or_artifact_missing' },
        ];
        assert(!lastPhaseVerdictTransientApiError(older, 'spec'), '仅取最近一次（旧 transient 不算）');
        assert(!lastPhaseVerdictTransientApiError([], 'spec'), '无 verdict → false');
        assert(
          !lastPhaseVerdictTransientApiError(
            [{ type: 'phase_verdict', phase: 'plan', failure_kind_classified: 'transient_api_error' }],
            'spec',
          ),
          '他 phase 的 verdict 不串台',
        );
      },
    },
    {
      name: 'codex P2 isAgentNoOutputSignal: binary 短路（无 duration）不吞；真空产出命中；正常时长/超时不命中',
      run: () => {
        // invokeAgentHeadless binary 不可 spawn 短路：exitCode=1、无 duration_ms、不写 log
        assert(
          !isAgentNoOutputSignal({ exitCode: 1 }, 0, 30_000),
          'preflight 短路（duration 缺失）不得判 agent_no_output——stderr 诊断须保真',
        );
        // 真空产出：spawn 过（有 duration）、极短、0 字节、非零退出
        assert(
          isAgentNoOutputSignal({ exitCode: 1, duration_ms: 4_000 }, 0, 30_000),
          '真空产出应命中',
        );
        assert(
          !isAgentNoOutputSignal({ exitCode: 1, duration_ms: 120_000 }, 0, 30_000),
          '正常时长不命中（agent 干过活）',
        );
        assert(
          !isAgentNoOutputSignal({ exitCode: 1, duration_ms: 4_000, timed_out: true }, 0, 30_000),
          '超时优先，不判空产出',
        );
        assert(
          !isAgentNoOutputSignal({ exitCode: 0, duration_ms: 4_000 }, 0, 30_000),
          'exit 0 不判空产出',
        );
        assert(
          !isAgentNoOutputSignal({ exitCode: 1, duration_ms: 4_000 }, 81, 30_000),
          '非空日志不判空产出（走断流哨兵）',
        );
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
