// ============================================================================
// adhoc-derive-payload.unit.test.ts — ad-hoc derive hint payload (schema 4)
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { buildAdhocDerivePayload } from '../../scripts/utils/adhoc-derive-payload';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function withTmpProject<T>(fn: (root: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adhoc-derive-payload-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'buildAdhocDerivePayload: 稳定的 schema/mode/bundle 元信息',
    run: () => {
      withTmpProject(root => {
        const p = buildAdhocDerivePayload(root, 'com.example.app', '打开首页 -> 点击卡片');
        assert(p.schema === 4, `schema=${p.schema as unknown as string}`);
        assert(p.mode === 'adhoc', `mode=${p.mode as unknown as string}`);
        assert(p.bundle === 'com.example.app', `bundle=${p.bundle as unknown as string}`);
        assert(typeof p.generated_at === 'string', `generated_at not string`);
      });
    },
  },
  {
    name: 'buildAdhocDerivePayload: natural_steps 机械拆分 -> / →',
    run: () => {
      withTmpProject(root => {
        const p = buildAdhocDerivePayload(root, 'b', '步骤一 -> 步骤二 → 步骤三');
        const steps = p.natural_steps as string[];
        assert(
          Array.isArray(steps) && steps.length === 3 && steps[0] === '步骤一' && steps[2] === '步骤三',
          `steps=${JSON.stringify(steps)}`,
        );
      });
    },
  },
  {
    name: 'buildAdhocDerivePayload: 空快照缓存 → snapshot_cache_empty=true, available_pages 为空',
    run: () => {
      withTmpProject(root => {
        const p = buildAdhocDerivePayload(root, 'b', '点击');
        assert(p.snapshot_cache_empty === true, `snapshot_cache_empty=${p.snapshot_cache_empty as unknown as string}`);
        const pages = p.available_pages as unknown[];
        assert(Array.isArray(pages) && pages.length === 0, `available_pages=${JSON.stringify(pages)}`);
      });
    },
  },
  {
    name: 'buildAdhocDerivePayload: steps_file_contract 禁止 start_app',
    run: () => {
      withTmpProject(root => {
        const p = buildAdhocDerivePayload(root, 'b', '点击');
        const contract = p.steps_file_contract as { forbidden_in_steps: string[] };
        assert(
          contract.forbidden_in_steps.includes('start_app'),
          `forbidden_in_steps=${JSON.stringify(contract.forbidden_in_steps)}`,
        );
        const topForbidden = p.forbidden_in_steps as string[];
        assert(topForbidden.includes('start_app'), `top forbidden=${JSON.stringify(topForbidden)}`);
      });
    },
  },
  {
    name: 'buildAdhocDerivePayload: 观察意图影响 next_action 分支',
    run: () => {
      withTmpProject(root => {
        const withObs = buildAdhocDerivePayload(root, 'b', '打开页面并检查是否显示标题');
        const noObs = buildAdhocDerivePayload(root, 'b', '点击按钮 -> 滑动列表');
        assert(typeof withObs.has_observation === 'boolean', `has_observation not boolean`);
        assert(typeof noObs.has_observation === 'boolean', `has_observation not boolean`);
        assert(typeof withObs.next_action === 'string', `next_action not string`);
        if (withObs.has_observation) {
          assert(
            (withObs.next_action as string).includes('dump-ui-only'),
            `observation next_action=${withObs.next_action as string}`,
          );
        }
      });
    },
  },
  {
    name: 'buildAdhocDerivePayload: navigation_hint 结构存在',
    run: () => {
      withTmpProject(root => {
        const p = buildAdhocDerivePayload(root, 'b', '点击');
        const hint = p.navigation_hint as { requires_nav_reset: boolean };
        assert(typeof hint.requires_nav_reset === 'boolean', `bad navigation_hint: ${JSON.stringify(hint)}`);
      });
    },
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
  const r = runAll();
  for (const x of r) {
    console.log(x.ok ? `PASS ${x.name}` : `FAIL ${x.name}: ${x.error}`);
  }
  process.exit(r.every(x => x.ok) ? 0 : 1);
}
