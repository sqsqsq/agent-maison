// ============================================================================
// execution-key.ts — 真机执行键与同键复用 / 稳定性统计（plan 07a41ec6 T6 /
// openspec efficiency-first-closure「Device execution is keyed by real execution inputs」
// 「Stability is computed per execution key and includes failed attempts」）
// ----------------------------------------------------------------------------
// 宿主 2026-09-02 回归：10 轮真机里后 7 轮派生计划字节相同、6 轮同一 HAP，全是为对齐报告
// 与 run 身份重跑。执行键 = 真实执行输入（HAP 摘要 + 注入后派生计划 + 设备/显示环境 +
// 复位方式 + 工具链版本 + flags）；同键最近一次 eligible 成功 run 可直接复用（只重算报告与
// 门禁），更晚失败不被更早成功覆盖，用户要 fresh / N 轮稳定性用 --force-device 真跑。
// 每个 run 目录落一份 execution-key.json；稳定性按同键分组、含失败轮，写 reports/stability.json。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { parseHylyreTrace, type HylyreTrace } from './providers/device-test-run';

export const EXECUTION_KEY_FILE = 'execution-key.json';
export const STABILITY_FILE = 'stability.json';

export interface ExecutionKeyInputs {
  hap_sha256_full: string | null;
  /** run 副本（注入后）派生计划内容摘要 */
  derived_plan_sha256: string;
  /** 设备身份（HARNESS_HDC_TARGET / 序列号）；未知为 null */
  device: string | null;
  /** 当前可得的系统/显示环境描述（可为空串） */
  display_env: string;
  /** cold_restart / warm */
  reset_mode: string;
  hylyre_version: string | null;
  manifest_version: string | null;
  profile: string;
  tool_config_sha256: string;
  flags: string[];
}

export interface ExecutionKeyRecord {
  schema_version: '1.0';
  execution_key: string;
  inputs: ExecutionKeyInputs;
  /** hylyre leg：Hylyre trace 绝对路径；UT leg 无 trace，恒空串（执行事实由冻结件组担保） */
  trace_path: string;
  run_started_at: string;
  outcome: string;
  trace_sha256: string | null;
  /**
   * 「派生证据完整」。两个 leg 含义不同（plan 5e1c7a93 D2「放弃的准确性」①）：
   * hylyre leg = timing 覆盖全部 case；UT leg = 全部选中模块的结果与 hdc 日志已逐模块冻结。
   * 沿用旧名以免动 testing 侧 schema 与消费者。
   */
  timing_complete: boolean;
  /** codex review：本 run 冻结的顶层 timing/meta 副本（run 目录内文件名）；复用时回填顶层，避免旧 trace + 新 meta 拼装 */
  frozen_files?: string[];
}

/**
 * 顶层共享文件 → run 目录内冻结副本名。
 * plan 5e1c7a93 D3：`group` 区分**执行事实**（trace / run meta / UT 逐模块结果与 hdc 日志，
 * 缺任一即拒绝复用）与**派生统计**（timing 等，缺失走重建通道，不逼真机重跑）。
 */
export type FrozenArtifactGroup = 'execution' | 'derived';
export interface FrozenArtifactSpec {
  top: string;
  frozen: string;
  group: FrozenArtifactGroup;
}

export const FROZEN_RUN_ARTIFACTS: ReadonlyArray<FrozenArtifactSpec> = [
  { top: 'device-test-timing.json', frozen: 'frozen.device-test-timing.json', group: 'derived' },
  { top: 'device-test-run.meta.json', frozen: 'frozen.device-test-run.meta.json', group: 'execution' },
];

/** plan 5e1c7a93 D2：UT leg 的冻结件按模块展开（整轮键 + 逐模块冻结件）。 */
export function utFrozenRunArtifacts(modules: readonly string[]): FrozenArtifactSpec[] {
  return [...modules].sort().flatMap(m => [
    { top: `ut-result.${m}.json`, frozen: `frozen.ut-result.${m}.json`, group: 'execution' as const },
    { top: `hdc-test.${m}.log`, frozen: `frozen.hdc-test.${m}.log`, group: 'execution' as const },
  ]);
}

/** 把本 run 的顶层 timing/meta 冻结进 run 目录；返回冻结成功的文件名。 */
export function freezeRunArtifacts(
  reportsDir: string,
  runDir: string,
  artifacts: ReadonlyArray<FrozenArtifactSpec> = FROZEN_RUN_ARTIFACTS,
): string[] {
  const out: string[] = [];
  for (const f of artifacts) {
    const src = path.join(reportsDir, f.top);
    if (!fs.existsSync(src)) continue;
    try {
      fs.copyFileSync(src, path.join(runDir, f.frozen));
      out.push(f.frozen);
    } catch {
      /* 冻结失败 = 该 run 不可复用（decideReuse 会拒绝） */
    }
  }
  return out;
}

