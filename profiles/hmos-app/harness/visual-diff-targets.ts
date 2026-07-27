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

// ---------------------------------------------------------------------------
// golden 显式 capture targets（c4e8b1d3 G3 生产接线）
// ---------------------------------------------------------------------------
// golden contract 的 declared 屏是**显式目标，不受全局 P0 过滤**（现状
// collectP0OverlayTargetIds 先过 isP0VisualTargetScreen，P1 的 bank_card_list_sheet
// 永远进不了 overlay 遍历——只改 evaluator 会得到"契约要求、采集器永不生产、恒 FAIL"）。
// 普通 visual-diff 不传 golden targets，仍保持 P0-only（不因此全局扩面）。

export interface GoldenScreenTarget {
  /** ui-spec 中的 declared screen id */
  declared: string;
  /** 期望的 capture id（overlay-root 屏 = `<declared>__overlay__<id|order>`；否则=declared） */
  capture: string;
}

/** golden 负向目标（如 HomeTab）：导航到该屏 dump UITree，证据须**不含** anchor。
 * evidence = 相对 feature 目录的落盘路径；capture 写 wrapper（run/build 绑定），
 * evaluator 只认 wrapper——裸 dump/历史残留不采信（round20 P1）。 */
export interface GoldenForbiddenTarget {
  id: string;
  anchor: string;
  evidence: string;
}

export interface GoldenTargetResolution {
  /** 追加进主循环的 base 屏（capture===declared 且非 overlay-root） */
  extraScreens: UiSpecScreen[];
  /** 追加进 overlay 循环的 overlay targets */
  extraOverlays: Array<{ id: string; parentScreenId: string }>;
  /** fail-closed 失败（declared 缺失 / 形态不符 / capture id 失配）——每条含 declared id 与原因 */
  failures: Array<{ declared: string; reason: string }>;
}

/** 单屏 overlay target 收集（**无 P0 过滤**——golden 显式目标专用） */
export function collectOverlayTargetIdsForScreen(s: UiSpecScreen): Array<{ id: string; parentScreenId: string }> {
  const out: Array<{ id: string; parentScreenId: string }> = [];
  walkP0OverlayNodes(s.root, s.id, out);
  return out;
}

/**
 * contract 的 declared → capture 映射逐条解析为采集目标。
 * fail-closed：declared 屏在 ui-spec 缺失、或形态与 capture id 不符（如 contract 期望
 * `__overlay__0` 但屏已不是 overlay root）→ failures（调用方须把它计入采集失败，不静默跳过）。
 */
export function resolveGoldenCaptureTargets(
  uiDoc: UiSpecDoc | null,
  targets: GoldenScreenTarget[],
): GoldenTargetResolution {
  const res: GoldenTargetResolution = { extraScreens: [], extraOverlays: [], failures: [] };
  const byId = new Map((uiDoc?.screens ?? []).map(s => [s.id, s] as const));
  for (const t of targets) {
    const s = byId.get(t.declared);
    if (!s) {
      res.failures.push({ declared: t.declared, reason: `declared 屏在宿主 ui-spec 中缺失（contract 要求存在）` });
      continue;
    }
    if (t.capture === t.declared) {
      if (isOverlayRootScreen(s)) {
        res.failures.push({
          declared: t.declared,
          reason: `形态不符：屏 root 是 overlay（capture id 应为 ${t.declared}__overlay__*，contract 却期望同名 capture）`,
        });
        continue;
      }
      res.extraScreens.push(s);
      continue;
    }
    const overlays = collectOverlayTargetIdsForScreen(s);
    if (!overlays.some(o => o.id === t.capture)) {
      res.failures.push({
        declared: t.declared,
        reason: `capture id 失配：contract 期望 ${t.capture}，屏实际可解析 overlay=[${overlays.map(o => o.id).join(', ') || '无'}]（形态漂移或 overlay 命名变化）`,
      });
      continue;
    }
    res.extraOverlays.push({ id: t.capture, parentScreenId: t.declared });
  }
  return res;
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
