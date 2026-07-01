// ============================================================================
// Markdown 文档解析工具
// ============================================================================
// 为 check-spec.ts / check-plan.ts 提供通用 Markdown 解析能力：
//   - 提取 heading、table、code block、blockquote metadata
//   - 按 heading 切分 section 内容
// ============================================================================

// --------------------------------------------------------------------------
// 类型定义
// --------------------------------------------------------------------------

export interface MdHeading {
  level: number;
  text: string;
  lineNumber: number;
}

export interface MdTable {
  headers: string[];
  rows: string[][];
  lineNumber: number;
}

export interface MdCodeBlock {
  language: string;
  content: string;
  lineNumber: number;
}

// --------------------------------------------------------------------------
// Heading 解析
// --------------------------------------------------------------------------

export function extractHeadings(content: string): MdHeading[] {
  const lines = content.split(/\r?\n/);
  const headings: MdHeading[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i].trimStart())) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
        lineNumber: i + 1,
      });
    }
  }
  return headings;
}

// --------------------------------------------------------------------------
// Section 提取
// --------------------------------------------------------------------------

/**
 * 返回第一个 text 包含 `headingText` 的 heading 下的所有内容
 * （含子 heading），直到遇到同级或更高级 heading 为止。
 */
export function getSectionContent(content: string, headingText: string): string | null {
  const lines = content.split(/\r?\n/);
  let startLine = -1;
  let startLevel = 0;
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i].trimStart())) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (match && match[2].includes(headingText)) {
      startLine = i;
      startLevel = match[1].length;
      break;
    }
  }

  if (startLine === -1) return null;

  inCodeBlock = false;
  let endLine = lines.length;
  for (let i = startLine + 1; i < lines.length; i++) {
    if (/^```/.test(lines[i].trimStart())) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = lines[i].match(/^(#{1,6})\s+/);
    if (match && match[1].length <= startLevel) {
      endLine = i;
      break;
    }
  }

  return lines.slice(startLine + 1, endLine).join('\n');
}

/**
 * 获取某 section 下的直接子 heading 列表（level 最小的那一批）。
 */
export function getSubsectionHeadings(content: string, headingText: string): MdHeading[] {
  const sectionContent = getSectionContent(content, headingText);
  if (!sectionContent) return [];

  const allHeadings = extractHeadings(sectionContent);
  if (allHeadings.length === 0) return [];

  const minLevel = Math.min(...allHeadings.map(h => h.level));
  return allHeadings.filter(h => h.level === minLevel);
}

// --------------------------------------------------------------------------
// Table 解析
// --------------------------------------------------------------------------

export function extractTables(content: string): MdTable[] {
  const lines = content.split(/\r?\n/);
  const tables: MdTable[] = [];
  let inCodeBlock = false;

  let i = 0;
  while (i < lines.length) {
    if (/^```/.test(lines[i].trimStart())) {
      inCodeBlock = !inCodeBlock;
      i++;
      continue;
    }
    if (inCodeBlock) { i++; continue; }

    if (
      lines[i].includes('|') &&
      i + 1 < lines.length &&
      /^\s*\|[\s\-|:]+\|\s*$/.test(lines[i + 1])
    ) {
      const headerCells = parsePipeRow(lines[i]);
      if (headerCells.length > 0) {
        const rows: string[][] = [];
        let j = i + 2;
        while (j < lines.length) {
          if (/^```/.test(lines[j].trimStart())) break;
          const cells = parsePipeRow(lines[j]);
          if (cells.length === 0) break;
          rows.push(cells);
          j++;
        }
        tables.push({ headers: headerCells, rows, lineNumber: i + 1 });
        i = j;
        continue;
      }
    }
    i++;
  }

  return tables;
}

/**
 * 检查表格是否包含所有必需列（使用 contains 匹配）。
 * requiredColumns 中可用 `"colA" or "colB"` 表示 OR 关系。
 */
export function tableHasColumns(
  table: MdTable,
  requiredColumns: string[],
): { hasAll: boolean; missing: string[] } {
  const missing: string[] = [];

  for (const req of requiredColumns) {
    const alternatives = req.split(' or ').map(s => s.replace(/"/g, '').trim());
    const found = table.headers.some(h =>
      alternatives.some(alt => h.includes(alt)),
    );
    if (!found) missing.push(req);
  }

  return { hasAll: missing.length === 0, missing };
}

/**
 * 根据列名获取表格中该列的所有值。
 */
export function getColumnValues(table: MdTable, columnName: string): string[] {
  const colIndex = table.headers.findIndex(h => h.includes(columnName));
  if (colIndex === -1) return [];
  return table.rows.map(row => (row[colIndex] || '').trim());
}

function parsePipeRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return [];
  const inner = trimmed.slice(1, -1);
  return inner.split('|').map(cell => cell.trim());
}

// --------------------------------------------------------------------------
// Code Block 解析
// --------------------------------------------------------------------------

/**
 * 提取 fenced code block，可按 language 过滤。
 */
export function extractCodeBlocks(content: string, language?: string): MdCodeBlock[] {
  const lines = content.split(/\r?\n/);
  const blocks: MdCodeBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const openMatch = lines[i].match(/^```(\w*)\s*$/);
    if (openMatch) {
      const lang = openMatch[1] || '';
      const startLine = i + 1;
      let endLine = -1;
      for (let j = startLine; j < lines.length; j++) {
        if (/^```\s*$/.test(lines[j])) {
          endLine = j;
          break;
        }
      }
      if (endLine > startLine) {
        if (!language || lang.toLowerCase() === language.toLowerCase()) {
          blocks.push({
            language: lang,
            content: lines.slice(startLine, endLine).join('\n'),
            lineNumber: i + 1,
          });
        }
        i = endLine + 1;
        continue;
      }
    }
    i++;
  }

  return blocks;
}

// --------------------------------------------------------------------------
// 声明式裁决提取（review/testing 结论唯一允许入口）
// --------------------------------------------------------------------------

export interface DeclaredVerdict {
  /** 命中的裁决词；无可机读声明行时为 null。 */
  verdict: string | null;
  /** 命中的声明行原文（调试/details 用）。 */
  matchedLine?: string;
}

// 声明 label 按特异度分级：先专名，回落「结论」，最后才兜底「判定」。
const VERDICT_LABEL_TIERS: string[][] = [
  ['审查结论', '测试结论', '结论判定'],
  ['结论'],
  ['判定'],
];
// 兜底层「判定」必须排除的诱饵 label——否则会误锚到「判定依据/判定规则」等散文行。
const VERDICT_LABEL_DECOYS = ['判定依据', '判定规则', '判定标准', '判定方法'];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 行内是否存在 `label：` / `label:` 标签。
 * 容忍 label 与冒号之间的 markdown 强调标记/反引号/空白，
 * 如 `**审查结论**:`、`__测试结论__：`、`` `结论` : ``。
 */
function lineHasLabel(line: string, label: string): boolean {
  return new RegExp(`${escapeRegExp(label)}[\\s*_\`]*[:：]`).test(line);
}

/**
 * 统计一行里出现的**不同**裁决词（正确扣除子串包含：'不通过' 内的 '通过' 不另算）。
 * 算法：最长优先逐个消费并移除该次出现，直到无可消费。
 * 用于歧义拒绝——未填充模板声明行（如 `通过 / 有条件通过 / 不通过`）会含多个 → 视为缺失。
 */
function distinctVerdictsInLine(line: string, verdictsLongestFirst: string[]): Set<string> {
  let rest = line;
  const found = new Set<string>();
  let consumed = true;
  while (consumed) {
    consumed = false;
    for (const v of verdictsLongestFirst) {
      const idx = rest.indexOf(v);
      if (idx >= 0) {
        found.add(v);
        rest = rest.slice(0, idx) + rest.slice(idx + v.length);
        consumed = true;
        break;
      }
    }
  }
  return found;
}

/**
 * 从「结论」段落提取声明式裁决，鲁棒到子串包含与散文污染。
 *
 * 为何不能用 `verdicts.find(v => section.includes(v))`：
 *   '通过' 是 '不通过'/'有条件通过' 的子串、'达标' 是 '不达标'/'有条件达标' 的子串，
 *   且报告模板的「判定依据」「下一步建议」会枚举全部裁决词，整段 includes 必命中
 *   最短/最先子串 → 恒误读。详见 plan c3f08a21 / 视觉裁判自报根因硬学习。
 *
 * 策略（四条缺一不可，勿退化为只 reorder 数组）：
 *   1. 锚定「声明行」：行内含裁决 label（紧邻冒号）；label 按特异度分级，
 *      兜底「判定」显式排除「判定依据/判定规则」诱饵。
 *   2. **歧义拒绝**：声明行须恰好命中一个裁决词；命中多个（如未填充模板
 *      `通过 / 有条件通过 / 不通过`）视为歧义/缺失，跳过该行——避免"忘了填"被静默读成"有条件通过"。
 *   3. 单一命中即采纳（已最长优先扣除子串包含）。
 *   4. 找不到唯一裁决声明行 → verdict=null（调用方判 FAIL，要求补可机读裁决行）。
 */
export function extractDeclaredVerdict(
  section: string,
  verdictsLongestFirst: string[],
): DeclaredVerdict {
  const verdicts = [...verdictsLongestFirst].sort((a, b) => b.length - a.length);
  const lines = section.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  for (let tier = 0; tier < VERDICT_LABEL_TIERS.length; tier++) {
    const isCompatTier = tier === VERDICT_LABEL_TIERS.length - 1;
    for (const line of lines) {
      // 兜底层排除诱饵 label，避免「判定依据:…(则不通过)」被误锚。
      if (isCompatTier && VERDICT_LABEL_DECOYS.some(d => lineHasLabel(line, d))) continue;
      if (!VERDICT_LABEL_TIERS[tier].some(l => lineHasLabel(line, l))) continue;
      const distinct = distinctVerdictsInLine(line, verdicts);
      if (distinct.size === 1) {
        return { verdict: [...distinct][0], matchedLine: line };
      }
      // 0 或 ≥2（歧义/未填充）→ 跳过此声明行，继续找唯一裁决行。
    }
  }
  return { verdict: null };
}

// --------------------------------------------------------------------------
// Metadata 解析
// --------------------------------------------------------------------------

/**
 * 提取文档头部的 blockquote 元数据。
 * 格式：`> **Key**: value` 或 `> **Key**：value`
 */
export function extractMetadata(content: string): Record<string, string> {
  const lines = content.split(/\r?\n/);
  const metadata: Record<string, string> = {};

  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const match = lines[i].match(/^>\s*\*\*(.+?)\*\*\s*[:：]\s*(.+)/);
    if (match) {
      metadata[match[1].trim()] = match[2].replace(/`/g, '').trim();
    }
  }

  return metadata;
}
