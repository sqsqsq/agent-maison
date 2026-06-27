// framework-config-schema.unit.test.ts

import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { normalizeConfig } from '../../config';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const SCHEMA_PATH = path.resolve(__dirname, '..', '..', '..', 'specs', 'framework.config.schema.json');

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'framework.config.schema: toolchain.additionalProperties 为 false',
    run: () => {
      const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8')) as {
        properties?: { toolchain?: { additionalProperties?: boolean; properties?: Record<string, unknown> } };
      };
      const toolchain = schema.properties?.toolchain;
      assert.strictEqual(toolchain?.additionalProperties, false);
      assert.ok(toolchain?.properties?.hmosDevice, 'hmosDevice 须在 schema 中声明');
      assert.ok(toolchain?.properties?.hvigor, 'hvigor 须在 schema 中声明');
      assert.ok(!toolchain?.properties?.devEcoStudio, 'project schema 不得描述 devEcoStudio');
    },
  },
  {
    name: 'framework.config.schema: integrity opt-out 字段已登记',
    run: () => {
      const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8')) as {
        properties?: { integrity?: { properties?: Record<string, unknown> } };
      };
      const integ = schema.properties?.integrity;
      assert.ok(integ?.properties?.allow_local_drift, 'allow_local_drift 须在 schema 声明');
      assert.ok(integ?.properties?.drift_allowlist, 'drift_allowlist 须在 schema 声明');
    },
  },
  {
    name: 'normalizeConfig 保留 integrity opt-out（init UPDATE 重写不丢字段）',
    run: () => {
      const out = normalizeConfig({
        integrity: { allow_local_drift: true, drift_allowlist: ['harness/scripts/check-testing.ts'] },
      });
      assert.strictEqual(out.integrity?.allow_local_drift, true);
      assert.deepStrictEqual(out.integrity?.drift_allowlist, ['harness/scripts/check-testing.ts']);
      // 未声明时不凭空产生
      assert.strictEqual(normalizeConfig({}).integrity, undefined);
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
