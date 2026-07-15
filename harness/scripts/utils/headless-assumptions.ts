// ============================================================================
// headless-assumptions.ts — goal 无头自动决议账本（goal-fakepass-hardening t1）
// ============================================================================
// 事故背景：goal-report 的 must-review 收集用行内 `must-review: 是` 正则，agent 实写
// markdown 表格（testing 表甚至无该列）→ 0 匹配 → "待人工复核"整节静默不渲染，用户
// 只见干净 PASS（bc-openCard 洞⑤）。
//
// 本模块（openspec goal-runner/harness-gates delta）：
//   - SSOT 改为 <phase>/headless-assumptions.jsonl（每行一条决议，schema 校验）；
//     markdown 降级为人读投影；
//   - registry 完整性交叉核验：confirmation-registry.yaml 中 id 前缀=该 phase 的
//     in-phase gate，账本必须逐一有 decision 或显式 n/a 行；registry 外自由决策
//     诚实不可证（由 t2/t3/t4 确定性门禁兜底）；
//   - legacy md 兼容读取（保守策略：无法辨识 must-review 语义的表格行**全量**计入
//     待复核——宁可多报）；
//   - 账本仅留痕：任何 hard-gate-lowering 授权走 confirmation receipt（t10），
//     账本记录不构成授权。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';

import { featureFilePath, type FeaturePathOptions } from '../../config';

export const HEADLESS_ASSUMPTIONS_JSONL = 'headless-assumptions.jsonl';
export const HEADLESS_ASSUMPTIONS_MD = 'headless-assumptions.md';
export const HEADLESS_LEDGER_SCHEMA_VERSION = '1.0';

export interface HeadlessDecisionEntry {
  decision_id: string;
  run_id: string;
  phase: string;
  gate_id: string;
  class: string;
  /** 决议内容；registry gate 无需决议时写 "n/a: <理由>" */
  decision: string;
  must_review: boolean;
  /** 恒 "agent"（goal 无头下的诚实来源标注；runner 侧产生的条目标 "goal-runner"） */
  source: string;
  ts: string;
}

const REQUIRED_KEYS: Array<keyof HeadlessDecisionEntry> = [
  'decision_id', 'run_id', 'phase', 'gate_id', 'class', 'decision', 'must_review', 'source', 'ts',
];

export interface LedgerParseResult {
  entries: HeadlessDecisionEntry[];
  /** 行号（1 起）→ 错误描述；非空即 schema 校验失败 */
  errors: Array<{ line: number; error: string }>;
}

export const LEDGER_SOURCE_VALUES = new Set(['agent', 'goal-runner']);

export interface LedgerParseOptions {
  /** 账本所在 phase（条目 phase 失配即错误——防串目录复用） */
  expectedPhase?: string;
  /** 当前 run（条目 run_id 失配即错误——防旧 run 账本冒充） */
  expectedRunId?: string;
}

export function parseHeadlessAssumptionsJsonl(
  content: string,
  opts?: LedgerParseOptions,
): LedgerParseResult {
  const entries: HeadlessDecisionEntry[] = [];
  const errors: Array<{ line: number; error: string }> = [];
  const seenDecisionIds = new Set<string>();
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      errors.push({ line: i + 1, error: `JSON 解析失败：${(err as Error).message}` });
      continue;
    }
    const missing = REQUIRED_KEYS.filter((k) => obj[k] === undefined || obj[k] === null);
    if (missing.length > 0) {
      errors.push({ line: i + 1, error: `缺字段：${missing.join(', ')}` });
      continue;
    }
    if (typeof obj.must_review !== 'boolean') {
      errors.push({ line: i + 1, error: 'must_review 必须为 boolean' });
      continue;
    }
    const strKeys = REQUIRED_KEYS.filter((k) => k !== 'must_review');
    const badStr = strKeys.filter((k) => typeof obj[k] !== 'string' || (obj[k] as string).trim() === '');
    if (badStr.length > 0) {
      errors.push({ line: i + 1, error: `字段须为非空字符串：${badStr.join(', ')}` });
      continue;
    }
    const entry = obj as unknown as HeadlessDecisionEntry;
    if (!LEDGER_SOURCE_VALUES.has(entry.source)) {
      errors.push({ line: i + 1, error: `source 非法：${entry.source}（合法：agent|goal-runner）` });
      continue;
    }
    if (Number.isNaN(Date.parse(entry.ts))) {
      errors.push({ line: i + 1, error: `ts 非法（须可解析时间戳）：${entry.ts}` });
      continue;
    }
    if (seenDecisionIds.has(entry.decision_id)) {
      errors.push({ line: i + 1, error: `decision_id 重复：${entry.decision_id}` });
      continue;
    }
    if (opts?.expectedPhase && entry.phase !== opts.expectedPhase) {
      errors.push({ line: i + 1, error: `phase 失配：${entry.phase} ≠ ${opts.expectedPhase}` });
      continue;
    }
    if (opts?.expectedRunId && entry.run_id !== opts.expectedRunId) {
      errors.push({ line: i + 1, error: `run_id 失配：${entry.run_id} ≠ ${opts.expectedRunId}` });
      continue;
    }
    seenDecisionIds.add(entry.decision_id);
    entries.push(entry);
  }
  return { entries, errors };
}

