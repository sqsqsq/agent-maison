// ============================================================================
// structure-ledger.ts — P1-4①（plan c9e2a7f4 子批B）：结构声明台账门禁
// ----------------------------------------------------------------------------
// 病灶（round6 终局实锤）：spec 结构声明（card_pack subtitle_position=trailing、add_card
// layout_group、tab 容器 bg_color）被 coding **静默无视**——没有任何产物记录"这条声明我怎么
// 处理的"，直到真机 testing 才暴露。ArkUI 结构静态判定不可行（Row/Column/Builder 组合爆炸，
// 硬做必产 FP 风暴），故本门禁不验真、只**消灭静默**：coding 必须对每条结构声明逐条登记
// "由哪个 struct、如何实现"（doc/features/<f>/coding/structure-conformance.yaml），缺条目=
// 声明被无视的显式证据 → BLOCKER；implemented_by 须真实存在于源码 struct 集（防糊名）。
//
// 诚实边界（P1-4③）：台账为 coding 自报——内容真实性由 review 逐条人审（P1-4②）＋
// device 侧 P1-C 文本类确定性信号＋用户终审兜底；非文本类结构（tab 容器/分组视觉）当前
// 无确定性静态验真（round7 候选：OmniParser/容器采色）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import type { CheckContext, CheckResult } from '../../../harness/scripts/utils/types';
import { featureDir } from '../../../harness/config';
import {
  loadUiSpecFile,
  type UiSpecComponentNode,
  type UiSpecDoc,
} from '../../../harness/scripts/utils/ui-spec-shared';

// codex P1（子批B review）：消费者只在 framework/harness 装依赖——profile 文件不得裸 import 'yaml'
//（dev 仓能解析、发布件宿主会炸），走 harness 锚定的 createRequire（与 authoritative-ref-images 同模式）。
const requireHarness = createRequire(path.resolve(__dirname, '../../../harness/harness-runner.ts'));
const YAML = requireHarness('yaml') as { parse: (s: string) => unknown };
import { scanFeatureSourceTree } from './source-ref-scan';
import { isPixel1to1, fidelityRatchetFailOrWarn } from '../../../harness/scripts/utils/fidelity-shared';

/** 一条结构声明：node_key + declaration（如 subtitle_position=trailing）。 */
export interface StructureDeclaration {
  node_key: string;
  declaration: string;
  screen_id: string;
}

/** 台账条目（coding 自报）。 */
export interface LedgerEntry {
  node_id?: string;
  declaration?: string;
  implemented_by?: string;
  how?: string;
}

export const STRUCTURE_LEDGER_REL = 'coding/structure-conformance.yaml';

/** 无 id 节点的合成键（采集与门禁报错同一规则，agent 照抄报错键即可）。 */
function nodeKey(screenId: string, node: UiSpecComponentNode): string {
  const id = node.id?.trim();
  if (id) return id;
  return `screen:${screenId}/${node.type}@${node.order}`;
}

function walkNodes(
  screenId: string,
  node: UiSpecComponentNode,
  visit: (screenId: string, n: UiSpecComponentNode) => void,
): void {
  visit(screenId, node);
  for (const c of node.children ?? []) walkNodes(screenId, c, visit);
}

/**
 * 采集 ui-spec 全部结构声明（确定性字段集）：
 *  - subtitle_position（trailing/below——round6 实证不声明则 coding 惯用题下排错）
 *  - layout_group（同行/同容器分组——即"container children 分组"的形式化承载）
 *  - bg_color（区域/容器背景色 token，tab 胶囊容器灰底类）
 *  - global_elements（全局元素如底部 tab 容器——每条须表态由哪个 struct 实现）
 */
