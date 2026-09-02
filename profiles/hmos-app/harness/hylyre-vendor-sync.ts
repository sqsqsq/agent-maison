/**
 * Hylyre vendor 发布件（源码树 schema 2 / wheel schema 1）选型与「venv 对齐 vendor 发布件」
 * 判定（纯函数 + 少量 fs，供 device-test-run 与单测复用）。
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface HylyreVendorSourceFileEntry {
  path: string;
  sha256: string;
  size_bytes: number;
}

export interface HylyreVendorManifestShape {
  /** 1 = wheel 发布；2 = 明文源码树发布（wheel 字段可选） */
  schema: number;
  hylyre_version: string;
  wheel?: { filename: string; sha256: string; size_bytes: number };
  source?: {
    root: string;
    file_count: number;
    total_bytes: number;
    tree_sha256: string;
    files: HylyreVendorSourceFileEntry[];
  };
}

export interface HylyreInstallFingerprint {
  manifest_version: string;
  /** wheel 模式沿用；source 模式不写（legacy 指纹只有这两个 wheel 字段） */
  wheel_filename?: string;
  wheel_sha256?: string;
  /** 缺省视为 legacy wheel 指纹（一次性触发重装以进入新指纹形态） */
  artifact_kind?: 'wheel' | 'source';
  /** wheel=文件 sha256；source=tree_sha256（评审 3 P0：按声明清单口径） */
  artifact_sha256?: string;
  installed_at: string;
}

export type VendorSyncReason =
  | 'aligned'
  | 'version_mismatch'
  | 'artifact_sha256_changed'
  | 'artifact_kind_changed'
  | 'missing_install_fingerprint'
  | 'no_manifest';

export interface VendorSyncEvaluation {
  needsSync: boolean;
  reason: VendorSyncReason;
  /** 实测工件指纹与 manifest 声明不一致（发布件损坏/被篡改/半同步） */
  manifestArtifactMismatch: boolean;
}

export interface VendorInstallable {
  kind: 'wheel' | 'source';
  /** wheel=whl 文件绝对路径；source=src 目录绝对路径 */
  path: string;
}

const HYLYRE_WHEEL_RE = /^hylyre-(.+)-py3-none-any\.whl$/i;

/**
 * 剥 UTF-8 BOM（评审 4 P2）：Hylyre 侧 manifest 读写已容错 utf-8-sig；maison 裸
 * JSON.parse 遇 BOM 抛异常（schema 1 既有暴露一并治）。
 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * manifest 声明的相对路径安全判定（评审 5 P1：路径穿越）。仅接受 POSIX 相对路径：
 * 拒绝绝对路径、盘符、反斜杠歧义、空段、`.`/`..` 段。用于 files[].path 与 source.root。
 */
export function isSafeVendorRelPath(rel: string): boolean {
  if (typeof rel !== 'string' || rel.length === 0) return false;
  if (rel.includes('\\') || rel.includes('\0')) return false;
  if (rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) return false;
  const segments = rel.split('/');
  return segments.every(seg => seg !== '' && seg !== '.' && seg !== '..');
}

/**
 * schema 2 source 声明的完整形状校验（评审 5 P1）：root/每个 path 安全、path 唯一、
 * sha256 为 64 位 hex、size_bytes 为非负数、tree_sha256 为 64 位 hex。
 * 不合格的 manifest 一律按 corrupt 处理（调用方判 null，语义与坏 JSON 相同）。
 */
export function isValidVendorSourceDecl(
  source: HylyreVendorManifestShape['source'],
): source is NonNullable<HylyreVendorManifestShape['source']> {
  if (!source || typeof source !== 'object') return false;
  if (!isSafeVendorRelPath(source.root ?? '')) return false;
  if (!/^[0-9a-f]{64}$/i.test(source.tree_sha256 ?? '')) return false;
  if (!Array.isArray(source.files) || source.files.length === 0) return false;
  const seen = new Set<string>();
  for (const f of source.files) {
    if (!f || typeof f !== 'object') return false;
    if (!isSafeVendorRelPath(f.path)) return false;
    if (seen.has(f.path)) return false;
    seen.add(f.path);
    if (!/^[0-9a-f]{64}$/i.test(f.sha256 ?? '')) return false;
    if (typeof f.size_bytes !== 'number' || !Number.isFinite(f.size_bytes) || f.size_bytes < 0) {
      return false;
    }
  }
  return true;
}

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

