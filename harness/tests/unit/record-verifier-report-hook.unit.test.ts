// ============================================================================
// record-verifier-report-hook.unit.test.ts — SubagentStop hook 的路由与写面契约
// ============================================================================
// 端到端驱动 agents/claude/templates/hooks/record-verifier-report.mjs（真 spawn）。
//
// 本文件在 plan e5b8c3f7 中被**翻转**了两处固化断言：
//   · 旧 testB 断言「interactive 按 .current-phase.json 写目录」——那正是 2026-04-27
//     引入的根缺陷（触发时读共享状态文件推断归属），被单测固化成了"预期行为"。
//     宿主 bc-openCard-1 的 UT verifier 覆写 coding 报告即由此而来。现在改为：
//     归属只由**调用侧 request JSON**（verifier.request.<subject>.json 的 feature/phase）
//     决定，state 指向哪个阶段完全不影响落盘目标。
//   · 旧 :255 起断言「回写 last_verifier_report / 刷新 last_seen_*」——该写面已
//     整体删除且**不得恢复**（终审确认：Stop 新鲜度实际只读 session_id + updated_at，
//     见 check-phase-completion.mjs）。现在改为断言 state 文件字节零变化。
//
// goal headless 旁路（Fix D，plan ce15ea17 时代）语义保留：不读 state 定位、不写 state、
// 兜底内容不伪装旧 feature；在新契约下它与"身份缺失"同为 bedside fail-closed 的一种。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import {
  verifierReportJsonPath,
  verifierReportMdPath,
} from '../../scripts/utils/verifier-evidence';
import {
  assert,
  buildInvocationPrompt,
  buildResultMessage,
  makeVerifierProject,
  readJson,
  reportsDirOf,
  rmDir,
  runVerifierHook,
  runVerifierRound,
  seedPhase,
  writeAgentTranscript,
  writeCurrentPhaseState,
} from '../utils/verifier-identity-fixture';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function statePath(root: string): string {
  return path.join(root, 'framework', 'harness', 'state', '.current-phase.json');
}

function bedsidePaths(root: string): { md: string; json: string } {
  const dir = path.join(root, 'framework', 'harness', 'state');
  return { md: path.join(dir, 'last-verifier-report.md'), json: path.join(dir, 'last-verifier-report.json') };
}

// --------------------------------------------------------------------------
// A. goal headless 旁路：兜底落盘、不伪装旧 feature、不碰 state
// --------------------------------------------------------------------------
function testA_goalHeadlessBypass(): void {
  const { root } = makeVerifierProject();
  try {
    const coding = seedPhase(root, 'X', 'coding');
    const sp = writeCurrentPhaseState(root, 'X', 'coding', 'sid-old');
    const stateBefore = fs.readFileSync(sp, 'utf-8');

    const out = runVerifierRound({
      root,
      feature: 'X',
      phase: 'coding',
      requestPath: coding.requestPath,
      subjectId: coding.subjectId,
      env: { MAISON_GOAL_HEADLESS: '1' },
    });
    assert(out.status === 0, `A exit 0：${out.stderr}`);

    assert(
      !fs.existsSync(verifierReportJsonPath(reportsDirOf(root, 'X', 'coding'), coding.subjectId)),
      'A goal headless 是**非权威旁路**，不得发布 canonical 机器证据',
    );
    const { md, json } = bedsidePaths(root);
    assert(fs.existsSync(md) && fs.existsSync(json), 'A 应落 last-verifier-report.{md,json} bedside');

    const doc = readJson(json);
    assert(doc.state === 'bedside', `A bedside state，实得 ${String(doc.state)}`);
    assert(doc.reason === 'goal_headless', `A reason=goal_headless，实得 ${String(doc.reason)}`);
    assert(doc.goal_headless === true, 'A 应标 goal_headless');
    assert(doc.subject_id === coding.subjectId, 'A bedside 仍携带 subject（可追溯，只是不权威）');
    assert(!fs.readFileSync(md, 'utf-8').includes('feature: X'), 'A bedside MD 不得伪装成某个阶段的正式报告');

    assert(fs.readFileSync(sp, 'utf-8') === stateBefore, 'A 不得触碰 .current-phase.json（读定位与写回都已退出）');
  } finally {
    rmDir(root);
  }
}

