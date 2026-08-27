// ============================================================================
// hylyre-ensure-upgrade.unit.test.ts — vendor 对齐判定与发布件选型回归
// schema 1（wheel）/ schema 2（源码树）双兼容矩阵；schema 2 fixture 按 Hylyre 需求
// R1-R3 合成生成（tmp 目录假包），不依赖 Hylyre 真件（plan a7c3e9d1 t1⑤）。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  evaluateVendorSyncNeed,
  fingerprintFromManifest,
  isSafeVendorRelPath,
  isValidVendorSourceDecl,
  manifestDeclaredArtifactSha,
  parseHylyreVersionFromWheelFilename,
  pickVendorInstallable,
  pickVendorWheelPath,
  readInstallFingerprint,
  sha256TreeFromManifest,
  stageVendorSourceForInstall,
  stripBom,
  writeInstallFingerprint,
  type HylyreVendorManifestShape,
  type HylyreVendorSourceFileEntry,
} from '../../hylyre-vendor-sync';
import { ensureHylyreReady } from '../../providers/device-test-run';

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

function assertTrue(cond: boolean, label: string): void {
  if (!cond) throw new Error(label);
}

const wheelManifest = (ver: string, filename: string, sha: string): HylyreVendorManifestShape => ({
  schema: 1,
  hylyre_version: ver,
  wheel: { filename, sha256: sha, size_bytes: 100 },
});

function sha256Hex(content: string): string {
  return crypto.createHash('sha256').update(Buffer.from(content, 'utf-8')).digest('hex');
}

