// ============================================================================
// phase-completion-probe.ts — 阶段完成的**纯只读**判据（openspec ... t4）
// ----------------------------------------------------------------------------
// 为何要独立于 check-receipt CLI：
//   check-receipt 默认会同步 .current-phase.json、生成 closure attestation、回写
//   summary 的 soft_advisories。`--skip-state-sync` 能挡住前两者，但 soft_advisories
//   回写不受该开关保护。observer 每 2 秒轮询一次，**绝不能**每次都跑一个会改状态的
//   CLI——那会把"观察"变成"干预"。故此处抽纯只读判据。
//
// 为何要 attempt 新鲜度：
//   只看"证据是否齐全"会把 **retry 遗留的上一轮证据**误判为本轮完成——上一轮写过
//   receipt、这一轮 agent 刚启动就被判定"已完成"。故必须记 invoke 前基线，只认
//   本次调用后"不完整 → 完整"的**跃迁**。
//
// 判据边界（诚实）：这里判的是"完成证据是否已确定性落盘"，**不判**质量。质量由
// gate harness 判——observer 命中后照常走既有 gate 流程，结论仍可能是 FAIL。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { receiptPathForPhase } from './phase-evidence-manifest';
import { featureFilePath, type FeaturePathOptions } from '../../config';

export interface CompletionEvidenceState {
  /** ① 阶段完成回执在盘、非空、且含必备结构（不是任意占位文本） */
  receipt: boolean;
  /** ② harness summary 在盘且可解析 */
  summary: boolean;
  /** ③ 回执校验状态已通过（summary.receipt_status） */
  receiptStatus: boolean;
  /** ④ 阶段闭环已关闭（summary.closure_status） */
  closure: boolean;
  /** summary 自称的 verdict（仅记录，不参与"是否完成"判定——完成≠通过） */
  verdict?: string;
  /** R7：证据自报的 run 身份（跳过判据用；缺失即不跳过） */
  runId?: string;
  /**
   * f9c2e6b4 t1：回执自报的 attempt 身份（`claimed_attempt_id`）。
   * agent 侧从 `MAISON_GOAL_ATTEMPT` 取值填写；缺失 = 旧格式回执（见 attempt 新鲜度判据）。
   */
  attemptId?: string;
  /** f9c2e6b4 t1：回执自报完成时刻的毫秒时间戳（attempt 新鲜度的 legacy 判据） */
  claimedCompletionAtMs?: number;
  /** 回执声明的 commit sha（形态已校验）；用于与 summary 的 run identity 锚对账 */
  receiptSha?: string;
  /** 诊断用：哪一条不满足 */
  missing?: string[];
}

/**
 * 回执**结构性**必填字段（S11）。
 *
 * 此前只查正文含"阶段/回执"两个词——任意占位文本都能过。改为按回执 schema 2.0 的
 * 必填键校验：这些是 `check-receipt` 同源的机器可读字段，占位模板（`<feature-name>`
 * 之类尖括号占位）也会被下面的占位检测挡掉。
 */
const RECEIPT_REQUIRED_KEYS = [
  'receipt_schema',
  'feature',
  'phase',
  'claimed_completion_at',
  'claimed_completion_commit_sha',
] as const;

/** 未填写的模板占位形态（`<...>`）——存在即视为回执未完成 */
const RECEIPT_PLACEHOLDER = /:\s*"?<[^">\n]*>"?/;

/** 从回执正文取一个顶层标量字段值 */
function receiptField(text: string, key: string): string | null {
  const m = new RegExp(`^${key}\\s*:\\s*"?([^"\\n]*)"?\\s*$`, 'm').exec(text);
  return m ? m[1].trim() : null;
}

/**
 * 只读采集完成证据。任何 IO/解析异常一律按"未完成"处理（fail-safe 方向：
 * 宁可多等一轮，也不能把半写入误判成完成）。
 */
