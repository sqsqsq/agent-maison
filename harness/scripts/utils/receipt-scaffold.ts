// ============================================================================
// receipt-scaffold.ts — 阶段完成回执骨架写入（runner-owned 身份字段）
// （openspec runner-owned-machine-facts）
// ----------------------------------------------------------------------------
// 宿主实证（run 20260815T023016Z-8c66cf）：claimed_attempt_id 让 agent 从环境抄写，
// 而现场有两个格式来源（env MAISON_GOAL_ATTEMPT="i3" / progress.json.phase.attempt=3），
// 抄错 → check-receipt 精确等值 FAIL → 两次 advance_blocked → closure_wall_repeated。
// 抄写不产生可信度：机器已知的身份事实由 runner 写入骨架，agent 只填机器不可替代的自证。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { resolveReceiptFilePath } from '../../config';

export interface ReceiptScaffoldOptions {
  /** goal 态当前 attempt 身份（如 `i3`），由 runner 传入并预填；非 goal 态省略（字段留空）。 */
  attemptId?: string;
  /** true=无条件重建（closure attempt 开始前作废旧回执——上一 attempt 的完整声明不得
   *  让本 attempt 被完成观测提前判完）；false/缺省=已存在则不动（harness PASS 幂等生成）。 */
  force?: boolean;
}

export interface ReceiptScaffoldResult {
  wrote: boolean;
  /** 写入（或已存在）的回执绝对路径；模板缺失等失败时为 null。 */
  receiptPath: string | null;
  /** 未写入且非幂等跳过时的真实原因（路径 + I/O 错误）。goal runner 消费它 fail-closed：
   *  写失败不得静默吞（否则旧身份回执存活 → receipt_attempt_identity → closure_wall）。 */
  failure?: string;
}

/** 模板绝对路径（编译产物与源仓目录结构一致：scripts/utils → ../../templates）。 */
export function receiptTemplatePath(): string {
  return path.join(__dirname, '..', '..', 'templates', 'phase-completion-receipt.md');
}

/**
 * 写回执骨架。身份字段（feature/phase/claimed_attempt_id）由 runner 预填——agent 不得
 * 编辑（goal 态 check-receipt 与 runner 身份精确等值即物理拦截）；自证字段保持占位、
 * 反假设 checkbox 未勾，骨架不构成闭环。失败不抛出，但 `failure` 携带真实原因——
 * goal runner（单点写者）须 fail-closed 停下；非 goal 手动流程可继续 best-effort
 * （agent 从模板手抄自证字段，身份等值校验兜底）。
 */
export function writeReceiptScaffold(
  projectRoot: string,
  feature: string,
  phase: string,
  opts?: ReceiptScaffoldOptions,
): ReceiptScaffoldResult {
  let receiptPath: string | null = null;
  try {
    receiptPath = resolveReceiptFilePath(projectRoot, feature, phase).path;
    if (!opts?.force && fs.existsSync(receiptPath)) {
      return { wrote: false, receiptPath };
    }
    const templatePath = receiptTemplatePath();
    if (!fs.existsSync(templatePath)) {
      return { wrote: false, receiptPath: null, failure: `回执模板缺失：${templatePath}` };
    }
    const skeleton = fs
      .readFileSync(templatePath, 'utf-8')
      .replace('feature: "<feature-name>"', `feature: "${feature}"`)
      .replace('phase: "<spec | plan | coding | review | ut | testing>"', `phase: "${phase}"`)
      .replace('claimed_attempt_id: ""', `claimed_attempt_id: "${opts?.attemptId ?? ''}"`);
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.writeFileSync(receiptPath, skeleton, 'utf-8');
    return { wrote: true, receiptPath };
  } catch (e) {
    return {
      wrote: false,
      receiptPath: null,
      failure: `骨架写入失败（${receiptPath ?? '<路径解析失败>'}）：${(e as Error).message}`,
    };
  }
}
