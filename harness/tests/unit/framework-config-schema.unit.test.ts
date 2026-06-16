// framework-config-schema.unit.test.ts

import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

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