export function collectStructureDeclarations(uiDoc: UiSpecDoc | null): StructureDeclaration[] {
  const out: StructureDeclaration[] = [];
  for (const screen of uiDoc?.screens ?? []) {
    if (!screen.root) continue;
    walkNodes(screen.id, screen.root, (sid, n) => {
      const key = nodeKey(sid, n);
      if (typeof n.subtitle_position === 'string' && n.subtitle_position.trim()) {
        out.push({ node_key: key, declaration: `subtitle_position=${n.subtitle_position.trim()}`, screen_id: sid });
      }
      if (typeof n.layout_group === 'string' && n.layout_group.trim()) {
        out.push({ node_key: key, declaration: `layout_group=${n.layout_group.trim()}`, screen_id: sid });
      }
      if (typeof n.bg_color === 'string' && n.bg_color.trim()) {
        out.push({ node_key: key, declaration: `bg_color=${n.bg_color.trim()}`, screen_id: sid });
      }
    });
  }
  for (const g of uiDoc?.global_elements ?? []) {
    const gid = g.id?.trim();
    if (!gid) continue;
    // 全局元素（如底部 tab 容器）：每条须表态由哪个 struct 实现；其容器 bg_color 若声明在
    // 屏内节点上，已由上方节点遍历覆盖。
    out.push({ node_key: gid, declaration: 'global_element', screen_id: '(global)' });
  }
  return out;
}

export function structureLedgerAbsPath(projectRoot: string, feature: string): string {
  return path.join(featureDir(projectRoot, feature), ...STRUCTURE_LEDGER_REL.split('/'));
}

export function loadStructureLedger(absPath: string): LedgerEntry[] | null {
  if (!fs.existsSync(absPath)) return null;
  try {
    const doc = YAML.parse(fs.readFileSync(absPath, 'utf-8')) as { entries?: unknown };
    if (!doc || !Array.isArray(doc.entries)) return [];
    return doc.entries.filter((e): e is LedgerEntry => Boolean(e) && typeof e === 'object');
  } catch {
    return null; // 解析失败与缺文件同罪（调用侧报格式错误）
  }
}

export interface LedgerAuditResult {
  /** spec 有声明、台账缺条目（键=node_key + declaration） */
  missing: StructureDeclaration[];
  /** implemented_by 缺失/空 的台账条目 */
  unattributed: string[];
  /** implemented_by 的 struct 不存在于源码（糊名） */
  phantomStructs: string[];
  /** how 缺失/空 */
  missingHow: string[];
  /** 台账里 spec 不存在的声明（提示清理，不阻断） */
  orphanEntries: string[];
}

/** 台账对账（纯函数，供门禁与单测）。 */
export function auditStructureLedger(
  declarations: StructureDeclaration[],
  ledger: LedgerEntry[],
  structNames: Set<string>,
): LedgerAuditResult {
  const ledgerKeys = new Set(
    ledger.map(e => `${(e.node_id ?? '').trim()}|${(e.declaration ?? '').trim()}`),
  );
  const declKeys = new Set(declarations.map(d => `${d.node_key}|${d.declaration}`));

  const missing = declarations.filter(d => !ledgerKeys.has(`${d.node_key}|${d.declaration}`));
  const unattributed: string[] = [];
  const phantomStructs: string[] = [];
  const missingHow: string[] = [];
  const orphanEntries: string[] = [];
  for (const e of ledger) {
    const label = `${(e.node_id ?? '?').trim()}｜${(e.declaration ?? '?').trim()}`;
    const key = `${(e.node_id ?? '').trim()}|${(e.declaration ?? '').trim()}`;
    // cursor 意见（子批B review）：orphan（spec 已无此声明的 stale 条目）只提示清理、不参与
    // how/implemented_by 校验——否则"当前声明已全部登记"仍会因 stale 条目字段不全被 BLOCKER。
    if (!declKeys.has(key)) {
      orphanEntries.push(label);
      continue;
    }
    const impl = (e.implemented_by ?? '').trim();
    if (!impl) unattributed.push(label);
    else if (!structNames.has(impl)) phantomStructs.push(`${label} → ${impl}`);
    if (!(e.how ?? '').trim()) missingHow.push(label);
  }
  return { missing, unattributed, phantomStructs, missingHow, orphanEntries };
}

const HONESTY_NOTE =
  '（诚实边界：台账为 coding 自报、本门禁只消灭"声明被静默无视"并校验 struct 存在性防糊名；' +
  '内容真实性由 review 逐条人审 + device 文本类确定性信号 + 用户终审兜底，非文本类结构静态验真列 round7）';

/**
 * P1-4① 门禁 `structure_declaration_ledger`：ui-spec 全部结构声明 ⊆ 台账，且
 * implemented_by 真实存在。pixel_1to1 → BLOCKER FAIL；否则 MAJOR WARN。
 */
