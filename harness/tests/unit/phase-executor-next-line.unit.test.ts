// phase-executor-next-line.unit.test.ts — plan 07a41ec6 T9：phase-executor 模板与 adapter 登记、summary 末尾 NEXT: 行

import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { buildNextLine } from '../../harness-runner';
import type { UnitCaseResult } from '../run-unit';

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'phase-executor 模板存在、frontmatter 合法，adapter（claude / codeagent）子 agent 目录登记指向该模板目录',
    run: () => {
      const tpl = path.join(FRAMEWORK_ROOT, 'agents', 'claude', 'templates', 'agents', 'phase-executor.md');
      assert.ok(fs.existsSync(tpl), 'phase-executor.md 模板须存在');
      const text = fs.readFileSync(tpl, 'utf-8');
      assert.ok(/^---\nname: phase-executor\n/.test(text), 'frontmatter name 须为 phase-executor');
      assert.ok(/同步等待/.test(text) && /禁止 sleep/.test(text), '等待纪律须写进模板');
      assert.ok(/一次派发只做一个阶段/.test(text), '单阶段纪律须写进模板');
      const claude = fs.readFileSync(path.join(FRAMEWORK_ROOT, 'agents', 'claude', 'adapter.yaml'), 'utf-8');
      assert.ok(/subagents:\s*\n\s*target_dir: \.claude\/agents\s*\n\s*template_dir: templates\/agents/.test(claude), 'claude adapter 子 agent 目录须登记 templates/agents');
      const codeagent = fs.readFileSync(path.join(FRAMEWORK_ROOT, 'agents', 'codeagent', 'adapter.yaml'), 'utf-8');
      assert.ok(/template_dir: \.\.\/claude\/templates\/agents/.test(codeagent), 'codeagent 共享同一模板目录');
      const goalCondition = fs.readFileSync(path.join(FRAMEWORK_ROOT, 'agents', 'claude', 'templates', 'goal-condition.md'), 'utf-8');
      assert.ok(/phase-executor/.test(goalCondition), 'goal-condition 须写明每阶段至多一个 phase-executor');
    },
  },
  {
    name: 'NEXT: 行——FAIL 指向首个 blocker 与改法；PASS 按 next_action 给动作；closed 停等用户',
    run: () => {
      const fail = buildNextLine(
        { verdict: 'FAIL', script_report: 'doc/features/f/coding/reports/script-report.json', blockers: [{ id: 'coding_compile', details_excerpt: 'hvigor 编译失败\n第二行', suggestion: '修复 Home.ets:12 的类型错误' }] },
        'coding', 'f',
      );
      assert.ok(/^NEXT: 一轮修完全部 1 个 blocker：coding_compile（修复 Home.ets:12 的类型错误）/.test(fail), fail);
      const multi = buildNextLine({ verdict: 'FAIL', script_report: 'r.json', blockers: [{ id: 'a', suggestion: '改 A' }, { id: 'b', suggestion: '改 B' }] }, 'ut', 'f');
      assert.ok(/全部 2 个 blocker：a（改 A）；b（改 B）/.test(multi), multi);
      assert.ok(/--phase coding --feature f/.test(fail), fail);
      const verifier = buildNextLine({ verdict: 'PASS', next_action: 'run_verifier_then_receipt', verifier_request: 'doc/features/f/coding/reports/verifier.request.abc.json' }, 'coding', 'f');
      assert.ok(/整段投给 subagent_type=verifier/.test(verifier) && /verifier\.request\.abc\.json/.test(verifier), verifier);
      const closed = buildNextLine({ verdict: 'PASS', next_action: 'phase_closed_wait_user' }, 'coding', 'f');
      assert.ok(/已闭环/.test(closed) && /等待用户/.test(closed), closed);
      const receipt = buildNextLine({ verdict: 'PASS', next_action: 'fill_receipt_then_sync_closure' }, 'review', 'f');
      assert.ok(/check-receipt --phase review --feature f/.test(receipt), receipt);
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