/** 按需求 R1-R3 口径合成 schema 2 vendor fixture（真件口径参照 0.3.2：含 src/README.md）。 */
function makeSourceVendorFixture(
  dir: string,
  ver = '0.3.2',
): { manifest: HylyreVendorManifestShape; srcRoot: string; files: HylyreVendorSourceFileEntry[] } {
  const srcRoot = path.join(dir, 'src');
  const contents: Array<[string, string]> = [
    ['README.md', '# hylyre\n'],
    ['pyproject.toml', `[project]\nname = "hylyre"\nversion = "${ver}"\n`],
    ['hylyre/__init__.py', `__version__ = "${ver}"\n`],
    ['hylyre/api/planned_step_keys.py', 'PLANNED_STEP_ROOT_KEYS = ("touch",)\n'],
    ['hylyre/contracts/README.md', 'contracts package-data\n'],
    ['hylyre/contracts/report-sections.yaml', 'sections: []\n'],
  ];
  const files: HylyreVendorSourceFileEntry[] = [];
  for (const [rel, content] of contents) {
    const abs = path.join(srcRoot, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
    files.push({ path: rel, sha256: sha256Hex(content), size_bytes: Buffer.byteLength(content) });
  }
  const treeSha = sha256TreeFromManifest(srcRoot, files);
  if (!treeSha) throw new Error('fixture tree hash failed');
  const manifest: HylyreVendorManifestShape = {
    schema: 2,
    hylyre_version: ver,
    source: {
      root: 'src',
      file_count: files.length,
      total_bytes: files.reduce((s, f) => s + f.size_bytes, 0),
      tree_sha256: treeSha,
      files,
    },
  };
  fs.writeFileSync(path.join(dir, 'release.manifest.json'), JSON.stringify(manifest), 'utf-8');
  return { manifest, srcRoot, files };
}

function withTmpDir<T>(prefix: string, fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

interface Case {
  name: string;
  run: () => void;
}

const cases: Case[] = [
  {
    name: 'parseHylyreVersionFromWheelFilename: 标准 wheel 名',
    run: () => {
      assertEq(
        parseHylyreVersionFromWheelFilename('hylyre-0.2.0-py3-none-any.whl'),
        '0.2.0',
        'version',
      );
    },
  },
  {
    name: 'evaluateVendorSyncNeed: pip 版本与 manifest 不一致 → needsSync',
    run: () => {
      const r = evaluateVendorSyncNeed({
        manifest: wheelManifest('0.2.0', 'hylyre-0.2.0-py3-none-any.whl', 'abc'),
        pipVersion: '0.1.0',
        artifactKind: 'wheel',
        artifactSha256: 'abc',
        cachedFingerprint: null,
      });
      assertTrue(r.needsSync, 'needsSync');
      assertEq(r.reason, 'version_mismatch', 'reason');
    },
  },
  {
    name: 'evaluateVendorSyncNeed: 版本相同但工件 sha 与指纹不同 → needsSync',
    run: () => {
      const r = evaluateVendorSyncNeed({
        manifest: wheelManifest('0.1.0', 'hylyre-0.1.0-py3-none-any.whl', 'newsha'),
        pipVersion: '0.1.0',
        artifactKind: 'wheel',
        artifactSha256: 'newsha',
        cachedFingerprint: {
          manifest_version: '0.1.0',
          wheel_filename: 'hylyre-0.1.0-py3-none-any.whl',
          wheel_sha256: 'oldsha',
          installed_at: '2026-01-01T00:00:00.000Z',
        },
      });
      assertTrue(r.needsSync, 'needsSync');
      assertEq(r.reason, 'artifact_sha256_changed', 'reason');
    },
  },
  {
    name: 'evaluateVendorSyncNeed: 版本与指纹均对齐 → 无需 sync（legacy wheel 指纹兼容）',
    run: () => {
      const r = evaluateVendorSyncNeed({
        manifest: wheelManifest('0.1.0', 'hylyre-0.1.0-py3-none-any.whl', 'same'),
        pipVersion: '0.1.0',
        artifactKind: 'wheel',
        artifactSha256: 'same',
        cachedFingerprint: {
          manifest_version: '0.1.0',
          wheel_filename: 'hylyre-0.1.0-py3-none-any.whl',
          wheel_sha256: 'same',
          installed_at: '2026-01-01T00:00:00.000Z',
        },
      });
      assertTrue(!r.needsSync, '!needsSync');
      assertEq(r.reason, 'aligned', 'reason');
    },
  },
  {
    name: 'evaluateVendorSyncNeed: 版本相同但无 install fingerprint → needsSync（同版本补丁件）',
    run: () => {
      const r = evaluateVendorSyncNeed({
        manifest: wheelManifest('0.1.0', 'hylyre-0.1.0-py3-none-any.whl', 'newsha'),
        pipVersion: '0.1.0',
        artifactKind: 'wheel',
        artifactSha256: 'newsha',
        cachedFingerprint: null,
      });
      assertTrue(r.needsSync, 'needsSync');
      assertEq(r.reason, 'missing_install_fingerprint', 'reason');
    },
  },
  {
    name: 'evaluateVendorSyncNeed: wheel 文件 sha256 与 manifest 声明不一致 → manifestArtifactMismatch',
    run: () => {
      const r = evaluateVendorSyncNeed({
        manifest: wheelManifest('0.1.0', 'hylyre-0.1.0-py3-none-any.whl', 'manifestsha'),
        pipVersion: '0.1.0',
        artifactKind: 'wheel',
        artifactSha256: 'filesha',
        cachedFingerprint: null,
      });
      assertTrue(r.manifestArtifactMismatch, 'manifestArtifactMismatch');
    },
  },
  {
    name: 'evaluateVendorSyncNeed: legacy wheel 指纹遇 source 发布 → artifact_kind_changed 一次性重装',
    run: () => {
      const r = evaluateVendorSyncNeed({
        manifest: {
          schema: 2,
          hylyre_version: '0.3.2',
          source: { root: 'src', file_count: 1, total_bytes: 1, tree_sha256: 'treesha', files: [] },
        },
        pipVersion: '0.3.2',
        artifactKind: 'source',
        artifactSha256: 'treesha',
        cachedFingerprint: {
          manifest_version: '0.3.2',
          wheel_filename: 'hylyre-0.3.2-py3-none-any.whl',
          wheel_sha256: 'oldwheelsha',
          installed_at: '2026-01-01T00:00:00.000Z',
        },
      });
      assertTrue(r.needsSync, 'needsSync');
      assertEq(r.reason, 'artifact_kind_changed', 'reason');
      assertTrue(!r.manifestArtifactMismatch, 'tree hash 与声明一致时不判损坏');
    },
  },
  {
    name: 'evaluateVendorSyncNeed: source 指纹对齐 → aligned；tree_sha256 与声明不符 → manifestArtifactMismatch',
    run: () => {
      const manifest: HylyreVendorManifestShape = {
        schema: 2,
        hylyre_version: '0.3.2',
        source: { root: 'src', file_count: 1, total_bytes: 1, tree_sha256: 'treesha', files: [] },
      };
      const aligned = evaluateVendorSyncNeed({
        manifest,
        pipVersion: '0.3.2',
        artifactKind: 'source',
        artifactSha256: 'treesha',
        cachedFingerprint: {
          manifest_version: '0.3.2',
          artifact_kind: 'source',
          artifact_sha256: 'treesha',
          installed_at: '2026-01-01T00:00:00.000Z',
        },
      });
      assertTrue(!aligned.needsSync, 'aligned');
      assertEq(aligned.reason, 'aligned', 'reason');

      const damaged = evaluateVendorSyncNeed({
        manifest,
        pipVersion: '0.3.2',
        artifactKind: 'source',
        artifactSha256: 'measured-different',
        cachedFingerprint: null,
      });
      assertTrue(damaged.manifestArtifactMismatch, '实测 tree hash ≠ 声明 → 损坏');
    },
  },
  {
    name: 'pickVendorWheelPath: 优先 manifest.wheel.filename',
    run: () =>
      withTmpDir('hylyre-vendor-', dir => {
        fs.writeFileSync(path.join(dir, 'hylyre-0.1.0-py3-none-any.whl'), 'old');
        fs.writeFileSync(path.join(dir, 'hylyre-0.2.0-py3-none-any.whl'), 'new');
        const picked = pickVendorWheelPath(
          dir,
          wheelManifest('0.1.0', 'hylyre-0.1.0-py3-none-any.whl', 'x'),
        );
        assertEq(picked, path.join(dir, 'hylyre-0.1.0-py3-none-any.whl'), 'picked');
      }),
  },
  {
    name: 'pickVendorWheelPath: 多 wheel 无 manifest 文件名时取最新版本',
    run: () =>
      withTmpDir('hylyre-vendor-', dir => {
        fs.writeFileSync(path.join(dir, 'hylyre-0.1.0-py3-none-any.whl'), 'old');
        fs.writeFileSync(path.join(dir, 'hylyre-0.2.0-py3-none-any.whl'), 'new');
        const picked = pickVendorWheelPath(dir, null);
        assertEq(picked, path.join(dir, 'hylyre-0.2.0-py3-none-any.whl'), 'picked latest');
      }),
  },
  {
    name: 'pickVendorInstallable: schema 2 双存（src + 旧 whl）→ 源码优先',
    run: () =>
      withTmpDir('hylyre-vendor-', dir => {
        const { manifest, srcRoot } = makeSourceVendorFixture(dir);
        fs.writeFileSync(path.join(dir, 'hylyre-0.3.1-py3-none-any.whl'), 'legacy');
        const picked = pickVendorInstallable(dir, manifest);
        assertEq(picked?.kind, 'source', 'kind');
        assertEq(picked?.path, srcRoot, 'path');
      }),
  },
  {
    name: 'pickVendorInstallable: schema 1 → wheel（现状回归）',
    run: () =>
      withTmpDir('hylyre-vendor-', dir => {
        fs.writeFileSync(path.join(dir, 'hylyre-0.3.1-py3-none-any.whl'), 'w');
        const picked = pickVendorInstallable(
          dir,
          wheelManifest('0.3.1', 'hylyre-0.3.1-py3-none-any.whl', 'x'),
        );
        assertEq(picked?.kind, 'wheel', 'kind');
      }),
  },
  {
    name: 'pickVendorInstallable: schema 2 + src 缺失 + manifest.wheel 在场 → 回落 wheel（sha 可验）',
    run: () =>
      withTmpDir('hylyre-vendor-', dir => {
        const { manifest } = makeSourceVendorFixture(dir);
        fs.rmSync(path.join(dir, 'src'), { recursive: true, force: true });
        fs.writeFileSync(path.join(dir, 'hylyre-0.3.2-py3-none-any.whl'), 'w');
        const withWheelField: HylyreVendorManifestShape = {
          ...manifest,
          wheel: { filename: 'hylyre-0.3.2-py3-none-any.whl', sha256: 'x', size_bytes: 1 },
        };
        const picked = pickVendorInstallable(dir, withWheelField);
        assertEq(picked?.kind, 'wheel', 'kind');
      }),
  },
  {
    name: 'pickVendorInstallable: schema 2 + src 缺失 + 无 wheel 字段 + 目录躺旧 whl → null（评审 3 P1 禁静默装旧件）',
    run: () =>
      withTmpDir('hylyre-vendor-', dir => {
        const { manifest } = makeSourceVendorFixture(dir);
        fs.rmSync(path.join(dir, 'src'), { recursive: true, force: true });
        fs.writeFileSync(path.join(dir, 'hylyre-0.3.2-py3-none-any.whl'), 'stray');
        const picked = pickVendorInstallable(dir, manifest);
        assertEq(picked, null, 'picked must be null');
      }),
  },
  {
    name: 'sha256TreeFromManifest: 确定性（清单顺序无关）且内容敏感',
    run: () =>
      withTmpDir('hylyre-src-', dir => {
        const { manifest, srcRoot, files } = makeSourceVendorFixture(dir);
        const shuffled = [...files].reverse();
        assertEq(
          sha256TreeFromManifest(srcRoot, shuffled),
          manifest.source!.tree_sha256,
          'shuffle-invariant',
        );
        fs.appendFileSync(path.join(srcRoot, 'hylyre', '__init__.py'), '# tampered\n');
        assertTrue(
          sha256TreeFromManifest(srcRoot, files) !== manifest.source!.tree_sha256,
          'content-sensitive',
        );
      }),
  },
  {
    name: 'sha256TreeFromManifest: src 内未声明杂物（__pycache__/*.pyc）不改变 tree hash（评审 3 P0 反例格）',
    run: () =>
      withTmpDir('hylyre-src-', dir => {
        const { manifest, srcRoot, files } = makeSourceVendorFixture(dir);
        const junkDir = path.join(srcRoot, 'hylyre', '__pycache__');
        fs.mkdirSync(junkDir, { recursive: true });
        fs.writeFileSync(path.join(junkDir, '__init__.cpython-314.pyc'), 'bytecode');
        fs.writeFileSync(path.join(srcRoot, 'hylyre', 'scratch.py.orig'), 'editor junk');
        assertEq(
          sha256TreeFromManifest(srcRoot, files),
          manifest.source!.tree_sha256,
          'junk 不入 hash、不假触发发布件损坏',
        );
      }),
  },
  {
    name: 'sha256TreeFromManifest: 声明文件缺失 → null（半同步/损坏）',
    run: () =>
      withTmpDir('hylyre-src-', dir => {
        const { srcRoot, files } = makeSourceVendorFixture(dir);
        fs.rmSync(path.join(srcRoot, 'hylyre', 'contracts', 'README.md'));
        assertEq(sha256TreeFromManifest(srcRoot, files), null, 'missing declared file');
      }),
  },
  {
    name: 'stageVendorSourceForInstall: 预清空 build-src、按清单拷贝、杂物不入副本',
    run: () =>
      withTmpDir('hylyre-stage-', dir => {
        const vendorDir = path.join(dir, 'vendor');
        fs.mkdirSync(vendorDir, { recursive: true });
        const { manifest, srcRoot, files } = makeSourceVendorFixture(vendorDir);
        const junkDir = path.join(srcRoot, 'hylyre', '__pycache__');
        fs.mkdirSync(junkDir, { recursive: true });
        fs.writeFileSync(path.join(junkDir, 'x.pyc'), 'junk');

        const buildBase = path.join(dir, '.hylyre', 'build-src');
        const stale = path.join(buildBase, '0.0.1-deadbeef');
        fs.mkdirSync(stale, { recursive: true });
        fs.writeFileSync(path.join(stale, 'stale.txt'), 'stale');

        const staged = stageVendorSourceForInstall({
          srcRootAbs: srcRoot,
          buildBaseAbs: buildBase,
          version: manifest.hylyre_version,
          treeSha256: manifest.source!.tree_sha256,
          files,
        });
        assertTrue(!fs.existsSync(stale), '上次残留已被预清空自愈');
        assertEq(
          path.basename(staged),
          `artifact-${manifest.source!.tree_sha256.slice(0, 12)}`,
          'dest 命名（评审 6 P1：只用 hex tree hash，version 自由文本不入路径）',
        );
        assertTrue(staged.startsWith(buildBase), 'dest 在 build-src 下（安装目标≠vendor src）');
        // 评审 6 P1：恶意 version 不得逃逸 build-src（dest 命名已不消费 version，
        // 且非 hex treeSha 直接抛出）
        const evilStaged = stageVendorSourceForInstall({
          srcRootAbs: srcRoot,
          buildBaseAbs: buildBase,
          version: '../../escaped',
          treeSha256: manifest.source!.tree_sha256,
          files,
        });
        assertTrue(
          path.resolve(evilStaged).startsWith(path.resolve(buildBase) + path.sep),
          '恶意 version 不得把 dest 拼出 build-src 之外',
        );
        assertTrue(!fs.existsSync(path.join(dir, 'escaped')), 'build-src 外不得出现逃逸目录');
        let badShaThrew = false;
        try {
          stageVendorSourceForInstall({
            srcRootAbs: srcRoot,
            buildBaseAbs: buildBase,
            version: '0.3.2',
            treeSha256: '../not-hex',
            files,
          });
        } catch {
          badShaThrew = true;
        }
        assertTrue(badShaThrew, '非 hex treeSha 必须抛出');
        for (const f of files) {
          assertTrue(fs.existsSync(path.join(staged, ...f.path.split('/'))), `declared copied: ${f.path}`);
        }
        assertTrue(
          !fs.existsSync(path.join(staged, 'hylyre', '__pycache__')),
          '杂物不入安装副本',
        );
      }),
  },
  {
    name: 'install fingerprint: wheel/source 两形态读写 + BOM 容错',
    run: () =>
      withTmpDir('hylyre-venv-', venv => {
        const wheelFp = fingerprintFromManifest(
          wheelManifest('0.2.0', 'hylyre-0.2.0-py3-none-any.whl', 'deadbeef'),
          'deadbeef',
        );
        writeInstallFingerprint(venv, wheelFp);
        const readWheel = readInstallFingerprint(venv);
        assertEq(readWheel?.wheel_sha256, 'deadbeef', 'wheel sha');
        assertEq(readWheel?.artifact_kind, 'wheel', 'wheel kind');

        const srcFp = fingerprintFromManifest(
          {
            schema: 2,
            hylyre_version: '0.3.2',
            source: { root: 'src', file_count: 1, total_bytes: 1, tree_sha256: 'TREESHA', files: [] },
          },
          'TREESHA',
          'source',
        );
        writeInstallFingerprint(venv, srcFp);
        const readSrc = readInstallFingerprint(venv);
        assertEq(readSrc?.artifact_kind, 'source', 'source kind');
        assertEq(readSrc?.artifact_sha256, 'treesha', 'source sha 小写归一');
        assertEq(readSrc?.wheel_sha256, undefined, 'source 指纹不带 wheel 字段');

        // BOM 容错（评审 4 P2）：utf-8-sig 写盘的指纹仍可读
        const fpPath = path.join(venv, '.hylyre-vendor-fingerprint.json');
        fs.writeFileSync(fpPath, '\uFEFF' + fs.readFileSync(fpPath, 'utf-8'), 'utf-8');
        assertEq(readInstallFingerprint(venv)?.artifact_kind, 'source', 'BOM tolerated');
        assertEq(stripBom('\uFEFF{}'), '{}', 'stripBom');
      }),
  },
  {
    name: '评审 5 P1：schema 2 wheel 回落按 artifactKind 取 manifest.wheel.sha256 比对（不与 tree_sha256 假损坏）',
    run: () => {
      const manifest: HylyreVendorManifestShape = {
        schema: 2,
        hylyre_version: '0.3.2',
        source: {
          root: 'src',
          file_count: 1,
          total_bytes: 1,
          tree_sha256: 'a'.repeat(64),
          files: [{ path: 'pyproject.toml', sha256: 'b'.repeat(64), size_bytes: 1 }],
        },
        wheel: { filename: 'hylyre-0.3.2-py3-none-any.whl', sha256: 'c'.repeat(64), size_bytes: 9 },
      };
      assertEq(manifestDeclaredArtifactSha(manifest, 'wheel'), 'c'.repeat(64), 'wheel 声明取 wheel.sha256');
      assertEq(manifestDeclaredArtifactSha(manifest, 'source'), 'a'.repeat(64), 'source 声明取 tree_sha256');
      const r = evaluateVendorSyncNeed({
        manifest,
        pipVersion: '0.3.2',
        artifactKind: 'wheel',
        artifactSha256: 'c'.repeat(64),
        cachedFingerprint: {
          manifest_version: '0.3.2',
          artifact_kind: 'wheel',
          artifact_sha256: 'c'.repeat(64),
          installed_at: '2026-01-01T00:00:00.000Z',
        },
      });
      assertTrue(!r.manifestArtifactMismatch, 'wheel 回落不得与 tree_sha256 比对产生假损坏');
      assertEq(r.reason, 'aligned', 'wheel 回落可正常对齐');
    },
  },
  {
    name: '评审 5 P1：manifest 路径穿越硬拒——tree hash 判 null、staging 抛出、shape 校验拒收',
    run: () =>
      withTmpDir('hylyre-trav-', dir => {
        const src = path.join(dir, 'src');
        fs.mkdirSync(src, { recursive: true });
        fs.writeFileSync(path.join(dir, 'payload.txt'), 'outside');
        const evil: HylyreVendorSourceFileEntry[] = [
          { path: '../payload.txt', sha256: 'a'.repeat(64), size_bytes: 7 },
        ];
        assertEq(sha256TreeFromManifest(src, evil), null, '穿越条目 tree hash 必须 null');
        let threw = false;
        try {
          stageVendorSourceForInstall({
            srcRootAbs: src,
            buildBaseAbs: path.join(dir, 'build'),
            version: '0.0.1',
            treeSha256: 'deadbeef'.repeat(8),
            files: evil,
          });
        } catch {
          threw = true;
        }
        assertTrue(threw, '穿越条目 staging 必须抛出');
        assertTrue(!fs.existsSync(path.join(dir, 'build')), '抛出前不得向任何目录写入');

        for (const bad of ['/abs/x.py', 'C:/x.py', 'a\\b.py', 'a/../b.py', './x.py', '..', '']) {
          assertTrue(!isSafeVendorRelPath(bad), `不安全路径必须拒绝：${JSON.stringify(bad)}`);
        }
        assertTrue(isSafeVendorRelPath('hylyre/api/planned_step_keys.py'), '正常 POSIX 相对路径放行');

        const goodEntry = { path: 'pyproject.toml', sha256: 'a'.repeat(64), size_bytes: 1 };
        const base = { root: 'src', file_count: 1, total_bytes: 1, tree_sha256: 'b'.repeat(64) };
        assertTrue(isValidVendorSourceDecl({ ...base, files: [goodEntry] }), '合法声明放行');
        assertTrue(
          !isValidVendorSourceDecl({ ...base, root: '../out', files: [goodEntry] }),
          'root 穿越拒收',
        );
        assertTrue(
          !isValidVendorSourceDecl({ ...base, files: [goodEntry, goodEntry] }),
          '重复条目拒收',
        );
        assertTrue(
          !isValidVendorSourceDecl({ ...base, files: [{ ...goodEntry, sha256: 'xyz' }] }),
          '非 64 位 hex sha 拒收',
        );
        // 畸形 source 声明的 manifest 不得静默落到 wheel 文件名扫描
        fs.writeFileSync(path.join(dir, 'hylyre-0.3.2-py3-none-any.whl'), 'stray');
        const malformed: HylyreVendorManifestShape = {
          schema: 2,
          hylyre_version: '0.3.2',
          source: { ...base, root: '../escape', files: [goodEntry] },
        };
        assertEq(pickVendorInstallable(dir, malformed), null, '畸形声明按 corrupt 处理');
      }),
  },
  {
    name: '评审 5 P0（生产接线）：vendor 源码被篡改 → ensureHylyreReady 在任何 pip/venv/import 之前 fail-fast',
    run: () =>
      withTmpDir('hylyre-gate-', root => {
        const savedPy = process.env.HYLYRE_PYTHON;
        const savedHome = process.env.HYLYRE_HOME;
        delete process.env.HYLYRE_PYTHON;
        delete process.env.HYLYRE_HOME;
        try {
          fs.writeFileSync(
            path.join(root, 'framework.config.json'),
            JSON.stringify({
              schema_version: '1.1',
              project_name: 'ensure-gate-fixture',
              project_profile: { name: 'hmos-app', sub_variant: 'app' },
              architecture: {
                outer_layers: [{ id: '02-Feature', can_depend_on: [], intra_layer_deps: 'dag' }],
                module_inner_layers: ['shared'],
                inner_dependency_direction: 'upward',
                cross_module_exports_file: 'index.ets',
              },
              paths: {
                features_dir: 'doc/features',
                docs_committed: false,
                reports_dir_pattern: 'doc/features/<feature>/<phase>/reports',
              },
              materialized_adapters: ['cursor'],
              tools: {
                hylyre: { vendor_dir: 'vendor-hylyre', venv_dir: '.hylyre/venv', auto_install: true },
              },
            }),
            'utf-8',
          );
          // framework 树标记（featurePhaseReportsDir 的 frameworkRoot 解析要求）
          fs.mkdirSync(path.join(root, 'skills'), { recursive: true });
          const vendorDir = path.join(root, 'vendor-hylyre');
          fs.mkdirSync(vendorDir, { recursive: true });
          const { srcRoot } = makeSourceVendorFixture(vendorDir);
          // 篡改一个声明文件（内容变、路径仍在）——被污染源码严禁进入 PEP 517
          fs.appendFileSync(path.join(srcRoot, 'hylyre', '__init__.py'), '\nimport os  # tampered\n');

          const result = ensureHylyreReady({
            projectRoot: root,
            harnessRoot: path.join(root, 'harness'),
            feature: 'gate-fixture',
            phase: 'testing',
          });

          assertTrue(!result.ok, 'ensure 必须失败');
          assertTrue(
            result.errors.some(e => e.kind === 'vendor' && e.message.includes('不一致')),
            `错误须为 vendor 完整性：${JSON.stringify(result.errors)}`,
          );
          assertTrue(!fs.existsSync(path.join(root, '.hylyre', 'venv')), '不得创建 venv');
          assertTrue(!fs.existsSync(path.join(root, '.hylyre', 'build-src')), '不得暂存安装副本');
          const log = result.logPath ? fs.readFileSync(result.logPath, 'utf-8') : '';
          assertTrue(!log.includes('pip install'), 'mismatch 时 pip spawn 次数必须为 0');
          assertTrue(!log.includes('创建 venv'), 'mismatch 时不得创建 venv');
        } finally {
          if (savedPy !== undefined) process.env.HYLYRE_PYTHON = savedPy;
          if (savedHome !== undefined) process.env.HYLYRE_HOME = savedHome;
        }
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
