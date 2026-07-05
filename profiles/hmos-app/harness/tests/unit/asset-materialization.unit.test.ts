/**
 * 资产物化真图门禁单测（B + F 核心）：
 *   - readImageDimensions：纯 TS 解析 PNG/JPEG 头（不依赖 jimp），1×1/过小占位可判。
 *   - findModuleMediaFile / moduleMediaRealnessForKey：以【模块实际 resources/base/media】为准，
 *     工程根 media/ 占位不被采信（堵 resource_integrity 根路径绕过 = 本轮回归根因之一）。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readImageDimensions } from '../../image-toolkit';
import { findModuleMediaFile, moduleMediaRealnessForKey, collectPlaceholderAssetIssues, collectBakedTextAssetIssues, declaredTextTargetsForAsset, collectIconSubstitutionIssues, featureUsesSystemSymbolIcon } from '../../visual-parity-backstop';
import { isOcrAvailable } from '../../ocr-toolkit';
import type { CheckContext } from '../../../../../harness/scripts/utils/types';
import type { UiSpecDoc } from '../../../../../harness/scripts/utils/ui-spec-shared';
import type { UnitCaseResult } from '../../../../../harness/tests/run-unit';

function writeEtsRef(root: string, pkg: string, key: string): void {
  const p = path.join(root, pkg, 'src', 'main', 'ets', 'C.ets');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `@Component struct C { build() { Image($r('app.media.${key}')) } }`);
}

function placeholderCtx(root: string): CheckContext {
  return { projectRoot: root, feature: 'homepage', featureSpec: { contracts: contractsAB } } as unknown as CheckContext;
}

function cropDoc(key: string): UiSpecDoc {
  return { assets: [{ key, acquisition: 'crop', resolved_path: `doc/x/spec/assets/${key}.png` }] } as unknown as UiSpecDoc;
}

type Contracts = NonNullable<CheckContext['featureSpec']['contracts']>;
const MODULE_PKG = '02-Feature/WalletMain';
const contractsM = { modules: [{ name: 'WalletMain', package_path: MODULE_PKG }], files: [] } as unknown as Contracts;
const COMMON_PKG = '00-Common/Shared';
const contractsAB = {
  modules: [
    { name: 'WalletMain', package_path: MODULE_PKG },
    { name: 'Shared', package_path: COMMON_PKG },
  ],
  files: [],
} as unknown as Contracts;

/** 写一个最小 PNG：8B 签名 + IHDR(含 W/H 大端) + 填充字节（readImageDimensions 只读头部） */
function writePng(p: string, w: number, h: number, extraBytes = 0): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrLen = Buffer.from([0, 0, 0, 13]);
  const ihdrType = Buffer.from('IHDR');
  const wh = Buffer.alloc(8);
  wh.writeUInt32BE(w, 0);
  wh.writeUInt32BE(h, 4);
  const rest = Buffer.from([8, 6, 0, 0, 0]);
  fs.writeFileSync(p, Buffer.concat([sig, ihdrLen, ihdrType, wh, rest, Buffer.alloc(extraBytes)]));
}

function mediaPathIn(root: string, pkg: string, key: string, ext = 'png'): string {
  return path.join(root, pkg, 'src', 'main', 'resources', 'base', 'media', `${key}.${ext}`);
}

function moduleMedia(root: string, key: string, ext = 'png'): string {
  return mediaPathIn(root, MODULE_PKG, key, ext);
}

function mkRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'asset-mat-'));
}

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

  run('readImageDimensions: PNG 头解析 W/H + 字节', () => {
    const root = mkRoot();
    try {
      const p = path.join(root, 'big.png');
      writePng(p, 948, 324, 400);
      const d = readImageDimensions(p);
      if (!d || d.w !== 948 || d.h !== 324 || d.format !== 'png') throw new Error(JSON.stringify(d));
      if (d.bytes < 256) throw new Error(`bytes 应>256：${d.bytes}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('readImageDimensions: 1×1 占位可识别（尺寸+字节均退化）', () => {
    const root = mkRoot();
    try {
      const p = path.join(root, 'ph.png');
      writePng(p, 1, 1, 0);
      const d = readImageDimensions(p);
      if (!d || d.w !== 1 || d.h !== 1) throw new Error(JSON.stringify(d));
      if (d.bytes >= 256) throw new Error(`1×1 占位字节应<256：${d.bytes}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('readImageDimensions: 缺文件 → null', () => {
    if (readImageDimensions(path.join(os.tmpdir(), 'no-such-asset-xyz.png')) !== null) {
      throw new Error('缺文件应返回 null');
    }
  });

  run('findModuleMediaFile: 模块内命中 / 仅工程根不命中', () => {
    const root = mkRoot();
    try {
      // 仅工程根放占位 → 不命中（堵根路径绕过）
      writePng(path.join(root, 'media', 'logo.png'), 1, 1, 0);
      if (findModuleMediaFile(root, contractsM, 'logo') !== null) {
        throw new Error('工程根 media/ 不应被 findModuleMediaFile 采信');
      }
      // 模块内真实文件 → 命中
      writePng(moduleMedia(root, 'logo'), 948, 324, 400);
      const f = findModuleMediaFile(root, contractsM, 'logo');
      if (!f || !f.includes(path.join('resources', 'base', 'media'))) throw new Error(`应命中模块 media：${f}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('moduleMediaRealnessForKey: 真图 → real', () => {
    const root = mkRoot();
    try {
      writePng(moduleMedia(root, 'card_guide'), 948, 324, 400);
      const r = moduleMediaRealnessForKey(root, contractsM, 'card_guide');
      if (!r.real) throw new Error(`真图应判 real：${JSON.stringify(r)}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('moduleMediaRealnessForKey: 1×1 占位 → not real（尺寸/字节）', () => {
    const root = mkRoot();
    try {
      writePng(moduleMedia(root, 'card_guide'), 1, 1, 0);
      const r = moduleMediaRealnessForKey(root, contractsM, 'card_guide');
      if (r.real) throw new Error('1×1 占位不应判 real');
      if (!/退化占位|尺寸|B\)/.test(r.reason ?? '')) throw new Error(`reason 应含退化信息：${r.reason}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('moduleMediaRealnessForKey: 仅工程根占位（模块缺文件）→ not real', () => {
    const root = mkRoot();
    try {
      writePng(path.join(root, 'media', 'card_guide.png'), 1, 1, 0); // 只有根，模块无
      const r = moduleMediaRealnessForKey(root, contractsM, 'card_guide');
      if (r.real) throw new Error('仅工程根占位不应判 real（F 防绕过）');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('moduleMediaRealnessForKey: 面积比<5%（相对 resolved_path 真裁图）→ not real', () => {
    const root = mkRoot();
    try {
      // 模块图字节够大(>256)、尺寸>2，但相对真裁图面积过小 → 命中面积比信号
      writePng(moduleMedia(root, 'card_guide'), 10, 10, 400);
      const resolved = 'doc/features/homepage/spec/assets/card_guide.png';
      writePng(path.join(root, resolved), 948, 324, 800);
      const r = moduleMediaRealnessForKey(root, contractsM, 'card_guide', resolved);
      if (r.real) throw new Error('面积比<5% 应判 not real');
      if (!/面积/.test(r.reason ?? '')) throw new Error(`reason 应含面积信号：${r.reason}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('moduleMediaRealnessForKey: svg 矢量资产（无 resolved_path）→ real', () => {
    const root = mkRoot();
    try {
      const p = moduleMedia(root, 'icon', 'svg');
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, '<svg/>');
      const r = moduleMediaRealnessForKey(root, contractsM, 'icon');
      if (!r.real) throw new Error('svg 矢量资产应判 real');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('moduleMediaRealnessForKey: resolved_path 为 raster 真裁图却仅 svg → not real（review#2）', () => {
    const root = mkRoot();
    try {
      const p = moduleMedia(root, 'card_guide', 'svg');
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, '<svg/>');
      const resolved = 'doc/features/homepage/spec/assets/card_guide.png';
      writePng(path.join(root, resolved), 948, 324, 800);
      const r = moduleMediaRealnessForKey(root, contractsM, 'card_guide', resolved);
      if (r.real) throw new Error('raster 裁图却只放 svg 不应判 real');
      if (!/svg/.test(r.reason ?? '')) throw new Error(`reason 应点名 svg：${r.reason}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('findModuleMediaFile: restrict 到引用模块（跨模块同名不串）', () => {
    const root = mkRoot();
    try {
      // 真图只在 Shared 模块；WalletMain 无
      writePng(mediaPathIn(root, COMMON_PKG, 'logo'), 948, 324, 400);
      if (findModuleMediaFile(root, contractsAB, 'logo', new Set([MODULE_PKG])) !== null) {
        throw new Error('restrict 到 WalletMain 不应命中 Shared 的同名 media');
      }
      const f = findModuleMediaFile(root, contractsAB, 'logo', new Set([COMMON_PKG]));
      if (!f || !f.includes(path.join(COMMON_PKG.replace('/', path.sep), 'src'))) throw new Error(`restrict 到 Shared 应命中：${f}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('moduleMediaRealnessForKey: 跨模块同名（引用模块为占位、他模块为真图）→ not real（review#1）', () => {
    const root = mkRoot();
    try {
      // WalletMain（引用方）放 1×1 占位；Shared 放真图。restrict 到 WalletMain 应判 not real。
      writePng(mediaPathIn(root, MODULE_PKG, 'logo'), 1, 1, 0);
      writePng(mediaPathIn(root, COMMON_PKG, 'logo'), 948, 324, 400);
      const r = moduleMediaRealnessForKey(root, contractsAB, 'logo', undefined, new Set([MODULE_PKG]));
      if (r.real) throw new Error('引用模块为占位时，他模块真图不应救场');
      // 若引用方本身就是 Shared，则应 real
      const r2 = moduleMediaRealnessForKey(root, contractsAB, 'logo', undefined, new Set([COMMON_PKG]));
      if (!r2.real) throw new Error('引用模块 Shared 有真图应判 real');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('moduleMediaRealnessForKey: 引用模块缺图（他模块有真图）restrict 到缺图模块 → not real（review P1）', () => {
    const root = mkRoot();
    try {
      writePng(mediaPathIn(root, COMMON_PKG, 'logo'), 948, 324, 400); // 仅 Shared 有真图
      const r = moduleMediaRealnessForKey(root, contractsAB, 'logo', undefined, new Set([MODULE_PKG]));
      if (r.real) throw new Error('引用模块缺图不应判 real（即便他模块有真图）');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('collectPlaceholderAssetIssues: 多引用模块逐一校验（一个占位即 fail，他模块真图不救场）', () => {
    const root = mkRoot();
    try {
      writeEtsRef(root, MODULE_PKG, 'logo'); // WalletMain 引用
      writeEtsRef(root, COMMON_PKG, 'logo'); // Shared 也引用
      writePng(moduleMedia(root, 'logo'), 1, 1, 0); // WalletMain 占位
      writePng(mediaPathIn(root, COMMON_PKG, 'logo'), 948, 324, 400); // Shared 真图
      const issues = collectPlaceholderAssetIssues(placeholderCtx(root), cropDoc('logo'), false);
      const hit = issues.find(i => i.id === 'logo');
      if (!hit) throw new Error('WalletMain 占位应被逐模块校验抓出');
      if (!hit.detail.includes(MODULE_PKG)) throw new Error(`issue 应点名失败模块 WalletMain：${hit.detail}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('collectPlaceholderAssetIssues: 每个引用模块都有真图 → 无 issue', () => {
    const root = mkRoot();
    try {
      writeEtsRef(root, MODULE_PKG, 'logo');
      writeEtsRef(root, COMMON_PKG, 'logo');
      writePng(moduleMedia(root, 'logo'), 948, 324, 400);
      writePng(mediaPathIn(root, COMMON_PKG, 'logo'), 948, 324, 400);
      const issues = collectPlaceholderAssetIssues(placeholderCtx(root), cropDoc('logo'), false);
      if (issues.some(i => i.id === 'logo')) throw new Error('两模块都真图不应报 issue');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // -------- round5 P0-A：素材烤字门禁 --------

  const OCR_FIXTURE = path.join(__dirname, '..', 'fixtures', 'ocr', 'card_pack.png');

  function slabDoc(
    key: string,
    texts: string[],
    opts?: { deferBy?: string },
  ): UiSpecDoc {
    const children: unknown[] = texts.map((t, i) => ({ id: `t${i}`, type: 'content_display', order: i, text: t }));
    children.push({ id: 'hero', type: 'image', order: 99, asset_ref: key });
    const asset: Record<string, unknown> = { key, acquisition: 'crop' };
    if (opts?.deferBy) { asset.baked_text_defer = true; asset.baked_text_defer_by = opts.deferBy; }
    return {
      screens: [{ id: 'card_pack', priority: 'P0', ref_id: 'card_pack', root: { type: 'navigation_frame', order: 0, children } }],
      tokens: {},
      assets: [asset],
    } as unknown as UiSpecDoc;
  }

  function copyFixtureAsMedia(root: string, key: string): void {
    const dest = moduleMedia(root, key);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(OCR_FIXTURE, dest);
  }

  run('P0-A declaredTextTargetsForAsset: 所属屏优先 / 回退全集 / ≥2字去重', () => {
    const perScreen = [
      { screenId: 'A', texts: ['卡包', '添加管理卡片', 'x', '卡包'], assetRefs: new Set(['hero_a']) },
      { screenId: 'B', texts: ['我的', '设置'], assetRefs: new Set(['hero_b']) },
    ];
    const owning = declaredTextTargetsForAsset(perScreen, 'hero_a');
    if (!owning.includes('卡包') || !owning.includes('添加管理卡片')) throw new Error(`所属屏文本缺失：${JSON.stringify(owning)}`);
    if (owning.includes('我的')) throw new Error('所属屏 A 不应含 B 的文本');
    if (owning.includes('x')) throw new Error('1 字文本应被 ≥2 过滤');
    if (owning.filter(t => t === '卡包').length !== 1) throw new Error('应去重');
    const fallback = declaredTextTargetsForAsset(perScreen, 'unknown_key');
    if (!fallback.includes('卡包') || !fallback.includes('我的')) throw new Error(`未接线 key 应回退全集：${JSON.stringify(fallback)}`);
  });

  run('P0-A collectBakedTextAssetIssues: 真实设备图(含"管理非本机卡片/银行卡")→ baked_text', () => {
    if (!isOcrAvailable()) return; // OCR 不可用则跳过（graceful，仿 ocr-toolkit 测试）
    const root = mkRoot();
    try {
      copyFixtureAsMedia(root, 'test_slab');
      const doc = slabDoc('test_slab', ['管理非本机卡片', '银行卡']);
      const res = collectBakedTextAssetIssues(placeholderCtx(root), doc, false);
      if (res.ocrUnavailable) throw new Error('OCR 可用时不应报 ocrUnavailable');
      const hit = res.issues.find(i => i.id === 'test_slab' && i.assetRole === 'baked_text');
      if (!hit) throw new Error(`应判 baked_text（图内含 2 个声明文本）：${JSON.stringify(res.issues)}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('P0-A collectBakedTextAssetIssues: 声明文本不在图中 → 无 issue（原子插画正样本代理）', () => {
    if (!isOcrAvailable()) return;
    const root = mkRoot();
    try {
      copyFixtureAsMedia(root, 'atomic_ok');
      const doc = slabDoc('atomic_ok', ['天气预报晴朗', '股票行情大涨']); // 均不在设备图中
      const res = collectBakedTextAssetIssues(placeholderCtx(root), doc, false);
      if (res.issues.some(i => i.id === 'atomic_ok')) throw new Error('声明文本不在图中不应判 baked_text');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('P0-A collectBakedTextAssetIssues: baked_text_defer + 真人署名 → 放行', () => {
    if (!isOcrAvailable()) return;
    const root = mkRoot();
    try {
      copyFixtureAsMedia(root, 'promo_defer');
      const doc = slabDoc('promo_defer', ['管理非本机卡片', '银行卡'], { deferBy: 'alice' });
      const res = collectBakedTextAssetIssues(placeholderCtx(root), doc, false);
      if (res.issues.some(i => i.id === 'promo_defer')) throw new Error('human_signed defer 应放行');
      // 自动化署名不算人签 → 仍拦
      const doc2 = slabDoc('promo_defer', ['管理非本机卡片', '银行卡'], { deferBy: 'goal-mode-auto' });
      const res2 = collectBakedTextAssetIssues(placeholderCtx(root), doc2, false);
      if (!res2.issues.some(i => i.id === 'promo_defer')) throw new Error('自动化署名不应放行');
      // P0-6（c9e2a7f4）：user_requirement 属授权哨兵，不算对具体资产的真人署名 → 仍拦
      //（2026-07-05 伪签事故后语义收紧；此前本用例曾以它当正样本，属旧语义）
      const doc3 = slabDoc('promo_defer', ['管理非本机卡片', '银行卡'], { deferBy: 'user_requirement' });
      const res3 = collectBakedTextAssetIssues(placeholderCtx(root), doc3, false);
      if (!res3.issues.some(i => i.id === 'promo_defer')) throw new Error('user_requirement 伪签不应放行（授权≠过目）');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // -------- round5 P0-B：品牌图标被 sys.symbol 替代门禁 --------

  function iconDoc(key: string, kind: string, placeholder = false): UiSpecDoc {
    return {
      screens: [{
        id: 'add_card', priority: 'P0', ref_id: 'add_card',
        root: { type: 'navigation_frame', order: 0, children: [
          { id: 'add_card_transit', type: 'list_selection', order: 0, text: '交通卡', icon: { kind, ref: key } },
        ] },
      }],
      tokens: {},
      assets: [placeholder ? { key, acquisition: 'crop', placeholder: true } : { key, acquisition: 'crop' }],
    } as unknown as UiSpecDoc;
  }
  function writeSysSymbolData(root: string): void {
    const p = path.join(root, MODULE_PKG, 'src', 'main', 'ets', 'data', 'CardRepository.ets');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `export class R { list() { return [{ name: '交通卡', icon: $r('sys.symbol.map') }]; } }`);
  }
  function writeBrandedRender(root: string, key: string): void {
    const p = path.join(root, MODULE_PKG, 'src', 'main', 'ets', 'presentation', 'components', 'Transit.ets');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `@Component struct Transit { build() { Image($r('app.media.${key}')) } }`);
  }

  run('P0-B featureUsesSystemSymbolIcon: 检出 $r(sys.symbol.*) / SymbolGlyph', () => {
    const root = mkRoot();
    try {
      if (featureUsesSystemSymbolIcon(root, contractsAB)) throw new Error('空源码不应检出 sys.symbol');
      writeSysSymbolData(root);
      if (!featureUsesSystemSymbolIcon(root, contractsAB)) throw new Error('应检出 data 层 sys.symbol.map');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('P0-B collectIconSubstitutionIssues: 声明品牌图标却用 sys.symbol 替代 → icon_substitution', () => {
    const root = mkRoot();
    try {
      writeSysSymbolData(root); // 源码用 sys.symbol.map，且未 $r 品牌 media
      const issues = collectIconSubstitutionIssues(placeholderCtx(root), iconDoc('card_icon_transit', 'brand_logo'), false);
      const hit = issues.find(i => i.assetRole === 'icon_substitution' && i.id === 'add_card_transit');
      if (!hit) throw new Error(`品牌图标被 sys.symbol 替代应判 icon_substitution：${JSON.stringify(issues)}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('P0-B collectIconSubstitutionIssues: 品牌 media 已 $r 渲染 → 放行', () => {
    const root = mkRoot();
    try {
      writeSysSymbolData(root);
      writeBrandedRender(root, 'card_icon_transit'); // 真图已渲染
      const issues = collectIconSubstitutionIssues(placeholderCtx(root), iconDoc('card_icon_transit', 'brand_logo'), false);
      if (issues.some(i => i.id === 'add_card_transit')) throw new Error('品牌 media 已渲染不应报替代');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('P0-B collectIconSubstitutionIssues: icon.kind=system_symbol / placeholder / 无 sys.symbol → 放行', () => {
    const root = mkRoot();
    try {
      writeSysSymbolData(root);
      if (collectIconSubstitutionIssues(placeholderCtx(root), iconDoc('k', 'system_symbol'), false).length > 0) {
        throw new Error('声明 system_symbol 用系统图标合法，不应拦');
      }
      if (collectIconSubstitutionIssues(placeholderCtx(root), iconDoc('k', 'brand_logo', true), false).length > 0) {
        throw new Error('显式 placeholder 应豁免');
      }
      const root2 = mkRoot();
      try {
        // 无 sys.symbol 源码 → 无"替代"可言
        if (collectIconSubstitutionIssues(placeholderCtx(root2), iconDoc('k', 'brand_logo'), false).length > 0) {
          throw new Error('源码未用 sys.symbol 不应报替代');
        }
      } finally {
        fs.rmSync(root2, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  return results;
}
