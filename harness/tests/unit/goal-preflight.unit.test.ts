// goal-preflight.unit.test.ts

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache, loadFrameworkConfig } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
import { resolveWorkflowSpec } from '../../workflow-loader';
import {
  resolveAdapterProvenance,
  runGoalPreflight,
  reconcileRunAdapter,
  decideVisionCanaryProbe,
  runVisionCanaryProbe,
} from '../../scripts/utils/goal-preflight';
import { writeLocalConfig, loadLocalConfig } from '../../scripts/utils/framework-local-config';
import { buildCanaryPrompt, VISION_CANARY_PROBE_VERSION } from '../../scripts/utils/vision-canary';
import type { invokeAgentHeadless } from '../../scripts/utils/agent-invoke';
import type { GoalManifest } from '../../scripts/utils/goal-manifest';
import { DEFAULT_DEPENDENCY_POLICY, resolveAutoChain } from '../../scripts/utils/phase-transition-policy';
import type { UnitCaseResult } from '../run-unit';

const FRAMEWORK_ROOT = path.resolve(__dirname, '../../..');

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'goal-preflight-'));
}

function minimalArchitecture(): Record<string, unknown> {
  return {
    outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
    module_inner_layers: ['shared'],
    inner_dependency_direction: 'upward',
    cross_module_exports_file: 'index.ets',
  };
}

function writeProjectConfig(root: string, materialized: string[]): void {
  fs.writeFileSync(
    path.join(root, 'framework.config.json'),
    JSON.stringify(
      {
        schema_version: '1.1',
        project_name: 'goal-preflight',
        materialized_adapters: materialized,
        architecture: minimalArchitecture(),
        paths: { features_dir: 'doc/features' },
      },
      null,
      2,
    ),
  );
}

/** 搭 temp 工程：materialized + 入口产物（cursor→AGENTS.md / claude→CLAUDE.md）+ 可选 local agent_adapter */
function setupAdapters(root: string, materialized: string[], localAdapter?: string): void {
  writeProjectConfig(root, materialized);
  if (materialized.includes('cursor')) fs.writeFileSync(path.join(root, 'AGENTS.md'), '# stub\n');
  if (materialized.includes('claude')) fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# stub\n');
  if (localAdapter) {
    fs.writeFileSync(
      path.join(root, 'framework.local.json'),
      JSON.stringify({ schema_version: '1.0', agent_adapter: localAdapter }, null, 2),
    );
  }
  clearFrameworkConfigCache();
}

function withTmp(fn: (root: string) => void): void {
  const root = mkTmp();
  try {
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    clearFrameworkConfigCache();
  }
}

async function withTmpAsync(fn: (root: string) => Promise<void>): Promise<void> {
  const root = mkTmp();
  try {
    await fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    clearFrameworkConfigCache();
  }
}

/**
 * plan c7d2e9a4 t6：runVisionCanaryProbe 写盘边界的最小 frameworkRoot 夹具——
 * agents/claude/adapter.yaml 只含 loadGoalCapability 声明级校验所需字段
 * （不查模板文件存在）；harness/assets 由 ensureVisionCanaryAsset 自建。
 */
