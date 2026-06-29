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
import { findModuleMediaFile, moduleMediaRealnessForKey, collectPlaceholderAssetIssues } from '../../visual-parity-backstop';
import type { CheckContext } from '../../../../../harness/scripts/utils/types';
import type { UiSpecDoc } from '../../../../../harness/scripts/utils/ui-spec-shared';
import type { UnitCaseResult } from '../../../../../harness/tests/run-unit';

function writeEtsRef(root: string, pkg: string, key: string): void {
  const p = path.join(root, pkg, 'src', 'main', 'ets', 'C.ets');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `@Component struct C { build() { Image($r('app.media.${key}')) } }`);
}

function placeholderCtx(root: string): CheckContext {
  return { projectRoot: root, featureSpec: { contracts: contractsAB } } as unknown as CheckContext;
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

  return results;
}
