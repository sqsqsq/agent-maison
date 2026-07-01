// ============================================================================
// init-update-policy.unit.test.ts — adapter update_policy + 0.3.4 排除语义
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  __testing,
  Inspection,
  inspectionsForInit034Prompt,
  parseUpdatePolicy,
} from '../../scripts/check-init';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}\n    expected: ${e}\n    actual:   ${a}`);
  }
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function writeConfig(root: string): void {
  writeFile(
    path.join(root, 'framework.config.json'),
    JSON.stringify(
      {
        schema_version: '1.0.0',
        project_name: 'init-update-policy-unit',
        project_type: 'app',
        agent_adapter: 'claude',
        architecture: {
          outer_layers: [
            {
              id: '01-Product',
              name: 'Product',
              order: 1,
              can_depend_on: [],
              intra_layer_deps: 'forbid',
            },
          ],
          module_inner_layers: ['shared', 'data', 'domain', 'presentation'],
          inner_dependency_direction: 'upward',
          cross_module_exports_file: 'index.ets',
        },
        paths: {
          features_dir: 'doc/features',
          module_catalog: 'doc/module-catalog.yaml',
          glossary: 'doc/glossary.yaml',
          glossary_seed: 'doc/glossary-seed.txt',
          architecture_md: 'doc/architecture.md',
        },
        toolchain: {
          devEcoStudio: {
            installPath: '',
            hvigorBin: '',
          },
        },
      },
      null,
      2,
    ),
  );
}

function withTmpProject<T>(fn: (root: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-policy-'));
  try {
    writeConfig(dir);
    return fn(dir);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function makeInspectorEnv(root: string) {
  const adapter = __testing.loadAdapter('claude');
  const cfg = __testing.loadRawFrameworkConfig(root);
  return {
    projectRoot: root,
    cfg,
    adapter,
    renderEnv: __testing.buildRenderEnv(cfg, adapter),
  };
}

/** 将全部 adapter 模板落盘并与源字节一致，仅钩子文件写入漂移内容 */
function materializeSyncedTemplatesExceptHook(root: string, hookDriftBody: string): void {
  const adapter = __testing.loadAdapter('claude');
  for (const f of adapter.templateFiles) {
    const templateBuf = fs.readFileSync(path.join(FRAMEWORK_ROOT, f.templateRel));
    if (f.targetRel.replace(/\\/g, '/').includes('.claude/hooks/check-phase-completion.mjs')) {
      writeFile(path.join(root, f.targetRel), hookDriftBody);
    } else {
      writeFile(path.join(root, f.targetRel), templateBuf.toString('utf-8'));
    }
  }
}

interface Case {
  name: string;
  run: () => void;
}

const cases: Case[] = [
  {
    name: 'parseUpdatePolicy：缺省/非法 → prompt_if_changed；auto_overwrite 保留',
    run: () => {
      assertEq(parseUpdatePolicy(undefined), 'prompt_if_changed', 'undefined');
      assertEq(parseUpdatePolicy(null), 'prompt_if_changed', 'null');
      assertEq(parseUpdatePolicy('bogus'), 'prompt_if_changed', 'bogus');
      assertEq(parseUpdatePolicy('prompt_if_changed'), 'prompt_if_changed', 'explicit default');
      assertEq(parseUpdatePolicy('auto_overwrite'), 'auto_overwrite', 'auto_overwrite');
    },
  },
  {
    name: 'inspect03：hooks 漂移行带 update_policy=auto_overwrite 且单行展开',
    run: () =>
      withTmpProject(root => {
        materializeSyncedTemplatesExceptHook(root, '// __FIXTURE_OLD_HOOK_DRIFT__\n');
        const rows = __testing.inspect03(makeInspectorEnv(root)).filter(r => r.status !== 'EMPTY');
        const hook = rows.find(
          r =>
            r.target_path.replace(/\\/g, '/') === '.claude/hooks/check-phase-completion.mjs',
        );
        assert(!!hook, '应能找到 check-phase-completion.mjs 行');
        assertEq(hook!.status, 'POPULATED', 'hooks 漂移须为 POPULATED');
        assertEq(hook!.update_policy, 'auto_overwrite', 'claude adapter hooks 段须为 auto_overwrite');
      }),
  },
  {
    name: 'inspect01：老 config（缺 active_workflow / state_machine / extension_dir 等）→ missing_keys 非空且诊断含"白名单字段缺失"',
    run: () =>
      withTmpProject(root => {
        const inspection = __testing.inspect01(makeInspectorEnv(root));
        assertEq(inspection.status, 'POPULATED', '老 fixture 有 outer_layers，应为 POPULATED');
        assert(
          Array.isArray(inspection.missing_keys) && (inspection.missing_keys ?? []).length > 0,
          'missing_keys 应非空（fixture 老 config 缺多个白名单字段）',
        );
        const mk = inspection.missing_keys ?? [];
        for (const p of [
          'active_workflow',
          'lifecycle_hooks_enabled',
          'paths.extension_dir',
          'paths.state_file',
          'paths.receipt_dir_pattern',
          'paths.reports_dir_pattern',
          'paths.docs_committed',
          'state_machine.grace_period_minutes',
          'state_machine.ttl_hours',
          'state_machine.max_consecutive_blocks',
          'state_machine.schema_version',
          'toolchain.hvigor.daemon',
        ]) {
          assert(mk.includes(p), `missing_keys 应包含 ${p}（实际：${mk.join(',')}）`);
        }
        // schema_version 已写为 "1.0.0"，不应判定为缺失
        assert(!mk.includes('schema_version'), 'schema_version 已存在，不应识别为缺失');
        assert(
          inspection.diagnosis.includes('白名单字段缺失') &&
            inspection.diagnosis.includes('merge-framework-config.mjs --apply'),
          `诊断应提示补缺命令；实际：${inspection.diagnosis}`,
        );
        assert(
          Array.isArray(inspection.migration_keys) &&
            (inspection.migration_keys ?? []).includes('project_type_to_sub_variant'),
          `migration_keys 应含 project_type_to_sub_variant；实际：${JSON.stringify(inspection.migration_keys)}`,
        );
        assert(
          !Array.isArray(inspection.confirm_keys) ||
            !(inspection.confirm_keys ?? []).includes('reports_dir_pattern'),
          `confirm_keys 不应再含 reports_dir_pattern；实际：${JSON.stringify(inspection.confirm_keys)}`,
        );
        assert(
          mk.includes('paths.reports_dir_pattern'),
          `missing_keys 应含 paths.reports_dir_pattern（BACKFILL）；实际：${mk.join(',')}`,
        );
      }),
  },
  {
    name: 'inspectionsForInit034Prompt：POPULATED + auto_overwrite 的 #3 不出现在 Q 列表',
    run: () => {
      const inspections: Inspection[] = [
        {
          index: 2,
          target_path: 'CLAUDE.md',
          template_source: 't.md',
          status: 'POPULATED',
          hash_template: 'a',
          hash_target: 'b',
          diff_summary: 'd',
          planned_strategy: '',
          diagnosis: '',
        },
        {
          index: 3,
          target_path: '.claude/hooks/x.mjs',
          template_source: 'h.mjs',
          status: 'POPULATED',
          hash_template: 'a',
          hash_target: 'b',
          diff_summary: 'd',
          planned_strategy: '',
          diagnosis: '',
          update_policy: 'auto_overwrite',
        },
        {
          index: 3,
          target_path: '.claude/commands/foo.md',
          template_source: 'c.md',
          status: 'POPULATED',
          hash_template: 'a',
          hash_target: 'b',
          diff_summary: 'd',
          planned_strategy: '',
          diagnosis: '',
          update_policy: 'prompt_if_changed',
        },
      ];
      const q = inspectionsForInit034Prompt(inspections);
      assertEq(q.length, 2, '应仅含 Q2 + Q3(prompt 文件)');
      assert(!!q.find(i => i.index === 2), '须含入口文件');
      assert(!!q.find(i => i.target_path.includes('foo.md')), '须含 slash 跳板文件');
      assert(!q.some(i => i.target_path.includes('x.mjs')), '不含 auto_overwrite hooks');
    },
  },
  {
    name: 'applyInitMechanismSync：漂移 hooks 对齐模板',
    run: () =>
      withTmpProject(root => {
        materializeSyncedTemplatesExceptHook(root, '// __DRIFT_BEFORE_SYNC__\n');
        const adapter = __testing.loadAdapter('claude');
        const { syncedFiles, backupRelDir } = __testing.applyInitMechanismSync(root, adapter);
        assert(syncedFiles >= 1, '应对至少一处 auto_overwrite 文件执行写入');
        assert(backupRelDir !== null, '有内容漂移时应创建备份目录');
        const tg = path.join(
          root,
          '.claude',
          'hooks',
          'check-phase-completion.mjs',
        );
        const tpl = fs.readFileSync(
          path.join(FRAMEWORK_ROOT, 'agents', 'claude', 'templates', 'hooks', 'check-phase-completion.mjs'),
        );
        assertEq(fs.readFileSync(tg).toString('utf-8'), tpl.toString('utf-8'), '同步后应与模板字节一致');
        const backupHook = path.join(root, backupRelDir!, '.claude/hooks/check-phase-completion.mjs');
        assert(
          fs.readFileSync(backupHook).toString('utf-8').includes('__DRIFT_BEFORE_SYNC__'),
          '备份目录应保留漂移前内容',
        );
      }),
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