/**
 * 按 manifest.source.files 声明清单复算 tree hash（Hylyre 需求 R3 同算法：POSIX 相对路径
 * 字节序升序 → 逐文件落盘字节 sha256 → 拼接 "<path>\n<sha256>\n" 整体 sha256）。
 * 评审 3 P0：刻意不做目录 walk——vendor 内意外杂物（__pycache__、编辑器临时文件）不入
 * hash、不假触发『发布件损坏』；『src 内未声明文件』的检测职责归 Hylyre --verify。
 * 声明文件缺失/不可读、或清单含不安全/重复路径（评审 5 P1）→ null
 * （半同步/损坏/畸形，由调用方按 mismatch 处理）。
 */
export function sha256TreeFromManifest(
  rootAbs: string,
  files: HylyreVendorSourceFileEntry[],
): string | null {
  const seen = new Set<string>();
  for (const f of files) {
    if (!isSafeVendorRelPath(f.path) || seen.has(f.path)) return null;
    seen.add(f.path);
  }
  const sorted = [...files].sort((a, b) =>
    Buffer.compare(Buffer.from(a.path, 'utf-8'), Buffer.from(b.path, 'utf-8')),
  );
  const parts: string[] = [];
  for (const f of sorted) {
    const abs = path.join(rootAbs, ...f.path.split('/'));
    let fileSha: string;
    try {
      fileSha = sha256FileHex(abs);
    } catch {
      return null;
    }
    parts.push(`${f.path}\n${fileSha}\n`);
  }
  return crypto
    .createHash('sha256')
    .update(Buffer.from(parts.join(''), 'utf-8'))
    .digest('hex')
    .toLowerCase();
}

function sha256BufferHex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex').toLowerCase();
}

/** 树 hash 不一致的定性（只诊断，不放行；门禁仍按落盘原始字节判 mismatch）。 */
export type VendorTreeMismatchKind = 'eol_rewritten' | 'corrupted';

/**
 * 树 hash 不一致时逐文件定性：原始字节等于声明 → 无差异；原始不等、不含 NUL、且
 * CRLF→LF 归一化后等于声明 → 行尾改写；其余任何不等（缺失 / 内容篡改 / 二进制）→ 损坏。
 * 全部差异都是行尾改写才返回 'eol_rewritten'——真篡改叠加 CRLF 仍是 'corrupted'。
 * 唯一已知成因：宿主 Git checkout 对 framework/ 路径做了行尾转换（Windows 默认 `core.autocrlf=true`）
 * 把 LF 改写成 CRLF。此时"重新同步 vendor"只会在下次 checkout 再次翻转，须改宿主 `.gitattributes`
 * （`framework/** -text`）。归一化结果**不**用于放行：安装暂存复制的是落盘原始字节，
 * 按归一化放行等于把未经验真的字节送进 PEP 517（codex review P1）。
 */
