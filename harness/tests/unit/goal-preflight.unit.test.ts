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
} from '../../scripts/utils/goal-preflight';
import { writeLocalConfig } from '../../scripts/utils/framework-local-config';
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

const cases: Array<{ name: string; run: () => void }> = [
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
          vision: { canary: { adapter: 'chrys', verdict: 'none', probed_at: '2026-07-08T00:00:00.000Z' } },
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
          vision: { canary: { adapter: 'chrys', verdict: 'none', probed_at: '2026-07-08T00:00:00.000Z' } },
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
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
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

if (require.main === module) {
  const results = runAll();
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(r.ok ? `PASS ${r.name}` : `FAIL ${r.name}: ${r.error}`);
  }
  process.exit(failed.length > 0 ? 1 : 0);
}
