/**
 * visual-provider — 只读视觉 provider（plan ab072691）单测矩阵。
 *
 * 覆盖：
 *   t1 支持列表唯一真源（catalog 派生 / 家族不放行 / goal_capability 不参与资格）、
 *      CLI 双旗标成对与授权矩阵；
 *   t2 三态派生与窄钳制（reviewVision 缺省=hasVision 的逐字回归、delegated 放行 pixel、
 *      blind 钳制表不变）；
 *   t3 四 adapter 只读 plan golden（全权限 argv 不可达、model 真实回放、图片 transport）、
 *      信封投影与身份回显校验。
 */
import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  listVisualProviderAdapterNames,
  loadVisualProviderDeclaration,
  isVisualProviderSupported,
  parseVisualProviderDeclaration,
  formatVisualProviderSupportList,
} from '../../scripts/utils/adapter-catalog';
import {
  normalizeVisualProviderCliPair,
  resolveFinalVisualProviderPin,
} from '../../scripts/utils/goal-manifest-cli';
import {
  resolveVisionMode,
  reviewVisionForMode,
  resolveActiveVisualProvider,
  resolveVisualProviderFromLocal,
  shouldPromptForVisualProvider,
  formatVisualProviderPrompt,
  resolveUnattendedVisualProviderPin,
  assertVisualProviderCliSupported,
} from '../../scripts/utils/visual-provider-identity';
import { bindAttendedGoalContext } from '../../harness-runner';
import {
  buildGoalManifestFromInput,
  computeManifestIdentityFields,
  inheritSuccessorManifest,
  writeGoalManifest,
} from '../../scripts/utils/goal-manifest';
import { casAcquireRunOwner, ensureRunControl, releaseRunOwner } from '../../scripts/utils/goal-run-control';
import {
  resolveVisualProviderInvokePlan,
  projectVisualProviderBody,
  extractJsonObjectFromText,
  extractJsonFinalResultText,
  extractOpenCodeFinalText,
  validateProviderIdentityEcho,
  resolveSpecObservationBudget,
  VISUAL_PROVIDER_SPEC_OBSERVATION_MAX_PER_RUN,
} from '../../scripts/utils/visual-provider-invoke';
import {
  isVisualObservationReusable,
  listVisualObservationOutputs,
  parseVisualObservationPayload,
  produceVisualObservationSidecars,
  VISUAL_OBSERVATION_PROTOCOL_VERSION,
} from '../../scripts/utils/visual-observation-sidecar';
import { clampFidelityByCapability } from '../../scripts/utils/fidelity-shared';
import { countBlockingDebt, deriveVisualDebt } from '../../scripts/utils/visual-debt';
import { hashImageFile, invokeVisualProvider } from '../../scripts/utils/visual-provider-invoke';
import {
  applyProviderReviewToScreen,
  clearProviderReviewFromScreen,
  collectReviewTargets,
  resetDelegatedRoundState,
  runVisualProviderReview,
  validateVisualProviderReviewPayload,
  writeDelegatedCriticReceipt,
  type ReviewTargetScreen,
} from '../../../profiles/hmos-app/harness/visual-provider-review';
import {
  checkVisualDiffDeterministicOnly,
  computeDefectFingerprint,
  isCriticEvidencePathBound,
  validateVisualDiffJson,
  type VisualDiffDefect,
  type VisualDiffScreenEntry,
} from '../../../profiles/hmos-app/harness/visual-diff-check';
import { buildVisualDiffSkeletonEntry } from '../../../profiles/hmos-app/harness/visual-diff-capture';
import { buildVisualProviderAdvisory } from '../../scripts/check-personal-setup';
import { executeInitTask } from '../../scripts/utils/init-task-executor';
import { probeInitTaskPlan } from '../../scripts/utils/init-task-planner';
import { clearFrameworkConfigCache } from '../../config';
import { projectDelegatedVisualProviderFailure } from '../../scripts/check-testing';
import {
  deriveSummaryVerdictLattice,
  resolveEffectiveVerdict,
} from '../../scripts/utils/quality-axes';
import { resolveVerdictFromChecks } from '../../scripts/utils/report-generator';
import { classifyPhaseAssessment } from '../../scripts/utils/phase-transition-policy';
import type { AgentInvokeResult } from '../../scripts/utils/agent-invoke';
import type { CheckResult } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';

const CASES: Array<{ name: string; run: () => void | Promise<void> }> = [];
function test(name: string, run: () => void | Promise<void>): void {
  CASES.push({ name, run });
}

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * 造一个**真实形态**的最小工程：spec 里带 visual_handoff.authoritative_refs（capture 骨架
 * 只写 ref_id，参考图靠这条既有权威链解析），外加 ui-spec 屏声明。
 */
function mkReviewProject(opts: { refIds?: string[] } = {}): { root: string; feature: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-proj-'));
  const feature = 'feat';
  const refIds = opts.refIds ?? ['ref-s1'];
  fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
    schema_version: '1.1', project_name: 'p', materialized_adapters: ['claude'],
    architecture: {
      outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
      module_inner_layers: ['shared'], inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ets',
    },
    paths: { features_dir: 'doc/features' },
  }, null, 2));
  const refsDir = path.join(root, 'doc', 'refs');
  fs.mkdirSync(refsDir, { recursive: true });
  fs.writeFileSync(path.join(refsDir, 'home.png'), 'ref-bytes');
  const specDir = path.join(root, 'doc', 'features', feature, 'spec');
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, 'spec.md'), [
    '```yaml',
    'ui_change: new_or_changed',
    'visual_handoff:',
    '  authoritative_refs:',
    ...refIds.map(id => `    - id: ${id}\n      path: doc/refs/home.png`),
    '```',
  ].join('\n'));
  fs.writeFileSync(path.join(specDir, 'ui-spec.yaml'), [
    'schema_version: "1.0"',
    'screens:',
    ...refIds.map((id, i) => `  - id: s${i + 1}\n    priority: P0\n    ref_id: ${id}`),
    'tokens: {}',
    'assets: []',
  ].join('\n'));
  return { root, feature };
}

/** 普通全权限契约的旗标——provider argv 里出现任何一个都是红线违规。 */
const FULL_PERMISSION_FLAGS = [
  '--dangerously-skip-permissions',
  'danger-full-access',
  '--force',
  '--trust',
];

// ---------------------------------------------------------------------------
// t1 — 支持列表唯一真源
// ---------------------------------------------------------------------------

test('t1 支持列表唯一真源：首批三项由 adapter.yaml 完整声明派生', () => {
  const names = listVisualProviderAdapterNames(FRAMEWORK_ROOT);
  assert.deepStrictEqual([...names].sort(), ['claude', 'codex', 'opencode']);
  // 人读文案与校验消费同一份结果（禁止第二处枚举）
  assert.strictEqual(formatVisualProviderSupportList(FRAMEWORK_ROOT), names.join('、'));
});

test('t1 撤声明即撤资格：cursor 第一期不入册（tasks 7.7 账号面受阻）', () => {
  // 支持资格唯一来自 adapter.yaml 的完整声明——撤掉 visual_provider 块即失去资格，
  // **无需**也**不得**在 TS 侧另留名单或家族推断。ask_mode / result_json 机制仍在词表内
  // 并由下面的机制单测覆盖，第二期补回声明即恢复，不必重写运行时。
  assert.strictEqual(isVisualProviderSupported(FRAMEWORK_ROOT, 'cursor'), false);
  assert.ok(!loadVisualProviderDeclaration(FRAMEWORK_ROOT, 'cursor').ok);
});

test('t1 家族不放行：codeagent 与 claude 同内核仍无资格（无自有声明）', () => {
  assert.strictEqual(isVisualProviderSupported(FRAMEWORK_ROOT, 'codeagent'), false);
  assert.strictEqual(isVisualProviderSupported(FRAMEWORK_ROOT, 'chrys'), false);
  assert.strictEqual(isVisualProviderSupported(FRAMEWORK_ROOT, 'generic'), false);
});

test('t1 goal_capability 不参与 provider 资格：完整声明自身即资格', () => {
  // claude/codex 有 goal_capability，opencode 是 external_runner——三者一视同仁；
  // 反向：codeagent 有完整 goal_capability 却无资格（见上一例）。
  for (const a of ['claude', 'codex', 'opencode']) {
    const d = loadVisualProviderDeclaration(FRAMEWORK_ROOT, a);
    assert.ok(d.ok, `${a} 应有完整声明：${d.ok ? '' : d.reason}`);
  }
});

test('t1 声明缺一即不完整（不补默认、不降级可用）', () => {
  const full = {
    readonly_invoke: 'ask_mode',
    image_transport: 'prompt_path',
    stdout_envelope: 'result_json',
    model_replay: '--model',
  };
  assert.ok(parseVisualProviderDeclaration(full).ok);
  for (const k of Object.keys(full)) {
    const partial = { ...full } as Record<string, unknown>;
    delete partial[k];
    const r = parseVisualProviderDeclaration(partial);
    assert.strictEqual(r.ok, false, `缺 ${k} 应判不完整`);
  }
  assert.strictEqual(parseVisualProviderDeclaration({ ...full, extra: 1 }).ok, false, '未知键应拒');
  assert.strictEqual(
    parseVisualProviderDeclaration({ ...full, model_replay: 'model' }).ok,
    false,
    'model_replay 必须是旗标 token',
  );
});

test('t1 CLI 双旗标成对：单给任一 fail-fast，都不给=未配置', () => {
  assert.strictEqual(normalizeVisualProviderCliPair(undefined, undefined), undefined);
  assert.throws(() => normalizeVisualProviderCliPair('claude', undefined), /必须成对提供/);
  assert.throws(() => normalizeVisualProviderCliPair(undefined, 'm1'), /必须成对提供/);
  assert.deepStrictEqual(normalizeVisualProviderCliPair(' claude ', ' m1 '), {
    adapter: 'claude',
    model: 'm1',
  });
  assert.throws(() => normalizeVisualProviderCliPair('claude', '   '), /trim 后为空/);
  assert.throws(() => normalizeVisualProviderCliPair('claude', 'x'.repeat(129)), /≤128/);
});

test('t1 显式 CLI unsupported → fail-fast 且错误列出 catalog 派生支持项', () => {
  assert.throws(
    () => assertVisualProviderCliSupported(FRAMEWORK_ROOT, { adapter: 'codeagent', model: 'm' }),
    (e: Error) => /暂未接入视觉 provider/.test(e.message)
      && /claude/.test(e.message) && /opencode/.test(e.message)
      && /不会替你改选/.test(e.message),
  );
});

test('t1 授权矩阵：fresh 接受 / resume 异值须 override / successor 出生输入可覆盖', () => {
  const A = { adapter: 'claude', model: 'm1' };
  const B = { adapter: 'codex', model: 'm2' };
  const call = (o: Record<string, unknown>) =>
    resolveFinalVisualProviderPin({
      isResume: false, hasManifestFlag: false, isSuccessor: false, overrideManifest: false, ...o,
    } as never);

  assert.deepStrictEqual(call({ cliRef: A }), { ok: true, pin: A });
  // resume 不传 → 用冻结值
  assert.deepStrictEqual(call({ isResume: true, manifestPin: A }), { ok: true, pin: A });
  // resume 同值幂等
  assert.deepStrictEqual(call({ isResume: true, manifestPin: A, cliRef: { ...A } }), { ok: true, pin: { ...A } });
  // resume 异值须 --override-manifest
  const denied = call({ isResume: true, manifestPin: A, cliRef: B });
  assert.strictEqual(denied.ok, false);
  assert.match((denied as { message: string }).message, /--override-manifest/);
  assert.deepStrictEqual(
    call({ isResume: true, manifestPin: A, cliRef: B, overrideManifest: true }),
    { ok: true, pin: B },
  );
  // successor 出生：默认继承；显式输入可覆盖且不要求 override
  assert.deepStrictEqual(call({ isSuccessor: true, manifestPin: A }), { ok: true, pin: A });
  assert.deepStrictEqual(call({ isSuccessor: true, manifestPin: A, cliRef: B }), { ok: true, pin: B });
});

test('t1 三形态：local 缺失/已支持/已失格 三态判定与提示语', () => {
  const absent = resolveVisualProviderFromLocal(null, FRAMEWORK_ROOT);
  assert.strictEqual(absent.kind, 'absent');
  assert.strictEqual(shouldPromptForVisualProvider(absent), true);

  const ok = resolveVisualProviderFromLocal(
    { schema_version: '1.0', vision: { visual_provider: { adapter: 'claude', model: 'm1' } } } as never,
    FRAMEWORK_ROOT,
  );
  assert.strictEqual(ok.kind, 'ok');
  assert.strictEqual(shouldPromptForVisualProvider(ok), false, '已支持的配置不得再问');
  assert.strictEqual(formatVisualProviderPrompt(ok, FRAMEWORK_ROOT), null);

  const bad = resolveVisualProviderFromLocal(
    { schema_version: '1.0', vision: { visual_provider: { adapter: 'codeagent', model: 'm1' } } } as never,
    FRAMEWORK_ROOT,
  );
  assert.strictEqual(bad.kind, 'unsupported');
  assert.strictEqual(shouldPromptForVisualProvider(bad), true, '已失格的配置必须提示重选一次');
  const prompt = formatVisualProviderPrompt(bad, FRAMEWORK_ROOT)!;
  assert.match(prompt, /codeagent 暂未接入视觉 provider/);
  assert.match(prompt, /严格视觉需求会由 capability 门禁诚实 defer/);
});

test('t7 无人值守：旧 local 失格只负责 WARN + 忽略，不产生盲跑授权', () => {
  const r = resolveUnattendedVisualProviderPin(
    { schema_version: '1.0', vision: { visual_provider: { adapter: 'generic', model: 'm' } } } as never,
    FRAMEWORK_ROOT,
  );
  assert.strictEqual(r.pin, undefined);
  assert.match(r.warning ?? '', /已忽略该配置/);
  assert.doesNotMatch(r.warning ?? '', /allow-blind-visual/);
  assert.match(r.warning ?? '', /capability 门禁诚实 defer/);
  assert.match(r.warning ?? '', /不自动改选、不 fallback/);
  // 无配置只表示无 pin，不在身份解析层偷做启动授权。
  const none = resolveUnattendedVisualProviderPin(null, FRAMEWORK_ROOT);
  assert.deepStrictEqual(none, {});
});

