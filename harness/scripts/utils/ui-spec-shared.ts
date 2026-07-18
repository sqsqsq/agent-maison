// ============================================================================
// ui-spec-shared.ts — UI-DSL 解析与 ui_change 联动（spec / plan / coding 共用）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { extractCodeBlocks } from './markdown-parser';
import { shapeName, takeArray } from './shape-guards';
import { featureFilePath, relFeatureFile } from '../../config';

const requireHarness = createRequire(path.resolve(__dirname, '../../harness-runner.ts'));
const YAML = requireHarness('yaml') as { parse: (s: string) => unknown };

export type UiChangeValue =
  | 'none'
  | 'reuse_only'
  | 'impl_out_of_band'
  | 'new_or_changed'
  | 'copy_edits_only';

export const UI_CHANGE_REQUIRES_UI_SPEC = new Set<UiChangeValue>([
  'new_or_changed',
  'copy_edits_only',
]);

export type UiSpecVerified = 'verified' | 'unverified' | 'human_confirmed';

export type UiSpecSemanticRole = 'success' | 'brand_primary' | 'danger' | 'promo' | 'neutral';

/** G3：按钮视觉变体——治"brand_primary 实心蓝 vs 浅灰药丸/幽灵按钮"错绑 */
export type UiSpecButtonVariant = 'filled' | 'tonal' | 'outlined' | 'ghost' | 'text';
/** G3：主轴对齐（同行内 / 容器内） */
export type UiSpecAlign = 'start' | 'center' | 'end' | 'space_between' | 'stretch';

export interface UiSpecIconRef {
  kind?: 'brand_logo' | 'system_symbol' | 'illustration';
  ref?: string;
}

export interface UiSpecComponentNode {
  id?: string;
  type: string;
  /**
   * blind-visual-hardening d3：容器/结构语义节点 → UI kit block 映射声明
   * （nav_bar/list_card_container/list_row/sheet_scaffold/primary_button/selector_group/
   * result_state/sms_code_field/detail_section）。声明后进入三段闭环校验：
   * 声明 → 源码命中 block 锚点 → 运行时 uitree 出现锚点（ui-kit-conformance）。
   */
  block?: string;
  layout?: string;
  order: number;
  text?: string;
  data_binding?: string;
  style_ref?: string;
  asset_ref?: string;
  bbox?: number[];
  semantic_role?: UiSpecSemanticRole;
  color_ref?: string;
  icon?: UiSpecIconRef;
  badge?: string;
  /** G3：按钮视觉变体（filled/tonal/outlined/ghost/text） */
  variant?: UiSpecButtonVariant;
  /** G3：同行/同容器布局分组 id（同一 layout_group 的元素在同一行/容器内） */
  layout_group?: string;
  /** G3：主轴对齐 */
  align?: UiSpecAlign;
  /** G3：宽度占比 0–1（治"全宽按钮 vs 右侧药丸"） */
  width_ratio?: number;
  /** G3：区域/容器背景色 token（卡包区灰底 vs 实现蓝底） */
  bg_color?: string;
  /** P0-E（f2d8c4a6）：受控近似的显式承认（如"原图彩色线性图标，以 system_symbol+着色近似"）——诚实记录保真妥协 */
  fidelity_note?: string;
  /** P0-D（f2d8c4a6）：list_row 副标题文本——副标题必须建模在主节点上（禁独立平铺节点），配 subtitle_position */
  subtitle?: string;
  /** P0-D：副标题位置（trailing=与主标题同行右置 / below=题下）——round6 实证不声明则 coding 惯用题下排错 */
  subtitle_position?: 'trailing' | 'below';
  children?: UiSpecComponentNode[];
}

export interface UiSpecScreen {
  id: string;
  priority: string;
  ref_id?: string;
  root?: UiSpecComponentNode;
  lightweight?: boolean;
  /** 屏级必备元素 id（search_bar / letter_index / promo_badge 等） */
  must_have_elements?: string[];
  /**
   * T8-A1（plan c6d8f2b4）：禁止重叠元素对——运行时布局树 bounds 相交即 pixel_1to1 BLOCKER。
   * 每项恰为两个元素 id（组件树节点 id 或 must_have_elements 项）。
   */
  forbidden_overlap?: string[][];
  /** T8-A1：保护区元素——任何非亲缘可交互控件的 bounds 侵入即 BLOCKER */
  protected_region?: string[];
}

export interface UiSpecToken {
  kind: string;
  value: string;
  source_bbox?: number[];
  source_ref?: string;
  sampled?: boolean;
}

