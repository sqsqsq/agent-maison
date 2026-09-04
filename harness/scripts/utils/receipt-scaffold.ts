// ============================================================================
// receipt-scaffold.ts — 阶段完成回执：harness 只读投影（plan 07a41ec6 T4 /
// openspec efficiency-first-closure「Slim receipt keeps only non-derivable self-attestation」）
// ----------------------------------------------------------------------------
// 回执不再是闭环输入，也不进 evidence manifest 的 freshness：closure 直读 base summary、
// script verdict 与 verifier policy。本文件只把这些机器事实投影成一份人读回执
// （receipt_schema 2.1），agent 零手填——宿主 2026-09-02 回归里 check-receipt 跑了 41 次，
// 全部在修代理手抄的模型/时间/commit/路径与反假设 checkbox。备注请写 <phase>/notes.md。
//
// claimed_attempt_id 仅作 closure 上下文的人读投影，不参与 check-receipt / observer / Stop 判定。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  featurePhaseReportsDir,
  loadFrameworkConfig,
  resolveHylyreToolConfig,
  resolveReceiptFilePath,
} from '../../config';
import { resolveAuthoritativeHylyreTracePath } from './testing-trace-gates';

export const RECEIPT_PROJECTION_SCHEMA = '2.1';

export interface ReceiptScaffoldOptions {
  /** goal 态当前 attempt 身份（如 `i3`），只用于 closed 后的人读投影。 */
  attemptId?: string;
  /** legacy helper 兼容：true=无条件重建；新闭环由 finalizer 直接调用 writeReceiptProjection。 */
  force?: boolean;
  frameworkRoot?: string;
}

export interface ReceiptScaffoldResult {
  wrote: boolean;
  /** 写入（或已存在）的回执绝对路径；失败时为 null。 */
  receiptPath: string | null;
  /** 未写入且非幂等跳过时的真实原因（路径 + I/O 错误）。goal runner 消费它 fail-closed。 */
  failure?: string;
}

/** 模板绝对路径（现仅作投影形状的人读说明；写入由 renderReceiptProjection 生成）。 */
export function receiptTemplatePath(): string {
  return path.join(__dirname, '..', '..', 'templates', 'phase-completion-receipt.md');
}

interface SummaryFacts {
  source_commit_sha?: string;
  verifier_subject_id?: string;
  verifier_request?: string;
  verifier_closure?: { reviewed_subject_id?: string };
}

function readSummaryFacts(projectRoot: string, feature: string, phase: string, frameworkRoot?: string): SummaryFacts | null {
  try {
    const p = path.join(featurePhaseReportsDir(projectRoot, feature, phase, frameworkRoot), 'summary.json');
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, unknown>;
    return {
      source_commit_sha: typeof raw.source_commit_sha === 'string' ? raw.source_commit_sha : undefined,
      verifier_subject_id: typeof raw.verifier_subject_id === 'string' ? raw.verifier_subject_id : undefined,
      verifier_request: typeof raw.verifier_request === 'string' ? raw.verifier_request : undefined,
      verifier_closure:
        raw.verifier_closure && typeof raw.verifier_closure === 'object'
          ? (raw.verifier_closure as { reviewed_subject_id?: string })
          : undefined,
    };
  } catch {
    return null;
  }
}

function readExistingAttemptId(receiptPath: string): string | null {
  try {
    if (!fs.existsSync(receiptPath)) return null;
    const m = /^claimed_attempt_id:\s*"([^"]*)"/m.exec(fs.readFileSync(receiptPath, 'utf-8'));
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function readVerifierVerdict(reportAbs: string): string {
  try {
    const raw = JSON.parse(fs.readFileSync(reportAbs, 'utf-8')) as { verdict?: unknown };
    return typeof raw.verdict === 'string' ? raw.verdict : '';
  } catch {
    return '';
  }
}

function toPosixRel(projectRoot: string, abs: string): string {
  return path.relative(projectRoot, abs).replace(/\\/g, '/');
}

