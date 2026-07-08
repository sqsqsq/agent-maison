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
  countTransientApiRetries,
  countCumulativeAdvanceBlocked,
  countRepeatedSignatureInFamily,
  isAgentNoOutputSignal,
  lastPhaseVerdictTransientApiError,
  type GoalRunEvent,
} from '../../scripts/utils/goal-runner-phase';
import {
  buildPhasePrompt,
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
      name: 'buildPhasePrompt: P1-B 超时 partial 产物注入续作块',
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
        );
        assert(prompt.includes('TIMED OUT'), '缺超时续作标题');
        assert(prompt.includes('do NOT redo exploration'), '缺"勿从零重做探索"指令');
        assert(prompt.includes('review-report.md'), '缺 partial 产物清单');
      },
    },
    {
      name: 'buildPhasePrompt: 无 partial 产物时不注入续作块',
      run: () => {
        const prompt = buildPhasePrompt(MINIMAL_MANIFEST, FRAMEWORK_ROOT, 'review', FRAMEWORK_ROOT, [], undefined, undefined, []);
        assert(!prompt.includes('TIMED OUT'), '空清单不应注入续作块');
      },
    },
    {
      name: 'buildPhasePrompt: P2 skip-lines 注入续作块（无 artifacts 也生效）',
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
        );
        assert(prompt.includes('TIMED OUT'), '仅 skip-lines 也应注入续作块');
        assert(prompt.includes('src/a.ets'), '缺 skip-list 文件');
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
      name: 'E0 resolvePhaseCapabilityAdvisory: 非 spec/coding phase → null（即便 UI 需求）',
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
          fs.copyFileSync(fixtureImg, path.join(uxRefDir, 'card_pack.png'));
          const manifest: GoalManifest = {
            ...MINIMAL_MANIFEST,
            adapter: 'chrys',
            requirement: '银行卡开卡需求，含7个页面，参考图截图设计，严格按参考图还原。',
          };
          const advisory = resolvePhaseCapabilityAdvisory(manifest, root, FRAMEWORK_ROOT, resolvedProfile, 'spec');
          assert(advisory !== null, JSON.stringify(advisory));
          if (!advisory!.ocrAvailable) return; // 本机 OCR 环境不可用则跳过（仓库惯例：OCR 门禁自身已守卫）
          assert(advisory!.ocrJsonPaths.length === 1, `应产出 1 份 ocr.json：${JSON.stringify(advisory!.ocrJsonPaths)}`);
          const ocrJsonAbs = path.join(root, advisory!.ocrJsonPaths[0]);
          const parsed = JSON.parse(fs.readFileSync(ocrJsonAbs, 'utf-8'));
          assert(parsed.ok === true, `OCR 应成功：${JSON.stringify(parsed).slice(0, 200)}`);
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
