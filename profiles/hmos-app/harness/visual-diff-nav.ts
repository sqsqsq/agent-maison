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

/** nav 配置（legacy 1.x 内存形态）：key=屏标识，value=到达步骤。 */
export type NavConfig = Record<string, NavScreenSteps>;

// ---------------------------------------------------------------------------
// schema 2.0（visual-capability-truth S2 / P0-C）：screens + 每屏 identity 锚点。
// 20260718 事故：add_bank_collapsed 导航落在「添加卡片类型页」仍被截图计入 captured
// ——capture 层无页面身份断言。identity 在 dump→gate→screenshot 顺序中消费。
// ---------------------------------------------------------------------------

/** identity 成员：text（uitree 文本包含匹配）/ id（元素 id 精确）/ route（页面路由，dump 可证时匹配） */
export interface NavIdentityMember {
  text?: string;
  id?: string;
  route?: string;
}

export interface NavScreenIdentity {
  all_of?: NavIdentityMember[];
  any_of?: NavIdentityMember[];
  none_of?: NavIdentityMember[];
  /** 自动预填候选=true——未经确认不参与 gate 判定（宁缺不猜） */
  proposed?: boolean;
}

export interface NavScreenEntry {
  steps: NavScreenSteps;
  identity?: NavScreenIdentity;
}

export interface NavConfigV2 {
  schema_version: '2.0';
  screens: Record<string, NavScreenEntry>;
}

export const OVERLAY_SEP = '__overlay__';

/** 显式固化 nav 配置路径：<features_dir>/<feature>/device-testing/visual-diff-nav.json（Q2 唯一真源；P0-9 顺手项走 featureDir 尊重 paths.features_dir） */
export function visualDiffNavConfigPath(projectRoot: string, feature: string): string {
  return path.join(featureDir(projectRoot, feature), 'device-testing', 'visual-diff-nav.json');
}

/** 原始 JSON → 2.0 内存形态归一：识别 2.0（schema_version+screens）与 legacy 数组格式（steps-only）。 */
export function parseVisualDiffNavConfig(parsed: unknown): NavConfigV2 | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.schema_version === '2.0') {
    const screensRaw = obj.screens;
    if (!screensRaw || typeof screensRaw !== 'object' || Array.isArray(screensRaw)) return null;
    const screens: Record<string, NavScreenEntry> = {};
    for (const [k, v] of Object.entries(screensRaw as Record<string, unknown>)) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
      const entry = v as Record<string, unknown>;
      screens[k] = {
        steps: Array.isArray(entry.steps) ? (entry.steps as NavScreenSteps) : [],
        ...(entry.identity && typeof entry.identity === 'object' && !Array.isArray(entry.identity)
          ? { identity: entry.identity as NavScreenIdentity }
          : {}),
      };
    }
    return { schema_version: '2.0', screens };
  }
  // legacy：Record<screenId, NavStep[]> → steps-only 归一（无 identity）
  const screens: Record<string, NavScreenEntry> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!Array.isArray(v)) return null;
    screens[k] = { steps: v as NavScreenSteps };
  }
  return { schema_version: '2.0', screens };
}

/** 读固化 nav 配置（2.0 归一形态）；缺文件/非法 JSON → null。 */
export function loadVisualDiffNavConfigV2(projectRoot: string, feature: string): NavConfigV2 | null {
  const p = visualDiffNavConfigPath(projectRoot, feature);
  if (!fs.existsSync(p)) return null;
  try {
    return parseVisualDiffNavConfig(JSON.parse(fs.readFileSync(p, 'utf-8')) as unknown);
  } catch {
    return null;
  }
}

/** V2 → legacy steps 投影（既有 steps 消费面无感）。 */
export function toLegacyNavConfig(v2: NavConfigV2): NavConfig {
  const out: NavConfig = {};
  for (const [k, e] of Object.entries(v2.screens)) out[k] = e.steps;
  return out;
}

