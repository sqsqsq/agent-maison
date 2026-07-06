// ============================================================================
// visual-diff-nav.ts — round5 P1-A：设备采集的显式导航配置（schema + 校验 + 屏 id 归一化）
// ----------------------------------------------------------------------------
// 病灶：visual_diff_capture 只对可直达顶层屏裸截图、不按 Tab/Nav 导航 → 多屏截同一帧（5 屏同 hash）。
// 本模块把"每屏到达步骤"形式化为**显式固化配置**（Q2 拍板：固化 nav 配置为唯一真源，页面无变化则复用），
// 供采集层按屏导航到位再截。**X1（codex）**：同一逻辑屏存在 screen_id / ref_id / overlay_id(__overlay__*) /
// nav_key 多套写法（manage_non_local vs manage_non_local__overlay__0 vs __overlay__manage_non_local_root），
// 故 nav_key ↔ P0 target 的匹配须先归一化（否则本已失败的 overlay 屏仍被判"未覆盖/不一致"）。
// 步骤词汇复用 Hylyre planned-step 根键（touch/wait_for/back/…），screenshot 由采集层单独发，不进 steps。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  PLANNED_STEP_ROOT_KEY_SET,
  FORBIDDEN_STEP_ROOT_KEY_SET,
} from '../../../harness/scripts/utils/hylyre-planned-step-keys';
import { featureDir } from '../../../harness/config';

/** 单条导航步：一个 planned-step 根键（touch/wait_for/back/…）+ 其参数。 */
export type NavStep = Record<string, unknown>;

/** 一屏到达步骤序列。顶层可直达屏可为空数组（无需导航）。 */
export type NavScreenSteps = NavStep[];

/** nav 配置：key=屏标识（规范化到 P0 target id），value=到达步骤。 */
export type NavConfig = Record<string, NavScreenSteps>;

export const OVERLAY_SEP = '__overlay__';

/** 显式固化 nav 配置路径：<features_dir>/<feature>/device-testing/visual-diff-nav.json（Q2 唯一真源；P0-9 顺手项走 featureDir 尊重 paths.features_dir） */
export function visualDiffNavConfigPath(projectRoot: string, feature: string): string {
  return path.join(featureDir(projectRoot, feature), 'device-testing', 'visual-diff-nav.json');
}

/** 读固化 nav 配置；缺文件/非法 JSON → null（采集层据此不导航、走旧裸采并由一致性校验报缺配置）。 */
export function loadVisualDiffNavConfig(projectRoot: string, feature: string): NavConfig | null {
  const p = visualDiffNavConfigPath(projectRoot, feature);
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as NavConfig;
  } catch {
    return null;
  }
}

/** overlay 屏基名：`<base>__overlay__<x>` → `<base>`；非 overlay → 原样。 */
export function canonicalOverlayBase(id: string): string {
  const trimmed = (id ?? '').trim();
  const idx = trimmed.indexOf(OVERLAY_SEP);
  return idx > 0 ? trimmed.slice(0, idx) : trimmed;
}

export function isOverlayId(id: string): boolean {
  return (id ?? '').includes(OVERLAY_SEP);
}

/**
 * nav_key 是否命中某 P0 target（X1 归一化）：
 *  1) 精确相等；或
 *  2) 二者都是 overlay 且**同一基屏**（吸收 `__overlay__0` vs `__overlay__manage_non_local_root` 的后缀差异）。
 * 不允许 base 屏与其 overlay 互串（base 屏须精确匹配 base 屏，避免主屏被 overlay 假覆盖）。
 */
export function navKeyMatchesTarget(navKey: string, targetId: string): boolean {
  const k = (navKey ?? '').trim();
  const t = (targetId ?? '').trim();
  if (!k || !t) return false;
  if (k === t) return true;
  if (isOverlayId(k) && isOverlayId(t)) {
    return canonicalOverlayBase(k) === canonicalOverlayBase(t);
  }
  return false;
}