export function headlessLedgerPath(
  projectRoot: string,
  feature: string,
  phase: string,
  opts?: FeaturePathOptions,
): string {
  return featureFilePath(projectRoot, feature, path.join(phase, HEADLESS_ASSUMPTIONS_JSONL), opts);
}

export function loadHeadlessLedger(
  projectRoot: string,
  feature: string,
  phase: string,
  opts?: FeaturePathOptions,
): LedgerParseResult | null {
  const p = headlessLedgerPath(projectRoot, feature, phase, opts);
  if (!fs.existsSync(p)) return null;
  return parseHeadlessAssumptionsJsonl(fs.readFileSync(p, 'utf-8'));
}

// ----------------------------------------------------------------------------
// registry 交叉核验
// ----------------------------------------------------------------------------

export interface RegistryGateIdsResult {
  /** registry 文件可读且解析成功——false 时消费方必须 fail-closed（codex 五轮 P1：
   * 读失败静默零 gate = crossCheck 恒 ok，与"完整性核验"目标相反） */
  readable: boolean;
  ids: string[];
}

/**
 * confirmation-registry.yaml 中属于该 phase 的 in-phase gate id（id 前缀约定
 * `<phase>.`；虚拟 `_cross_phase`（phase.next_step 等）由 runner 编排，不入本核验）。
 */
export function registryGateIdsForPhase(registryYamlPath: string, phase: string): RegistryGateIdsResult {
  if (!fs.existsSync(registryYamlPath)) return { readable: false, ids: [] };
  try {
    const doc = YAML.parse(fs.readFileSync(registryYamlPath, 'utf-8')) as {
      entries?: Array<{ id?: string; skill?: string }>;
    };
    if (!doc || !Array.isArray(doc.entries)) return { readable: false, ids: [] };
    return {
      readable: true,
      ids: doc.entries
        .map((e) => e.id)
        .filter((id): id is string => typeof id === 'string' && id.startsWith(`${phase}.`))
        .sort(),
    };
  } catch {
    return { readable: false, ids: [] };
  }
}

export interface RegistryCrossCheckResult {
  ok: boolean;
  missing_gate_ids: string[];
}

/** registry 有而账本无（decision 或显式 n/a）→ missing；registry 外条目合法（自由决策留痕） */
export function crossCheckLedgerAgainstRegistry(
  entries: HeadlessDecisionEntry[],
  registryGateIds: string[],
): RegistryCrossCheckResult {
  const covered = new Set(entries.map((e) => e.gate_id));
  const missing = registryGateIds.filter((id) => !covered.has(id));
  return { ok: missing.length === 0, missing_gate_ids: missing };
}

// ----------------------------------------------------------------------------
// legacy markdown 兼容读取（投影/旧现场）
// ----------------------------------------------------------------------------

export interface LegacyDecisionItem {
  phase: string;
  summary: string;
  must_review: boolean;
}

const MUST_REVIEW_TRUE = /^(是|true|yes|y)$/i;
const MUST_REVIEW_FALSE = /^(否|false|no|n)$/i;

/**
 * 解析 legacy markdown：表格逐数据行成条目——表头含 must-review 列则按列值过滤，
 * **无该列的表格保守全量计入待复核**（事故 testing 表形态）；行内 `must-review: 是`
 * 亦兼容。文件非空但 0 条解析 → 合成一条兜底条目（"存在未解析留痕"）。
 */
export function parseLegacyAssumptionsMd(content: string, phase: string): LegacyDecisionItem[] {
  const items: LegacyDecisionItem[] = [];
  const lines = content.split(/\r?\n/);

  let headerCols: string[] | null = null;
  let mustReviewCol = -1;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('|')) {
      headerCols = null;
      mustReviewCol = -1;
      // 行内格式兼容
      if (/\bmust-review\s*:\s*(true|yes|是)\b/i.test(line)) {
        items.push({ phase, summary: line.replace(/^[-*]\s*/, ''), must_review: true });
      }
      continue;
    }
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length === 0) continue;
    if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) continue; // 分隔行
    if (headerCols === null) {
      headerCols = cells;
      mustReviewCol = cells.findIndex((c) => /must-?review/i.test(c));
      continue;
    }
    const summary = cells.filter(Boolean).join(' | ');
    if (!summary) continue;
    if (mustReviewCol >= 0 && mustReviewCol < cells.length) {
      const v = cells[mustReviewCol];
      if (MUST_REVIEW_FALSE.test(v)) continue; // 明示"否"才排除
      items.push({ phase, summary, must_review: MUST_REVIEW_TRUE.test(v) || true });
    } else {
      // 无 must-review 列 → 保守全量计入
      items.push({ phase, summary, must_review: true });
    }
  }

  if (items.length === 0 && content.trim().length > 0) {
    items.push({
      phase,
      summary: '存在未解析的自动决议留痕（格式不可辨识），请人工查看原文件',
      must_review: true,
    });
  }
  return items;
}

