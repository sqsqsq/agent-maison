// ============================================================================
// ui-kit-conformance-check.ts — 三段闭环（blind-visual-hardening d3 / P0-C）
// ----------------------------------------------------------------------------
// 防"ui-spec 声明容器、代码只输出散落 Text"（事故形态：无容器/无导航/无关闭钮线框 UI）。
// 三段：①ui-spec 声明（node.block / node.type ∈ 语义节点集）→ ②源码命中（block 组件
// 实例化 + 实例锚点前缀出现在 feature 源码树）→ ③运行时（layout dump 中出现锚点 id）。
// 锚点定位不依赖组件名保留于 uitree（codex 三轮④）；对应屏 dump 缺失时 runtime 段跳过
// （采集完备性归 nav/visual_diff_capture 既有 BLOCKER，不重复裁决）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import type { CheckContext, CheckResult } from '../../../harness/scripts/utils/types';
import { featureDir, relFeatureFile } from '../../../harness/config';
import {
  loadUiSpecFile,
  uiSpecAbsPath,
  type UiSpecComponentNode,
  type UiSpecDoc,
} from '../../../harness/scripts/utils/ui-spec-shared';
import { buildInstanceAnchor, normalizeAnchorSegment, ANCHOR_PREFIX } from './ui-kit-anchors';
import { scanFeatureSourceTree } from './source-ref-scan';
import { parseHypiumDump, flattenLayoutNodes } from './layout-oracle-check';

/** semantic node → block 组件名（blocks.json SSOT 的代码侧镜像；gallery 单测对账两者一致） */
export const BLOCK_SEMANTIC_NODES: Record<string, string> = {
  nav_bar: 'MaisonNavBar',
  list_card_container: 'MaisonListCard',
  list_row: 'MaisonListRow',
  sheet_scaffold: 'MaisonBottomSheetScaffold',
  primary_button: 'MaisonPrimaryButton',
  selector_group: 'MaisonSelector',
  result_state: 'MaisonResultState',
  sms_code_field: 'MaisonSmsCodeField',
  detail_section: 'MaisonDetailSection',
};

export interface DeclaredBlockInstance {
  screenId: string;
  nodeId: string;
  semanticNode: string;
  blockComponent: string;
  /** maison:<feature>:<screen>:<node>——instance_key 为实现期自由段，校验用前缀 */
  anchorPrefix: string;
}

export function collectDeclaredBlockInstances(doc: UiSpecDoc, feature: string): DeclaredBlockInstance[] {
  const out: DeclaredBlockInstance[] = [];
  const walk = (screenId: string, node: UiSpecComponentNode | undefined): void => {
    if (!node) return;
    const semantic = node.block ?? (BLOCK_SEMANTIC_NODES[node.type] ? node.type : undefined);
    if (semantic && BLOCK_SEMANTIC_NODES[semantic]) {
      const nodeId = node.id ?? semantic;
      out.push({
        screenId,
        nodeId,
        semanticNode: semantic,
        blockComponent: BLOCK_SEMANTIC_NODES[semantic],
        anchorPrefix: [
          ANCHOR_PREFIX,
          normalizeAnchorSegment(feature),
          normalizeAnchorSegment(screenId),
          normalizeAnchorSegment(nodeId),
        ].join(':'),
      });
    }
    for (const c of node.children ?? []) walk(screenId, c);
    const tpl = (node as unknown as { item_template?: UiSpecComponentNode }).item_template;
    if (tpl) walk(screenId, tpl);
  };
  for (const s of doc.screens ?? []) walk(s.id, s.root);
  return out;
}

/** 注释+字符串双剥离（codex 三轮次要项：`Text("MaisonNavBar(")` 字符串字面量也能骗过组件
 * 实例化匹配）——组件调用匹配用本函数产物（注释与字符串内容都不作数）；锚点匹配用
 * stripArkTsComments（字符串保留——锚点真身在 .id('maison:...') 字符串里）。 */
export function stripArkTsCommentsAndStrings(src: string): string {
  const noComments = stripArkTsComments(src);
  // 字符串内容置空（保留引号定界，防拼接副作用）：单引号/双引号/模板串
  return noComments
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

/** 注释剥离（codex 实施 review P1-4：注释里写一句 `MaisonListRow(` + 锚点即可骗过 includes）——
 * 剥 `//` 行注释与块注释，**保留字符串字面量**（锚点真身在 .id('maison:...') 字符串里）。 */
export function stripArkTsComments(src: string): string {
  let out = '';
  let i = 0;
  let mode: 'code' | 'line' | 'block' | 'sq' | 'dq' | 'bt' = 'code';
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && next === '/') { mode = 'line'; i += 2; continue; }
      if (c === '/' && next === '*') { mode = 'block'; i += 2; continue; }
      if (c === "'") mode = 'sq';
      else if (c === '"') mode = 'dq';
      else if (c === '`') mode = 'bt';
      out += c; i++; continue;
    }
    if (mode === 'line') { if (c === '\n') { mode = 'code'; out += c; } i++; continue; }
    if (mode === 'block') { if (c === '*' && next === '/') { mode = 'code'; i += 2; } else i++; continue; }
    // 字符串态：原样保留，处理转义
    if (c === '\\') { out += c + (next ?? ''); i += 2; continue; }
    if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'bt' && c === '`')) mode = 'code';
    out += c; i++;
  }
  return out;
}