export function collectCompletionEvidence(
  projectRoot: string,
  feature: string,
  phase: string,
  opts?: FeaturePathOptions,
): CompletionEvidenceState {
  const out: CompletionEvidenceState = {
    receipt: false,
    summary: false,
    receiptStatus: false,
    closure: false,
  };
  try {
    const receiptPath = receiptPathForPhase(projectRoot, feature, phase, opts);
    if (fs.existsSync(receiptPath) && fs.statSync(receiptPath).size > 0) {
      // R6/S11：不能只判"非空"或关键词——任意占位文本会让 observer 在 agent 还在干活时
      // 收口。按回执 schema 的**必填字段**校验，并拒绝未填写的模板占位（`<...>`），
      // 且 feature/phase 必须与本次调用一致（防读到别的阶段的回执）。
      const text = fs.readFileSync(receiptPath, 'utf-8');
      const hasAllKeys = RECEIPT_REQUIRED_KEYS.every(k => receiptField(text, k) !== null);
      const filled = RECEIPT_REQUIRED_KEYS.every(k => {
        const v = receiptField(text, k);
        return v !== null && v.length > 0 && !RECEIPT_PLACEHOLDER.test(`${k}: ${v}`);
      });
      const identityOk =
        receiptField(text, 'feature') === feature && receiptField(text, 'phase') === phase;
      // P1（三轮 review）：字段"存在且非占位"还不够——**值本身要成形**，
      // 否则随手填的字符串就能触发提前 tree-kill。三条零成本形态校验：
      const schemaOk = receiptField(text, 'receipt_schema') === '2.0';
      const shaRaw = receiptField(text, 'claimed_completion_commit_sha') ?? '';
      const shaOk = /^[0-9a-f]{7,40}$/i.test(shaRaw);
      const atRaw = receiptField(text, 'claimed_completion_at') ?? '';
      const atOk = atRaw.length > 0 && Number.isFinite(Date.parse(atRaw));
      out.receipt = hasAllKeys && filled && identityOk && schemaOk && shaOk && atOk;
      if (out.receipt) {
        out.receiptSha = shaRaw.toLowerCase();
        // f9c2e6b4 t1：attempt 新鲜度素材。两者都**只采集不判定**——判定在
        // isEvidenceFromCurrentInvocation，因为"完整"与"属于本次调用"是两个问题
        // （前者还要喂 decideSkipAgentInvoke，那条路径不得要求匹配尚未开始的 attempt）。
        const attemptRaw = receiptField(text, 'claimed_attempt_id');
        if (attemptRaw && attemptRaw.length > 0 && !RECEIPT_PLACEHOLDER.test(`x: ${attemptRaw}`)) {
          out.attemptId = attemptRaw;
        }
        out.claimedCompletionAtMs = Date.parse(atRaw);
      }
    }
  } catch {
    out.receipt = false;
  }
  try {
    const summaryPath = featureFilePath(
      projectRoot,
      feature,
      path.join(phase, 'reports', 'summary.json'),
      opts,
    );
    if (fs.existsSync(summaryPath)) {
      const raw = fs.readFileSync(summaryPath, 'utf-8');
      // 半写入的 JSON 会在此抛错 → summary=false，下一轮重试（这正是要的行为）
      const doc = JSON.parse(raw) as {
        verdict?: unknown;
        receipt_status?: unknown;
        closure_status?: unknown;
        phase?: unknown;
        feature?: unknown;
      };
      // S11：身份必须**显式吻合**——此前"字段缺失也算通过"，于是旧格式/伪造的 summary
      // 能绕过身份校验提前 tree-kill agent。现在缺字段即判不通过。
      // P1（三轮 review）：回执声明的 commit 必须与 summary 的 run identity 锚**一致**。
      // 这是 check-receipt 的三方绑定里探针能零成本复用的那一条，也是把"随手编个 sha"
      // 挡在门外的关键——summary.source_commit_sha 由 harness 生成，不是 agent 自由文本。
      const summarySha = (doc as { source_commit_sha?: unknown }).source_commit_sha;
      const shaBound =
        out.receiptSha === undefined ||
        (typeof summarySha === 'string' && summarySha.trim().toLowerCase() === out.receiptSha);
      const identityOk = doc.phase === phase && doc.feature === feature && shaBound;
      out.summary = identityOk;
      if (typeof doc?.verdict === 'string') out.verdict = doc.verdict;
      const rid = (doc as { run_id?: unknown }).run_id;
      if (typeof rid === 'string' && rid.trim()) out.runId = rid.trim();
      // ③④：闭环两态——与 gate 侧 resolveClosureAdvanceBlock 同源字段
      out.receiptStatus = doc.receipt_status === 'passed';
      out.closure = doc.closure_status === 'closed';
    }
  } catch {
    out.summary = false;
    out.verdict = undefined;
    out.receiptStatus = false;
    out.closure = false;
  }
  // 为何**不**在此调用完整的 check-receipt：探针每几秒轮询一次，而 check-receipt 要
  // spawn git、读多份产物、跑全量结构校验——放进轮询循环会显著拖慢 run，且它本就是
  // gate 的职责。探针只需回答"agent 是否已经写完并收尾"，判错的代价是本轮判失败重跑，
  // 不是 fake-pass（真正的裁决仍在 gate harness）。因此这里只做**零成本**的形态与
  // 三方绑定校验，把"随手编字段"挡住，重活留给 gate。
  out.missing = [
    ...(out.receipt ? [] : ['receipt']),
    ...(out.summary ? [] : ['summary']),
    ...(out.receiptStatus ? [] : ['receipt_status']),
    ...(out.closure ? [] : ['closure_status']),
  ];
  return out;
}

