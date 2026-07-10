// ============================================================================
// hap-discovery.unit.test.ts — plan d7e4b2a9 t1/t2 回归
// ============================================================================
//
// 覆盖：
//   - discoverAppHapArtifacts：outputs/<product> 布局命中（宿主 bc-openCard 误报根因）、
//     多候选歧义的四级排序键确定性、ohosTest outputs 目录排除、fallback build/* 不硬编码
//   - findAppSignedHap：薄包装与 discoverAppHapArtifacts(...).signedPath 行为等价
//   - detectStaleSignedSuspect：同 basename 配对观测，不跨文件名误伤
//
// 用法：
//   npx ts-node framework/harness/tests/run-unit.ts --filter hap-discovery
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  discoverAppHapArtifacts,
  findAppSignedHap,
  detectStaleSignedSuspect,
} from '../../hvigor-runner';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}\n    expected: ${e}\n    actual:   ${a}`);
  }
}
function assertNull(actual: unknown, label: string): void {
  if (actual !== null && actual !== undefined) {
    throw new Error(`${label}\n    expected: null/undefined\n    actual:   ${JSON.stringify(actual)}`);
  }
}
function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(label);
}

function withTmpDir<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hap-discovery-unit-'));
  try {
    return fn(dir);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function writeFile(p: string, content: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

function writeBuildProfile(root: string, modules: Array<{ name: string; srcPath: string }>): void {
  writeFile(
    path.join(root, 'build-profile.json5'),
    JSON.stringify({ modules }),
  );
}

const cases: Array<{ name: string; run: () => void }> = [
  // --------------------------------------------------------------------------
  // discoverAppHapArtifacts / findAppSignedHap
  // --------------------------------------------------------------------------
  {
    name: 'discoverAppHapArtifacts: outputs/<product> 布局命中（宿主 bc-openCard 根因场景，非 outputs/default）',
    run: () => withTmpDir(root => {
      writeBuildProfile(root, [{ name: 'Phone', srcPath: './01-Product/Phone' }]);
      const expected = path.join(root, '01-Product', 'Phone', 'build', 'product', 'outputs', 'product', 'Phone-product-signed.hap');
      writeFile(expected, 'fake-hap');
      const result = discoverAppHapArtifacts(root, 'product');
      assertEq(result.signedPath, expected, '应命中 outputs/product（非硬编码 outputs/default）');
      assertEq(result.candidates.length, 1, '仅一个候选');
      assert(result.scannedDirs.some(d => d.replace(/\\/g, '/').endsWith('01-Product/Phone/build/product/outputs/product')), 'scannedDirs 应记录实际扫描目录');
    }),
  },
  {
    name: 'discoverAppHapArtifacts: 标准 outputs/default 布局仍命中（既有行为不破）',
    run: () => withTmpDir(root => {
      writeBuildProfile(root, [{ name: 'Phone', srcPath: './01-Product/Phone' }]);
      const expected = path.join(root, '01-Product', 'Phone', 'build', 'default', 'outputs', 'default', 'Phone-default-signed.hap');
      writeFile(expected, 'fake-hap');
      const result = discoverAppHapArtifacts(root, 'default');
      assertEq(result.signedPath, expected, '标准布局应仍命中');
    }),
  },
  {
    name: 'discoverAppHapArtifacts: outputs/ohosTest 目录被排除（ohosTest 产物不归主 HAP 发现负责）',
    run: () => withTmpDir(root => {
      writeBuildProfile(root, [{ name: 'Phone', srcPath: './01-Product/Phone' }]);
      writeFile(
        path.join(root, '01-Product', 'Phone', 'build', 'default', 'outputs', 'ohosTest', 'Phone-ohosTest-signed.hap'),
        'fake',
      );
      const result = discoverAppHapArtifacts(root, 'default');
      assertNull(result.signedPath, 'ohosTest outputs 目录不应被当作主 HAP 候选');
    }),
  },
  {
    name: 'discoverAppHapArtifacts: 四级排序键确定性——segment rank > module 声明序 > outputs rank，歧义候选全量入 result',
    run: () => withTmpDir(root => {
      writeBuildProfile(root, [
        { name: 'ModA', srcPath: './mod/A' },
        { name: 'ModB', srcPath: './mod/B' },
      ]);
      const winner = path.join(root, 'mod', 'A', 'build', 'product', 'outputs', 'product', 'A-product-signed.hap');
      const modADefault = path.join(root, 'mod', 'A', 'build', 'default', 'outputs', 'default', 'A-default-signed.hap');
      const modBProduct = path.join(root, 'mod', 'B', 'build', 'product', 'outputs', 'product', 'B-product-signed.hap');
      writeFile(winner, 'fake');
      writeFile(modADefault, 'fake');
      writeFile(modBProduct, 'fake');

      const result = discoverAppHapArtifacts(root, 'product');
      assertEq(result.signedPath, winner, 'segment=product(rank0) 且 module 声明序更靠前的 ModA 应胜出');
      assertEq(result.candidates.length, 3, '三个候选应全量入 result（歧义不静默）');
      assertEq(result.candidates[0]!.path, winner, 'candidates[0] 应与 signedPath 一致');
    }),
  },
  {
    name: 'discoverAppHapArtifacts: 文件名 rank——非 ohostest 命名优先，字典序尾条（既有行为）',
    run: () => withTmpDir(root => {
      writeBuildProfile(root, [{ name: 'Phone', srcPath: './01-Product/Phone' }]);
      const dir = path.join(root, '01-Product', 'Phone', 'build', 'default', 'outputs', 'default');
      writeFile(path.join(dir, 'A-signed.hap'), 'fake');
      writeFile(path.join(dir, 'B-signed.hap'), 'fake');
      const result = discoverAppHapArtifacts(root, 'default');
      assert(result.signedPath!.endsWith('B-signed.hap'), '同 rank 内应取字典序尾条（B > A）');
    }),
  },
  {
    name: 'discoverAppHapArtifacts: fallback 不硬编码——buildProduct 未传时仍能扫描到非 default 段',
    run: () => withTmpDir(root => {
      writeBuildProfile(root, [{ name: 'Phone', srcPath: './01-Product/Phone' }]);
      const expected = path.join(root, '01-Product', 'Phone', 'build', 'product', 'outputs', 'product', 'Phone-product-signed.hap');
      writeFile(expected, 'fake');
      const result = discoverAppHapArtifacts(root);
      assertEq(result.signedPath, expected, '未传 buildProduct 时仍应枚举到 product 段（不再硬编码 default）');
    }),
  },
  {
    name: 'discoverAppHapArtifacts: 无任何命中 → signedPath=null，scannedDirs 仍记录已扫描目录',
    run: () => withTmpDir(root => {
      writeBuildProfile(root, [{ name: 'Phone', srcPath: './01-Product/Phone' }]);
      fs.mkdirSync(path.join(root, '01-Product', 'Phone', 'build', 'default', 'outputs', 'default'), { recursive: true });
      const result = discoverAppHapArtifacts(root, 'default');
      assertNull(result.signedPath, '空目录应返回 null');
      assert(result.scannedDirs.length > 0, '即使未命中也应记录扫描过的目录');
    }),
  },
  {
    name: 'findAppSignedHap: 薄包装与 discoverAppHapArtifacts(...).signedPath 行为等价',
    run: () => withTmpDir(root => {
      writeBuildProfile(root, [{ name: 'Phone', srcPath: './01-Product/Phone' }]);
      const expected = path.join(root, '01-Product', 'Phone', 'build', 'product', 'outputs', 'product', 'Phone-product-signed.hap');
      writeFile(expected, 'fake');
      const viaDiscover = discoverAppHapArtifacts(root, 'product').signedPath;
      const viaFind = findAppSignedHap(root, 'product');
      assertEq(viaFind, viaDiscover, 'find* 薄包装应与 discover*.signedPath 一致');
      assertEq(viaFind, expected, '且应命中预期路径');
    }),
  },

  // --------------------------------------------------------------------------
  // detectStaleSignedSuspect
  // --------------------------------------------------------------------------
  {
    name: 'detectStaleSignedSuspect: 同 basename 配对，unsigned 新于 signed → staleSuspect=true + note',
    run: () => withTmpDir(root => {
      const signed = path.join(root, 'Phone-product-signed.hap');
      const unsigned = path.join(root, 'Phone-product-unsigned.hap');
      writeFile(signed, 'signed');
      const signedMtime = fs.statSync(signed).mtimeMs;
      fs.utimesSync(signed, signedMtime / 1000, signedMtime / 1000);
      writeFile(unsigned, 'unsigned');
      fs.utimesSync(unsigned, (signedMtime + 60_000) / 1000, (signedMtime + 60_000) / 1000);
      const result = detectStaleSignedSuspect(signed);
      assertEq(result.staleSuspect, true, 'unsigned 更新应判 staleSuspect');
      assertEq(result.unsignedPath, unsigned, 'unsignedPath 应指向配对文件');
      assert(Boolean(result.note), '应带 note 说明');
    }),
  },
  {
    name: 'detectStaleSignedSuspect: unsigned 早于/等于 signed → staleSuspect=false（不误报）',
    run: () => withTmpDir(root => {
      const signed = path.join(root, 'Phone-product-signed.hap');
      const unsigned = path.join(root, 'Phone-product-unsigned.hap');
      writeFile(unsigned, 'unsigned');
      const unsignedMtime = fs.statSync(unsigned).mtimeMs;
      writeFile(signed, 'signed');
      fs.utimesSync(signed, (unsignedMtime + 60_000) / 1000, (unsignedMtime + 60_000) / 1000);
      const result = detectStaleSignedSuspect(signed);
      assertEq(result.staleSuspect, false, 'signed 新于 unsigned 时不应判 stale');
    }),
  },
  {
    name: 'detectStaleSignedSuspect: 无同 basename unsigned 配对 → staleSuspect=false, unsignedPath=null（不跨文件名比较）',
    run: () => withTmpDir(root => {
      const signed = path.join(root, 'Phone-product-signed.hap');
      writeFile(signed, 'signed');
      // 同目录存在完全不相关命名的 unsigned，不应被误配对
      writeFile(path.join(root, 'OtherModule-unsigned.hap'), 'unsigned');
      const result = detectStaleSignedSuspect(signed);
      assertEq(result.staleSuspect, false, '无同 basename 配对不应判 stale');
      assertNull(result.unsignedPath, '不应跨文件名误配对');
    }),
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}