export function diagnoseVendorTreeMismatch(
  rootAbs: string,
  files: HylyreVendorSourceFileEntry[],
): VendorTreeMismatchKind {
  let eolRewritten = 0;
  for (const f of files) {
    if (!isSafeVendorRelPath(f.path)) return 'corrupted';
    let raw: Buffer;
    try {
      raw = fs.readFileSync(path.join(rootAbs, ...f.path.split('/')));
    } catch {
      return 'corrupted';
    }
    const declared = (f.sha256 ?? '').toLowerCase();
    if (sha256BufferHex(raw) === declared) continue;
    if (raw.includes(0) || !raw.includes('\r\n')) return 'corrupted';
    const normalized = Buffer.from(raw.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
    if (sha256BufferHex(normalized) !== declared) return 'corrupted';
    eolRewritten += 1;
  }
  return eolRewritten > 0 ? 'eol_rewritten' : 'corrupted';
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

/**
 * 选取可安装 vendor 发布件：schema 2 且 src/ 在场 → 源码树（双存时源码优先）；
 * schema 2 但 src/ 缺失 → **仅当 manifest.wheel 字段在场**（sha 可验真）才回落 wheel，
 * 否则 null（评审 3 P1：禁止静默回落到无 manifest 背书的旧 whl——版本可能恰好相同、
 * 零告警装错件）；schema 1 / 无 manifest 维持既有 pickVendorWheelPath 行为。
 */
export function pickVendorInstallable(
  vendorDirAbs: string,
  manifest: HylyreVendorManifestShape | null,
): VendorInstallable | null {
  if (manifest && manifest.schema === 2 && manifest.source) {
    // 畸形 source 声明（不安全 root/path、重复条目等）按 corrupt 处理，不落 wheel 扫描
    if (!isValidVendorSourceDecl(manifest.source)) return null;
    const srcRoot = path.join(vendorDirAbs, manifest.source.root || 'src');
    try {
      if (fs.statSync(srcRoot).isDirectory()) {
        return { kind: 'source', path: srcRoot };
      }
    } catch {
      /* src 缺失，走下方回落判定 */
    }
    if (manifest.wheel?.filename) {
      const wheel = pickVendorWheelPath(vendorDirAbs, manifest);
      if (wheel) return { kind: 'wheel', path: wheel };
    }
    return null;
  }
  const wheel = pickVendorWheelPath(vendorDirAbs, manifest);
  return wheel ? { kind: 'wheel', path: wheel } : null;
}

/**
 * source 安装暂存：先清空整个 buildBaseAbs（评审 3 P2：上次残留自愈），再按声明清单
 * 逐文件拷贝到 <buildBaseAbs>/<version>-<treeSha256 前 8>/（杂物天然不入副本）。
 * 动机：pip ≥21.3 对目录是 in-tree build，直接对 vendor src 安装会在其中产
 * build/、*.egg-info/ 污染仓库——安装目标必须是临时副本。拷贝失败抛出由调用方接。
 */
export function stageVendorSourceForInstall(args: {
  srcRootAbs: string;
  buildBaseAbs: string;
  version: string;
  treeSha256: string;
  files: HylyreVendorSourceFileEntry[];
}): string {
  // 评审 5 P1：路径穿越硬拒——不安全清单一律抛出，绝不向 dest 之外写入
  for (const f of args.files) {
    if (!isSafeVendorRelPath(f.path)) {
      throw new Error(`unsafe vendor source path in manifest: ${f.path}`);
    }
  }
  // 评审 6 P1：目录名只用已校验为 hex 的 tree hash——version 是 manifest 自由文本，
  // 拼入路径可携带 `../` 逃逸 build-src
  if (!/^[0-9a-f]{16,64}$/i.test(args.treeSha256)) {
    throw new Error(`invalid tree sha for staging dir: ${args.treeSha256}`);
  }
  try {
    fs.rmSync(args.buildBaseAbs, { recursive: true, force: true });
  } catch {
    /* best-effort：删不掉的残留留给下次；本次仍写入独立子目录 */
  }
  const dest = path.join(args.buildBaseAbs, `artifact-${args.treeSha256.slice(0, 12)}`);
  for (const f of args.files) {
    const from = path.join(args.srcRootAbs, ...f.path.split('/'));
    const to = path.join(dest, ...f.path.split('/'));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  return dest;
}

export function readInstallFingerprint(venvRoot: string): HylyreInstallFingerprint | null {
  const fpPath = path.join(venvRoot, '.hylyre-vendor-fingerprint.json');
  if (!fs.existsSync(fpPath)) return null;
  try {
    const j = JSON.parse(
      stripBom(fs.readFileSync(fpPath, 'utf-8')),
    ) as HylyreInstallFingerprint;
    if (
      typeof j.manifest_version === 'string' &&
      (typeof j.wheel_sha256 === 'string' || typeof j.artifact_sha256 === 'string')
    ) {
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
 * manifest 对**所选工件形态**声明的指纹（评审 5 P1：按 artifactKind 取——schema 2 的
 * wheel 回落必须与 manifest.wheel.sha256 比对，拿 tree_sha256 比 wheel 文件必然假损坏）。
 */
export function manifestDeclaredArtifactSha(
  manifest: HylyreVendorManifestShape,
  artifactKind: VendorInstallable['kind'],
): string {
  if (artifactKind === 'source') {
    return (manifest.source?.tree_sha256 ?? '').trim().toLowerCase();
  }
  return (manifest.wheel?.sha256 ?? '').trim().toLowerCase();
}

/**
 * 判定默认 venv 是否需 pip 对齐 vendor 发布件。
 * artifactSha256=实测工件指纹（wheel 文件 sha256 / 源码树按声明清单复算的 tree hash）。
 */
export function evaluateVendorSyncNeed(args: {
  manifest: HylyreVendorManifestShape | null;
  pipVersion: string;
  artifactKind: 'wheel' | 'source';
  artifactSha256: string;
  cachedFingerprint: HylyreInstallFingerprint | null;
}): VendorSyncEvaluation {
  const { manifest, pipVersion, artifactKind, artifactSha256, cachedFingerprint } = args;
  if (!manifest) {
    return { needsSync: false, reason: 'no_manifest', manifestArtifactMismatch: false };
  }

  const declaredSha = manifestDeclaredArtifactSha(manifest, artifactKind);
  const artifactSha = artifactSha256.trim().toLowerCase();
  const manifestArtifactMismatch =
    Boolean(declaredSha && artifactSha && declaredSha !== artifactSha);

  const manifestVer = manifest.hylyre_version.trim();
  const pipVer = pipVersion.trim();

  if (manifestVer && pipVer && manifestVer !== pipVer) {
    return { needsSync: true, reason: 'version_mismatch', manifestArtifactMismatch };
  }

  // 发布形态切换（wheel→source / source→wheel）：指纹形态不同即重装；legacy 指纹
  // （无 artifact_kind）视为 wheel——遇 source 发布一次性重装进入新指纹形态。
  if (cachedFingerprint && (cachedFingerprint.artifact_kind ?? 'wheel') !== artifactKind) {
    return { needsSync: true, reason: 'artifact_kind_changed', manifestArtifactMismatch };
  }

  const cachedSha = (cachedFingerprint?.artifact_sha256 ?? cachedFingerprint?.wheel_sha256 ?? '')
    .trim()
    .toLowerCase();
  if (artifactSha && cachedSha) {
    if (cachedSha !== artifactSha) {
      return { needsSync: true, reason: 'artifact_sha256_changed', manifestArtifactMismatch };
    }
    if (manifestVer && pipVer && manifestVer === pipVer) {
      return { needsSync: false, reason: 'aligned', manifestArtifactMismatch };
    }
  }

  // pip 版本号与 manifest 相同 ≠ venv 内工件与 vendor 一致（同版本补丁件、或无指纹的旧 venv）
  if (artifactSha && manifestVer && pipVer && manifestVer === pipVer && !cachedFingerprint) {
    return { needsSync: true, reason: 'missing_install_fingerprint', manifestArtifactMismatch };
  }

  return { needsSync: false, reason: 'aligned', manifestArtifactMismatch };
}

export function fingerprintFromManifest(
  manifest: HylyreVendorManifestShape,
  artifactSha256: string,
  artifactKind: 'wheel' | 'source' = 'wheel',
): HylyreInstallFingerprint {
  const sha = artifactSha256.trim().toLowerCase();
  return {
    manifest_version: manifest.hylyre_version,
    ...(artifactKind === 'wheel' && manifest.wheel
      ? { wheel_filename: manifest.wheel.filename, wheel_sha256: sha }
      : {}),
    artifact_kind: artifactKind,
    artifact_sha256: sha,
    installed_at: new Date().toISOString(),
  };
}