/**
 * **四条件**齐备才算完成（R6）。
 *
 * 完成 ≠ 通过：`verdict` 不参与判定——FAIL 也是"跑完了"，质量由 gate harness 判。
 * 但"跑完"必须以回执结构 + summary 身份 + 回执校验通过 + 闭环关闭四者同时成立为准，
 * 否则 observer 会在 agent 仍在工作时把它杀掉。
 */
export function isCompletionEvidenceComplete(s: CompletionEvidenceState): boolean {
  return s.receipt && s.summary && s.receiptStatus && s.closure;
}

/** invocation 身份：observer 判"这份完成证据是不是**本次调用**产出的"所需的全部输入。 */
export interface InvocationIdentity {
  runId?: string | null;
  attemptId?: string | null;
  /** 本次 agent 调用的开始时刻（ms）——legacy 回执无 attempt 字段时的新鲜度下界 */
  startedAtMs: number;
}

/**
 * f9c2e6b4 t1：**证据是否属于当前 invocation**（与"证据是否完整"分开的第二问）。
 *
 * 立项事故（run 20260803T103413Z-3f72a8）：coding attempt 2/3 的 agent 各只活了 35.3 秒，
 * 因为上一轮的回执被**原样复写**（mtime 19:42:25，内容仍写 `claimed_completion_at: 19:40`，
 * 早于该 attempt 启动），observer 判"不完整→完整"跃迁成立即 tree-kill。规格
 * （openspec/specs/goal-runner/spec.md:75）本就要求判据叠加**本 attempt 新鲜度**。
 *
 * 为什么绑回执而不绑 summary：summary 由 harness 生成，agent 在 attempt 内重跑门禁就会
 * 刷新它，绑上去抓不住陈旧声明；**陈旧的是 agent 的自证**，所以判据必须落在回执侧。
 *
 * **判据按模式分层（codex 复核订正——原实现的 legacy 回退在 goal 下也生效，等于没绑定）**：
 *   · **goal 模式**（invocation 带 attemptId）：`run_id` 与 `attempt_id` **都必须精确匹配**，
 *     缺任一即判否。不再回退到时间戳——那是 agent 自报值，未来时间/错误时区仍会误杀本轮。
 *     可行性由 `check-receipt` 保证：goal 环境下 `claimed_attempt_id` 是必填项，
 *     agent 收尾时跑门禁就会被要求补上（同一次调用内自纠，不会永久判死 observer）。
 *   · **非 goal / 人工模式**（无 attemptId）：沿用 `claimed_completion_at > 本次调用开始时刻`，
 *     兼容旧回执。运算符**刻意与 `goal-runner-phase.isReceiptFreshForInvokeStart` 对齐
 *     （严格大于）**——那是仓内既有的同一判据（文件级，另叠 mtime），单测有等价性断言钉住；
 *     此处不直接调用它，是为了让本函数保持纯函数（探针每 2 秒轮询，不再多做一次文件读）。
 */
export function isEvidenceFromCurrentInvocation(
  s: CompletionEvidenceState,
  id: InvocationIdentity,
): boolean {
  if (id.attemptId) {
    // goal 模式：三元组硬绑定（phase 已在采集侧校验）。缺失即判否，**不回退时间戳**。
    if (!id.runId || s.runId !== id.runId) return false;
    return s.attemptId === id.attemptId;
  }
  // 非 goal / 人工模式：run 身份若两侧都有则仍须一致，其余走时间新鲜度。
  if (id.runId && s.runId && s.runId !== id.runId) return false;
  return (
    typeof s.claimedCompletionAtMs === 'number' &&
    Number.isFinite(s.claimedCompletionAtMs) &&
    s.claimedCompletionAtMs > id.startedAtMs
  );
}