test('t7/t6 unsupported 反向矩阵：失格 provider 落 blind 且不自动替换、不产生授权', () => {
  for (const adapter of ['codeagent', 'chrys', 'generic']) {
    const local = {
      schema_version: '1.0',
      vision: { visual_provider: { adapter, model: 'm' } },
    } as never;

    // 形态①②：普通交互态 / attended goal —— 提示重新配置，但不产生人工放行键
    const state = resolveVisualProviderFromLocal(local, FRAMEWORK_ROOT);
    assert.strictEqual(state.kind, 'unsupported', `${adapter} 应判 unsupported`);
    assert.strictEqual(shouldPromptForVisualProvider(state), true);
    const prompt = formatVisualProviderPrompt(state, FRAMEWORK_ROOT)!;
    assert.match(prompt, new RegExp(`${adapter} 暂未接入视觉 provider`));
    assert.match(prompt, /严格视觉需求会由 capability 门禁诚实 defer/);

    // 形态③：无人值守 —— WARN + 忽略，且**不产生任何 pin**（不自动改选）
    const unattended = resolveUnattendedVisualProviderPin(local, FRAMEWORK_ROOT);
    assert.strictEqual(unattended.pin, undefined, `${adapter}：无人值守绝不自动改选`);
    assert.doesNotMatch(unattended.warning ?? '', /allow-blind-visual/);

    // 形态④：显式 CLI —— fail-fast 并列出 catalog 派生支持项
    assert.throws(
      () => assertVisualProviderCliSupported(FRAMEWORK_ROOT, { adapter, model: 'm' }),
      new RegExp(`${adapter} 暂未接入视觉 provider`),
      `${adapter}：显式 CLI 必须 fail-fast，不得静默忽略`,
    );

    // 静态路由：配了但失格 → blind（不是 delegated）
    assert.strictEqual(
      resolveVisionMode({
        primaryHasVision: false,
        providerPin: { adapter, model: 'm' },
        providerEligible: isVisualProviderSupported(FRAMEWORK_ROOT, adapter),
      }),
      'blind',
    );
  }
});

test('t3 legacy allow_blind_visual 输入可读但新 writer 不重发，且对身份/successor 无授权语义', () => {
  const mk = (over: Record<string, unknown> = {}) => buildGoalManifestFromInput({
    feature: 'demo', requirement: 'UI', adapter: 'claude',
    unattended: { write_mode: 'full-access', approval_mode: 'never' },
    ...over,
  }, { projectRoot: path.parse(process.cwd()).root });
  const legacy = mk();
  const authorized = mk({ allow_blind_visual: true });
  assert.strictEqual(authorized.allow_blind_visual, undefined, 'normalized manifest must suppress the retired waiver');
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(computeManifestIdentityFields(legacy), 'allow_blind_visual'),
    false,
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(computeManifestIdentityFields(authorized), 'allow_blind_visual'),
    false,
    'legacy 字段不得进入当前身份或恢复裁决',
  );
  assert.throws(() => mk({ allow_blind_visual: false }), /键在场时必须为 true/);

  const fresh = mk({ run_id: 'successor-run' });
  const source = mk({ run_id: 'source-run', allow_blind_visual: true });
  const successor = inheritSuccessorManifest(fresh, source, { round: [], drift: [] });
  assert.strictEqual(successor.allow_blind_visual, undefined);
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(computeManifestIdentityFields(successor), 'allow_blind_visual'),
    false,
  );
});

test('t3 新 CLI/manifest writers 不再暴露盲跑质量 waiver', () => {
  const runner = fs.readFileSync(path.join(FRAMEWORK_ROOT, 'harness', 'scripts', 'goal-phase-runtime.ts'), 'utf-8');
  const attended = fs.readFileSync(path.join(FRAMEWORK_ROOT, 'harness', 'scripts', 'goal-mode-entry.ts'), 'utf-8');
  const cli = fs.readFileSync(path.join(FRAMEWORK_ROOT, 'harness', 'scripts', 'utils', 'goal-manifest-cli.ts'), 'utf-8');
  for (const [name, source] of [['runner', runner], ['attended', attended], ['manifest-cli', cli]] as const) {
    assert.doesNotMatch(source, /allow-blind-visual|blind_visual_authorization_required|allowBlindVisual/,
      `${name} 不得保留盲跑授权入口或消费者`);
  }
});

// ---------------------------------------------------------------------------
// t2 — 三态派生与窄钳制
// ---------------------------------------------------------------------------

test('t2 三态派生矩阵（含资格不足落 blind）', () => {
  const P = { adapter: 'claude', model: 'm' };
  assert.strictEqual(resolveVisionMode({ primaryHasVision: true, providerEligible: false }), 'native');
  assert.strictEqual(
    resolveVisionMode({ primaryHasVision: true, providerPin: P, providerEligible: true }),
    'native',
    'primary 能看图时不走委托',
  );
  assert.strictEqual(
    resolveVisionMode({ primaryHasVision: false, providerPin: P, providerEligible: true }),
    'delegated',
  );
  assert.strictEqual(
    resolveVisionMode({ primaryHasVision: false, providerPin: P, providerEligible: false }),
    'blind',
    '配了但失格 → blind',
  );
  assert.strictEqual(resolveVisionMode({ primaryHasVision: false, providerEligible: true }), 'blind');
});

test('t2 reviewVision 缺省=hasVision：旧调用面钳制表逐字回归', () => {
  const tiers = ['pixel_1to1', 'semantic_layout', 'reference_only'] as const;
  for (const desired of tiers) {
    for (const hasVision of [true, false]) {
      for (const ocrAvailable of [true, false]) {
        const legacy = clampFidelityByCapability(desired, { hasVision, ocrAvailable });
        const explicit = clampFidelityByCapability(desired, {
          hasVision, ocrAvailable, reviewVision: hasVision,
        });
        assert.deepStrictEqual(explicit, legacy, `${desired}/${hasVision}/${ocrAvailable} 应逐字一致`);
      }
    }
  }
  // blind 钳制表本体不变
  assert.deepStrictEqual(
    clampFidelityByCapability('pixel_1to1', { hasVision: false, ocrAvailable: true }),
    { effective: 'semantic_layout', clamped: true, reason: 'no_vision_ocr_available' },
  );
  assert.deepStrictEqual(
    clampFidelityByCapability('pixel_1to1', { hasVision: false, ocrAvailable: false }),
    { effective: 'reference_only', clamped: true, reason: 'no_vision_no_ocr' },
  );
});

test('t2 delegated 放行 pixel_1to1（primary 盲但有能看图的检查者）', () => {
  assert.strictEqual(reviewVisionForMode('delegated'), true);
  assert.strictEqual(reviewVisionForMode('native'), true);
  assert.strictEqual(reviewVisionForMode('blind'), false);
  assert.deepStrictEqual(
    clampFidelityByCapability('pixel_1to1', { hasVision: false, ocrAvailable: false, reviewVision: true }),
    { effective: 'pixel_1to1', clamped: false },
  );
});

// ---------------------------------------------------------------------------
// t3 — 只读 plan golden
// ---------------------------------------------------------------------------

function planFor(adapter: string, images: string[] = []) {
  const decl = loadVisualProviderDeclaration(FRAMEWORK_ROOT, adapter);
  assert.ok(decl.ok, `${adapter} 声明缺失`);
  return resolveVisualProviderInvokePlan({
    provider: { adapter, model: `${adapter}-vision-model` },
    declaration: (decl as { ok: true; declaration: never }).declaration,
    imagePaths: images,
    prompt: 'review these screens',
    projectRoot: process.cwd(),
  });
}

test('t3 四 adapter 只读 plan：全权限旗标结构上不可达', () => {
  for (const adapter of listVisualProviderAdapterNames(FRAMEWORK_ROOT)) {
    const { plan } = planFor(adapter, ['/proj/ref.png']);
    for (const flag of FULL_PERMISSION_FLAGS) {
      assert.ok(
        !plan.argv.includes(flag),
        `${adapter} provider argv 不得含全权限旗标 ${flag}：${plan.argv.join(' ')}`,
      );
    }
    assert.strictEqual(plan.useStdin, true, `${adapter} prompt 必须走 stdin（Windows .cmd 截断铁律）`);
    assert.strictEqual(plan.adapterName, adapter, 'adapterName 必须携带（terminal parser 据此解析）');
  }
});

test('t3 model 真实回放：声明的 model_replay 旗标后紧跟 model 值', () => {
  for (const adapter of listVisualProviderAdapterNames(FRAMEWORK_ROOT)) {
    const decl = loadVisualProviderDeclaration(FRAMEWORK_ROOT, adapter);
    assert.ok(decl.ok);
    const flag = (decl as { ok: true; declaration: { model_replay: string } }).declaration.model_replay;
    const { plan } = planFor(adapter);
    const i = plan.argv.indexOf(flag);
    assert.ok(i > 0, `${adapter} argv 应含 model 回放旗标 ${flag}`);
    assert.strictEqual(plan.argv[i + 1], `${adapter}-vision-model`);
  }
});

test('t3 claude 只读 plan：safe-mode + 只读工具集合 + 拒 MCP + stream-json', () => {
  const { plan } = planFor('claude');
  const argv = plan.argv.join(' ');
  assert.match(argv, /--safe-mode/);
  assert.match(argv, /--tools Read/);
  assert.match(argv, /--allowedTools Read/);
  assert.match(argv, /--disallowedTools mcp__\*/);
  assert.match(argv, /--output-format stream-json --verbose/);
});

test('t3 codex 只读 plan：顶层 approval 在 exec 之前、read-only 沙箱、原生 --image', () => {
  const { plan } = planFor('codex', ['/proj/a.png', '/proj/b.png']);
  const argv = plan.argv;
  assert.ok(argv.indexOf('--ask-for-approval') < argv.indexOf('exec'), '顶层 approval 必须在 exec 之前');
  assert.ok(argv.indexOf('exec') < argv.indexOf('--sandbox'), 'exec 在 --sandbox 之前');
  assert.strictEqual(argv[argv.indexOf('--sandbox') + 1], 'read-only');
  assert.deepStrictEqual(
    argv.filter((_, i) => argv[i - 1] === '--image'),
    ['/proj/a.png', '/proj/b.png'],
    '图片走原生旗标且使用工程真实路径（无暂存复制）',
  );
  assert.ok(argv.includes('--json'));
});

test('t3 ask_mode 机制只读 plan：ask 模式且禁 force/trust', () => {
  // 机制单测，**不依赖任何 adapter 当前是否声明**：cursor 第一期已撤声明（tasks 7.7 账号面
  // 受阻），但 ask_mode 机制留在词表内待第二期复用——机制正确性在这里独立把关。
  const { plan } = resolveVisualProviderInvokePlan({
    provider: { adapter: 'cursor', model: 'cursor-vision-model' },
    declaration: {
      readonly_invoke: 'ask_mode',
      image_transport: 'prompt_path',
      stdout_envelope: 'result_json',
      model_replay: '--model',
    },
    imagePaths: [],
    prompt: 'review these screens',
    projectRoot: process.cwd(),
  });
  assert.ok(plan.argv.includes('--mode'));
  assert.strictEqual(plan.argv[plan.argv.indexOf('--mode') + 1], 'ask');
  assert.ok(!plan.argv.includes('--force') && !plan.argv.includes('--trust'));
});

test('t3 opencode 只读 plan：--pure + 非只读工具 deny + 原生 --file', () => {
  const built = planFor('opencode', ['/proj/a.png']);
  assert.ok(built.plan.argv.includes('--pure'));
  assert.strictEqual(built.plan.argv[built.plan.argv.indexOf('--file') + 1], '/proj/a.png');
  const perm = JSON.parse(built.extraEnv!.OPENCODE_PERMISSION) as Record<string, string>;
  assert.strictEqual(perm.edit, 'deny');
  assert.strictEqual(perm.bash, 'deny');
  assert.strictEqual(perm.write, 'deny');
  assert.strictEqual(perm.read, 'allow');
});

test('t3 turn_jsonl 投影：completion 缺失 / terminal failure / 正文 null 一律拒收', () => {
  const okLine = JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'BODY' } });
  const done = JSON.stringify({ type: 'turn.completed' });
  const mk = (o: Partial<AgentInvokeResult>): AgentInvokeResult => ({
    exitCode: 0, stdout: '', stderr: '', command: 'x', ...o,
  });
  assert.strictEqual(
    projectVisualProviderBody('turn_jsonl', mk({ stdout: `${okLine}\n${done}\n`, completion_observed: true })).body,
    'BODY',
  );
  assert.strictEqual(
    projectVisualProviderBody('turn_jsonl', mk({ stdout: `${okLine}\n${done}\n` })).body,
    null,
    'completion 未观测即拒收',
  );
  assert.strictEqual(
    projectVisualProviderBody('turn_jsonl', mk({
      stdout: `${okLine}\n${done}\n`, completion_observed: true, terminal_failure_observed: true,
    })).body,
    null,
    'terminal failure 优先，拒收',
  );
  assert.strictEqual(
    projectVisualProviderBody('turn_jsonl', mk({ stdout: okLine, completion_observed: true })).body,
    null,
    '无 turn.completed 的正文投影为 null → 拒收',
  );
});

test('t3 stream_json_result 投影只认终态 success result', () => {
  const mk = (stdout: string): AgentInvokeResult => ({ exitCode: 0, stdout, stderr: '', command: 'x' });
  const good = JSON.stringify({ type: 'result', subtype: 'success', result: 'BODY' });
  const err = JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'NOPE' });
  assert.strictEqual(projectVisualProviderBody('stream_json_result', mk(good)).body, 'BODY');
  assert.strictEqual(projectVisualProviderBody('stream_json_result', mk(err)).body, null);
  assert.strictEqual(projectVisualProviderBody('stream_json_result', mk('plain text')).body, null);
});

test('t3 result_json 投影：只取确定性 final result，不吃增量事件', () => {
  const stream = [
    JSON.stringify({ type: 'assistant', text: 'partial' }),
    JSON.stringify({ type: 'tool_use', name: 'Read' }),
    JSON.stringify({ type: 'result', result: 'FINAL' }),
  ].join('\n');
  assert.strictEqual(extractJsonFinalResultText(stream), 'FINAL');
  assert.strictEqual(extractJsonFinalResultText(JSON.stringify({ result: 'ONE' })), 'ONE');
  assert.strictEqual(extractJsonFinalResultText(JSON.stringify({ type: 'result', is_error: true, result: 'X' })), null);
  assert.strictEqual(extractJsonFinalResultText('not json'), null);
});

