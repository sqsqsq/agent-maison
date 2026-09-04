// ============================================================================
// correction-c5-full.unit.test.ts — C5-full 契约单测
// ============================================================================
// 覆盖：feature.yaml 修正历史 append（保留既有字段 / 文件缺失静默跳过）。
// touched_layers 对账已随 plan 07a41ec6 T1 删除（{coding, ut} 结构上不可声明，拦截零收益）。

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
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
