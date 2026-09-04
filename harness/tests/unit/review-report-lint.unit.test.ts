// review-report-lint.unit.test.ts — plan 07a41ec6 T5：review 报告统计表自动回写 + 引用/计数 lint（WARN 提示）

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache, resolveFeatureArtifact } from '../../config';
import {
  __testing_checkReviewReferenceLint,
  __testing_checkStatisticsSummary,
} from '../../scripts/check-review';
import type { CheckContext } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';

const FEATURE = 'rl-fixture';

function mkProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-review-lint-'));
  clearFrameworkConfigCache();
  return root;
}

function ctxOf(root: string): CheckContext {
  return { projectRoot: root, feature: FEATURE, phase: 'review', phaseRule: {} } as unknown as CheckContext;
}

function reportMd(opts: { statsTotal: number; blocker: number; major: number; prose?: string; refs?: string[] }): string {
  const refs = opts.refs ?? ['`02-Feature/Wallet/src/main/ets/pages/Home.ets:12`'];
  return [
    '# 代码审查报告 — demo', '',
    '## 三、问题清单', '',
    '| 编号 | 严重程度 | 分类 | 问题描述 | 涉及文件 | 修复建议 |',
    '|------|---------|------|---------|---------|---------|',
    `| CR-001 | BLOCKER | 架构合规性 | 越层依赖，见 ${refs[0]} | \`02-Feature/Wallet/src/main/ets/pages/Home.ets\` | 改走 index.ets |`,
    '| CR-002 | MAJOR | 编码规范 | any 类型 | `02-Feature/Wallet/src/main/ets/pages/Home.ets` | 补类型 |',
    '| CR-003 | MAJOR | 编码规范 | 硬编码 | `02-Feature/Wallet/src/main/ets/pages/Home.ets` | 抽常量 |',
    '',
    '## 四、问题统计', '',
    '| 严重程度 | 数量 |',
    '|---------|------|',
    `| BLOCKER | ${opts.blocker} |`,
    `| MAJOR | ${opts.major} |`,
    '| MINOR | 0 |',
    '| INFO | 0 |',
    `| **合计** | **${opts.statsTotal}** |`,
    '',
    '## 五、修复建议摘要', '',
    opts.prose ?? '本轮共 3 条问题。', '',
    '## 六、结论', '', '**审查结论**: 不通过', '',
  ].join('\n');
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: '统计表与问题清单不一致 → harness 按清单自动回写并 PASS；再次检查一致',
    run: () => {
      const root = mkProject();
      try {
        const target = resolveFeatureArtifact(root, FEATURE, 'review-report.md').canonicalPath;
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, reportMd({ statsTotal: 2, blocker: 1, major: 1 }), 'utf-8');
        const first = __testing_checkStatisticsSummary(ctxOf(root), fs.readFileSync(target, 'utf-8'));
        assert.strictEqual(first[0].status, 'PASS', first[0].details);
        assert.ok(/自动回写/.test(first[0].details), first[0].details);
        const after = fs.readFileSync(target, 'utf-8');
        assert.ok(/\| MAJOR \| 2 \|/.test(after) && /\*\*合计\*\* \| \*\*3\*\*/.test(after), after);
        const second = __testing_checkStatisticsSummary(ctxOf(root), after);
        assert.strictEqual(second[0].status, 'PASS');
        assert.ok(!/自动回写/.test(second[0].details), '一致时不再回写');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: '引用 lint：文件不存在 / 行号超范围 → WARN 列出；正文"共 N 条"与清单不一致 → 提示；全部有效 → PASS',
    run: () => {
      const root = mkProject();
      try {
        const src = path.join(root, '02-Feature/Wallet/src/main/ets/pages/Home.ets');
        fs.mkdirSync(path.dirname(src), { recursive: true });
        fs.writeFileSync(src, Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n'), 'utf-8');
        const bad = __testing_checkReviewReferenceLint(
          ctxOf(root),
          reportMd({ statsTotal: 3, blocker: 1, major: 2, prose: '本轮共 5 条问题。', refs: ['`02-Feature/Wallet/src/main/ets/pages/Home.ets:99`'] })
            + '\n另见 `02-Feature/Wallet/src/main/ets/pages/Missing.ets:3`\n',
        );
        assert.strictEqual(bad[0].status, 'WARN', bad[0].details);
        assert.ok(/Home\.ets:99：行号超出范围/.test(bad[0].details), bad[0].details);
        assert.ok(/Missing\.ets:3：文件不存在/.test(bad[0].details), bad[0].details);
        assert.ok(/共 5 条/.test(bad[0].details), bad[0].details);
        const good = __testing_checkReviewReferenceLint(ctxOf(root), reportMd({ statsTotal: 3, blocker: 1, major: 2 }));
        assert.strictEqual(good[0].status, 'PASS', good[0].details);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
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