test('t3 events_json 投影：形状以宿主 opencode 1.18.14 真实样本钉死（tasks 7.7）', () => {
  const text = (messageID: string, s: string) =>
    JSON.stringify({ type: 'text', timestamp: 1, sessionID: 'ses', part: { type: 'text', messageID, text: s } });
  // 真实样本的 step_finish 两者都带：part.messageID + part.reason
  const finishOf = (messageID: string | null, reason = 'stop') => JSON.stringify({
    type: 'step_finish', timestamp: 2, sessionID: 'ses',
    part: messageID === null ? { reason } : { reason, messageID, type: 'step-finish' },
  });
  const finish = finishOf(null);
  const start = JSON.stringify({ type: 'step_start', timestamp: 0, sessionID: 'ses', part: { type: 'step-start' } });

  // 真实成功形状：step_start / text / step_finish 三行，正文在 part.text，终态同 messageID
  assert.strictEqual(
    extractOpenCodeFinalText([start, text('m1', 'FINAL'), finishOf('m1')].join('\n')), 'FINAL');

  // 只取最后一条 message 的分片，按序拼接——多步会话不把中间步骤混进终稿
  assert.strictEqual(
    extractOpenCodeFinalText([text('m1', 'OLD'), text('m2', 'A'), text('m2', 'B'), finish].join('\n')),
    'A\nB',
  );

  // 无 step_finish=没跑到终态，增量文本不得当终稿用
  assert.strictEqual(extractOpenCodeFinalText([start, text('m1', 'partial')].join('\n')), null);

  // ---- 终态必须绑定**最后一段正文**（评审意见 1 P0 回归）----
  // 旧 message 已 finish、新 message 还在流 ⇒ 必须 null。
  // 全局「见过任意 finish」的判据会在这里把**未完成的 m2** 当终稿返回——fail-closed 的危险侧。
  assert.strictEqual(
    extractOpenCodeFinalText([text('m1', 'DONE'), finishOf('m1'), text('m2', 'still-streaming')].join('\n')),
    null,
    '旧 finish 不得替新 message 背书',
  );

  // finish 之后又开新 step ⇒ 此前封稿失效（流还没走完）
  assert.strictEqual(
    extractOpenCodeFinalText([text('m1', 'DONE'), finishOf('m1'), start].join('\n')),
    null,
  );

  // reason 必须是 stop：tool-calls 等中间终态不封稿
  assert.strictEqual(
    extractOpenCodeFinalText([text('m1', 'partial'), finishOf('m1', 'tool-calls')].join('\n')),
    null,
  );
  // 中间 tool-calls 后同一 message 续写并最终 stop ⇒ 完整拼接
  assert.strictEqual(
    extractOpenCodeFinalText([
      text('m1', 'A'), finishOf('m1', 'tool-calls'), text('m1', 'B'), finishOf('m1'),
    ].join('\n')),
    'A\nB',
  );

  // 两侧都带 messageID 时必须同源：finish 绑到别的 message 不算封稿
  assert.strictEqual(
    extractOpenCodeFinalText([text('m2', 'FINAL'), finishOf('m1')].join('\n')),
    null,
  );

  // 见 error 行即判无终稿：宿主实测 401（密钥错）与 403（模型未开通）都走这里被挡为 invalid，
  // **不会**把错误信息当正文投影出去伪造一次「成功评审」
  const apiErr = JSON.stringify({ type: 'error', timestamp: 3, sessionID: 'ses', error: { name: 'APIError' } });
  assert.strictEqual(extractOpenCodeFinalText([text('m1', 'FINAL'), apiErr, finish].join('\n')), null);

  // 旧 result_json 方言不得被 events_json 误收（两条方言各自独立）
  assert.strictEqual(extractOpenCodeFinalText(JSON.stringify({ type: 'result', result: 'FINAL' })), null);
  assert.strictEqual(extractOpenCodeFinalText('not json'), null);
  const res = (stdout: string): AgentInvokeResult => ({ exitCode: 0, stdout, stderr: '', command: 'x' });
  assert.strictEqual(projectVisualProviderBody('events_json', res([start, text('m1', 'OK'), finish].join('\n'))).body, 'OK');
  assert.strictEqual(projectVisualProviderBody('events_json', res('not json')).body, null);
});

test('t3 身份回显校验：run/attempt 逐字、image_hashes 集合齐等', () => {
  const expected = { runId: 'r1', attemptId: 'a1', imageHashes: ['h1', 'h2'] };
  assert.strictEqual(
    validateProviderIdentityEcho({ run_id: 'r1', attempt_id: 'a1', image_hashes: ['h2', 'h1'] }, expected),
    null,
    '顺序无关应通过',
  );
  assert.match(
    validateProviderIdentityEcho({ run_id: 'r0', attempt_id: 'a1', image_hashes: ['h1', 'h2'] }, expected) ?? '',
    /run_id 回显不符/,
  );
  assert.match(
    validateProviderIdentityEcho({ run_id: 'r1', attempt_id: 'a0', image_hashes: ['h1', 'h2'] }, expected) ?? '',
    /attempt_id 回显不符/,
  );
  assert.match(
    validateProviderIdentityEcho({ run_id: 'r1', attempt_id: 'a1', image_hashes: ['h1'] }, expected) ?? '',
    /image_hashes 与本轮当前图片不符/,
  );
  assert.match(
    validateProviderIdentityEcho({ run_id: 'r1', attempt_id: 'a1' }, expected) ?? '',
    /image_hashes 缺失/,
  );
});

test('t3 正文 JSON 提取：围栏 / 裸对象 / 夹在散文里都能取，取不出即 null', () => {
  assert.deepStrictEqual(extractJsonObjectFromText('{"a":1}'), { a: 1 });
  assert.deepStrictEqual(extractJsonObjectFromText('前言\n```json\n{"a":2}\n```\n后记'), { a: 2 });
  assert.deepStrictEqual(extractJsonObjectFromText('说明 {"a":3} 结束'), { a: 3 });
  assert.strictEqual(extractJsonObjectFromText('completely free text'), null);
  assert.strictEqual(extractJsonObjectFromText('[1,2,3]'), null, '数组不是载荷对象');
});

test('t3 生命周期唯一性（源码锚定）：provider 不得自建 spawn/timer/kill/terminal/usage', () => {
  const src = fs.readFileSync(
    path.join(FRAMEWORK_ROOT, 'harness', 'scripts', 'utils', 'visual-provider-invoke.ts'),
    'utf-8',
  );
  // 只允许经既有统一执行器；下面任何一条出现都意味着第二套超时语义/第二套失败仲裁。
  // 判据是**调用点**（`名字(`）而非提及：模块头注需要点名这些禁止项来说明边界。
  for (const forbidden of [
    'spawnHeadlessChild(',
    'crossSpawn(',
    'createChildSettleWaiter(',
    'killProcessTree(',
    'setTimeout(',
    'setInterval(',
    'createCodexTerminalScanner(',
    'deriveInvokeUsage(',
  ]) {
    assert.ok(
      !src.includes(forbidden),
      `visual-provider-invoke.ts 不得出现 ${forbidden}（生命周期唯一归 invokeAgentHeadless）`,
    );
  }
  assert.ok(src.includes('invokeAgentHeadless('), '真实调用必须经既有 invokeAgentHeadless');
  assert.ok(src.includes('result.usage'), 'usage 只能消费 AgentInvokeResult.usage');
  // 全权限 argv 构造器一个都不许被引用（名义只读、实际全权限是本模块存在的理由）
  for (const builder of ['claudeArgv(', 'codexArgv(', 'cursorHeadlessPlan(', 'opencodeHeadlessPlan(']) {
    assert.ok(!src.includes(builder), `不得复用普通全权限 argv 构造器 ${builder}`);
  }
  // 也不得从 agent-invoke 导入它们（导入即可达）——只扫真正的 import 语句，
  // 头注需要点名这些禁止项来说明边界。
  const imports = [...src.matchAll(/^import[\s\S]*?from '[^']+';$/gm)].map(m => m[0]).join('\n');
  for (const builder of ['claudeArgv', 'codexArgv', 'cursorHeadlessPlan', 'opencodeHeadlessPlan']) {
    assert.ok(!imports.includes(builder), `import 面不得出现全权限 argv 构造器 ${builder}`);
  }
});

test('t3 批次上限：spec 观察 = min(参考图数, 单 run 封顶)', () => {
  assert.strictEqual(resolveSpecObservationBudget(0), 0);
  assert.strictEqual(resolveSpecObservationBudget(3), 3);
  assert.strictEqual(
    resolveSpecObservationBudget(VISUAL_PROVIDER_SPEC_OBSERVATION_MAX_PER_RUN + 5),
    VISUAL_PROVIDER_SPEC_OBSERVATION_MAX_PER_RUN,
  );
});

// ---------------------------------------------------------------------------
// t4 — spec 观察 sidecar
// ---------------------------------------------------------------------------

test('t4 三元复用键：hash / provider / protocol_version 任一不齐即重产', () => {
  const provider = { adapter: 'claude', model: 'm1' };
  const doc = {
    schema_version: '1.0',
    protocol_version: VISUAL_OBSERVATION_PROTOCOL_VERSION,
    source_image: 'doc/ref.png',
    image_hash: 'h1',
    provider,
    observations: [{ region: 'top', fact: 'x' }],
  };
  assert.strictEqual(isVisualObservationReusable(doc, { imageHash: 'h1', provider }), true);
  assert.strictEqual(
    isVisualObservationReusable(doc, { imageHash: 'h2', provider }),
    false,
    '换图必须重产',
  );
  assert.strictEqual(
    isVisualObservationReusable(doc, { imageHash: 'h1', provider: { adapter: 'claude', model: 'm2' } }),
    false,
    '换 endpoint 必须重产',
  );
  assert.strictEqual(
    isVisualObservationReusable({ ...doc, protocol_version: VISUAL_OBSERVATION_PROTOCOL_VERSION + 1 },
      { imageHash: 'h1', provider }),
    false,
    '协议版本不齐必须重产',
  );
  assert.strictEqual(isVisualObservationReusable(null, { imageHash: 'h1', provider }), false);
});

test('t4 观察载荷解析：hash 未回显 / 空 observations 一律拒（best-effort，不产 check）', () => {
  const ok = parseVisualObservationPayload(
    JSON.stringify({ image_hashes: ['h1'], observations: [{ region: 'r', fact: 'f' }] }),
    { imageHash: 'h1' },
  );
  assert.strictEqual(ok.ok, true);
  assert.deepStrictEqual((ok as { ok: true; observations: unknown }).observations, [{ region: 'r', fact: 'f' }]);

  assert.strictEqual(
    parseVisualObservationPayload(JSON.stringify({ image_hashes: ['other'], observations: [{ region: 'r', fact: 'f' }] }),
      { imageHash: 'h1' }).ok,
    false,
    '回显的不是本轮图片 → 拒',
  );
  assert.strictEqual(
    parseVisualObservationPayload(JSON.stringify({ image_hashes: ['h1'], observations: [] }), { imageHash: 'h1' }).ok,
    false,
  );
  assert.strictEqual(parseVisualObservationPayload('free text', { imageHash: 'h1' }).ok, false);
  // 条目缺 region/fact 被逐条剔除，全剔完即拒
  assert.strictEqual(
    parseVisualObservationPayload(
      JSON.stringify({ image_hashes: ['h1'], observations: [{ region: '', fact: 'f' }] }), { imageHash: 'h1' },
    ).ok,
    false,
  );
});

test('t4 sidecar 目录不存在时列举为空数组（不抛、不建目录）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-obs-'));
  try {
    assert.deepStrictEqual(listVisualObservationOutputs(tmp, FRAMEWORK_ROOT, 'nope'), []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// t5 — review 接线（invalid fail-closed × unavailable 按 release policy 投影）
// ---------------------------------------------------------------------------

function mkTarget(over: Partial<ReviewTargetScreen> = {}): ReviewTargetScreen {
  return {
    screen_id: 's1',
    refAbs: '/proj/ref.png',
    refHash: 'r1',
    shotAbs: '/proj/shot.png',
    shotHash: 'h1',
    ...over,
  };
}

function goodPayload(targets: ReviewTargetScreen[], over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema_version: '1.0',
    run_id: 'R', attempt_id: 'A',
    image_hashes: targets.flatMap(t => [t.refHash, t.shotHash]),
    screens: targets.map(t => ({
      screen_id: t.screen_id,
      reference_image_hash: t.refHash,
      evaluated_screenshot_hash: t.shotHash,
      must_fix: ['修 A'],
      defects: [{ class: 'clipping', severity: 'major', note: '被裁切', must_fix_refs: [0] }],
    })),
    ...over,
  });
}

test('t5 载荷校验拒收矩阵：空/漏屏/重复屏/hash 不符/旧 attempt/非法枚举', () => {
  const t1 = mkTarget();
  const t2 = mkTarget({ screen_id: 's2', refHash: 'r2', shotHash: 'h2' });
  const targets = [t1, t2];
  const expected = { targets, runId: 'R', attemptId: 'A', requireRegionAttest: false };

  assert.strictEqual(validateVisualProviderReviewPayload(goodPayload(targets), expected).ok, true);

  const bad = (body: string, re: RegExp, msg: string) => {
    const r = validateVisualProviderReviewPayload(body, expected);
    assert.strictEqual(r.ok, false, msg);
    assert.match((r as { reason: string }).reason, re, msg);
  };
  bad(JSON.stringify({ schema_version: '1.0', image_hashes: ['r1', 'h1', 'r2', 'h2'], run_id: 'R', attempt_id: 'A', screens: [] }),
    /空输出不等于无缺陷/, '空 screens 绝不等价无缺陷');
  bad(goodPayload([t1]).replace('"r1","h1"', '"r1","h1"'), /image_hashes 与本轮当前图片不符/, '漏图 hash');
  bad(goodPayload(targets).replace('"attempt_id":"A"', '"attempt_id":"OLD"'), /attempt_id 回显不符/, '旧 attempt');
  bad(goodPayload(targets).replace('"evaluated_screenshot_hash":"h1"', '"evaluated_screenshot_hash":"stale"'),
    /截图 hash 不符/, '换图后沿用旧评审');
  {
    const doc = JSON.parse(goodPayload(targets)) as { screens: unknown[] };
    doc.screens = [doc.screens[0], doc.screens[0]];
    bad(JSON.stringify(doc), /重复屏/, '重复屏');
  }
  {
    const doc = JSON.parse(goodPayload(targets)) as { screens: Array<Record<string, unknown>> };
    doc.screens = [doc.screens[0]];
    bad(JSON.stringify(doc), /image_hashes 与本轮当前图片不符|漏屏/, '漏屏');
  }
  {
    const doc = JSON.parse(goodPayload(targets)) as {
      screens: Array<{ defects: Array<Record<string, unknown>> }>;
    };
    doc.screens[0].defects[0].class = 'nonsense';
    bad(JSON.stringify(doc), /defect.class 非法/, '非法 class');
  }
  {
    const doc = JSON.parse(goodPayload(targets)) as {
      screens: Array<{ defects: Array<Record<string, unknown>> }>;
    };
    doc.screens[0].defects[0].must_fix_refs = [5];
    bad(JSON.stringify(doc), /must_fix_refs 越界/, 'must_fix_refs 越界');
  }
  bad('完全的自然语言，没有 JSON', /没有可解析的 JSON 对象/, '坏 JSON');
});