function setupCanaryFrameworkFixture(root: string): string {
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

function preflightCtx(root: string, manifest: GoalManifest) {
  const cfg = loadFrameworkConfig(root);
  const resolvedProfile = loadResolvedProfile(root, cfg);
  const workflow = resolveWorkflowSpec(root, { config: cfg, frameworkRoot: FRAMEWORK_ROOT });
  const chain = resolveAutoChain(workflow, manifest.start_phase, manifest.end_phase);
  return { cfg, resolvedProfile, chain };
}

function baseManifest(adapter: string, endPhase: GoalManifest['end_phase'] = 'spec'): GoalManifest {
  return {
    schema_version: '1.0',
    run_id: 'test-run',
    feature: 'demo',
    requirement: 'test',
    adapter,
    start_phase: 'spec',
    end_phase: endPhase,
    report_dir: 'doc/features/demo/goal-runs/test-run',
    created_at: '2026-06-09T00:00:00Z',
    unattended: {
      write_mode: 'workspace-write',
      approval_mode: 'never',
      max_turns: 20,
      timeout_seconds: 3600,
    },
    budget: {
      max_total_turns: 10,
      max_retries_per_phase: 1,
      wall_clock_minutes: 60,
      max_transient_api_retries: 3,
    },
    dependency_policy: {
      deferrable_blocking_classes: DEFAULT_DEPENDENCY_POLICY.deferrable_blocking_classes ?? [],
      deferrable_failure_kinds: DEFAULT_DEPENDENCY_POLICY.deferrable_failure_kinds ?? [],
      propagate_to_downstream: DEFAULT_DEPENDENCY_POLICY.propagate_to_downstream ?? true,
    },
  };
}

const cases: Array<{ name: string; run: () => void | Promise<void> }> = [
  {
    name: 'resolveAdapterProvenance: --adapter → argv_adapter',
    run: () => {
      const p = resolveAdapterProvenance(
        { adapter: 'cursor' },
        { agent_adapter: 'generic', source: 'fallback', local_exists: false, project_has_legacy_agent_adapter: false },
      );
      assert.strictEqual(p, 'argv_adapter');
    },
  },
  {
    name: 'resolveAdapterProvenance: --resume → manifest_adapter',
    run: () => {
      const p = resolveAdapterProvenance(
        { resume: 'run-1' },
        { agent_adapter: 'generic', source: 'fallback', local_exists: false, project_has_legacy_agent_adapter: false },
      );
      assert.strictEqual(p, 'manifest_adapter');
    },
  },
  {
    name: 'runGoalPreflight: fallback provenance BLOCKER',
    run: () => {
      const root = mkTmp();
      writeProjectConfig(root, ['cursor']);
      fs.writeFileSync(path.join(root, 'AGENTS.md'), '# stub\n');
      clearFrameworkConfigCache();
      const manifest = baseManifest('cursor');
      const { resolvedProfile, chain } = preflightCtx(root, manifest);
      let threw = false;
      try {
        runGoalPreflight({
          projectRoot: root,
          frameworkRoot: FRAMEWORK_ROOT,
          manifest,
          provenance: 'fallback',
          dryRun: false,
          chain,
          resolvedProfile,
        });
      } catch (e) {
        threw = true;
        assert.match((e as Error).message, /framework\.local\.json/);
      }
      assert.ok(threw, 'expected BLOCKER');
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'runGoalPreflight: argv_adapter 显式 cursor 已物化不因 fallback 误杀',
    run: () => {
      const root = mkTmp();
      writeProjectConfig(root, ['cursor']);
      fs.writeFileSync(path.join(root, 'AGENTS.md'), '# stub\n');
      clearFrameworkConfigCache();
      const manifest = baseManifest('cursor');
      const { resolvedProfile, chain } = preflightCtx(root, manifest);
      runGoalPreflight({
        projectRoot: root,
        frameworkRoot: FRAMEWORK_ROOT,
        manifest,
        provenance: 'argv_adapter',
        dryRun: true,
        chain,
        resolvedProfile,
      });
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'runGoalPreflight: manifest_adapter 无 local 不因 fallback 误杀',
    run: () => {
      const root = mkTmp();
      writeProjectConfig(root, ['cursor']);
      fs.writeFileSync(path.join(root, 'AGENTS.md'), '# stub\n');
      clearFrameworkConfigCache();
      const manifest = baseManifest('cursor');
      const { resolvedProfile, chain } = preflightCtx(root, manifest);
      runGoalPreflight({
        projectRoot: root,
        frameworkRoot: FRAMEWORK_ROOT,
        manifest,
        provenance: 'manifest_adapter',
        dryRun: true,
        chain,
        resolvedProfile,
      });
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'runGoalPreflight: adapter 不在 materialized BLOCKER',
    run: () => {
      const root = mkTmp();
      writeProjectConfig(root, ['claude']);
      fs.writeFileSync(path.join(root, 'AGENTS.md'), '# stub\n');
      clearFrameworkConfigCache();
      const manifest = baseManifest('cursor');
      const { resolvedProfile, chain } = preflightCtx(root, manifest);
      let threw = false;
      try {
        runGoalPreflight({
          projectRoot: root,
          frameworkRoot: FRAMEWORK_ROOT,
          manifest,
          provenance: 'argv_adapter',
          dryRun: false,
          chain,
          resolvedProfile,
        });
      } catch (e) {
        threw = true;
        assert.match((e as Error).message, /materialized_adapters/);
      }
      assert.ok(threw, 'expected BLOCKER');
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'reconcileRunAdapter: local=cursor + requested=claude（无 override）→ 冲突 STOP',
    run: () =>
      withTmp((root) => {
        setupAdapters(root, ['cursor', 'claude'], 'cursor');
        assert.throws(
          () => reconcileRunAdapter({ projectRoot: root, requestedAdapter: 'claude', override: false }),
          /记录运行身份 "cursor"/,
        );
      }),
  },
  {
    name: 'reconcileRunAdapter: local=cursor + requested=claude + override → effective=claude/override/writeLocal',
    run: () =>
      withTmp((root) => {
        setupAdapters(root, ['cursor', 'claude'], 'cursor');
        const d = reconcileRunAdapter({ projectRoot: root, requestedAdapter: 'claude', override: true });
        assert.strictEqual(d.effectiveAdapter, 'claude');
        assert.strictEqual(d.provenance, 'override');
        assert.strictEqual(d.writeLocal, true);
      }),
  },
  {
    name: 'reconcileRunAdapter: local=cursor + requested=cursor → local_config（不冲突）',
    run: () =>
      withTmp((root) => {
        setupAdapters(root, ['cursor', 'claude'], 'cursor');
        const d = reconcileRunAdapter({ projectRoot: root, requestedAdapter: 'cursor', override: false });
        assert.strictEqual(d.effectiveAdapter, 'cursor');
        assert.strictEqual(d.provenance, 'local_config');
        assert.strictEqual(d.writeLocal, false);
      }),
  },
  {
    name: 'reconcileRunAdapter: local=cursor + 无 requested → effective=local（权威）',
    run: () =>
      withTmp((root) => {
        setupAdapters(root, ['cursor', 'claude'], 'cursor');
        const d = reconcileRunAdapter({ projectRoot: root, override: false });
        assert.strictEqual(d.effectiveAdapter, 'cursor');
        assert.strictEqual(d.provenance, 'local_config');
      }),
  },
  {
    name: 'reconcileRunAdapter: 首启无 local + requested=claude → entry_declared（默认中性）',
    run: () =>
      withTmp((root) => {
        setupAdapters(root, ['cursor', 'claude']);
        const d = reconcileRunAdapter({ projectRoot: root, requestedAdapter: 'claude', override: false });
        assert.strictEqual(d.effectiveAdapter, 'claude');
        assert.strictEqual(d.provenance, 'entry_declared');
      }),
  },
  {
    name: 'reconcileRunAdapter: 首启无 local + requested=claude + adapterSource=user_explicit → user_explicit',
    run: () =>
      withTmp((root) => {
        setupAdapters(root, ['cursor', 'claude']);
        const d = reconcileRunAdapter({
          projectRoot: root,
          requestedAdapter: 'claude',
          override: false,
          adapterSource: 'user_explicit',
        });
        assert.strictEqual(d.provenance, 'user_explicit');
      }),
  },
  {
    name: 'reconcileRunAdapter: 双缺（无 requested + 无 local）→ STOP，永不默认',
    run: () =>
      withTmp((root) => {
        setupAdapters(root, ['cursor', 'claude']);
        assert.throws(
          () => reconcileRunAdapter({ projectRoot: root, override: false }),
          /未解析到运行身份/,
        );
      }),
  },
  {
    name: 'reconcileRunAdapter: --override 但无 requested → STOP（无回写目标）',
    run: () =>
      withTmp((root) => {
        setupAdapters(root, ['cursor', 'claude'], 'cursor');
        assert.throws(
          () => reconcileRunAdapter({ projectRoot: root, override: true }),
          /--override-adapter 须配合/,
        );
      }),
  },
  {
    name: 'reconcileRunAdapter: requested 不在 materialized → STOP',
    run: () =>
      withTmp((root) => {
        setupAdapters(root, ['cursor'], 'cursor');
        assert.throws(
          () => reconcileRunAdapter({ projectRoot: root, requestedAdapter: 'claude', override: false }),
          /不在已物化候选/,
        );
      }),
  },
  {
    name: 'reconcileRunAdapter: local 损坏（记录非物化 adapter）+ 无 override → STOP，不静默忽略 SSOT',
    run: () =>
      withTmp((root) => {
        // materialized 只有 cursor，但 local 记录 claude（非法）
        setupAdapters(root, ['cursor'], 'claude');
        assert.throws(
          () => reconcileRunAdapter({ projectRoot: root, requestedAdapter: 'cursor', override: false }),
          /非法\/未物化/,
        );
      }),
  },
  {
    name: 'reconcileRunAdapter: local 损坏 + --override-adapter → 放行（override 逃生）',
    run: () =>
      withTmp((root) => {
        setupAdapters(root, ['cursor'], 'claude');
        const d = reconcileRunAdapter({ projectRoot: root, requestedAdapter: 'cursor', override: true });
        assert.strictEqual(d.effectiveAdapter, 'cursor');
        assert.strictEqual(d.provenance, 'override');
        assert.strictEqual(d.writeLocal, true);
      }),
  },
  // ==========================================================================
  // E1（多模态降级阶梯 plan d4a8f3c6）：decideVisionCanaryProbe 纯决策分支
  // ==========================================================================
  {
    name: 'E1 decideVisionCanaryProbe: dry-run → skip',
    run: () =>
      withTmp((root) => {
        const d = decideVisionCanaryProbe({
          projectRoot: root,
          manifest: baseManifest('chrys'),
          chain: ['spec', 'plan', 'coding'],
          dryRun: true,
        });
        assert.deepStrictEqual(d, { action: 'skip', reason: 'dry_run' });
      }),
  },
  {
    name: 'E1 decideVisionCanaryProbe: chain 不含 spec/coding → skip',
    run: () =>
      withTmp((root) => {
        const d = decideVisionCanaryProbe({
          projectRoot: root,
          manifest: { ...baseManifest('chrys'), requirement: '银行卡开卡需求，含7个页面，参考图还原布局。' },
          chain: ['review', 'ut'],
          dryRun: false,
        });
        assert.deepStrictEqual(d, { action: 'skip', reason: 'chain_has_no_ui_phase' });
      }),
  },
  {
    name: 'E1 decideVisionCanaryProbe: 非 UI 需求 → skip',
    run: () =>
      withTmp((root) => {
        const d = decideVisionCanaryProbe({
          projectRoot: root,
          manifest: { ...baseManifest('chrys'), requirement: '实现批量导出 CSV 的后台任务，失败重试 3 次。' },
          chain: ['spec', 'plan', 'coding'],
          dryRun: false,
        });
        assert.deepStrictEqual(d, { action: 'skip', reason: 'not_ui_relevant' });
      }),
  },
  {
    name: 'codex review：decideVisionCanaryProbe: requirement 文本非 UI 相关但 spec.md 已声明 ' +
      'ui_change=new_or_changed（resume/继续 coding 场景常见）→ 仍应 probe，不误判 not_ui_relevant',
    run: () =>
      withTmp((root) => {
        const specDir = path.join(root, 'doc', 'features', 'demo', 'spec');
        fs.mkdirSync(specDir, { recursive: true });
        fs.writeFileSync(path.join(specDir, 'spec.md'), '# spec\n\n```yaml\nui_change: new_or_changed\n```\n', 'utf-8');
        const d = decideVisionCanaryProbe({
          projectRoot: root,
          manifest: { ...baseManifest('chrys'), requirement: '继续完成该需求' },
          chain: ['spec', 'plan', 'coding'],
          dryRun: false,
        });
        assert.deepStrictEqual(d, { action: 'probe' });
      }),
  },
  {
    name: 'E1 decideVisionCanaryProbe: UI 需求 + 无 local.json → probe',
    run: () =>
      withTmp((root) => {
        const d = decideVisionCanaryProbe({
          projectRoot: root,
          manifest: { ...baseManifest('chrys'), requirement: '银行卡开卡需求，含7个页面，参考图还原布局。' },
          chain: ['spec', 'plan', 'coding'],
          dryRun: false,
        });
        assert.deepStrictEqual(d, { action: 'probe' });
      }),
  },
  {
    name: 'E1 decideVisionCanaryProbe: 已有 image_input_override → skip（用户显式声明免探）',
    run: () =>
      withTmp((root) => {
        writeLocalConfig(root, { schema_version: '1.0', vision: { image_input_override: 'none' } });
        const d = decideVisionCanaryProbe({
          projectRoot: root,
          manifest: { ...baseManifest('chrys'), requirement: '银行卡开卡需求，含7个页面，参考图还原布局。' },
          chain: ['spec', 'plan', 'coding'],
          dryRun: false,
        });
        assert.deepStrictEqual(d, { action: 'skip', reason: 'local_override_present' });
      }),
  },
  {
    name: 'E1 decideVisionCanaryProbe: 新鲜缓存（adapter 匹配）→ skip；adapter 变更 → probe',
    run: () =>
      withTmp((root) => {
        writeLocalConfig(root, {
          schema_version: '1.0',
          vision: { canary: { adapter: 'chrys', verdict: 'none', probed_at: new Date(Date.now() - 60_000).toISOString(), probe_version: VISION_CANARY_PROBE_VERSION } },
        });
        const manifestChrys = { ...baseManifest('chrys'), requirement: '银行卡开卡需求，含7个页面，参考图还原布局。' };
        const d1 = decideVisionCanaryProbe({ projectRoot: root, manifest: manifestChrys, chain: ['spec'], dryRun: false });
        assert.deepStrictEqual(d1, { action: 'skip', reason: 'fresh_cache_present' });

        const manifestClaude = { ...baseManifest('claude'), requirement: '银行卡开卡需求，含7个页面，参考图还原布局。' };
        const d2 = decideVisionCanaryProbe({ projectRoot: root, manifest: manifestClaude, chain: ['spec'], dryRun: false });
        assert.deepStrictEqual(d2, { action: 'probe' }, 'adapter 变更应视为缓存过期');
      }),
  },
  {
    name: 'E1 decideVisionCanaryProbe: forceRefresh 忽略新鲜缓存 → probe',
    run: () =>
      withTmp((root) => {
        writeLocalConfig(root, {
          schema_version: '1.0',
          vision: { canary: { adapter: 'chrys', verdict: 'none', probed_at: new Date(Date.now() - 60_000).toISOString(), probe_version: VISION_CANARY_PROBE_VERSION } },
        });
        const d = decideVisionCanaryProbe({
          projectRoot: root,
          manifest: { ...baseManifest('chrys'), requirement: '银行卡开卡需求，含7个页面，参考图还原布局。' },
          chain: ['spec'],
          dryRun: false,
          forceRefresh: true,
        });
        assert.deepStrictEqual(d, { action: 'probe' });
      }),
  },
  {
    // plan c7d2e9a4 t4：goal 来源 TTL 分层取代"永不 TTL"——tool_read 25h（7d 内）仍 skip，
    // 超 7d/负结论超 24h → probe；interactive 超 24h 语义不变。
    name: 'I2/c7d2e9a4 decideVisionCanaryProbe: 超龄 interactive → probe；goal tool_read 25h → skip、超 7d → probe；goal none 25h → probe',
    run: () =>
      withTmp((root) => {
        const PV = VISION_CANARY_PROBE_VERSION;
        const staleAt = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
        const manifest = { ...baseManifest('chrys'), requirement: '银行卡开卡需求，含7个页面，参考图还原布局。' };
        writeLocalConfig(root, {
          schema_version: '1.0',
          vision: { canary: { adapter: 'chrys', verdict: 'tool_read', probed_at: staleAt, probed_via: 'interactive', probe_version: PV } },
        });
        assert.deepStrictEqual(
          decideVisionCanaryProbe({ projectRoot: root, manifest, chain: ['spec'], dryRun: false }),
          { action: 'probe' },
          '超龄 interactive 应重探',
        );
        writeLocalConfig(root, {
          schema_version: '1.0',
          vision: { canary: { adapter: 'chrys', verdict: 'tool_read', probed_at: staleAt, probed_via: 'goal', probe_version: PV } },
        });
        assert.deepStrictEqual(
          decideVisionCanaryProbe({ projectRoot: root, manifest, chain: ['spec'], dryRun: false }),
          { action: 'skip', reason: 'fresh_cache_present' },
          'goal tool_read 25h（7d 内）仍 skip',
        );
        writeLocalConfig(root, {
          schema_version: '1.0',
          vision: { canary: { adapter: 'chrys', verdict: 'tool_read', probed_at: new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString(), probed_via: 'goal', probe_version: PV } },
        });
        assert.deepStrictEqual(
          decideVisionCanaryProbe({ projectRoot: root, manifest, chain: ['spec'], dryRun: false }),
          { action: 'probe' },
          'goal tool_read 超 7d 应重探',
        );
        writeLocalConfig(root, {
          schema_version: '1.0',
          vision: { canary: { adapter: 'chrys', verdict: 'none', probed_at: staleAt, probed_via: 'goal', probe_version: PV } },
        });
        assert.deepStrictEqual(
          decideVisionCanaryProbe({ projectRoot: root, manifest, chain: ['spec'], dryRun: false }),
          { action: 'probe' },
          'goal none 超 24h 应重探',
        );
      }),
  },
  {
    // plan c7d2e9a4 t1：毒缓存自愈 e2e——2026-07-12 事故形态（goal none、无 probe_version）
    // 在场时必须 probe（旧代码在此 skip，把假盲档永久钳死）。
    name: 'c7d2e9a4 decideVisionCanaryProbe: 无 probe_version 毒 none 缓存在场 → probe（自愈通道）',
    run: () =>
      withTmp((root) => {
        writeLocalConfig(root, {
          schema_version: '1.0',
          vision: { canary: { adapter: 'cursor', verdict: 'none', probed_at: new Date(Date.now() - 60_000).toISOString(), probed_via: 'goal' } },
        });
        const d = decideVisionCanaryProbe({
          projectRoot: root,
          manifest: { ...baseManifest('cursor'), requirement: '银行卡开卡需求，含7个页面，参考图还原布局。' },
          chain: ['spec'],
          dryRun: false,
        });
        assert.deepStrictEqual(d, { action: 'probe' }, '事故毒缓存必须自动失效重探');
      }),
  },
  // ==========================================================================
  // plan c7d2e9a4 t6：runVisionCanaryProbe 写盘边界（事故真正发生地——invoke→写盘之间）
  // fake invokeFn 注入免真 spawn；frameworkRoot 用临时夹具（最小 claude goal_capability）。
  // ==========================================================================
  {
    name: 'c7d2e9a4 runVisionCanaryProbe: 空输出/额度错误文本 → invalid_not_cached，不写盘且 local 全字段无损',
    run: () =>
      withTmpAsync(async (root) => {
        const fw = setupCanaryFrameworkFixture(root);
        writeLocalConfig(root, {
          schema_version: '1.0',
          agent_adapter: 'claude',
          toolchain: { devEcoStudio: { installPath: 'D:/DevEco' } },
          vision: { image_input_override: 'none' },
        });
        for (const stdout of ['', 'ActionRequiredError: You have hit your usage limit. Get Pro for more.']) {
          const r = await runVisionCanaryProbe({
            projectRoot: root,
            frameworkRoot: fw,
            manifest: baseManifest('claude'),
            invokeFn: (async () => ({ exitCode: 0, stdout, stderr: '', command: 'fake' })) as typeof invokeAgentHeadless,
          });
          assert.strictEqual(r.ran, true);
          assert.strictEqual(r.outcome, 'invalid_not_cached', JSON.stringify(r));
          const local = loadLocalConfig(root)!;
          assert.strictEqual(local.vision?.canary, undefined, '无效探测不得写 canary');
          assert.strictEqual(local.agent_adapter, 'claude', 'agent_adapter 无损');
          assert.strictEqual(local.toolchain?.devEcoStudio?.installPath, 'D:/DevEco', 'toolchain 无损');
          assert.strictEqual(local.vision?.image_input_override, 'none', 'override 无损');
        }
      }),
  },
  {
    name: 'c7d2e9a4 runVisionCanaryProbe: 非零退出/timed_out/silent_killed/skipped → invoke_failed_not_cached，不写盘',
    run: () =>
      withTmpAsync(async (root) => {
        const fw = setupCanaryFrameworkFixture(root);
        const fullAnswer = 'TOP_LEFT_COLOR=red\nTOP_RIGHT_COLOR=blue\nBOTTOM_LEFT_COLOR=green\nBOTTOM_RIGHT_COLOR=yellow\nTEXT_TOKEN=MAISON7X3Q';
        const facts = [
          { exitCode: 1, stdout: fullAnswer, stderr: '', command: 'fake' },
          { exitCode: 0, stdout: fullAnswer, stderr: '', command: 'fake', timed_out: true },
          { exitCode: 0, stdout: fullAnswer, stderr: '', command: 'fake', silent_killed: true },
          { exitCode: 0, stdout: fullAnswer, stderr: '', command: 'fake', skipped: true },
        ];
        for (const f of facts) {
          const r = await runVisionCanaryProbe({
            projectRoot: root,
            frameworkRoot: fw,
            manifest: baseManifest('claude'),
            invokeFn: (async () => f) as typeof invokeAgentHeadless,
          });
          assert.strictEqual(r.outcome, 'invoke_failed_not_cached', JSON.stringify({ f, r }));
          assert.strictEqual(loadLocalConfig(root)?.vision?.canary, undefined, '调用失败不得写 canary（即便 stdout 是完美答卷）');
        }
      }),
  },
  {
    name: 'c7d2e9a4 runVisionCanaryProbe: 有效全对答卷 → valid_cached，写入 probe_version 且保留其余字段',
    run: () =>
      withTmpAsync(async (root) => {
        const fw = setupCanaryFrameworkFixture(root);
        writeLocalConfig(root, { schema_version: '1.0', agent_adapter: 'claude' });
        const r = await runVisionCanaryProbe({
          projectRoot: root,
          frameworkRoot: fw,
          manifest: baseManifest('claude'),
          invokeFn: (async () => ({
            exitCode: 0,
            stdout: 'TOP_LEFT_COLOR=red\nTOP_RIGHT_COLOR=blue\nBOTTOM_LEFT_COLOR=green\nBOTTOM_RIGHT_COLOR=yellow\nTEXT_TOKEN=MAISON7X3Q',
            stderr: '',
            command: 'fake',
          })) as typeof invokeAgentHeadless,
        });
        assert.strictEqual(r.outcome, 'valid_cached', JSON.stringify(r));
        assert.strictEqual(r.verdict, 'tool_read');
        const canary = loadLocalConfig(root)?.vision?.canary;
        assert.strictEqual(canary?.verdict, 'tool_read');
        assert.strictEqual(canary?.probe_version, VISION_CANARY_PROBE_VERSION, '必须写入当前协议版本');
        assert.strictEqual(canary?.probed_via, 'goal');
        assert.strictEqual(loadLocalConfig(root)?.agent_adapter, 'claude', '既有字段保留');
      }),
  },
  {
    // rev5(codex P2)：invokeFn 抛异常（spawn/asset/config 层）→ 也归 invoke_failed_not_cached，
    // 不绕过 runner 的 stale-if-error LKG 二分；盘上既有 fresh 缓存原样无损（自然沿用）。
    name: 'c7d2e9a4/rev5 runVisionCanaryProbe: invokeFn 抛异常 → invoke_failed_not_cached，fresh LKG 缓存无损',
    run: () =>
      withTmpAsync(async (root) => {
        const fw = setupCanaryFrameworkFixture(root);
        const lkg = {
          adapter: 'claude',
          verdict: 'tool_read' as const,
          probed_at: new Date(Date.now() - 60_000).toISOString(),
          probed_via: 'goal' as const,
          probe_version: VISION_CANARY_PROBE_VERSION,
        };
        writeLocalConfig(root, { schema_version: '1.0', vision: { canary: lkg } });
        const r = await runVisionCanaryProbe({
          projectRoot: root,
          frameworkRoot: fw,
          manifest: baseManifest('claude'),
          invokeFn: (async () => {
            throw new Error('spawn EPERM (模拟强刷时环境异常)');
          }) as typeof invokeAgentHeadless,
        });
        assert.strictEqual(r.ran, true, '异常也算试跑过——须进 runner 的 LKG 二分而非通用跳过');
        assert.strictEqual(r.outcome, 'invoke_failed_not_cached', JSON.stringify(r));
        assert.match(r.error ?? '', /探测异常/);
        assert.deepStrictEqual(loadLocalConfig(root)?.vision?.canary, lkg, 'fresh last-known-good 必须原样无损');
      }),
  },
  {
    // prompt echo 穿透断言（codex 三轮 P2）：echo+尾部真答卷的最终 verdict 必须是 tool_read
    //（若 canonical 重组缺位，旧 classifier 会被 echo 里的 CANNOT_SEE_IMAGE 子串污染判 none）。
    name: 'c7d2e9a4 runVisionCanaryProbe: prompt echo + 尾部真答卷 → valid_cached 且 verdict=tool_read（穿透 classify）',
    run: () =>
      withTmpAsync(async (root) => {
        const fw = setupCanaryFrameworkFixture(root);
        const echo = buildCanaryPrompt('C:/tmp/vision-canary-x.png');
        const stdout = `${echo}\n\nTOP_LEFT_COLOR=red\nTOP_RIGHT_COLOR=blue\nBOTTOM_LEFT_COLOR=green\nBOTTOM_RIGHT_COLOR=yellow\nTEXT_TOKEN=MAISON7X3Q\n`;
        const r = await runVisionCanaryProbe({
          projectRoot: root,
          frameworkRoot: fw,
          manifest: baseManifest('claude'),
          invokeFn: (async () => ({ exitCode: 0, stdout, stderr: '', command: 'fake' })) as typeof invokeAgentHeadless,
        });
        assert.strictEqual(r.outcome, 'valid_cached', JSON.stringify(r));
        assert.strictEqual(r.verdict, 'tool_read', 'echo 混排不得污染最终 verdict');
        assert.strictEqual(loadLocalConfig(root)?.vision?.canary?.verdict, 'tool_read');
      }),
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
