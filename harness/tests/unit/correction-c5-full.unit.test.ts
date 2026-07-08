// ============================================================================
// correction-c5-full.unit.test.ts — C5-full 契约单测
// ============================================================================
// 覆盖：touched_layers 对账（未声明层拦截 / 声明覆盖放行 / 中性路径豁免）+
// feature.yaml 修正历史 append（保留既有字段 / 文件缺失静默跳过）。

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { reconcileTouchedLayers } from '../../scripts/utils/correction-layer-reconcile';
import { appendFeatureCorrectionHistory, featureTrackDeclPath } from '../../scripts/utils/feature-track';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function mkProject(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c5full-'));
  fs.mkdirSync(path.join(tmp, 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'framework.config.json'), JSON.stringify({
    schema_version: '1.0',
    project_name: 'c5full-fixture',
    project_profile: { name: 'generic' },
    architecture: {
      outer_layers: [{ id: '02-Feature', can_depend_on: [], intra_layer_deps: 'forbid' }],
      module_inner_layers: ['shared'],
      inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ets',
    },
    paths: { features_dir: 'doc/features' },
  }, null, 2), 'utf-8');
  return tmp;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'reconcileTouchedLayers: 未声明层（coding）被实际改动命中 → undeclared 非空',
    run: () => {
      const tmp = mkProject();
      const result = reconcileTouchedLayers(
        tmp,
        'demo-feat',
        ['spec'],
        ['02-Feature/ModA/index.ets', `doc/features/demo-feat/spec.md`],
      );
      eq(result.undeclared, ['coding'], 'undeclared 应含 coding');
      eq(result.actualLayers, ['coding', 'spec'], 'actualLayers 应含两层');
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  },
  {
    name: 'reconcileTouchedLayers: 声明覆盖全部实际触及层 → undeclared 为空（组合修正放行）',
    run: () => {
      const tmp = mkProject();
      const result = reconcileTouchedLayers(
        tmp,
        'demo-feat',
        ['spec', 'coding'],
        ['02-Feature/ModA/index.ets', 'doc/features/demo-feat/spec.md'],
      );
      eq(result.undeclared, [], 'undeclared 应为空');
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  },
  {
    name: 'reconcileTouchedLayers: 中性框架/文档路径不计入任何层',
    run: () => {
      const tmp = mkProject();
      const result = reconcileTouchedLayers(
        tmp,
        'demo-feat',
        [],
        ['framework/harness/config.ts', 'openspec/changes/foo/tasks.md', 'doc/architecture.md'],
      );
      eq(result.actualLayers, [], '全部应归为中性，不计入 actualLayers');
      eq(result.undeclared, [], '中性路径不产生 undeclared');
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  },
  {
    name: 'reconcileTouchedLayers: features_dir 外测试路径归 ut，非测试路径归 coding',
    run: () => {
      const tmp = mkProject();
      const result = reconcileTouchedLayers(
        tmp,
        null,
        [],
        ['02-Feature/ModA/test/ModA.test.ets', '02-Feature/ModA/index.ets'],
      );
      eq(result.actualLayers, ['coding', 'ut'], 'ut 与 coding 均应命中');
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  },
  {
    name: 'reconcileTouchedLayers: no-feature（feature=null）时 features_dir 前缀不特判，按 coding/ut 粗判',
    run: () => {
      const tmp = mkProject();
      const result = reconcileTouchedLayers(tmp, null, ['coding'], ['some/random/src/File.ets']);
      eq(result.undeclared, [], 'coding 已声明应放行');
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  },
  {
    name: 'appendFeatureCorrectionHistory: 保留既有字段并追加 history 条目',
    run: () => {
      const tmp = mkProject();
      const abs = featureTrackDeclPath(tmp, 'demo-feat');
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, YAML.stringify({
        schema_version: '1.0',
        track: 'full',
        confirmed_by: 'user',
        history: [{ at: '2026-01-01T00:00:00Z', from: 'lite', to: 'full' }],
      }), 'utf-8');

      appendFeatureCorrectionHistory(tmp, 'demo-feat', {
        at: '2026-07-08T00:00:00Z',
        type: 'correction',
        root_layer: 'coding',
        touched_layers: ['coding', 'ut'],
      });

      const doc = YAML.parse(fs.readFileSync(abs, 'utf-8')) as Record<string, unknown>;
      eq(doc.track, 'full', 'track 字段应保留');
      eq(doc.confirmed_by, 'user', 'confirmed_by 字段应保留');
      const history = doc.history as unknown[];
      eq(history.length, 2, 'history 应追加为 2 条');
      eq((history[1] as { type: string }).type, 'correction', '新条目 type 应为 correction');
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  },
  {
    name: 'appendFeatureCorrectionHistory: feature.yaml 不存在时静默跳过（不抛错）',
    run: () => {
      const tmp = mkProject();
      appendFeatureCorrectionHistory(tmp, 'nonexistent-feat', {
        at: '2026-07-08T00:00:00Z',
        type: 'correction',
        root_layer: 'coding',
        touched_layers: ['coding'],
      });
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (err) {
      return { name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message };
    }
  });
}
