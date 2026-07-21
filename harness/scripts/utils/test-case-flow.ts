// ============================================================================
// test-case-flow.ts — 真机用例结构化 DAG（visual-capability-truth S6 / P1-I）
// ----------------------------------------------------------------------------
// 20260718 事故：单 session 状态链 TC-003 挂 → TC-004~008/010 级联，7 FAIL 被读成
// 7 个独立产品缺陷。机器 SSOT=test-plan.md 顶层 `test_case_flow` YAML 块（tc_id 为
// key；与 Markdown TC 表完全一致性门禁——防人审表与执行 DAG 双 SSOT 漂移）。
// 硬边界（codex plan 审查二轮）：BLOCKED_BY **不是 PASS**——仍进 P0 分母、仍阻
// completion、device_test_run 仍 FAIL；唯一变化=根因归类（root/blocked/independent）。
// reset 命令失败归 environment（BLOCKED_BY_ENV），非产品根因。
// ============================================================================

import * as YAML from 'yaml';

export interface TestCasePrecondition {
  kind: 'fresh_app' | 'after';
  /** kind=after：单前置 */
  tc?: string;
  /** kind=after：多前置（任一失败即 BLOCKED） */
  tcs?: string[];
  reset?: 'restart' | 'clear_data' | 'fixture_reset';
}

export type TestCaseFlow = Record<string, { precondition: TestCasePrecondition }>;

/** 从 test-plan.md 提取顶层 test_case_flow YAML 块（```yaml 围栏内含 test_case_flow: 根键） */
export function parseTestCaseFlowBlock(md: string): { flow: TestCaseFlow | null; error?: string } {
  const fences = [...md.matchAll(/```ya?ml\r?\n([\s\S]*?)```/g)];
  for (const f of fences) {
    if (!/^\s*test_case_flow\s*:/m.test(f[1])) continue;
    try {
      const parsed = YAML.parse(f[1]) as { test_case_flow?: unknown };
      const raw = parsed?.test_case_flow;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { flow: null, error: 'test_case_flow 须为以 tc_id 为 key 的映射' };
      }
      const flow: TestCaseFlow = {};
      for (const [tc, v] of Object.entries(raw as Record<string, unknown>)) {
        const rec = (v ?? {}) as { precondition?: unknown };
        const pre = rec.precondition as TestCasePrecondition | undefined;
        if (!pre || (pre.kind !== 'fresh_app' && pre.kind !== 'after')) {
          return { flow: null, error: `test_case_flow['${tc}'].precondition.kind 须为 fresh_app|after` };
        }
        flow[tc] = { precondition: pre };
      }
      return { flow };
    } catch (e) {
      return { flow: null, error: `test_case_flow YAML 解析失败：${(e as Error).message}` };
    }
  }
  return { flow: null };
}

function prereqsOf(p: TestCasePrecondition): string[] {
  if (p.kind !== 'after') return [];
  return [...(p.tc ? [p.tc] : []), ...(p.tcs ?? [])];
}

/** 一致性 + 引用校验：与 Markdown TC 集完全一致；after 引用存在、无环。 */
export function validateTestCaseFlow(flow: TestCaseFlow, markdownTcIds: string[]): string[] {
  const errors: string[] = [];
  const flowIds = new Set(Object.keys(flow));
  const mdIds = new Set(markdownTcIds);
  for (const id of mdIds) {
    if (!flowIds.has(id)) errors.push(`Markdown 表有 ${id} 但 test_case_flow 缺条目（双 SSOT 漂移）`);
  }
  for (const id of flowIds) {
    if (!mdIds.has(id)) errors.push(`test_case_flow 有 ${id} 但 Markdown 表无此用例（双 SSOT 漂移）`);
  }
  for (const [id, entry] of Object.entries(flow)) {
    for (const dep of prereqsOf(entry.precondition)) {
      if (!flowIds.has(dep)) errors.push(`${id} 的 after 引用不存在的用例 ${dep}`);
    }
  }
  // 环检测（DFS 三色）
  const color = new Map<string, 0 | 1 | 2>();
  const visit = (id: string, trail: string[]): void => {
    const c = color.get(id) ?? 0;
    if (c === 1) {
      errors.push(`after 依赖成环：${[...trail, id].join(' → ')}`);
      return;
    }
    if (c === 2) return;
    color.set(id, 1);
    for (const dep of prereqsOf(flow[id]?.precondition ?? { kind: 'fresh_app' })) {
      if (flow[dep]) visit(dep, [...trail, id]);
    }
    color.set(id, 2);
  };
  for (const id of flowIds) visit(id, []);
  return [...new Set(errors)];
}

export type CascadeClass = 'root_fail' | 'blocked_by' | 'independent_fail';

export interface CascadeTriage {
  /** tc → 分类；blocked_by 附根因 tc（直接或传递） */
  byCase: Record<string, { class: CascadeClass; blocked_by?: string }>;
  rootFails: string[];
  blocked: string[];
  independentFails: string[];
}

/**
 * 级联归类（**不改变通过率与 verdict**——只做根因三分）：失败用例若其 after 链上
 * （直接或传递）存在更早的失败前置 → blocked_by（根因=链上最近失败前置的根因）；
 * 否则 root/independent（有无下游被其阻塞区分展示语义，判定相同）。
 */
export function triageCascade(flow: TestCaseFlow, failedIds: string[]): CascadeTriage {
  const failed = new Set(failedIds);
  const rootOf = new Map<string, string | null>();
  const resolveRoot = (id: string, seen: Set<string>): string | null => {
    if (rootOf.has(id)) return rootOf.get(id)!;
    if (seen.has(id)) return null;
    seen.add(id);
    for (const dep of prereqsOf(flow[id]?.precondition ?? { kind: 'fresh_app' })) {
      if (failed.has(dep)) {
        const upstream = resolveRoot(dep, seen);
        const root = upstream ?? dep;
        rootOf.set(id, root);
        return root;
      }
      const transitive = resolveRoot(dep, seen);
      if (transitive) {
        rootOf.set(id, transitive);
        return transitive;
      }
    }
    rootOf.set(id, null);
    return null;
  };
  const byCase: CascadeTriage['byCase'] = {};
  const rootFails: string[] = [];
  const blocked: string[] = [];
  for (const id of failedIds) {
    const root = resolveRoot(id, new Set());
    if (root && root !== id) {
      byCase[id] = { class: 'blocked_by', blocked_by: root };
      blocked.push(id);
    } else {
      byCase[id] = { class: 'root_fail' };
      rootFails.push(id);
    }
  }
  const blockedTargets = new Set(blocked.map(b => byCase[b].blocked_by));
  const independentFails = rootFails.filter(r => !blockedTargets.has(r));
  for (const r of independentFails) byCase[r] = { class: 'independent_fail' };
  return { byCase, rootFails: rootFails.filter(r => blockedTargets.has(r)), blocked, independentFails };
}
