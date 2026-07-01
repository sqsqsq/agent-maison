/**
 * round5 P1-A nav 配置单测：屏 id 归一化（X1）+ 步骤形状 + 一致性校验。
 * 承重用例＝真实 manage_non_local 三套 id（ui-spec `manage_non_local` / 采集 `__overlay__0` /
 * nav 配置 `__overlay__manage_non_local_root`）经归一化后须匹配（否则本已失败的 overlay 屏仍判未覆盖）。
 */
import {
  canonicalOverlayBase,
  isOverlayId,
  navKeyMatchesTarget,
  resolveNavForTargets,
  validateNavStep,
  validateNavConfig,
  type NavConfig,
} from '../../visual-diff-nav';
import { collectP0VisualTargetIds } from '../../visual-diff-targets';
import type { UiSpecDoc } from '../../../../../harness/scripts/utils/ui-spec-shared';
import type { UnitCaseResult } from '../../../../../harness/tests/run-unit';

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  const run = (name: string, fn: () => void) => {
    try {
      fn();
      results.push({ name, ok: true });
    } catch (e) {
      results.push({ name, ok: false, error: (e as Error).message });
    }
  };

  run('canonicalOverlayBase / isOverlayId', () => {
    if (canonicalOverlayBase('manage_non_local__overlay__0') !== 'manage_non_local') throw new Error('overlay 基名');
    if (canonicalOverlayBase('manage_non_local__overlay__manage_non_local_root') !== 'manage_non_local') throw new Error('overlay 基名 2');
    if (canonicalOverlayBase('home_no_card') !== 'home_no_card') throw new Error('非 overlay 原样');
    if (!isOverlayId('x__overlay__0') || isOverlayId('home')) throw new Error('isOverlayId');
  });

  run('P1-A/X1 navKeyMatchesTarget: 精确 / 同基 overlay / 不跨串', () => {
    if (!navKeyMatchesTarget('home_no_card', 'home_no_card')) throw new Error('精确');
    // X1 核心：nav_key 与采集 overlay id 后缀不同、同基 → 命中
    if (!navKeyMatchesTarget('manage_non_local__overlay__manage_non_local_root', 'manage_non_local__overlay__0')) {
      throw new Error('同基 overlay 应命中（X1）');
    }
    // base 屏与其 overlay 不互串
    if (navKeyMatchesTarget('manage_non_local', 'manage_non_local__overlay__0')) throw new Error('base 不应假覆盖 overlay');
    if (navKeyMatchesTarget('manage_non_local__overlay__0', 'manage_non_local')) throw new Error('overlay 不应假覆盖 base');
    // 不同基不匹配
    if (navKeyMatchesTarget('a__overlay__0', 'b__overlay__0')) throw new Error('不同基不应匹配');
  });

  run('P1-A resolveNavForTargets: overlay 归一化匹配 + missing + unmatched', () => {
    const cfg: NavConfig = {
      home_no_card: [],
      manage_non_local__overlay__manage_non_local_root: [{ touch: { by_id: 'x' } }],
      stray_screen: [],
    };
    const targets = ['home_no_card', 'manage_non_local__overlay__0', 'mine'];
    const r = resolveNavForTargets(cfg, targets);
    if (!r.resolved.has('home_no_card')) throw new Error('home 应解析');
    if (!r.resolved.has('manage_non_local__overlay__0')) throw new Error('overlay 应经归一化解析（X1）');
    if (!r.missingTargets.includes('mine')) throw new Error('mine 应 missing');
    if (!r.unmatchedKeys.includes('stray_screen')) throw new Error('stray 应 unmatched');
  });

  run('P1-A validateNavStep: 合法/forbidden screenshot/未知键/多键/非对象', () => {
    if (validateNavStep({ touch: { by_id: 'a' } }, 0).length !== 0) throw new Error('touch 合法');
    if (validateNavStep({ wait_for: { by_text: '钱包' } }, 0).length !== 0) throw new Error('wait_for 合法');
    if (validateNavStep({ back: {} }, 0).length !== 0) throw new Error('back 合法');
    if (validateNavStep({ screenshot: {} }, 0).length === 0) throw new Error('screenshot 应被禁');
    if (validateNavStep({ frobnicate: {} }, 0).length === 0) throw new Error('未知根键应报错');
    if (validateNavStep({ touch: {}, back: {} }, 0).length === 0) throw new Error('多根键应报错');
    if (validateNavStep(null as unknown as Record<string, unknown>, 0).length === 0) throw new Error('非对象应报错');
  });

  run('P1-A validateNavConfig: 一致→ok / 缺屏→error / 多余键→error / 坏步骤→error', () => {
    const targets = ['home_no_card', 'mine', 'manage_non_local__overlay__0'];
    // 一致（overlay 经归一化匹配）→ ok
    const good: NavConfig = {
      home_no_card: [],
      mine: [{ touch: { by_id: 'tab_mine' } }, { wait_for: { by_text: '金融信息' } }],
      manage_non_local__overlay__manage_non_local_root: [{ touch: { by_id: 'btn' } }, { wait_for: { by_text: '暂无非本机卡片', scope: 'top_overlay' } }],
    };
    const gv = validateNavConfig(good, targets);
    if (!gv.ok) throw new Error(`一致配置应 ok：${gv.errors.join('；')}`);
    // 缺 mine → error
    const miss: NavConfig = { home_no_card: [], manage_non_local__overlay__manage_non_local_root: [] };
    if (validateNavConfig(miss, targets).ok) throw new Error('缺 P0 屏应报错');
    // 多余键 → error
    const extra: NavConfig = { home_no_card: [], mine: [], manage_non_local__overlay__manage_non_local_root: [], ghost: [] };
    const ev = validateNavConfig(extra, targets);
    if (ev.ok || !ev.errors.some(e => e.includes('ghost'))) throw new Error('多余键应报错');
    // 坏步骤（screenshot）→ error
    const badStep: NavConfig = { home_no_card: [{ screenshot: {} }], mine: [], manage_non_local__overlay__manage_non_local_root: [] };
    if (validateNavConfig(badStep, targets).ok) throw new Error('screenshot 步骤应报错');
  });

  run('P1-A/review4 FP 根治：root=overlay_panel 的 P0 屏 base 不计入 target + overlay-only nav 校验通过', () => {
    // 复刻 homepage 真实形态：manage_non_local 是 P0 屏且 root 即 overlay_panel（会被 base+overlay 重复计入）
    const doc = {
      screens: [
        { id: 'home_no_card', priority: 'P0', ref_id: 'home_no_card', root: { type: 'navigation_frame', order: 0 } },
        { id: 'manage_non_local', priority: 'P0', ref_id: 'manage_non_local', root: { type: 'overlay_panel', order: 0 } },
      ],
      tokens: {},
      assets: [],
    } as unknown as UiSpecDoc;
    const targets = collectP0VisualTargetIds(doc);
    if (targets.includes('manage_non_local')) throw new Error(`root=overlay 的 base 屏不应计入 target：${JSON.stringify(targets)}`);
    if (!targets.includes('manage_non_local__overlay__0')) throw new Error('overlay id 应保留');
    // nav 配置只给 overlay 键（X1：后缀 __manage_non_local_root ≠ 采集 __overlay__0，同基须归一化命中）
    const nav: NavConfig = {
      home_no_card: [],
      manage_non_local__overlay__manage_non_local_root: [{ touch: { by_text: '管理非本机卡片' } }],
    };
    const v = validateNavConfig(nav, targets);
    if (!v.ok) throw new Error(`homepage 形态应校验通过（不得因 base overlay 屏误判缺配置）：${v.errors.join('；')}`);
  });

  return results;
}
