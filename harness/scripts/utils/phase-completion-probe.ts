// ============================================================================
// phase-completion-probe.ts — 阶段完成的纯只读 observer
// ----------------------------------------------------------------------------
// plan 07a41ec6 T4：新闭环只认身份匹配的 summary.closure_status=closed。receipt 是
// closed 后的兼容投影，不参与 observer、Stop 或 finalizer。observer 以 invoke 前后的
// open→closed 跃迁避免把既有 closed summary 当成本轮新完成；质量仍由 harness/finalizer 判定。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { featureFilePath, type FeaturePathOptions } from '../../config';

export interface CompletionEvidenceState {
  /** 兼容诊断字段；新闭环恒不读取 receipt。 */
  receipt: boolean;
  /** ② harness summary 在盘且可解析 */
  summary: boolean;
  /** 兼容诊断字段；新闭环不消费 summary.receipt_status。 */
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
  /** legacy 兼容字段；新闭环不消费。 */
  claimedCompletionAtMs?: number;
  /** legacy 兼容字段；新闭环不消费。 */
  receiptSha?: string;
  /** 诊断用：哪一条不满足 */
  missing?: string[];
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
      const identityOk = doc.phase === phase && doc.feature === feature;
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
  out.missing = [...(out.summary ? [] : ['summary']), ...(out.closure ? [] : ['closure_status'])];
  return out;
}

/**
 * 新闭环只认身份匹配的 summary 已提交 `closure_status=closed`。
 */
export function isCompletionEvidenceComplete(s: CompletionEvidenceState): boolean {
  return s.summary && s.closure;
}

/** invocation 身份：observer 判"这份完成证据是不是**本次调用**产出的"所需的全部输入。 */
export interface InvocationIdentity {
  runId?: string | null;
  attemptId?: string | null;
  /** 本次 agent 调用的开始时刻（ms）——legacy 回执无 attempt 字段时的新鲜度下界 */
  startedAtMs: number;
}

/** goal 模式额外核对 summary.run_id；attempt/时间戳由 open→closed 跃迁替代，不读 receipt。 */
export function isEvidenceFromCurrentInvocation(
  s: CompletionEvidenceState,
  id: InvocationIdentity,
): boolean {
  if (id.attemptId) {
    // baseline 的 open→closed 跃迁已证明是本 invocation 新提交；receipt attempt 不再是输入。
    if (!id.runId || s.runId !== id.runId) return false;
    return s.summary && s.closure;
  }
  // 非 goal / 人工模式：run 身份若两侧都有则仍须一致，其余走时间新鲜度。
  if (id.runId && s.runId && s.runId !== id.runId) return false;
  return s.summary && s.closure;
}

// skip 判定已删除：探针只观察本轮 summary 从 open 变 closed。

/**
 * 构造 observer 探针：闭包捕获 invoke 前基线，只在**本次调用内发生跃迁**时返回 true。
 *
 * - 基线已完整 → 恒返回 false；
 * - 基线不完整 → 变完整即命中一次（内部锁存，避免重复触发 kill）。
 */
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
