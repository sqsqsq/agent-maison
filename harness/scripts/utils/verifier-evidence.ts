// ============================================================================
// verifier-evidence.ts — verifier 机器证据的**唯一**解析边界
// ============================================================================
// plan e5b8c3f7 T3。此前四处机器消费点各自裸读 `verifier.report.md`：
//   · check-receipt 验真块（只查手填 verdict + 文件存在）
//   · repair candidates（harness-runner.ts）
//   · multimodal evidence（check-receipt.ts）
//   · goal snapshot（goal-phase-snapshot.ts）
// 任何一处继续做 Markdown 语义解析，就还留着一条"编辑 MD 改机器结论"的假闭环通道。
// 本模块把它们统一收编到身份验真后的 canonical JSON。
//
// ─── 三条不可让步的性质 ──────────────────────────────────────────────────────
// 1. **绝不重开任何 transcript**。三重等值绑定发生在 hook 发布的那一次；JSON 里分存
//    invocation_subject 与 result_subject，此后验真只比**仓内三值**（两个存档 subject
//    与当前 summary.verifier_subject_id）。会话清理、换机、归档之后仓内证据必须自足。
//    `audit.agent_transcript_path` 只是审计元数据，不参与任何判定。
// 2. **MD 不解析**。新 subject/JSON 闭环域内 `verifier.report.md` 是人读投影，不入新
//    manifest，编辑它零机器影响。（grandfather 旧闭环域里的 MD 仍按旧 manifest 登记
//    字节参与 hash 对账——那是旧登记面的字节保护，不是语义解析。）
// 3. **失败形态各自独立结构化错误**。话术一律指向"重跑 verifier / 重跑 harness"，
//    绝不指向"改文书"——回执手填字段已退出裁决权威。
// ============================================================================

import * as fs from 'fs';
import { diffVerifierMaterial, readVerifierMaterialOrNull } from './verifier-material';
import type { VerifierClosureRecord } from './types';
import * as path from 'path';

import { featurePhaseReportsDir } from '../../config';
import {
  computeVerifierResultSha256,
  SUBJECT_ID_PATTERN,
  verifierReportJsonFilename,
  verifierReportMdFilename,
} from './verifier-subject';

/**
 * 证据文件按 subject 分区（review 四轮 P0）——**先读 summary 的当前 subject，再推导路径**。
 * 固定文件名会让所有 subject 竞争同一个文件；那种竞态无法靠"更晚的授权复查"消除，只能
 * 靠"不同 subject 天然写不同文件"来根除。文件名由 verifier-subject.ts 的纯函数给出。
 */
export function verifierReportJsonPath(reportsDir: string, subjectId: string): string {
  return path.join(reportsDir, verifierReportJsonFilename(subjectId));
}

export function verifierReportMdPath(reportsDir: string, subjectId: string): string {
  return path.join(reportsDir, verifierReportMdFilename(subjectId));
}
/** 本模块只认这一个 schema——旧 1.0（state 路由时代的猜测式产物）一律不认。 */
export const VERIFIER_REPORT_SCHEMA_VERSION = '2.0';

export type VerifierEvidenceErrorCode =
  /** summary 没有 verifier_subject_id：旧件，调用方应先按行为矩阵分派而不是硬读 */
  | 'subject_absent'
  /** canonical JSON 不存在（verifier 未跑，或跑了但绑定失败落了 bedside） */
  | 'report_missing'
  | 'report_unparseable'
  | 'schema_unsupported'
  /** 同 subject 收到互不相同的结论——必 FAIL，绝不选一侧 */
  | 'conflict'
  /** 仓内三值不等（含迟到/错位/被替换） */
  | 'subject_mismatch'
  | 'structure_invalid'
  /** verdict 与 BLOCKER 计数自相矛盾 */
  | 'verdict_inconsistent'
  /** 结论指纹与 verdict/blocker_count/正文重算不符——发布后被改过 */
  | 'result_hash_mismatch'
  /** JSON 自述的 feature/phase 与调用面不符 */
  | 'scope_mismatch';

export interface VerifierEvidence {
  feature: string;
  phase: string;
  subject_id: string;
  verdict: 'PASS' | 'FAIL';
  blocker_count: number;
  agent_id: string;
  agent_type: string;
  /** verifier 结论全文（机器消费者要正文时**只**从这里取，不读 MD） */
  report_text: string;
  result_sha256: string;
  generated_at: string | null;
  json_path_abs: string;
  json_path_rel: string;
}

export type LoadVerifierEvidenceResult =
  | { ok: true; evidence: VerifierEvidence }
  | { ok: false; code: VerifierEvidenceErrorCode; message: string };

export interface LoadVerifierEvidenceOptions {
  frameworkRoot?: string;
}

