// ============================================================================
// execution-channel-evidence.ts — 非 Hylyre 通道的 per-TC 证据绑定
//                                  （plan a6c4e9f2 T3 / tasks 6.5b）
// ----------------------------------------------------------------------------
// 6.5a 把 manual / visual / provider 三条通道一律 fail-closed，理由写得很清楚：
// Maison 当时没有 TC→证据的机器映射，任何"通道分派"都会变成新逃生口
// （派生 AI 只要把 TC 标成 visual，就能绕开 Hylyre 证据链）。
//
// 6.5b 只解决其中**可以被机器证明**的那一条：
//
//   visual   —— 可绑定。链路全程走既有结构化数据，不解析散文：
//               顶层 test-plan 的 TC 行 → `关联 AC` 列的 AC id
//               → acceptance.yaml 的 criterion.checkpoint.pre_screen / post_screen
//               → visual-diff.json 的同名 `screen_id` 逐屏结论。
//               四段都是 id 对 id，任何一段断掉就是 unbound（FAIL），不猜。
//
// ⚠ 本模块第一版有两处必须记下来的错（外部 review 查出）：
//   1. **读错路径**：拿 `featurePhaseReportsDir`（= `doc/features/<f>/testing/reports`）
//      去拼 `device-testing/device-screenshots/`，而权威文件在
//      `doc/features/<f>/device-testing/device-screenshots/visual-diff.json`。
//      后果是 available 恒 false、visual TC 恒 unbound——方向上是哑弹（仍 FAIL），
//      但等于 6.5b 完全没生效。
//   2. **自造弱解析器**：只读 `screen_id → verdict`，既不校 schema，也不看
//      `evaluated_screenshot_hash` / `evaluated_build_fingerprint` / `evaluation_invalidated`。
//      这一条如果配上正确路径，才是真正的逃生口：一份手改的极简 JSON 就能把 TC 洗绿。
//   现在改为**复用既有** `validateVisualDiffJson` + `isStaleVisualDiffVerdict` +
//   `isMissingEvaluatedScreenshotHash`，并要求本轮 visual 门自身 PASS，不另建第二判据。
//
//   provider —— **今天无法绑定，保持 fail-closed**。这不是偷懒：capability 解析记录
//               （summary.capability_resolutions）是 **feature 级、按 capability id** 的，
//               只有 `state=resolved|pruned|blocked|not_applicable`，**没有 TC 维度**；
//               `profiles/*/harness/providers/` 下也没有任何 provider 产出 per-TC 结果。
//               "某个能力在场"根本不证明"某个 TC 执行并通过了"。
//               让它可通过的前提写在 `PROVIDER_EVIDENCE_CONTRACT`，由 provider 侧先实现。
//
//   manual   —— **冻结设计**，永远 fail-closed。人工确认、confirmed_by、质量 receipt、
//               manual resume 都不构成机器质量证据。
//
// 安全方向：本模块只可能把"本来就 FAIL"的 TC 改判为 covered，因此每一条判据都取
// **拒绝可疑**方向——缺映射、缺产物、缺条目、verdict 非 pass，一律 unbound。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import { featureDir } from '../../config';
import { extractAcceptanceIdRefs } from './check-acceptance';
import { extractTables, getSectionContent, type MdTable } from './markdown-parser';
import type { AcceptanceFlowsDoc } from './p0-semantic-gates';
import {
  isMissingEvaluatedScreenshotHash,
  isStaleVisualDiffVerdict,
  validateVisualDiffJson,
} from '../../../profiles/hmos-app/harness/visual-diff-check';

