// ============================================================================
// report-suggestion-normalize.unit.test.ts — t1（plan e6a3c9f4）四出口一致性单测
// ----------------------------------------------------------------------------
// 覆盖：
//   1. resolveEffectiveSuggestion：BLOCKER+FAIL 缺 suggestion → 统一 fallback（含 id 与来源）；
//      已有 suggestion / 非 BLOCKER / 非 FAIL → 原样。
//   2. finalizeChecksForScriptReport：非 PASS 补 source 回退 + suggestion fallback；
//      既有 source 保留；PASS 结果零改动——ScriptReport 落盘前完成规范化，
//      下游（summary/merged/console）零各自兜底。
//   3. buildSummaryBlockers：source 保真透传（不设则不出现该键）。
//   4. findBasenameCandidates/formatPrefixMismatchHint：前缀错配 → 命中真实位置诊断行。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  resolveEffectiveSuggestion,
  finalizeChecksForScriptReport,
} from '../../scripts/utils/report-generator';
import { buildSummaryBlockers } from '../../scripts/utils/summary-blockers';
import {
  findBasenameCandidates,
  formatPrefixMismatchHint,
} from '../../scripts/utils/path-candidates';
import { blockerFail } from '../../scripts/utils/check-result-factory';
import type { CheckResult } from '../../scripts/utils/types';

interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function mkCheck(partial: Partial<CheckResult>): CheckResult {
  return {
    id: 'x_check',
    category: 'structure',
    description: 'desc',
    severity: 'BLOCKER',
    status: 'FAIL',
    details: 'boom',
    ...partial,
  };
}

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'maison-t1-'));
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    // P1-7（plan 7c4f2e9b）契约反转：旧断言要求 fallback 含 id/来源/runbook——正是把弱模型
    // 引进 framework 源码逆向的文案（事故 i5 全程读门禁实现 0 次产物修复）。新契约：
    // agent 通道只给产物级动作+红线；源码定位指引移 operator_note（goal-report 渲染）。
    name: 'resolveEffectiveSuggestion：BLOCKER+FAIL 缺 suggestion → 产物级 fallback + operator_note 承载源码定位',
    run: () => {
      const plain = mkCheck({});
      const eff = resolveEffectiveSuggestion(plain, 'coding');
      assert(eff && eff.includes('修产物'), 'fallback 应为产物级动作');
      assert(!eff!.includes('检索 id='), 'fallback 不得引导检索判定实现');
      assert(!!plain.operator_note && plain.operator_note.includes('x_check'), 'check id 应移入 operator_note');
      assert(plain.operator_note!.includes('check-coding.ts'), '无 source 时 operator_note 回退 check-<phase>.ts');
      assert(plain.operator_note!.includes('harness-runbook.md'), '门禁速查指引应在 operator_note');

      const sourced = mkCheck({ source: 'profile_coding_host_structure' });
      resolveEffectiveSuggestion(sourced, 'coding');
      assert(sourced.operator_note!.includes('profile_coding_host_structure'), '有 source 时 operator_note 引用真实来源');

      const own = resolveEffectiveSuggestion(mkCheck({ suggestion: '按 X 修' }), 'coding');
      assert(own === '按 X 修', '已有 suggestion 必须原样保留');

      const warn = resolveEffectiveSuggestion(mkCheck({ severity: 'MAJOR' }), 'coding');
      assert(warn === undefined, '非 BLOCKER 不生成 fallback');

      const pass = resolveEffectiveSuggestion(mkCheck({ status: 'PASS' }), 'coding');
      assert(pass === undefined, '非 FAIL 不生成 fallback');
    },
  },
  {
    name: 'finalizeChecksForScriptReport：非 PASS 补 source+suggestion；PASS 零改动；既有 source 保留',
    run: () => {
      const tmp = mkTmpDir();
      try {
        const finalized = finalizeChecksForScriptReport(
          [
            mkCheck({ id: 'a_fail' }),
            mkCheck({ id: 'b_pass', status: 'PASS' }),
            mkCheck({ id: 'c_sourced', source: 'profile_x_dispatch', suggestion: '专属建议' }),
            mkCheck({ id: 'd_warn', status: 'WARN', severity: 'BLOCKER' }),
          ],
          'coding',
          'feat-x',
          tmp,
        ).checks;

        const aFail = finalized.find(c => c.id === 'a_fail')!;
        assert(aFail.source === 'check-coding.ts', '非 PASS 缺 source 应补 check-<phase>.ts');
        // P1-7：fallback suggestion=产物级动作（不再含 check id——那在 operator_note）
        assert(!!aFail.suggestion && aFail.suggestion.includes('修产物'), 'BLOCKER FAIL 应补产物级 fallback suggestion');
        assert(!!aFail.operator_note && aFail.operator_note.includes('a_fail'), 'check id 定位移 operator_note');

        const bPass = finalized.find(c => c.id === 'b_pass')!;
        assert(bPass.source === undefined && bPass.suggestion === undefined, 'PASS 结果必须零改动');

        const cSrc = finalized.find(c => c.id === 'c_sourced')!;
        assert(cSrc.source === 'profile_x_dispatch', '既有 source 必须保留');
        assert(cSrc.suggestion === '专属建议', '既有 suggestion 必须保留');

        const dWarn = finalized.find(c => c.id === 'd_warn')!;
        assert(dWarn.source === 'check-coding.ts', 'WARN（非 PASS）也补 source 供定位');
        assert(dWarn.suggestion === undefined, 'WARN 不强加 suggestion fallback（只 BLOCKER+FAIL）');
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'buildSummaryBlockers：source 保真透传；缺省不出现该键',
    run: () => {
      const excerpt = (t: string, m: number): string => t.slice(0, m);
      const cls = (): undefined => undefined;
      const entries = buildSummaryBlockers(
        [mkCheck({ id: 'with_src', source: 'profile_y' }), mkCheck({ id: 'no_src' })],
        excerpt,
        cls,
      );
      const withSrc = entries.find(e => e.id === 'with_src')!;
      assert(withSrc.source === 'profile_y', 'source 应保真传到 summary blockers');
      const noSrc = entries.find(e => e.id === 'no_src')!;
      assert(!('source' in noSrc), '无 source 时不应出现该键（schema 可选字段语义）');
    },
  },
  {
    name: '前缀诊断：basename 在层目录他处命中 → 诊断行给出真实位置',
    run: () => {
      const tmp = mkTmpDir();
      try {
        const real = path.join(tmp, '02-Feature', 'FinancialCard', 'src');
        fs.mkdirSync(real, { recursive: true });
        fs.writeFileSync(path.join(real, 'FooService.ets'), '// stub', 'utf-8');
        fs.mkdirSync(path.join(tmp, '02-Feature', 'node_modules', 'junk'), { recursive: true });
        fs.writeFileSync(path.join(tmp, '02-Feature', 'node_modules', 'junk', 'BarService.ets'), '//', 'utf-8');

        const missing = ['src/FooService.ets', 'src/NotAnywhere.ets', 'src/BarService.ets'];
        const candidates = findBasenameCandidates(
          tmp,
          ['02-Feature'],
          missing.map(m => path.basename(m)),
        );
        assert(candidates.get('FooService.ets')?.length === 1, '应命中真实位置');
        assert(!candidates.has('NotAnywhere.ets'), '不存在的文件无候选');
        assert(!candidates.has('BarService.ets'), 'node_modules 必须被跳过');

        const hint = formatPrefixMismatchHint(missing, candidates);
        assert(!!hint && hint.includes('疑似路径前缀不一致'), '应产出前缀诊断');
        assert(hint!.includes('02-Feature/FinancialCard/src/FooService.ets'), '诊断应含真实相对路径');

        const noHint = formatPrefixMismatchHint(['src/NotAnywhere.ets'], candidates);
        assert(noHint === null, '无候选时不产出诊断');
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'factory：blockerFail 构造 severity/status 固定且 suggestion 必填生效',
    run: () => {
      const r = blockerFail({
        id: 'f1',
        category: 'structure',
        description: 'd',
        details: 'x',
        suggestion: '修法',
      });
      assert(r.severity === 'BLOCKER' && r.status === 'FAIL' && r.suggestion === '修法', 'factory 形状');
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      out.push({ name: c.name, ok: true });
    } catch (err) {
      out.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  }
  return out;
}
