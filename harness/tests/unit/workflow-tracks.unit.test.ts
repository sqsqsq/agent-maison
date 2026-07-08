// ============================================================================
// workflow-tracks.unit.test.ts — C1 分轨 schema 1.1 契约（plan d4a7c1e8）
// ============================================================================
// 锁死：lite 成员/链/依赖必须显式（决策 19）、1.0 拒绝分轨字段、
// spec-driven 1.1 的 lite 链解析 == [change, coding, exit] 且 full 轨零变化。

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadWorkflowSpec } from '../../workflow-loader';
import {
  LEGACY_FEATURE_PHASE_ORDER,
  resolvePhaseChain,
  workflowFeaturePhases,
} from '../../scripts/utils/runtime-policy';
import { resolveAutoChain } from '../../scripts/utils/phase-transition-policy';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');

function writeTempWorkflow(yaml: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-wf-'));
  fs.mkdirSync(path.join(root, 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(root, 'workflows', 't.workflow.yaml'), yaml, 'utf-8');
  return root;
}

function expectThrow(yaml: string, needle: string, label: string): void {
  const root = writeTempWorkflow(yaml);
  try {
    loadWorkflowSpec(root, 't');
  } catch (err) {
    const msg = (err as Error).message;
    if (!msg.includes(needle)) {
      throw new Error(`${label}: 报错未含 "${needle}"，实际：${msg}`);
    }
    return;
  }
  throw new Error(`${label}: 应加载失败但成功了`);
}

const V11_VALID = `
schema_version: "1.1"
name: t
auto_chain: [spec, coding]
auto_chain_by_track:
  lite: [change, coding, exit]
artifacts:
  - { id: spec,   scope: feature, requires: [] }
  - { id: coding, scope: feature, requires: [spec], tracks: ["full", "lite"], requires_by_track: { lite: [change] } }
  - { id: change, scope: feature, requires: [], tracks: ["lite"] }
  - { id: exit,   scope: feature, requires: [coding], tracks: ["lite"] }
`;

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'spec-driven 1.1：lite 链 == [change, coding, exit]，full 轨 feature 集零变化',
    run: () => {
      const spec = loadWorkflowSpec(FRAMEWORK_ROOT, 'spec-driven');
      if (spec.schema_version !== '1.1') throw new Error(`schema_version=${spec.schema_version}`);
      const lite = resolvePhaseChain(spec, 'lite');
      const liteFeature = JSON.stringify(lite.featureOrdered);
      if (liteFeature !== JSON.stringify(['change', 'coding', 'exit'])) {
        throw new Error(`lite featureOrdered=${liteFeature}`);
      }
      if (JSON.stringify(lite.autoChain) !== JSON.stringify(['change', 'coding', 'exit'])) {
        throw new Error(`lite autoChain=${JSON.stringify(lite.autoChain)}`);
      }
      const full = resolvePhaseChain(spec, 'full');
      if (JSON.stringify(full.featureOrdered) !== JSON.stringify([...LEGACY_FEATURE_PHASE_ORDER])) {
        throw new Error(`full featureOrdered=${JSON.stringify(full.featureOrdered)}`);
      }
      if (full.idSet.has('change') || full.idSet.has('exit')) {
        throw new Error('full 轨不应含 lite-only phase');
      }
      // lite 轨含 global phase（catalog 等对全 track 适用）
      if (!lite.idSet.has('catalog') || !lite.idSet.has('init')) {
        throw new Error('lite 轨应含 global phase');
      }
    },
  },
  {
    name: '合法 1.1 分轨 workflow：加载成功且 lite 依赖用覆写',
    run: () => {
      const root = writeTempWorkflow(V11_VALID);
      const spec = loadWorkflowSpec(root, 't');
      const lite = resolvePhaseChain(spec, 'lite');
      if (JSON.stringify(lite.featureOrdered) !== JSON.stringify(['change', 'coding', 'exit'])) {
        throw new Error(JSON.stringify(lite.featureOrdered));
      }
      if (JSON.stringify(workflowFeaturePhases(spec, 'full')) !== JSON.stringify(['spec', 'coding'])) {
        throw new Error('full 轨应为 [spec, coding]');
      }
    },
  },
  {
    name: 'resolveAutoChain(track=lite)：spec-driven change→exit == 显式 lite 链（goal 批量授权前置）',
    run: () => {
      const spec = loadWorkflowSpec(FRAMEWORK_ROOT, 'spec-driven');
      const chain = resolveAutoChain(spec, 'change', 'exit', undefined, 'lite');
      if (JSON.stringify(chain) !== JSON.stringify(['change', 'coding', 'exit'])) {
        throw new Error(`lite chain=${JSON.stringify(chain)}`);
      }
      // full 轨默认行为零变化
      const full = resolveAutoChain(spec, 'spec', 'testing');
      if (JSON.stringify(full) !== JSON.stringify([...LEGACY_FEATURE_PHASE_ORDER])) {
        throw new Error(`full chain=${JSON.stringify(full)}`);
      }
    },
  },
  {
    name: '1.0 出现分轨字段 → FAIL',
    run: () =>
      expectThrow(
        V11_VALID.replace('schema_version: "1.1"', 'schema_version: "1.0"'),
        '仅 schema_version 1.1 可用',
        '1.0 分轨字段',
      ),
  },
  {
    name: 'lite-only phase 存在但缺 auto_chain_by_track.lite → FAIL（不做隐式推导）',
    run: () =>
      expectThrow(
        V11_VALID.replace(/auto_chain_by_track:\n  lite: \[change, coding, exit\]\n/, ''),
        '缺 auto_chain_by_track.lite',
        '缺显式链',
      ),
  },
  {
    name: 'lite 成员 plain requires 引轨外 phase 且无覆写 → FAIL（禁止隐式降空）',
    run: () =>
      expectThrow(
        V11_VALID.replace(', requires_by_track: { lite: [change] }', ''),
        '须显式声明 requires_by_track.lite',
        '隐式降空',
      ),
  },
  {
    name: 'global phase 声明 tracks → FAIL',
    run: () =>
      expectThrow(
        V11_VALID.replace(
          '- { id: spec,   scope: feature, requires: [] }',
          '- { id: spec,   scope: feature, requires: [] }\n  - { id: docs, scope: global, requires: [], tracks: ["full"] }',
        ),
        '不得声明 tracks',
        'global tracks',
      ),
  },
  {
    name: 'requires_by_track 引用轨外 feature phase → FAIL',
    run: () =>
      expectThrow(
        V11_VALID.replace('requires_by_track: { lite: [change] }', 'requires_by_track: { lite: [spec] }'),
        '引用轨外 feature phase',
        '轨外覆写',
      ),
  },
  {
    name: 'auto_chain_by_track 链序与依赖不互洽 → FAIL',
    run: () =>
      expectThrow(
        V11_VALID.replace('lite: [change, coding, exit]', 'lite: [exit, change, coding]'),
        '须在链中先于它',
        '链序不互洽',
      ),
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (err) {
      results.push({ name: c.name, ok: false, error: (err as Error).message });
    }
  }
  return results;
}