/** provider 通道要变成可绑定，provider 侧必须先满足的最小契约。 */
export const PROVIDER_EVIDENCE_CONTRACT =
  'provider 通道要可通过，执行该通道的 capability provider 必须产出 per-TC 结果：' +
  '至少包含 tc_id、机器判定的 outcome、以及可复核的产物引用（路径 + sha256）；' +
  '并与本次 run 的身份绑定。当前 capability 解析记录只有 feature 级的 ' +
  'state（resolved/pruned/blocked/not_applicable），没有 TC 维度——' +
  '"能力在场"不证明"该 TC 执行并通过"，因此不得据此放行。';

export type ChannelEvidenceVerdict =
  /** 机器证据齐备且为通过 */
  | { kind: 'covered'; detail: string }
  /** 证据齐备但判定不通过 */
  | { kind: 'failed'; detail: string }
  /** 无法建立 TC→证据的机器绑定（缺映射/缺产物/缺条目） */
  | { kind: 'unbound'; detail: string }
  /** 该通道在设计上就没有机器质量 PASS 载体 */
  | { kind: 'not_machine_provable'; detail: string };

export interface ChannelEvidenceBinding {
  tc_id: string;
  channel: 'visual' | 'provider' | 'manual';
  verdict: ChannelEvidenceVerdict;
}

// ---------------------------------------------------------------------------
// TC → AC（顶层计划的结构化列，不解析散文）
// ---------------------------------------------------------------------------

