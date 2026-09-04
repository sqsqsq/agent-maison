// ============================================================================
// p0-identity-injection.ts — P0 身份断言注入（plan 07a41ec6 T3 / openspec
// efficiency-first-closure「P0 identity assertions are injected when the derived plan is loaded」）
// ----------------------------------------------------------------------------
// 宿主 bc-openCard-1 2026-09-02：派生 AI 给 P0 断言写了 `visible:true`，Hylyre 把
// request.kind 判成 composite，身份门不认，P0 覆盖静默归零。根因不是谓词错，而是
// "UX 谓词断言"被当成"身份证据"。本模块把两者拆开：
//   · 身份证据 = harness 按 acceptance checkpoint 注入的**精确形状**裸断言
//     {"wait_for":{"by_id":<id>,"timeout":N}} / {"wait_gone":{"by_id":<id>,"timeout":N}}；
//   · 代理写的 visible/enabled/布局/内容谓词断言原样保留，是独立的 UX 断言，不删不改。
// 注入发生在派生计划复制进 run 目录时（源文件不改）；只在 checkpoint action 与插入位置
// 唯一确定时注入，多候选输出 actionable gap（invalid_test），不猜；scroll/swipe 不改 touch。
// 不维护任何 Hylyre 约束键镜像：身份以"精确形状"定义。
// ============================================================================

import { extractAcceptanceIdRefs } from './check-acceptance';
import {
  extractDerivedPlanCases,
  normalizePlannedStepsCell,
  parsePlannedStepsFromCell,
} from './derived-hylyre-plan';
import {
  canonicalIdsForPlannedStep,
  normalizePlannedStep,
  type CanonicalSelectorIndex,
} from './planned-step-normalizer';
import {
  checkpointComplete,
  findActionStepCandidates,
  isBareIdentityAssertion,
  isP0DeviceInteractive,
  parsePlanTcEntries,
  type AcceptanceFlowsDoc,
} from './p0-semantic-gates';

export const P0_IDENTITY_TIMEOUT_DEFAULT = 10;

export type IdentityAssertionKind = 'wait_for' | 'wait_gone';

export interface InjectionRecord {
  tc_id: string;
  ac_id: string;
  element_id: string;
  kind: IdentityAssertionKind;
  /** 注入后在该 case 步骤数组中的 index */
  index: number;
}

export interface InjectionGap {
  tc_id: string;
  ac_id: string;
  rule_id: 'STEP-P0-IDENTITY' | 'STEP-BYTEXT-ORDER';
  /** 含 TC / step / 实际形状 / 期望形状 / 改法 */
  message: string;
  candidates?: number[];
}

export interface InjectionResult {
  /** 注入后的派生计划正文（未变化时与输入逐字相同） */
  content: string;
  injected: InjectionRecord[];
  gaps: InjectionGap[];
  changed: boolean;
}

export interface InjectionInput {
  derivedMd: string;
  /** 顶层 test-plan.md（TC → 关联 AC 的结构化来源；可为空串） */
  topPlanMd: string;
  acceptance: AcceptanceFlowsDoc | null;
  /** ui-spec canonical 索引；null 时 by_text 无法映射身份，只认 by_id 字面 */
  canonical: CanonicalSelectorIndex | null;
  timeout?: number;
}

type Step = Record<string, unknown>;

function firstByTextAssertionIndexFor(
  steps: Step[],
  elementId: string,
  canonical: CanonicalSelectorIndex | null,
  afterIndex: number,
): number | null {
  if (!canonical) return null;
  for (let i = afterIndex + 1; i < steps.length; i += 1) {
    const info = normalizePlannedStep(steps[i], i);
    if (info.role !== 'assertion' || info.selector?.kind !== 'by_text') continue;
    if (canonicalIdsForPlannedStep(info, canonical).includes(elementId)) return i;
  }
  return null;
}

function bareIdentityIndex(steps: Step[], kind: IdentityAssertionKind, elementId: string, afterIndex: number): number | null {
  for (let i = afterIndex + 1; i < steps.length; i += 1) {
    if (isBareIdentityAssertion(steps[i], kind, elementId)) return i;
  }
  return null;
}

/**
 * 对派生计划的每个 case，按 acceptance 的 P0 checkpoint 注入身份断言。
 * 幂等：已有等价裸断言不重复；源 markdown 只在有注入时才重写对应行的「测试步骤」单元格。
 */