/** 读固化 nav 配置（legacy steps 投影——既有消费者入口，内部已兼容 2.0 文件）。 */
export function loadVisualDiffNavConfig(projectRoot: string, feature: string): NavConfig | null {
  const v2 = loadVisualDiffNavConfigV2(projectRoot, feature);
  return v2 ? toLegacyNavConfig(v2) : null;
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

// ---------------------------------------------------------------------------
// identity 判定与校验（S2 P0-C）
// ---------------------------------------------------------------------------

/** identity 成员形状与最低强度校验：≥2 个 text 成员，或 ≥1 个 id/route。
 * 单个通用文本不构成身份（20260718 错页正是「添加卡片」类通用文本重叠形态）。 */
export function validateScreenIdentity(identity: NavScreenIdentity, screenKey: string): string[] {
  const errs: string[] = [];
  const members: NavIdentityMember[] = [
    ...(identity.all_of ?? []),
    ...(identity.any_of ?? []),
  ];
  for (const [group, arr] of [['all_of', identity.all_of], ['any_of', identity.any_of], ['none_of', identity.none_of]] as const) {
    for (const m of arr ?? []) {
      const keys = Object.keys(m ?? {}).filter(k => ['text', 'id', 'route'].includes(k));
      if (!m || typeof m !== 'object' || keys.length !== 1 || !String((m as Record<string, unknown>)[keys[0]] ?? '').trim()) {
        errs.push(`nav['${screenKey}'].identity.${group} 成员须恰含 text|id|route 之一且非空`);
      }
    }
  }
  const textCount = members.filter(m => typeof m.text === 'string' && m.text.trim()).length;
  const strongCount = members.filter(
    m => (typeof m.id === 'string' && m.id.trim()) || (typeof m.route === 'string' && m.route.trim()),
  ).length;
  if (textCount < 2 && strongCount < 1) {
    errs.push(
      `nav['${screenKey}'].identity 强度不足：须 ≥2 个文本锚点或 ≥1 个 id/route 锚点（单个通用文本可被错误页面命中）`,
    );
  }
  return errs;
}

/** V2 校验：steps 语义沿用 legacy 校验 + identity 形状/最低强度 +（pixel_1to1）P0 屏须有已确认 identity。 */
export function validateNavConfigV2(
  v2: NavConfigV2,
  p0TargetIds: string[],
  opts?: { requireConfirmedIdentity?: boolean },
): NavConfigValidation {
  const base = validateNavConfig(toLegacyNavConfig(v2), p0TargetIds);
  const errors = [...base.errors];
  for (const [screenKey, entry] of Object.entries(v2.screens)) {
    if (entry.identity) errors.push(...validateScreenIdentity(entry.identity, screenKey));
  }
  if (opts?.requireConfirmedIdentity) {
    const identityByTarget = resolveIdentityForTargets(v2, p0TargetIds);
    const missing = p0TargetIds.filter(t => {
      const idn = identityByTarget.get(t);
      return !idn || idn.proposed === true;
    });
    if (missing.length > 0) {
      errors.push(
        `pixel_1to1 P0 屏缺**已确认** identity 锚点（proposed 候选未确认不作数；错页截图曾计入 captured）：${missing.join(', ')}`,
      );
    }
  }
  return { ok: errors.length === 0, errors, resolve: base.resolve };
}

/** 按 P0 target 解析每屏 identity（X1 归一化匹配同 resolveNavForTargets）。 */
export function resolveIdentityForTargets(
  v2: NavConfigV2,
  p0TargetIds: string[],
): Map<string, NavScreenIdentity> {
  const keys = Object.keys(v2.screens);
  const out = new Map<string, NavScreenIdentity>();
  for (const target of p0TargetIds) {
    let hitKey = keys.find(k => k === target);
    if (!hitKey) hitKey = keys.find(k => navKeyMatchesTarget(k, target));
    const idn = hitKey ? v2.screens[hitKey].identity : undefined;
    if (idn) out.set(target, idn);
  }
  return out;
}

/** layout dump 树 → identity 事实面（texts/ids/routes；容忍 {schema_version, tree} 包装）。 */
export function extractLayoutDumpFacets(dumpJson: unknown): {
  texts: string[];
  ids: string[];
  routes: string[];
} {
  const texts: string[] = [];
  const ids: string[] = [];
  const routes: string[] = [];
  const root =
    dumpJson && typeof dumpJson === 'object' && 'tree' in (dumpJson as Record<string, unknown>)
      ? (dumpJson as Record<string, unknown>).tree
      : dumpJson;
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return;
    const node = n as Record<string, unknown>;
    const attrs = (node.attributes ?? node) as Record<string, unknown>;
    for (const [k, v] of Object.entries(attrs)) {
      if (typeof v !== 'string' || !v.trim()) continue;
      if (k === 'text') texts.push(v.trim());
      else if (k === 'id' || k === 'key') ids.push(v.trim());
      else if (/page|route|pagePath|navDestination/i.test(k)) routes.push(v.trim());
    }
    const children = node.children;
    if (Array.isArray(children)) for (const c of children) walk(c);
  };
  walk(root);
  return { texts, ids, routes };
}

export interface IdentityEvaluation {
  ok: boolean;
  missingAllOf: string[];
  missedAnyOf: boolean;
  hitNoneOf: string[];
  detail: string;
}

function memberLabel(m: NavIdentityMember): string {
  if (typeof m.text === 'string') return `text:「${m.text}」`;
  if (typeof m.id === 'string') return `id:${m.id}`;
  return `route:${m.route}`;
}

function memberHit(m: NavIdentityMember, facets: { texts: string[]; ids: string[]; routes: string[] }): boolean {
  if (typeof m.text === 'string' && m.text.trim()) {
    const t = m.text.trim();
    return facets.texts.some(x => x.includes(t));
  }
  if (typeof m.id === 'string' && m.id.trim()) {
    return facets.ids.includes(m.id.trim());
  }
  if (typeof m.route === 'string' && m.route.trim()) {
    const r = m.route.trim();
    return facets.routes.some(x => x.includes(r));
  }
  return false;
}

/** 页面身份判定：all_of 全命中 + any_of（在场时）至少一 + none_of 全不命中。
 * proposed identity 不应传入本函数（调用方过滤——候选不参与判定）。 */
export function evaluateScreenIdentity(
  identity: NavScreenIdentity,
  facets: { texts: string[]; ids: string[]; routes: string[] },
): IdentityEvaluation {
  const missingAllOf = (identity.all_of ?? []).filter(m => !memberHit(m, facets)).map(memberLabel);
  const anyOf = identity.any_of ?? [];
  const missedAnyOf = anyOf.length > 0 && !anyOf.some(m => memberHit(m, facets));
  const hitNoneOf = (identity.none_of ?? []).filter(m => memberHit(m, facets)).map(memberLabel);
  const ok = missingAllOf.length === 0 && !missedAnyOf && hitNoneOf.length === 0;
  return {
    ok,
    missingAllOf,
    missedAnyOf,
    hitNoneOf,
    detail: ok
      ? 'identity 全部锚点命中'
      : [
          ...(missingAllOf.length > 0 ? [`缺必备锚点：${missingAllOf.join('、')}`] : []),
          ...(missedAnyOf ? ['any_of 组无一命中'] : []),
          ...(hitNoneOf.length > 0 ? [`命中禁入锚点（错误页面特征）：${hitNoneOf.join('、')}`] : []),
        ].join('；'),
  };
}
