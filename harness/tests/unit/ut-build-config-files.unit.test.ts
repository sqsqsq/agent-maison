// ============================================================================
// ut-build-config-files.unit.test.ts
// ============================================================================
// 覆盖 pickNonSrcConfigChanges：从未授权改动清单挑出「src/ 之外」的工程/构建配置文件
// （模块根的 build/工程配置天然不在 src/ 下），用于 ut_no_src_mutation 给「优先回退」指引。
// 该启发式 profile 无关——不硬编码具体宿主配置文件名。

import { pickNonSrcConfigChanges } from '../../scripts/check-ut';
import type { UnitCaseResult } from '../run-unit';

function assert(cond: boolean, label: string): void {
  if (!cond) throw new Error(label);
}

function eqArr(a: string[], b: string[], label: string): void {
  assert(a.length === b.length && a.every((x, i) => x === b[i]), `${label}: ${JSON.stringify(a)}`);
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'pickNonSrcConfigChanges: 模块根配置（非 src/）命中，含 Windows 反斜杠',
    run: () => {
      const out = pickNonSrcConfigChanges([
        '01-Product/Phone/build-profile.json5',
        '02-Feature/WalletMain/src/main/ets/Foo.ets',
        '01-Product\\Phone\\oh-package.json5',
      ]);
      eqArr(
        out,
        ['01-Product/Phone/build-profile.json5', '01-Product\\Phone\\oh-package.json5'],
        '仅非 src/ 配置',
      );
    },
  },
  {
    name: 'pickNonSrcConfigChanges: src/ 下文件一律不命中（含 src/ohosTest 配置）',
    run: () => {
      const out = pickNonSrcConfigChanges([
        '02-Feature/WalletMain/src/main/ets/Bar.ets',
        '01-Product/Phone/src/main/ets/pages/index.ets',
        '02-Feature/X/src/ohosTest/module.json5',
      ]);
      eqArr(out, [], 'src/ 内不算工程配置');
    },
  },
  {
    name: 'pickNonSrcConfigChanges: AppScope 顶层配置（非 src/）命中',
    run: () => {
      const out = pickNonSrcConfigChanges(['AppScope/app.json5']);
      eqArr(out, ['AppScope/app.json5'], '顶层配置命中');
    },
  },
  {
    name: 'pickNonSrcConfigChanges: 空输入 → 空',
    run: () => {
      eqArr(pickNonSrcConfigChanges([]), [], '空');
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