/**
 * cursor 实施 review P1（强制结构容器声明——kit 不再 opt-in）：盲档 UI 需求下，
 * 每个 P0 屏必须声明 ≥1 个结构语义容器（node.block / 语义 type），否则 spec BLOCKER——
 * "不声明就不进三段闭环"的空转路径关闭（事故形态：整链零容器线框 UI 全绿推进）。
 */
export function checkUiKitDeclarationRequired(ctx: CheckContext): CheckResult[] {
  const id = 'ui_kit_declaration_required';
  const description = '盲档结构容器声明门禁（P0 屏须声明 ≥1 语义容器 block——kit 非 opt-in）';
  if (ctx.adapterImageInput !== 'none') return [];
  const doc = loadUiSpecFile(uiSpecAbsPath(ctx.projectRoot, ctx.feature));
  if (!doc || (doc.screens ?? []).length === 0) return [];
  const declared = collectDeclaredBlockInstances(doc, ctx.feature);
  const byScreen = new Map<string, number>();
  for (const d of declared) byScreen.set(d.screenId, (byScreen.get(d.screenId) ?? 0) + 1);
  const p0Screens = (doc.screens ?? []).filter(s => s.priority === 'P0');
  const scope = p0Screens.length > 0 ? p0Screens : (doc.screens ?? []); // 全 P1 自报也不逃（criticality 同理）
  const missing = scope.filter(s => (byScreen.get(s.id) ?? 0) === 0).map(s => s.id);
  if (missing.length === 0) {
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'PASS',
      details: `${scope.length} 屏全部声明了结构语义容器（进入三段闭环）。`,
    }];
  }
  return [{
    id, category: 'structure', description,
    severity: 'BLOCKER', status: 'FAIL',
    details: [
      `【盲档结构声明缺失】${missing.length}/${scope.length} 屏未声明任何语义容器 block——`,
      '盲模型不声明容器=从零自由拼 UI（bc-openCard 二轮线框形态）；kit 是地板不是可选项：',
      ...missing.map(s => `  - ${s}`),
    ].join('\n'),
    suggestion:
      '每屏按形态声明语义节点（type 或 block 字段）：导航区 nav_bar / 列表容器 list_card_container / ' +
      '列表行 list_row / 半模态 sheet_scaffold / 主按钮 primary_button / 单选组 selector_group / ' +
      '结果页 result_state / 验证码 sms_code_field / 详情分区 detail_section——' +
      '声明后三段闭环（声明→源码锚点→uitree）自动生效。',
    affected_files: [relFeatureFile(ctx.projectRoot, ctx.feature, path.join('spec', 'ui-spec.yaml'))],
    failure_kind: 'ui_kit_declaration_missing',
    blocking_class: 'ui_kit_conformance',
  }];
}

