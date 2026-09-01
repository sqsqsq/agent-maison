// framework-integrity.ts — 发布件身份读取与通用文本 EOL helper
// ---------------------------------------------------------------------------
// 3.0.0（plan c3d8e1f6）：普通 init/phase 的 runtime hash 与宿主 Git 裁决全部退场。
// 本模块不读取 Git、不遍历 manifest.files、不比较落盘发布树，只读取现有发布件身份字段
// 供 check-init / visual-feedback 非阻断呈现。发布件完整性仍只在 pack/release verify 与
// 用户明确触发的 updater/集成边界校验。
import * as fs from 'fs';
import * as path from 'path';
import type { CheckResult } from './types';

const MANIFEST_NAME = 'RELEASE-MANIFEST.json';
const MANIFEST_SHA_NAME = 'RELEASE-MANIFEST.sha256';
const SHA256_RE = /^[0-9a-f]{64}$/;

interface IntegrityManifest {
  schema_version?: string;
  version?: string;
  source_commit?: string;
  built_at?: string;
  files?: Array<{ path: string; sha256: string }>;
}

export type FrameworkPackageIdentityState = 'valid' | 'corrupt' | 'absent';

export interface FrameworkPackageIdentity {
  /** manifest 在场且可解析=valid；在场但解析失败=corrupt；不存在=absent。 */
  state: FrameworkPackageIdentityState;
  version: string;
  source_commit: string;
  built_at: string;
  /** 直接读取既有 sidecar 的 manifest SHA 声明；缺失/非法时为 unknown。 */
  manifest_sha256: string;
  /** corrupt 时的 manifest 解析错误；valid/absent 为 null。 */
  error: string | null;
}

/**
 * 包内 RELEASE-MANIFEST.json 的唯一装载器。它只解析 identity 文档，不消费 files[]
 * 做落盘树校验。区分 absent / corrupt / valid，避免把坏 manifest 误报 source layout。
 */
export function loadReleaseManifest(frameworkRoot: string): {
  state: FrameworkPackageIdentityState;
  doc: IntegrityManifest | null;
  raw: Buffer | null;
  error: string | null;
} {
  const manifestPath = path.join(frameworkRoot, MANIFEST_NAME);
  if (!fs.existsSync(manifestPath)) return { state: 'absent', doc: null, raw: null, error: null };
  let raw: Buffer;
  try {
    raw = fs.readFileSync(manifestPath);
  } catch (e) {
    return { state: 'corrupt', doc: null, raw: null, error: (e as Error).message };
  }
  let doc: unknown;
  try {
    doc = JSON.parse(raw.toString('utf-8'));
  } catch (e) {
    return { state: 'corrupt', doc: null, raw: null, error: (e as Error).message };
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { state: 'corrupt', doc: null, raw: null, error: 'manifest 根节点非对象' };
  }
  return { state: 'valid', doc: doc as IntegrityManifest, raw, error: null };
}

/** 直接读取 sidecar 声明值；不得对 sidecar 文本再做 sha256。 */
export function readFrameworkManifestSha256(frameworkRoot: string): string {
  try {
    const value = fs.readFileSync(path.join(frameworkRoot, MANIFEST_SHA_NAME), 'utf-8').trim();
    return SHA256_RE.test(value) ? value : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * 读取发布包身份。字段仅用于呈现/provenance，不参与普通 phase verdict。
 * source_commit 是 Maison 打包源提交，不是宿主 HEAD；manifest_sha256 是 sidecar 声明值。
 */
export function readFrameworkPackageIdentity(frameworkRoot: string): FrameworkPackageIdentity {
  const loaded = loadReleaseManifest(frameworkRoot);
  const manifest_sha256 = readFrameworkManifestSha256(frameworkRoot);
  if (loaded.state === 'absent') {
    return {
      state: 'absent',
      version: 'unknown',
      source_commit: 'unknown',
      built_at: 'unknown',
      manifest_sha256,
      error: null,
    };
  }
  if (loaded.state === 'corrupt' || !loaded.doc) {
    return {
      state: 'corrupt',
      version: 'unknown',
      source_commit: 'unknown',
      built_at: 'unknown',
      manifest_sha256,
      error: loaded.error ?? 'manifest 解析失败',
    };
  }
  const strField = (v: unknown): string =>
    typeof v === 'string' && v.trim().length > 0 ? v.trim() : 'unknown';
  return {
    state: 'valid',
    version: strField(loaded.doc.version),
    source_commit: strField(loaded.doc.source_commit),
    built_at: strField(loaded.doc.built_at),
    manifest_sha256,
    error: null,
  };
}

/** package identity 的非阻断 CheckResult。 */
export function buildFrameworkIdentityResult(identity: FrameworkPackageIdentity): CheckResult {
  const base = {
    id: 'framework_identity',
    category: 'structure' as const,
    description: 'framework 发布包身份（manifest/sidecar）',
    severity: 'MINOR' as const,
  };
  if (identity.state === 'absent') {
    return {
      ...base,
      status: 'SKIP' as const,
      details:
        `未发现包内 ${MANIFEST_NAME}（source/dev layout）；` +
        '发布件集成后可呈现 version/source_commit/built_at/manifest_sha256。',
    };
  }
  if (identity.state === 'corrupt') {
    return {
      ...base,
      status: 'WARN' as const,
      details:
        `包内 ${MANIFEST_NAME} 存在但解析失败（identity 无法读取）：${identity.error ?? '未知错误'}。` +
        `manifest_sha256=${identity.manifest_sha256}。包完整性由 Maison 发布与明确集成边界校验，不在此处裁决。`,
    };
  }
  const legacyNote =
    identity.source_commit === 'unknown' ||
    identity.built_at === 'unknown' ||
    identity.manifest_sha256 === 'unknown'
      ? '（旧包或缺 identity 字段，如实显示 unknown）'
      : '';
  return {
    ...base,
    status: 'PASS' as const,
    details:
      `version=${identity.version} source_commit=${identity.source_commit} ` +
      `built_at=${identity.built_at} manifest_sha256=${identity.manifest_sha256}${legacyNote}`,
  };
}

/** 身份摘要行（非阻断原样呈现）。 */
export function formatFrameworkPackageIdentity(identity: FrameworkPackageIdentity): string {
  if (identity.state === 'absent') {
    return 'framework 包身份: 未找到发布件 RELEASE-MANIFEST.json（source/dev layout）';
  }
  if (identity.state === 'corrupt') {
    return (
      `framework 包身份: RELEASE-MANIFEST.json 解析失败（${identity.error ?? '未知错误'}） ` +
      `manifest_sha256=${identity.manifest_sha256}`
    );
  }
  const legacy =
    identity.source_commit === 'unknown' ||
    identity.built_at === 'unknown' ||
    identity.manifest_sha256 === 'unknown'
      ? '（legacy/unknown）'
      : '';
  return (
    `framework 包身份: version=${identity.version} source_commit=${identity.source_commit} ` +
    `built_at=${identity.built_at} manifest_sha256=${identity.manifest_sha256}${legacy}`
  );
}

/**
 * 通用文本 EOL 归一（CRLF 与孤立 CR 均归 LF）。仍由确认 UX 等链路复用；
 * 与已退役的 consumer per-file hash 无关。
 */
export function normalizeIntegrityTextEol(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}