/**
 * 构造 observer 探针：闭包捕获 invoke 前基线，只在**本次调用内发生跃迁**时返回 true。
 *
 * - 基线已完整 → 恒返回 false（调用方应在 invoke 前就跳过本次调用，而不是启动后即杀）；
 * - 基线不完整 → 变完整即命中一次（内部锁存，避免重复触发 kill）。
 */
export interface SkipDecision {
  /** 可安全跳过本次 agent 调用 */
  skip: boolean;
  reason: string;
}

/**
 * R7：**能否安全跳过本次 agent 调用**。
 *
 * "证据齐全"本身不足以跳过——回退重跑（backtrack）时上一轮的 receipt/summary 仍在盘上，
 * 直接跳过会让 coding 只跑一次、crash/must_fix 修复指令永远注入不进去（实证：4 个既有
 * 集成用例同时红）。跳过必须同时满足：
 *
 *   ① 基线证据齐全；
 *   ② **不是回退/带交接上下文的重跑**——有 must_fix/crash 要修就必须真的跑；
 *   ③ **不是本 phase 的重试轮**（retries=0）——重试意味着上一轮判了失败，
 *      而失败轮留下的证据不能代表"这一轮不用干活"；
 *   ④ 证据的需求身份与本 run 一致（换了需求就得重跑）。
 *
 * 四条都成立时，跳过是安全的：证据属于同一需求、同一 phase、且没有任何待修项。
 */
export function decideSkipAgentInvoke(input: {
  baselineComplete: boolean;
  /** 本 phase 已重试次数（>0 = 上一轮判失败） */
  retries: number;
  /** 回退交接的待修项数量（>0 = 必须真跑） */
  pendingHandoffCount: number;
  /** 证据自报的 run 身份（缺失 = 无从校验 → 不跳过） */
  evidenceRunId?: string | null;
  /** 当前 run 身份 */
  currentRunId?: string | null;
}): SkipDecision {
  if (!input.baselineComplete) return { skip: false, reason: '基线证据不完整' };
  if (input.retries > 0) {
    return { skip: false, reason: `本 phase 第 ${input.retries + 1} 轮（上一轮判失败）——须真跑` };
  }
  if (input.pendingHandoffCount > 0) {
    return { skip: false, reason: `存在 ${input.pendingHandoffCount} 项回退交接待修——须真跑` };
  }
  if (!input.evidenceRunId || !input.currentRunId) {
    return { skip: false, reason: '证据缺少 run 身份，无从校验新鲜度' };
  }
  if (input.evidenceRunId !== input.currentRunId) {
    return { skip: false, reason: '证据来自其它 run（跨 run 遗留不代表本轮已完成）' };
  }
  return { skip: true, reason: '本 run 同一 phase、非重试轮、无待修项且证据齐全' };
}

export function createCompletionProbe(input: {
  projectRoot: string;
  feature: string;
  phase: string;
  pathOpts?: FeaturePathOptions;
  /**
   * f9c2e6b4 t1：本次调用的身份。传入后，跃迁还须**属于本次 invocation** 才算命中
   * （见 isEvidenceFromCurrentInvocation）。省略 = 保持旧行为（只判跃迁）。
   */
  invocation?: InvocationIdentity;
  /** 测试注入；缺省走真实文件系统 */
  collect?: (projectRoot: string, feature: string, phase: string) => CompletionEvidenceState;
}): { probe: () => boolean; baselineComplete: boolean; baselineRunId: string | null } {
  const collect =
    input.collect ??
    ((p: string, f: string, ph: string) => collectCompletionEvidence(p, f, ph, input.pathOpts));

  const baseline = collect(input.projectRoot, input.feature, input.phase);
  const baselineComplete = isCompletionEvidenceComplete(baseline);
  let fired = false;

  return {
    baselineComplete,
    baselineRunId: baseline.runId ?? null,
    probe: () => {
      if (baselineComplete || fired) return false;
      const now = collect(input.projectRoot, input.feature, input.phase);
      if (!isCompletionEvidenceComplete(now)) return false;
      // 跃迁成立仍不够：原样复写的旧回执也会造出"不完整→完整"（立项事故形态）。
      if (input.invocation && !isEvidenceFromCurrentInvocation(now, input.invocation)) return false;
      fired = true;
      return true;
    },
  };
}
