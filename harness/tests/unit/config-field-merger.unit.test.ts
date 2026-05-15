// ============================================================================
// config-field-merger — 字段级"只补缺、不覆盖"合并器单测
// ============================================================================

import assert from 'assert';
import {
  BACKFILL_FIELDS,
  detectMissingBackfillFields,
  isBackfillablePath,
  mergeBackfillFields,
} from '../../scripts/utils/config-field-merger';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'BACKFILL_FIELDS 白名单非空，且全部为唯一点分路径',
    run: () => {
      assert(BACKFILL_FIELDS.length > 0, '白名单不能为空');
      const seen = new Set<string>();
      for (const f of BACKFILL_FIELDS) {
        assert(typeof f.path === 'string' && f.path.length > 0, '字段路径必须为非空字符串');
        assert(!seen.has(f.path), `字段路径重复：${f.path}`);
        seen.add(f.path);
        assert(typeof f.note === 'string' && f.note.length > 0, `${f.path} 缺 note`);
        assert(f.defaultValue !== undefined, `${f.path} defaultValue 不能为 undefined`);
      }
    },
  },
  {
    name: '白名单覆盖关键升级字段（state_file / extension_dir / state_machine.* / active_workflow / hvigor.* 等）',
    run: () => {
      const must = [
        'schema_version',
        'active_workflow',
        'lifecycle_hooks_enabled',
        'paths.extension_dir',
        'paths.state_file',
        'paths.receipt_dir_pattern',
        'paths.docs_committed',
        'state_machine.grace_period_minutes',
        'state_machine.ttl_hours',
        'state_machine.schema_version',
        'toolchain.hvigor.daemon',
        'toolchain.hvigor.parallel',
        'toolchain.hvigor.incremental',
        'toolchain.hvigor.analyze',
      ];
      for (const p of must) {
        assert(isBackfillablePath(p), `${p} 应在补缺白名单内`);
      }
    },
  },
  {
    name: '白名单刻意不包含 user-必填字段、opt-in 字段、行为敏感字段',
    run: () => {
      const forbidden = [
        'project_name',
        'project_type',
        'agent_adapter',
        'architecture',
        'architecture.outer_layers',
        'toolchain.devEcoStudio',
        'toolchain.devEcoStudio.installPath',
        'prd',
        'prd.visual_handoff_enforcement',
        'atomic_service',
        // reports_dir_pattern：未配置时 harness 回退到 legacy 报告路径；
        // 自动补会让老工程升级后报告搬家，行为级变更，故意不补。
        'paths.reports_dir_pattern',
      ];
      for (const p of forbidden) {
        assert(!isBackfillablePath(p), `${p} 不应该出现在补缺白名单中`);
      }
    },
  },
  {
    name: 'detectMissingBackfillFields：完整 config → 空数组',
    run: () => {
      // 构造一个白名单全占满的 config，应该 0 缺失
      const full: Record<string, unknown> = {};
      for (const f of BACKFILL_FIELDS) {
        const keys = f.path.split('.');
        let cur = full;
        for (let i = 0; i < keys.length - 1; i++) {
          if (!cur[keys[i]] || typeof cur[keys[i]] !== 'object') cur[keys[i]] = {};
          cur = cur[keys[i]] as Record<string, unknown>;
        }
        cur[keys[keys.length - 1]] = f.defaultValue;
      }
      const missing = detectMissingBackfillFields(full);
      assert.strictEqual(missing.length, 0, `预期 0 缺失，实际 ${missing.length}：${missing.map(m => m.path).join(',')}`);
    },
  },
  {
    name: 'detectMissingBackfillFields：空对象 → 全部缺失',
    run: () => {
      const missing = detectMissingBackfillFields({});
      assert.strictEqual(missing.length, BACKFILL_FIELDS.length);
    },
  },
  {
    name: 'detectMissingBackfillFields：模拟 v1.x 老 config（仅最早期字段）→ 正确识别新增字段缺失',
    run: () => {
      const old = {
        schema_version: '1.0',
        project_name: 'demo',
        project_type: 'app',
        agent_adapter: 'claude',
        architecture: { outer_layers: [{ id: '01', can_depend_on: [] }] },
        paths: {
          features_dir: 'doc/features',
          module_catalog: 'doc/module-catalog.yaml',
          glossary: 'doc/glossary.yaml',
          glossary_seed: 'doc/glossary-seed.txt',
          architecture_md: 'doc/architecture.md',
        },
      };
      const missing = detectMissingBackfillFields(old).map(m => m.path);
      const expected = [
        'active_workflow',
        'lifecycle_hooks_enabled',
        'paths.extension_dir',
        'paths.state_file',
        'paths.receipt_dir_pattern',
        'paths.docs_committed',
        'state_machine.grace_period_minutes',
        'state_machine.ttl_hours',
        'state_machine.schema_version',
        'toolchain.hvigor.daemon',
        'toolchain.hvigor.parallel',
        'toolchain.hvigor.incremental',
        'toolchain.hvigor.analyze',
      ];
      for (const p of expected) {
        assert(missing.includes(p), `应识别为缺失：${p}（实际缺失：${missing.join(',')}）`);
      }
      // schema_version 已有 "1.0"，绝不视为缺失
      assert(!missing.includes('schema_version'), 'schema_version 已存在，不应判定为缺失');
    },
  },
  {
    name: 'mergeBackfillFields：只补缺、不覆盖用户已有值',
    run: () => {
      const user = {
        schema_version: '1.0', // 用户老值，不应被覆盖为 1.1
        paths: {
          features_dir: 'custom/features', // 不是默认值，必须保留
          module_catalog: 'doc/module-catalog.yaml',
          glossary: 'doc/glossary.yaml',
          glossary_seed: 'doc/glossary-seed.txt',
          architecture_md: 'doc/architecture.md',
        },
        toolchain: {
          hvigor: { daemon: false }, // 用户显式禁用 daemon，不应被覆盖
        },
      };
      const { merged, report } = mergeBackfillFields(user);
      assert.strictEqual((merged as { schema_version: string }).schema_version, '1.0', 'schema_version 应保留用户原值');
      assert.strictEqual(
        ((merged as { paths: { features_dir: string } }).paths).features_dir,
        'custom/features',
        'paths.features_dir 应保留用户原值',
      );
      assert.strictEqual(
        ((merged as { toolchain: { hvigor: { daemon: boolean } } }).toolchain).hvigor.daemon,
        false,
        'toolchain.hvigor.daemon 应保留用户原值',
      );
      // 必补字段
      assert.strictEqual(
        (merged as { paths: { extension_dir?: string } }).paths.extension_dir,
        'doc/extensions',
        'paths.extension_dir 应被回填',
      );
      assert.strictEqual(
        (merged as { active_workflow?: string }).active_workflow,
        'spec-driven',
        'active_workflow 应被回填',
      );
      // 部分字段在 user.toolchain.hvigor 已有时，其它姐妹字段仍要回填
      assert.strictEqual(
        ((merged as { toolchain: { hvigor: { parallel?: boolean } } }).toolchain).hvigor.parallel,
        true,
        'toolchain.hvigor.parallel 应被回填',
      );
      // report.appliedFields 不应包含 schema_version / paths.features_dir / toolchain.hvigor.daemon
      const appliedPaths = report.appliedFields.map(f => f.path);
      assert(!appliedPaths.includes('schema_version'));
      assert(!appliedPaths.includes('paths.features_dir'));
      assert(!appliedPaths.includes('toolchain.hvigor.daemon'));
      assert(appliedPaths.includes('paths.extension_dir'));
      assert(appliedPaths.includes('active_workflow'));
      assert(appliedPaths.includes('toolchain.hvigor.parallel'));
    },
  },
  {
    name: 'mergeBackfillFields：deep clone，不共享 BACKFILL_FIELDS 引用',
    run: () => {
      const { merged } = mergeBackfillFields({});
      // 篡改 merged，确保不影响白名单源默认值
      const sm = (merged as { state_machine: { grace_period_minutes: number } }).state_machine;
      sm.grace_period_minutes = 99;
      const again = mergeBackfillFields({}).merged as { state_machine: { grace_period_minutes: number } };
      assert.strictEqual(again.state_machine.grace_period_minutes, 5, '默认值不应被共享引用污染');
    },
  },
  {
    name: 'mergeBackfillFields：raw 不是对象 → 退化为按全白名单生成',
    run: () => {
      const { merged } = mergeBackfillFields(null);
      assert.strictEqual((merged as { schema_version: string }).schema_version, '1.1');
      assert.strictEqual((merged as { active_workflow: string }).active_workflow, 'spec-driven');
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(c => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (err) {
      return { name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message };
    }
  });
}