export interface ReceiptProjectionFacts {
  feature: string;
  phase: string;
  agent_model: string;
  agent_runtime: string;
  claimed_completion_at: string;
  claimed_completion_commit_sha: string;
  claimed_attempt_id: string;
  verifier: { report_path: string; verdict: string; prompt_template: string };
  testing_run_artifacts: null | {
    hylyre_run_exit_code: number;
    hylyre_report_path: string;
    hylyre_trace_path: string;
    app_snapshot_cache_dir: string;
  };
}

/** 从 summary / 磁盘收集投影事实（纯读取，不抛错：缺项留空）。 */
export function collectReceiptProjectionFacts(
  projectRoot: string,
  feature: string,
  phase: string,
  opts?: ReceiptScaffoldOptions,
): ReceiptProjectionFacts {
  const summary = readSummaryFacts(projectRoot, feature, phase, opts?.frameworkRoot);
  let adapter = '';
  try {
    const fw = loadFrameworkConfig(projectRoot);
    adapter = typeof fw.agent_adapter === 'string' ? fw.agent_adapter : '';
  } catch {
    adapter = '';
  }
  const receiptPath = resolveReceiptFilePath(projectRoot, feature, phase).path;
  const attemptId =
    opts?.attemptId ?? readExistingAttemptId(receiptPath) ?? process.env.MAISON_GOAL_ATTEMPT?.trim() ?? '';

  let reportPath = '';
  let verdict = '';
  // 当前 subject 的报告优先；沿用既往 PASS 闭环（plan 07a41ec6 T7）时投影被沿用的那份。
  for (const subject of [summary?.verifier_subject_id, summary?.verifier_closure?.reviewed_subject_id]) {
    if (!subject || reportPath) continue;
    try {
      const reportsDir = featurePhaseReportsDir(projectRoot, feature, phase, opts?.frameworkRoot);
      const abs = path.join(reportsDir, `verifier.report.${subject}.json`);
      if (fs.existsSync(abs)) {
        reportPath = toPosixRel(projectRoot, abs);
        verdict = readVerifierVerdict(abs);
      }
    } catch {
      /* 缺项留空 */
    }
  }

  let testing: ReceiptProjectionFacts['testing_run_artifacts'] = null;
  if (phase === 'testing') {
    let tracePath = '';
    let reportMd = '';
    try {
      const reportsBase = featurePhaseReportsDir(projectRoot, feature, 'testing', opts?.frameworkRoot);
      const traceAbs = resolveAuthoritativeHylyreTracePath(reportsBase);
      if (traceAbs && fs.existsSync(traceAbs)) {
        tracePath = toPosixRel(projectRoot, traceAbs);
        const reportAbs = path.join(path.dirname(traceAbs), 'test-report.md');
        reportMd = fs.existsSync(reportAbs) ? toPosixRel(projectRoot, reportAbs) : '';
      }
    } catch {
      /* 缺项留空 */
    }
    let cacheDir = 'doc/app-snapshot-cache';
    try {
      cacheDir = resolveHylyreToolConfig(projectRoot).app_snapshot_cache_dir || cacheDir;
    } catch {
      /* 默认值 */
    }
    testing = {
      hylyre_run_exit_code: tracePath ? 0 : -1,
      hylyre_report_path: reportMd,
      hylyre_trace_path: tracePath,
      app_snapshot_cache_dir: cacheDir,
    };
  }

  return {
    feature,
    phase,
    agent_model: process.env.MAISON_GOAL_MODEL_PIN?.trim() || process.env.MAISON_AGENT_MODEL?.trim() || adapter || 'unknown',
    agent_runtime: adapter || 'unknown',
    claimed_completion_at: new Date().toISOString(),
    claimed_completion_commit_sha: summary?.source_commit_sha ?? '',
    claimed_attempt_id: attemptId,
    verifier: {
      report_path: reportPath,
      verdict,
      prompt_template: `framework/harness/prompts/verify-${phase}.md`,
    },
    testing_run_artifacts: testing,
  };
}