/**
 * 阶段 reports 目录**唯一**解析口径（review P1-4）：一律走 `featurePhaseReportsDir`。
 * 这里曾经有一份 `receiptDirPath/reports` 的兜底，那就是路径真源的第三份意见——
 * 自定义 `reports_dir_pattern` 下它会指向另一个目录，导致证据发布在 A、验真读 B。
 * 兜底的真正动因（无 framework 树时解析器抛栈）已在 config 侧惰性化根治。
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
 * **分派锚**：当前 run 的 verifier 证据身份。新版 runner 必写、旧件必缺——
 * check-receipt 据此二分「新 subject/JSON 闭环域」与「grandfather 旧闭环域」。
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
 * summary.schema_version（plan a9d4e7c2 T3 的**分派重键**）。
 *
 * 旧口径用「subject 在场与否」二分新旧闭环域——那让 subject 同时承担协议代际、适用性、
 * 证据身份三种职责：verifier 一旦被 policy/workflow 关掉，subject 天然缺席，消费端却
 * 会把它读成"旧件"。三职分离后：**代际=schema_version、适用性=resolveVerifierPlan、
 * 身份=subject**，本函数只回答第一个问题。
 */
export function readSummarySchemaVersion(
  projectRoot: string,
  feature: string,
  phase: string,
  frameworkRoot?: string,
): string | null {
  const dir = resolveReportsDir(projectRoot, feature, phase, frameworkRoot);
  const parsed = readJsonOrNull(path.join(dir, 'summary.json'));
  if (!parsed || typeof parsed !== 'object') return null;
  const raw = (parsed as { schema_version?: unknown }).schema_version;
  return nonEmptyString(raw) ? raw.trim() : null;
}

/** summary.closure_status（grandfather 分派用；读不到按未闭环处理）。 */
export function readSummaryClosureStatus(
  projectRoot: string,
  feature: string,
  phase: string,
  frameworkRoot?: string,
): string | null {
  const dir = resolveReportsDir(projectRoot, feature, phase, frameworkRoot);
  const parsed = readJsonOrNull(path.join(dir, 'summary.json'));
  if (!parsed || typeof parsed !== 'object') return null;
  const raw = (parsed as { closure_status?: unknown }).closure_status;
  return nonEmptyString(raw) ? raw.trim() : null;
}

/**
 * 身份验真后返回 verifier 机器证据；任一环节不成立返回结构化错误。
 *
 * 校验五项（plan 四-4）：feature/phase 匹配、agent 身份在场、subject 现值、结构合法、
 * verdict 与 BLOCKER 计数一致。
 */
