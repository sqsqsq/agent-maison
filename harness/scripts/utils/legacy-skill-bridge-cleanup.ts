// legacy-skill-bridge-cleanup.ts — 遗留 skill 跳板 SSOT 与 backup_delete

import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';

import type { FrameworkConfig } from '../../config';
import { resolveProbeFrameworkRoot } from '../../repo-layout';
import type { InitMode } from '../check-init';
import { validateAgentBundleRoot, type ResolvedAgentBundlePaths } from './agent-bundle-paths';
import { isInsideProjectRoot } from './project-relative-path';
import type { CleanupResult } from './init-sync-telemetry';

export const LEGACY_SKILL_BRIDGE_IDS = [
  // 设计入口已收敛至 component-design；P1 仅作内部工作流。
  'app-component-blueprint',
  // 00 / 0 前缀
  '00-framework-init',
  '0-catalog-bootstrap',
  '00b-framework-setup',
  // 1–6 编号（v2.3 扁平化前）
  '1-spec',
  '2-plan',
  '3-coding',
  '4-code-review',
  '5-business-ut',
  '6-device-testing',
  // 语义旧名（v2.3 前 prd/design 阶段）
  'prd-design',
  'requirement-design',
  // 编号旧名（v2.3 前 prd/design 阶段）
  '1-prd-design',
  '2-requirement-design',
  'framework-setup',
  'goal-orchestration',
  'app-component-blueprint',
  'ut-audit',
] as const;

export type LegacySkillBridgeId = (typeof LEGACY_SKILL_BRIDGE_IDS)[number];

export interface BackupSession {
  stamp: string;
  backupRelDir?: string;
}

export interface LegacySkillBridgeCleanupOptions {
  projectRoot: string;
  materializedAdapters: string[];
  mode: InitMode;
  config: FrameworkConfig;
  backupSession?: BackupSession;
}

export interface LegacySkillBridgePath {
  adapter: string;
  relPosix: string;
  legacyId: string;
}