/** ②源码段：kit 物化（scaffold 强制）+ block 组件实例化 + 锚点前缀出现在 feature 源码树 */
export function checkUiKitSourceConformance(ctx: CheckContext): CheckResult[] {
  const id = 'ui_kit_source_conformance';
  const description = 'UI kit 三段闭环·源码段（kit 已物化 + 声明容器实例化对应 block + 实例锚点注入）';
  const doc = loadUiSpecFile(uiSpecAbsPath(ctx.projectRoot, ctx.feature));
  if (!doc) return [];
  const declared = collectDeclaredBlockInstances(doc, ctx.feature);
  if (declared.length === 0) return [];
  const contracts = ctx.featureSpec.contracts;
  if (!contracts) return []; // contracts 缺失归 review_context 既有 BLOCKER

  // codex 实施 review P1-4：scaffold 从"自然语言提示"升级为强制物化门禁——声明了 block 就必须
  // 已把模板 scaffold 进目标目录（hash 一致）；缺失/漂移/目录不可解析 → BLOCKER 给出精确命令。
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const scaffolder = require('./ui-kit-scaffolder') as typeof import('./ui-kit-scaffolder');
  const target = scaffolder.resolveUiKitTargetDir(ctx.projectRoot);
  if (target.status === 'halt') {
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'FAIL',
      details: `【kit 物化前置】目标目录无法唯一解析：${target.haltReason}${target.candidates?.length ? `\n候选：${target.candidates.join(', ')}` : ''}`,
      suggestion: '在 framework.config.json paths.ui_kit_target_dir 显式指定后重跑（勿猜路径落盘）。',
      failure_kind: 'ui_kit_target_unresolved',
      blocking_class: 'ui_kit_conformance',
    }];
  }
  const scaffold = scaffolder.scaffoldUiKit(target.targetAbs!, { dryRun: true });
  const missingTemplates = scaffold.entries.filter(e => e.action === 'written').map(e => e.file);
  const drifted = scaffold.conflicts.map(e => e.file);
  if (missingTemplates.length > 0 || drifted.length > 0) {
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'FAIL',
      details: [
        '【kit 物化前置】ui-spec 声明了语义容器，但 kit blocks 未物化/已漂移：',
        ...(missingTemplates.length > 0 ? [`  缺失：${missingTemplates.join(', ')}`] : []),
        ...(drifted.length > 0 ? [`  hash 漂移（宿主改过，不静默覆盖）：${drifted.join(', ')}`] : []),
      ].join('\n'),
      suggestion:
        `在 harness 目录执行（正式入口）：npm run ui-kit:scaffold -- --project-root ` +
        `"${ctx.projectRoot.replace(/\\/g, '/')}" --target ` +
        `"${path.relative(ctx.projectRoot, target.targetAbs!).replace(/\\/g, '/')}" --apply` +
        (drifted.length > 0 ? '；漂移文件先人工比对处置（还原/升级模板），不得盲目覆盖。' : '。'),
      failure_kind: 'ui_kit_not_materialized',
      blocking_class: 'ui_kit_conformance',
    }];
  }

  const scan = scanFeatureSourceTree(ctx.projectRoot, contracts);
  const sources = scan.etsFiles.map(f => {
    try { return fs.readFileSync(f, 'utf-8'); } catch { return ''; }
  });
  // 双基线匹配（codex 三轮次要项）：组件调用在"去注释+去字符串"源上匹配（字符串里写
  // "MaisonNavBar(" 不作数）；锚点在"去注释保字符串"源上匹配（锚点真身在 .id() 字符串里）。
  const joined = sources.join('\n');
  const codeOnly = stripArkTsCommentsAndStrings(joined);
  const allSource = stripArkTsComments(joined);
  const violations: string[] = [];
  for (const d of declared) {
    const blockUsed = new RegExp(`\\b${d.blockComponent}\\s*\\(`).test(codeOnly);
    const anchorPresent = allSource.includes(d.anchorPrefix);
    if (!blockUsed || !anchorPresent) {
      violations.push(
        `  - [${d.screenId}] ${d.nodeId}（${d.semanticNode}→${d.blockComponent}）：` +
        `${blockUsed ? '' : 'block 未实例化'}${!blockUsed && !anchorPresent ? '；' : ''}${anchorPresent ? '' : `锚点前缀缺失（${d.anchorPrefix}）`}`,
      );
    }
  }
  if (violations.length === 0) {
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'PASS',
      details: `kit 已物化（${target.source}），${declared.length} 处语义容器声明全部命中源码 block 实例化 + 锚点注入（注释已剥离防伪注）。`,
    }];
  }
  return [{
    id, category: 'structure', description,
    severity: 'BLOCKER', status: 'FAIL',
    details: [
      `【三段闭环·源码段】${violations.length}/${declared.length} 处声明未闭环（声明容器、代码散落 Text 即此形态；注释内伪注不作数）：`,
      ...violations,
    ].join('\n'),
    suggestion:
      '用对应 Maison block 实现声明的容器/结构节点（kit 已在目标目录），' +
      '并以 buildInstanceAnchor(feature,screen,node,instanceKey) 生成锚点传入 anchorId；' +
      '锚点算法见 ui-kit-anchors.ts（段归一 [a-z0-9_-]、总长 ≤96）。',
    affected_files: [relFeatureFile(ctx.projectRoot, ctx.feature, path.join('spec', 'ui-spec.yaml'))],
    failure_kind: 'ui_kit_source_gap',
    blocking_class: 'ui_kit_conformance',
  }];
}

/** ③运行时段：对应屏 layout dump 中出现锚点前缀 id。
 * codex 四轮 P1-5：无 dump 不再真空通过——盲档钳到 semantic_layout 时既有 dump 缺失门禁
 * 不保证触发，"三段闭环"会退化成两段；无运行时证据 → MAJOR/WARN（needs_human 债务源，
 * release 由债务链阻断，阶段可继续——诚实且符合盲档设计）。 */