test('t5 pixel 硬契约：must_fix 为空却无 region_attest → 拒收；method 只接受 vl_screening', () => {
  const t = mkTarget();
  const base = {
    targets: [t], runId: 'R', attemptId: 'A', requireRegionAttest: true,
  };
  const mk = (screen: Record<string, unknown>) => JSON.stringify({
    schema_version: '1.0', run_id: 'R', attempt_id: 'A', image_hashes: [t.refHash, t.shotHash],
    screens: [{ screen_id: 's1', reference_image_hash: 'r1', evaluated_screenshot_hash: 'h1', ...screen }],
  });
  const noAttest = validateVisualProviderReviewPayload(mk({ must_fix: [], defects: [] }), base);
  assert.strictEqual(noAttest.ok, false);
  assert.match((noAttest as { reason: string }).reason, /无 region_attest 举证/);

  const okAttest = validateVisualProviderReviewPayload(
    mk({ must_fix: [], defects: [], region_attest: [{ region: '顶部', verdict: 'no_diff', method: 'vl_screening' }] }),
    base,
  );
  assert.strictEqual(okAttest.ok, true);

  const badMethod = validateVisualProviderReviewPayload(
    mk({ must_fix: [], defects: [], region_attest: [{ region: '顶部', verdict: 'no_diff', method: 'human' }] }),
    base,
  );
  assert.strictEqual(badMethod.ok, false, 'provider 不得以 human 举证');
});

test('t5 清旧+合并：只清 provider 结果，T8 转录与其它来源原样保留', () => {
  const entry: VisualDiffScreenEntry = {
    screen_id: 's1',
    verdict: 'pending',
    must_fix: ['T8 的修复', 'provider 上一轮的修复'],
    defects: [
      { class: 'other', severity: 'major', note: 'T8', must_fix_refs: [0],
        source: { producer: 'T8', finding_id: 'f1', signal: 'sig' } },
      { class: 'clipping', severity: 'minor', note: '上一轮 provider', must_fix_refs: [1],
        source: { producer: 'visual_provider', invoke_id: 'old-invoke' } },
    ],
  };
  clearProviderReviewFromScreen(entry);
  assert.deepStrictEqual(entry.must_fix, ['T8 的修复'], '只被旧 provider 引用的 must_fix 被清掉');
  assert.strictEqual(entry.defects!.length, 1);
  assert.strictEqual(entry.defects![0].source?.producer, 'T8');
  assert.deepStrictEqual(entry.defects![0].must_fix_refs, [0], '下标已重映射');

  applyProviderReviewToScreen(
    entry,
    { screen_id: 's1', must_fix: ['新 provider 修复'],
      defects: [{ class: 'overlap', severity: 'blocker', note: '重叠', must_fix_refs: [0] }] },
    { invokeId: 'new-invoke', provider: { adapter: 'claude', model: 'm' } },
  );
  assert.deepStrictEqual(entry.must_fix, ['T8 的修复', '新 provider 修复']);
  assert.strictEqual(entry.defects!.length, 2);
  const added = entry.defects![1];
  assert.deepStrictEqual(added.source, { producer: 'visual_provider', invoke_id: 'new-invoke' });
  assert.deepStrictEqual(added.must_fix_refs, [1], 'provider 引用按偏移重基');
  assert.strictEqual((entry as { confirmed_by?: string }).confirmed_by, undefined, 'provider 永不写 confirmed_by');
  // 载荷里根本没有 verdict 字段；这里是 **harness** 的确定性映射：must_fix 非空 → fail
  assert.strictEqual(entry.verdict, 'fail');
});

