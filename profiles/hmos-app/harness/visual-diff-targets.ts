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

function walkP0OverlayNodes(
  node: UiSpecComponentNode | undefined,
  screenId: string,
  out: Array<{ id: string; parentScreenId: string }>,
): void {
  if (!node) return;
  const t = (node.type ?? '').toLowerCase();
  if (t === 'overlay_panel' || t.includes('sheet') || t === 'dialog') {
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

/** P0 屏 + P0 overlay target（visual_diff 必须覆盖的最小集合） */
export function collectP0VisualTargetIds(uiDoc: UiSpecDoc | null): string[] {
  const screenIds = collectP0ScreenIds(uiDoc);
  const overlayIds = collectP0OverlayTargetIds(uiDoc).map(o => o.id);
  return [...new Set([...screenIds, ...overlayIds])];
}