export interface LegacySkillBridgePresence {
  count: number;
  samples: string[];
  /** 只读探测中无法判定的路径（junction/symlink 越界等）；S3 删除时会抛错并按 adapter 记 failed */
  skipped: Array<{ relPosix: string; reason: string }>;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function copyPathRecursive(srcAbs: string, destAbs: string): void {
  const st = fs.statSync(srcAbs);
  if (st.isDirectory()) {
    fs.mkdirSync(destAbs, { recursive: true });
    for (const ent of fs.readdirSync(srcAbs, { withFileTypes: true })) {
      copyPathRecursive(path.join(srcAbs, ent.name), path.join(destAbs, ent.name));
    }
    return;
  }
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  fs.copyFileSync(srcAbs, destAbs);
}

function removePathRecursive(abs: string): void {
  if (!fs.existsSync(abs)) return;
  fs.rmSync(abs, { recursive: true, force: true });
}

export function assertSafeProjectRelativePath(projectRoot: string, relPosix: string): string {
  const normalized = toPosix(relPosix).replace(/\/+$/, '');
  if (!normalized || normalized.includes('..') || path.isAbsolute(normalized)) {
    throw new Error(`[legacy-skill-bridge] 非法相对路径: ${relPosix}`);
  }
  const absPath = path.resolve(projectRoot, normalized);
  if (absPath === path.resolve(projectRoot) || !isInsideProjectRoot(projectRoot, absPath)) {
    throw new Error(`[legacy-skill-bridge] 路径越界: ${relPosix}`);
  }
  // 删除/备份前检查现存祖先，禁止经 symlink/junction 越出宿主。
  let existing = absPath;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  if (!isInsideProjectRoot(fs.realpathSync(projectRoot), fs.realpathSync(existing))) {
    throw new Error(`[legacy-skill-bridge] 实际路径越界: ${relPosix}`);
  }
  return absPath;
}

function ensureBackupDir(projectRoot: string, session: BackupSession): string {
  if (!session.backupRelDir) {
    session.backupRelDir = `.framework-backup/${session.stamp}`;
    fs.mkdirSync(assertSafeProjectRelativePath(projectRoot, session.backupRelDir), { recursive: true });
  }
  return session.backupRelDir;
}

/** 多 adapter 场景：不依赖 active agent_adapter */
export function readGenericBundlePathsFromConfigPaths(
  paths: FrameworkConfig['paths'],
): ResolvedAgentBundlePaths {
  const root =
    typeof paths.agent_bundle_root === 'string' && paths.agent_bundle_root.trim()
      ? paths.agent_bundle_root.trim()
      : '.agents';
  validateAgentBundleRoot(root);
  // inline 已彻底废弃：config 中的 agent_bundle_skill_mode 一律解析为 bridge（与 normalizeAgentBundleSkillMode 对齐）。
  const skillMode = 'bridge' as const;
  const posixRoot = root.replace(/\\/g, '/');
  return {
    root: posixRoot,
    skillsDir: `${posixRoot}/skills`,
    rulesDir: `${posixRoot}/rules`,
    skillMode,
  };
}

/** 路径来自物化声明；不另维护 adapter → 目录映射。 */
function legacyTargetsForAdapter(
  adapter: string,
  config: FrameworkConfig,
  projectRoot: string,
): Array<{ dir: string; suffix: string }> {
  if (adapter === 'generic') {
    return [{ dir: readGenericBundlePathsFromConfigPaths(config.paths).skillsDir, suffix: '/' }];
  }
  const frameworkRoot = resolveProbeFrameworkRoot(projectRoot, path.resolve(__dirname, '../..'));
  const yamlPath = path.join(frameworkRoot, 'agents', adapter, 'adapter.yaml');
  if (!fs.existsSync(yamlPath)) return [];
  const cfg = YAML.parse(fs.readFileSync(yamlPath, 'utf-8'));
  return [
    { dir: cfg?.skill_bridge?.target_dir, suffix: '/' },
    { dir: cfg?.commands?.target_dir, suffix: '.md' },
  ].filter((target): target is { dir: string; suffix: string } => typeof target.dir === 'string');
}

export function collectLegacySkillBridgePaths(
  opts: LegacySkillBridgeCleanupOptions,
): LegacySkillBridgePath[] {
  const out: LegacySkillBridgePath[] = [];
  const seenPaths = new Set<string>();
  for (const raw of opts.materializedAdapters) {
    const adapter = raw.trim();
    if (!adapter) continue;
    for (const target of legacyTargetsForAdapter(adapter, opts.config, opts.projectRoot)) {
      for (const legacyId of LEGACY_SKILL_BRIDGE_IDS) {
        const relPosix = toPosix(target.dir + '/' + legacyId + target.suffix);
        if (seenPaths.has(relPosix)) continue;
        seenPaths.add(relPosix);
        out.push({ adapter, relPosix, legacyId });
      }
    }
  }
  return out;
}

export function detectLegacySkillBridgePresence(
  projectRoot: string,
  config: FrameworkConfig,
  materializedAdapters: string[],
): LegacySkillBridgePresence {
  const paths = collectLegacySkillBridgePaths({
    projectRoot,
    materializedAdapters,
    mode: 'update',
    config,
  });
  const samples: string[] = [];
  const skipped: LegacySkillBridgePresence['skipped'] = [];
  let count = 0;
  for (const entry of paths) {
    // 只读探测不得因单条路径不可判定（junction/symlink 越界等）整体失败——否则 S1 生不出计划。
    // 删除路径 applyLegacySkillBridgeCleanup 仍然抛错，安全锚不变。
    let absPath: string;
    try {
      absPath = assertSafeProjectRelativePath(projectRoot, entry.relPosix);
    } catch (e) {
      skipped.push({ relPosix: entry.relPosix, reason: (e as Error).message });
      continue;
    }
    if (!fs.existsSync(absPath)) continue;
    count++;
    if (samples.length < 5) samples.push(entry.relPosix);
  }
  return { count, samples, skipped };
}

export function applyLegacySkillBridgeCleanup(
  opts: LegacySkillBridgeCleanupOptions,
): { cleaned: CleanupResult[]; backupRelDir: string | null } {
  const cleaned: CleanupResult[] = [];
  if (opts.mode !== 'update') {
    return { cleaned, backupRelDir: null };
  }

  const session = opts.backupSession;
  let backupRelDir: string | null = session?.backupRelDir ?? null;

  for (const entry of collectLegacySkillBridgePaths(opts)) {
    const absPath = assertSafeProjectRelativePath(opts.projectRoot, entry.relPosix);
    if (!fs.existsSync(absPath)) continue;

    if (session) {
      backupRelDir = ensureBackupDir(opts.projectRoot, session);
      const backupAbs = assertSafeProjectRelativePath(opts.projectRoot, `${backupRelDir}/${entry.relPosix}`);
      copyPathRecursive(absPath, backupAbs);
    } else {
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
      backupRelDir = `.framework-backup/${stamp}`;
      const backupAbs = assertSafeProjectRelativePath(opts.projectRoot, `${backupRelDir}/${entry.relPosix}`);
      copyPathRecursive(absPath, backupAbs);
    }

    removePathRecursive(absPath);
    const backupPath = backupRelDir ? toPosix(path.join(backupRelDir, entry.relPosix)) : undefined;
    cleaned.push({
      path: entry.relPosix,
      backup_path: backupPath,
      kind: 'legacy_skill_bridge',
      adapter: entry.adapter,
      legacy_id: entry.legacyId,
    });
    process.stderr.write(
      `[legacy-skill-bridge] backup_delete: ${entry.relPosix} → ${backupPath ?? '(no backup)'}\n`,
    );
  }

  return { cleaned, backupRelDir: session?.backupRelDir ?? backupRelDir };
}
