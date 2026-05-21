/**
 * Summarize hylyre dump-ui JSON for ad-hoc observation.
 */
import * as fs from 'fs';

export interface AdhocDumpCardRow {
  name: string;
  type_hint: string;
  balance: string;
  id_hint: string;
}

export interface AdhocDumpSummary {
  source: string;
  card_count: number;
  cards: AdhocDumpCardRow[];
}

export function extractCardsFromDumpRaw(raw: string): AdhocDumpCardRow[] {
  const cards: AdhocDumpCardRow[] = [];
  const nameRe = /"(?:text|label|contentDescription)"\s*:\s*"([^"\\]{2,40})"/g;
  const names: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = nameRe.exec(raw)) !== null) {
    const t = m[1].trim();
    if (/卡|通|门禁|余额|添加|管理|首页|返回/.test(t) && t.length >= 2) {
      if (!names.includes(t)) names.push(t);
    }
  }
  const listIndexRe = /listIndex(\d+)|splitCardComp(\d+)/g;
  const idHints: string[] = [];
  while ((m = listIndexRe.exec(raw)) !== null) {
    idHints.push(m[0]);
  }
  const balanceRe = /¥[\d.]+/g;
  const balances: string[] = [];
  while ((m = balanceRe.exec(raw)) !== null) {
    balances.push(m[0]);
  }
  const cardLike = names.filter(
    n =>
      !/添加|管理|首页|返回|立即|非本机|卡片|云端|交通|验证|身份|批量/.test(n) ||
      /通$|门禁/.test(n),
  );
  const filtered = cardLike.length > 0 ? cardLike : names.slice(0, 12);
  for (let i = 0; i < filtered.length; i++) {
    cards.push({
      name: filtered[i],
      type_hint: raw.includes('云端卡') && i < 3 ? '云端卡' : '',
      balance: balances[i] ?? '',
      id_hint: idHints[i] ?? '',
    });
  }
  return cards;
}

export function summarizeAdhocDumpFile(filePath: string): AdhocDumpSummary {
  const abs = filePath;
  const raw = fs.readFileSync(abs, 'utf-8');
  const cards = extractCardsFromDumpRaw(raw);
  return { source: abs, card_count: cards.length, cards };
}

export function formatAdhocDumpSummaryMarkdown(summary: AdhocDumpSummary): string {
  const lines = [
    '| 序号 | 名称 | 类型提示 | 余额 | ID 提示 |',
    '|------|------|----------|------|---------|',
  ];
  summary.cards.forEach((c, i) => {
    lines.push(
      `| ${i + 1} | ${c.name} | ${c.type_hint || '—'} | ${c.balance || '—'} | ${c.id_hint || '—'} |`,
    );
  });
  return `${lines.join('\n')}\n`;
}
