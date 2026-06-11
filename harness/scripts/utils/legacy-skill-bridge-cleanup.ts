// legacy-skill-bridge-cleanup.ts — v2.3 前编号 skill 跳板 SSOT 与 backup_delete

import * as fs from 'fs';
import * as path from 'path';

import type { FrameworkConfig } from '../../config';
import type { InitMode } from '../check-init';
import { validateAgentBundleRoot, type ResolvedAgentBundlePaths } from './agent-bundle-paths';
import type { CleanupResult } from './init-sync-telemetry';

export const LEGACY_NUMBERED_SKILL_BRIDGE_IDS = [
  '00-framework-init',
  '0-catalog-bootstrap',
  '1-spec',
  '2-plan',
  '3-coding',
  '4-code-review',
  '5-business-ut',
  '6-device-testing',
  '00b-framework-setup',
] as const;

export type LegacyNumberedSkillBridgeId = (typeof LEGACY_NUMBERED_SKILL_BRIDGE_IDS)[number];

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

function assertSafeProjectRelativePath(projectRoot: string, relPosix: string): string {
  const normalized = toPosix(relPosix).replace(/\/+$/, '');
  if (!normalized || normalized.includes('..') || path.isAbsolute(normalized)) {
    throw new Error(`[legacy-skill-bridge] 非法相对路径: ${relPosix}`);
  }
  const absPath = path.resolve(projectRoot, normalized);
  const rel = path.relative(projectRoot, absPath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`[legacy-skill-bridge] 路径越界: ${relPosix}`);
  }
  return absPath;
}

function ensureBackupDir(projectRoot: string, session: BackupSession): string {
  if (!session.backupRelDir) {
    session.backupRelDir = `.framework-backup/${session.stamp}`;
    fs.mkdirSync(path.join(projectRoot, session.backupRelDir), { recursive: true });
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
  const skillModeRaw = paths.agent_bundle_skill_mode;
  const skillMode =
    skillModeRaw === 'inline' || skillModeRaw === 'bridge' ? skillModeRaw : 'bridge';
  const posixRoot = root.replace(/\\/g, '/');
  return {
    root: posixRoot,
    skillsDir: `${posixRoot}/skills`,
    rulesDir: `${posixRoot}/rules`,
    skillMode,
  };
}

function legacyRelPathForAdapter(
  adapter: string,
  legacyId: string,
  config: FrameworkConfig,
): string | null {
  const name = adapter.trim().toLowerCase();
  if (name === 'cursor') {
    return `.cursor/skills/${legacyId}/`;
  }
  if (name === 'claude') {
    return `.claude/commands/${legacyId}.md`;
  }
  if (name === 'generic') {
    const bundle = readGenericBundlePathsFromConfigPaths(config.paths);
    return `${bundle.skillsDir}/${legacyId}/`;
  }
  return null;
}

export function collectLegacySkillBridgePaths(
  opts: LegacySkillBridgeCleanupOptions,
): LegacySkillBridgePath[] {
  const out: LegacySkillBridgePath[] = [];
  const seenAdapters = new Set<string>();
  for (const raw of opts.materializedAdapters) {
    const adapter = raw.trim();
    if (!adapter || seenAdapters.has(adapter)) continue;
    seenAdapters.add(adapter);
    for (const legacyId of LEGACY_NUMBERED_SKILL_BRIDGE_IDS) {
      const relPosix = legacyRelPathForAdapter(adapter, legacyId, opts.config);
      if (!relPosix) continue;
      out.push({ adapter, relPosix: toPosix(relPosix), legacyId });
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
  let count = 0;
  for (const entry of paths) {
    const absPath = assertSafeProjectRelativePath(projectRoot, entry.relPosix);
    if (!fs.existsSync(absPath)) continue;
    count++;
    if (samples.length < 5) samples.push(entry.relPosix);
  }
  return { count, samples };
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
      const backupAbs = path.join(opts.projectRoot, backupRelDir, entry.relPosix);
      copyPathRecursive(absPath, backupAbs);
    } else {
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
      backupRelDir = `.framework-backup/${stamp}`;
      fs.mkdirSync(path.join(opts.projectRoot, backupRelDir), { recursive: true });
      const backupAbs = path.join(opts.projectRoot, backupRelDir, entry.relPosix);
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