const q = (v: string): string => JSON.stringify(v);

export function renderReceiptProjection(f: ReceiptProjectionFacts): string {
  const lines = [
    '---',
    `receipt_schema: "${RECEIPT_PROJECTION_SCHEMA}"`,
    'generated_by: "harness (read-only projection; plan 07a41ec6 T4)"',
    `feature: ${q(f.feature)}`,
    `phase: ${q(f.phase)}`,
    `agent_model: ${q(f.agent_model)}`,
    `agent_runtime: ${q(f.agent_runtime)}`,
    `claimed_completion_at: ${q(f.claimed_completion_at)}`,
    `claimed_completion_commit_sha: ${q(f.claimed_completion_commit_sha)}`,
    `claimed_attempt_id: ${q(f.claimed_attempt_id)}`,
    'verifier_subagent:',
    '  invoked_via: "Task(subagent_type=verifier)"',
    `  prompt_template: ${q(f.verifier.prompt_template)}`,
    `  report_path: ${q(f.verifier.report_path)}`,
    `  verdict: ${q(f.verifier.verdict)}`,
    '  ran_at: ""',
  ];
  if (f.testing_run_artifacts) {
    const t = f.testing_run_artifacts;
    lines.push(
      'testing_run_artifacts:',
      `  hylyre_run_exit_code: ${t.hylyre_run_exit_code}`,
      `  hylyre_report_path: ${q(t.hylyre_report_path)}`,
      `  hylyre_trace_path: ${q(t.hylyre_trace_path)}`,
      `  app_snapshot_cache_dir: ${q(t.app_snapshot_cache_dir)}`,
    );
  }
  lines.push(
    '---',
    '',
    `# 阶段完成回执（机器投影 · schema ${RECEIPT_PROJECTION_SCHEMA}）`,
    '',
    '> 本文件由 harness 从 summary.json、verifier 报告与真机产物投影生成，**只读**：闭环判据不读它',
    '> （closure = base summary PASS + verifier policy 满足），改它不改变任何判定，重跑 harness / check-receipt 会重写。',
    `> 备注、决策点、已知未解决项请写 \`${f.phase}/notes.md\`（不进门禁、closure、subject 与 freshness）。`,
    '',
  );
  return lines.join('\n');
}

/** 无条件按当前机器事实（重新）写回执投影。 */
export function writeReceiptProjection(
  projectRoot: string,
  feature: string,
  phase: string,
  opts?: ReceiptScaffoldOptions,
): ReceiptScaffoldResult {
  let receiptPath: string | null = null;
  try {
    receiptPath = resolveReceiptFilePath(projectRoot, feature, phase).path;
    const facts = collectReceiptProjectionFacts(projectRoot, feature, phase, opts);
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.writeFileSync(receiptPath, renderReceiptProjection(facts), 'utf-8');
    return { wrote: true, receiptPath };
  } catch (e) {
    return {
      wrote: false,
      receiptPath: null,
      failure: `回执投影写入失败（${receiptPath ?? '<路径解析失败>'}）：${(e as Error).message}`,
    };
  }
}

/**
 * 兼容入口（goal runner / harness in-run 仍按此语义调用）：已存在且非 force → 不动；
 * 否则写投影（force 用于 closure attempt 前作废旧回执并换新 attempt 身份）。
 */
export function writeReceiptScaffold(
  projectRoot: string,
  feature: string,
  phase: string,
  opts?: ReceiptScaffoldOptions,
): ReceiptScaffoldResult {
  try {
    const receiptPath = resolveReceiptFilePath(projectRoot, feature, phase).path;
    if (!opts?.force && fs.existsSync(receiptPath)) {
      return { wrote: false, receiptPath };
    }
  } catch (e) {
    return { wrote: false, receiptPath: null, failure: `回执路径解析失败：${(e as Error).message}` };
  }
  return writeReceiptProjection(projectRoot, feature, phase, opts);
}
