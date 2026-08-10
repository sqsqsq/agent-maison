// ============================================================================
// goal-canary-pin-binding-d7f3a9c4.unit.test.ts — plan d7f3a9c4 t3
// pin 与金丝雀身份绑定 + telemetry 复用（warning-only）
// ----------------------------------------------------------------------------
// 覆盖（对照 plan t3 验收）：
//  A. 共享身份谓词 canaryAdmissibleForExecution（{runId, modelPin} 二元，无 pin 退化
//     canaryAdmissibleForRun；interactive 不绑 run 但 pin 在场仍须模型匹配）。
//  B. 中央两处（decideVisionCanaryProbe 重探判定 / 三轴 resolver 采信判定）共用同一谓词
//     ——skip ⟺ resolver 采信；有 pin 时模型/run 任一不符即 probe/不采信；无 pin 保持现状。
//  C. receipt 写入：有 pin 记 pin.value；无 pin 仍记 'unknown'。
//  D. 五个消费面逐一 pin-aware：image_input / OCR / tool_read / LKG（goal-runner 接线）/
//     pixel_1to1（hmos profile 经 readCanaryToolReadSignal）。
//  E. 三条 env 传播链：buildAgentSpawnEnv（extraEnv）/ phase-state child env（goalIdentity）/
//     goal-runner 源码接线（extraEnv + gateInjectedEnv + goalIdentity 透传）；大小写清理；
//     无 pin 不注入。
//  F. telemetry：observed==pin 无告警；observed!=pin 出 pin_verify_mismatch；两者均不改
//     verdict/manifest/路由（warning-only 源码接线断言）。
//  G. 两条生产链级回归（真实消费链，非纯函数）：旧 canary 模型失配 / 同模型跨 run，
//     重探遇 auth/quota 不写盘 → 旧缓存不影响 image_input/OCR/tool_read/fidelity/pixel_1to1。
// ============================================================================

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { UnitCaseResult } from '../run-unit';
import {
  resolveEffectiveVisionContext,
} from '../../scripts/utils/effective-vision-context';
import {
  decideVisionCanaryProbe,
  runVisionCanaryProbe,
} from '../../scripts/utils/goal-preflight';
import {
  loadLocalConfig,
  writeLocalConfig,
  type FrameworkLocalConfigVisionCanary,
} from '../../scripts/utils/framework-local-config';
import type { GoalManifest } from '../../scripts/utils/goal-manifest';
import {
  applyGoalModelPinEnv,
  MAISON_GOAL_MODEL_PIN_ENV,
  MAISON_GOAL_HEADLESS_ENV,
} from '../../scripts/utils/phase-state';
import {
  buildAgentSpawnEnv,
  type invokeAgentHeadless,
} from '../../scripts/utils/agent-invoke';
import {
  canaryAdmissibleForRun,
  canaryAdmissibleForExecution,
  isFreshCanaryForExecution,
  resolveContextAdapterImageInput,
  readCanaryOcrCapableSignal,
  readCanaryToolReadSignal,
} from '../../scripts/utils/multimodal-probe';
import { resolvePinVerifyMismatch } from '../../scripts/utils/claude-envelope';
import {
  generateGoalReportMarkdown,
  type GoalReport,
} from '../../scripts/utils/goal-report-generator';
import type { CheckContext } from '../../scripts/utils/types';
import { clearFrameworkConfigCache, featureFilePath } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
import { DEFAULT_LAYOUT } from '../utils/layout-test-helper';
import { checkUiSpecFidelityGate } from '../../../profiles/hmos-app/harness/spec-ui-spec-check';
import { VISION_CANARY_PROBE_VERSION } from '../../scripts/utils/vision-canary';
import { FIXTURE_CANARY_KEY } from '../utils/canary-fixture-key';

const UI_REQ = '银行卡开卡需求，含7个页面，参考图还原布局。';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'goal-canary-pin-'));
}

function baseManifest(over: Partial<GoalManifest> = {}): GoalManifest {
  return {
    schema_version: '1.0',
    run_id: 'run-R2',
    feature: 'demo',
    requirement: UI_REQ,
    adapter: 'chrys',
    start_phase: 'spec',
    end_phase: 'spec',
    report_dir: 'doc/features/demo/goal-runs/run-R2',
    created_at: '2026-06-09T00:00:00Z',
    unattended: { write_mode: 'workspace-write', approval_mode: 'never' },
    budget: {
      max_total_turns: 10,
      max_retries_per_phase: 1,
      wall_clock_minutes: 60,
      max_transient_api_retries: 3,
    },
    dependency_policy: { deferrable_blocking_classes: [], deferrable_failure_kinds: [], propagate_to_downstream: true },
    ...over,
  };
}

function freshCanary(over: Partial<FrameworkLocalConfigVisionCanary>): FrameworkLocalConfigVisionCanary {
  return {
    adapter: 'chrys',
    verdict: 'tool_read',
    probed_at: new Date(Date.now() - 60_000).toISOString(),
    probed_via: 'goal',
    probe_version: VISION_CANARY_PROBE_VERSION,
    ...over,
  };
}

function writeCanary(root: string, canary: FrameworkLocalConfigVisionCanary): void {
  writeLocalConfig(root, { schema_version: '1.0', vision: { canary } });
}

/** 真实消费链的 frameworkRoot 夹具：chrys 无 adapter.yaml → 声明式/heuristic 回退 none。 */
function chrysFrameworkRoot(root: string): string {
  const fw = path.join(root, 'fw');
  fs.mkdirSync(path.join(fw, 'agents', 'chrys'), { recursive: true });
  return fw;
}

/** runVisionCanaryProbe 写盘边界的最小 claude frameworkRoot（同 goal-preflight 用例）。 */
function claudeFrameworkFixture(root: string): string {
  const fw = path.join(root, 'fw');
  const adapterDir = path.join(fw, 'agents', 'claude');
  fs.mkdirSync(adapterDir, { recursive: true });
  fs.writeFileSync(
    path.join(adapterDir, 'adapter.yaml'),
    [
      'adapter_name: claude',
      'goal_capability:',
      '  mode: native_goal',
      '  native_goal:',
      '    goal_condition_template: templates/goal-condition.md',
      '    supports_resume: false',
      '  external_runner:',
      '    headless_invoke: \'claude -p "{{PROMPT}}"\'',
      '    unattended:',
      '      write_mode: accept-edits',
      '      approval_mode: never',
    ].join('\n'),
    'utf-8',
  );
  return fw;
}

