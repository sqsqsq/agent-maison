// ============================================================================
// Markdown 文档解析工具
// ============================================================================
// 为 check-prd.ts / check-design.ts 提供通用 Markdown 解析能力：
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