function pickColumnIndex(table: MdTable, keywords: string[]): number {
  for (const kw of keywords) {
    const idx = table.headers.findIndex(h => h.toLowerCase().includes(kw.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return -1;
}

/**
 * 从顶层 `test-plan.md` 的「测试用例」首表读出 TC → 关联 AC。
 *
 * 只读**结构化的 `关联 AC` 列**。不从用例名称、备注、报告散文里抽 AC——
 * 那正是 plan 反复禁止的"从散文推断责任"。
 */
export function extractTcAcceptanceRefs(planMd: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const section = getSectionContent(planMd, '测试用例') ?? getSectionContent(planMd, '测试用例清单') ?? '';
  const tables = extractTables(section || planMd);
  if (tables.length === 0) return out;
  const table = tables[0];
  const idCol = pickColumnIndex(table, ['用例编号', '编号', 'TC-ID', 'TC ID']);
  const acCol = pickColumnIndex(table, ['关联 AC', '关联']);
  if (acCol < 0) return out;
  for (const row of table.rows) {
    const tcRaw = (idCol >= 0 ? row[idCol] : row[0] || '').trim();
    const matched = tcRaw.match(/TC-\d+/i);
    if (!matched) continue;
    out.set(matched[0].toUpperCase(), extractAcceptanceIdRefs(row[acCol] ?? ''));
  }
  return out;
}

// ---------------------------------------------------------------------------
// visual-diff.json 的逐屏 verdict
// ---------------------------------------------------------------------------

export interface VisualScreenVerdicts {
  /** 产物可读、合 schema、且本轮 visual 门自身通过；false 时 byScreen 必为空 */
  available: boolean;
  detail: string;
  /** screen_id → 该屏是否可作为"本轮已通过"的证据 */
  byScreen: Map<string, ScreenEvidence>;
}

export interface ScreenEvidence {
  verdict: string;
  /** 新鲜度/身份复核后是否仍然算通过 */
  usable: boolean;
  /** usable=false 时的原因 */
  reason?: string;
}

export interface VisualEvidenceOptions {
  projectRoot: string;
  feature: string;
  /** 本轮 build 指纹；给了才能判"旧 build 的结论不算数" */
  currentBuildFingerprint?: string | null;
  /**
   * 本轮 `visual_diff` 门的实际结论。**必须由调用方在 visual 检查跑完之后传入**——
   * 缺省视为未通过。证据义务不能早于产生证据的那一步执行。
   */
  visualGateStatus?: string | null;
}

/**
 * 载入本 feature 的 authoritative `visual-diff.json` 并逐屏判定"可否作为本轮证据"。
 *
 * 路径基准是 **feature 目录**（`doc/features/<feature>/device-testing/device-screenshots/`），
 * 与 `visual-diff-check` / `visual-diff-capture` / `visual-feedback` 完全一致；
 * 不是 phase reports 目录。
 */
export function loadVisualScreenVerdicts(opts: VisualEvidenceOptions): VisualScreenVerdicts {
  const empty = (detail: string): VisualScreenVerdicts =>
    ({ available: false, detail, byScreen: new Map() });

  // 证据义务必须晚于证据产生：visual 门没跑通就没有"本轮结论"可消费。
  const gate = (opts.visualGateStatus ?? '').toUpperCase();
  if (gate !== 'PASS') {
    return empty(`本轮 visual_diff 门未通过（status=${opts.visualGateStatus ?? '(未执行)'}），无本轮视觉证据可消费`);
  }

  const file = path.join(
    featureDir(opts.projectRoot, opts.feature),
    'device-testing', 'device-screenshots', 'visual-diff.json',
  );
  if (!fs.existsSync(file)) return empty(`visual-diff.json 不存在：${file}`);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    return empty(`visual-diff.json 解析失败：${(e as Error).message}`);
  }

  // 复用既有权威校验器，而不是只读 verdict——手改的极简 JSON 必须在这里就被拒。
  const validated = validateVisualDiffJson(raw, opts.projectRoot);
  if (!validated.report) {
    return empty(`visual-diff.json 不合 schema：${validated.errors.slice(0, 4).join('；')}`);
  }
  if (validated.fatal) {
    return empty(`visual-diff.json 结构性错误：${validated.errors.slice(0, 4).join('；')}`);
  }

  const byScreen = new Map<string, ScreenEvidence>();
  for (const screen of validated.report.screens ?? []) {
    const id = typeof screen.screen_id === 'string' ? screen.screen_id.trim() : '';
    if (!id) continue;
    const verdict = String(screen.verdict ?? '');
    let usable = verdict === 'pass';
    let reason: string | undefined;
    if (!usable) {
      reason = `verdict=${verdict || '(空)'}`;
    } else if (isMissingEvaluatedScreenshotHash(screen)) {
      usable = false;
      reason = '缺 evaluated_screenshot_hash——未绑定具体那张截图，pass 无从复核';
    } else if (
      isStaleVisualDiffVerdict(screen, opts.projectRoot, {
        currentBuildFingerprint: opts.currentBuildFingerprint ?? null,
      })
    ) {
      usable = false;
      reason = '结论已失效：截图 hash 与盘上文件不符，或 evaluated_build_fingerprint 非本轮 build';
    } else if (screen.evaluation_invalidated === true) {
      usable = false;
      reason = 'evaluation_invalidated=true，该屏评估产物须重评';
    }
    byScreen.set(id, { verdict, usable, ...(reason ? { reason } : {}) });
  }
  return {
    available: true,
    detail: `visual-diff.json 载入 ${byScreen.size} 屏（本轮 visual 门 PASS）`,
    byScreen,
  };
}

// ---------------------------------------------------------------------------
// 绑定
// ---------------------------------------------------------------------------

/** 一个 AC 的结构化 checkpoint 声明了哪些屏（唯一合法来源）。 */
function checkpointScreens(doc: AcceptanceFlowsDoc | null, acId: string): string[] {
  const criterion = doc?.criteria.find(c => (c.id ?? '').toUpperCase() === acId.toUpperCase());
  const cp = criterion?.checkpoint;
  if (!cp) return [];
  return [cp.pre_screen, cp.post_screen]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map(v => v.trim());
}

export interface ChannelEvidenceInput {
  /** 顶层 test-plan.md 全文 */
  planMd: string | null;
  acceptance: AcceptanceFlowsDoc | null;
  visual: VisualScreenVerdicts;
  visualTcIds: string[];
  providerTcIds: Array<{ tc_id: string; provider_id: string }>;
  manualTcIds: string[];
}

/**
 * 为非 Hylyre 通道的每个 TC 给出机器裁决。
 *
 * 调用方（`testing_channel_evidence_obligation`）据此决定 FAIL 明细：
 * 只有全部为 `covered` 才允许该门通过。
 */
export function bindChannelEvidence(input: ChannelEvidenceInput): ChannelEvidenceBinding[] {
  const out: ChannelEvidenceBinding[] = [];
  const tcToAc = input.planMd ? extractTcAcceptanceRefs(input.planMd) : new Map<string, string[]>();

  for (const tcId of input.visualTcIds) {
    out.push({ tc_id: tcId, channel: 'visual', verdict: bindVisualTc(tcId, tcToAc, input) });
  }
  for (const item of input.providerTcIds) {
    out.push({
      tc_id: item.tc_id,
      channel: 'provider',
      verdict: {
        kind: 'unbound',
        detail:
          `provider:${item.provider_id} 没有 per-TC 证据载体——capability 解析记录是 feature 级、` +
          `按 capability id 的（只有 state），providers 侧也不产出 TC 维度结果。${PROVIDER_EVIDENCE_CONTRACT}`,
      },
    });
  }
  for (const tcId of input.manualTcIds) {
    out.push({
      tc_id: tcId,
      channel: 'manual',
      verdict: {
        kind: 'not_machine_provable',
        detail:
          'manual 没有机器质量 PASS 载体，这是冻结设计而不是执行器缺陷；' +
          '人工确认 / confirmed_by / 质量 receipt / manual resume 都不构成本轮通过证据。',
      },
    });
  }
  return out;
}

function bindVisualTc(
  tcId: string,
  tcToAc: Map<string, string[]>,
  input: ChannelEvidenceInput,
): ChannelEvidenceVerdict {
  const acIds = tcToAc.get(tcId) ?? [];
  if (acIds.length === 0) {
    return {
      kind: 'unbound',
      detail: `顶层计划未给 ${tcId} 声明结构化「关联 AC」，无法把它绑到任何视觉目标（不从用例名/备注猜）`,
    };
  }
  const screens: string[] = [];
  const acWithoutScreens: string[] = [];
  for (const acId of acIds) {
    const found = checkpointScreens(input.acceptance, acId);
    if (found.length === 0) acWithoutScreens.push(acId);
    else screens.push(...found);
  }
  if (acWithoutScreens.length > 0) {
    return {
      kind: 'unbound',
      detail:
        `${acWithoutScreens.join('、')} 的 acceptance checkpoint 没有声明 pre_screen/post_screen，` +
        '视觉目标无法机器确定（checkpoint 是唯一合法来源，不用 linked_flow/散文兜底）',
    };
  }
  const unique = [...new Set(screens)];
  if (!input.visual.available) {
    return { kind: 'unbound', detail: `${tcId} 已绑定屏 ${unique.join('、')}，但视觉产物不可用：${input.visual.detail}` };
  }
  const missing = unique.filter(id => !input.visual.byScreen.has(id));
  if (missing.length > 0) {
    return {
      kind: 'unbound',
      detail: `visual-diff.json 缺少 ${tcId} 所绑定屏的条目：${missing.join('、')}（缺条目不等于通过）`,
    };
  }
  const notUsable = unique.filter(id => !input.visual.byScreen.get(id)?.usable);
  if (notUsable.length > 0) {
    return {
      kind: 'failed',
      detail:
        `${tcId} 绑定屏未全部提供本轮可用证据：` +
        notUsable.map(id => `${id}（${input.visual.byScreen.get(id)?.reason ?? '未知原因'}）`).join('、'),
    };
  }
  return {
    kind: 'covered',
    detail:
      `${tcId} → ${acIds.join('、')} → 屏 ${unique.join('、')} 逐屏 verdict=pass，` +
      '且截图 hash / build 指纹 / 评估新鲜度均通过复核',
  };
}
