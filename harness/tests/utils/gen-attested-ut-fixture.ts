// ============================================================================
// gen-attested-ut-fixture.ts — 重算 v2_2/ut_no_src_mutation_attested_* 的 attestation
// ----------------------------------------------------------------------------
// 这两个 fixture 的 `review-closure-attestation.json` 记录的是**产品源码逐文件 sha256**，
// 所以只要有人改了 fixture 里的业务源文件，快照就必须重算，否则 fixture 会以"漂移"的形态
// 红——那不是 bug，是基线过期。
//
// 重算纪律（与 closed-feature-fixture.ts 同源）：**调用生产 writer** 在 fixture 运行时的
// 真实工作区形态上现算，绝不手搓哈希——手搓的快照测不出对账逻辑本身。
//   · _attested_pass       ：INPUT + AFTER_BASELINE（review 在"coding 产物已落地但未提交"
//                            的工作区上闭环，故快照覆盖 AFTER_BASELINE）；
//   · _attested_drift_fail ：只 INPUT（review 闭环之后 AFTER_BASELINE 才改的源码 = 漂移）。
//
// 用法（在 framework/harness 下）：
//   npx ts-node --transpile-only tests/utils/gen-attested-ut-fixture.ts
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  reviewClosureAttestationPath,
  writeReviewClosureAttestation,
} from '../../scripts/utils/closure-attestation';

const FIXTURE_ROOT = path.resolve(
  __dirname, '..', '..', '..', 'profiles', 'hmos-app', 'harness', 'tests', 'fixtures', 'v2_2',
);

/** fixture 快照的固定时间戳——`generated_at` 不进任何判定，钉死它让重算结果可复现。 */
const FIXED_NOW = '2026-08-28T00:00:00.000Z';

const TARGETS: ReadonlyArray<{ name: string; includeAfterBaseline: boolean }> = [
  { name: 'ut_no_src_mutation_attested_pass', includeAfterBaseline: true },
  { name: 'ut_no_src_mutation_attested_drift_fail', includeAfterBaseline: false },
];

function copyDir(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

export function regenerate(): Array<{ name: string; fileCount: number }> {
  const out: Array<{ name: string; fileCount: number }> = [];
  for (const target of TARGETS) {
    const fixture = path.join(FIXTURE_ROOT, target.name);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'attested-fixture-'));
    try {
      copyDir(path.join(fixture, 'INPUT'), tmp);
      if (target.includeAfterBaseline) copyDir(path.join(fixture, 'AFTER_BASELINE'), tmp);
      writeReviewClosureAttestation({
        projectRoot: tmp,
        feature: 'demo',
        expectProductSources: true,
        gateFingerprint: null,
        runIdentity: null,
        now: () => new Date(FIXED_NOW),
      });
      const produced = reviewClosureAttestationPath(tmp, 'demo');
      const dest = path.join(
        fixture, 'INPUT', 'doc', 'features', 'demo', 'review', 'reports',
        'review-closure-attestation.json',
      );
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, fs.readFileSync(produced, 'utf-8'), 'utf-8');
      const parsed = JSON.parse(fs.readFileSync(dest, 'utf-8')) as {
        inventory: { file_count: number };
      };
      out.push({ name: target.name, fileCount: parsed.inventory.file_count });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  return out;
}

if (require.main === module) {
  for (const r of regenerate()) {
    console.log(`${r.name}: inventory ${r.fileCount} files`);
  }
}
