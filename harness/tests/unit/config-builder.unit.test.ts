// config-builder.unit.test.ts

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  buildProjectConfigForWrite,
  prepareConfigWriteForTask,
  readExistingConfigFromDisk,
} from '../../scripts/utils/config-builder';
import { deriveUpdateConfigWritePayload } from '../../scripts/init-orchestrate';
import { getEffectiveBackfillFields } from '../../scripts/utils/config-field-merger';
import { preflightExecute, buildRunLogAuditMeta } from '../../scripts/init-orchestrate';
import { probeInitTaskPlan } from '../../scripts/utils/init-task-planner';
import { executeInitTask, type InitExecutionContext } from '../../scripts/utils/init-task-executor';
import { detectRepoLayout, harnessRootFromLayout } from '../../repo-layout';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function minimalArch(): Record<string, unknown> {
  return {
    outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
    module_inner_layers: ['shared'],
    inner_dependency_direction: 'upward',
    cross_module_exports_file: 'index.ets',
  };
}

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-builder-'));
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'getEffectiveBackfillFields generic 不含 tools.hylyre',
    run: () => {
      const fields = getEffectiveBackfillFields('generic');
      assert(!fields.some(f => f.path.startsWith('tools.hylyre')), fields.map(f => f.path).join(','));
      assert(fields.some(f => f.path === 'schema_version'));
    },
  },
  {
    name: 'getEffectiveBackfillFields hmos-app 含 tools.hylyre.vendor_dir',
    run: () => {
      const fields = getEffectiveBackfillFields('hmos-app');
      assert(fields.some(f => f.path === 'tools.hylyre.vendor_dir'));
    },
  },
  {
    name: 'getEffectiveBackfillFields hmos-app 含视觉保真 spec/coding 默认',
    run: () => {
      const fields = getEffectiveBackfillFields('hmos-app');
      assert(fields.some(f => f.path === 'spec.ui_spec_enforcement'));
      assert(fields.some(f => f.path === 'spec.visual_handoff_enforcement'));
      assert(fields.some(f => f.path === 'coding.visual_parity_enforcement'));
      const uiSpec = fields.find(f => f.path === 'spec.ui_spec_enforcement');
      assert.strictEqual(uiSpec?.defaultValue, 'reachable');
    },
  },
  {
    name: 'getEffectiveBackfillFields generic 不含 spec/coding 视觉字段',
    run: () => {
      const fields = getEffectiveBackfillFields('generic');
      assert(!fields.some(f => f.path.startsWith('spec.')));
      assert(!fields.some(f => f.path.startsWith('coding.')));
    },
  },
  {
    name: 'buildProjectConfigForWrite hmos-app CREATE 写入 spec/coding 默认',
    run: () => {
      const out = buildProjectConfigForWrite({
        project_name: 'demo',
        project_profile: { name: 'hmos-app' },
        materialized_adapters: ['cursor'],
        architecture: minimalArch(),
      });
      const spec = out.spec as Record<string, unknown>;
      const coding = out.coding as Record<string, unknown>;
      assert.strictEqual(spec.ui_spec_enforcement, 'reachable');
      assert.strictEqual(spec.visual_handoff_enforcement, 'reachable');
      assert.strictEqual(coding.visual_parity_enforcement, 'warn');
    },
  },
  {
    name: 'buildProjectConfigForWrite UPDATE overwrite 保留 spec 并补缺 ui_spec_enforcement',
    run: () => {
      const root = mkTmp();
      const existing = {
        project_name: 'demo',
        architecture: minimalArch(),
        project_profile: { name: 'hmos-app' },
        spec: { visual_handoff_enforcement: 'strict' },
      };
      fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify(existing));
      const payload = deriveUpdateConfigWritePayload(root, ['cursor']);
      assert(payload);
      const out = buildProjectConfigForWrite(payload!, {
        existingConfig: readExistingConfigFromDisk(root),
        profileName: 'hmos-app',
      });
      const spec = out.spec as Record<string, unknown>;
      assert.strictEqual(spec.visual_handoff_enforcement, 'strict');
      assert.strictEqual(spec.ui_spec_enforcement, 'reachable');
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'buildProjectConfigForWrite 仅 outer_layers 时落盘完整 architecture DSL',
    run: () => {
      const out = buildProjectConfigForWrite({
        project_name: 'demo',
        project_profile: { name: 'generic' },
        materialized_adapters: ['cursor'],
        architecture: {
          outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
        },
      });
      const arch = out.architecture as Record<string, unknown>;
      assert(Array.isArray(arch.module_inner_layers) && arch.module_inner_layers.length > 0);
      assert.strictEqual(arch.inner_dependency_direction, 'upward');
      assert(typeof arch.cross_module_exports_file === 'string' && arch.cross_module_exports_file.length > 0);
    },
  },
  {
    name: 'buildProjectConfigForWrite payload 漏 schema_version 仍落盘 1.1',
    run: () => {
      const out = buildProjectConfigForWrite({
        project_name: 'demo',
        project_profile: { name: 'generic' },
        materialized_adapters: ['cursor'],
        architecture: minimalArch(),
      });
      assert.strictEqual(out.schema_version, '1.1');
      assert.strictEqual((out.state_machine as Record<string, unknown>)?.schema_version, '1.1');
      assert.strictEqual(out.tools, undefined);
    },
  },
  {
    name: 'buildProjectConfigForWrite 旧 generic overwrite 漏 project_profile 仍保持 generic',
    run: () => {
      const existing = {
        schema_version: '1.1',
        project_name: 'legacy',
        project_profile: { name: 'generic' },
        materialized_adapters: ['generic'],
        architecture: minimalArch(),
        paths: { features_dir: 'doc/features' },
      };
      const out = buildProjectConfigForWrite(
        {
          project_name: 'legacy',
          materialized_adapters: ['generic'],
          architecture: minimalArch(),
        },
        { existingConfig: existing },
      );
      assert.strictEqual((out.project_profile as { name: string }).name, 'generic');
      assert.strictEqual(out.tools, undefined);
    },
  },
  {
    // 落盘单点收口：inline 已彻底废弃，写盘时任何残留/显式 inline 一律归一为 bridge
    name: 'buildProjectConfigForWrite 归一化 agent_bundle_skill_mode：inline → bridge',
    run: () => {
      const out = buildProjectConfigForWrite({
        project_name: 'demo',
        project_profile: { name: 'generic' },
        agent_adapter: 'generic',
        materialized_adapters: ['generic'],
        architecture: minimalArch(),
        paths: {
          features_dir: 'doc/features',
          agent_bundle_root: '.agents',
          agent_bundle_skill_mode: 'inline',
        },
      });
      const paths = out.paths as Record<string, unknown>;
      assert.strictEqual(paths.agent_bundle_skill_mode, 'bridge');
    },
  },
  {
    // 多 adapter：active=claude 但 materialized 含 generic，残留 inline 同样归一为 bridge
    name: 'buildProjectConfigForWrite 归一化 inline：active 非 generic 亦归一',
    run: () => {
      const out = buildProjectConfigForWrite({
        project_name: 'demo',
        project_profile: { name: 'generic' },
        agent_adapter: 'claude',
        materialized_adapters: ['claude', 'generic'],
        architecture: minimalArch(),
        paths: {
          features_dir: 'doc/features',
          agent_bundle_root: '.agents',
          agent_bundle_skill_mode: 'inline',
        },
      });
      const paths = out.paths as Record<string, unknown>;
      assert.strictEqual(paths.agent_bundle_skill_mode, 'bridge');
    },
  },
  {
    name: 'prepareConfigWriteForTask 剥离 agent_adapter 与 installPath',
    run: () => {
      const root = mkTmp();
      const out = prepareConfigWriteForTask(
        {
          projectRoot: root,
          configWritePayload: {
            project_name: 't',
            project_profile: { name: 'generic' },
            materialized_adapters: ['generic'],
            agent_adapter: 'claude',
            project_type: 'app',
            architecture: minimalArch(),
            toolchain: { devEcoStudio: { installPath: 'C:\\DevEco' } },
          },
        },
        'run',
      );
      assert.strictEqual(out.agent_adapter, undefined);
      assert.strictEqual(out.project_type, undefined);
      const tc = out.toolchain as Record<string, unknown> | undefined;
      const deveco = tc?.devEcoStudio as Record<string, unknown> | undefined;
      assert.strictEqual(deveco?.installPath, undefined);
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'probeInitTaskPlan 缺 project_name 时 ensure-config 为 needed+prompt 非 skip',
    run: () => {
      const root = mkTmp();
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify({
          schema_version: '1.1',
          materialized_adapters: ['cursor'],
          architecture: minimalArch(),
          paths: { features_dir: 'doc/features' },
          state_machine: { schema_version: '1.1' },
        }),
      );
      const plan = probeInitTaskPlan({ projectRoot: root, scope: 'project' });
      const cfg = plan.tasks.find(t => t.id === 'ensure-config');
      assert(cfg, '应有 ensure-config');
      assert.strictEqual(cfg.status, 'needed');
      assert.strictEqual(cfg.default_action, 'prompt');
      assert.strictEqual(cfg.skippable, false);
      assert.deepStrictEqual(cfg.allowed_actions, ['overwrite']);
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'preflightExecute options.projectRoot 可替代 audit.project_root',
    run: () => {
      const root = mkTmp();
      const payload = {
        project_name: 'opts-root',
        project_profile: { name: 'generic' },
        materialized_adapters: ['cursor'],
        architecture: minimalArch(),
      };
      const plan = {
        schema_version: '1.0' as const,
        scope: 'project' as const,
        mode: 'create' as const,
        generated_at: new Date().toISOString(),
        tasks: [
          {
            id: 'ensure-config',
            title: 'config',
            category: 'config',
            scope: 'project' as const,
            deps: [],
            status: 'needed' as const,
            default_action: 'run' as const,
            skippable: false,
            allowed_actions: ['run' as const],
          },
        ],
      };
      const decision = {
        schema_version: '1.0' as const,
        scope: 'project' as const,
        decision_mode: 'smart' as const,
        plan_generated_at: plan.generated_at,
        materialized_adapters: ['cursor'],
        tasks: [{ task_id: 'ensure-config', action: 'run' as const }],
      };
      const audit = buildRunLogAuditMeta({ plan, decision });
      const pre = preflightExecute(
        plan,
        decision,
        { configWritePayload: payload, materializedAdapters: ['cursor'] },
        audit,
        { projectRoot: root },
      );
      assert.strictEqual(pre.ok, true);
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'preflight 与 executor ensure-config 落盘 byte-for-byte 一致',
    run: () => {
      const root = mkTmp();
      const layout = detectRepoLayout(path.join(__dirname, '../..'));
      const harnessRoot = harnessRootFromLayout(layout);
      const payload = {
        project_name: 'parity',
        project_profile: { name: 'generic' },
        materialized_adapters: ['cursor'],
        architecture: minimalArch(),
      };
      const plan = {
        schema_version: '1.0' as const,
        scope: 'project' as const,
        mode: 'create' as const,
        generated_at: new Date().toISOString(),
        tasks: [
          {
            id: 'ensure-config',
            title: 'config',
            category: 'config',
            scope: 'project' as const,
            deps: [],
            status: 'needed' as const,
            default_action: 'run' as const,
            skippable: false,
            allowed_actions: ['run' as const],
          },
        ],
      };
      const decision = {
        schema_version: '1.0' as const,
        scope: 'project' as const,
        decision_mode: 'smart' as const,
        plan_generated_at: plan.generated_at,
        materialized_adapters: ['cursor'],
        tasks: [{ task_id: 'ensure-config', action: 'run' as const }],
      };
      const ctx = { configWritePayload: payload, materializedAdapters: ['cursor'] };
      const audit = buildRunLogAuditMeta({ plan, decision, projectRoot: root });
      const pre = preflightExecute(plan, decision, ctx, audit);
      assert.strictEqual(pre.ok, true);
      const built = prepareConfigWriteForTask({ projectRoot: root, configWritePayload: payload }, 'run');
      const execCtx: InitExecutionContext = {
        projectRoot: root,
        harnessRoot,
        plan,
        configWritePayload: payload,
      };
      executeInitTask(plan.tasks[0]!, 'run', execCtx);
      const onDisk = fs.readFileSync(path.join(root, 'framework.config.json'), 'utf-8');
      assert.strictEqual(onDisk, `${JSON.stringify(built, null, 2)}\n`);
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
];

// ============================================================================
// plan a7c3f9e2 t2a/t2b：UPDATE 无损磁盘 baseline + 配置写入权限治理
// ============================================================================

function writeDiskConfig(root: string, cfg: Record<string, unknown>): void {
  fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify(cfg, null, 2), 'utf-8');
}

function fullDiskConfig(): Record<string, unknown> {
  return {
    schema_version: '1.1',
    project_name: 'Wallet',
    project_profile: { name: 'hmos-app', sub_variant: 'app' },
    materialized_adapters: ['claude', 'generic'],
    architecture: {
      outer_layers: [{ id: '01-Product', can_depend_on: [], intra_layer_deps: 'dag' }],
      module_inner_layers: ['shared', 'data'],
      inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ets',
    },
    paths: { features_dir: 'doc/features' },
    state_machine: { schema_version: '1.1', ttl_hours: 12, x_vendor_ext: { keep: 'sm' } },
    toolchain: {
      hvigor: { daemon: true, parallel: false, x_vendor_ext: { keep: 'hv' } },
    },
    tools: { hylyre: { vendor_dir: 'vendors' } },
    active_workflow: 'spec-driven',
    lifecycle_hooks_enabled: true,
    x_vendor_ext: { keep: 'top' },
  };
}

const t2a2bCases: Array<{ name: string; run: () => void }> = [
  {
    // t2a (a)：UPDATE 走完整链路后 active_workflow / lifecycle_hooks_enabled / schema_version 逐字保留
    name: 't2a(a) UPDATE 完整链路：active_workflow / lifecycle_hooks_enabled / schema_version 逐字保留',
    run: () => {
      const root = mkTmp();
      writeDiskConfig(root, fullDiskConfig());
      const payload = deriveUpdateConfigWritePayload(root, ['claude', 'generic']);
      assert(payload);
      const out = prepareConfigWriteForTask(
        { projectRoot: root, configWritePayload: payload! },
        'overwrite',
      );
      assert.strictEqual(out.active_workflow, 'spec-driven');
      assert.strictEqual(out.lifecycle_hooks_enabled, true);
      assert.strictEqual(out.schema_version, '1.1');
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    // t2a (b)：任意 schema-valid 未知字段经 UPDATE 后逐字保持不变——顶层与嵌套必须同时覆盖
    //（嵌套两处是 v5"归一化结果＋顶层并回"方案的漏网点）
    name: 't2a(b) UPDATE 无损：顶层 x_vendor_ext / state_machine.x_vendor_ext / toolchain.hvigor.x_vendor_ext 逐字保留',
    run: () => {
      const root = mkTmp();
      writeDiskConfig(root, fullDiskConfig());
      const payload = deriveUpdateConfigWritePayload(root, ['claude', 'generic']);
      const out = prepareConfigWriteForTask(
        { projectRoot: root, configWritePayload: payload! },
        'overwrite',
      );
      assert.deepStrictEqual(out.x_vendor_ext, { keep: 'top' }, '顶层未知扩展键不得丢');
      const sm = out.state_machine as Record<string, unknown>;
      assert.deepStrictEqual(sm.x_vendor_ext, { keep: 'sm' }, 'state_machine 嵌套未知扩展键不得丢');
      const hv = (out.toolchain as Record<string, unknown>).hvigor as Record<string, unknown>;
      assert.deepStrictEqual(hv.x_vendor_ext, { keep: 'hv' }, 'toolchain.hvigor 嵌套未知扩展键不得丢');
      // tools：磁盘已有 vendor_dir 原样保留，profile-owned 缺叶由 BACKFILL 补齐
      const hylyre = (out.tools as Record<string, unknown>).hylyre as Record<string, unknown>;
      assert.strictEqual(hylyre.vendor_dir, 'vendors');
      assert.strictEqual(hylyre.venv_dir, '.hylyre/venv', 'BACKFILL 补缺');
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    // t2b (a) / t2a (c)：UPDATE + payload 新增 toolchain.preferredProduct → 抛错且信息含字段路径
    name: 't2b(a) UPDATE payload 在 toolchain 新增 preferredProduct → 抛错并报告字段路径',
    run: () => {
      const root = mkTmp();
      writeDiskConfig(root, fullDiskConfig());
      const payload = deriveUpdateConfigWritePayload(root, [])!;
      (payload.toolchain as Record<string, unknown>).preferredProduct = 'rom';
      assert.throws(
        () =>
          prepareConfigWriteForTask(
            { projectRoot: root, configWritePayload: payload },
            'overwrite',
          ),
        (e: Error) => {
          assert(e.message.includes('toolchain.preferredProduct'), `应含字段路径：${e.message}`);
          assert(e.message.includes('白名单'), `应声明白名单拒绝：${e.message}`);
          return true;
        },
      );
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    // t2b (a) 变体：payload 修改嵌套未知路径（toolchain.hvigor.x_vendor_ext）→ 同样被拒
    name: 't2b(a2) UPDATE payload 修改嵌套未知路径 toolchain.hvigor.x_vendor_ext → 被拒',
    run: () => {
      const root = mkTmp();
      writeDiskConfig(root, fullDiskConfig());
      const payload = deriveUpdateConfigWritePayload(root, [])!;
      ((payload.toolchain as Record<string, unknown>).hvigor as Record<string, unknown>).x_vendor_ext = {
        hacked: true,
      };
      assert.throws(
        () =>
          prepareConfigWriteForTask(
            { projectRoot: root, configWritePayload: payload },
            'overwrite',
          ),
        (e: Error) => e.message.includes('toolchain.hvigor.x_vendor_ext'),
      );
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    // t2b (b) / t2a (e)：UPDATE payload 仅改白名单字段 → 接受；toolchain / active_workflow 等未变更字段原样保留
    name: 't2b(b) UPDATE payload 仅改白名单字段（project_name / paths）→ 接受且其余未变更字段保留',
    run: () => {
      const root = mkTmp();
      writeDiskConfig(root, fullDiskConfig());
      const payload = deriveUpdateConfigWritePayload(root, [])!;
      payload.project_name = 'Wallet-renamed';
      (payload.paths as Record<string, unknown>).features_dir = 'custom/docs';
      const out = prepareConfigWriteForTask(
        { projectRoot: root, configWritePayload: payload },
        'overwrite',
      );
      assert.strictEqual(out.project_name, 'Wallet-renamed');
      assert.strictEqual((out.paths as Record<string, unknown>).features_dir, 'custom/docs');
      assert.strictEqual(out.active_workflow, 'spec-driven');
      assert.strictEqual(out.schema_version, '1.1');
      // toolchain：未变更内容从磁盘基底保留；BACKFILL 只补缺失键（analyze/incremental），
      // 不覆盖磁盘已有值（daemon/parallel 与 x_vendor_ext 原样）。
      const hv = (out.toolchain as Record<string, unknown>).hvigor as Record<string, unknown>;
      assert.strictEqual(hv.daemon, true);
      assert.strictEqual(hv.parallel, false);
      assert.strictEqual(hv.analyze, 'normal', 'BACKFILL 补缺');
      assert.strictEqual(hv.incremental, true, 'BACKFILL 补缺');
      assert.deepStrictEqual(hv.x_vendor_ext, { keep: 'hv' }, 'toolchain.hvigor 未知扩展键保留');
      assert.deepStrictEqual(out.x_vendor_ext, { keep: 'top' });
      assert.deepStrictEqual(
        (out.state_machine as Record<string, unknown>).x_vendor_ext,
        { keep: 'sm' },
      );
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    // t2b (c)：UPDATE + payload 原样等于磁盘 baseline → 接受（防 UPDATE 回归）
    name: 't2b(c) UPDATE payload 原样等于磁盘 baseline → 接受',
    run: () => {
      const root = mkTmp();
      writeDiskConfig(root, fullDiskConfig());
      const payload = deriveUpdateConfigWritePayload(root, [])!;
      const baseline = JSON.parse(
        fs.readFileSync(path.join(root, 'framework.config.json'), 'utf-8'),
      );
      assert.deepStrictEqual(payload, baseline, 'payload 应等于磁盘 baseline');
      const out = prepareConfigWriteForTask(
        { projectRoot: root, configWritePayload: JSON.parse(JSON.stringify(baseline)) as Record<string, unknown> },
        'overwrite',
      );
      assert.deepStrictEqual(out, prepareConfigWriteForTask(
        { projectRoot: root, configWritePayload: payload },
        'overwrite',
      ));
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    // t2a (c2)：归一化仍在生效——非法 canonical 值 UPDATE 后仍抛错（影子校验被绕过即红）
    name: 't2a(c2) UPDATE 非法 canonical 值仍抛错（state_machine.grace_period_minutes=999）',
    run: () => {
      const root = mkTmp();
      writeDiskConfig(root, fullDiskConfig());
      const payload = deriveUpdateConfigWritePayload(root, [])!;
      (payload.state_machine as Record<string, unknown>).grace_period_minutes = 999;
      assert.throws(
        () =>
          prepareConfigWriteForTask(
            { projectRoot: root, configWritePayload: payload },
            'overwrite',
          ),
        /999|grace_period/,
      );
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    // t2b (d)：CREATE + 纯白名单字段 → 正常写入
    name: 't2b(d) CREATE + 纯白名单字段 → 正常写入',
    run: () => {
      const root = mkTmp();
      const out = prepareConfigWriteForTask(
        {
          projectRoot: root,
          configWritePayload: {
            project_name: 'fresh',
            project_profile: { name: 'generic' },
            materialized_adapters: ['cursor'],
            architecture: minimalArch(),
            paths: { features_dir: 'doc/features' },
            project_scale: 'small',
            phases_disabled: ['visual'],
            spec: { visual_handoff_enforcement: 'reachable' },
          },
        },
        'run',
      );
      assert.strictEqual(out.project_name, 'fresh');
      assert.strictEqual(out.schema_version, '1.1', '框架默认仍由 builder 注入');
      assert.strictEqual(out.project_scale, 'small');
      assert.deepStrictEqual(out.phases_disabled, ['visual']);
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    // t2b (e)：CREATE + 白名单外字段 → 抛错（不得静默丢弃）
    name: 't2b(e) CREATE + 白名单外字段（toolchain）→ 抛错',
    run: () => {
      const root = mkTmp();
      assert.throws(
        () =>
          prepareConfigWriteForTask(
            {
              projectRoot: root,
              configWritePayload: {
                project_name: 'fresh',
                project_profile: { name: 'generic' },
                materialized_adapters: ['cursor'],
                architecture: minimalArch(),
                toolchain: { hvigor: { daemon: false } },
              },
            },
            'run',
          ),
        (e: Error) => e.message.includes('toolchain'),
      );
      assert(!fs.existsSync(path.join(root, 'framework.config.json')));
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    // t2b (f)：7 行白名单字段逐个正向用例（UPDATE 各自独立修改都接受）
    name: 't2b(f) 白名单 8 键逐一正向（UPDATE 修改各字段均接受）',
    run: () => {
      const root = mkTmp();
      writeDiskConfig(root, fullDiskConfig());
      const baseline = fullDiskConfig();
      const mutations: Array<{ key: string; patch: Record<string, unknown> }> = [
        { key: 'project_profile', patch: { project_profile: { name: 'hmos-app', sub_variant: 'element-service' } } },
        { key: 'project_name', patch: { project_name: 'renamed' } },
        { key: 'architecture', patch: { architecture: { ...(baseline.architecture as Record<string, unknown>), module_inner_layers: ['shared', 'domain'] } } },
        { key: 'materialized_adapters', patch: { materialized_adapters: ['cursor'] } },
        { key: 'paths', patch: { paths: { features_dir: 'x/docs', module_catalog: 'x/catalog.yaml' } } },
        { key: 'project_scale', patch: { project_scale: 'small' } },
        { key: 'phases_disabled', patch: { phases_disabled: ['visual'] } },
        { key: 'spec', patch: { spec: { visual_handoff_enforcement: 'strict' } } },
      ];
      for (const m of mutations) {
        const payload = deriveUpdateConfigWritePayload(root, [])!;
        for (const [k, v] of Object.entries(m.patch)) payload[k] = v;
        const out = prepareConfigWriteForTask(
          { projectRoot: root, configWritePayload: payload },
          'overwrite',
        );
        assert(out, `UPDATE 接受 ${m.key} 修改`);
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    // t2a (d)：既有剥离契约不回归——UPDATE 仍剥离 agent_adapter / project_type / DevEco personal
    name: 't2a(d) UPDATE 仍剥离 agent_adapter / project_type / DevEco personal（既有契约不回归）',
    run: () => {
      const root = mkTmp();
      const disk = fullDiskConfig();
      (disk as Record<string, unknown>).agent_adapter = 'claude';
      (disk as Record<string, unknown>).project_type = 'app';
      (disk.toolchain as Record<string, unknown>).devEcoStudio = { installPath: 'C:/DevEco' };
      writeDiskConfig(root, disk);
      const payload = deriveUpdateConfigWritePayload(root, [])!;
      // AI 额外提交的 personal 字段同样剥离（不因白名单抛错）
      (payload as Record<string, unknown>).agent_adapter = 'claude';
      (payload as Record<string, unknown>).project_type = 'app';
      (payload.toolchain as Record<string, unknown>).devEcoStudio = { installPath: 'C:/DevEco' };
      const out = prepareConfigWriteForTask(
        { projectRoot: root, configWritePayload: payload },
        'overwrite',
      );
      assert.strictEqual(out.agent_adapter, undefined);
      assert.strictEqual(out.project_type, undefined);
      assert.strictEqual(
        (out.toolchain as Record<string, unknown>).devEcoStudio,
        undefined,
      );
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return [...cases, ...t2a2bCases].map(c => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (err) {
      return { name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message };
    }
  });
}