export function checkStructureDeclarationLedger(ctx: CheckContext): CheckResult[] {
  // 路径走 featureDir（尊重 paths.features_dir）读 ui-spec。（子批B 起如此；round7 A① 已把
  // uiSpecAbsPath 一并改走 featureFilePath，此处 featureDir 直拼与其等价。）
  const featRoot = featureDir(ctx.projectRoot, ctx.feature);
  const uiDoc = loadUiSpecFile(path.join(featRoot, 'spec', 'ui-spec.yaml'));
  const declarations = collectStructureDeclarations(uiDoc);
  const toRel = (abs: string) => path.relative(ctx.projectRoot, abs).replace(/\\/g, '/');
  const ledgerRel = toRel(structureLedgerAbsPath(ctx.projectRoot, ctx.feature));
  const base = {
    id: 'structure_declaration_ledger',
    category: 'structure' as const,
    description:
      'P1-4：结构声明台账——spec 每条结构声明（subtitle_position/layout_group/bg_color/global_element）须在 coding/structure-conformance.yaml 逐条登记实现归属',
    affected_files: [toRel(path.join(featRoot, 'spec', 'ui-spec.yaml')), ledgerRel],
  };
  if (declarations.length === 0) {
    return [{ ...base, severity: 'MINOR', status: 'PASS', details: 'ui-spec 无结构声明，无需台账。' }];
  }

  const ratchet = isPixel1to1(ctx)
    ? fidelityRatchetFailOrWarn(ctx, true)
    : { severity: 'MAJOR' as const, status: 'WARN' as const };

  const ledgerAbs = structureLedgerAbsPath(ctx.projectRoot, ctx.feature);
  const ledger = loadStructureLedger(ledgerAbs);
  if (ledger === null) {
    return [{
      ...base,
      severity: ratchet.severity,
      status: ratchet.status,
      details:
        `缺结构声明台账 ${ledgerRel}（或 YAML 解析失败）——spec 有 ${declarations.length} 条结构声明待逐条表态。\n` +
        `须登记条目（entries[]: node_id / declaration / implemented_by / how）：\n` +
        declarations.map(d => `- node_id: ${d.node_key}｜declaration: ${d.declaration}（屏 ${d.screen_id}）`).join('\n') +
        `\n${HONESTY_NOTE}`,
      suggestion: `创建 ${ledgerRel}，对上述每条声明写明由哪个 struct、如何实现（登记≠实现完成，糊弄台账会被 review 人审与 device 信号双重打回）。`,
    }];
  }

  const contracts = ctx.featureSpec.contracts;
  const structNames = contracts ? scanFeatureSourceTree(ctx.projectRoot, contracts).structNames : new Set<string>();
  const audit = auditStructureLedger(declarations, ledger, structNames);

  const problems: string[] = [];
  if (audit.missing.length > 0) {
    problems.push(
      `台账缺 ${audit.missing.length} 条声明（声明被无视的显式证据）：\n` +
      audit.missing.map(d => `- node_id: ${d.node_key}｜declaration: ${d.declaration}（屏 ${d.screen_id}）`).join('\n'),
    );
  }
  if (audit.unattributed.length > 0) {
    problems.push(`台账条目缺 implemented_by：${audit.unattributed.join('；')}`);
  }
  if (audit.phantomStructs.length > 0) {
    problems.push(`implemented_by 的 struct 不存在于源码（糊名）：${audit.phantomStructs.join('；')}`);
  }
  if (audit.missingHow.length > 0) {
    problems.push(`台账条目缺 how（一句话实现说明）：${audit.missingHow.join('；')}`);
  }

  if (problems.length > 0) {
    return [{
      ...base,
      severity: ratchet.severity,
      status: ratchet.status,
      details: `${problems.join('\n')}\n${HONESTY_NOTE}`,
      suggestion: `补齐 ${ledgerRel} 后重跑；implemented_by 须为真实 struct 名。`,
    }];
  }

  return [{
    ...base,
    severity: 'MINOR',
    status: 'PASS',
    details:
      `结构声明 ${declarations.length} 条全部登记且 implemented_by 真实` +
      (audit.orphanEntries.length > 0
        ? `；提示：${audit.orphanEntries.length} 条台账条目在 spec 中已不存在（建议清理）：${audit.orphanEntries.slice(0, 6).join('；')}`
        : '') +
      `。${HONESTY_NOTE}`,
  }];
}
