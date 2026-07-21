/**
 * round5 P1-A nav 配置单测：屏 id 归一化（X1）+ 步骤形状 + 一致性校验。
 * 承重用例＝真实 manage_non_local 三套 id（ui-spec `manage_non_local` / 采集 `__overlay__0` /
 * nav 配置 `__overlay__manage_non_local_root`）经归一化后须匹配（否则本已失败的 overlay 屏仍判未覆盖）。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  canonicalOverlayBase,
  evaluateScreenIdentity,
  extractLayoutDumpFacets,
  isOverlayId,
  navKeyMatchesTarget,
  parseVisualDiffNavConfig,
  resolveIdentityForTargets,
  resolveNavForTargets,
  toLegacyNavConfig,
  validateNavStep,
  validateNavConfig,
  validateNavConfigV2,
  validateScreenIdentity,
  type NavConfig,
  type NavConfigV2,
} from '../../visual-diff-nav';
import { captureVisualDiff } from '../../visual-diff-capture';
import { clearFrameworkConfigCache } from '../../../../../harness/config';
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

  // ---------------- S2 P0-C：nav schema 2.0 + identity ----------------

  run('S2: parseVisualDiffNavConfig——legacy 数组归一 2.0；2.0 原样；非法 null', () => {
    const legacy = parseVisualDiffNavConfig({ home: [{ touch: { by_text: '卡包' } }] });
    if (!legacy || legacy.schema_version !== '2.0') throw new Error('legacy 须归一 2.0');
    if (legacy.screens.home.steps.length !== 1 || legacy.screens.home.identity) throw new Error('legacy=steps-only');
    const v2 = parseVisualDiffNavConfig({
      schema_version: '2.0',
      screens: { home: { steps: [], identity: { all_of: [{ text: '添加银行卡' }, { text: '招商银行' }] } } },
    });
    if (!v2?.screens.home.identity?.all_of?.length) throw new Error('2.0 identity 保留');
    if (parseVisualDiffNavConfig([1, 2]) !== null) throw new Error('数组根须 null');
    if (parseVisualDiffNavConfig({ home: 'x' }) !== null) throw new Error('非数组值须 null');
    // 往返：toLegacyNavConfig 投影 steps
    const leg = toLegacyNavConfig(v2!);
    if (!Array.isArray(leg.home) || leg.home.length !== 0) throw new Error('legacy 投影');
  });

  run('S2: validateScreenIdentity——单个通用文本强度不足；2 文本/1 id 通过；成员形状错报错', () => {
    if (validateScreenIdentity({ all_of: [{ text: '添加卡片' }] }, 's').length === 0) {
      throw new Error('单文本须判强度不足（错页正是通用文本重叠）');
    }
    if (validateScreenIdentity({ all_of: [{ text: '添加银行卡' }, { text: '招商银行' }] }, 's').length !== 0) {
      throw new Error('2 文本应通过');
    }
    if (validateScreenIdentity({ all_of: [{ id: 'maison:demo:s:nav:main' }] }, 's').length !== 0) {
      throw new Error('1 强 id 应通过');
    }
    const errs = validateScreenIdentity({ all_of: [{ text: '好', id: 'x' } as never] }, 's');
    if (!errs.some(e => e.includes('恰含'))) throw new Error(`双键成员须报形状错：${JSON.stringify(errs)}`);
  });

  run('S2: validateNavConfigV2 requireConfirmedIdentity——proposed 候选不作数；confirmed 通过', () => {
    const mk = (proposed: boolean): NavConfigV2 => ({
      schema_version: '2.0',
      screens: {
        home: { steps: [], identity: { all_of: [{ text: '添加银行卡' }, { text: '中国银行' }], proposed } },
      },
    });
    const bad = validateNavConfigV2(mk(true), ['home'], { requireConfirmedIdentity: true });
    if (bad.ok || !bad.errors.some(e => e.includes('已确认'))) throw new Error(`proposed 须判缺：${bad.errors.join('；')}`);
    const good = validateNavConfigV2(mk(false), ['home'], { requireConfirmedIdentity: true });
    if (!good.ok) throw new Error(`confirmed 应通过：${good.errors.join('；')}`);
    // 非 pixel 档不强制
    const lax = validateNavConfigV2(mk(true), ['home']);
    if (!lax.ok) throw new Error(`不带 require 时 proposed 不阻断：${lax.errors.join('；')}`);
  });

  run('S2: extractLayoutDumpFacets——{schema_version,tree} 包装 + attributes 文本/=id 收集', () => {
    const dump = {
      schema_version: 'hylyre-hypium-ui-dump-v1',
      tree: {
        attributes: { text: '添加卡片', id: 'root' },
        children: [
          { attributes: { text: '管理非本机卡片' } },
          { attributes: { key: 'maison:x' }, children: [{ attributes: { text: '银行卡' } }] },
        ],
      },
    };
    const f = extractLayoutDumpFacets(dump);
    if (!f.texts.includes('添加卡片') || !f.texts.includes('管理非本机卡片') || !f.texts.includes('银行卡')) {
      throw new Error(`texts 收集不全：${JSON.stringify(f.texts)}`);
    }
    if (!f.ids.includes('root') || !f.ids.includes('maison:x')) throw new Error(`ids 收集不全：${JSON.stringify(f.ids)}`);
  });

  run('S2: evaluateScreenIdentity——20260718 错页形态（none_of 命中 + all_of 缺失）判 mismatch；正确页 ok', () => {
    const identity = {
      all_of: [{ text: '添加银行卡' }, { text: '招商银行' }],
      none_of: [{ text: '管理非本机卡片' }],
    };
    // 错页（添加卡片类型页）的 facets——事故 layout dump 实测文本集
    const wrongPage = { texts: ['添加卡片', '非本机卡片', '银行卡', '交通卡', '门禁卡', '管理非本机卡片'], ids: [], routes: [] };
    const bad = evaluateScreenIdentity(identity, wrongPage);
    if (bad.ok) throw new Error('错页必须 mismatch');
    if (bad.missingAllOf.length !== 2 || bad.hitNoneOf.length !== 1) {
      throw new Error(`判定明细：missing=${JSON.stringify(bad.missingAllOf)} none=${JSON.stringify(bad.hitNoneOf)}`);
    }
    // 正确页（银行列表页）：文本可为拼接形态（子串包含语义）
    const rightPage = { texts: ['添加银行卡页', '招商银行 储蓄卡', '更多'], ids: [], routes: [] };
    const good = evaluateScreenIdentity(identity, rightPage);
    if (!good.ok) throw new Error(`正确页应通过：${good.detail}`);
  });

  run('S2 集成: capture identity gate——错页 mismatch 正式目录零写入、证据图落 _mismatch/', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nav2-gate-'));
    try {
      const doc = {
        screens: [{ id: 'add_bank_collapsed', priority: 'P0', ref_id: 'ref_x', root: { type: 'navigation_frame', order: 0 } }],
        tokens: {},
        assets: [],
      } as unknown as import('../../../../../harness/scripts/utils/ui-spec-shared').UiSpecDoc;
      const wrongDump = {
        schema_version: 'hylyre-hypium-ui-dump-v1',
        tree: { attributes: { text: '添加卡片' }, children: [{ attributes: { text: '管理非本机卡片' } }] },
      };
      const identity = new Map([[
        'add_bank_collapsed',
        { all_of: [{ text: '添加银行卡' }, { text: '招商银行' }], none_of: [{ text: '管理非本机卡片' }] },
      ]]);
      let canonicalShots = 0;
      const r = captureVisualDiff({
        projectRoot: root,
        feature: 'demo',
        uiDoc: doc,
        currentBuildFingerprint: null,
        screenshotFn: args => {
          if (!args.destAbs.includes('_mismatch')) canonicalShots++;
          fs.mkdirSync(path.dirname(args.destAbs), { recursive: true });
          fs.writeFileSync(args.destAbs, Buffer.from('png'));
          return { ok: true };
        },
        layoutDumpFn: args => {
          fs.mkdirSync(path.dirname(args.destAbs), { recursive: true });
          fs.writeFileSync(args.destAbs, JSON.stringify(wrongDump), 'utf-8');
          return { ok: true };
        },
        screenIdentity: identity,
      });
      if (canonicalShots !== 0) throw new Error('mismatch 屏不得写正式截图');
      if (!(r.p0CaptureFailures ?? []).includes('add_bank_collapsed')) throw new Error('须记 P0 采集失败');
      if (!r.errors.some(e => e.includes('screen_identity_mismatch'))) throw new Error(`须报 mismatch：${r.errors.join('|')}`);
      const shotsDir = path.join(root, 'doc', 'features', 'demo', 'device-testing', 'device-screenshots');
      if (fs.existsSync(path.join(shotsDir, 'shot-add_bank_collapsed.png'))) throw new Error('正式目录零写入');
      if (!fs.existsSync(path.join(shotsDir, '_mismatch', 'shot-add_bank_collapsed.png'))) throw new Error('证据图须归档 _mismatch/');
      // proposed 候选不参与判定：同 identity 但 proposed → 正常采集
      const r2 = captureVisualDiff({
        projectRoot: root,
        feature: 'demo',
        uiDoc: doc,
        currentBuildFingerprint: null,
        screenshotFn: args => { fs.mkdirSync(path.dirname(args.destAbs), { recursive: true }); fs.writeFileSync(args.destAbs, Buffer.from('png2')); return { ok: true }; },
        layoutDumpFn: args => { fs.mkdirSync(path.dirname(args.destAbs), { recursive: true }); fs.writeFileSync(args.destAbs, JSON.stringify(wrongDump), 'utf-8'); return { ok: true }; },
        screenIdentity: new Map([[ 'add_bank_collapsed', { ...identity.get('add_bank_collapsed')!, proposed: true } ]]),
      });
      if ((r2.p0CaptureFailures ?? []).length !== 0) throw new Error('proposed 候选不得参与 gate 判定');
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('S2: generateIdentityCandidates——df=0 独特文本判据 + 长度排序 + proposed 语义', () => {
    // 延迟 require（migrate CLI 模块）避免顶部 import 循环
    const { generateIdentityCandidates } = require('../../visual-diff-nav-migrate') as typeof import('../../visual-diff-nav-migrate');
    const doc = {
      screens: [
        {
          id: 'add_bank', priority: 'P0', ref_id: 'r1',
          root: { type: 'navigation_frame', order: 0, children: [
            { type: 'content_display', order: 1, text: '添加银行卡' },
            { type: 'content_display', order: 2, text: '银行卡' },      // 与 all_banks 重叠 → df>0 淘汰
            { type: 'content_display', order: 3, text: '热门银行' },
          ] },
        },
        {
          id: 'all_banks', priority: 'P0', ref_id: 'r2',
          root: { type: 'navigation_frame', order: 0, children: [
            { type: 'content_display', order: 1, text: '全部银行' },
            { type: 'content_display', order: 2, text: '银行卡' },
          ] },
        },
      ],
      tokens: {}, assets: [],
    } as unknown as UiSpecDoc;
    const cands = generateIdentityCandidates(doc, 'add_bank', ['add_bank', 'all_banks']);
    const texts = cands.map(c => c.text);
    if (texts.includes('银行卡')) throw new Error('跨屏重叠文本（df>0）不得入候选');
    if (!texts.includes('添加银行卡')) throw new Error(`独特文本须入候选：${JSON.stringify(texts)}`);
    if (texts.length !== 2) throw new Error('取前 2 条');
  });

  run('对抗（codex 实施 review P1-3）：identity 变更/旧图未验身份 → 同 build 不得跳采', () => {
    const { skipAllowedByIdentity, identityFingerprintOf } = require('../../visual-diff-capture') as typeof import('../../visual-diff-capture');
    const identity = { all_of: [{ text: '添加银行卡' }, { text: '招商银行' }] };
    const fp = identityFingerprintOf(identity);
    // 旧图从未验身份（无 identity_fingerprint）→ 不得跳采
    if (skipAllowedByIdentity({ screen_id: 's', verdict: 'pass' } as never, identity)) {
      throw new Error('未验身份的旧图不得跳采（可能本来就是错页）');
    }
    // 旧图验过同一身份 → 可跳采
    if (!skipAllowedByIdentity({ screen_id: 's', verdict: 'pass', identity_fingerprint: fp } as never, identity)) {
      throw new Error('同身份指纹应允许跳采');
    }
    // identity 变更（锚点改了）→ 不得跳采
    const changed = { all_of: [{ text: '添加银行卡' }, { text: '工商银行' }] };
    if (skipAllowedByIdentity({ screen_id: 's', verdict: 'pass', identity_fingerprint: fp } as never, changed)) {
      throw new Error('identity 变更后旧图不得跳采');
    }
    // 无 identity/proposed 候选 → 原跳采行为不变
    if (!skipAllowedByIdentity({ screen_id: 's', verdict: 'pass' } as never, undefined)) {
      throw new Error('无 identity 屏保持原行为');
    }
    if (!skipAllowedByIdentity({ screen_id: 's', verdict: 'pass' } as never, { ...identity, proposed: true })) {
      throw new Error('proposed 候选不参与 skip 判定');
    }
  });

  run('S2: resolveIdentityForTargets——X1 归一化命中 overlay 后缀差异', () => {
    const v2: NavConfigV2 = {
      schema_version: '2.0',
      screens: {
        manage_non_local__overlay__manage_non_local_root: {
          steps: [],
          identity: { all_of: [{ text: '管理非本机卡片' }, { text: '恢复' }] },
        },
      },
    };
    const m = resolveIdentityForTargets(v2, ['manage_non_local__overlay__0']);
    if (!m.get('manage_non_local__overlay__0')) throw new Error('同基 overlay 须归一命中');
  });

  return results;
}
