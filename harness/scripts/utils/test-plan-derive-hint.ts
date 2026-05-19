/**
 * 从顶层 test-plan.md「测试用例」章节抽取结构化行，供 agent 生成 test-plan.hylyre.md。
 * 被 check-testing（派生缺失 FAIL 时写 derive-hint-from-plan.json）与 derive-hylyre-plan-hint CLI 复用。
 */
import { getSectionContent, extractTables, type MdTable } from './markdown-parser';

export interface DeriveHintTestCaseRow {
  tc_id: string;
  name: string;
  precondition: string;
  steps_natural_language: string;
  expected: string;
  priority: string;
  ac_ref: string;
}

function pickColumnIndex(table: MdTable, keywords: string[]): number {
  for (const kw of keywords) {
    const idx = table.headers.findIndex(h => h.includes(kw));
    if (idx >= 0) return idx;
  }
  return -1;
}

/**
 * 从 test-plan.md 全文解析；若无「测试用例」节或表格则返回空数组。
 */
export function extractTopPlanTestCasesForDeriveHint(planMd: string): DeriveHintTestCaseRow[] {
  const section = getSectionContent(planMd, '测试用例');
  if (!section) return [];
  const tables = extractTables(section);
  if (tables.length === 0) return [];

  const t = tables[0];
  const iId = pickColumnIndex(t, ['用例编号', '编号']);
  const iName = pickColumnIndex(t, ['用例名称', '名称']);
  const iPre = pickColumnIndex(t, ['前置条件']);
  const iSteps = pickColumnIndex(t, ['测试步骤', '步骤']);
  const iExp = pickColumnIndex(t, ['预期结果']);
  const iPri = pickColumnIndex(t, ['优先级']);
  const iAc = pickColumnIndex(t, ['关联 AC', '关联']);

  const out: DeriveHintTestCaseRow[] = [];
  for (const row of t.rows) {
    const tcRaw = (iId >= 0 ? row[iId] : row[0] || '').trim();
    const m = tcRaw.match(/TC-\d+/i);
    if (!m) continue;
    const tc_id = m[0].toUpperCase();
    out.push({
      tc_id,
      name: (iName >= 0 ? row[iName] : '').trim(),
      precondition: (iPre >= 0 ? row[iPre] : '').trim(),
      steps_natural_language: (iSteps >= 0 ? row[iSteps] : '').trim(),
      expected: (iExp >= 0 ? row[iExp] : '').trim(),
      priority: (iPri >= 0 ? row[iPri] : '').trim(),
      ac_ref: (iAc >= 0 ? row[iAc] : '').trim(),
    });
  }
  return out;
}