export interface UiSpecAsset {
  key: string;
  acquisition: string;
  source_ref?: string;
  source_bbox?: number[];
  resolved_path?: string;
  placeholder?: boolean;
  rationale?: string;
  human_crop_confirmed?: boolean;
  /** G4b：crop 确认来源；headless 下须为非自动化身份或 user_requirement（堵自报，对齐 deferral signed_by） */
  crop_confirmed_by?: string;
  /** round5 P0-A：显式放行"素材图内含 ui-spec 声明文本"（营销/装饰插画确需含字时）；须配 human_signed 署名 */
  baked_text_defer?: boolean;
  /** round5 P0-A：baked_text_defer 的真人署名（非自动化身份，经 isHumanConfirmed 校验）；缺则 defer 无效 */
  baked_text_defer_by?: string;
  /**
   * P0-C（f2d8c4a6 授权/验真拆位）：crop 产物**验真**的真人确认署名（对照 contact-sheet 确认"裁对了"）。
   * 与 crop_confirmed_by（裁剪**授权**）语义正交：授权解锁裁剪路径，验真确认产物正确；
   * asset_crop_validation 的 VL 隔离辨认不可用/失配时，此署名是唯一逃生阀（自动化身份不算）。
   */
  bbox_verified_by?: string;
  /**
   * blind-visual-hardening d2（design §1.6）：crop 产物来源记录——盲档下 crop 禁令的
   * external_tool 放行通道（外部裁剪工具产物：工具名 + 源图 hash + bbox 记录）。
   * 诚实边界：记录结构存在性可确定性校验，工具真实性不做密码学验证（provenance 三来源的
   * 另两路 verified_artifact / human_receipt 分别由 asset-crop-validation 与 confirmation
   * receipt 承担强验证）。
   */
  crop_provenance?: {
    kind?: string;
    tool?: string;
    source_sha256?: string;
    bbox?: number[];
  };
}

/**
 * T5：全局元素（如底部「首页/我的」Tab）——声明文本锚点 + 所属屏，供 OCR 越界检测。
 * 判据靠**声明式归属**，不靠 root 类型猜（实测 card_pack/add_card 的 root 也是 navigation_frame@0、与 home 同型）。
 */
export interface UiSpecGlobalElement {
  id: string;
  /** 文本锚点（OCR 模糊匹配，如 ['首页','我的']）——全部命中于 band 才算该元素出现 */
  texts: string[];
  /** 所属屏 id 集合——仅这些屏可渲染该全局元素；其它屏出现 = 越界 */
  owner_screen_ids: string[];
  /** 纵向 band [start,end] 归一化（默认底部 [0.85,1]）——限定在该区域内检测，避免误命中正文同名字 */
  band?: { start: number; end?: number };
}

export interface UiSpecDoc {
  schema_version?: string;
  verified?: UiSpecVerified;
  verified_method?: string;
  screens: UiSpecScreen[];
  tokens: Record<string, UiSpecToken>;
  assets: UiSpecAsset[];
  /** T5：全局元素归属声明（可选；声明后才启用 OCR 越界门禁） */
  global_elements?: UiSpecGlobalElement[];
}

export type VisualEnforcementMode = 'strict' | 'warn' | 'reachable' | 'off';

export function parseUiChangeFromSpecMarkdown(prd: string): UiChangeValue | null {
  const doc = parseVisualHandoffYamlRoot(prd);
  if (!doc) return null;
  const raw = doc.ui_change;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return raw.trim() as UiChangeValue;
}

export function parseVisualHandoffYamlRoot(prd: string): Record<string, unknown> | null {
  const blocks = extractCodeBlocks(prd, 'yaml');
  for (const b of blocks) {
    try {
      const doc = YAML.parse(b.content);
      if (
        doc !== null &&
        typeof doc === 'object' &&
        !Array.isArray(doc) &&
        Object.prototype.hasOwnProperty.call(doc, 'ui_change')
      ) {
        return doc as Record<string, unknown>;
      }
    } catch {
      /* continue */
    }
  }
  return null;
}

export function uiSpecAbsPath(projectRoot: string, feature: string): string {
  return featureFilePath(projectRoot, feature, path.join('spec', 'ui-spec.yaml'));
}

export function uiSpecRelPath(projectRoot: string, feature: string): string {
  return relFeatureFile(projectRoot, feature, 'spec/ui-spec.yaml');
}

export function visualParityAbsPath(projectRoot: string, feature: string): string {
  return featureFilePath(projectRoot, feature, path.join('plan', 'visual-parity.yaml'));
}

/**
 * P0-2（plan d9b4f7e2）：ui-spec.yaml 加载 + **形状归一化**——agent 把数组字段写成
 * `{}`/`""` 等非数组真值时（07-13 现场三处门禁 TypeError 崩溃的根源），在唯一 loader
 * 入口归一为空数组，所有消费者（spec-ui-spec / asset-manifest / asset-acquisition /
 * asset-crop / capture-completeness / fidelity-governance）一次性防崩。
 * 形状偏差**留痕**在 shapeIssues——主门禁（checkUiSpecStructure）必须消费并产出
 * 结构化 FAIL，归一化不许把坏形状安静洗成 PASS。
 */
