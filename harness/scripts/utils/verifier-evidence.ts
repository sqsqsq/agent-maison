// ============================================================================
// verifier-evidence.ts — verifier 机器证据的**唯一**解析边界
// ============================================================================
// plan d2f7a9c4：真源从 hook 发布的 canonical JSON 改回 **调用方写出的 MD**。
//
// ─── 为什么反转 e5b8c3f7 的「MD 不解析」───────────────────────────────────────
// 那条边界（连同四方对账、conflict 状态机、结论指纹重算、16 种 bedside 分类）服务的是
// 一个目标：主 agent 不能伪造 PASS。用户 2026-09-03 已裁定防篡改不是优先级。代价是它把
// 「发布手续失败」判成「检查根本不存在」——宿主 bc-openCard-1 两轮无人值守 run，harness
// PASS、verifier 真跑且 PASS，只因 hook 在 MAISON_GOAL_HEADLESS=1 下一律落 bedside 而
// 熔断；codex 等无 SubagentStop 的 adapter 则被判 blocked、full track 事实不可用。
//
// ─── 现在只保留三样真正影响正确性的事实 ──────────────────────────────────────
//   1. 审的是哪份材料 → subject（材料变则 subject 变，verifier-request.ts 派生）
//   2. 结论是什么     → verdict + blocker_count（终态块，parseResultBlock 解析）
//   3. 属于哪个阶段   → 报告所在的 reports 目录
// 校验三条：文件在、终态块回显的 subject 等于当前 subject、verdict 与 blocker_count 一致。
// 任一不成立的**唯一**恢复动作是重跑 verifier 并重写报告——绝不指向"改文书"。
//
// ─── 单写者 ─────────────────────────────────────────────────────────────────
// 写者是**派发 verifier 的那个 agent**（phase executor / 主 agent）：把 verifier 的回复
// 原样写入 summary.verifier_report。verifier 子代理保持只读工具集、只负责回复。刻意不做
// 「verifier 只回终态块 + 调用方兜底补写」——那会产出一份只有终态块、却能通过本 loader 的
// 报告，repair candidates、WARN 与多模态审查正文全部丢失。
//
// ─── 放弃的准确性（plan d2f7a9c4 一、放弃项）─────────────────────────────────
// 报告可被伪造或事后修改而不被机器识别；同 subject 并发不再报 conflict。兜底靠下游阶段
// 门禁与人。**因此**报告也不得进 evidence manifest、不得进 closure attestation 哈希：
// 一份刻意不做防篡改的文件，不能同时充当"改一下就 stale"的绊线。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import { featurePhaseReportsDir } from '../../config';
import type { VerifierClosureRecord } from './types';
import { diffVerifierMaterial, readVerifierMaterialOrNull } from './verifier-material';
import { parseResultBlock, SUBJECT_ID_PATTERN, verifierReportMdFilename } from './verifier-subject';

export function verifierReportMdPath(reportsDir: string, subjectId: string): string {
  return path.join(reportsDir, verifierReportMdFilename(subjectId));
}

export type VerifierEvidenceErrorCode =
  /** summary 没有 verifier_subject_id：本轮没有生成调用凭证（能力未启用，或 request 生成失败） */
  | 'subject_absent'
  /** 报告文件不存在——verifier 未跑，或跑了但调用方没把回复写下来 */
  | 'report_missing'
  /** 终态块缺失 / 多于一个 / 字段非法 */
  | 'block_unparseable'
  /** 终态块回显的 subject 不是当前 subject（迟到、错位，或被手改） */
  | 'subject_mismatch'
  /** verdict 与 BLOCKER 计数自相矛盾 */
  | 'verdict_inconsistent';

export interface VerifierEvidence {
  feature: string;
  phase: string;
  subject_id: string;
  verdict: 'PASS' | 'FAIL';
  blocker_count: number;
  /** verifier 结论全文（机器消费者要正文时只从这里取） */
  report_text: string;
  md_path_abs: string;
  md_path_rel: string;
}

export type LoadVerifierEvidenceResult =
  | { ok: true; evidence: VerifierEvidence }
  | { ok: false; code: VerifierEvidenceErrorCode; message: string };

export interface LoadVerifierEvidenceOptions {
  frameworkRoot?: string;
}

/** 恢复话术**唯一出处**：只指向重跑 verifier + 重写报告，绝不指向改文书。 */
function rerunGuidance(): string {
  return (
    '恢复：把 summary.verifier_request 指向的 request JSON **整段**作为 Task prompt 投给 verifier' +
    '（verifier 自行 Read 其中的 prompt_path），再把它的回复**原样**写入 summary.verifier_report ' +
    '指向的路径，然后重跑本检查。'
  );
}

/**
 * 阶段 reports 目录**唯一**解析口径：一律走 `featurePhaseReportsDir`。
 * 这里曾经有一份 `receiptDirPath/reports` 的兜底，那就是路径真源的第三份意见——
 * 自定义 `reports_dir_pattern` 下它会指向另一个目录，导致证据写在 A、验真读 B。
 */
