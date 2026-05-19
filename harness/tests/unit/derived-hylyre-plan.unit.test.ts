// ============================================================================
// derived-hylyre-plan.unit.test.ts — SSOT 覆盖 / 占位 / mtime 选派生回归
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  isPlaceholderDerivedPlan,
  evaluateDerivedCoverage,
  selectBestNonPlaceholderDerivedPlan,
  loadExplicitSkipTcIds,
  extractTcIdsFromPlanTable,
} from '../../scripts/utils/derived-hylyre-plan';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}\n    expected: ${e}\n    actual:   ${a}`);
  }
}
function assertTrue(cond: boolean, label: string): void {
  if (!cond) throw new Error(label);
}

const minimalTable = (rows: string) =>
  [
    '## 测试用例清单',
    '',
    '| 用例编号 | 名称 |',
    '|----------|------|',
    rows,
  ].join('\n');

interface Case {
  name: string;
  run: () => void;
}

const cases: Case[] = [
  {
    name: 'isPlaceholderDerivedPlan: 烟测占位 → true',
    run: () => {
      const md = `## x\n> 烟测占位：x\n${minimalTable('| TC-001 | a |')}`;
      assertTrue(isPlaceholderDerivedPlan(md), 'expected placeholder');
    },
  },
  {
    name: 'isPlaceholderDerivedPlan: 正常派生 → false',
    run: () => {
      const md = `# 派生\n${minimalTable('| TC-001 | a |')}`;
      assertTrue(!isPlaceholderDerivedPlan(md), 'expected non-placeholder');
    },
  },
  {
    name: 'evaluateDerivedCoverage: 顶层 3 派生 1 → missing 2',
    run: () => {
      const r = evaluateDerivedCoverage({
        topTcIds: ['TC-001', 'TC-002', 'TC-003'],
        derivedTcIds: ['TC-001'],
        explicitSkipTcIds: [],
      });
      assertEq(r.missing, ['TC-002', 'TC-003'], 'missing');
      assertEq(r.extra, [], 'extra');
      assertTrue(!r.ok, 'ok');
    },
  },
  {
    name: 'evaluateDerivedCoverage: explicit_skip 扣减后无 missing',
    run: () => {
      const r = evaluateDerivedCoverage({
        topTcIds: ['TC-001', 'TC-002'],
        derivedTcIds: ['TC-001'],
        explicitSkipTcIds: ['TC-002'],
      });
      assertEq(r.missing, [], 'missing');
      assertEq(r.extra, [], 'extra');
      assertTrue(r.ok, 'ok');
    },
  },
  {
    name: 'evaluateDerivedCoverage: 派生多出行 → extra',
    run: () => {
      const r = evaluateDerivedCoverage({
        topTcIds: ['TC-001'],
        derivedTcIds: ['TC-001', 'TC-999'],
        explicitSkipTcIds: [],
      });
      assertEq(r.missing, [], 'missing');
      assertEq(r.extra, ['TC-999'], 'extra');
      assertTrue(!r.ok, 'ok');
    },
  },
  {
    name: 'extractTcIdsFromPlanTable + loadExplicitSkip: frontmatter + derive-manifest.json',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hylyre-ssot-'));
      const hylyreDir = path.join(dir, 'run1', 'hylyre');
      fs.mkdirSync(hylyreDir, { recursive: true });
      const planPath = path.join(hylyreDir, 'test-plan.hylyre.md');
      const md = [
        '---',
        'explicit_skip_tc_ids: [TC-002]',
        '---',
        '',
        minimalTable('| TC-001 | a |'),
      ].join('\n');
      fs.writeFileSync(planPath, md, 'utf-8');
      fs.writeFileSync(
        path.join(hylyreDir, 'derive-manifest.json'),
        JSON.stringify({ explicit_skip_tc_ids: ['TC-003', 'tc-003'] }),
        'utf-8',
      );
      const skips = loadExplicitSkipTcIds(planPath, md);
      assertEq(skips.sort(), ['TC-002', 'TC-003'], 'merged skips');
      const ids = extractTcIdsFromPlanTable(md);
      assertEq(ids, ['TC-001'], 'derived ids');
    },
  },
  {
    name: 'selectBestNonPlaceholderDerivedPlan: 占位目录 mtime 更新时先被剔除，再选有效派生',
    run: () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hylyre-mtime-'));
      const oldDir = path.join(base, 'smoke-9999', 'hylyre');
      const newDir = path.join(base, '20260519-a', 'hylyre');
      fs.mkdirSync(oldDir, { recursive: true });
      fs.mkdirSync(newDir, { recursive: true });
      const smokePath = path.join(oldDir, 'test-plan.hylyre.md');
      const goodPath = path.join(newDir, 'test-plan.hylyre.md');
      fs.writeFileSync(
        smokePath,
        `> 烟测占位\n${minimalTable('| TC-001 |')}`,
        'utf-8',
      );
      fs.writeFileSync(goodPath, `${minimalTable('| TC-001 |')}`, 'utf-8');
      const older = Date.now() / 1000 - 4000;
      const newer = Date.now() / 1000 - 1000;
      // 占位目录名字典序常晚于时间戳目录，但若占位 mtime 更「新」会先被读到并剔除
      fs.utimesSync(goodPath, older, older);
      fs.utimesSync(smokePath, newer, newer);
      const pick = selectBestNonPlaceholderDerivedPlan(base);
      assertTrue(pick.selected !== null, 'selected');
      assertEq(path.normalize(pick.selected!.hylyrePath), path.normalize(goodPath), 'path');
      assertEq(pick.rejectedPlaceholders.length, 1, 'placeholder rejected then valid picked');
    },
  },
];

export function runAll(): Promise<UnitCaseResult[]> {
  return Promise.resolve(runSync());
}

function runSync(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({
        name: c.name,
        ok: false,
        error: (e as Error).message,
      });
    }
  }
  return results;
}