export function loadUiSpecFileWithShapeIssues(
  absPath: string,
): { doc: UiSpecDoc; shapeIssues: string[] } | null {
  if (!fs.existsSync(absPath)) return null;
  const raw = fs.readFileSync(absPath, 'utf-8');
  let doc: UiSpecDoc;
  try {
    const parsed = YAML.parse(raw) as UiSpecDoc;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    doc = parsed;
  } catch {
    return null;
  }
  const shapeIssues: string[] = [];
  const rec = doc as unknown as Record<string, unknown>;
  rec.assets = takeArray(rec.assets, 'assets', shapeIssues);
  rec.screens = takeArray(rec.screens, 'screens', shapeIssues);
  if (rec.global_elements !== undefined) {
    rec.global_elements = takeArray(rec.global_elements, 'global_elements', shapeIssues);
  }
  if (rec.tokens !== undefined && (rec.tokens === null || typeof rec.tokens !== 'object' || Array.isArray(rec.tokens))) {
    shapeIssues.push(`tokens 应为映射（YAML map），实际是 ${shapeName(rec.tokens)}——最小合法样例：\`tokens: {}\``);
    rec.tokens = {};
  }
  for (const g of doc.global_elements ?? []) {
    if (!g || typeof g !== 'object') continue;
    const gr = g as unknown as Record<string, unknown>;
    gr.texts = takeArray(gr.texts, `global_elements[${String(gr.id ?? '?')}].texts`, shapeIssues);
    gr.owner_screen_ids = takeArray(gr.owner_screen_ids, `global_elements[${String(gr.id ?? '?')}].owner_screen_ids`, shapeIssues);
  }
  for (const s of doc.screens) {
    if (!s || typeof s !== 'object') continue;
    const sr = s as unknown as Record<string, unknown>;
    if (sr.must_have_elements !== undefined) {
      sr.must_have_elements = takeArray(sr.must_have_elements, `screens[${String(sr.id ?? '?')}].must_have_elements`, shapeIssues);
    }
    normalizeComponentTreeShapes(s.root, `screens[${String(sr.id ?? '?')}].root`, shapeIssues);
  }
  return { doc, shapeIssues };
}

/** 组件树递归归一化：children 非数组真值 → [] + 留痕（walkComponentNodes 的 for..of 防崩）。 */
function normalizeComponentTreeShapes(
  node: UiSpecComponentNode | undefined,
  label: string,
  shapeIssues: string[],
): void {
  if (!node || typeof node !== 'object') return;
  const nr = node as unknown as Record<string, unknown>;
  if (nr.children !== undefined) {
    nr.children = takeArray(nr.children, `${label}.children`, shapeIssues);
  }
  for (let i = 0; i < (node.children ?? []).length; i++) {
    normalizeComponentTreeShapes(node.children![i], `${label}.children[${i}]`, shapeIssues);
  }
}

export function loadUiSpecFile(absPath: string): UiSpecDoc | null {
  return loadUiSpecFileWithShapeIssues(absPath)?.doc ?? null;
}

export function structureFailOrWarn(enforcement: VisualEnforcementMode | undefined): {
  severity: 'BLOCKER' | 'MAJOR';
  status: 'FAIL' | 'WARN';
} {
  const soft = enforcement === 'warn' || enforcement === 'reachable';
  return soft ? { severity: 'MAJOR', status: 'WARN' } : { severity: 'BLOCKER', status: 'FAIL' };
}

export function walkComponentNodes(
  node: UiSpecComponentNode | undefined,
  out: UiSpecComponentNode[],
): void {
  if (!node) return;
  out.push(node);
  for (const c of node.children ?? []) {
    walkComponentNodes(c, out);
  }
}

export function collectAllComponentNodes(doc: UiSpecDoc): UiSpecComponentNode[] {
  const nodes: UiSpecComponentNode[] = [];
  for (const s of doc.screens ?? []) {
    walkComponentNodes(s.root, nodes);
  }
  return nodes;
}

export function collectCopyTexts(doc: UiSpecDoc): string[] {
  const texts: string[] = [];
  for (const n of collectAllComponentNodes(doc)) {
    if (typeof n.text === 'string' && n.text.trim()) {
      texts.push(n.text.trim());
    }
  }
  return texts;
}

/** P0 屏 id + 带 id 的组件节点（plan visual-parity components 覆盖） */
export function collectP0ComponentNodeIds(doc: UiSpecDoc): string[] {
  const ids: string[] = [];
  for (const s of doc.screens ?? []) {
    if (s.priority !== 'P0' || s.lightweight) continue;
    ids.push(s.id);
    const nodes: UiSpecComponentNode[] = [];
    walkComponentNodes(s.root, nodes);
    for (const n of nodes) {
      if (n.id) ids.push(n.id);
    }
  }
  return [...new Set(ids)];
}

/** 扁平化 contracts.resource_keys（module → category → entries） */
export function flattenResourceKeyEntries(
  resourceKeys: Record<string, Record<string, Array<{ key: string; value?: string; path?: string }>>> | undefined,
): Array<{ key: string; value?: string; path?: string }> {
  const out: Array<{ key: string; value?: string; path?: string }> = [];
  if (!resourceKeys) return out;
  for (const mod of Object.values(resourceKeys)) {
    for (const entries of Object.values(mod)) {
      if (Array.isArray(entries)) out.push(...entries);
    }
  }
  return out;
}
