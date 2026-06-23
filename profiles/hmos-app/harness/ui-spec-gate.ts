// ============================================================================
// ui-spec gate 证据解析（spec.md 逐屏 [x]）
// ============================================================================

import type { UiSpecDoc } from '../../../harness/scripts/utils/ui-spec-shared';

/** 从 spec.md 收集 ui-spec gate 已确认屏 id */
export function collectUiSpecGateConfirmedScreens(specMarkdown: string): Set<string> {
  const confirmed = new Set<string>();
  for (const line of specMarkdown.split('\n')) {
    const bullet = line.match(/^\s*-\s*\[x\]\s*(?:screen[:：]\s*)?([A-Za-z0-9_-]+)/i);
    if (bullet) confirmed.add(bullet[1]);
    const table = line.match(/\|\s*([A-Za-z0-9_-]+)\s*\|[^|\n]*\|\s*\[x\]\s*\|/i);
    if (table) confirmed.add(table[1]);
    const gateSection = line.match(/^\s*\[x\]\s*([A-Za-z0-9_-]+)\s*$/i);
    if (gateSection) confirmed.add(gateSection[1]);
  }
  return confirmed;
}

/** human_confirmed 须逐 P0 屏有 [x] 证据（非 lightweight） */
export function missingUiSpecGateScreens(doc: UiSpecDoc, specMarkdown: string): string[] {
  const confirmed = collectUiSpecGateConfirmedScreens(specMarkdown);
  const missing: string[] = [];
  for (const s of doc.screens ?? []) {
    if (s.lightweight) continue;
    if (s.priority !== 'P0') continue;
    if (!confirmed.has(s.id)) missing.push(s.id);
  }
  return missing;
}