test('t5 provider defect 指纹走 legacy 四元组（invoke_id 不入指纹，否则熔断结构性失效）', () => {
  const a: VisualDiffDefect = {
    class: 'clipping', severity: 'major', note: 'x', element: 'btn',
    source: { producer: 'visual_provider', invoke_id: 'invoke-1' },
  };
  const b: VisualDiffDefect = { ...a, source: { producer: 'visual_provider', invoke_id: 'invoke-2' } };
  assert.strictEqual(computeDefectFingerprint('s1', a), computeDefectFingerprint('s1', b));
  assert.ok(!computeDefectFingerprint('s1', a).includes('invoke-'));
  // T8 源仍带身份尾段（既有行为不变）
  const t8: VisualDiffDefect = { ...a, source: { producer: 'T8', finding_id: 'f9', signal: 'sig' } };
  assert.match(computeDefectFingerprint('s1', t8), /\|T8#f9$/);
});

test('t5 schema 接受 provider provenance（与 T8 并存，非法 producer 仍拒）', () => {
  const mk = (source: unknown) => ({
    schema_version: '1.1',
    screens: [{
      screen_id: 's1', verdict: 'pending', must_fix: ['fix'],
      defects: [{ class: 'other', severity: 'minor', note: 'n', source }],
    }],
  });
  const errsOf = (source: unknown) =>
    validateVisualDiffJson(mk(source), process.cwd()).errors.filter(e => e.includes('.source'));
  assert.deepStrictEqual(errsOf({ producer: 'visual_provider', invoke_id: 'i1' }), []);
  assert.deepStrictEqual(errsOf({ producer: 'T8', finding_id: 'f', signal: 's' }), []);
  assert.strictEqual(errsOf({ producer: 'visual_provider' }).length, 1, 'provider 源缺 invoke_id 应拒');
  assert.strictEqual(errsOf({ producer: 'somebody_else', x: 1 }).length, 1, '未知 producer 应拒');
});

test('t5 BLOCKER SKIP 债务投影：visual_diff → needs_fix 债务 → release 阻断', () => {
  const doc = deriveVisualDebt('feat', [
    { id: 'visual_diff', severity: 'BLOCKER', status: 'SKIP', description: 'x', category: 'structure' } as never,
  ], null);
  const entry = doc.entries.find(e => e.source_check_id === 'visual_diff');
  assert.ok(entry, '非 MINOR 的 SKIP 必须落债务条目');
  assert.strictEqual(entry!.resolution_class, 'needs_fix', 'SKIP 也必须由机器补证据/回修');
  assert.strictEqual(entry!.status, 'open');
  assert.strictEqual(countBlockingDebt(doc).open > 0, true, 'open 债务 → visual UNVERIFIED / release BLOCKED');
});

test('t5 编排：provider 不可用 → unusable（不写盘、不抛错、不 halt）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-review-'));
  try {
    const feature = 'feat';
    const shotDir = path.join(tmp, 'doc', 'features', feature, 'device-testing', 'device-screenshots');
    fs.mkdirSync(shotDir, { recursive: true });
    fs.writeFileSync(path.join(shotDir, 'shot.png'), 'shot');
    fs.writeFileSync(path.join(shotDir, 'ref.png'), 'ref');
    const jsonPath = path.join(shotDir, 'visual-diff.json');
    const before = {
      schema_version: '1.1',
      screens: [{
        screen_id: 's1', verdict: 'pending',
        screenshot_path: 'doc/features/feat/device-testing/device-screenshots/shot.png',
        ref_path: 'doc/features/feat/device-testing/device-screenshots/ref.png',
        must_fix: [], defects: [],
      }],
    };
    fs.writeFileSync(jsonPath, JSON.stringify(before, null, 2));
    const ctx = { projectRoot: tmp, feature, fidelityTarget: 'semantic_layout' } as never;
    const out = await runVisualProviderReview(ctx, {
      frameworkRoot: FRAMEWORK_ROOT,
      provider: { adapter: 'claude', model: 'm' },
      runId: 'R', attemptId: 'A',
      invoke: (async () => ({
        invoke_id: 'i', provider: { adapter: 'claude', model: 'm' }, purpose: 'review',
        outcome: 'unavailable', reason: 'CLI 缺失', body: null, duration_ms: 1,
        image_hashes: [], workspace_dirtied: false, input_provenance: 'unverified',
      })) as never,
    });
    assert.strictEqual(out.kind, 'unusable');
    assert.strictEqual((out as { outcome: string }).outcome, 'unavailable');
    // 契约（返修后）：**不写入本轮结果**，但清场已在调用前完成——目标屏停在诚实的
    // pending，且不留任何 provider 产物。既不采信坏结果，也不让旧结果跨 attempt 存活。
    const after = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as { screens: VisualDiffScreenEntry[] };
    assert.strictEqual(after.screens[0].verdict, 'pending');
    assert.deepStrictEqual(after.screens[0].must_fix, [], '不写入本轮 must_fix');
    assert.deepStrictEqual(after.screens[0].defects, [], '不写入本轮 defects');
    assert.strictEqual(after.screens[0].evaluated_screenshot_hash, undefined);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('delegated provider 贯通：非发布必需 SKIP；release-required unavailable defer；invalid FAIL/retry', () => {
  const required = mkReviewProject();
  const optional = mkReviewProject();
  const functionalPass: CheckResult = {
    id: 'testing_structure',
    category: 'structure',
    description: 'testing structure',
    severity: 'BLOCKER',
    status: 'PASS',
    details: '',
  };
  try {
    fs.writeFileSync(
      path.join(optional.root, 'doc', 'features', optional.feature, 'spec', 'spec.md'),
      ['```yaml', 'ui_change: none', '```'].join('\n'),
    );

    clearFrameworkConfigCache();
    const optionalUnavailable = projectDelegatedVisualProviderFailure(
      {
        projectRoot: optional.root,
        feature: optional.feature,
        fidelityTarget: 'semantic_layout',
        acceptanceStrictness: 'best_effort',
      } as never,
      'unavailable',
      'provider offline',
      'visual diff',
    );
    assert.strictEqual(optionalUnavailable.status, 'SKIP');
    assert.strictEqual(optionalUnavailable.blocking_class, undefined);
    const optionalLattice = deriveSummaryVerdictLattice(
      [
        functionalPass,
        optionalUnavailable,
      ],
      { phase: 'testing', visualApplicable: false, assetApplicable: false },
    );
    assert.strictEqual(optionalLattice.quality_axes.visual.required_for_release, false);
    assert.strictEqual(optionalLattice.release_readiness, 'READY');

    clearFrameworkConfigCache();
    const requiredUnavailable = projectDelegatedVisualProviderFailure(
      {
        projectRoot: required.root,
        feature: required.feature,
        fidelityTarget: 'semantic_layout',
        acceptanceStrictness: 'best_effort',
      } as never,
      'unavailable',
      'provider offline',
      'visual diff',
    );
    assert.strictEqual(requiredUnavailable.status, 'FAIL');
    assert.strictEqual(requiredUnavailable.blocking_class, 'externalBlocked');
    assert.strictEqual(requiredUnavailable.failure_kind, 'capability_missing');
    assert.match(requiredUnavailable.details, /DEFERRED_CAPABILITY_MISSING/);

    const requiredChecks = [
      functionalPass,
      requiredUnavailable,
    ];
    const requiredLattice = deriveSummaryVerdictLattice(
      [...requiredChecks],
      { phase: 'testing', visualApplicable: true, assetApplicable: false },
    );
    assert.strictEqual(requiredLattice.quality_axes.visual.required_for_release, true);
    assert.strictEqual(requiredLattice.quality_axes.visual.verdict, 'UNVERIFIED');
    assert.strictEqual(requiredLattice.quality_axes.visual.resolution?.class, 'external_dependency');
    assert.strictEqual(requiredLattice.release_readiness, 'BLOCKED');

    const effectiveVerdict = resolveEffectiveVerdict({
      pre: requiredLattice.pre_projection_verdict,
      post: requiredLattice.projected_verdict,
      legacy: resolveVerdictFromChecks([...requiredChecks]),
    }).verdict;
    assert.strictEqual(effectiveVerdict, 'INCOMPLETE');
    const deferred = classifyPhaseAssessment({
      verdict: effectiveVerdict,
      blocking_class: requiredUnavailable.blocking_class,
      failure_kind: requiredUnavailable.failure_kind,
      dependency_policy: {
        deferrable_blocking_classes: ['externalBlocked'],
        deferrable_failure_kinds: ['capability_missing'],
        propagate_to_downstream: false,
      },
    });
    assert.strictEqual(deferred.action, 'resolve_deferred');
    assert.strictEqual(deferred.runner_action, 'defer_external_and_halt');

    clearFrameworkConfigCache();
    const strictUnavailable = projectDelegatedVisualProviderFailure(
      {
        projectRoot: optional.root,
        feature: optional.feature,
        fidelityTarget: 'pixel_1to1',
        acceptanceStrictness: 'hard',
      } as never,
      'unavailable',
      'provider offline',
      'visual diff',
    );
    assert.strictEqual(strictUnavailable.failure_kind, 'capability_missing');

    const invalid = projectDelegatedVisualProviderFailure(
      {
        projectRoot: required.root,
        feature: required.feature,
        fidelityTarget: 'semantic_layout',
        acceptanceStrictness: 'best_effort',
      } as never,
      'invalid',
      'hash mismatch',
      'visual diff',
    );
    assert.strictEqual(invalid.status, 'FAIL');
    assert.strictEqual(invalid.blocking_class, undefined);
    assert.strictEqual(invalid.failure_kind, 'visual_provider_invalid_evidence');
    const invalidChecks = [functionalPass, invalid];
    const invalidLattice = deriveSummaryVerdictLattice(
      invalidChecks,
      { phase: 'testing', visualApplicable: true, assetApplicable: false },
    );
    assert.strictEqual(invalidLattice.quality_axes.visual.verdict, 'FAIL');
    assert.strictEqual(invalidLattice.quality_axes.visual.resolution?.class, 'needs_fix');
    const invalidVerdict = resolveEffectiveVerdict({
      pre: invalidLattice.pre_projection_verdict,
      post: invalidLattice.projected_verdict,
      legacy: resolveVerdictFromChecks(invalidChecks),
    }).verdict;
    assert.strictEqual(invalidVerdict, 'FAIL');
    assert.strictEqual(classifyPhaseAssessment({ verdict: invalidVerdict }).runner_action, 'retry');
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(required.root, { recursive: true, force: true });
    fs.rmSync(optional.root, { recursive: true, force: true });
  }
});

test('legacy confirmed_by 无 provider 豁免权：每轮仍重评并清旧 pass/hash', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-humansign-'));
  try {
    const feature = 'feat';
    const shotDir = path.join(tmp, 'doc', 'features', feature, 'device-testing', 'device-screenshots');
    fs.mkdirSync(shotDir, { recursive: true });
    const shotAbs = path.join(shotDir, 'shot.png');
    fs.writeFileSync(shotAbs, 'shot');
    fs.writeFileSync(path.join(shotDir, 'ref.png'), 'ref');
    const shotHash = hashImageFile(shotAbs)!;
    const jsonPath = path.join(shotDir, 'visual-diff.json');
    // 历史产物带 confirmed_by；它只保留字节，不再改变 provider 路由。
    const signed = {
      schema_version: '1.1',
      screens: [{
        screen_id: 's1',
        verdict: 'pass',
        confirmed_by: '真人张三',
        screenshot_path: 'doc/features/feat/device-testing/device-screenshots/shot.png',
        ref_path: 'doc/features/feat/device-testing/device-screenshots/ref.png',
        evaluated_screenshot_hash: shotHash,
        must_fix: [],
        defects: [],
        region_attest: [{
          region: 'root', verdict: 'no_diff', method: 'vl_screening',
          by: 'visual_provider:claude:m',
        }],
      }],
    };
    fs.writeFileSync(jsonPath, JSON.stringify(signed, null, 2));
    const ctx = { projectRoot: tmp, feature, fidelityTarget: 'pixel_1to1' } as never;

    let invoked = 0;
    const out = await runVisualProviderReview(ctx, {
      frameworkRoot: FRAMEWORK_ROOT,
      provider: { adapter: 'claude', model: 'm' },
      runId: 'R', attemptId: 'A2',
      invoke: (async () => {
        invoked += 1;
        return {
          invoke_id: 'i', provider: { adapter: 'claude', model: 'm' }, purpose: 'review',
          outcome: 'unavailable', reason: 'CLI 缺失', body: null, duration_ms: 1,
          image_hashes: [], workspace_dirtied: false, input_provenance: 'unverified',
        };
      }) as never,
    });

    assert.strictEqual(invoked, 1, 'confirmed_by 不得跳过 provider');
    assert.strictEqual(out.kind, 'unusable');
    const after = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as { screens: VisualDiffScreenEntry[] };
    assert.strictEqual(after.screens[0].verdict, 'pending', '旧 pass 不得跨 attempt 存活');
    assert.strictEqual(after.screens[0].evaluated_screenshot_hash, undefined, '旧被评 hash 必须清除');
    assert.strictEqual(after.screens[0].confirmed_by, '真人张三', 'confirmed_by 仍不由本机制改动');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/** 造一个「旧评估已被判不可信」的屏：带标记 + 一堆该作废的旧评估产物。 */
function invalidatedScreenProject(
  opts: { mustHaveElements?: string[]; humanSigned?: boolean; screenId?: string } = {},
): { tmp: string; jsonPath: string; shotHash: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-inv-'));
  const shotDir = path.join(tmp, 'doc', 'features', 'feat', 'device-testing', 'device-screenshots');
  fs.mkdirSync(shotDir, { recursive: true });
  // ui-spec 只在需要逐区域覆盖判据时才写（P0 + must_have_elements）
  if (opts.mustHaveElements?.length) {
    const specDir = path.join(tmp, 'doc', 'features', 'feat', 'spec');
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(path.join(specDir, 'ui-spec.yaml'), [
      'schema_version: "1.0"',
      'screens:',
      '  - id: s1',
      '    priority: P0',
      '    must_have_elements:',
      ...opts.mustHaveElements.map(e => '      - ' + e),
      'tokens: {}',
      'assets: []',
    ].join('\n'));
  }
  fs.writeFileSync(path.join(shotDir, 'shot.png'), 'shot');
  fs.writeFileSync(path.join(shotDir, 'ref.png'), 'ref');
  const jsonPath = path.join(shotDir, 'visual-diff.json');
  fs.writeFileSync(jsonPath, JSON.stringify({
    schema_version: '1.1',
    screens: [{
      screen_id: opts.screenId ?? 's1',
      verdict: 'pass',
      // 默认造一个**真人已签**的屏（带被评 hash——人签必然绑定它签的那张图）；
      // humanSigned:false 时造 provider 自己推导出来的 pass，用来验「它不得跨轮存活」。
      ...(opts.humanSigned === false
        ? {}
        : { confirmed_by: '真人张三', evaluated_screenshot_hash: hashImageFile(path.join(shotDir, 'shot.png'))! }),
      evaluation_invalidated: true,
      screenshot_path: 'doc/features/feat/device-testing/device-screenshots/shot.png',
      ref_path: 'doc/features/feat/device-testing/device-screenshots/ref.png',
      evaluated_build_fingerprint: 'build-abc',
      fidelity_score: 0.99,
      geometric_iou: 0.98,
      reported_fidelity_score: 0.97,
      reported_geometric_iou: 0.96,
      region_attest: [
        { region: 'root', verdict: 'no_diff', method: 'vl_screening', by: 'visual_provider:claude:old' },
        { region: 'header', verdict: 'no_diff', method: 'human', by: '真人张三' },
      ],
      must_fix: [], defects: [],
    }],
  }, null, 2));
  return { tmp, jsonPath, shotHash: hashImageFile(path.join(shotDir, 'shot.png'))! };
}

test('t5 evaluation_invalidated：合法重评被采信后由 harness 确定性清标记', async () => {
  const { tmp, jsonPath, shotHash } = invalidatedScreenProject();
  try {
    const refHash = hashImageFile(
      path.join(tmp, 'doc', 'features', 'feat', 'device-testing', 'device-screenshots', 'ref.png'),
    )!;
    const ctx = { projectRoot: tmp, feature: 'feat', fidelityTarget: 'semantic_layout' } as never;
    const out = await runVisualProviderReview(ctx, {
      frameworkRoot: FRAMEWORK_ROOT,
      provider: { adapter: 'codex', model: 'm' },
      runId: 'R', attemptId: 'A',
      invoke: (async () => ({
        invoke_id: 'i1', provider: { adapter: 'codex', model: 'm' }, purpose: 'review',
        outcome: 'success', duration_ms: 1, image_hashes: [refHash, shotHash],
        workspace_dirtied: false, input_provenance: 'unverified',
        body: JSON.stringify({
          schema_version: '1.0', run_id: 'R', attempt_id: 'A',
          image_hashes: [refHash, shotHash],
          screens: [{
            screen_id: 's1', reference_image_hash: refHash, evaluated_screenshot_hash: shotHash,
            must_fix: ['补齐底部按钮'],
            defects: [{ class: 'missing_render', severity: 'blocker', note: '按钮未渲染', must_fix_refs: [0] }],
          }],
        }),
      })) as never,
    });
    assert.strictEqual(out.kind, 'applied');
    const s = (JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as { screens: VisualDiffScreenEntry[] }).screens[0];
    assert.strictEqual(s.evaluation_invalidated, undefined, '采信一次合法重评后标记必须被清');
    // 该标记点名不可信的旧评估产物一并作废
    assert.strictEqual(s.fidelity_score, undefined);
    assert.strictEqual(s.geometric_iou, undefined);
    assert.strictEqual(s.reported_fidelity_score, undefined);
    assert.strictEqual(s.reported_geometric_iou, undefined);
    // 五轮订正：**全部**旧 region_attest 作废，`method:'human'` 也不例外——
    // `by` 是未经验证的自由字符串，不是人签；保留它会让旧举证与新举证拼接满足区域覆盖。
    assert.ok(
      !(s.region_attest ?? []).some(a => a.by === 'visual_provider:claude:old'),
      '旧机器举证必须作废',
    );
    assert.ok(
      !(s.region_attest ?? []).some(a => a.method === 'human'),
      '旧 human 举证同样作废（未经验证的 by 不是人签）',
    );
    // 新结果写入；采集身份与人签不动
    assert.deepStrictEqual(s.must_fix, ['补齐底部按钮']);
    assert.strictEqual(s.verdict, 'fail', '标记清除与 UI 是否通过无关——发现缺陷照常 fail');
    assert.strictEqual(s.confirmed_by, '真人张三');
    assert.strictEqual(s.evaluated_build_fingerprint, 'build-abc', '采集身份字段不由本机制改动');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('t5 evaluation_invalidated：provider 不可用时标记保留、无假清除', async () => {
  // 无人签的屏——它的 pass 是 provider 上一轮推导出来的，**不得**跨轮存活。
  const { tmp, jsonPath } = invalidatedScreenProject({ humanSigned: false });
  try {
    const ctx = { projectRoot: tmp, feature: 'feat', fidelityTarget: 'semantic_layout' } as never;
    const out = await runVisualProviderReview(ctx, {
      frameworkRoot: FRAMEWORK_ROOT,
      provider: { adapter: 'codex', model: 'm' },
      runId: 'R', attemptId: 'A',
      invoke: (async () => ({
        invoke_id: 'i', provider: { adapter: 'codex', model: 'm' }, purpose: 'review',
        outcome: 'unavailable', reason: 'CLI 缺失', body: null, duration_ms: 1,
        image_hashes: [], workspace_dirtied: false, input_provenance: 'unverified',
      })) as never,
    });
    assert.strictEqual(out.kind, 'unusable');
    const s = (JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as { screens: VisualDiffScreenEntry[] }).screens[0];
    assert.strictEqual(s.evaluation_invalidated, true, '没有被采信的重评就不许清标记');
    assert.strictEqual(s.verdict, 'pending', 'provider 推导出来的旧 pass 不得跨轮存活');
    assert.deepStrictEqual(s.must_fix, [], '不写入任何本轮结果');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('t5 死锁闭环①：pixel clean-pass 区域覆盖不全 → 采信前即 invalid，标记保留', async () => {
  const { tmp, jsonPath, shotHash } = invalidatedScreenProject({
    mustHaveElements: ['header', 'footer', 'cta'],
  });
  try {
    const refHash = hashImageFile(
      path.join(tmp, 'doc', 'features', 'feat', 'device-testing', 'device-screenshots', 'ref.png'),
    )!;
    const ctx = { projectRoot: tmp, feature: 'feat', fidelityTarget: 'pixel_1to1' } as never;
    const out = await runVisualProviderReview(ctx, {
      frameworkRoot: FRAMEWORK_ROOT,
      provider: { adapter: 'codex', model: 'm' },
      runId: 'R', attemptId: 'A',
      invoke: (async () => ({
        invoke_id: 'i1', provider: { adapter: 'codex', model: 'm' }, purpose: 'review',
        outcome: 'success', duration_ms: 1, image_hashes: [refHash, shotHash],
        workspace_dirtied: false, input_provenance: 'unverified',
        body: JSON.stringify({
          schema_version: '1.0', run_id: 'R', attempt_id: 'A',
          image_hashes: [refHash, shotHash],
          screens: [{
            screen_id: 's1', reference_image_hash: refHash, evaluated_screenshot_hash: shotHash,
            must_fix: [], defects: [],
            // 只举证一条泛化 region——严格 gate 会判「未覆盖 must_have_elements」
            region_attest: [{ region: 'root', verdict: 'no_diff', method: 'vl_screening' }],
          }],
        }),
      })) as never,
    });
    assert.strictEqual(out.kind, 'unusable', '举证不全必须在采信关口就被拒');
    assert.match((out as { reason: string }).reason, /未覆盖屏级 must_have_elements/);
    const s = (JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as { screens: VisualDiffScreenEntry[] }).screens[0];
    assert.strictEqual(s.evaluation_invalidated, true, '未采信就不许清标记——下一轮仍会重评');
    assert.deepStrictEqual(s.must_fix, [], '不提交任何本轮结果');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('t5 死锁闭环①-overlay：overlay 屏按基屏归一化后同样受采信前覆盖预检约束', async () => {
  // overlay 的 P0 与 must_have_elements 声明在**基屏**上；目标装配若不归一化就查不到 spec，
  // priority 为空 → 覆盖预检被跳过 → 严格 gate 归一化后才发现 → 死锁在 overlay 上复活。
  const { tmp, jsonPath, shotHash } = invalidatedScreenProject({
    mustHaveElements: ['header', 'footer', 'cta'],
    screenId: 's1__overlay__0',
  });
  try {
    const refHash = hashImageFile(
      path.join(tmp, 'doc', 'features', 'feat', 'device-testing', 'device-screenshots', 'ref.png'),
    )!;
    const ctx = { projectRoot: tmp, feature: 'feat', fidelityTarget: 'pixel_1to1' } as never;
    const out = await runVisualProviderReview(ctx, {
      frameworkRoot: FRAMEWORK_ROOT,
      provider: { adapter: 'codex', model: 'm' },
      runId: 'R', attemptId: 'A',
      invoke: (async () => ({
        invoke_id: 'i1', provider: { adapter: 'codex', model: 'm' }, purpose: 'review',
        outcome: 'success', duration_ms: 1, image_hashes: [refHash, shotHash],
        workspace_dirtied: false, input_provenance: 'unverified',
        body: JSON.stringify({
          schema_version: '1.0', run_id: 'R', attempt_id: 'A',
          image_hashes: [refHash, shotHash],
          screens: [{
            screen_id: 's1__overlay__0', reference_image_hash: refHash, evaluated_screenshot_hash: shotHash,
            must_fix: [], defects: [],
            region_attest: [{ region: 'root', verdict: 'no_diff', method: 'vl_screening' }],
          }],
        }),
      })) as never,
    });
    assert.strictEqual(out.kind, 'unusable', 'overlay 屏同样必须在采信关口被拒');
    assert.match((out as { reason: string }).reason, /未覆盖屏级 must_have_elements/);
    const s = (JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as { screens: VisualDiffScreenEntry[] }).screens[0];
    assert.strictEqual(s.evaluation_invalidated, true, '未采信就不许清标记');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('t5 死锁闭环②：critic 回执写不出 → 不提交 visual-diff.json、不清标记', async () => {
  const { tmp, jsonPath, shotHash } = invalidatedScreenProject();
  try {
    const refHash = hashImageFile(
      path.join(tmp, 'doc', 'features', 'feat', 'device-testing', 'device-screenshots', 'ref.png'),
    )!;
    // 把回执目录占成**文件**，使写盘必然失败（mkdirSync 撞已存在的同名文件）。
    const reportsDir = path.join(tmp, 'doc', 'features', 'feat', 'device-testing', 'reports');
    fs.mkdirSync(path.dirname(reportsDir), { recursive: true });
    fs.writeFileSync(reportsDir, 'not-a-directory');
    const ctx = { projectRoot: tmp, feature: 'feat', fidelityTarget: 'semantic_layout' } as never;
    const out = await runVisualProviderReview(ctx, {
      frameworkRoot: FRAMEWORK_ROOT,
      provider: { adapter: 'codex', model: 'm' },
      runId: 'R', attemptId: 'A',
      invoke: (async () => ({
        invoke_id: 'i1', provider: { adapter: 'codex', model: 'm' }, purpose: 'review',
        outcome: 'success', duration_ms: 1, image_hashes: [refHash, shotHash],
        workspace_dirtied: false, input_provenance: 'unverified',
        body: JSON.stringify({
          schema_version: '1.0', run_id: 'R', attempt_id: 'A',
          image_hashes: [refHash, shotHash],
          screens: [{
            screen_id: 's1', reference_image_hash: refHash, evaluated_screenshot_hash: shotHash,
            must_fix: ['补齐底部按钮'],
            defects: [{ class: 'missing_render', severity: 'blocker', note: '按钮未渲染', must_fix_refs: [0] }],
          }],
        }),
      })) as never,
    });
    assert.strictEqual(out.kind, 'unusable', '回执落不了盘就不许提交评审结果');
    assert.match((out as { reason: string }).reason, /回执未能持久化/);
    // 盘上停在**调用前的清场态**（清场本就先落盘），本轮评审结果一条都没提交。
    const s = (JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as { screens: VisualDiffScreenEntry[] }).screens[0];
    assert.strictEqual(s.evaluation_invalidated, true, '标记保留 → 下一轮照常重评，不成死锁');
    assert.deepStrictEqual(s.must_fix, [], '未提交本轮 must_fix');
    assert.deepStrictEqual(s.defects, [], '未提交本轮 defects');
    assert.strictEqual(s.confirmed_by, '真人张三', 'confirmed_by 不由本机制改动');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('人签字段无豁免权：provider 不可用时仍清旧 verdict/hash，legacy confirmed_by 仅保留字节', async () => {
  const { tmp, jsonPath } = invalidatedScreenProject();
  try {
    const ctx = { projectRoot: tmp, feature: 'feat', fidelityTarget: 'semantic_layout' } as never;
    const out = await runVisualProviderReview(ctx, {
      frameworkRoot: FRAMEWORK_ROOT,
      provider: { adapter: 'codex', model: 'm' },
      runId: 'R', attemptId: 'A',
      invoke: (async () => ({
        invoke_id: 'i', provider: { adapter: 'codex', model: 'm' }, purpose: 'review',
        outcome: 'unavailable', reason: 'CLI 缺失', body: null, duration_ms: 1,
        image_hashes: [], workspace_dirtied: false, input_provenance: 'unverified',
      })) as never,
    });
    assert.strictEqual(out.kind, 'unusable');
    const s = (JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as { screens: VisualDiffScreenEntry[] }).screens[0];
    assert.strictEqual(s.verdict, 'pending', '旧 pass 不得因人签字段跨 attempt 存活');
    assert.strictEqual(s.confirmed_by, '真人张三');
    assert.strictEqual(s.evaluated_screenshot_hash, undefined, '旧被评 hash 必须清除');
    assert.strictEqual(s.evaluation_invalidated, true, '阻断由未清标记承担');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('t5 受理与披露分立：unverified 且载荷合法 → 照常写入回修（不因证据等级丢弃）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-review2-'));
  try {
    const feature = 'feat';
    const shotDir = path.join(tmp, 'doc', 'features', feature, 'device-testing', 'device-screenshots');
    fs.mkdirSync(shotDir, { recursive: true });
    fs.writeFileSync(path.join(shotDir, 'shot.png'), 'shot');
    fs.writeFileSync(path.join(shotDir, 'ref.png'), 'ref');
    const jsonPath = path.join(shotDir, 'visual-diff.json');
    fs.writeFileSync(jsonPath, JSON.stringify({
      schema_version: '1.1',
      screens: [{
        screen_id: 's1', verdict: 'pending',
        screenshot_path: 'doc/features/feat/device-testing/device-screenshots/shot.png',
        ref_path: 'doc/features/feat/device-testing/device-screenshots/ref.png',
        must_fix: [], defects: [],
      }],
    }, null, 2));
    const refHash = hashImageFile(path.join(shotDir, 'ref.png'))!;
    const shotHash = hashImageFile(path.join(shotDir, 'shot.png'))!;
    const ctx = { projectRoot: tmp, feature, fidelityTarget: 'semantic_layout' } as never;
    const out = await runVisualProviderReview(ctx, {
      frameworkRoot: FRAMEWORK_ROOT,
      provider: { adapter: 'codex', model: 'm' },
      runId: 'R', attemptId: 'A',
      invoke: (async () => ({
        invoke_id: 'i1', provider: { adapter: 'codex', model: 'm' }, purpose: 'review',
        outcome: 'success', duration_ms: 1, image_hashes: [refHash, shotHash],
        workspace_dirtied: false,
        // 无解析器 adapter 做 provider——证据等级如实 unverified
        input_provenance: 'unverified',
        body: JSON.stringify({
          schema_version: '1.0',
          run_id: 'R', attempt_id: 'A', image_hashes: [refHash, shotHash],
          screens: [{
            screen_id: 's1', reference_image_hash: refHash, evaluated_screenshot_hash: shotHash,
            must_fix: ['补齐底部按钮'],
            defects: [{ class: 'missing_render', severity: 'blocker', note: '按钮未渲染', must_fix_refs: [0] }],
          }],
        }),
      })) as never,
    });
    assert.strictEqual(out.kind, 'applied', 'unverified 不等于无效');
    const after = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as { screens: VisualDiffScreenEntry[] };
    assert.deepStrictEqual(after.screens[0].must_fix, ['补齐底部按钮']);
    assert.strictEqual(after.screens[0].defects![0].source?.producer, 'visual_provider');
    assert.strictEqual(after.screens[0].verdict, 'fail', 'harness 确定性映射：must_fix 非空 → fail');
    assert.strictEqual(after.screens[0].evaluated_screenshot_hash, shotHash, '盖上被评截图 hash（可行动性前提）');
    assert.strictEqual(after.screens[0].confirmed_by, undefined, 'provider 永不写 confirmed_by');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('t5 critic 回执路径窄分支：native 现状回归 + delegated 走 provider 证据流', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-receipt-'));
  const priorRun = process.env.MAISON_GOAL_RUN_ID;
  const priorAdapter = process.env.MAISON_GOAL_VISUAL_PROVIDER_ADAPTER;
  const priorModel = process.env.MAISON_GOAL_VISUAL_PROVIDER_MODEL;
  try {
    process.env.MAISON_GOAL_RUN_ID = 'R1';
    const ctx = { projectRoot: tmp, feature: 'feat' } as never;
    const nativePath = 'doc/features/feat/goal-runs/R1/phases/testing/agent-events.jsonl';
    const providerPath = 'doc/features/feat/device-testing/reports/visual-review/inv-1/agent-events.jsonl';

    // ① 未声明 provider（native）——现状逐字不变：只认 primary testing 阶段全路径
    delete process.env.MAISON_GOAL_VISUAL_PROVIDER_ADAPTER;
    delete process.env.MAISON_GOAL_VISUAL_PROVIDER_MODEL;
    assert.strictEqual(isCriticEvidencePathBound(ctx, 'claude', nativePath), true);
    assert.strictEqual(isCriticEvidencePathBound(ctx, 'claude', providerPath), false);

    // ② 声明了 provider=codex —— 只有 receipt.adapter 等于**声明的** provider 才走窄分支
    process.env.MAISON_GOAL_VISUAL_PROVIDER_ADAPTER = 'codex';
    process.env.MAISON_GOAL_VISUAL_PROVIDER_MODEL = 'm';
    assert.strictEqual(isCriticEvidencePathBound(ctx, 'codex', providerPath), true);
    assert.strictEqual(isCriticEvidencePathBound(ctx, 'codex', nativePath), false);
    // primary 的回执仍走 primary 支（分支判据取声明身份，不取回执自报，防自选宽松支）
    assert.strictEqual(isCriticEvidencePathBound(ctx, 'claude', providerPath), false);
    assert.strictEqual(isCriticEvidencePathBound(ctx, 'claude', nativePath), true);
    // 窄分支只放宽目录锚：任意深度嵌套/改名文件仍拒
    assert.strictEqual(
      isCriticEvidencePathBound(ctx, 'codex', 'doc/features/feat/device-testing/reports/visual-review/a/b/agent-events.jsonl'),
      false,
    );
    assert.strictEqual(
      isCriticEvidencePathBound(ctx, 'codex', 'doc/features/feat/device-testing/reports/visual-review/inv-1/other.jsonl'),
      false,
    );
  } finally {
    if (priorRun === undefined) delete process.env.MAISON_GOAL_RUN_ID;
    else process.env.MAISON_GOAL_RUN_ID = priorRun;
    if (priorAdapter === undefined) delete process.env.MAISON_GOAL_VISUAL_PROVIDER_ADAPTER;
    else process.env.MAISON_GOAL_VISUAL_PROVIDER_ADAPTER = priorAdapter;
    if (priorModel === undefined) delete process.env.MAISON_GOAL_VISUAL_PROVIDER_MODEL;
    else process.env.MAISON_GOAL_VISUAL_PROVIDER_MODEL = priorModel;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('t2 裁剪守护（源码锚定）：OCR 链无 provider 污染、无 provider 金丝雀', () => {
  const read = (...rel: string[]) => fs.readFileSync(path.join(FRAMEWORK_ROOT, ...rel), 'utf-8');
  // ① OCR 可用性判定不得沾 provider——无 provider canary 即无 ocr_capable 污染源
  const fidelity = read('harness', 'scripts', 'utils', 'fidelity-shared.ts');
  const ocrFn = fidelity.slice(fidelity.indexOf('export function resolveOcrAvailableForRun'));
  const ocrBody = ocrFn.slice(0, ocrFn.indexOf('\n}\n') + 3);
  for (const forbidden of ['visual_provider', 'visualProvider', 'vision_mode', 'reviewVision']) {
    assert.ok(!ocrBody.includes(forbidden), `resolveOcrAvailableForRun 不得引用 ${forbidden}`);
  }
  // ② 无 provider 金丝雀：真实调用即探测
  const canary = read('harness', 'scripts', 'utils', 'vision-canary.ts');
  assert.ok(!canary.includes('visual_provider'), 'vision-canary.ts 不得为 provider 增设金丝雀');
  const invoke = read('harness', 'scripts', 'utils', 'visual-provider-invoke.ts');
  assert.ok(!/canary/i.test(invoke), 'provider 执行器不得引入任何金丝雀概念');
});

test('t5 skipped 屏不进评审（skip 不得被洗成 pass）', () => {
  const targets = collectReviewTargets(
    { projectRoot: process.cwd(), feature: 'feat' } as never,
    [{ screen_id: 'a', verdict: 'skipped', screenshot_path: 'x.png', ref_path: 'y.png' }] as never,
  );
  assert.deepStrictEqual(targets, []);
});

test('t5 目标屏解析吃真实 capture 形态（ref_id → 权威参考图），不是只认 ref_path', () => {
  const tmp = mkReviewProject();
  try {
    // buildVisualDiffSkeletonEntry 的真实产物形态：只有 ref_id，没有 ref_path
    const entry = buildVisualDiffSkeletonEntry(
      tmp.root,
      tmp.feature,
      { id: 's1', priority: 'P0', ref_id: 'ref-s1' } as never,
    )!;
    assert.ok(entry, '骨架条目应生成');
    assert.strictEqual((entry as { ref_path?: string }).ref_path, undefined, '真实产物没有 ref_path');
    assert.strictEqual(entry.ref_id, 'ref-s1');
    // 把骨架给出的截图路径填上真图
    fs.mkdirSync(path.dirname(path.join(tmp.root, entry.screenshot_path!)), { recursive: true });
    fs.writeFileSync(path.join(tmp.root, entry.screenshot_path!), 'shot-bytes');

    const targets = collectReviewTargets(
      { projectRoot: tmp.root, feature: tmp.feature } as never,
      [entry],
    );
    assert.strictEqual(targets.length, 1, `真实 capture 形态必须解析出目标屏，实际 ${targets.length}`);
    assert.strictEqual(targets[0].screen_id, 's1');
    assert.strictEqual(targets[0].refAbs, path.resolve(tmp.root, 'doc/refs/home.png'));
    assert.deepStrictEqual(targets[0].priority, 'P0');
  } finally {
    fs.rmSync(tmp.root, { recursive: true, force: true });
  }
});

test('t5 清场在调用之前：provider 不可用时旧结果被清掉，不跨 attempt 复用', async () => {
  const tmp = mkReviewProject();
  try {
    const jsonPath = path.join(
      tmp.root, 'doc', 'features', tmp.feature, 'device-testing', 'device-screenshots', 'visual-diff.json',
    );
    const shotRel = `doc/features/${tmp.feature}/device-testing/device-screenshots/shot-s1.png`;
    fs.mkdirSync(path.dirname(path.join(tmp.root, shotRel)), { recursive: true });
    fs.writeFileSync(path.join(tmp.root, shotRel), 'shot-bytes');
    // 上一轮 provider 留下的「干净通过」：pass + 举证 + 被评 hash（最危险的旧结果形态）
    fs.writeFileSync(jsonPath, JSON.stringify({
      schema_version: '1.1',
      screens: [{
        screen_id: 's1', verdict: 'pass', ref_id: 'ref-s1', screenshot_path: shotRel,
        must_fix: [], defects: [],
        evaluated_screenshot_hash: 'stale-hash',
        region_attest: [{ region: '全屏', verdict: 'no_diff', method: 'vl_screening', by: 'visual_provider:claude:m' }],
      }],
    }, null, 2));

    const out = await runVisualProviderReview(
      { projectRoot: tmp.root, feature: tmp.feature, fidelityTarget: 'semantic_layout' } as never,
      {
        frameworkRoot: FRAMEWORK_ROOT,
        provider: { adapter: 'claude', model: 'm' },
        runId: 'R2', attemptId: 'A2',
        invoke: (async () => ({
          invoke_id: 'i', provider: { adapter: 'claude', model: 'm' }, purpose: 'review',
          outcome: 'unavailable', reason: 'CLI 缺失', body: null, duration_ms: 1,
          image_hashes: [], workspace_dirtied: false, input_provenance: 'unverified',
        })) as never,
      },
    );
    assert.strictEqual(out.kind, 'unusable');
    const after = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as { screens: VisualDiffScreenEntry[] };
    assert.strictEqual(after.screens[0].verdict, 'pending', '旧 provider verdict 必须被清成 pending');
    assert.strictEqual(after.screens[0].region_attest, undefined, '旧 provider 举证必须被清掉');
    assert.strictEqual(
      after.screens[0].evaluated_screenshot_hash, undefined,
      '旧被评 hash 必须被清掉（否则旧结论看起来仍可行动）',
    );
  } finally {
    fs.rmSync(tmp.root, { recursive: true, force: true });
  }
});

test('t5 清场只动 provider：T8 转录 defect 与其 must_fix 原样保留', () => {
  const entry: VisualDiffScreenEntry = {
    screen_id: 's1', verdict: 'fail',
    must_fix: ['T8 的修复'],
    defects: [{ class: 'other', severity: 'major', note: 'T8', must_fix_refs: [0],
      source: { producer: 'T8', finding_id: 'f1', signal: 'sig' } }],
    region_attest: [{ region: 'r', verdict: 'no_diff', method: 'paired_crop_compare', by: 'human' }],
  };
  resetDelegatedRoundState(entry);
  assert.deepStrictEqual(entry.must_fix, ['T8 的修复']);
  assert.strictEqual(entry.defects!.length, 1);
  assert.strictEqual(entry.defects![0].source?.producer, 'T8');
  assert.strictEqual(entry.region_attest!.length, 1, '非 provider 署名的举证不得被清');
});

test('t5 载荷校验：schema_version 不符 / must_fix 未锚定 一律拒收', () => {
  const t = mkTarget();
  const expected = { targets: [t], runId: 'R', attemptId: 'A', requireRegionAttest: false };
  const mk = (over: Record<string, unknown>) => JSON.stringify({
    schema_version: '1.0', run_id: 'R', attempt_id: 'A',
    image_hashes: [t.refHash, t.shotHash],
    screens: [{
      screen_id: 's1', reference_image_hash: t.refHash, evaluated_screenshot_hash: t.shotHash,
      must_fix: ['修 A'],
      defects: [{ class: 'clipping', severity: 'major', note: 'x', must_fix_refs: [0] }],
    }],
    ...over,
  });
  assert.strictEqual(validateVisualProviderReviewPayload(mk({}), expected).ok, true);
  const badVersion = validateVisualProviderReviewPayload(mk({ schema_version: '9.9' }), expected);
  assert.strictEqual(badVersion.ok, false);
  assert.match((badVersion as { reason: string }).reason, /schema_version 不符/);

  const orphan = JSON.parse(mk({})) as { screens: Array<{ defects: Array<{ must_fix_refs?: number[] }> }> };
  delete orphan.screens[0].defects[0].must_fix_refs;
  const r = validateVisualProviderReviewPayload(JSON.stringify(orphan), expected);
  assert.strictEqual(r.ok, false, '未锚定的 must_fix 之后清不掉，必须在校验期拒收');
  assert.match((r as { reason: string }).reason, /未被任何 defect 的 must_fix_refs 锚定/);
});

test('t5 review 每轮只发一次 invoke（单批覆盖全部目标屏，不按屏散发）', async () => {
  const tmp = mkReviewProject({ refIds: ['ref-s1', 'ref-s2', 'ref-s3'] });
  try {
    const jsonPath = path.join(
      tmp.root, 'doc', 'features', tmp.feature, 'device-testing', 'device-screenshots', 'visual-diff.json',
    );
    const screens = ['s1', 's2', 's3'].map(id => {
      const rel = `doc/features/${tmp.feature}/device-testing/device-screenshots/shot-${id}.png`;
      fs.mkdirSync(path.dirname(path.join(tmp.root, rel)), { recursive: true });
      fs.writeFileSync(path.join(tmp.root, rel), `shot-${id}`);
      return { screen_id: id, verdict: 'pending', ref_id: `ref-${id}`, screenshot_path: rel };
    });
    fs.writeFileSync(jsonPath, JSON.stringify({ schema_version: '1.1', screens }, null, 2));

    let calls = 0;
    let screensSeen = 0;
    await runVisualProviderReview(
      { projectRoot: tmp.root, feature: tmp.feature, fidelityTarget: 'semantic_layout' } as never,
      {
        frameworkRoot: FRAMEWORK_ROOT,
        provider: { adapter: 'claude', model: 'm' },
        runId: 'R', attemptId: 'A',
        invoke: (async (i: { imagePaths: string[] }) => {
          calls += 1;
          screensSeen = i.imagePaths.length / 2;
          return {
            invoke_id: 'i', provider: { adapter: 'claude', model: 'm' }, purpose: 'review',
            outcome: 'unavailable', reason: 'stub', body: null, duration_ms: 1,
            image_hashes: [], workspace_dirtied: false, input_provenance: 'unverified',
          };
        }) as never,
      },
    );
    assert.strictEqual(calls, 1, '每轮恰好一次 invoke');
    assert.strictEqual(screensSeen, 3, '这一次 invoke 覆盖全部三屏（不按屏散发）');
  } finally {
    fs.rmSync(tmp.root, { recursive: true, force: true });
  }
});

test('t5 交互态（无 run/attempt）也写出结构合法的 unverified 回执', () => {
  const tmp = mkReviewProject();
  try {
    const abs = writeDelegatedCriticReceipt({
      projectRoot: tmp.root,
      feature: tmp.feature,
      provider: { adapter: 'claude', model: 'm' },
      invocation: {
        invoke_id: 'inv-1', provider: { adapter: 'claude', model: 'm' }, purpose: 'review',
        outcome: 'success', body: '{}', duration_ms: 1, image_hashes: [],
        workspace_dirtied: false, input_provenance: 'verified',
      } as never,
      prompt: 'p',
      targets: [mkTarget()],
    });
    assert.ok(abs, '交互态必须写出回执——否则 pixel candidate 路径形成无解 BLOCKER');
    const r = JSON.parse(fs.readFileSync(abs!, 'utf-8')) as Record<string, unknown>;
    assert.match(String(r.critic_run_id), /^interactive-/);
    assert.strictEqual(r.input_provenance, 'unverified', '交互态如实标 unverified');
    assert.strictEqual(r.runner_attestation, undefined, '交互态不造 attestation 空主张');
    assert.ok(Array.isArray(r.image_inputs) && (r.image_inputs as unknown[]).length > 0);
  } finally {
    fs.rmSync(tmp.root, { recursive: true, force: true });
  }
});

test('t5 unavailable 投影仍跑确定性红线：改判脚本物证照样 BLOCKER FAIL', () => {
  const tmp = mkReviewProject();
  try {
    const dtDir = path.join(tmp.root, 'doc', 'features', tmp.feature, 'device-testing');
    fs.mkdirSync(dtDir, { recursive: true });
    fs.writeFileSync(
      path.join(dtDir, 'fill-pass.mjs'),
      "const p='visual-diff.json'; s.verdict='pass'; s.must_fix=[]; s.confirmed_by='someone';\n",
    );
    const results = checkVisualDiffDeterministicOnly(
      { projectRoot: tmp.root, feature: tmp.feature } as never,
    );
    const tamper = results.find(r => r.id === 'visual_diff_tamper_artifact');
    assert.ok(tamper, 'unavailable 路径必须仍能扫出改判脚本物证');
    assert.strictEqual(tamper!.severity, 'BLOCKER');
    assert.strictEqual(tamper!.status, 'FAIL');
  } finally {
    fs.rmSync(tmp.root, { recursive: true, force: true });
  }
});

test('t1 attended 冻结：prepare 后改 local，gate 仍用 manifest 冻结的 provider', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-attended-'));
  const runId = '20260826T120000Z-vp';
  const prior = { ...process.env };
  try {
    fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
      schema_version: '1.1', project_name: 'vp-attended', paths: { features_dir: 'doc/features' },
    }, null, 2) + '\n', 'utf-8');
    clearFrameworkConfigCache();
    const manifest = buildGoalManifestFromInput({
      feature: 'demo', run_id: runId, requirement: 'r', adapter: 'codex',
      unattended: { write_mode: 'full-access', approval_mode: 'never' },
      // 创建 manifest 时冻结的 provider
      visual_provider_pin: { adapter: 'claude', model: 'frozen-model' },
    }, { projectRoot: root, runId });
    assert.deepStrictEqual(manifest.visual_provider_pin, { adapter: 'claude', model: 'frozen-model' });
    writeGoalManifest(manifest, root);
    const runDir = path.resolve(root, ...manifest.report_dir.split('/'));
    const control = ensureRunControl(runDir, runId);
    const acquired = casAcquireRunOwner(runDir, runId, control.current_epoch, {
      kind: 'session', owner_id: 'session-vp', lease_ms: 60_000,
    });
    assert.ok(acquired.ok);
    if (!acquired.ok) return;

    // prepare 之后有人改了个人级配置——**不得**因此换掉本 run 的视觉 endpoint
    fs.writeFileSync(path.join(root, 'framework.local.json'), JSON.stringify({
      schema_version: '1.0', agent_adapter: 'codex',
      vision: { visual_provider: { adapter: 'opencode', model: 'sneaky-model' } },
    }, null, 2));

    const env: NodeJS.ProcessEnv = {};
    bindAttendedGoalContext({
      projectRoot: root, feature: 'demo', phase: 'spec', goalRunId: runId,
      goalAttemptId: 'session-e1-round-1', goalOwnerId: acquired.token.owner_id,
      goalOwnerEpoch: acquired.token.epoch, env,
    });
    assert.strictEqual(env.MAISON_GOAL_VISUAL_PROVIDER_ADAPTER, 'claude');
    assert.strictEqual(env.MAISON_GOAL_VISUAL_PROVIDER_MODEL, 'frozen-model');
    // gate 侧解析同样落在冻结值上（env 优先于 local）
    const priorAdapter = process.env.MAISON_GOAL_VISUAL_PROVIDER_ADAPTER;
    const priorModel = process.env.MAISON_GOAL_VISUAL_PROVIDER_MODEL;
    try {
      process.env.MAISON_GOAL_VISUAL_PROVIDER_ADAPTER = env.MAISON_GOAL_VISUAL_PROVIDER_ADAPTER!;
      process.env.MAISON_GOAL_VISUAL_PROVIDER_MODEL = env.MAISON_GOAL_VISUAL_PROVIDER_MODEL!;
      assert.deepStrictEqual(
        resolveActiveVisualProvider(root, FRAMEWORK_ROOT).pin,
        { adapter: 'claude', model: 'frozen-model' },
      );
    } finally {
      if (priorAdapter === undefined) delete process.env.MAISON_GOAL_VISUAL_PROVIDER_ADAPTER;
      else process.env.MAISON_GOAL_VISUAL_PROVIDER_ADAPTER = priorAdapter;
      if (priorModel === undefined) delete process.env.MAISON_GOAL_VISUAL_PROVIDER_MODEL;
      else process.env.MAISON_GOAL_VISUAL_PROVIDER_MODEL = priorModel;
    }
    releaseRunOwner(runDir, acquired.token);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in prior)) delete process.env[k];
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('t1 record-visual-provider 走 updateLocalConfig（不手写 JSON、不抹邻段）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-record-'));
  try {
    fs.writeFileSync(path.join(tmp, 'framework.local.json'), JSON.stringify({
      schema_version: '1.0',
      agent_adapter: 'claude',
      device: { unlock: { mode: 'credential', credential_ref: 'keep-me' } },
      vision: { canary: { adapter: 'claude', verdict: 'none', probed_at: '2026-01-01T00:00:00Z' } },
    }, null, 2));
    const res = executeInitTask(
      { id: 'record-visual-provider' } as never,
      'run' as never,
      {
        projectRoot: tmp,
        harnessRoot: path.join(FRAMEWORK_ROOT, 'harness'),
        plan: {} as never,
        visualProvider: { adapter: 'claude', model: 'm1' },
      } as never,
    );
    assert.match(res.message, /vision\.visual_provider=claude:m1/);
    const local = JSON.parse(fs.readFileSync(path.join(tmp, 'framework.local.json'), 'utf-8')) as Record<string, never>;
    assert.deepStrictEqual((local.vision as never as { visual_provider: unknown }).visual_provider,
      { adapter: 'claude', model: 'm1' });
    assert.strictEqual((local.device as never as { unlock: { credential_ref: string } }).unlock.credential_ref,
      'keep-me', '邻段（设备凭据引用）必须无损保留');
    assert.ok((local.vision as never as { canary?: unknown }).canary, 'vision 内既有 canary 段必须保留');
    // 不受支持的 adapter：任务 failed（请重选/跳过），绝不自动改选
    assert.throws(
      () => executeInitTask(
        { id: 'record-visual-provider' } as never, 'run' as never,
        { projectRoot: tmp, harnessRoot: path.join(FRAMEWORK_ROOT, 'harness'), plan: {} as never,
          visualProvider: { adapter: 'codeagent', model: 'm' } } as never,
      ),
      /暂未接入视觉 provider/,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('t1 入口闭环：check-personal-setup advisory 让「问不问」成为确定性判定', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-advisory-'));
  try {
    const write = (vision: unknown) => fs.writeFileSync(
      path.join(tmp, 'framework.local.json'),
      JSON.stringify({ schema_version: '1.0', agent_adapter: 'claude', ...(vision ? { vision } : {}) }, null, 2),
    );
    write(null);
    const absent = buildVisualProviderAdvisory(tmp);
    assert.strictEqual(absent.state, 'absent');
    assert.strictEqual(absent.shouldPrompt, true, 'local 缺失 → 问一次');
    assert.deepStrictEqual(absent.supported, listVisualProviderAdapterNames(FRAMEWORK_ROOT));
    assert.strictEqual(absent.decisionClass, 'setup.visual_provider');
    assert.strictEqual(absent.task, 'record-visual-provider');

    write({ visual_provider: { adapter: 'claude', model: 'm1' } });
    const ok = buildVisualProviderAdvisory(tmp);
    assert.strictEqual(ok.state, 'ok');
    assert.strictEqual(ok.shouldPrompt, false, '已配且受支持 → 不再问');
    assert.strictEqual(ok.prompt, undefined);

    write({ visual_provider: { adapter: 'codeagent', model: 'm1' } });
    const bad = buildVisualProviderAdvisory(tmp);
    assert.strictEqual(bad.state, 'unsupported');
    assert.strictEqual(bad.shouldPrompt, true, '已失格 → 提示重选一次');
    assert.match(String(bad.prompt), /严格视觉需求会由 capability 门禁诚实 defer/);

    fs.writeFileSync(path.join(tmp, 'framework.local.json'), '{broken-json', 'utf-8');
    const unavailable = buildVisualProviderAdvisory(tmp);
    assert.strictEqual(unavailable.state, 'unavailable');
    assert.strictEqual(unavailable.shouldPrompt, true, '读取不可用仍须提示修复，但不得产生授权');
    assert.match(String(unavailable.prompt), /修复 framework\.local\.json/);
    assert.doesNotMatch(String(unavailable.prompt), /allow-blind-visual/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('t1 入口文档锚定：visualProvider 已登记为稳定 stdout 字段并写清消费方式', () => {
  const doc = fs.readFileSync(
    path.join(FRAMEWORK_ROOT, 'skills', 'reference', 'personal-setup-gate.md'),
    'utf-8',
  );
  // 稳定字段清单必须含它——消费方只解析 stdout JSON，未登记的字段等于不存在。
  const stableLine = doc.split('\n').find(l => l.includes('仅解析 stdout JSON'));
  assert.ok(stableLine, '稳定字段声明行缺失');
  assert.match(stableLine!, /`visualProvider`/, 'visualProvider 未登记进稳定字段清单');
  // 消费判据必须写死为读机器字段，而不是让 agent 自己推断问不问。
  assert.match(doc, /visualProvider\.shouldPrompt/);
  assert.match(doc, /永不.*影响 `ok` \/ `code`/, 'checker 无 UI/primary 上下文，不得全局阻断');
  assert.match(doc, /条件\s*prerequisite/, 'goal 启动条件 prerequisite 语义须写清');
  for (const field of ['decisionClass', 'task', 'supported']) {
    assert.ok(doc.includes(`visualProvider.${field}`), `消费方式未说明 visualProvider.${field}`);
  }
});

test('t1 personal 任务计划：record-visual-provider 携带 catalog 派生候选', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-plan-'));
  try {
    fs.writeFileSync(path.join(tmp, 'framework.config.json'), JSON.stringify({
      schema_version: '1.1', project_name: 'p', materialized_adapters: ['claude'],
      architecture: {
        outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
        module_inner_layers: ['shared'], inner_dependency_direction: 'upward',
        cross_module_exports_file: 'index.ets',
      },
      paths: { features_dir: 'doc/features' },
    }, null, 2));
    const plan = probeInitTaskPlan({ projectRoot: tmp, scope: 'personal' });
    const task = plan.tasks.find(t => t.id === 'record-visual-provider');
    assert.ok(task, 'personal 计划须含 record-visual-provider');
    assert.strictEqual(task!.skippable, true, '跳过合法——provider 不是 setup 前置条件');
    assert.strictEqual(task!.decision_class, 'setup.visual_provider');
    assert.deepStrictEqual(
      (task!.params as { visual_provider_candidates: string[] }).visual_provider_candidates,
      listVisualProviderAdapterNames(FRAMEWORK_ROOT),
    );
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('t3 传输面失败分档：超时 / terminal failure / 非零退出 一律 unavailable', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-outcome-'));
  try {
    const img = path.join(tmp, 'a.png');
    fs.writeFileSync(img, 'img');
    const call = (result: Record<string, unknown>) => invokeVisualProvider({
      projectRoot: tmp, frameworkRoot: FRAMEWORK_ROOT,
      provider: { adapter: 'claude', model: 'm' }, purpose: 'review',
      prompt: 'p', imagePaths: [img], invokeId: 'i',
      invokeAgent: (async () => ({ exitCode: 0, stdout: '', stderr: '', command: 'x', ...result })) as never,
    });
    for (const [label, r] of [
      ['timeout', { timed_out: true }],
      ['terminal failure', { terminal_failure_observed: true }],
      ['non-zero exit', { exitCode: 2 }],
      ['spawn error', { spawn_error: { message: 'CLI 缺失' } }],
    ] as Array<[string, Record<string, unknown>]>) {
      const inv = await call(r);
      assert.strictEqual(inv.outcome, 'unavailable', `${label} 应判 unavailable`);
      assert.strictEqual(inv.body, null);
    }
    // 内容面失败（有回应但信封投不出正文）判 invalid，与传输面分开
    const invalid = await call({ stdout: 'not an envelope' });
    assert.strictEqual(invalid.outcome, 'invalid');
    // 声明缺失同样 unavailable（不抛错）
    const noDecl = await invokeVisualProvider({
      projectRoot: tmp, frameworkRoot: FRAMEWORK_ROOT,
      provider: { adapter: 'codeagent', model: 'm' }, purpose: 'review',
      prompt: 'p', imagePaths: [img], invokeId: 'i',
    });
    assert.strictEqual(noDecl.outcome, 'unavailable');
    assert.match(noDecl.reason ?? '', /visual_provider 未声明/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('t3 脏检查：invoke 弄脏工作区 → 丢弃本轮结果且**不**自动 revert', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-dirty-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: tmp, windowsHide: true });
    fs.writeFileSync(path.join(tmp, '.gitignore'), '');
    execFileSync('git', ['add', '-A'], { cwd: tmp, windowsHide: true });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'],
      { cwd: tmp, windowsHide: true });
    const img = path.join(tmp, 'a.png');
    fs.writeFileSync(img, 'img');
    execFileSync('git', ['add', '-A'], { cwd: tmp, windowsHide: true });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'img'],
      { cwd: tmp, windowsHide: true });

    const sneaked = path.join(tmp, 'provider-wrote-this.txt');
    const good = JSON.stringify({ type: 'result', subtype: 'success', result: '{"ok":1}' });
    const inv = await invokeVisualProvider({
      projectRoot: tmp, frameworkRoot: FRAMEWORK_ROOT,
      provider: { adapter: 'claude', model: 'm' }, purpose: 'review',
      prompt: 'p', imagePaths: [img], invokeId: 'i',
      invokeAgent: (async () => {
        fs.writeFileSync(sneaked, 'provider should not have written this');
        return { exitCode: 0, stdout: good, stderr: '', command: 'x' };
      }) as never,
    });
    assert.strictEqual(inv.outcome, 'invalid', '弄脏工作区 → 本轮结果一律不采信');
    assert.strictEqual(inv.workspace_dirtied, true);
    assert.strictEqual(inv.body, null);
    assert.ok(fs.existsSync(sneaked), '**不得**自动 revert——现场留给人看');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('t3/t5 事件流落盘：成功与失败都留下 invoke-event.json', async () => {
  const tmp = mkReviewProject();
  try {
    const jsonPath = path.join(
      tmp.root, 'doc', 'features', tmp.feature, 'device-testing', 'device-screenshots', 'visual-diff.json',
    );
    const rel = `doc/features/${tmp.feature}/device-testing/device-screenshots/shot-s1.png`;
    fs.mkdirSync(path.dirname(path.join(tmp.root, rel)), { recursive: true });
    fs.writeFileSync(path.join(tmp.root, rel), 'shot');
    fs.writeFileSync(jsonPath, JSON.stringify({
      schema_version: '1.1',
      screens: [{ screen_id: 's1', verdict: 'pending', ref_id: 'ref-s1', screenshot_path: rel }],
    }, null, 2));
    await runVisualProviderReview(
      { projectRoot: tmp.root, feature: tmp.feature, fidelityTarget: 'semantic_layout' } as never,
      {
        frameworkRoot: FRAMEWORK_ROOT, provider: { adapter: 'claude', model: 'm' },
        runId: 'R', attemptId: 'A',
        invoke: (async () => ({
          invoke_id: 'review-R-A-1', provider: { adapter: 'claude', model: 'm' }, purpose: 'review',
          outcome: 'unavailable', reason: 'stub', body: null, duration_ms: 1,
          image_hashes: [], workspace_dirtied: false, input_provenance: 'unverified',
        })) as never,
      },
    );
    const evtDir = path.join(
      tmp.root, 'doc', 'features', tmp.feature, 'device-testing', 'reports', 'visual-review', 'review-R-A-1',
    );
    const evtPath = path.join(evtDir, 'invoke-event.json');
    assert.ok(fs.existsSync(evtPath), '失败轮次同样要留下调用事件');
    const evt = JSON.parse(fs.readFileSync(evtPath, 'utf-8')) as Record<string, unknown>;
    assert.strictEqual(evt.type, 'visual_provider_invoke');
    assert.strictEqual(evt.outcome, 'unavailable');
    assert.strictEqual(evt.purpose, 'review');
    assert.strictEqual(evt.provider, 'claude');
  } finally {
    fs.rmSync(tmp.root, { recursive: true, force: true });
  }
});

test('t4 sidecar：整体失败也只是"没有 sidecar"——不抛错、不产 check、不阻断 spec', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-sidecar-'));
  try {
    fs.writeFileSync(path.join(tmp, 'framework.config.json'), JSON.stringify({
      schema_version: '1.1', project_name: 'p', paths: { features_dir: 'doc/features' },
    }, null, 2));
    clearFrameworkConfigCache();
    const imgA = path.join(tmp, 'a.png');
    const imgB = path.join(tmp, 'b.png');
    fs.writeFileSync(imgA, 'aaa');
    fs.writeFileSync(imgB, 'bbb');
    const seen: string[] = [];
    // 本机通常没有可用的 provider CLI —— 两张图都会走 unavailable 分支。
    // 断言的是**失败语义**：逐图独立、整体不抛错、返回值就是盘上可用 sidecar 列表。
    const paths = await produceVisualObservationSidecars({
      projectRoot: tmp,
      frameworkRoot: FRAMEWORK_ROOT,
      feature: 'feat',
      provider: { adapter: 'claude', model: 'm' },
      referenceImages: [imgA, imgB],
      timeoutMs: 1_000,
      onInvocation: (inv) => seen.push(inv.outcome),
    });
    assert.ok(Array.isArray(paths), '整体失败必须正常返回，不抛错');
    assert.deepStrictEqual(paths, [], '失败即"该图没有 sidecar"，不是错误');
    assert.strictEqual(seen.length, 2, '逐图独立尝试——第一张失败不阻断第二张');
    assert.ok(seen.every(o => o !== 'success'));
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('t5 接线纪律（源码锚定）：provider 评审显式 await、不塞进同步 safeRun；provider 缺陷不进 signal@1', () => {
  const checkTesting = fs.readFileSync(
    path.join(FRAMEWORK_ROOT, 'harness', 'scripts', 'check-testing.ts'), 'utf-8',
  );
  assert.ok(
    checkTesting.includes('await runDelegatedVisualProviderReview(ctx)'),
    'provider 评审必须显式 await（safeRun 是同步壳，塞 Promise 会静默丢异常与结果）',
  );
  assert.ok(
    !/safeRun\(\s*\(\)\s*=>\s*runDelegatedVisualProviderReview/.test(checkTesting),
    '不得把异步评审包进同步 safeRun',
  );
  const goalRunner = fs.readFileSync(
    path.join(FRAMEWORK_ROOT, 'harness', 'scripts', 'goal-phase-runtime.ts'), 'utf-8',
  );
  // provider 源的结构化视觉缺陷必须以 signal_identity:false 物化——进 signal@1 就会
  // 因"结构上恒未复核"把每个 delegated 轮次停成 repair_adjudication_pending。
  assert.ok(
    goalRunner.includes('signal_identity: !fromVisualProvider'),
    'provider 缺陷必须排除在 signal@1 复核管线之外',
  );
  assert.ok(
    goalRunner.includes(`.source?.producer === 'visual_provider'`),
    '排除判据须取 defect 的 provider 溯源',
  );
});


// plan b3d7e5a1 T5（codex P1）：全部屏都因整页参考图被排除时，provider 早退**之前**必须复位旧 provider 状态并落盘，
// 否则旧 PASS/attest 会以"本轮没评"为名跨轮存活；同时不得调用 provider。
test('b3d7e5a1 T5：长图屏使评审目标为空 → skipped 前复位旧 provider 状态并落盘，不调用 provider', async () => {
  const headerOnlyPng = (w: number, h: number): Buffer => {
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = Buffer.alloc(25);
    ihdr.writeUInt32BE(13, 0); ihdr.write('IHDR', 4, 'ascii');
    ihdr.writeUInt32BE(w, 8); ihdr.writeUInt32BE(h, 12); ihdr[16] = 8; ihdr[17] = 6;
    const iend = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
    return Buffer.concat([sig, ihdr, iend]);
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-viewport-'));
  try {
    const feature = 'feat';
    const specDir = path.join(tmp, 'doc', 'features', feature, 'spec');
    const shotDir = path.join(tmp, 'doc', 'features', feature, 'device-testing', 'device-screenshots');
    fs.mkdirSync(path.join(specDir, 'assets'), { recursive: true });
    fs.mkdirSync(shotDir, { recursive: true });
    const refRel = `doc/features/${feature}/spec/assets/ref-home.png`;
    const shotRel = `doc/features/${feature}/device-testing/device-screenshots/shot-home.png`;
    fs.writeFileSync(path.join(tmp, refRel), headerOnlyPng(1320, 4350));
    fs.writeFileSync(path.join(tmp, shotRel), headerOnlyPng(1320, 2120));
    fs.writeFileSync(path.join(specDir, 'spec.md'), [
      '```yaml', 'ui_change: new_or_changed', 'visual_handoff:',
      '  kind: authoritative_refs', '  authoritative_refs:', '    - id: home', `      path: ${refRel}`, '```', '',
    ].join('\n'));
    fs.writeFileSync(path.join(specDir, 'ui-spec.yaml'), [
      'schema_version: "1.0"', 'verified: unverified', 'screens:',
      '  - id: home', '    priority: P0', '    ref_id: home',
      'tokens: {}', 'assets: []',
    ].join('\n'));
    const { hashScreenshotFile } = require('../../../profiles/hmos-app/harness/visual-diff-check') as { hashScreenshotFile: (p: string) => string | null };
    const shotHash = hashScreenshotFile(path.join(tmp, shotRel))!;
    const jsonPath = path.join(shotDir, 'visual-diff.json');
    fs.writeFileSync(jsonPath, JSON.stringify({
      schema_version: '1.1',
      screens: [{
        screen_id: 'home', ref_id: 'home', verdict: 'pass',
        screenshot_path: shotRel, screenshot_hash: shotHash, evaluated_screenshot_hash: shotHash,
        must_fix: [], defects: [],
        region_attest: [{ region: 'header', method: 'vl_screening', by: 'visual_provider:claude', note: 'old' }],
      }],
    }, null, 2));
    let invoked = 0;
    const ctx = { projectRoot: tmp, feature, fidelityTarget: 'semantic_layout', specVisualSources: { external_roots: [], allow_absolute_paths: false, allow_network_paths: false } } as never;
    const out = await runVisualProviderReview(ctx, {
      frameworkRoot: FRAMEWORK_ROOT,
      provider: { adapter: 'claude', model: 'm' },
      runId: 'R', attemptId: 'A',
      invoke: (async () => { invoked += 1; throw new Error('must not invoke'); }) as never,
    });
    assert.strictEqual(out.kind, 'skipped', JSON.stringify(out));
    assert.match((out as { reason?: string }).reason ?? '', /尺寸不兼容/);
    assert.strictEqual(invoked, 0, '长图屏不得触发 provider 调用');
    const after = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as { screens: Array<Record<string, unknown>> };
    const row = after.screens[0]!;
    assert.strictEqual(row.verdict, 'pending', '早退前须复位为 pending');
    assert.strictEqual(row.evaluated_screenshot_hash, undefined, '旧 provider hash 不得存活');
    assert.strictEqual(row.region_attest, undefined, '旧 provider attest 不得存活');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

export async function runAll(): Promise<UnitCaseResult[]> {
  const out: UnitCaseResult[] = [];
  for (const c of CASES) {
    try {
      await c.run();
      out.push({ name: c.name, ok: true });
    } catch (e) {
      out.push({ name: c.name, ok: false, error: e instanceof Error ? (e.stack ?? e.message) : String(e) });
    }
  }
  return out;
}