/** 复用同键 run 时把它冻结的 timing/meta 回填到顶层（报告与门禁读顶层）。 */
export function restoreFrozenRunArtifacts(
  runDir: string,
  reportsDir: string,
  artifacts: ReadonlyArray<FrozenArtifactSpec> = FROZEN_RUN_ARTIFACTS,
): string[] {
  const restored: string[] = [];
  for (const f of artifacts) {
    const src = path.join(runDir, f.frozen);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, path.join(reportsDir, f.top));
    restored.push(f.top);
  }
  return restored;
}

export function sha256Text(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map(k => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function computeExecutionKey(inputs: ExecutionKeyInputs): string {
  return sha256Text(stableStringify({ ...inputs, flags: [...inputs.flags].sort() }));
}

/**
 * 记录写出必须是**原子替换**（codex review 第 1 轮 #3）。原地 writeFileSync 会先截断：
 * 失败轮覆盖前置 `started` 记录时若写失败，盘上留下空文件 / 半份 JSON，
 * `listExecutionKeyRuns` 把它当损坏记录跳过 → 最新一条又变成**更早的成功** → 洗绿。
 * 同目录临时文件 + rename：写失败时盘上仍是完整的前置记录，下一轮据它拒绝复用。
 */
export function writeExecutionKeyRecord(runDir: string, record: ExecutionKeyRecord): void {
  fs.mkdirSync(runDir, { recursive: true });
  const target = path.join(runDir, EXECUTION_KEY_FILE);
  const tmp = path.join(runDir, `.${EXECUTION_KEY_FILE}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf-8');
    fs.renameSync(tmp, target);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* 临时件已不在 */ }
    throw e;
  }
}

export interface ExecutionKeyRunView {
  runDir: string;
  record: ExecutionKeyRecord;
  /** 目录时间戳（run-directory-freshness 的 <timestamp>/hylyre）——新旧顺序的唯一依据 */
  dirStamp: string;
}

/** plan 5e1c7a93 D2：run 目录段名——testing 侧恒 'hylyre'，UT 侧 'ut'。 */
export type ExecutionKeyLeg = 'hylyre' | 'ut';

/** 扫描 <reportsBase>/<stamp>/<leg>/execution-key.json，按目录 stamp 降序（最新在前）。 */
export function listExecutionKeyRuns(reportsBase: string, leg: ExecutionKeyLeg = 'hylyre'): ExecutionKeyRunView[] {
  const out: ExecutionKeyRunView[] = [];
  if (!fs.existsSync(reportsBase)) return out;
  for (const ent of fs.readdirSync(reportsBase, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const runDir = path.join(reportsBase, ent.name, leg);
    const p = path.join(runDir, EXECUTION_KEY_FILE);
    if (!fs.existsSync(p)) continue;
    try {
      const record = JSON.parse(fs.readFileSync(p, 'utf-8')) as ExecutionKeyRecord;
      if (record && typeof record.execution_key === 'string') out.push({ runDir, record, dirStamp: ent.name });
    } catch {
      /* 损坏记录不参与复用 */
    }
  }
  return out.sort((a, b) => (a.dirStamp < b.dirStamp ? 1 : a.dirStamp > b.dirStamp ? -1 : 0));
}

export interface ReuseDecision {
  reusable: ExecutionKeyRunView | null;
  reason: string;
  /**
   * plan 5e1c7a93 D3：可复用但**派生证据**（timing 等）不全——调用方回填后先重建，
   * 重建仍不闭合则 fail-closed 回落真跑。执行事实缺口不走这条通道（直接 reusable=null）。
   */
  evidenceRebuildRequired?: boolean;
}

export interface DecideReuseOptions {
  leg?: ExecutionKeyLeg;
  /** 本轮期望的冻结件集合；UT leg 由 utFrozenRunArtifacts(mods) 现算（整轮键 + 逐模块冻结件） */
  artifacts?: ReadonlyArray<FrozenArtifactSpec>;
  /**
   * 排除本轮自己的 run 目录。记录前置（D2）先落一条 'started' 记录才轮到复用判定，
   * 不排除的话最新一条永远是自己，复用恒不命中。
   */
  excludeRunDir?: string;
}

/**
 * B08 D1（plan 9b2d5e7c）：一条执行键记录的**身份判据**——同键、成功、trace 在盘、执行事实
 * 冻结件齐。decideReuse 与 goal 侧的复用证据采信（validateDeviceTestEvidenceBinding）共用
 * 这一个函数，采信不得比复用更严：派生组缺 / `timing_complete=false` **不是**拒绝理由
 * （decideReuse 对它走重建通道）。`label` 只进人读原因（decideReuse 传 dirStamp）。
 */
export function isExecutionRecordReusable(
  record: ExecutionKeyRecord,
  runDir: string,
  opts: { executionKey: string; artifacts?: ReadonlyArray<FrozenArtifactSpec>; label?: string },
): { ok: boolean; reason: string } {
  const artifacts = opts.artifacts ?? FROZEN_RUN_ARTIFACTS;
  const label = opts.label ?? path.basename(path.dirname(runDir));
  if (record.execution_key !== opts.executionKey) {
    return { ok: false, reason: `最新 run ${label} 是其他 execution key，重新真跑` };
  }
  if (record.outcome !== 'success') return { ok: false, reason: `最新同键 run ${label} outcome=${record.outcome}，重新真跑` };
  // trace_path 为空串 = 该 leg 没有 Hylyre trace（UT leg）；执行事实由下面的冻结件组担保。
  if (record.trace_path && !fs.existsSync(record.trace_path)) {
    return { ok: false, reason: `最新同键 run ${label} 的 trace 缺失` };
  }
  const frozen = record.frozen_files ?? [];
  const present = (name: string): boolean => frozen.includes(name) && fs.existsSync(path.join(runDir, name));
  const missingExecution = artifacts.filter(f => f.group === 'execution' && !present(f.frozen));
  if (missingExecution.length > 0) {
    return {
      ok: false,
      reason: `最新同键 run ${label} 执行事实冻结件缺失（${missingExecution.map(f => f.frozen).join(', ')}），重新真跑`,
    };
  }
  return { ok: true, reason: `同键 run ${label} 成功、执行事实冻结件齐备` };
}

/**
 * 3.0.0 简化：只看最新一条带 execution-key 的真实 attempt。
 * 最新 attempt 必须同键、成功且执行事实完整；更新的别键或同键失败都重新真跑。
 * 没有 execution-key 的临时空目录不进入 listExecutionKeyRuns，天然不参与判断——
 * 所以生产路径必须在 dispatch **之前**先落一条非成功 attempt（plan 5e1c7a93 D2），
 * 否则跑挂的那轮不留痕、上一轮的成功会被当成"最新"。
 */
export function decideReuse(
  reportsBase: string,
  executionKey: string,
  opts: DecideReuseOptions = {},
): ReuseDecision {
  const artifacts = opts.artifacts ?? FROZEN_RUN_ARTIFACTS;
  const exclude = opts.excludeRunDir ? path.resolve(opts.excludeRunDir) : null;
  const latest = listExecutionKeyRuns(reportsBase, opts.leg ?? 'hylyre')
    .filter(r => !exclude || path.resolve(r.runDir) !== exclude)[0];
  if (!latest) return { reusable: null, reason: '无 execution-key 历史 run' };
  const identity = isExecutionRecordReusable(latest.record, latest.runDir, { executionKey, artifacts, label: latest.dirStamp });
  if (!identity.ok) return { reusable: null, reason: identity.reason };
  const frozen = latest.record.frozen_files ?? [];
  const present = (name: string): boolean => frozen.includes(name) && fs.existsSync(path.join(latest.runDir, name));
  const missingDerived = artifacts.filter(f => f.group === 'derived' && !present(f.frozen));
  if (missingDerived.length > 0 || !latest.record.timing_complete) {
    return {
      reusable: latest,
      evidenceRebuildRequired: true,
      reason: missingDerived.length > 0
        ? `最近同键 run ${latest.dirStamp} 执行事实齐备，派生冻结件缺失（${missingDerived.map(f => f.frozen).join(', ')}），先重建`
        : `最近同键 run ${latest.dirStamp} 执行事实齐备，派生证据不完整（timing_complete=false），先重建`,
    };
  }
  return { reusable: latest, reason: `最近同键 run ${latest.dirStamp} 成功、证据完整（执行事实与派生副本均已冻结）` };
}

// ---------------------------------------------------------------- 稳定性

export interface StabilityRow {
  tc_id: string;
  rounds: number;
  consistent: number;
  first_divergent_step: number | null;
  /** 各轮 outcome（含失败轮） */
  outcomes: string[];
}

export interface StabilityReport {
  schema_version: '1.0';
  execution_key: string;
  generated_at: string;
  runs: Array<{ run_dir: string; outcome: string }>;
  /** 稳定性结论所需最少同键轮数（codex review：单轮 1/1 不是稳定性证据） */
  min_rounds_for_verdict: number;
  rows: StabilityRow[];
}

function caseFingerprints(trace: HylyreTrace): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const c of trace.cases ?? []) {
    const steps = Array.isArray(c.steps) ? c.steps : [];
    const fp: string[] = [];
    for (const step of steps) {
      const s = step as unknown as {
        index?: number; kind?: string; role?: string;
        outcome?: { status?: string; observation?: { assertion_type?: string; facts?: { observed_present?: unknown } } };
      };
      if (s.role !== 'assertion') continue;
      fp.push(`${s.index}|${s.kind}|${s.outcome?.observation?.assertion_type ?? '-'}|${s.outcome?.status ?? '-'}|${String(s.outcome?.observation?.facts?.observed_present ?? '-')}`);
    }
    out.set(String(c.id).toUpperCase(), fp);
  }
  return out;
}

/** 按同键分组（含失败轮）计算每 TC 的轮数 / 一致轮数 / 首个分歧 step；基线 = 最新轮。 */
export function buildStabilityReport(reportsBase: string, executionKey: string, now: () => Date = () => new Date()): StabilityReport {
  const runs = listExecutionKeyRuns(reportsBase).filter(r => r.record.execution_key === executionKey);
  // codex review：缺 trace 的失败 attempt 也是一轮（记 outcome、算不一致），不得被过滤掉
  const loaded = runs.map(r => ({ run: r, trace: fs.existsSync(r.record.trace_path) ? parseHylyreTrace(r.record.trace_path) : null }));
  const traced = loaded.filter((x): x is { run: ExecutionKeyRunView; trace: HylyreTrace } => x.trace !== null);
  const rows: StabilityRow[] = [];
  if (traced.length > 0) {
    const baseline = caseFingerprints(traced[0].trace);
    const allIds = new Set<string>();
    for (const { trace } of traced) for (const c of trace.cases ?? []) allIds.add(String(c.id).toUpperCase());
    for (const id of [...allIds].sort()) {
      const base = baseline.get(id);
      let rounds = 0;
      let consistent = 0;
      let firstDivergent: number | null = null;
      const outcomes: string[] = [];
      for (const { run, trace } of loaded) {
        if (!trace) {
          rounds += 1;
          outcomes.push(`${run.record.outcome}(no_trace)`);
          continue;
        }
        const fp = caseFingerprints(trace).get(id);
        if (!fp) continue;
        rounds += 1;
        const traceCase = (trace.cases ?? []).find(c => String(c.id).toUpperCase() === id);
        outcomes.push(String(traceCase?.status ?? '?'));
        if (base && fp.join('\n') === base.join('\n')) {
          consistent += 1;
        } else if (base) {
          const n = Math.max(fp.length, base.length);
          for (let i = 0; i < n; i += 1) {
            if (fp[i] !== base[i]) {
              const idx = Number((fp[i] ?? base[i] ?? '').split('|')[0]);
              if (Number.isFinite(idx) && (firstDivergent === null || idx < firstDivergent)) firstDivergent = idx;
              break;
            }
          }
        }
      }
      rows.push({ tc_id: id, rounds, consistent, first_divergent_step: firstDivergent, outcomes });
    }
  }
  return {
    schema_version: '1.0',
    execution_key: executionKey,
    generated_at: now().toISOString(),
    runs: loaded.map(x => ({ run_dir: x.run.runDir, outcome: x.run.record.outcome })),
    min_rounds_for_verdict: 2,
    rows,
  };
}

export function writeStabilityReport(reportsBase: string, executionKey: string): string {
  const report = buildStabilityReport(reportsBase, executionKey);
  const p = path.join(reportsBase, STABILITY_FILE);
  fs.mkdirSync(reportsBase, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(report, null, 2), 'utf-8');
  return p;
}

/** report-only 等无键上下文：按最新 run 的执行键刷新稳定性（无记录则不写）。 */
export function refreshStabilityForNewestRun(reportsBase: string): string | null {
  const latest = listExecutionKeyRuns(reportsBase)[0];
  if (!latest) return null;
  return writeStabilityReport(reportsBase, latest.record.execution_key);
}