export function injectP0IdentityAssertions(input: InjectionInput): InjectionResult {
  const timeout = input.timeout ?? P0_IDENTITY_TIMEOUT_DEFAULT;
  const injected: InjectionRecord[] = [];
  const gaps: InjectionGap[] = [];
  const p0Acs = (input.acceptance?.criteria ?? [])
    .filter(isP0DeviceInteractive)
    .filter(ac => checkpointComplete(ac.checkpoint));
  if (p0Acs.length === 0) return { content: input.derivedMd, injected, gaps, changed: false };

  const topRefs = new Map<string, string[]>();
  for (const entry of parsePlanTcEntries(input.topPlanMd || '')) topRefs.set(entry.id, entry.acRefs);

  const rewritten = new Map<string, string>();
  for (const row of extractDerivedPlanCases(input.derivedMd)) {
    const refs = new Set<string>([
      ...(topRefs.get(row.tc_id) ?? []),
      ...extractAcceptanceIdRefs(row.ac_ref),
    ].map(id => id.toUpperCase()));
    const acs = p0Acs.filter(ac => refs.has(ac.id.toUpperCase()));
    if (acs.length === 0) continue;
    const parsed = parsePlannedStepsFromCell(normalizePlannedStepsCell(row.steps_raw));
    if (!parsed.ok) continue; // 解析失败由 STEP-001 报，这里不重复

    const steps: Step[] = [...parsed.steps];
    let changedRow = false;
    for (const ac of acs) {
      const cp = ac.checkpoint!;
      const target = cp.action!.target_element_id!;
      const candidates = findActionStepCandidates(steps, target, input.canonical, cp.pre_screen);
      if (candidates.length === 0) {
        gaps.push({
          tc_id: row.tc_id,
          ac_id: ac.id,
          rule_id: 'STEP-P0-IDENTITY',
          message:
            `${row.tc_id} 没有任何 action 步骤绑定 ${ac.id} 的 checkpoint 元素 ${target}` +
            `（期望形状：{"touch"|"input"|"swipe"|"scroll":{"by_id":"${target}",…}}，或 by_text 经 ui-spec 映射到该 id）；` +
            '无法注入身份断言。改法：在该 case 补一步触发动作，或修正 acceptance checkpoint.action.target_element_id。',
        });
        continue;
      }
      if (candidates.length > 1) {
        gaps.push({
          tc_id: row.tc_id,
          ac_id: ac.id,
          rule_id: 'STEP-P0-IDENTITY',
          candidates,
          message:
            `${row.tc_id} 有多个 action 步骤都绑定 ${ac.id} 的 checkpoint 元素 ${target}（step ${candidates.join(', ')}），` +
            '注入位置不唯一，不猜。改法：把重复动作拆到不同 case，或只保留一次触发动作。',
        });
        continue;
      }
      const actionIndex = candidates[0];
      let cursor = actionIndex + 1;
      const wanted: Array<{ id: string; kind: IdentityAssertionKind }> = [
        ...(cp.required_element_ids ?? []).map(id => ({ id, kind: 'wait_for' as const })),
        ...(cp.forbidden_element_ids ?? []).map(id => ({ id, kind: 'wait_gone' as const })),
      ];
      for (const want of wanted) {
        const existing = bareIdentityIndex(steps, want.kind, want.id, actionIndex);
        const firstByText = firstByTextAssertionIndexFor(steps, want.id, input.canonical, actionIndex);
        if (existing !== null) {
          if (firstByText !== null && firstByText < existing) {
            gaps.push({
              tc_id: row.tc_id,
              ac_id: ac.id,
              rule_id: 'STEP-BYTEXT-ORDER',
              message:
                `${row.tc_id} step ${firstByText} 的 by_text 断言先于 step ${existing} 的身份断言（同指 ${want.id}）；` +
                'P0 身份覆盖取首个匹配，by_text 不构成 id 身份证明。改法：把 step ' +
                `${firstByText} 移到 step ${existing} 之后。`,
            });
          }
          cursor = Math.max(cursor, existing + 1);
          continue;
        }
        const insertAt = firstByText !== null && firstByText < cursor ? firstByText : cursor;
        steps.splice(insertAt, 0, { [want.kind]: { by_id: want.id, timeout } });
        injected.push({ tc_id: row.tc_id, ac_id: ac.id, element_id: want.id, kind: want.kind, index: insertAt });
        cursor = insertAt + 1;
        changedRow = true;
      }
    }
    if (changedRow) rewritten.set(row.tc_id, steps.map(step => JSON.stringify(step)).join(' ; '));
  }

  if (rewritten.size === 0) return { content: input.derivedMd, injected, gaps, changed: false };
  return { content: rewriteStepsCells(input.derivedMd, rewritten), injected, gaps, changed: true };
}

function splitPipeRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
  return trimmed.slice(1, -1).split('|').map(cell => cell.trim());
}

/** 只重写有注入的行的「测试步骤」单元格；其余行逐字保留。 */
export function rewriteStepsCells(derivedMd: string, rewritten: Map<string, string>): string {
  const lines = derivedMd.split('\n');
  let idCol = -1;
  let stepsCol = -1;
  let inTable = false;
  for (let i = 0; i < lines.length; i += 1) {
    const cells = splitPipeRow(lines[i]);
    if (!cells) {
      inTable = false;
      continue;
    }
    if (!inTable) {
      const id = cells.findIndex(c => /用例编号|编号/.test(c));
      const steps = cells.findIndex(c => /测试步骤|步骤/.test(c));
      if (id >= 0 && steps >= 0 && i + 1 < lines.length && /^\s*\|[\s\-|:]+\|\s*$/.test(lines[i + 1])) {
        idCol = id;
        stepsCol = steps;
        inTable = true;
        i += 1; // 跳过分隔行
      }
      continue;
    }
    const tc = (cells[idCol] ?? '').match(/TC-\d+/i)?.[0]?.toUpperCase();
    if (!tc || !rewritten.has(tc) || stepsCol >= cells.length) continue;
    cells[stepsCol] = rewritten.get(tc)!;
    lines[i] = `| ${cells.join(' | ')} |`;
  }
  return lines.join('\n');
}