const FULL_ANSWER =
  'TOP_LEFT_COLOR=red\nTOP_RIGHT_COLOR=blue\nBOTTOM_LEFT_COLOR=green\nBOTTOM_RIGHT_COLOR=yellow\nTEXT_TOKEN=MAISON7X3Q';

const AUTH_QUOTA_STDOUT = 'ActionRequiredError: You have hit your usage limit. Get Pro for more.';

const cases: Array<{ name: string; run: () => void | Promise<void> }> = [
  // ==========================================================================
  // A. 共享身份谓词 canaryAdmissibleForExecution
  // ==========================================================================
  {
    name: 't3 谓词：run 必查（goal 跨 run 拒绝）、model 按 pin 追加、无 pin 退化 canaryAdmissibleForRun、interactive 不绑 run 但 pin 在场仍须模型匹配',
    run: () => {
      const goalR1M = freshCanary({ model: 'gpt-4o', run_id: 'R1' });
      const goalR2M = freshCanary({ model: 'gpt-4o', run_id: 'R2' });
      const goalR2Other = freshCanary({ model: 'sonnet', run_id: 'R2' });
      const interactiveM = freshCanary({ model: 'gpt-4o', probed_via: 'interactive' });
      const interactiveOther = freshCanary({ model: 'sonnet', probed_via: 'interactive' });
      // 身份二元：run + model 都要对
      assert.strictEqual(canaryAdmissibleForExecution(goalR2M, { runId: 'R2', modelPin: 'gpt-4o' }), true);
      assert.strictEqual(canaryAdmissibleForExecution(goalR1M, { runId: 'R2', modelPin: 'gpt-4o' }), false, '同模型跨 run 必须拒');
      assert.strictEqual(canaryAdmissibleForExecution(goalR2Other, { runId: 'R2', modelPin: 'gpt-4o' }), false, 'run 同但模型不符必须拒');
      assert.strictEqual(canaryAdmissibleForExecution(goalR2M, { runId: 'R2' }), true, '无 pin 退化为 canaryAdmissibleForRun');
      assert.strictEqual(canaryAdmissibleForExecution(goalR1M, { runId: 'R2' }), false, '无 pin 仍保持 run 绑定');
      // 无 run_id 的 goal 旧缓存（无证明属本 run）必须拒——07-24 事故形态
      assert.strictEqual(canaryAdmissibleForExecution(freshCanary({ model: 'gpt-4o' }), { runId: 'R2', modelPin: 'gpt-4o' }), false);
      // interactive：不绑 run，但 pin 在场模型必须匹配
      assert.strictEqual(canaryAdmissibleForExecution(interactiveM, { runId: 'R2', modelPin: 'gpt-4o' }), true);
      assert.strictEqual(canaryAdmissibleForExecution(interactiveOther, { runId: 'R2', modelPin: 'gpt-4o' }), false, '交互 canary 模型不符也不得复用');
      assert.strictEqual(canaryAdmissibleForExecution(interactiveOther, { runId: 'R2' }), true, '无 pin 时 interactive 不绑 run 不绑 model');
      // 空/坏 canary
      assert.strictEqual(canaryAdmissibleForExecution(undefined, { runId: 'R2', modelPin: 'gpt-4o' }), false);
      assert.strictEqual(canaryAdmissibleForExecution(null, { runId: 'R2', modelPin: 'gpt-4o' }), false);
    },
  },

  // ==========================================================================
  // B. 中央两处：decideVisionCanaryProbe（重探判定）
  // ==========================================================================
  {
    name: 't3 中央重探判定：有 pin 时模型不符/跨 run → probe；模型匹配+run 匹配 → skip；无 pin 保持现状',
    run: () => {
      const root = mkTmp();
      try {
        // 旧 canary：正确 run_id=R2、但 model=sonnet ≠ pin=gpt-4o → 重探
        writeCanary(root, freshCanary({ model: 'sonnet', run_id: 'run-R2' }));
        const mPin = baseManifest({ adapter_model_pin: { adapter: 'chrys', value: 'gpt-4o' } });
        assert.deepStrictEqual(
          decideVisionCanaryProbe({ projectRoot: root, manifest: mPin, chain: ['spec'], dryRun: false }),
          { action: 'probe', reason: 'fresh_but_not_admissible_for_run' },
          '同 run_id 但模型失配必须重探（resume 改 pin 漏洞）',
        );
        // 同模型跨 run → 重探
        writeCanary(root, freshCanary({ model: 'gpt-4o', run_id: 'R1' }));
        assert.deepStrictEqual(
          decideVisionCanaryProbe({ projectRoot: root, manifest: mPin, chain: ['spec'], dryRun: false }),
          { action: 'probe', reason: 'fresh_but_not_admissible_for_run' },
          '同模型跨 run 必须重探（身份只比 model 不够）',
        );
        // 模型匹配 + run 匹配 + pin → skip
        writeCanary(root, freshCanary({ model: 'gpt-4o', run_id: 'run-R2' }));
        assert.deepStrictEqual(
          decideVisionCanaryProbe({ projectRoot: root, manifest: mPin, chain: ['spec'], dryRun: false }),
          { action: 'skip', reason: 'fresh_cache_present' },
        );
        // 无 pin：现状——fresh + run 匹配 → skip；跨 run → probe（run 绑定一步不少）
        writeCanary(root, freshCanary({ run_id: 'run-R2' }));
        assert.deepStrictEqual(
          decideVisionCanaryProbe({ projectRoot: root, manifest: baseManifest(), chain: ['spec'], dryRun: false }),
          { action: 'skip', reason: 'fresh_cache_present' },
        );
        writeCanary(root, freshCanary({ run_id: 'R1' }));
        assert.deepStrictEqual(
          decideVisionCanaryProbe({ projectRoot: root, manifest: baseManifest(), chain: ['spec'], dryRun: false }),
          { action: 'probe', reason: 'fresh_but_not_admissible_for_run' },
          '无 pin 时中央重探判定仍须保持 run 绑定（防 v5 公式退化回归）',
        );
        // 交互式 canary：无 pin 时 fresh 即 skip（现状）；有 pin + 模型不符 → probe
        writeCanary(root, freshCanary({ model: 'sonnet', probed_via: 'interactive' }));
        assert.deepStrictEqual(
          decideVisionCanaryProbe({ projectRoot: root, manifest: mPin, chain: ['spec'], dryRun: false }),
          { action: 'probe', reason: 'fresh_but_not_admissible_for_run' },
          '交互 canary 模型不符在有 pin 时不得被跳过重探',
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },

  // ==========================================================================
  // B'. 中央两处：三轴 resolver 采信判定（resolveEffectiveVisionContext）
  // ==========================================================================
  {
    name: 't3 三轴 resolver：有 pin 时模型/run 任一不符 → 不采信 run_probed；无 pin 保持现状',
    run: () => {
      const root = mkTmp();
      try {
        const fw = chrysFrameworkRoot(root);
        // run 匹配 + model 匹配 + pin → run_probed（tool_read）
        writeCanary(root, freshCanary({ model: 'gpt-4o', run_id: 'run-R2' }));
        let vctx = resolveEffectiveVisionContext({ projectRoot: root, feature: 'demo', runId: 'run-R2', adapter: 'chrys', frameworkRoot: fw, modelPin: 'gpt-4o' });
        assert.strictEqual(vctx.vision_capability.scope, 'run_probed', JSON.stringify(vctx.vision_capability));
        assert.strictEqual(vctx.vision_capability.verdict, 'tool_read');
        // run 匹配但 model 不符 → 不采信（落 adapter_declared）
        writeCanary(root, freshCanary({ model: 'sonnet', run_id: 'run-R2' }));
        vctx = resolveEffectiveVisionContext({ projectRoot: root, feature: 'demo', runId: 'run-R2', adapter: 'chrys', frameworkRoot: fw, modelPin: 'gpt-4o' });
        assert.notStrictEqual(vctx.vision_capability.scope, 'run_probed', '模型失配不得采信为 run_probed');
        // 同模型跨 run → 不采信
        writeCanary(root, freshCanary({ model: 'gpt-4o', run_id: 'R1' }));
        vctx = resolveEffectiveVisionContext({ projectRoot: root, feature: 'demo', runId: 'run-R2', adapter: 'chrys', frameworkRoot: fw, modelPin: 'gpt-4o' });
        assert.notStrictEqual(vctx.vision_capability.scope, 'run_probed', '跨 run 不得采信为 run_probed');
        // 无 pin：run 匹配 → run_probed（现状）；跨 run → 不采信（run 绑定保持）
        writeCanary(root, freshCanary({ run_id: 'run-R2' }));
        vctx = resolveEffectiveVisionContext({ projectRoot: root, feature: 'demo', runId: 'run-R2', adapter: 'chrys', frameworkRoot: fw });
        assert.strictEqual(vctx.vision_capability.scope, 'run_probed', '无 pin 时中央 resolver 仍采信同 run 缓存');
        writeCanary(root, freshCanary({ run_id: 'R1' }));
        vctx = resolveEffectiveVisionContext({ projectRoot: root, feature: 'demo', runId: 'run-R2', adapter: 'chrys', frameworkRoot: fw });
        assert.notStrictEqual(vctx.vision_capability.scope, 'run_probed', '无 pin 时中央 resolver 仍拒跨 run 缓存');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 't3 中央两处共用同一谓词：preflight skip ⟺ resolver 采信（pin 在场逐形态交叉）',
    run: () => {
      const root = mkTmp();
      try {
        const fw = chrysFrameworkRoot(root);
        const forms: Array<{ canary: FrameworkLocalConfigVisionCanary; admissible: boolean }> = [
          { canary: freshCanary({ model: 'gpt-4o', run_id: 'run-R2' }), admissible: true },
          { canary: freshCanary({ model: 'sonnet', run_id: 'run-R2' }), admissible: false },
          { canary: freshCanary({ model: 'gpt-4o', run_id: 'R1' }), admissible: false },
          { canary: freshCanary({ model: 'gpt-4o', probed_via: 'interactive' }), admissible: true },
          { canary: freshCanary({ model: 'sonnet', probed_via: 'interactive' }), admissible: false },
        ];
        for (const f of forms) {
          writeCanary(root, f.canary);
          const pre = decideVisionCanaryProbe({
            projectRoot: root,
            manifest: baseManifest({ adapter_model_pin: { adapter: 'chrys', value: 'gpt-4o' } }),
            chain: ['spec'], dryRun: false,
          });
          const preAdmits = pre.action === 'skip';
          const vctx = resolveEffectiveVisionContext({ projectRoot: root, feature: 'demo', runId: 'run-R2', adapter: 'chrys', frameworkRoot: fw, modelPin: 'gpt-4o' });
          const resolverAdmits = vctx.vision_capability.scope === 'run_probed';
          assert.strictEqual(preAdmits, resolverAdmits, `两侧判定必须一致（canary=${JSON.stringify(f.canary)}）`);
          assert.strictEqual(resolverAdmits, f.admissible, `与预期不符（canary=${JSON.stringify(f.canary)}）`);
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },

  // ==========================================================================
  // C. receipt 写入：有 pin 记 pin.value；无 pin 记 'unknown'
  // ==========================================================================
  {
    name: 't3 runVisionCanaryProbe：有 pin 成功 probe → receipt.model=pin.value；无 pin → 仍为 unknown',
    run: async () => {
      const root = mkTmp();
      try {
        const fw = claudeFrameworkFixture(root);
        writeLocalConfig(root, { schema_version: '1.0', agent_adapter: 'claude' });
        const withPin = baseManifest({ adapter: 'claude', adapter_model_pin: { adapter: 'claude', value: 'gpt-4o' } });
        const r1 = await runVisionCanaryProbe({
          projectRoot: root, frameworkRoot: fw, manifest: withPin,
          invokeFn: (async () => ({ exitCode: 0, stdout: FULL_ANSWER, stderr: '', command: 'fake' })) as typeof invokeAgentHeadless,
          answerKeyFn: () => FIXTURE_CANARY_KEY,
        });
        assert.strictEqual(r1.outcome, 'valid_cached', JSON.stringify(r1));
        assert.strictEqual(loadLocalConfig(root)?.vision?.canary?.model, 'gpt-4o', '有 pin 时 receipt 必须记 pin.value');
        assert.strictEqual(loadLocalConfig(root)?.vision?.canary?.run_id, 'run-R2');

        // 无 pin：model 仍为 'unknown'（不得借本任务机械全局替换）
        const noPin = baseManifest({ adapter: 'claude' });
        const r2 = await runVisionCanaryProbe({
          projectRoot: root, frameworkRoot: fw, manifest: noPin,
          invokeFn: (async () => ({ exitCode: 0, stdout: FULL_ANSWER, stderr: '', command: 'fake' })) as typeof invokeAgentHeadless,
          answerKeyFn: () => FIXTURE_CANARY_KEY,
        });
        assert.strictEqual(r2.outcome, 'valid_cached', JSON.stringify(r2));
        assert.strictEqual(loadLocalConfig(root)?.vision?.canary?.model, 'unknown', '无 pin 时 receipt.model 仍为 unknown');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },

  // ==========================================================================
  // D. 五个消费面逐一 pin-aware
  // ==========================================================================
  {
    name: 't3 消费面 image_input/OCR/tool_read：有 pin 时 run 或 model 任一不符即不消费；匹配时消费；无 pin 精确保留现状',
    run: () => {
      const root = mkTmp();
      try {
        const fw = chrysFrameworkRoot(root);
        const identityPin = { runId: 'run-R2', modelPin: 'gpt-4o' };
        // 基线：正确身份 → 三面都消费
        writeCanary(root, freshCanary({ model: 'gpt-4o', run_id: 'run-R2' }));
        assert.strictEqual(resolveContextAdapterImageInput(root, fw, 'chrys', identityPin).imageInput, 'tool_read', 'image_input 应消费');
        assert.strictEqual(readCanaryOcrCapableSignal(root, 'chrys', identityPin), false, 'tool_read 不算 ocr_capable');
        assert.strictEqual(readCanaryToolReadSignal(root, 'chrys', identityPin), true, 'tool_read 信号应消费');
        // ocr_capable 信号面的正例
        writeCanary(root, freshCanary({ model: 'gpt-4o', run_id: 'run-R2', verdict: 'ocr_capable' }));
        assert.strictEqual(readCanaryOcrCapableSignal(root, 'chrys', identityPin), true);
        assert.strictEqual(readCanaryToolReadSignal(root, 'chrys', identityPin), false);
        assert.strictEqual(resolveContextAdapterImageInput(root, fw, 'chrys', identityPin).imageInput, 'none', 'ocr_capable 不算视觉');

        // 模型失配 → 三面都不消费（回退声明式 none）
        writeCanary(root, freshCanary({ model: 'sonnet', run_id: 'run-R2', verdict: 'tool_read' }));
        const mm = resolveContextAdapterImageInput(root, fw, 'chrys', identityPin);
        assert.notStrictEqual(mm.imageInput, 'tool_read', `模型失配 image_input 不得来自旧缓存：${mm.reason}`);
        assert.strictEqual(readCanaryOcrCapableSignal(root, 'chrys', identityPin), false);
        assert.strictEqual(readCanaryToolReadSignal(root, 'chrys', identityPin), false);
        // 同模型跨 run → 同样不消费
        writeCanary(root, freshCanary({ model: 'gpt-4o', run_id: 'R1', verdict: 'tool_read' }));
        assert.notStrictEqual(resolveContextAdapterImageInput(root, fw, 'chrys', identityPin).imageInput, 'tool_read');
        assert.strictEqual(readCanaryToolReadSignal(root, 'chrys', identityPin), false);
        // 无 pin：仅 fresh 即消费（跨 run 复用属既有行为，本 plan 不抢）
        writeCanary(root, freshCanary({ model: 'sonnet', run_id: 'R1', verdict: 'tool_read' }));
        assert.strictEqual(resolveContextAdapterImageInput(root, fw, 'chrys', { runId: 'run-R2' }).imageInput, 'tool_read', '无 pin 时旁路保持现状（仅 fresh）');
        assert.strictEqual(readCanaryToolReadSignal(root, 'chrys', { runId: 'run-R2' }), true, '无 pin 时旁路保持现状（仅 fresh）');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 't3 消费面 LKG：失配/跨 run 旧缓存不会被报告为沿用（isFreshCanaryForExecution 行为）',
    run: () => {
      const root = mkTmp();
      try {
        // goal-runner LKG 用的正是 isFreshCanaryForExecution（旁路判据）——直接行为验证
        // 失配旧缓存（model≠pin）→ 不判沿用
        writeCanary(root, freshCanary({ model: 'sonnet', run_id: 'run-R2' }));
        assert.strictEqual(
          isFreshCanaryForExecution(loadLocalConfig(root)!.vision!.canary!, 'chrys', { runId: 'run-R2', modelPin: 'gpt-4o' }),
          false,
          '模型失配旧缓存不得报告为沿用',
        );
        // 同模型跨 run → 不判沿用
        writeCanary(root, freshCanary({ model: 'gpt-4o', run_id: 'R1' }));
        assert.strictEqual(
          isFreshCanaryForExecution(loadLocalConfig(root)!.vision!.canary!, 'chrys', { runId: 'run-R2', modelPin: 'gpt-4o' }),
          false,
          '跨 run 缓存不得报告为沿用',
        );
        // 匹配 → 判沿用
        writeCanary(root, freshCanary({ model: 'gpt-4o', run_id: 'run-R2' }));
        assert.strictEqual(
          isFreshCanaryForExecution(loadLocalConfig(root)!.vision!.canary!, 'chrys', { runId: 'run-R2', modelPin: 'gpt-4o' }),
          true,
        );
        // 无 pin → 沿现状（仅 fresh，跨 run 也沿用——本 plan 不抢 visual-capability-truth 收口）
        writeCanary(root, freshCanary({ model: 'sonnet', run_id: 'R1' }));
        assert.strictEqual(
          isFreshCanaryForExecution(loadLocalConfig(root)!.vision!.canary!, 'chrys', { runId: 'run-R2' }),
          true,
          '无 pin 时 LKG 沿现状（仅 fresh）',
        );
        // 接线（辅助证据）：goal-runner 的 LKG 判据确实走共享旁路函数
        const src = fs.readFileSync(path.join(__dirname, '../../scripts/goal-runner.ts'), 'utf-8');
        assert(/isFreshCanaryForExecution\(canary, manifest\.adapter \?\? 'generic'/.test(src), 'goal-runner LKG 须走共享旁路判据');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 't3 消费面 pixel_1to1：匹配 pin 才升级门禁；失配不升级；无 pin 保持现状照常升级（checkUiSpecFidelityGate 行为）',
    run: () => {
      const root = mkTmp();
      try {
        const feature = 'demo';
        fs.writeFileSync(
          path.join(root, 'framework.config.json'),
          JSON.stringify({
            schema_version: '1.1', project_name: 'p', project_profile: { name: 'hmos-app', sub_variant: 'app' },
            materialized_adapters: ['chrys'], agent_adapter: 'chrys',
            architecture: { outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }], module_inner_layers: ['shared'], inner_dependency_direction: 'upward', cross_module_exports_file: 'index.ets' },
            paths: { features_dir: 'doc/features' },
          }, null, 2),
        );
        clearFrameworkConfigCache();
        fs.mkdirSync(path.dirname(featureFilePath(root, feature, 'spec.md')), { recursive: true });
        fs.writeFileSync(
          featureFilePath(root, feature, 'spec.md'),
          '```yaml\nui_change: new_or_changed\nvisual_handoff:\n  kind: screenshot_pack\n  authoritative_refs:\n    - id: home\n      path: doc/features/demo/spec/assets/ref.png\n```\n',
          'utf-8',
        );
        const uiSpecAbs = featureFilePath(root, feature, path.join('spec', 'ui-spec.yaml'));
        fs.mkdirSync(path.dirname(uiSpecAbs), { recursive: true });
        fs.writeFileSync(
          uiSpecAbs,
          'schema_version: "1.0"\nverified: unverified\nscreens: []\ntokens: {}\n',
          'utf-8',
        );
        writeCanary(root, freshCanary({ model: 'gpt-4o', run_id: 'run-R2' }));
        const fwConfig = JSON.parse(fs.readFileSync(path.join(root, 'framework.config.json'), 'utf-8'));
        const resolvedProfile = loadResolvedProfile(root, fwConfig);
        const ctx = {
          phase: 'spec', feature, projectRoot: root,
          phaseRule: {
            structure_checks: {
              ui_spec_fidelity_gate: { description: 'ui-spec fidelity gate', severity: 'BLOCKER' },
            },
          },
          featureSpec: { feature },
          resolvedProfile,
          uiSpecEnforcement: 'warn', fidelityTarget: 'pixel_1to1', acceptanceStrictness: 'hard',
          frameworkRoot: DEFAULT_LAYOUT.frameworkRoot,
          frameworkRel: DEFAULT_LAYOUT.frameworkRel,
          harnessRoot: path.join(DEFAULT_LAYOUT.frameworkRoot, 'harness'),
          layoutKind: DEFAULT_LAYOUT.kind,
        } as unknown as CheckContext;
        const specMd = fs.readFileSync(featureFilePath(root, feature, 'spec.md'), 'utf-8');
        const prevPin = process.env[MAISON_GOAL_MODEL_PIN_ENV];
        const prevRun = process.env.MAISON_GOAL_RUN_ID;
        try {
          // 匹配 pin env → 升级 BLOCKER/FAIL（无软档豁免）
          process.env[MAISON_GOAL_MODEL_PIN_ENV] = 'gpt-4o';
          process.env.MAISON_GOAL_RUN_ID = 'run-R2';
          let gate = checkUiSpecFidelityGate(ctx, specMd).find(r => r.id === 'ui_spec_fidelity_gate')!;
          assert(gate, 'pixel_1to1 门禁应产出 ui_spec_fidelity_gate');
          assert.strictEqual(gate.status, 'FAIL', `匹配 pin 应升级 FAIL/BLOCKER：${gate.status}`);
          assert.strictEqual(gate.severity, 'BLOCKER');
          assert(/真视觉实测在位/.test(gate.details), gate.details);
          // 失配 pin env → 不升级（soft=warn → WARN/MAJOR）
          process.env[MAISON_GOAL_MODEL_PIN_ENV] = 'sonnet';
          gate = checkUiSpecFidelityGate(ctx, specMd).find(r => r.id === 'ui_spec_fidelity_gate')!;
          assert.strictEqual(gate.status, 'WARN', `失配 pin 不得升级：${gate.status}`);
          assert.strictEqual(gate.severity, 'MAJOR');
          assert(!/真视觉实测在位/.test(gate.details), '失配 pin 不得声称视觉在位');
          // 无 pin env → 不新增收紧：旁路仍按现状（仅 fresh）消费 tool_read 缓存 → 照常升级
          delete process.env[MAISON_GOAL_MODEL_PIN_ENV];
          gate = checkUiSpecFidelityGate(ctx, specMd).find(r => r.id === 'ui_spec_fidelity_gate')!;
          assert.strictEqual(gate.status, 'FAIL', `无 pin 保持现状（fresh tool_read 缓存照常升级）：${gate.status}`);
        } finally {
          if (prevPin === undefined) delete process.env[MAISON_GOAL_MODEL_PIN_ENV]; else process.env[MAISON_GOAL_MODEL_PIN_ENV] = prevPin;
          if (prevRun === undefined) delete process.env.MAISON_GOAL_RUN_ID; else process.env.MAISON_GOAL_RUN_ID = prevRun;
          clearFrameworkConfigCache();
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },

  // ==========================================================================
  // E. 三条 env 传播链
  // ==========================================================================
  {
    name: 't3 env 链① buildAgentSpawnEnv：有 pin 注入唯一大写键并清大小写变体；无 pin 清理父环境残留',
    run: () => {
      // 无 pin：父环境有混合大小写残留 → 一律清理，不泄漏
      const baseNoPin: NodeJS.ProcessEnv = { [MAISON_GOAL_MODEL_PIN_ENV.toLowerCase()]: 'stale', PATH: process.env.PATH };
      const outNoPin = buildAgentSpawnEnv(baseNoPin, {});
      const keysNoPin = Object.keys(outNoPin);
      assert(!keysNoPin.some(k => k.toUpperCase() === MAISON_GOAL_MODEL_PIN_ENV), `无 pin 不得残留任何大小写形态：${keysNoPin.join(',')}`);
      // 有 pin：extraEnv 注入大写键，父环境混合变体被清，结果恰有一个唯一大写键
      const baseWith: NodeJS.ProcessEnv = { [MAISON_GOAL_MODEL_PIN_ENV.toLowerCase()]: 'stale', PATH: process.env.PATH };
      const extra = { [MAISON_GOAL_MODEL_PIN_ENV]: 'gpt-4o', MAISON_GOAL_RUN_ID: 'run-R2' };
      const outWith = buildAgentSpawnEnv(baseWith, extra);
      const pinKeys = Object.keys(outWith).filter(k => k.toUpperCase() === MAISON_GOAL_MODEL_PIN_ENV);
      assert.deepStrictEqual(pinKeys, [MAISON_GOAL_MODEL_PIN_ENV], `须恰有唯一大写键：${pinKeys.join(',')}`);
      assert.strictEqual(outWith[MAISON_GOAL_MODEL_PIN_ENV], 'gpt-4o');
      assert.strictEqual(outWith.MAISON_GOAL_RUN_ID, 'run-R2');
      assert.strictEqual(outWith[MAISON_GOAL_HEADLESS_ENV], '1');
    },
  },
  {
    name: 't3 env 链②③ applyGoalModelPinEnv：有 pin 注入唯一大写键并清大小写变体；无 pin 只清理不写入',
    run: () => {
      // 链②（gateInjectedEnv）与链③（goalIdentity child env）的 pin 部分共用同一执行器——
      // 行为即两者最终 child env 的 pin 语义。
      // 有 pin：父环境混合大小写残留被清，结果恰有一个唯一大写键
      const baseWith: NodeJS.ProcessEnv = { [MAISON_GOAL_MODEL_PIN_ENV.toLowerCase()]: 'stale' };
      applyGoalModelPinEnv(baseWith, 'gpt-4o');
      const pinKeys = Object.keys(baseWith).filter(k => k.toUpperCase() === MAISON_GOAL_MODEL_PIN_ENV);
      assert.deepStrictEqual(pinKeys, [MAISON_GOAL_MODEL_PIN_ENV], `须恰有唯一大写键：${pinKeys.join(',')}`);
      assert.strictEqual(baseWith[MAISON_GOAL_MODEL_PIN_ENV], 'gpt-4o');
      // 无 pin：父环境残留（含大小写变体）被清，不写入
      const baseNoPin: NodeJS.ProcessEnv = { [MAISON_GOAL_MODEL_PIN_ENV]: 'stale', [MAISON_GOAL_MODEL_PIN_ENV.toLowerCase()]: 'stale2' };
      applyGoalModelPinEnv(baseNoPin, undefined);
      assert(!Object.keys(baseNoPin).some(k => k.toUpperCase() === MAISON_GOAL_MODEL_PIN_ENV), '无 pin 不得残留任何大小写形态');
      // 空串也按无 pin（不得把空串当 pin）
      const baseEmpty: NodeJS.ProcessEnv = { [MAISON_GOAL_MODEL_PIN_ENV]: 'stale' };
      applyGoalModelPinEnv(baseEmpty, '');
      assert(!Object.keys(baseEmpty).some(k => k.toUpperCase() === MAISON_GOAL_MODEL_PIN_ENV));
    },
  },
  {
    name: 't3 env 传播接线（辅助）：goal-runner 三条注入路径与 phase-state child env 均走共享执行器/透传 modelPin',
    run: () => {
      const src = fs.readFileSync(path.join(__dirname, '../../scripts/goal-runner.ts'), 'utf-8');
      // ① agent extraEnv 携带 pin
      assert(/\[MAISON_GOAL_MODEL_PIN_ENV\]: manifest\.adapter_model_pin\.value/.test(src), 'extraEnv 须注入 model pin');
      // ② gate harness 走共享执行器
      assert(/applyGoalModelPinEnv\(childEnv, manifest\?\.adapter_model_pin\?\.value\)/.test(src), 'gateInjectedEnv 须走 applyGoalModelPinEnv');
      // ③ check-receipt 子进程 goalIdentity 透传
      assert(/modelPin: manifest\.adapter_model_pin\.value/.test(src), 'goalIdentity 须透传 model pin');
      const psSrc = fs.readFileSync(path.join(__dirname, '../../scripts/utils/phase-state.ts'), 'utf-8');
      assert(/applyGoalModelPinEnv\(childEnv, opts\.goalIdentity\.modelPin\)/.test(psSrc), 'phase-state child env 须走 applyGoalModelPinEnv');
      // 中央两处接线（辅助）
      const gpSrc = fs.readFileSync(path.join(__dirname, '../../scripts/utils/goal-preflight.ts'), 'utf-8');
      assert(/canaryAdmissibleForExecution\(canary, \{ runId: manifest\.run_id, modelPin \}\)/.test(gpSrc), 'decideVisionCanaryProbe 须用执行身份谓词');
      const evcSrc = fs.readFileSync(path.join(__dirname, '../../scripts/utils/effective-vision-context.ts'), 'utf-8');
      assert(/canaryAdmissibleForExecution\(canary, \{ runId: args\.runId, modelPin: args\.modelPin \}\)/.test(evcSrc), '三轴 resolver 须用执行身份谓词');
    },
  },

  // ==========================================================================
  // F. telemetry（warning-only）
  // ==========================================================================
  {
    name: 't3 telemetry：observed==pin/无 pin 不告警；失配出 pin_verify_mismatch 且报告有注记、report 对象不被改写',
    run: () => {
      // 判定纯函数（生产 goal-runner 与测试共用同一判定）
      assert.strictEqual(resolvePinVerifyMismatch({ pin: 'gpt-4o', observed: 'gpt-4o' }), null, '相等不告警');
      assert.strictEqual(resolvePinVerifyMismatch({ pin: undefined, observed: 'sonnet' }), null, '无 pin 不告警');
      assert.strictEqual(resolvePinVerifyMismatch({ pin: 'gpt-4o' }), null, '无 observed 不告警');
      const mismatch = resolvePinVerifyMismatch({ pin: 'gpt-4o', observed: 'sonnet' });
      assert.deepStrictEqual(mismatch, { pin: 'gpt-4o', observed: 'sonnet' }, '失配产生告警注记');
      // 报告投影：mismatch 事件 → 注记行；无事件 → 无注记行；report 对象不被改写（manifest/verdict/routes 不变）
      const report: GoalReport = {
        schema_version: '1.0', run_id: 'run-R2', feature: 'demo', status: 'COMPLETED',
        phases: [{ phase: 'spec', verdict: 'PASS' }],
        deferred_phases: [], generated_at: '2026-08-10T00:00:00Z',
      };
      const snapshot = JSON.stringify(report);
      const withEvt = generateGoalReportMarkdown(report, {
        events: [{ type: 'pin_verify_mismatch', phase: 'spec', invoke_id: 'i1', adapter: 'claude', pin: 'gpt-4o', observed: 'sonnet' }],
        warnDigest: new Map(),
      });
      assert(/模型核验/.test(withEvt) && /adapter_model_observed=sonnet/.test(withEvt) && /adapter_model_pin=gpt-4o/.test(withEvt), '报告须渲染 mismatch 注记');
      const noEvt = generateGoalReportMarkdown(report, { events: [], warnDigest: new Map() });
      assert(!/模型核验/.test(noEvt), '无 mismatch 事件不得渲染注记');
      assert.strictEqual(JSON.stringify(report), snapshot, '报告生成不得改写 report 对象（manifest/verdict/routes 不变）');
      // 接线（辅助）：goal-runner 告警块无写盘/裁决副作用
      const src = fs.readFileSync(path.join(__dirname, '../../scripts/goal-runner.ts'), 'utf-8');
      assert(/resolvePinVerifyMismatch\(\{[\s\S]*?pin: manifest\.adapter_model_pin\?\.value,[\s\S]*?observed: observedModel[\s\S]*?\}\)/.test(src), 'goal-runner 须走共享判定纯函数');
      const mismatchBlock = src.slice(src.indexOf("type: 'pin_verify_mismatch'"), src.indexOf("type: 'pin_verify_mismatch'") + 600);
      assert(!/writeGoalManifest|writeLocalConfig|writeCapabilitySnapshot|initializeFidelityRouting/.test(mismatchBlock), `告警块不得含任何写盘/裁决副作用：${mismatchBlock}`);
    },
  },

  // ==========================================================================
  // G. 两条生产链级回归（真实消费链，非纯函数）
  // ==========================================================================
  {
    name: 't3 生产链① 模型失配：旧 canary model≠pin → 重探 → auth/quota 不写盘 → 旧缓存不影响 image_input/OCR/tool_read/fidelity/pixel_1to1',
    run: async () => {
      const root = mkTmp();
      try {
        const fw = claudeFrameworkFixture(root);
        const oldCanary = { adapter: 'claude', verdict: 'tool_read' as const, probed_at: new Date(Date.now() - 60_000).toISOString(), probed_via: 'goal' as const, probe_version: VISION_CANARY_PROBE_VERSION, model: 'sonnet', run_id: 'run-R2' };
        writeLocalConfig(root, { schema_version: '1.0', agent_adapter: 'claude', vision: { canary: oldCanary } });
        const manifest = baseManifest({ adapter: 'claude', adapter_model_pin: { adapter: 'claude', value: 'gpt-4o' } });
        // 重探判定：模型失配 → probe
        assert.deepStrictEqual(
          decideVisionCanaryProbe({ projectRoot: root, manifest, chain: ['spec'], dryRun: false }),
          { action: 'probe', reason: 'fresh_but_not_admissible_for_run' },
        );
        // 重探遇 auth/quota：非硬失败、不写盘（旧缓存保留）
        const r = await runVisionCanaryProbe({
          projectRoot: root, frameworkRoot: fw, manifest,
          invokeFn: (async () => ({ exitCode: 0, stdout: AUTH_QUOTA_STDOUT, stderr: '', command: 'fake' })) as typeof invokeAgentHeadless,
        });
        assert.strictEqual(r.outcome, 'invalid_not_cached', JSON.stringify(r));
        assert.deepStrictEqual(loadLocalConfig(root)?.vision?.canary, oldCanary, '重探失败不得写盘，旧缓存原样保留');
        // 五消费面：旧缓存（model≠pin）不得被采信（claude 声明回退恰也是 tool_read——
        // 断言须看 reason 是否来自「金丝雀实测缓存」，不能只看 imageInput 值）
        const identityPin = { runId: 'run-R2', modelPin: 'gpt-4o' };
        const mm = resolveContextAdapterImageInput(root, fw, 'claude', identityPin);
        assert(!mm.reason.includes('金丝雀'), `image_input 不得消费旧缓存：${mm.reason}`);
        assert.strictEqual(readCanaryToolReadSignal(root, 'claude', identityPin), false, 'tool_read 不得消费旧缓存');
        // OCR 面：旧缓存若为 ocr_capable 同样不得消费（独立变体）
        writeLocalConfig(root, { schema_version: '1.0', agent_adapter: 'claude', vision: { canary: { ...oldCanary, verdict: 'ocr_capable' } } });
        assert.strictEqual(readCanaryOcrCapableSignal(root, 'claude', identityPin), false, 'OCR 不得消费模型失配缓存');
        // fidelity 面：policy meet 走中央 resolver（同身份谓词）——不得因旧缓存回到 visual
        const vctx = resolveEffectiveVisionContext({ projectRoot: root, feature: 'demo', runId: 'run-R2', adapter: 'claude', frameworkRoot: fw, modelPin: 'gpt-4o' });
        assert.notStrictEqual(vctx.vision_capability.scope, 'run_probed', 'fidelity 面不得采信旧缓存');
        // pixel_1to1（经 readCanaryToolReadSignal）不得升级
        assert.strictEqual(readCanaryToolReadSignal(root, 'claude', identityPin), false, 'pixel_1to1 门禁不得因旧缓存升级 BLOCKER');
        // 对照：无 pin 时旧缓存仍按现状消费（旁路只查 fresh）——证明"无 pin 不扩大 scope"
        const mmNoPin = resolveContextAdapterImageInput(root, fw, 'claude', { runId: 'run-R2' });
        assert(mmNoPin.reason.includes('金丝雀'), `无 pin 时旁路应消费旧缓存（现状）：${mmNoPin.reason}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 't3 生产链② 同模型跨 run：R1 缓存 model=pin 但 run_id=R1 → 重探 → auth/quota 不写盘 → R1 缓存不得影响五面',
    run: async () => {
      const root = mkTmp();
      try {
        const fw = claudeFrameworkFixture(root);
        const oldCanary = { adapter: 'claude', verdict: 'tool_read' as const, probed_at: new Date(Date.now() - 60_000).toISOString(), probed_via: 'goal' as const, probe_version: VISION_CANARY_PROBE_VERSION, model: 'gpt-4o', run_id: 'R1' };
        writeLocalConfig(root, { schema_version: '1.0', agent_adapter: 'claude', vision: { canary: oldCanary } });
        const manifest = baseManifest({ adapter: 'claude', adapter_model_pin: { adapter: 'claude', value: 'gpt-4o' } });
        // 重探判定：run 不匹配 → probe（身份只比 model 不够的回归锁）
        assert.deepStrictEqual(
          decideVisionCanaryProbe({ projectRoot: root, manifest, chain: ['spec'], dryRun: false }),
          { action: 'probe', reason: 'fresh_but_not_admissible_for_run' },
          '同模型跨 run 必须重探',
        );
        const r = await runVisionCanaryProbe({
          projectRoot: root, frameworkRoot: fw, manifest,
          invokeFn: (async () => ({ exitCode: 0, stdout: AUTH_QUOTA_STDOUT, stderr: '', command: 'fake' })) as typeof invokeAgentHeadless,
        });
        assert.strictEqual(r.outcome, 'invalid_not_cached', JSON.stringify(r));
        assert.strictEqual(loadLocalConfig(root)?.vision?.canary?.run_id, 'R1');
        const identityPin = { runId: 'run-R2', modelPin: 'gpt-4o' };
        const mm = resolveContextAdapterImageInput(root, fw, 'claude', identityPin);
        assert(!mm.reason.includes('金丝雀'), `image_input 不得消费 R1 缓存：${mm.reason}`);
        assert.strictEqual(readCanaryToolReadSignal(root, 'claude', identityPin), false, 'tool_read 不得消费 R1 缓存');
        writeLocalConfig(root, { schema_version: '1.0', agent_adapter: 'claude', vision: { canary: { ...oldCanary, verdict: 'ocr_capable' } } });
        assert.strictEqual(readCanaryOcrCapableSignal(root, 'claude', identityPin), false, 'OCR 不得消费 R1 缓存');
        const vctx = resolveEffectiveVisionContext({ projectRoot: root, feature: 'demo', runId: 'run-R2', adapter: 'claude', frameworkRoot: fw, modelPin: 'gpt-4o' });
        assert.notStrictEqual(vctx.vision_capability.scope, 'run_probed', 'fidelity 面不得采信 R1 缓存');
        assert.strictEqual(readCanaryToolReadSignal(root, 'claude', identityPin), false, 'pixel_1to1 不得因 R1 缓存升级');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 't3 无 pin 中央退化回归锁：decideVisionCanaryProbe 与三轴 resolver 无 pin 时仍执行 run 绑定（防 v5 公式退化）',
    run: () => {
      const src = fs.readFileSync(path.join(__dirname, '../../scripts/utils/goal-preflight.ts'), 'utf-8');
      assert(
        /if \(canaryAdmissibleForExecution\(canary, \{ runId: manifest\.run_id, modelPin \}\)\)/.test(src),
        'decideVisionCanaryProbe 必须无条件调用执行身份谓词（无 pin 退化为 canaryAdmissibleForRun）',
      );
      const evcSrc = fs.readFileSync(path.join(__dirname, '../../scripts/utils/effective-vision-context.ts'), 'utf-8');
      assert(
        /if \(canaryAdmissibleForExecution\(canary, \{ runId: args\.runId, modelPin: args\.modelPin \}\)\)/.test(evcSrc),
        '三轴 resolver 必须无条件调用执行身份谓词',
      );
      // 关注点分离回归：isVisionCanaryFresh 签名不得被改动（3 参，恒无 modelPin）
      const mmSrc = fs.readFileSync(path.join(__dirname, '../../scripts/utils/multimodal-probe.ts'), 'utf-8');
      assert(
        /export function isVisionCanaryFresh\(\s*canary: FrameworkLocalConfigVisionCanary \| undefined \| null,\s*adapter: string,\s*now: number = Date\.now\(\),\s*\): boolean/.test(mmSrc),
        'isVisionCanaryFresh 签名与行为不得被改动（新鲜度与身份分离）',
      );
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