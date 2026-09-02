// ============================================================================
// execution-channel.ts — 顶层 test-plan 的编译期执行通道（plan a6c4e9f2 D2 / T3）
// ----------------------------------------------------------------------------
// 事故根因（2026-08-31 bc-openCard-1 首次宿主回灌）：派生 AI 拥有 `explicit_skip_tc_ids`
// 这个自由逃生口——静态门拒绝入口 selector 后，它没有回报"无法编译"，而是把入口 TC
// 从 executable 集合挪进 skip，仍宣称顶层 30 条已覆盖；剩余 case 的前置状态随后全部
// 失真，设备停在首页，14 个执行 case 级联失败。
//
// 修复不是再加一层可达性状态机（那只能在错误发生后拦结果，仍回答不了"这些 case 该
// 由谁执行"），而是把"谁做"从派生器手里拿回给测试作者：顶层 test-plan.md 每条 TC 声明
// 唯一 `execution_channel`，派生器只编译 `hylyre` 集合，不得新增/删除/改写通道，也不
// 再产出新的 explicit skip。
//
// 边界：channel 是**编译期分派声明**，不是执行状态，不构成第二套结果账本。
// ============================================================================

import { getSectionContent, extractTables, type MdTable } from './markdown-parser';

export type ExecutionChannelKind = 'hylyre' | 'visual' | 'manual' | 'provider';

export interface ExecutionChannel {
  kind: ExecutionChannelKind;
  /** kind='provider' 时的 capability id（其余为 undefined） */
  provider_id?: string;
  /** 计划中的原始字面量（用于报错回显与 identity 比对） */
  raw: string;
}

/** 冻结值域文案——报错与模板共用一处，避免两边漂移。 */
export const EXECUTION_CHANNEL_DOMAIN = 'hylyre | visual | manual | provider:<capability-id>';

const PROVIDER_PREFIX = 'provider:';
/** capability id 与既有 capability registry 同形：小写字母/数字/点/下划线/连字符 */
const PROVIDER_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * 解析单个 channel 字面量。非法/缺失一律返回 null——**不猜**：
 * 不按用例名、优先级、步骤散文或能力启发式推断通道。
 */
export function parseExecutionChannel(raw: unknown): ExecutionChannel | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().replace(/^`|`$/g, '').trim();
  if (!value) return null;
  const lowered = value.toLowerCase();
  if (lowered === 'hylyre' || lowered === 'visual' || lowered === 'manual') {
    return { kind: lowered, raw: value };
  }
  if (lowered.startsWith(PROVIDER_PREFIX)) {
    const providerId = value.slice(PROVIDER_PREFIX.length).trim();
    if (PROVIDER_ID_RE.test(providerId)) {
      return { kind: 'provider', provider_id: providerId, raw: value };
    }
  }
  return null;
}

export interface ExecutionChannelRow {
  tc_id: string;
  /** null = 缺失或非法（由 raw 区分：raw 为空即缺失） */
  channel: ExecutionChannel | null;
  raw: string;
}

export interface ExecutionChannelTable {
  /** 顶层「测试用例」表是否**声明了**执行通道列。false = legacy 计划（无列） */
  column_declared: boolean;
  rows: ExecutionChannelRow[];
}

