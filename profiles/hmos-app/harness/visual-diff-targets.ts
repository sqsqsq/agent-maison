// ============================================================================
// visual-diff-targets.ts — P0 屏 / overlay visual target 集合（capture + check 共享）
// ============================================================================

import type { UiSpecComponentNode, UiSpecDoc, UiSpecScreen } from '../../../harness/scripts/utils/ui-spec-shared';

/**
 * P0 屏一律是 visual target——**lightweight 不豁免 P0**（T3）。
 * lightweight 本意是 P2/P3 轻量版 spec（可省细粒度树/bbox，见 ui-spec.md）；把它标在 P0 屏上是滥用，
 * 曾让 home_no_card（P0+lightweight）整个逃过设备 visual_diff（采集排除→verdict=skipped→无人评估）。
 * 设备 visual_diff 是截图对图、不需细粒度树，故 lightweight P0 仍可（且必须）被采集与评估。
 */
export function isP0VisualTargetScreen(s: Pick<UiSpecScreen, 'priority'>): boolean {
  return s.priority === 'P0';
}

/** 节点 type 是否为 overlay 类（overlay_panel / *sheet* / dialog） */
function isOverlayNodeType(type: string | undefined): boolean {
  const t = (type ?? '').toLowerCase();
  return t === 'overlay_panel' || t.includes('sheet') || t === 'dialog';
}

/**
 * 屏的 **root 本身**是否即 overlay（如 manage_non_local root=overlay_panel）——这类屏"就是那个半模态"，
 * 由其同基 overlay id 代表；base 屏 id 不应与 overlay id 重复计入 target（否则 base 永远找不到对应
 * 采集条目/nav 键 → 误判"未覆盖"/"缺 nav 配置"。overlay 作为**子节点**（如普通页里的 dialog）不算——
 * 那种 base 屏有独立可采集态，须各自覆盖。
 */
export function isOverlayRootScreen(s: Pick<UiSpecScreen, 'root'>): boolean {
  return isOverlayNodeType(s.root?.type);
}

function walkP0OverlayNodes(
  node: UiSpecComponentNode | undefined,
  screenId: string,
  out: Array<{ id: string; parentScreenId: string }>,
): void {
  if (!node) return;
  if (isOverlayNodeType(node.type)) {
    const oid = node.id ? `${screenId}__overlay__${node.id}` : `${screenId}__overlay__${node.order}`;
    out.push({ id: oid, parentScreenId: screenId });
  }
  for (const c of node.children ?? []) walkP0OverlayNodes(c, screenId, out);
}

/** P0 屏内 Sheet/Dialog overlay_panel 作为 visual target（须导航后补 shot）。 */
export function collectP0OverlayTargetIds(uiDoc: UiSpecDoc | null): Array<{ id: string; parentScreenId: string }> {
  const out: Array<{ id: string; parentScreenId: string }> = [];
  for (const s of uiDoc?.screens ?? []) {
    if (isP0VisualTargetScreen(s)) walkP0OverlayNodes(s.root, s.id, out);
  }
  return out;
}

/** ui-spec 中 P0 屏 id（lightweight 不豁免——T3） */
export function collectP0ScreenIds(uiDoc: UiSpecDoc | null): string[] {
  const ids: string[] = [];
  for (const s of uiDoc?.screens ?? []) {
    if (isP0VisualTargetScreen(s)) ids.push(s.id);
  }
  return [...new Set(ids)];
}

/**
 * P0 屏 + P0 overlay target（visual_diff 必须覆盖的最小集合）。
 * root 即 overlay 的 base 屏（manage_non_local）由其同基 overlay id 代表、不重复计入——否则 base 屏
 * 永远找不到采集条目/nav 键 → 误判"未覆盖"/"缺 nav 配置"（本轮 review 四轮实测 FP 根治点）。
 */
export function collectP0VisualTargetIds(uiDoc: UiSpecDoc | null): string[] {
  const overlays = collectP0OverlayTargetIds(uiDoc);
  const overlayBaseSet = new Set(overlays.map(o => o.parentScreenId));
  const screenById = new Map((uiDoc?.screens ?? []).map(s => [s.id, s] as const));
  const screenIds = collectP0ScreenIds(uiDoc).filter(id => {
    const s = screenById.get(id);
    return !(s && isOverlayRootScreen(s) && overlayBaseSet.has(id));
  });
  const overlayIds = overlays.map(o => o.id);
  return [...new Set([...screenIds, ...overlayIds])];
}
