// ============================================================================
// hylyre-ensure-upgrade.unit.test.ts — vendor 对齐判定与 wheel 选型回归
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  evaluateVendorSyncNeed,
  parseHylyreVersionFromWheelFilename,
  pickVendorWheelPath,
  readInstallFingerprint,
  writeInstallFingerprint,
  fingerprintFromManifest,
  type HylyreVendorManifestShape,
} from '../../hylyre-vendor-sync';

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

const sampleManifest = (ver: string, filename: string, sha: string): HylyreVendorManifestShape => ({
  schema: 1,
  hylyre_version: ver,
  wheel: { filename, sha256: sha, size_bytes: 100 },
});

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
        manifest: sampleManifest('0.2.0', 'hylyre-0.2.0-py3-none-any.whl', 'abc'),
        pipVersion: '0.1.0',
        wheelSha256: 'abc',
        cachedFingerprint: null,
      });
      assertTrue(r.needsSync, 'needsSync');
      assertEq(r.reason, 'version_mismatch', 'reason');
    },
  },
  {
    name: 'evaluateVendorSyncNeed: 版本相同但 wheel sha256 与指纹不同 → needsSync',
    run: () => {
      const r = evaluateVendorSyncNeed({
        manifest: sampleManifest('0.1.0', 'hylyre-0.1.0-py3-none-any.whl', 'newsha'),
        pipVersion: '0.1.0',
        wheelSha256: 'newsha',
        cachedFingerprint: {
          manifest_version: '0.1.0',
          wheel_filename: 'hylyre-0.1.0-py3-none-any.whl',
          wheel_sha256: 'oldsha',
          installed_at: '2026-01-01T00:00:00.000Z',
        },
      });
      assertTrue(r.needsSync, 'needsSync');
      assertEq(r.reason, 'wheel_sha256_changed', 'reason');
    },
  },
  {
    name: 'evaluateVendorSyncNeed: 版本与指纹均对齐 → 无需 sync',
    run: () => {
      const r = evaluateVendorSyncNeed({
        manifest: sampleManifest('0.1.0', 'hylyre-0.1.0-py3-none-any.whl', 'same'),
        pipVersion: '0.1.0',
        wheelSha256: 'same',
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
    name: 'evaluateVendorSyncNeed: wheel 文件 sha256 与 manifest 声明不一致',
    run: () => {
      const r = evaluateVendorSyncNeed({
        manifest: sampleManifest('0.1.0', 'hylyre-0.1.0-py3-none-any.whl', 'manifestsha'),
        pipVersion: '0.1.0',
        wheelSha256: 'filesha',
        cachedFingerprint: null,
      });
      assertTrue(r.manifestWheelMismatch, 'manifestWheelMismatch');
    },
  },
  {
    name: 'pickVendorWheelPath: 优先 manifest.wheel.filename',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hylyre-vendor-'));
      try {
        fs.writeFileSync(path.join(dir, 'hylyre-0.1.0-py3-none-any.whl'), 'old');
        fs.writeFileSync(path.join(dir, 'hylyre-0.2.0-py3-none-any.whl'), 'new');
        const picked = pickVendorWheelPath(
          dir,
          sampleManifest('0.1.0', 'hylyre-0.1.0-py3-none-any.whl', 'x'),
        );
        assertEq(picked, path.join(dir, 'hylyre-0.1.0-py3-none-any.whl'), 'picked');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'pickVendorWheelPath: 多 wheel 无 manifest 文件名时取最新版本',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hylyre-vendor-'));
      try {
        fs.writeFileSync(path.join(dir, 'hylyre-0.1.0-py3-none-any.whl'), 'old');
        fs.writeFileSync(path.join(dir, 'hylyre-0.2.0-py3-none-any.whl'), 'new');
        const picked = pickVendorWheelPath(dir, null);
        assertEq(picked, path.join(dir, 'hylyre-0.2.0-py3-none-any.whl'), 'picked latest');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'install fingerprint: 读写 venv 内 .hylyre-vendor-fingerprint.json',
    run: () => {
      const venv = fs.mkdtempSync(path.join(os.tmpdir(), 'hylyre-venv-'));
      try {
        const fp = fingerprintFromManifest(
          sampleManifest('0.2.0', 'hylyre-0.2.0-py3-none-any.whl', 'deadbeef'),
          'deadbeef',
        );
        writeInstallFingerprint(venv, fp);
        const read = readInstallFingerprint(venv);
        assertEq(read?.wheel_sha256, 'deadbeef', 'sha');
        assertEq(read?.manifest_version, '0.2.0', 'ver');
      } finally {
        fs.rmSync(venv, { recursive: true, force: true });
      }
    },
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