export interface NavResolveResult {
  /** P0 target id → 到达步骤（经归一化匹配到的 nav 条目） */
  resolved: Map<string, NavScreenSteps>;
  /** ui-spec 有该 P0 target、但 nav 配置无匹配条目 */
  missingTargets: string[];
  /** nav 配置有该 key、但不匹配任何 P0 target（多余/错写） */
  unmatchedKeys: string[];
}

/** 把 nav 配置按 P0 target 集合解析（X1 归一化匹配）。 */
export function resolveNavForTargets(navConfig: NavConfig, p0TargetIds: string[]): NavResolveResult {
  const keys = Object.keys(navConfig ?? {});
  const resolved = new Map<string, NavScreenSteps>();
  const usedKeys = new Set<string>();
  const missingTargets: string[] = [];
  for (const target of p0TargetIds) {
    // 精确优先，其次同基 overlay 匹配
    let hitKey = keys.find(k => k === target);
    if (!hitKey) hitKey = keys.find(k => navKeyMatchesTarget(k, target));
    if (hitKey) {
      resolved.set(target, navConfig[hitKey] ?? []);
      usedKeys.add(hitKey);
    } else {
      missingTargets.push(target);
    }
  }
  const unmatchedKeys = keys.filter(k => !usedKeys.has(k));
  return { resolved, missingTargets, unmatchedKeys };
}

/** 校验单条 step 形状：须为对象、恰含 1 个合法 planned-step 根键、禁 CLI 子命令键（screenshot 等）。 */
export function validateNavStep(step: NavStep, index: number): string[] {
  const errs: string[] = [];
  if (!step || typeof step !== 'object' || Array.isArray(step)) {
    return [`step[${index}] 须为对象`];
  }
  const rootKeys = Object.keys(step);
  if (rootKeys.length !== 1) {
    errs.push(`step[${index}] 须恰含 1 个根键（收到 ${rootKeys.length}：${rootKeys.join(',')}）`);
  }
  for (const k of rootKeys) {
    if (FORBIDDEN_STEP_ROOT_KEY_SET.has(k)) {
      errs.push(`step[${index}] 根键 '${k}' 是 CLI 子命令、禁作 step（screenshot 由采集层单独发）`);
    } else if (!PLANNED_STEP_ROOT_KEY_SET.has(k)) {
      errs.push(`step[${index}] 根键 '${k}' 非合法 planned-step（touch/wait_for/back/…）`);
    }
  }
  return errs;
}

export interface NavConfigValidation {
  ok: boolean;
  errors: string[];
  resolve: NavResolveResult;
}

/**
 * 校验 nav 配置与 ui-spec P0 屏集一致 + 步骤形状合法（Q2：缺配置/不一致 → 报错求补，不静默裸采）。
 *  - 每个 P0 target（含 overlay）须有匹配 nav 条目（顶层直达屏可空步）；缺 → error（missingTargets）。
 *  - nav 配置多余 key（不匹配任何 target）→ error（unmatchedKeys，防错写屏名如 __overlay__manage_non_local_root 漂移）。
 *  - 每条 step 形状合法。
 */
export function validateNavConfig(navConfig: NavConfig, p0TargetIds: string[]): NavConfigValidation {
  const errors: string[] = [];
  const resolve = resolveNavForTargets(navConfig, p0TargetIds);
  if (resolve.missingTargets.length > 0) {
    errors.push(`P0 屏缺 nav 配置（须补到达步骤，缺配置不得静默裸采）：${resolve.missingTargets.join(', ')}`);
  }
  if (resolve.unmatchedKeys.length > 0) {
    errors.push(`nav 配置多余/错写屏名（不匹配任何 P0 target，疑似 id 漂移）：${resolve.unmatchedKeys.join(', ')}`);
  }
  for (const [screenKey, steps] of Object.entries(navConfig ?? {})) {
    if (!Array.isArray(steps)) {
      errors.push(`nav['${screenKey}'] 须为步骤数组`);
      continue;
    }
    steps.forEach((s, i) => {
      for (const e of validateNavStep(s, i)) errors.push(`nav['${screenKey}'] ${e}`);
    });
  }
  return { ok: errors.length === 0, errors, resolve };
}
