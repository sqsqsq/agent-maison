// revalidate-plan.unit.test.ts — plan 07a41ec6 T8：--revalidate 目标选择（纯函数）与漂移风险分级

import assert from 'assert';

import { classifyDriftFile, classifyDriftRisk } from '../../scripts/utils/closure-attestation';
import type { PhaseStalenessResult } from '../../scripts/utils/phase-evidence-manifest';
import { planRevalidation } from '../../scripts/utils/revalidate';
import type { UnitCaseResult } from '../run-unit';

const CHAIN = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];
const st = (phase: string, verdict: PhaseStalenessResult['verdict'], propagated?: string): PhaseStalenessResult =>
  ({ phase, verdict, changed_paths: [], receipt_changed: false, ...(propagated ? { propagated_from: propagated } : {}) });

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: '目标选择：spec 改动 → 下游 stale 阶段按链序入列；fresh 跳过；未跑过（无 summary）不在重验域',
    run: () => {
      const staleness = [st('spec', 'stale'), st('plan', 'stale', 'spec'), st('coding', 'stale', 'spec'), st('review', 'stale', 'spec'), st('ut', 'missing'), st('testing', 'missing')];
      const has = (p: string) => ['spec', 'plan', 'coding', 'review'].includes(p);
      const plan = planRevalidation(CHAIN, staleness, undefined, has);
      assert.deepStrictEqual(plan.targets.map(t => `${t.phase}:${t.reason}`), ['spec:stale', 'plan:stale', 'coding:stale', 'review:stale']);
      assert.ok(plan.skipped.some(s => s.phase === 'ut' && /尚未跑过/.test(s.reason)));
      const fresh = planRevalidation(CHAIN, CHAIN.map(p => st(p, 'fresh')), undefined, () => true);
      assert.deepStrictEqual(fresh.targets, []);
      assert.deepStrictEqual(planRevalidation(CHAIN, [st('coding', 'tampered')], undefined, () => true).targets, [{ phase: 'coding', reason: 'tampered' }]);
    },
  },
  {
    name: '--from：起点及其下游一律重跑（不看新鲜度）；起点不在链上明确报错',
    run: () => {
      const plan = planRevalidation(CHAIN, CHAIN.map(p => st(p, 'fresh')), 'review', p => p !== 'testing');
      assert.deepStrictEqual(plan.targets.map(t => `${t.phase}:${t.reason}`), ['review:from', 'ut:downstream_of_from']);
      assert.throws(() => planRevalidation(CHAIN, [], 'nope', () => true), /--from nope 不在/);
    },
  },
  {
    name: '漂移分级：五类各对应一种复核；多类产品改动追加最终合并 diff review；纯文档不复审',
    run: () => {
      assert.strictEqual(classifyDriftFile('doc/features/f/notes.md'), 'documentation');
      assert.strictEqual(classifyDriftFile('02-Feature/Wallet/src/ohosTest/ets/test/Home.test.ets'), 'test_code');
      assert.strictEqual(classifyDriftFile('02-Feature/Wallet/src/main/ets/pages/Home.ets'), 'ui_layout');
      assert.strictEqual(classifyDriftFile('02-Feature/Wallet/src/main/resources/base/element/color.json'), 'visual_resource');
      assert.strictEqual(classifyDriftFile('02-Feature/Wallet/src/main/ets/viewmodel/HomeVM.ets'), 'logic');
      const single = classifyDriftRisk(['02-Feature/Wallet/src/main/ets/viewmodel/HomeVM.ets']);
      assert.strictEqual(single.combined, false);
      assert.strictEqual(single.required_reviews.length, 1);
      assert.ok(/scoped diff review/.test(single.required_reviews[0]));
      const multi = classifyDriftRisk(['a/pages/Home.ets', 'a/viewmodel/VM.ets', 'a/resources/base/media/icon.png', 'README.md']);
      assert.strictEqual(multi.combined, true);
      assert.ok(multi.required_reviews.some(r => /最终合并 diff review/.test(r)));
      assert.ok(multi.required_reviews.some(r => /不复审产品/.test(r)));
      assert.deepStrictEqual(multi.classes.map(c => c.class), ['logic', 'ui_layout', 'visual_resource', 'documentation']);
      const docsOnly = classifyDriftRisk(['docs/x.md']);
      assert.strictEqual(docsOnly.combined, false);
      assert.deepStrictEqual(docsOnly.required_reviews, ['文档/报告/备注变化：不复审产品']);
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (err) {
      results.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  }
  return results;
}