// ----------------------------------------------------------------------------
// 汇总视图（goal-report 消费）
// ----------------------------------------------------------------------------

export interface AutoDecisionSummaryItem {
  phase: string;
  summary: string;
  must_review: boolean;
  source: 'jsonl' | 'legacy_md';
}

/** 逐 phase 收集：优先 JSONL；无 JSONL 才读 legacy md（不双计） */
export function collectAutoDecisions(
  projectRoot: string,
  feature: string,
  phases: string[],
  opts?: FeaturePathOptions,
): AutoDecisionSummaryItem[] {
  const out: AutoDecisionSummaryItem[] = [];
  for (const phase of phases) {
    const ledger = loadHeadlessLedger(projectRoot, feature, phase, opts);
    if (ledger) {
      for (const e of ledger.entries) {
        out.push({
          phase,
          summary: `${e.gate_id}: ${e.decision}`,
          must_review: e.must_review,
          source: 'jsonl',
        });
      }
      if (ledger.errors.length > 0) {
        out.push({
          phase,
          summary: `账本存在 ${ledger.errors.length} 行非法记录（schema 校验失败），请人工查看`,
          must_review: true,
          source: 'jsonl',
        });
      }
      continue;
    }
    const mdPath = featureFilePath(projectRoot, feature, path.join(phase, HEADLESS_ASSUMPTIONS_MD), opts);
    if (fs.existsSync(mdPath)) {
      for (const item of parseLegacyAssumptionsMd(fs.readFileSync(mdPath, 'utf-8'), phase)) {
        out.push({ ...item, source: 'legacy_md' });
      }
    }
  }
  return out;
}

export function countPendingMustReview(items: AutoDecisionSummaryItem[]): number {
  return items.filter((i) => i.must_review).length;
}

// ----------------------------------------------------------------------------
// 闭环消费（check-receipt goal 环境 BLOCKER 门禁）
// ----------------------------------------------------------------------------

export function registryYamlPath(frameworkRoot: string): string {
  return path.join(frameworkRoot, 'skills', 'reference', 'confirmation-registry.yaml');
}

export interface LedgerClosureValidation {
  ok: boolean;
  errors: string[];
}

/**
 * goal 无头闭环时的账本门禁（openspec harness-gates delta）：
 * ①JSONL 存在且 schema 全合法（phase 目录一致性强校验）；
 * ②registry 可读（不可读=fail-closed，不得静默零 gate）；
 * ③registry 该 phase 全部 in-phase gate 在账本有行（decision 或显式 n/a）。
 */
export function validateLedgerForClosure(
  projectRoot: string,
  frameworkRoot: string,
  feature: string,
  phase: string,
  opts?: FeaturePathOptions & { expectedRunId?: string },
): LedgerClosureValidation {
  const errors: string[] = [];
  const ledgerAbs = headlessLedgerPath(projectRoot, feature, phase, opts);
  if (!fs.existsSync(ledgerAbs)) {
    return {
      ok: false,
      errors: [
        `缺 ${HEADLESS_ASSUMPTIONS_JSONL}（goal 无头闭环强制；markdown 仅为人读投影）：${ledgerAbs}`,
      ],
    };
  }
  const parsed = parseHeadlessAssumptionsJsonl(fs.readFileSync(ledgerAbs, 'utf-8'), {
    expectedPhase: phase,
    expectedRunId: opts?.expectedRunId,
  });
  for (const e of parsed.errors) errors.push(`账本第 ${e.line} 行非法：${e.error}`);

  const reg = registryGateIdsForPhase(registryYamlPath(frameworkRoot), phase);
  if (!reg.readable) {
    errors.push('confirmation-registry.yaml 不可读/解析失败——fail-closed，不得按零 gate 放行');
  } else {
    const cross = crossCheckLedgerAgainstRegistry(parsed.entries, reg.ids);
    for (const id of cross.missing_gate_ids) {
      errors.push(`registry gate 无账本记录（须 decision 或显式 n/a·理由）：${id}`);
    }
  }
  return { ok: errors.length === 0, errors };
}