// --------------------------------------------------------------------------
// B（断言翻转）：归属由调用侧机器块决定，**不再**按 .current-phase.json 路由
// --------------------------------------------------------------------------
function testB_routingComesFromInvocationNotState(): void {
  const { root } = makeVerifierProject();
  try {
    const ut = seedPhase(root, 'X', 'ut');
    // 全局 state 指向 coding——旧实现会把这次 UT verifier 的结论写进 coding。
    seedPhase(root, 'X', 'coding');
    const sp = writeCurrentPhaseState(root, 'X', 'coding', 'sid-old');
    const stateBefore = fs.readFileSync(sp, 'utf-8');

    const out = runVerifierRound({
      root,
      feature: 'X',
      phase: 'ut',
      requestPath: ut.requestPath,
      subjectId: ut.subjectId,
      agentId: 'agent-ut-1',
    });
    assert(out.status === 0, `B exit 0：${out.stderr}`);

    const utJson = verifierReportJsonPath(reportsDirOf(root, 'X', 'ut'), ut.subjectId);
    const codingJson = verifierReportJsonPath(reportsDirOf(root, 'X', 'coding'), ut.subjectId);
    assert(fs.existsSync(utJson), 'B 应写 X/ut 的 canonical 证据（归属来自机器块）');
    assert(!fs.existsSync(codingJson), 'B **不得**按 state 写进 X/coding —— 这正是被翻转的旧断言');

    const doc = readJson(utJson);
    assert(doc.phase === 'ut' && doc.feature === 'X', `B 落盘阶段应为 X/ut，实得 ${String(doc.feature)}/${String(doc.phase)}`);
    assert(doc.invocation_subject === ut.subjectId && doc.result_subject === ut.subjectId, 'B 两个 subject 须分别存档');
    assert(doc.agent_id === 'agent-ut-1', 'B 须记录子 agent 身份');
    assert(
      fs.existsSync(verifierReportMdPath(reportsDirOf(root, 'X', 'ut'), ut.subjectId)),
      'B 人读投影照常生成（机器不解析）',
    );
  } finally {
    rmDir(root);
  }
}

// --------------------------------------------------------------------------
// C（断言翻转）：state 写面已整体删除，且不得恢复
// --------------------------------------------------------------------------
function testC_hookNeverWritesPhaseState(): void {
  const { root } = makeVerifierProject();
  try {
    const coding = seedPhase(root, 'X', 'coding');
    const sp = writeCurrentPhaseState(root, 'X', 'coding', 'sid-old');
    const stateBefore = fs.readFileSync(sp, 'utf-8');

    const out = runVerifierRound({
      root,
      feature: 'X',
      phase: 'coding',
      requestPath: coding.requestPath,
      subjectId: coding.subjectId,
      payloadOverride: { session_id: 'sid-new' },
    });
    assert(out.status === 0, `C exit 0：${out.stderr}`);
    assert(
      fs.existsSync(verifierReportJsonPath(reportsDirOf(root, 'X', 'coding'), coding.subjectId)),
      'C 前提：证据确已发布',
    );

    const after = fs.readFileSync(sp, 'utf-8');
    assert(after === stateBefore, 'C hook 已完全退出 .current-phase.json 写面（字节须零变化）');
    const state = JSON.parse(after) as Record<string, unknown>;
    assert(!('last_verifier_report' in state), 'C 不得恢复 last_verifier_report 写回');
    assert(state.last_seen_session_id === 'sid-old', 'C 不得刷新 last_seen_session_id（Stop 新鲜度由 runner/check-receipt 维护）');
  } finally {
    rmDir(root);
  }
}

// --------------------------------------------------------------------------
// D：stop_hook_active=true 短路（协议约定，避免自触发循环）
// --------------------------------------------------------------------------
function testD_stopHookActiveShortCircuits(): void {
  const { root } = makeVerifierProject();
  try {
    const coding = seedPhase(root, 'X', 'coding');
    const transcript = writeAgentTranscript(root, 'loop', buildInvocationPrompt(coding.requestPath));
    const out = runVerifierHook(root, {
      stop_hook_active: true,
      agent_id: 'agent-loop',
      agent_transcript_path: transcript,
      last_assistant_message: buildResultMessage(coding.subjectId, 'PASS'),
    });
    assert(out.status === 0, 'D exit 0');
    assert(
      !fs.existsSync(verifierReportJsonPath(reportsDirOf(root, 'X', 'coding'), coding.subjectId)),
      'D stop_hook_active=true 时必须整体短路，不落任何盘',
    );
    assert(!fs.existsSync(bedsidePaths(root).json), 'D 短路时连 bedside 都不写');
  } finally {
    rmDir(root);
  }
}

const CASES: Array<{ name: string; fn: () => void }> = [
  { name: 'A MAISON_GOAL_HEADLESS=1 旁路：非权威 bedside、携 subject、不碰 state', fn: testA_goalHeadlessBypass },
  { name: 'B 断言翻转：归属来自调用侧机器块，state 指向别的阶段也不得串台', fn: testB_routingComesFromInvocationNotState },
  { name: 'C 断言翻转：hook 完全退出 .current-phase.json 写面（字节零变化，不得恢复）', fn: testC_hookNeverWritesPhaseState },
  { name: 'D stop_hook_active=true 整体短路', fn: testD_stopHookActiveShortCircuits },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of CASES) {
    try {
      c.fn();
      results.push({ name: c.name, ok: true });
    } catch (err) {
      results.push({ name: c.name, ok: false, error: (err as Error).message });
    }
  }
  return results;
}
