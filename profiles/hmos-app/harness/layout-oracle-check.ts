// ============================================================================
// layout-oracle-check.ts — T8 运行时布局树几何不变量（plan c6d8f2b4）
//
// 数据源：hylyre dump-ui（hylyre-hypium-ui-dump-v1，hypium.UiTree）——每节点
// bounds "[x1,y1][x2,y2]"（屏幕像素、视觉布局边界）+ type/text/clickable/id/key。
// 树无背景色/可见性/z-order 语义 → 各子信号 gate 档位以
// docs/operations/layout-oracle-calibration.md 决定表为准：
//   A-1 显式 forbidden_overlap/protected_region 违反 → hard（pixel_1to1 ratchet BLOCKER）
//   A-2 声明元素越出屏幕 → hard
//   A-3 overlay 关闭钮默认规则 → advisory（真机 D5 零误伤后方可晋级）
//   A-4 全量两两相交 → advisory（永不 gate）
//   B-1/2/3 spec 派生结构 → warn
//   C-1 间距比例 → advisory（永久）
// locator 覆盖率不足 → 该屏 B 类 SKIP（不带病判定）。
// ============================================================================

import * as fs from 'fs';
import type { UiSpecComponentNode, UiSpecScreen } from '../../../harness/scripts/utils/ui-spec-shared';

// ---------------------------------------------------------------------------
// dump 解析
// ---------------------------------------------------------------------------

export interface LayoutRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface LayoutNode {
  bounds: LayoutRect | null;
  type: string;
  text: string;
  id: string;
  key: string;
  clickable: boolean;
  children: LayoutNode[];
}

export const HYPIUM_DUMP_SCHEMA = 'hylyre-hypium-ui-dump-v1';

/** bounds "[x1,y1][x2,y2]" → rect；非法/空 → null */
export function parseBoundsString(raw: unknown): LayoutRect | null {
  if (typeof raw !== 'string') return null;
  const m = raw.trim().match(/^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/);
  if (!m) return null;
  const [x1, y1, x2, y2] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if ([x1, y1, x2, y2].some(n => !Number.isFinite(n))) return null;
  return { x1, y1, x2, y2 };
}

function parseNode(raw: unknown): LayoutNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const attrs = (rec.attributes ?? {}) as Record<string, unknown>;
  const node: LayoutNode = {
    bounds: parseBoundsString(attrs.bounds),
    type: typeof attrs.type === 'string' ? attrs.type : '',
    text: typeof attrs.text === 'string' ? attrs.text : '',
    id: typeof attrs.id === 'string' ? attrs.id : '',
    key: typeof attrs.key === 'string' ? attrs.key : '',
    clickable: attrs.clickable === 'true',
    children: [],
  };
  if (Array.isArray(rec.children)) {
    for (const c of rec.children) {
      const child = parseNode(c);
      if (child) node.children.push(child);
    }
  }
  return node;
}

export interface ParsedLayoutDump {
  root: LayoutNode;
  /** app 窗口子树（裁掉状态栏/launcher 等跨窗口内容） */
  appRoot: LayoutNode;
  /** app 窗口矩形（归一化基准） */
  appRect: LayoutRect;
  /** 整屏矩形（越界判定基准） */
  screenRect: LayoutRect;
}

function rectArea(r: LayoutRect | null): number {
  if (!r) return 0;
  return Math.max(0, r.x2 - r.x1) * Math.max(0, r.y2 - r.y1);
}