function pickColumnIndex(table: MdTable, keywords: string[]): number {
  for (const kw of keywords) {
    const idx = table.headers.findIndex(h => h.toLowerCase().includes(kw.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return -1;
}

/** 从顶层 test-plan.md「测试用例」首表读取每 TC 的执行通道。 */
export function extractExecutionChannels(planMd: string): ExecutionChannelTable {
  const section = getSectionContent(planMd, '测试用例') ?? getSectionContent(planMd, '测试用例清单') ?? '';
  const tables = extractTables(section || planMd);
  if (tables.length === 0) return { column_declared: false, rows: [] };
  const table = tables[0];
  const idCol = pickColumnIndex(table, ['用例编号', '编号', 'TC-ID', 'TC ID']);
  const channelCol = pickColumnIndex(table, ['执行通道', 'execution_channel', 'execution channel']);
  const rows: ExecutionChannelRow[] = [];
  for (const row of table.rows) {
    const tcRaw = (idCol >= 0 ? row[idCol] : row[0] || '').trim();
    const matched = tcRaw.match(/TC-\d+/i);
    if (!matched) continue;
    const raw = channelCol >= 0 ? (row[channelCol] ?? '').trim() : '';
    rows.push({ tc_id: matched[0].toUpperCase(), raw, channel: parseExecutionChannel(raw) });
  }
  return { column_declared: channelCol >= 0, rows };
}

export interface ExecutionChannelDeclarationResult {
  ok: boolean;
  column_declared: boolean;
  /** 声明了列但该 TC 单元格为空 */
  missing: string[];
  /** 单元格非空但不在冻结值域内 */
  illegal: Array<{ tc_id: string; raw: string }>;
  /**
   * 同一 TC 出现多行。契约是"每 TC **唯一** channel"——重复即使取值相同也无法证明唯一，
   * 取值不同更是把同一个 TC 同时塞进两个通道集合（会让 hylyre 精确对账和分母同时失真）。
   */
  duplicates: Array<{ tc_id: string; raws: string[] }>;
  /** channel=hylyre 的 TC（大写、去重、稳定顺序） */
  hylyre_tc_ids: string[];
  /** channel=manual 的 TC——任一非空即本 feature testing 无法 PASS */
  manual_tc_ids: string[];
  /** channel=visual 的 TC */
  visual_tc_ids: string[];
  /** channel=provider:<id> 的 TC 及其 capability id */
  provider_tc_ids: Array<{ tc_id: string; provider_id: string }>;
  /** 人读迁移/修复指引（ok 时为空串） */
  detail: string;
}

/**
 * 评估一份顶层计划的通道声明。**正式计划**缺列或缺值都是一次性迁移要求（FAIL），
 * 不按测试文字启发式猜执行器；legacy（无列）计划由调用方决定是否只读兼容。
 */
export function evaluateExecutionChannelDeclaration(planMd: string): ExecutionChannelDeclarationResult {
  const table = extractExecutionChannels(planMd);
  const missing: string[] = [];
  const illegal: Array<{ tc_id: string; raw: string }> = [];
  const hylyre: string[] = [];
  const manual: string[] = [];
  const visual: string[] = [];
  const provider: Array<{ tc_id: string; provider_id: string }> = [];

  // 「每 TC 唯一 channel」先于逐行取值判定：重复行必须整体拒绝，绝不能让同一个 TC
  // 同时进入两个通道集合（那会让 hylyre 精确对账与报告分母同时失真）。
  const rowsByTc = new Map<string, string[]>();
  for (const row of table.rows) {
    rowsByTc.set(row.tc_id, [...(rowsByTc.get(row.tc_id) ?? []), row.raw]);
  }
  const duplicates = [...rowsByTc.entries()]
    .filter(([, raws]) => raws.length > 1)
    .map(([tc_id, raws]) => ({ tc_id, raws }))
    .sort((a, b) => a.tc_id.localeCompare(b.tc_id));

  for (const row of table.rows) {
    if (rowsByTc.get(row.tc_id)!.length > 1) continue; // 重复 TC 不进任何通道集合

    if (!row.raw) {
      missing.push(row.tc_id);
      continue;
    }
    if (!row.channel) {
      illegal.push({ tc_id: row.tc_id, raw: row.raw });
      continue;
    }
    if (row.channel.kind === 'hylyre') hylyre.push(row.tc_id);
    else if (row.channel.kind === 'manual') manual.push(row.tc_id);
    else if (row.channel.kind === 'visual') visual.push(row.tc_id);
    else provider.push({ tc_id: row.tc_id, provider_id: row.channel.provider_id! });
  }
  const lines: string[] = [];
  if (!table.column_declared) {
    lines.push(
      `顶层 test-plan.md「测试用例」表缺「执行通道」列：每条 TC 必须声明唯一 execution_channel（${EXECUTION_CHANNEL_DOMAIN}）。`,
      '这是一次性迁移：由测试计划作者按用例实际取证方式填写并进入 plan review；harness 不按用例名/优先级/步骤散文替你猜通道。',
    );
  } else {
    if (missing.length > 0) {
      lines.push(`以下 TC 未声明 execution_channel：${missing.join(', ')}（值域：${EXECUTION_CHANNEL_DOMAIN}）`);
    }
    for (const item of illegal) {
      lines.push(`${item.tc_id} 的 execution_channel=${JSON.stringify(item.raw)} 不在冻结值域内（${EXECUTION_CHANNEL_DOMAIN}）`);
    }
  }
  for (const item of duplicates) {
    lines.push(
      `${item.tc_id} 在测试用例表中出现 ${item.raws.length} 次（execution_channel=${item.raws.map(r => JSON.stringify(r)).join(' / ')}）：` +
      '每条 TC 只能声明唯一执行通道，重复行一律拒绝——即使取值相同也无法证明唯一。请合并为一行。',
    );
  }
  if (manual.length > 0) {
    lines.push(
      `注意：${manual.join(', ')} 声明为 manual——manual 当前没有机器质量 PASS 载体，` +
      '这些 TC 会持续留在分母并保持 FAIL/UNVERIFIED，本 feature 的 testing 因此无法 PASS。这是冻结设计，不是执行器缺陷。',
    );
  }
  return {
    ok: table.column_declared && missing.length === 0 && illegal.length === 0 && duplicates.length === 0,
    column_declared: table.column_declared,
    missing,
    illegal,
    duplicates,
    hylyre_tc_ids: [...new Set(hylyre)].sort(),
    manual_tc_ids: [...new Set(manual)].sort(),
    visual_tc_ids: [...new Set(visual)].sort(),
    provider_tc_ids: provider,
    detail: lines.join('\n'),
  };
}