function resolveReportsDir(projectRoot: string, feature: string, phase: string, frameworkRoot?: string): string {
  return featurePhaseReportsDir(projectRoot, feature, phase, frameworkRoot);
}

function readJsonOrNull(abs: string): unknown {
  try {
    if (!fs.existsSync(abs)) return null;
    return JSON.parse(fs.readFileSync(abs, 'utf-8'));
  } catch {
    return undefined; // undefined = 存在但坏；null = 不存在
  }
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * **身份锚**：当前 run 的 verifier 证据 subject。plan `enabled` 时由 runner 写入。
 */
export function readSummaryVerifierSubjectId(
  projectRoot: string,
  feature: string,
  phase: string,
  frameworkRoot?: string,
): string | null {
  const dir = resolveReportsDir(projectRoot, feature, phase, frameworkRoot);
  const parsed = readJsonOrNull(path.join(dir, 'summary.json'));
  if (!parsed || typeof parsed !== 'object') return null;
  const raw = (parsed as { verifier_subject_id?: unknown }).verifier_subject_id;
  if (!nonEmptyString(raw)) return null;
  const v = raw.trim();
  return SUBJECT_ID_PATTERN.test(v) ? v : null;
}

/**
 * 身份验真后返回 verifier 机器证据；任一环节不成立返回结构化错误。
 * 锚是磁盘 summary 现值——**base summary 尚未落盘时不要用它**，改用
 * `loadVerifierEvidenceForSubject` 显式钉住本轮 subject。
 */
export function loadVerifierEvidence(
  projectRoot: string,
  feature: string,
  phase: string,
  opts?: LoadVerifierEvidenceOptions,
): LoadVerifierEvidenceResult {
  const currentSubject = readSummaryVerifierSubjectId(projectRoot, feature, phase, opts?.frameworkRoot);
  if (!currentSubject) {
    return {
      ok: false,
      code: 'subject_absent',
      message:
        `summary.json 缺 verifier_subject_id（${feature}/${phase}）——本轮没有生成 verifier 调用凭证` +
        '（能力未启用，或启用了但 request 生成失败）。请重跑该 phase 的 harness：' +
        '启用时它会写出 verifier.request.<subject>.json 并在 summary.verifier_report 给出报告路径。',
    };
  }
  return loadVerifierEvidenceForSubject(projectRoot, feature, phase, currentSubject, opts);
}

/**
 * plan 07a41ec6 T7：本 phase 历史上**验真通过且 verdict=PASS** 的最新报告（按文件 mtime）。
 * 当前 subject 无报告时 check-receipt 用它沿用闭环（completed_with_prior_review）；
 * 从未 PASS 过 → null → 仍是 BLOCKER（至少要完整审一次）。
 */
export function findPriorPassVerifierEvidence(
  projectRoot: string,
  feature: string,
  phase: string,
  opts?: LoadVerifierEvidenceOptions & { excludeSubject?: string | null },
): VerifierEvidence | null {
  const dir = resolveReportsDir(projectRoot, feature, phase, opts?.frameworkRoot);
  if (!fs.existsSync(dir)) return null;
  let best: { evidence: VerifierEvidence; mtime: number } | null = null;
  for (const name of fs.readdirSync(dir)) {
    const m = /^verifier\.report\.([0-9a-f]{64})\.md$/.exec(name);
    if (!m || m[1] === opts?.excludeSubject) continue;
    const loaded = loadVerifierEvidenceForSubject(projectRoot, feature, phase, m[1], opts);
    if (!loaded.ok || loaded.evidence.verdict !== 'PASS') continue;
    let mtime = 0;
    try {
      mtime = fs.statSync(loaded.evidence.md_path_abs).mtimeMs;
    } catch {
      mtime = 0;
    }
    if (!best || mtime > best.mtime) best = { evidence: loaded.evidence, mtime };
  }
  return best?.evidence ?? null;
}

/**
 * plan 07a41ec6 T7：闭环定稿时 verifier 结论来源的**唯一派生口径**（runner finalize /
 * check-receipt CLI / sync-closure 三条路径同一函数）：当前 subject 自身已验真 → null（不登记）；
 * 当前 subject 无报告但本 phase 历史已有 PASS → completed_with_prior_review + 未重审材料差异；
 * 其余（能力未启用 / 从未 PASS）→ null。
 */
export function deriveVerifierClosureRecord(
  projectRoot: string,
  feature: string,
  phase: string,
  frameworkRoot?: string,
): VerifierClosureRecord | null {
  const current = readSummaryVerifierSubjectId(projectRoot, feature, phase, frameworkRoot);
  if (!current) return null;
  const loaded = loadVerifierEvidenceForSubject(projectRoot, feature, phase, current, { frameworkRoot });
  if (loaded.ok || loaded.code !== 'report_missing') return null;
  const prior = findPriorPassVerifierEvidence(projectRoot, feature, phase, { frameworkRoot, excludeSubject: current });
  if (!prior) return null;
  const dir = resolveReportsDir(projectRoot, feature, phase, frameworkRoot);
  return {
    mode: 'completed_with_prior_review',
    reviewed_subject_id: prior.subject_id,
    current_subject_id: current,
    current_material_not_reverified: diffVerifierMaterial(
      readVerifierMaterialOrNull(dir, prior.subject_id),
      readVerifierMaterialOrNull(dir, current),
    ),
  };
}

/**
 * 按**显式给定的 subject** 验真证据。
 *
 * `loadVerifierEvidence` 以磁盘 summary 现值为锚——那在 **base summary 尚未落盘**的时刻是
 * **上一轮**的值，按它取证据会把旧 subject 的结论算到新 run 头上。凡是"我已经知道自己要验
 * 哪个 subject"的调用点，一律走本函数。
 */
export function loadVerifierEvidenceForSubject(
  projectRoot: string,
  feature: string,
  phase: string,
  currentSubject: string,
  opts?: LoadVerifierEvidenceOptions,
): LoadVerifierEvidenceResult {
  const dir = resolveReportsDir(projectRoot, feature, phase, opts?.frameworkRoot);
  const mdAbs = verifierReportMdPath(dir, currentSubject);
  const mdRel = path.relative(projectRoot, mdAbs).replace(/\\/g, '/');

  let text: string;
  try {
    if (!fs.existsSync(mdAbs)) {
      return {
        ok: false,
        code: 'report_missing',
        message: `${mdRel} 不存在——verifier 未运行，或运行了但调用方没有把它的回复写下来。${rerunGuidance()}`,
      };
    }
    text = fs.readFileSync(mdAbs, 'utf-8');
  } catch (e) {
    return {
      ok: false,
      code: 'report_missing',
      message: `${mdRel} 不可读（${(e as Error).message}）。${rerunGuidance()}`,
    };
  }

  // 终态块：**必须恰好一个**。零个 = verifier 没按契约输出，或调用方只写了摘要；
  // 多于一个 = 回答被拼接污染。两种都不是"能修的文书问题"，一律重跑。
  const block = parseResultBlock(text);
  if (!block) {
    return {
      ok: false,
      code: 'block_unparseable',
      message:
        `${mdRel} 里没有恰好一个合法终态块（<!-- maison-verifier-result:v1 --> ... 含 ` +
        `verifier_subject_id / verdict / blocker_count 三字段）。常见成因：调用方写入的不是 verifier ` +
        `回复全文（摘要、只贴终态块、或多份回答拼接）。${rerunGuidance()}`,
    };
  }

  if (block.subject_id !== currentSubject) {
    return {
      ok: false,
      code: 'subject_mismatch',
      message:
        `${mdRel} 的终态块回显 subject=${block.subject_id.slice(0, 12)}…，当前 subject=` +
        `${currentSubject.slice(0, 12)}…。该报告审的不是当前材料（迟到、错位，或字段被手改）。${rerunGuidance()}`,
    };
  }

  // verdict ⟺ blocker_count：PASS 当且仅当 0。自相矛盾按无效证据处理。
  const consistent = block.verdict === 'PASS' ? block.blocker_count === 0 : block.blocker_count > 0;
  if (!consistent) {
    return {
      ok: false,
      code: 'verdict_inconsistent',
      message:
        `${mdRel} 的 verdict=${block.verdict} 与 blocker_count=${block.blocker_count} 自相矛盾。${rerunGuidance()}`,
    };
  }

  return {
    ok: true,
    evidence: {
      feature,
      phase,
      subject_id: block.subject_id,
      verdict: block.verdict,
      blocker_count: block.blocker_count,
      report_text: text,
      md_path_abs: mdAbs,
      md_path_rel: mdRel,
    },
  };
}

/**
 * 只要正文的消费者（repair candidates / multimodal evidence / goal snapshot 机器字段）
 * 的统一入口：验真不通过 → null（各自既有的"无证据"通道，fail-closed 不猜）。
 */
export function loadVerifierReportTextOrNull(
  projectRoot: string,
  feature: string,
  phase: string,
  opts?: LoadVerifierEvidenceOptions & {
    /**
     * 显式锚定 subject。**在 base summary 落盘前调用时必须传**——否则读到的是上一轮
     * summary 的 subject，会把旧 verifier 正文算进本轮的 repair_candidates。
     * 传 `null` 表示"本轮没有可用 subject"，直接返回 null。
     */
    subjectId?: string | null;
  },
): string | null {
  if (opts && 'subjectId' in opts) {
    if (!opts.subjectId) return null;
    const pinned = loadVerifierEvidenceForSubject(projectRoot, feature, phase, opts.subjectId, opts);
    return pinned.ok ? pinned.evidence.report_text : null;
  }
  const res = loadVerifierEvidence(projectRoot, feature, phase, opts);
  return res.ok ? res.evidence.report_text : null;
}
