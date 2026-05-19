/**
 * Hylyre vendor wheel 选型与「venv 对齐 vendor 发布件」判定（纯函数，供 device-test-run 与单测复用）。
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface HylyreVendorManifestShape {
  schema: number;
  hylyre_version: string;
  wheel: { filename: string; sha256: string; size_bytes: number };
}

export interface HylyreInstallFingerprint {
  manifest_version: string;
  wheel_filename: string;
  wheel_sha256: string;
  installed_at: string;
}

export type VendorSyncReason =
  | 'aligned'
  | 'version_mismatch'
  | 'wheel_sha256_changed'
  | 'missing_install_fingerprint'
  | 'missing_fingerprint_with_version_mismatch'
  | 'no_manifest';

export interface VendorSyncEvaluation {
  needsSync: boolean;
  reason: VendorSyncReason;
  /** vendor 目录 wheel 文件 sha256 与 manifest 声明不一致（发布包损坏） */
  manifestWheelMismatch: boolean;
}

const HYLYRE_WHEEL_RE = /^hylyre-(.+)-py3-none-any\.whl$/i;

/** 从 wheel 文件名解析 semver 片段（用于多 wheel 并存时排序）。 */
export function parseHylyreVersionFromWheelFilename(filename: string): string | null {
  const base = path.basename(filename);
  const m = base.match(HYLYRE_WHEEL_RE);
  return m ? m[1].trim() : null;
}

/** 计算文件 sha256（hex，小写）。 */
export function sha256FileHex(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex').toLowerCase();
}

function compareSemverLike(a: string, b: string): number {
  const pa = a.split(/[.-]/).map(x => (/^\d+$/.test(x) ? parseInt(x, 10) : x));
  const pb = b.split(/[.-]/).map(x => (/^\d+$/.test(x) ? parseInt(x, 10) : x));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va === vb) continue;
    if (typeof va === 'number' && typeof vb === 'number') return va < vb ? -1 : 1;
    return String(va).localeCompare(String(vb));
  }
  return 0;
}

/**
 * 在 vendor 目录选取 wheel：优先 manifest.wheel.filename，否则按文件名内版本取最新。
 */
export function pickVendorWheelPath(
  vendorDirAbs: string,
  manifest: HylyreVendorManifestShape | null,
): string | null {
  if (!fs.existsSync(vendorDirAbs)) return null;

  if (manifest?.wheel?.filename) {
    const preferred = path.join(vendorDirAbs, manifest.wheel.filename);
    if (fs.existsSync(preferred)) return preferred;
  }

  const wheels = fs
    .readdirSync(vendorDirAbs)
    .filter(f => f.startsWith('hylyre-') && f.endsWith('.whl'))
    .sort((a, b) => {
      const va = parseHylyreVersionFromWheelFilename(a) ?? a;
      const vb = parseHylyreVersionFromWheelFilename(b) ?? b;
      return compareSemverLike(vb, va);
    });

  if (wheels.length === 0) return null;
  return path.join(vendorDirAbs, wheels[0]);
}

export function readInstallFingerprint(venvRoot: string): HylyreInstallFingerprint | null {
  const fpPath = path.join(venvRoot, '.hylyre-vendor-fingerprint.json');
  if (!fs.existsSync(fpPath)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(fpPath, 'utf-8')) as HylyreInstallFingerprint;
    if (typeof j.wheel_sha256 === 'string' && typeof j.manifest_version === 'string') {
      return j;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeInstallFingerprint(venvRoot: string, fp: HylyreInstallFingerprint): void {
  const fpPath = path.join(venvRoot, '.hylyre-vendor-fingerprint.json');
  fs.writeFileSync(fpPath, JSON.stringify(fp, null, 2), 'utf-8');
}

/**
 * 判定默认 venv 是否需 pip 对齐 vendor 发布件。
 */
export function evaluateVendorSyncNeed(args: {
  manifest: HylyreVendorManifestShape | null;
  pipVersion: string;
  wheelSha256: string;
  cachedFingerprint: HylyreInstallFingerprint | null;
}): VendorSyncEvaluation {
  const { manifest, pipVersion, wheelSha256, cachedFingerprint } = args;
  if (!manifest) {
    return { needsSync: false, reason: 'no_manifest', manifestWheelMismatch: false };
  }

  const manifestSha = (manifest.wheel?.sha256 ?? '').trim().toLowerCase();
  const wheelSha = wheelSha256.trim().toLowerCase();
  const manifestWheelMismatch =
    Boolean(manifestSha && wheelSha && manifestSha !== wheelSha);

  const manifestVer = manifest.hylyre_version.trim();
  const pipVer = pipVersion.trim();

  if (manifestVer && pipVer && manifestVer !== pipVer) {
    return { needsSync: true, reason: 'version_mismatch', manifestWheelMismatch };
  }

  if (wheelSha && cachedFingerprint?.wheel_sha256) {
    const cachedSha = cachedFingerprint.wheel_sha256.trim().toLowerCase();
    if (cachedSha !== wheelSha) {
      return { needsSync: true, reason: 'wheel_sha256_changed', manifestWheelMismatch };
    }
    if (manifestVer && pipVer && manifestVer === pipVer) {
      return { needsSync: false, reason: 'aligned', manifestWheelMismatch };
    }
  }

  // pip 版本号与 manifest 相同 ≠ venv 内 wheel 与 vendor 一致（同版本补丁 wheel、或无指纹的旧 venv）
  if (wheelSha && manifestVer && pipVer && manifestVer === pipVer && !cachedFingerprint) {
    return { needsSync: true, reason: 'missing_install_fingerprint', manifestWheelMismatch };
  }

  return { needsSync: false, reason: 'aligned', manifestWheelMismatch };
}

export function fingerprintFromManifest(
  manifest: HylyreVendorManifestShape,
  wheelSha256: string,
): HylyreInstallFingerprint {
  return {
    manifest_version: manifest.hylyre_version,
    wheel_filename: manifest.wheel.filename,
    wheel_sha256: wheelSha256.trim().toLowerCase(),
    installed_at: new Date().toISOString(),
  };
}