export function rectsIntersect(a: LayoutRect, b: LayoutRect): boolean {
  return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

function rectContains(outer: LayoutRect, inner: LayoutRect): boolean {
  return inner.x1 >= outer.x1 && inner.y1 >= outer.y1 && inner.x2 <= outer.x2 && inner.y2 <= outer.y2;
}

/**
 * 解析 dump 文件。树内含跨窗口内容（状态栏+app），app 子树取 type='root' 的
 * 首个子树（E9 实测形态），缺位时回退面积最大的直接子树。
 */
export function parseHypiumDump(rawJson: unknown): ParsedLayoutDump | null {
  if (!rawJson || typeof rawJson !== 'object') return null;
  const rec = rawJson as Record<string, unknown>;
  if (rec.schema_version !== HYPIUM_DUMP_SCHEMA) return null;
  const root = parseNode(rec.tree);
  if (!root || !root.bounds) return null;
  let appRoot: LayoutNode | null = root.children.find(c => c.type === 'root' && c.bounds) ?? null;
  if (!appRoot) {
    appRoot = [...root.children]
      .filter(c => c.bounds)
      .sort((a, b) => rectArea(b.bounds) - rectArea(a.bounds))[0] ?? null;
  }
  if (!appRoot?.bounds) return null;
  return { root, appRoot, appRect: appRoot.bounds, screenRect: root.bounds };
}

function flattenWithAncestors(
  node: LayoutNode,
  ancestors: LayoutNode[],
  out: Array<{ node: LayoutNode; ancestors: LayoutNode[] }>,
): void {
  out.push({ node, ancestors });
  for (const c of node.children) flattenWithAncestors(c, [...ancestors, node], out);
}

export function flattenLayoutNodes(root: LayoutNode): Array<{ node: LayoutNode; ancestors: LayoutNode[] }> {
  const out: Array<{ node: LayoutNode; ancestors: LayoutNode[] }> = [];
  flattenWithAncestors(root, [], out);
  return out;
}

// ---------------------------------------------------------------------------
// t1 locator：ui-spec 元素 ↔ 运行时节点（exact_id > unique_text > structural-lite）
// ---------------------------------------------------------------------------

export type LocatorConfidence = 'exact_id' | 'unique_text' | 'structural' | 'unmatched';

export interface LocatedElement {
  elementId: string;
  confidence: LocatorConfidence;
  node?: LayoutNode;
  ancestors?: LayoutNode[];
}

export interface DeclaredElement {
  elementId: string;
  text?: string;
}

/** 声明元素清单：屏组件树节点 id + 逐字 text（供 unique_text 回退） */
export function collectDeclaredElements(screen: UiSpecScreen): DeclaredElement[] {
  const out: DeclaredElement[] = [];
  const seen = new Set<string>();
  const walk = (n: UiSpecComponentNode): void => {
    if (typeof n.id === 'string' && n.id.trim() && !seen.has(n.id.trim())) {
      seen.add(n.id.trim());
      out.push({ elementId: n.id.trim(), text: typeof n.text === 'string' && n.text.trim() ? n.text.trim() : undefined });
    }
    for (const c of n.children ?? []) walk(c);
  };
  if (screen.root) walk(screen.root);
  for (const mh of screen.must_have_elements ?? []) {
    if (!seen.has(mh)) {
      seen.add(mh);
      out.push({ elementId: mh });
    }
  }
  return out;
}

export const LOCATOR_COVERAGE_THRESHOLD = 0.8;

/**
 * 定位声明元素到运行时节点。歧义（同文本多节点）判 unmatched 不强猜。
 * 主方案 exact_id 依赖 coding 侧对 P0 屏声明元素设 `.id(<element_id>)`
 * （t0③ 实证：ArkUI .id() 透传 dump id/key，宿主 home_header_add/promo_no_card 在案）。
 */
export function locateElements(
  declared: DeclaredElement[],
  appRoot: LayoutNode,
): { located: Map<string, LocatedElement>; coverage: number } {
  const flat = flattenLayoutNodes(appRoot).filter(e => e.node.bounds && rectArea(e.node.bounds) > 0);
  const byId = new Map<string, Array<{ node: LayoutNode; ancestors: LayoutNode[] }>>();
  for (const e of flat) {
    for (const key of [e.node.id.trim(), e.node.key.trim()]) {
      if (!key) continue;
      const list = byId.get(key) ?? [];
      if (!list.includes(e)) list.push(e);
      byId.set(key, list);
    }
  }
  const textNodes = flat.filter(e => e.node.text.trim());

  const located = new Map<string, LocatedElement>();
  let matched = 0;
  for (const d of declared) {
    const idHits = byId.get(d.elementId) ?? [];
    if (idHits.length === 1) {
      located.set(d.elementId, { elementId: d.elementId, confidence: 'exact_id', node: idHits[0].node, ancestors: idHits[0].ancestors });
      matched++;
      continue;
    }
    if (d.text) {
      const exact = textNodes.filter(e => e.node.text.trim() === d.text);
      if (exact.length === 1) {
        located.set(d.elementId, { elementId: d.elementId, confidence: 'unique_text', node: exact[0].node, ancestors: exact[0].ancestors });
        matched++;
        continue;
      }
      if (exact.length === 0) {
        const contains = textNodes.filter(e => e.node.text.includes(d.text as string));
        if (contains.length === 1) {
          located.set(d.elementId, { elementId: d.elementId, confidence: 'structural', node: contains[0].node, ancestors: contains[0].ancestors });
          matched++;
          continue;
        }
      }
    }
    located.set(d.elementId, { elementId: d.elementId, confidence: 'unmatched' });
  }
  const coverage = declared.length === 0 ? 1 : matched / declared.length;
  return { located, coverage };
}

// ---------------------------------------------------------------------------
// T8 断言集
// ---------------------------------------------------------------------------

export type LayoutFindingTier = 'hard' | 'warn' | 'advisory';

export interface LayoutFinding {
  tier: LayoutFindingTier;
  signal: string;
  /** 归一化 [x,y,w,h]（相对 app 窗口），供 defect 定位引用 */
  bbox?: [number, number, number, number];
  note: string;
}

function normBBox(r: LayoutRect, app: LayoutRect): [number, number, number, number] {
  const w = Math.max(1, app.x2 - app.x1);
  const h = Math.max(1, app.y2 - app.y1);
  return [
    Number(((r.x1 - app.x1) / w).toFixed(4)),
    Number(((r.y1 - app.y1) / h).toFixed(4)),
    Number(((r.x2 - r.x1) / w).toFixed(4)),
    Number(((r.y2 - r.y1) / h).toFixed(4)),
  ];
}

function unionRect(a: LayoutRect, b: LayoutRect): LayoutRect {
  return { x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) };
}