export function loadVerifierEvidence(
  projectRoot: string,
  feature: string,
  phase: string,
  opts?: LoadVerifierEvidenceOptions,
): LoadVerifierEvidenceResult {
  // 顺序不可倒：**先**取 summary 的当前 subject，**再**由它推导该 subject 的证据文件。
  // 这样"当前机器证据是哪一份"只有一个决定者，旧 subject 的遗留文件天然不在读取面内。
  const currentSubject = readSummaryVerifierSubjectId(projectRoot, feature, phase, opts?.frameworkRoot);
  if (!currentSubject) {
    return {
      ok: false,
      code: 'subject_absent',
      message:
        `summary.json 缺 verifier_subject_id（${feature}/${phase}）——本轮没有生成 verifier 调用凭证` +
        '（能力未启用，或启用了但 request 生成失败）。请重跑该 phase 的 harness：' +
        '启用时它会写出 verifier.request.<subject>.json，把那份 JSON 整段投给 verifier 即可。',
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
    const m = /^verifier\.report\.([0-9a-f]{64})\.json$/.exec(name);
    if (!m || m[1] === opts?.excludeSubject) continue;
    const loaded = loadVerifierEvidenceForSubject(projectRoot, feature, phase, m[1], opts);
    if (!loaded.ok || loaded.evidence.verdict !== 'PASS') continue;
    let mtime = 0;
    try {
      mtime = fs.statSync(loaded.evidence.json_path_abs).mtimeMs;
    } catch {
      mtime = 0;
    }
    if (!best || mtime > best.mtime) best = { evidence: loaded.evidence, mtime };
  }
  return best?.evidence ?? null;
}

/**
 * plan 07a41ec6 T7：闭环定稿时 verifier 结论来源的**唯一派生口径**（runner 在跑 finalize / check-receipt CLI /
 * sync-closure 三条路径同一函数）：当前 subject 自身已验真 → null（不登记）；当前 subject 无报告但本 phase
 * 历史已有 PASS → completed_with_prior_review + 未重审材料差异；其余（能力未启用 / 从未 PASS）→ null。
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
 * 按**显式给定的 subject** 验真证据（plan a9d4e7c2 P1-3/P1-5）。
 *
 * `loadVerifierEvidence` 以「磁盘 summary 现值」为锚——那在 **base summary 尚未落盘**的
 * 时刻是**上一轮**的值。writer 内部若用它取证据，就会把旧 subject 的结论算到新 run 头上
 * （评审实测：新 request B 生成后、summary B 落盘前，读到的是 A）。所以凡是"我已经知道
 * 自己要验哪个 subject"的调用点，一律走本函数；校验逻辑与上面完全同源，只是锚不同。
 */
export function loadVerifierEvidenceForSubject(
  projectRoot: string,
  feature: string,
  phase: string,
  currentSubject: string,
  opts?: LoadVerifierEvidenceOptions,
): LoadVerifierEvidenceResult {
  const dir = resolveReportsDir(projectRoot, feature, phase, opts?.frameworkRoot);
  const jsonAbs = verifierReportJsonPath(dir, currentSubject);
  const jsonRel = path.relative(projectRoot, jsonAbs).replace(/\\/g, '/');

  const parsed = readJsonOrNull(jsonAbs);
  if (parsed === null) {
    return {
      ok: false,
      code: 'report_missing',
      message:
        `${jsonRel} 不存在——verifier 未运行，或运行了但身份绑定失败（报告落 ` +
        'framework/harness/state/last-verifier-report.json，见其 reason 字段）。' +
        '恢复：把 summary.verifier_request 指向的那份 request JSON **整段**作为 Task prompt 重跑 verifier' +
        '（verifier 自行 Read 其中的 prompt_path，不要投递 ai-prompt.md 全文）。',
    };
  }
  if (parsed === undefined || typeof parsed !== 'object') {
    return { ok: false, code: 'report_unparseable', message: `${jsonRel} 不是合法 JSON 对象；请重跑 verifier 重新发布。` };
  }

  const doc = parsed as Record<string, unknown>;
  if (doc.schema_version !== VERIFIER_REPORT_SCHEMA_VERSION) {
    return {
      ok: false,
      code: 'schema_unsupported',
      message:
        `${jsonRel} schema_version=${String(doc.schema_version ?? '<missing>')}，本版本只接受 ` +
        `${VERIFIER_REPORT_SCHEMA_VERSION}（身份绑定版）；请重跑 verifier 重新发布。`,
    };
  }

  if (doc.state === 'conflict') {
    const sides = Array.isArray((doc.conflict as { sides?: unknown[] } | undefined)?.sides)
      ? ((doc.conflict as { sides: Array<Record<string, unknown>> }).sides)
      : [];
    const summary = sides
      .map((s) => `${String(s.agent_id ?? '?')}→${String(s.verdict ?? '?')}(blockers=${String(s.blocker_count ?? '?')})`)
      .join(' / ');
    return {
      ok: false,
      code: 'conflict',
      message:
        `${jsonRel} state=conflict：同一 subject 收到互不相同的 verifier 结论（${summary || '两侧详见 conflict.sides'}）。` +
        '不选边、不吞后到的 FAIL。恢复：' +
        '①停止或等待同 subject 的**全部** verifier 结束；②删除这份 conflict 件（它已不是任何一方的结论）；' +
        '③只启动**一个** verifier，把 summary.verifier_request 指向的 request JSON 整段投递。' +
        '（重跑 harness 只有在审查材料真的变了时才会换代 subject；材料没变时会回到同一个 conflict。）',
    };
  }
  if (doc.state !== 'published') {
    return { ok: false, code: 'structure_invalid', message: `${jsonRel} state=${String(doc.state ?? '<missing>')}，非 published；不构成闭环凭证。` };
  }

  const invocationSubject = doc.invocation_subject;
  const resultSubject = doc.result_subject;
  if (!nonEmptyString(invocationSubject) || !nonEmptyString(resultSubject) || !nonEmptyString(doc.subject_id)) {
    return {
      ok: false,
      code: 'structure_invalid',
      message: `${jsonRel} 缺 subject_id / invocation_subject / result_subject 之一——身份字段不全，fail-closed。`,
    };
  }
  // 仓内三值等值（**不重开 transcript**）：两个存档 subject 与 summary 现值。
  //
  // 顶层 `subject_id` 也必须一并等值：它不是展示字段——`evidence.subject_id` 会被 review
  // closure attestation 的 `verifier_subject_id` 与 goal snapshot 直接采信。只查非空的话，
  // 闭环**前**手改这一个字段就能让 attestation 锚到伪值（验证链本身不受影响，但信息锚被污染，
  // 而 attestation 正是给人和下游对账用的）。四值一起比，零成本关死。
  const docSubject = doc.subject_id.trim();
  if (invocationSubject !== resultSubject || invocationSubject !== currentSubject || docSubject !== currentSubject) {
    return {
      ok: false,
      code: 'subject_mismatch',
      message:
        `${jsonRel} 身份不匹配：subject_id=${docSubject.slice(0, 12)}… / invocation=${invocationSubject.slice(0, 12)}… / ` +
        `result=${resultSubject.slice(0, 12)}… / summary 现值=${currentSubject.slice(0, 12)}…。` +
        '该报告不属于当前审查材料（迟到、错位，或字段被手改），请按当前 request JSON 重跑 verifier。',
    };
  }

  if (doc.feature !== feature || doc.phase !== phase) {
    return {
      ok: false,
      code: 'scope_mismatch',
      message: `${jsonRel} 自述 feature/phase=${String(doc.feature)}/${String(doc.phase)}，与当前 ${feature}/${phase} 不符。`,
    };
  }

  if (!nonEmptyString(doc.agent_id)) {
    return { ok: false, code: 'structure_invalid', message: `${jsonRel} 缺 agent_id——子 agent 身份不在场，fail-closed。` };
  }
  if (doc.verdict !== 'PASS' && doc.verdict !== 'FAIL') {
    return { ok: false, code: 'structure_invalid', message: `${jsonRel} verdict=${String(doc.verdict)} 非法（只接受 PASS/FAIL）。` };
  }
  if (typeof doc.blocker_count !== 'number' || !Number.isInteger(doc.blocker_count) || doc.blocker_count < 0) {
    return { ok: false, code: 'structure_invalid', message: `${jsonRel} blocker_count 非法（须为非负整数）。` };
  }
  if (typeof doc.report_text !== 'string') {
    return { ok: false, code: 'structure_invalid', message: `${jsonRel} 缺 report_text（结论正文）。` };
  }
  if (!nonEmptyString(doc.result_sha256) || !/^[0-9a-f]{64}$/.test(doc.result_sha256.trim())) {
    return { ok: false, code: 'structure_invalid', message: `${jsonRel} result_sha256 缺失或形态非法（须为 64 位小写 hex）。` };
  }
  // 结论指纹**必须重算比对**（review P1-3）：只查非空的话，把一份合法 FAIL 件的
  // verdict/blocker_count/report_text 局部改成 PASS、保留原 hash，就能整份通过验真。
  // 生产 SSOT 已有 computeVerifierResultSha256，这里直接复用同一函数，不引入签名体系。
  const recomputed = computeVerifierResultSha256({
    verdict: doc.verdict,
    blocker_count: doc.blocker_count,
    report_text: doc.report_text,
  });
  if (recomputed !== doc.result_sha256.trim()) {
    return {
      ok: false,
      code: 'result_hash_mismatch',
      message:
        `${jsonRel} result_sha256 与 verdict/blocker_count/正文重算不符——该文件在发布后被改过，` +
        '按无效证据处理；请重跑 verifier 重新发布。',
    };
  }

  // verdict 与 BLOCKER 计数一致性：PASS ⟺ blocker_count===0。
  const consistent = doc.verdict === 'PASS' ? doc.blocker_count === 0 : doc.blocker_count > 0;
  if (!consistent) {
    return {
      ok: false,
      code: 'verdict_inconsistent',
      message:
        `${jsonRel} verdict=${doc.verdict} 与 blocker_count=${doc.blocker_count} 自相矛盾——` +
        '按无效证据处理，请重跑 verifier 输出合规终态块。',
    };
  }

  return {
    ok: true,
    evidence: {
      feature,
      phase,
      subject_id: doc.subject_id.trim(),
      verdict: doc.verdict,
      blocker_count: doc.blocker_count,
      agent_id: doc.agent_id.trim(),
      agent_type: typeof doc.agent_type === 'string' ? doc.agent_type : '',
      report_text: doc.report_text,
      result_sha256: doc.result_sha256.trim(),
      generated_at: nonEmptyString(doc.generated_at) ? doc.generated_at.trim() : null,
      json_path_abs: jsonAbs,
      json_path_rel: jsonRel,
    },
  };
}

/**
 * 只要正文的消费者（repair candidates / multimodal evidence / goal snapshot 机器字段）
 * 的统一入口：验真不通过 → null（各自既有的"无证据"通道，fail-closed 不猜）。
 * **绝不**回落读 MD——那正是要关死的假闭环通道。
 */
export function loadVerifierReportTextOrNull(
  projectRoot: string,
  feature: string,
  phase: string,
  opts?: LoadVerifierEvidenceOptions & {
    /**
     * 显式锚定 subject（plan a9d4e7c2 P1-5）。**在 base summary 落盘前调用时必须传**——
     * 否则读到的是上一轮 summary 的 subject，会把旧 verifier 正文算进本轮的
     * repair_candidates。传 `null` 表示"本轮没有可用 subject"，直接返回 null。
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