export function checkUiKitRuntimeConformance(ctx: CheckContext): CheckResult[] {
  const id = 'ui_kit_runtime_conformance';
  const description = 'UI kit 三段闭环·运行时段（声明的语义容器锚点须出现在设备 layout dump）';
  const doc = loadUiSpecFile(uiSpecAbsPath(ctx.projectRoot, ctx.feature));
  if (!doc) return [];
  const declared = collectDeclaredBlockInstances(doc, ctx.feature);
  if (declared.length === 0) return [];

  const noEvidence = (why: string): CheckResult[] => [{
    id, category: 'structure', description,
    severity: 'MAJOR', status: 'WARN',
    details:
      `【运行时证据缺失】声明了 ${declared.length} 处语义容器但${why}——三段闭环的运行时段未验证，` +
      '不作真空通过（无证据≠已验）；条目入视觉债务（needs_human），release 保持 BLOCKED，阶段可继续。',
    suggestion: '补齐设备采集（visual-diff-nav 配置 + device_test.run 后自动 dump）后重跑 testing。',
    failure_kind: 'ui_kit_runtime_unverified',
    blocking_class: 'ui_kit_conformance',
  }];

  const shotsDir = path.join(featureDir(ctx.projectRoot, ctx.feature), 'device-testing', 'device-screenshots');
  if (!fs.existsSync(shotsDir)) return noEvidence('设备采集目录不存在');

  const idsByScreen = new Map<string, Set<string>>();
  for (const f of fs.readdirSync(shotsDir).filter(x => /^layout-.+\.json$/.test(x))) {
    const screen = f.replace(/^layout-/, '').replace(/\.json$/, '');
    try {
      const dump = parseHypiumDump(JSON.parse(fs.readFileSync(path.join(shotsDir, f), 'utf-8')));
      if (!dump) continue;
      const ids = new Set<string>();
      for (const e of flattenLayoutNodes(dump.appRoot)) {
        const nid = (e.node as unknown as { id?: string }).id;
        if (typeof nid === 'string' && nid.length > 0) ids.add(nid);
      }
      idsByScreen.set(screen, ids);
    } catch { /* 解析失败按无 dump 处理 */ }
  }
  if (idsByScreen.size === 0) return noEvidence('无可解析 layout dump');

  const violations: string[] = [];
  const missingEvidence: string[] = [];
  let checked = 0;
  for (const d of declared) {
    const screenKey = normalizeAnchorSegment(d.screenId);
    const dumpKey = [...idsByScreen.keys()].find(k => normalizeAnchorSegment(k) === screenKey);
    if (!dumpKey) {
      // codex 五轮 P1-2：单屏缺 dump 不得被整体 PASS 吞掉（8 屏只交 1 个合格 dump 曾整体 PASS，
      // 且债务 reducer 会随之闭账）——逐屏登记证据缺失。
      missingEvidence.push(`  - [${d.screenId}] ${d.nodeId}：无对应 layout dump（运行时段未验证）`);
      continue;
    }
    checked++;
    const ids = idsByScreen.get(dumpKey)!;
    const hit = [...ids].some(x => x.startsWith(d.anchorPrefix));
    if (!hit) {
      violations.push(`  - [${d.screenId}] ${d.nodeId}：dump 无锚点前缀 ${d.anchorPrefix}（声明+源码在、运行时不在=渲染路径断）`);
    }
  }
  if (checked === 0) return noEvidence('声明屏均无对应 layout dump');
  if (violations.length === 0 && missingEvidence.length > 0) {
    return [{
      id, category: 'structure', description,
      severity: 'MAJOR', status: 'WARN',
      details: [
        `【运行时证据不全】${checked}/${declared.length} 处已验通过，但 ${missingEvidence.length} 处声明缺对应 dump——`,
        '部分验证不作整体 PASS（无证据≠已验）；缺证据项入视觉债务（needs_human）：',
        ...missingEvidence,
      ].join('\n'),
      suggestion: '补齐缺失屏的采集（visual-diff-nav 配置该屏到达步骤）后重跑 testing。',
      failure_kind: 'ui_kit_runtime_unverified',
      blocking_class: 'ui_kit_conformance',
    }];
  }
  if (violations.length === 0) {
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'PASS',
      details: `${checked}/${declared.length} 处语义容器锚点全部出现在运行时 layout dump（全覆盖）。`,
    }];
  }
  return [{
    id, category: 'structure', description,
    severity: 'BLOCKER', status: 'FAIL',
    details: [
      `【三段闭环·运行时段】${violations.length}/${checked} 处锚点未出现在设备 layout dump：`,
      ...violations,
      ...(missingEvidence.length > 0 ? ['另有证据缺失（不吞入 PASS/FAIL 分母，逐屏补采）：', ...missingEvidence] : []),
    ].join('\n'),
    suggestion:
      '检查页面是否真实走了声明的 block 渲染路径（条件分支/路由未达/anchorId 未传都会命中此项）；' +
      '.id() 注入在 block 根容器，dump 采集须为对应屏（nav 配置到位）。',
    failure_kind: 'ui_kit_runtime_gap',
    blocking_class: 'ui_kit_conformance',
  }];
}
