// closure-attestation.unit.test.ts — t2 review 闭环源码快照（goal-fakepass-hardening）
//
// 覆盖面：五源 root discovery（含残余扫描=孤儿 fail-safe）、build-profile 宽容解析、
// 测试子树排除、空集 fail-safe、attestation 写读、testing 对账四态、
// "contracts 未登记新文件"绕过封堵（事故派生 fixture）。

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache } from '../../config';
import {
  buildSourceInventory,
  collectProductSourceFiles,
  discoverProductSourceRoots,
  loadReviewClosureAttestation,
  parseBuildProfileSrcPaths,
  reconcileSourceTreeAgainstAttestation,
  writeReviewClosureAttestation,
} from '../../scripts/utils/closure-attestation';
import type { UnitCaseResult } from '../run-unit';

function mkProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-attest-'));
  clearFrameworkConfigCache();
  return root;
}

function writeFile(root: string, rel: string, content: string): void {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

/** 标准 fixture：分层模块 + entry + 残余模块 + build-profile 模块 + 干扰目录 */
function seedHostLike(root: string): void {
  writeFile(root, 'framework.config.json', JSON.stringify({
    schema_version: '1.1',
    project_name: 'fixture',
    architecture: { outer_layers: [{ id: '02-Feature' }, { id: '05-SystemBase' }] },
  }));
  writeFile(root, '02-Feature/WalletMain/src/main/ets/pages/A.ets', 'export const a = 1;\n');
  writeFile(root, '02-Feature/WalletMain/src/main/ets/constant/C.ets', 'export const FLAG = true;\n');
  writeFile(root, '02-Feature/WalletMain/src/ohosTest/ets/t.test.ets', 'test\n');
  writeFile(root, '05-SystemBase/CommFunc/src/main/ets/U.ets', 'util\n');
  writeFile(root, 'entry/src/main/ets/E.ets', 'entry\n');
  writeFile(root, 'stray/OrphanMod/src/main/ets/O.ets', 'orphan\n');
  writeFile(root, 'build-profile.json5', [
    '{',
    '  // comment',
    '  "modules": [',
    '    { "name": "BpMod", "srcPath": "./bpDir/BpMod", }, /* trailing comma + block */',
    '  ],',
    '}',
  ].join('\n'));
  writeFile(root, 'bpDir/BpMod/src/main/ets/B.ets', 'bp\n');
  // 干扰：framework/ 下的 src/main 不得入 roots
  writeFile(root, 'framework/fake/src/main/x.ets', 'nope\n');
}

interface Case { name: string; run: () => void }

const cases: Case[] = [
  {
    name: '五源 discovery：分层/entry/build-profile/残余全命中，framework/ 排除',
    run: () => {
      const root = mkProject();
      seedHostLike(root);
      const d = discoverProductSourceRoots(root);
      assert.ok(d.roots.includes('02-Feature/WalletMain'), 'outer layer 模块');
      assert.ok(d.roots.includes('05-SystemBase/CommFunc'));
      assert.ok(d.roots.includes('entry'), 'profile 标准根');
      assert.ok(d.roots.includes('bpDir/BpMod'), 'build-profile 模块');
      assert.ok(d.roots.includes('stray/OrphanMod'), '残余扫描=孤儿 fail-safe');
      assert.ok(!d.roots.some((r) => r.startsWith('framework')), 'framework/ 剪枝');
      assert.ok(d.provenance['02-Feature/WalletMain'].includes('outer_layer'));
      assert.ok(d.provenance['stray/OrphanMod'].includes('residual_scan'));
    },
  },
  {
    name: 'parseBuildProfileSrcPaths：注释/尾逗号宽容',
    run: () => {
      const raw = '{\n// c\n"modules":[{"srcPath": "./a/B",},/*x*/{"srcPath":\'./c/D\'}]}';
      assert.deepStrictEqual(parseBuildProfileSrcPaths(raw), ['./a/B', './c/D']);
    },
  },
  {
    name: 'inventory：测试子树排除；空集+预期有源码 → throw',
    run: () => {
      const root = mkProject();
      seedHostLike(root);
      const files = collectProductSourceFiles(root, '02-Feature/WalletMain');
      assert.ok(files.some((f) => f.endsWith('A.ets')));
      assert.ok(!files.some((f) => f.includes('ohosTest')), '测试子树不入 inventory');
      const inv = buildSourceInventory(root, { expectProductSources: true });
      assert.ok(inv.file_count >= 5);
      assert.ok(inv.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)));
      const empty = mkProject();
      assert.throws(
        () => buildSourceInventory(empty, { expectProductSources: true }),
        /fail-closed/,
      );
      // 不预期有源码（非产品型项目）→ 空集合法
      const inv2 = buildSourceInventory(empty, { expectProductSources: false });
      assert.strictEqual(inv2.file_count, 0);
    },
  },
  {
    name: 'attestation 写读 roundtrip + contracts 清单仅对照不定 scope',
    run: () => {
      const root = mkProject();
      seedHostLike(root);
      writeFile(root, 'doc/features/f1/contracts.yaml', 'files:\n  - 02-Feature/WalletMain/src/main/ets/pages/A.ets\n');
      const { attestation } = writeReviewClosureAttestation({
        projectRoot: root, feature: 'f1', expectProductSources: true,
        now: () => new Date('2026-07-13T00:00:00.000Z'),
      });
      assert.deepStrictEqual(attestation.contracts_files, ['02-Feature/WalletMain/src/main/ets/pages/A.ets']);
      // inventory 覆盖面远大于 contracts 声明（未登记文件也在快照内）
      assert.ok(attestation.inventory.files.some((f) => f.path.endsWith('C.ets')));
      const loaded = loadReviewClosureAttestation(root, 'f1');
      assert.ok(loaded);
      assert.strictEqual(loaded!.inventory.aggregate_sha256, attestation.inventory.aggregate_sha256);
    },
  },
  {
    name: '对账四态：fresh ok / 新增 / 修改 / 删除；未登记文件绕过被封（事故派生）',
    run: () => {
      const root = mkProject();
      seedHostLike(root);
      writeFile(root, 'doc/features/f1/contracts.yaml', 'files:\n  - 02-Feature/WalletMain/src/main/ets/pages/A.ets\n');
      const { attestation } = writeReviewClosureAttestation({
        projectRoot: root, feature: 'f1', expectProductSources: true,
      });
      let r = reconcileSourceTreeAgainstAttestation(root, attestation);
      assert.strictEqual(r.ok, true);

      // 事故形态：testing 期新建 contracts 未登记的产品常量文件（fast path 开关）
      writeFile(root, '02-Feature/WalletMain/src/main/ets/constant/FastPath.ets',
        'export const DEVICE_TEST_FAST_PATH = true;\n');
      r = reconcileSourceTreeAgainstAttestation(root, attestation);
      assert.strictEqual(r.ok, false);
      assert.ok(r.added.some((p) => p.endsWith('FastPath.ets')), '未登记新文件被抓');

      fs.rmSync(path.join(root, '02-Feature/WalletMain/src/main/ets/constant/FastPath.ets'));
      writeFile(root, '02-Feature/WalletMain/src/main/ets/constant/C.ets', 'export const FLAG = false;\n');
      r = reconcileSourceTreeAgainstAttestation(root, attestation);
      assert.ok(r.modified.some((p) => p.endsWith('C.ets')), '修改被抓');

      fs.rmSync(path.join(root, '05-SystemBase/CommFunc/src/main/ets/U.ets'));
      r = reconcileSourceTreeAgainstAttestation(root, attestation);
      assert.ok(r.deleted.some((p) => p.endsWith('U.ets')), '删除被抓');

      // 测试文件变更不触发（ut 期写测试合法）
      const root2 = mkProject();
      seedHostLike(root2);
      const a2 = writeReviewClosureAttestation({ projectRoot: root2, feature: 'f1', expectProductSources: true }).attestation;
      writeFile(root2, '02-Feature/WalletMain/src/ohosTest/ets/new.test.ets', 'new test\n');
      assert.strictEqual(reconcileSourceTreeAgainstAttestation(root2, a2).ok, true);
    },
  },
  {
    name: '新增整模块可见（codex 五轮 P0 复现）：review 后新建 newmod/src/main → new_roots+added FAIL',
    run: () => {
      const root = mkProject();
      seedHostLike(root);
      const { attestation } = writeReviewClosureAttestation({
        projectRoot: root, feature: 'f1', expectProductSources: true,
      });
      // 攻击：attestation 冻结后新增一个不属于任何旧 root 的完整模块，
      // 内容就是事故的 fast path 开关
      writeFile(root, 'newmod/src/main/ets/Fast.ets', 'export const DEVICE_TEST_FAST_PATH = true;\n');
      clearFrameworkConfigCache();
      const r = reconcileSourceTreeAgainstAttestation(root, attestation);
      assert.strictEqual(r.ok, false, '新模块不得隐身');
      assert.ok(r.new_roots.includes('newmod'), `new_roots 须含 newmod：${JSON.stringify(r.new_roots)}`);
      assert.ok(r.added.some((p) => p.endsWith('Fast.ets')), '新 root 下文件计为 added');
    },
  },
  {
    name: '深层孤儿模块（codex 六轮 P0-6 复现）：a/b/c/d/src/main 深嵌套仍被发现',
    run: () => {
      const root = mkProject();
      seedHostLike(root);
      const { attestation } = writeReviewClosureAttestation({
        projectRoot: root, feature: 'f1', expectProductSources: true,
      });
      // 攻击：深度 >3 的嵌套模块（旧实现深度 ≤3 会漏）
      writeFile(root, 'a/b/c/d/src/main/ets/Fast.ets', 'export const DEVICE_TEST_FAST_PATH = true;\n');
      clearFrameworkConfigCache();
      const roots = discoverProductSourceRoots(root).roots;
      assert.ok(roots.includes('a/b/c/d'), `深层模块须被发现：${JSON.stringify(roots)}`);
      const r = reconcileSourceTreeAgainstAttestation(root, attestation);
      assert.strictEqual(r.ok, false, '深层孤儿模块不得隐身');
      assert.ok(r.new_roots.includes('a/b/c/d'));
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: `closure-attestation: ${c.name}`, ok: true };
    } catch (err) {
      return {
        name: `closure-attestation: ${c.name}`,
        ok: false,
        error: (err as Error).stack ?? (err as Error).message,
      };
    }
  });
}
