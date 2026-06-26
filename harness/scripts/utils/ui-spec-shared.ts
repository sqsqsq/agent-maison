// ============================================================================
// ui-spec-shared.ts — UI-DSL 解析与 ui_change 联动（spec / plan / coding 共用）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { extractCodeBlocks } from './markdown-parser';

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
  /** G4b：crop 人工确认者；headless 下须为非自动化身份（堵自报，对齐 deferral signed_by） */
  crop_confirmed_by?: string;
}

export interface UiSpecDoc {
  schema_version?: string;
  verified?: UiSpecVerified;
  verified_method?: string;
  screens: UiSpecScreen[];
  tokens: Record<string, UiSpecToken>;
  assets: UiSpecAsset[];
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
  return path.join(projectRoot, 'doc', 'features', feature, 'spec', 'ui-spec.yaml');
}

export function uiSpecRelPath(projectRoot: string, feature: string): string {
  return path.join('doc', 'features', feature, 'spec', 'ui-spec.yaml').replace(/\\/g, '/');
}

export function visualParityAbsPath(projectRoot: string, feature: string): string {
  return path.join(projectRoot, 'doc', 'features', feature, 'plan', 'visual-parity.yaml');
}

export function loadUiSpecFile(absPath: string): UiSpecDoc | null {
  if (!fs.existsSync(absPath)) return null;
  const raw = fs.readFileSync(absPath, 'utf-8');
  try {
    const doc = YAML.parse(raw) as UiSpecDoc;
    if (!doc || typeof doc !== 'object') return null;
    return doc;
  } catch {
    return null;
  }
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
