/**
 * crossModuleExportsFile 与入口 .ets basename 豁免规则（coding-host-rules）
 */
import assert from 'assert';
import { isCrossModuleExportFileStem } from '../../coding-host-rules';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'index + index.ets → true（小写入口）',
    run: () => assert.strictEqual(isCrossModuleExportFileStem('index', 'index.ets'), true),
  },
  {
    name: 'Index + index.ets → true（大小写不敏感）',
    run: () => assert.strictEqual(isCrossModuleExportFileStem('Index', 'index.ets'), true),
  },
  {
    name: 'index + Index.ets → true',
    run: () => assert.strictEqual(isCrossModuleExportFileStem('index', 'Index.ets'), true),
  },
  {
    name: 'HomePage + index.ets → false',
    run: () => assert.strictEqual(isCrossModuleExportFileStem('HomePage', 'index.ets'), false),
  },
  {
    name: 'barrel + Barrel.ets（自定义导出名）→ true',
    run: () => assert.strictEqual(isCrossModuleExportFileStem('barrel', 'Barrel.ets'), true),
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
