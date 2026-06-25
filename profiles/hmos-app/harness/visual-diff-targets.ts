// ============================================================================
// visual-diff-targets.ts — P0 屏 / overlay visual target 集合（capture + check 共享）
// ============================================================================

import type { UiSpecComponentNode, UiSpecDoc } from '../../../harness/scripts/utils/ui-spec-shared';

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
    if (s.priority === 'P0' && !s.lightweight) walkP0OverlayNodes(s.root, s.id, out);
  }
  return out;
}

/** ui-spec 中 P0 且非 lightweight 的屏 id */
export function collectP0ScreenIds(uiDoc: UiSpecDoc | null): string[] {
  const ids: string[] = [];
  for (const s of uiDoc?.screens ?? []) {
    if (s.priority === 'P0' && !s.lightweight) ids.push(s.id);
  }
  return [...new Set(ids)];
}

/** P0 屏 + P0 overlay target（visual_diff 必须覆盖的最小集合） */
export function collectP0VisualTargetIds(uiDoc: UiSpecDoc | null): string[] {
  const screenIds = collectP0ScreenIds(uiDoc);
  const overlayIds = collectP0OverlayTargetIds(uiDoc).map(o => o.id);
  return [...new Set([...screenIds, ...overlayIds])];
}