function isAncestorOf(candidate: LayoutNode, of: LocatedElement): boolean {
  return (of.ancestors ?? []).includes(candidate);
}

/** 祖先-后代对不算 overlap（containment ≠ overlap，close 默认规则/两两扫描共用） */
function isKinPair(a: LocatedElement, b: LocatedElement): boolean {
  if (!a.node || !b.node) return false;
  return isAncestorOf(a.node, b) || isAncestorOf(b.node, a);
}

export interface LayoutOracleScreenInput {
  screenId: string;
  screen: UiSpecScreen;
  dump: ParsedLayoutDump;
  /** C-1 间距比例 advisory 阈（校准 D6 前缺省 0.25，仅展示不 gate） */
  gapTolerance?: number;
}

export interface LayoutOracleScreenResult {
  screenId: string;
  coverage: number;
  bClassSkipped: boolean;
  findings: LayoutFinding[];
}

export function collectLayoutOracleForScreen(input: LayoutOracleScreenInput): LayoutOracleScreenResult {
  const { screenId, screen, dump } = input;
  const findings: LayoutFinding[] = [];
  const declared = collectDeclaredElements(screen);
  const { located, coverage } = locateElements(declared, dump.appRoot);
  const get = (id: string): LocatedElement | undefined => {
    const e = located.get(id);
    return e && e.node ? e : undefined;
  };

  // --- A-1 显式声明：forbidden_overlap 对 / protected_region --------------------
  for (const pair of screen.forbidden_overlap ?? []) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const [ea, eb] = pair;
    const a = get(ea);
    const b = get(eb);
    if (!a || !b) {
      findings.push({
        tier: 'warn',
        signal: 'A1_forbidden_overlap_unlocatable',
        note: `forbidden_overlap [${ea}, ${eb}] 有元素无法定位（${!a ? ea : ''}${!a && !b ? '、' : ''}${!b ? eb : ''}）——须 coding 设 .id() 或补唯一文本锚，声明未生效`,
      });
      continue;
    }
    if (!isKinPair(a, b) && rectsIntersect(a.node!.bounds!, b.node!.bounds!)) {
      const u = unionRect(a.node!.bounds!, b.node!.bounds!);
      findings.push({
        tier: 'hard',
        signal: 'A1_forbidden_overlap',
        bbox: normBBox(u, dump.appRect),
        note: `声明禁止重叠的 [${ea}] 与 [${eb}] 运行时 bounds 相交（${ea}=${JSON.stringify(a.node!.bounds)}，${eb}=${JSON.stringify(b.node!.bounds)}）——调整布局使二者不相交`,
      });
    }
  }
  for (const prot of screen.protected_region ?? []) {
    const p = get(prot);
    if (!p) {
      findings.push({
        tier: 'warn',
        signal: 'A1_protected_region_unlocatable',
        note: `protected_region [${prot}] 无法定位——须 coding 设 .id() 或补唯一文本锚，声明未生效`,
      });
      continue;
    }
    const clickables = flattenLayoutNodes(dump.appRoot).filter(
      e => e.node.clickable && e.node.bounds && rectArea(e.node.bounds) > 0 && e.node !== p.node,
    );
    for (const c of clickables) {
      const kin = (p.ancestors ?? []).includes(c.node) || c.ancestors.includes(p.node!);
      if (kin) continue;
      if (rectsIntersect(c.node.bounds!, p.node!.bounds!)) {
        const label = c.node.id || c.node.text || c.node.type;
        findings.push({
          tier: 'hard',
          signal: 'A1_protected_region',
          bbox: normBBox(unionRect(c.node.bounds!, p.node!.bounds!), dump.appRect),
          note: `保护区 [${prot}] 被可交互控件「${label}」侵入（${JSON.stringify(c.node.bounds)}）——移出保护区或调整布局`,
        });
      }
    }
  }

  // --- A-2 声明元素越出屏幕 -----------------------------------------------------
  for (const d of declared) {
    const e = get(d.elementId);
    if (!e) continue;
    if (!rectContains(dump.screenRect, e.node!.bounds!)) {
      findings.push({
        tier: 'hard',
        signal: 'A2_out_of_screen',
        bbox: normBBox(e.node!.bounds!, dump.appRect),
        note: `元素 [${d.elementId}] bounds ${JSON.stringify(e.node!.bounds)} 越出屏幕 ${JSON.stringify(dump.screenRect)}`,
      });
    }
  }

  // --- A-3 close 默认规则（advisory，D5 零误伤后方可晋级）------------------------
  if (screen.root?.type === 'overlay_panel') {
    const app = dump.appRect;
    const w = app.x2 - app.x1;
    const h = app.y2 - app.y1;
    const closeCandidates = flattenLayoutNodes(dump.appRoot).filter(e => {
      const b = e.node.bounds;
      if (!e.node.clickable || !b || rectArea(b) === 0 || e.node.children.length > 0) return false;
      const cx = (b.x1 + b.x2) / 2;
      const cy = (b.y1 + b.y2) / 2;
      return cx > app.x1 + 0.78 * w && cy < app.y1 + 0.35 * h && rectArea(b) < 0.02 * w * h;
    });
    for (const cand of closeCandidates) {
      for (const d of declared) {
        const e = get(d.elementId);
        if (!e || e.node === cand.node) continue;
        const kin = cand.ancestors.includes(e.node!) || (e.ancestors ?? []).includes(cand.node);
        if (kin) continue;
        if (rectsIntersect(cand.node.bounds!, e.node!.bounds!)) {
          findings.push({
            tier: 'advisory',
            signal: 'A3_close_overlap_default',
            bbox: normBBox(unionRect(cand.node.bounds!, e.node!.bounds!), dump.appRect),
            note: `overlay 右上疑似关闭钮（${cand.node.id || cand.node.type}@${JSON.stringify(cand.node.bounds)}）与声明元素 [${d.elementId}] 相交——advisory（默认规则待 D5 校准）；确定意图请在 ui-spec 声明 forbidden_overlap 升硬门禁`,
          });
        }
      }
    }
  }

  // --- A-4 全量两两相交扫描（advisory 观察期素材，永不 gate；rev7 补实现——
  //     此前仅注释/校准表宣称，cursor 抓出）。可交互叶子两两、非亲缘、上限 8 条防噪。 ----
  {
    const leaves = flattenLayoutNodes(dump.appRoot).filter(
      e => e.node.clickable && e.node.bounds && rectArea(e.node.bounds) > 0 && e.node.children.length === 0,
    );
    let emitted = 0;
    for (let i = 0; i < leaves.length && emitted < 8; i++) {
      for (let j = i + 1; j < leaves.length && emitted < 8; j++) {
        const a = leaves[i];
        const b = leaves[j];
        if (a.ancestors.includes(b.node) || b.ancestors.includes(a.node)) continue;
        if (rectsIntersect(a.node.bounds!, b.node.bounds!)) {
          const la = a.node.id || a.node.text || a.node.type;
          const lb = b.node.id || b.node.text || b.node.type;
          findings.push({
            tier: 'advisory',
            signal: 'A4_pairwise_overlap',
            bbox: normBBox(unionRect(a.node.bounds!, b.node.bounds!), dump.appRect),
            note: `可交互叶子「${la}」与「${lb}」bounds 相交——观察期素材（嵌套热区/badge/浮层可为合法形态）；确定意图请声明 forbidden_overlap 升硬门禁`,
          });
          emitted++;
        }
      }
    }
  }

  // --- B 类（依赖 locator，覆盖率不足整类 SKIP）---------------------------------
  const bClassSkipped = coverage < LOCATOR_COVERAGE_THRESHOLD;
  if (!bClassSkipped && screen.root) {
    // B-1 同 layout_group 共最近容器或同行（y 带重叠）
    const groups = new Map<string, string[]>();
    const collectGroups = (n: UiSpecComponentNode): void => {
      const g = (n as { layout_group?: string }).layout_group?.trim();
      if (g && typeof n.id === 'string' && n.id.trim()) {
        const list = groups.get(g) ?? [];
        list.push(n.id.trim());
        groups.set(g, list);
      }
      for (const c of n.children ?? []) collectGroups(c);
    };
    collectGroups(screen.root);
    for (const [g, ids] of groups) {
      const nodes = ids.map(id => get(id)).filter((e): e is LocatedElement => Boolean(e));
      if (nodes.length < 2) continue;
      for (let i = 1; i < nodes.length; i++) {
        const a = nodes[0].node!.bounds!;
        const b = nodes[i].node!.bounds!;
        const yOverlap = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
        // 共直接父容器豁免——但父=页面根不算（页面根装下一切，豁免会吞掉真背离）
        const pa = (nodes[0].ancestors ?? []).slice(-1)[0];
        const pb = (nodes[i].ancestors ?? []).slice(-1)[0];
        const sharesParent = pa !== undefined && pa === pb && pa !== dump.appRoot;
        if (yOverlap <= 0 && !sharesParent) {
          findings.push({
            tier: 'warn',
            signal: 'B1_layout_group_divergent',
            note: `layout_group=${g} 的 [${nodes[0].elementId}] 与 [${nodes[i].elementId}] 运行时既不同行（y 带无重叠）也不共直接父容器——声明的同行/同组关系未实现`,
          });
        }
      }
    }

    // B-2 声明分组容器（bg_color 父节点）children 须共最近公共容器（非页面根）
    const walkGroupContainers = (n: UiSpecComponentNode): void => {
      const bg = (n as { bg_color?: string }).bg_color?.trim();
      const kids = (n.children ?? []).filter(c => typeof c.id === 'string' && c.id?.trim());
      if (bg && kids.length >= 2) {
        const locatedKids = kids.map(k => get(k.id as string)).filter((e): e is LocatedElement => Boolean(e));
        if (locatedKids.length >= 2) {
          const ancestorSets = locatedKids.map(e => new Set(e.ancestors ?? []));
          const shared = [...ancestorSets[0]].filter(a => ancestorSets.every(s => s.has(a)));
          const meaningful = shared.filter(a => a.bounds && rectArea(a.bounds) < 0.9 * rectArea(dump.appRect));
          if (meaningful.length === 0) {
            findings.push({
              tier: 'warn',
              signal: 'B2_group_container_missing',
              note: `声明分组容器 [${n.id ?? n.type}]（bg_color=${bg}）的子元素 ${locatedKids.map(e => e.elementId).join('/')} 运行时无共同子容器（最近公共祖先≈页面根）——疑似被实现为独立块而非同卡`,
            });
          }
        }
      }
      for (const c of n.children ?? []) walkGroupContainers(c);
    };
    walkGroupContainers(screen.root);

    // B-3 ui-spec order → 运行时 y 序单调（同 layout_group 豁免=同行）
    const walkOrder = (n: UiSpecComponentNode): void => {
      const kids = (n.children ?? [])
        .filter(c => typeof c.id === 'string' && c.id?.trim() && typeof c.order === 'number')
        .sort((a, b) => (a.order as number) - (b.order as number));
      for (let i = 1; i < kids.length; i++) {
        const prev = kids[i - 1];
        const cur = kids[i];
        const gPrev = (prev as { layout_group?: string }).layout_group?.trim();
        const gCur = (cur as { layout_group?: string }).layout_group?.trim();
        if (gPrev && gPrev === gCur) continue;
        const a = get(prev.id as string);
        const b = get(cur.id as string);
        if (!a || !b) continue;
        if (b.node!.bounds!.y1 < a.node!.bounds!.y1 - 1) {
          findings.push({
            tier: 'warn',
            signal: 'B3_order_inverted',
            note: `[${prev.id}]（order=${prev.order}）与 [${cur.id}]（order=${cur.order}）运行时纵向顺序颠倒（y=${a.node!.bounds!.y1} vs ${b.node!.bounds!.y1}）`,
          });
        }
      }
      for (const c of n.children ?? []) walkOrder(c);
    };
    walkOrder(screen.root);

    // C-1 相邻兄弟间距比例 vs ui-spec ref bbox 推导（永久 advisory）
    const tol = typeof input.gapTolerance === 'number' ? input.gapTolerance : 0.25;
    const appH = Math.max(1, dump.appRect.y2 - dump.appRect.y1);
    const walkGaps = (n: UiSpecComponentNode): void => {
      const kids = (n.children ?? [])
        .filter(c => typeof c.id === 'string' && c.id?.trim() && Array.isArray(c.bbox) && c.bbox.length === 4 && typeof c.order === 'number')
        .sort((a, b) => (a.order as number) - (b.order as number));
      for (let i = 1; i < kids.length; i++) {
        const prev = kids[i - 1];
        const cur = kids[i];
        const a = get(prev.id as string);
        const b = get(cur.id as string);
        if (!a || !b) continue;
        const refGap = (cur.bbox as number[])[1] - ((prev.bbox as number[])[1] + (prev.bbox as number[])[3]);
        if (refGap < 0) continue;
        const runGap = (b.node!.bounds!.y1 - a.node!.bounds!.y2) / appH;
        if (runGap >= 0 && Math.abs(runGap - refGap) > tol) {
          findings.push({
            tier: 'advisory',
            signal: 'C1_gap_ratio_divergent',
            note: `[${prev.id}]→[${cur.id}] 间距比例 ${runGap.toFixed(3)} vs 参考推导 ${refGap.toFixed(3)}（偏差>${tol}）——advisory 供 critic/人复核，永不 gate`,
          });
        }
      }
      for (const c of n.children ?? []) walkGaps(c);
    };
    walkGaps(screen.root);
  }

  return { screenId, coverage, bClassSkipped, findings };
}

// ---------------------------------------------------------------------------
// 文件级入口：读 layout-<screen_id>.json 并跑断言
// ---------------------------------------------------------------------------

export function loadLayoutDumpFile(absPath: string): ParsedLayoutDump | null {
  if (!fs.existsSync(absPath)) return null;
  try {
    return parseHypiumDump(JSON.parse(fs.readFileSync(absPath, 'utf-8')));
  } catch {
    return null;
  }
}
