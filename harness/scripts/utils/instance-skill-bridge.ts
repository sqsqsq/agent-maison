// ============================================================================
// instance-skill-bridge — 扫描 doc/extensions/skills 并生成 Cursor 跳板 / Claude slash
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { loadFrameworkConfig } from '../../config';
import { resolveGenericBundlePathsFromPaths } from './agent-bundle-paths';
import {
  materializeInlineSkillMarkdown,
  posixRelativeFromSkillStubTo,
  renderBridgeSkillStubMarkdown,
} from './materialize-agent-bundle-skills';
import { resolveSkillPathOrNull } from './resolve-skill-path';
import { isClaudeKernelAdapter } from './types';
import { validateProjectRelativePath } from './project-relative-path';

export interface ExtensionSkillScanRow {
  sourceSlug: string;
  skillMdAbs: string;
  /** POSIX 路径，相对于实例工程根 */
  skillMdRepoRel: string;
}

export interface ResolvedBridgeTarget {
  sourceSlug: string;
  bridgeId: string;
  conflict: boolean;
  skillMdRepoRel: string;
}

const SAFE_TOKEN = /^[a-zA-Z0-9_-]+$/;

export function sanitizeBridgeSlug(slug: string): string {
  const s = slug
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return s.length > 0 ? s : 'skill';
}

export function loadReservedBridgeIds(frameworkDir: string): Set<string> {
  const reserved = new Set<string>();
  const sharedBridge = path.join(
    frameworkDir,
    'agents',
    'shared',
    'agent-bundle',
    'templates',
    'skills-bridge',
  );
  if (fs.existsSync(sharedBridge)) {
    for (const ent of fs.readdirSync(sharedBridge, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        reserved.add(ent.name);
      }
    }
  }
  const claudeCmds = path.join(frameworkDir, 'agents', 'claude', 'templates', 'commands');
  if (fs.existsSync(claudeCmds)) {
    for (const fn of fs.readdirSync(claudeCmds)) {
      if (fn.toLowerCase().endsWith('.md')) {
        reserved.add(fn.replace(/\.md$/i, ''));
      }
    }
  }
  return reserved;
}

export function scanExtensionSkills(
  projectRoot: string,
  extensionDirRel = 'doc/extensions',
  declaredSkillIds?: readonly string[],
): ExtensionSkillScanRow[] {
  let rel: string;
  try {
    rel = validateProjectRelativePath(projectRoot, extensionDirRel, 'paths.extension_dir');
  } catch {
    return [];
  }
  const extRoot = path.join(projectRoot, ...rel.split('/').filter(Boolean));
  const skillsRoot = path.join(extRoot, 'skills');
  if (!fs.existsSync(skillsRoot) || !fs.statSync(skillsRoot).isDirectory()) {
    return [];
  }
  const rows: ExtensionSkillScanRow[] = [];
  const declared = declaredSkillIds ? new Set(declaredSkillIds) : null;
  for (const ent of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!ent.isDirectory()) {
      continue;
    }
    const sourceSlug = ent.name;
    if (declared && !declared.has(sourceSlug)) continue;
    if (!SAFE_TOKEN.test(sourceSlug)) {
      continue;
    }
    const skillMdAbs = path.join(skillsRoot, sourceSlug, 'SKILL.md');
    if (!fs.existsSync(skillMdAbs) || !fs.statSync(skillMdAbs).isFile()) {
      continue;
    }
    const skillMdRepoRel = path.relative(projectRoot, skillMdAbs).replace(/\\/g, '/');
    rows.push({ sourceSlug, skillMdAbs, skillMdRepoRel });
  }
  return rows.sort((a, b) => a.sourceSlug.localeCompare(b.sourceSlug));
}

export function resolveBridgeTargets(
  rows: ExtensionSkillScanRow[],
  reserved: Set<string>,
): { targets: ResolvedBridgeTarget[]; warnings: string[] } {
  const warnings: string[] = [];
  const used = new Set<string>(reserved);
  const targets: ResolvedBridgeTarget[] = [];

  for (const row of rows) {
    const base = sanitizeBridgeSlug(row.sourceSlug);
    let bridgeId = base;
    let conflict = false;
    if (used.has(bridgeId)) {
      conflict = true;
      bridgeId = sanitizeBridgeSlug(`ext-${base}`);
      let i = 2;
      while (used.has(bridgeId)) {
        bridgeId = sanitizeBridgeSlug(`ext-${base}-${i}`);
        i++;
      }
      warnings.push(
        `[instance-skill-bridge] 扩展 skill 目录 "${row.sourceSlug}" 与框架预留标识冲突，已改用 bridge id "${bridgeId}"。`,
      );
    }
    used.add(bridgeId);
    targets.push({
      sourceSlug: row.sourceSlug,
      bridgeId,
      conflict,
      skillMdRepoRel: row.skillMdRepoRel,
    });
  }
  return { targets, warnings };
}

export function formatExtensionSkillSectionMarkdown(
  targets: ResolvedBridgeTarget[],
  manifestDriven = false,
): string {
  if (targets.length === 0) {
    return '';
  }
  const lines: string[] = [
    '',
    '### 实例扩展 Skill（doc/extensions）',
    '',
    manifestDriven
      ? '以下由 `render-agents-md` 按 manifest `provides.skills[]` 自动生成；若与框架内置 Skill 跳板 / slash **同名**，桥接产物会自动加 `ext-` 前缀（见标识列）。'
      : '以下由 `render-agents-md` 扫描 `doc/extensions/skills/*/SKILL.md` 自动生成；若与框架内置 Skill 跳板 / slash **同名**，桥接产物会自动加 `ext-` 前缀（见标识列）。',
    '',
    '| 标识 | Skill 路径 |',
    '|------|-----------|',
  ];
  for (const t of targets) {
    const label = t.conflict ? `\`${t.bridgeId}\`（原名 \`${t.sourceSlug}\`）` : `\`${t.bridgeId}\``;
    lines.push(`| ${label} | [${t.skillMdRepoRel}](${t.skillMdRepoRel}) |`);
  }
  lines.push('');
  return lines.join('\n');
}

export interface AdapterInstanceBridgeYaml {
  skill_stub_target_dir?: string;
  commands_target_dir?: string;
}

export function parseInstanceSkillBridgeFromAdapter(adapterYamlText: string): AdapterInstanceBridgeYaml | null {
  const doc = YAML.parse(adapterYamlText) as Record<string, unknown>;
  const raw = doc?.instance_skill_bridge;
  if (raw === undefined || raw === null) {
    return parseCommandsOnlyBridge(doc);
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const skill_stub_target_dir =
    typeof o.skill_stub_target_dir === 'string' ? o.skill_stub_target_dir.trim() : undefined;
  const commands_target_dir =
    typeof o.commands_target_dir === 'string' ? o.commands_target_dir.trim() : undefined;
  if (!skill_stub_target_dir && !commands_target_dir) {
    return parseCommandsOnlyBridge(doc);
  }
  return { skill_stub_target_dir, commands_target_dir };
}

function parseCommandsOnlyBridge(doc: Record<string, unknown>): AdapterInstanceBridgeYaml | null {
  const commands = doc?.commands;
  if (!commands || typeof commands !== 'object' || Array.isArray(commands)) {
    return null;
  }
  const commands_target_dir =
    typeof (commands as Record<string, unknown>).target_dir === 'string'
      ? ((commands as Record<string, unknown>).target_dir as string).trim()
      : undefined;
  return commands_target_dir ? { commands_target_dir } : null;
}

export function parseSkillBridgeTargetDir(adapterYamlText: string): string | undefined {
  const doc = YAML.parse(adapterYamlText) as Record<string, unknown>;
  const raw = doc?.skill_bridge;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const td = (raw as Record<string, unknown>).target_dir;
  return typeof td === 'string' && td.trim() ? td.trim() : undefined;
}

export function parseCommandsTargetDir(adapterYamlText: string): string | undefined {
  const inst = parseInstanceSkillBridgeFromAdapter(adapterYamlText);
  if (inst?.commands_target_dir) {
    return inst.commands_target_dir;
  }
  const doc = YAML.parse(adapterYamlText) as Record<string, unknown>;
  const commands = doc?.commands;
  if (!commands || typeof commands !== 'object' || Array.isArray(commands)) {
    return undefined;
  }
  const td = (commands as Record<string, unknown>).target_dir;
  return typeof td === 'string' && td.trim() ? td.trim() : undefined;
}

/** @deprecated 使用 posixRelativeFromSkillStubTo */
export function posixRelativeFromCursorSkillStubTo(skillMdRepoRelPosix: string): string {
  return posixRelativeFromSkillStubTo('.cursor/skills/placeholder/SKILL.md', skillMdRepoRelPosix);
}

/** `.claude/commands/<bridgeId>.md` → 正文 SKILL.md 的相对链接 */
export function posixRelativeFromClaudeCommandTo(skillMdRepoRelPosix: string): string {
  return `../../${skillMdRepoRelPosix}`;
}

export function resolveSkillStubTargetDir(
  repoRoot: string,
  frameworkDir: string,
  agentAdapter: string,
): string | undefined {
  const adapterPath = path.join(frameworkDir, 'agents', agentAdapter, 'adapter.yaml');
  if (!fs.existsSync(adapterPath)) {
    return undefined;
  }
  const adapterText = fs.readFileSync(adapterPath, 'utf8');
  const bridgeCfg = parseInstanceSkillBridgeFromAdapter(adapterText);
  if (bridgeCfg?.skill_stub_target_dir) {
    return bridgeCfg.skill_stub_target_dir;
  }
  const skillBridgeDir = parseSkillBridgeTargetDir(adapterText);
  if (skillBridgeDir) {
    return skillBridgeDir;
  }
  if (agentAdapter === 'generic') {
    try {
      const cfg = loadFrameworkConfig(repoRoot);
      return resolveGenericBundlePathsFromPaths(cfg.paths).skillsDir;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** 物化后的内置 skill 入口（相对 projectRoot）；不存在则 exists=false */
export function resolveMaterializedBuiltinSkillEntryRel(
  projectRoot: string,
  frameworkDir: string,
  adapter: string,
  skillId: string,
  commandId: string,
): { rel: string; exists: boolean } | null {
  const name = adapter.trim().toLowerCase();
  // claude-kernel 家族（plan c7a9e2f4 #11）：manifest 驱动——读**本 adapter** 的
  // agents/<name>/adapter.yaml 解析 commands target_dir（claude→.claude/commands，
  // codeagent→.cac/commands），不再写死 claude 目录。默认兜底仅保留 claude 的
  // 历史缺省；codeagent adapter.yaml 恒声明 target_dir，解析不到属异常 → null（不猜）。
  if (isClaudeKernelAdapter(name)) {
    const adapterPath = path.join(frameworkDir, 'agents', name, 'adapter.yaml');
    if (!fs.existsSync(adapterPath)) {
      return null;
    }
    const commandsDir =
      parseCommandsTargetDir(fs.readFileSync(adapterPath, 'utf8'))
      ?? (name === 'claude' ? '.claude/commands' : null);
    if (!commandsDir) {
      return null;
    }
    const rel = path.posix.join(commandsDir.replace(/\\/g, '/'), `${commandId}.md`);
    const abs = path.join(projectRoot, ...rel.split('/'));
    return { rel, exists: fs.existsSync(abs) };
  }
  const stubDir = resolveSkillStubTargetDir(projectRoot, frameworkDir, name);
  if (!stubDir) {
    return null;
  }
  const rel = path.posix.join(stubDir.replace(/\\/g, '/'), skillId, 'SKILL.md');
  const abs = path.join(projectRoot, ...rel.split('/'));
  return { rel, exists: fs.existsSync(abs) };
}

export function renderExtensionSkillStubMarkdown(
  bridgeId: string,
  skillMdRepoRelPosix: string,
  stubTargetRelPosix: string,
  options: { inline: boolean; frameworkDir: string; projectRoot: string },
): string {
  if (options.inline) {
    const resolved = resolveSkillPathOrNull(options.frameworkDir, bridgeId);
    const fwSkill = resolved
      ? path.join(options.frameworkDir, resolved.skillMdFrameworkRel)
      : path.join(options.frameworkDir, 'skills', bridgeId, 'SKILL.md');
    if (fs.existsSync(fwSkill)) {
      return materializeInlineSkillMarkdown(options.frameworkDir, bridgeId, {
        projectRoot: options.projectRoot,
        stubTargetRelPosix: stubTargetRelPosix,
      });
    }
  }
  return renderBridgeSkillStubMarkdown(
    bridgeId,
    stubTargetRelPosix,
    skillMdRepoRelPosix,
    options.frameworkDir,
    `实例扩展 Skill：${bridgeId}`,
  );
}

export function renderClaudeSlashMarkdown(bridgeId: string, skillMdRepoRelPosix: string): string {
  const relFromSlash = posixRelativeFromClaudeCommandTo(skillMdRepoRelPosix);
  return [
    '---',
    `description: 实例扩展 Skill：${bridgeId}`,
    'argument-hint: optional-args',
    '---',
    '',
    `# /${bridgeId} — 实例扩展`,
    '',
    '**用户输入**：$ARGUMENTS',
    '',
    '## 唯一指令',
    '',
    `完整读一遍 [${skillMdRepoRelPosix}](${relFromSlash})，并按其中步骤执行。`,
    '',
    '> 本路由由 framework `render-agents-md` 依据 `adapter.yaml → instance_skill_bridge` 自动生成；规则 SSOT 在 `doc/extensions/`。',
    '',
  ].join('\n');
}

export interface EmitInstanceSkillBridgeResult {
  warnings: string[];
  filesWritten: string[];
  filesRemoved: string[];
  driftedFiles: string[];
  untouchedFiles: string[];
}

type ExtensionBridgeKind = 'skill_stub' | 'command';

interface ExtensionBridgeOwnership {
  kind: ExtensionBridgeKind;
  adapter: string;
  bridgeId: string;
  sourceRel: string;
}

const OWNERSHIP_PREFIX = '# agent-maison:instance-extension-bridge ';

function withOwnership(body: string, ownership: ExtensionBridgeOwnership): string {
  const lines = body.split('\n');
  lines.splice(1, 0, `${OWNERSHIP_PREFIX}${JSON.stringify(ownership)}`);
  return lines.join('\n');
}

function readOwnership(body: string): ExtensionBridgeOwnership | null {
  const line = body.split(/\r?\n/, 5).find(item => item.startsWith(OWNERSHIP_PREFIX));
  if (!line) return null;
  try {
    const value = JSON.parse(line.slice(OWNERSHIP_PREFIX.length)) as Partial<ExtensionBridgeOwnership>;
    if (
      (value.kind === 'skill_stub' || value.kind === 'command')
      && typeof value.adapter === 'string'
      && typeof value.bridgeId === 'string'
      && typeof value.sourceRel === 'string'
    ) {
      return value as ExtensionBridgeOwnership;
    }
  } catch {
    // 标记损坏按内容漂移处理，绝不接管或删除。
  }
  return null;
}

function canonicalOwnedBridge(
  ownership: ExtensionBridgeOwnership,
  targetRel: string,
  frameworkDir: string,
  projectRoot: string,
): string {
  const body = ownership.kind === 'command'
    ? renderClaudeSlashMarkdown(ownership.bridgeId, ownership.sourceRel)
    : renderExtensionSkillStubMarkdown(ownership.bridgeId, ownership.sourceRel, targetRel, {
        inline: false,
        frameworkDir,
        projectRoot,
      });
  return withOwnership(body, ownership);
}

function directBridgeCandidates(base: string, kind: ExtensionBridgeKind): string[] {
  if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) return [];
  if (kind === 'command') {
    return fs.readdirSync(base, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
      .map(entry => path.join(base, entry.name));
  }
  const out: string[] = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(base, entry.name, 'SKILL.md');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) out.push(candidate);
  }
  return out;
}

export interface InstanceBridgeArtifactInspection {
  adapter: string;
  bridgeId: string;
  sourceRel: string;
  path: string;
  state: 'present' | 'missing' | 'stale' | 'drifted' | 'unowned' | 'orphan';
}

export function inspectInstanceSkillBridgeArtifacts(options: {
  repoRoot: string;
  frameworkDir: string;
  agentAdapter: string;
  extensionDirRel?: string;
  reserved?: Set<string>;
  declaredSkillIds?: readonly string[];
}): InstanceBridgeArtifactInspection[] {
  const { repoRoot, frameworkDir, agentAdapter } = options;
  const adapterPath = path.join(frameworkDir, 'agents', agentAdapter, 'adapter.yaml');
  if (!fs.existsSync(adapterPath)) return [];
  const bridgeCfg = parseInstanceSkillBridgeFromAdapter(fs.readFileSync(adapterPath, 'utf8'));
  const stubDir = resolveSkillStubTargetDir(repoRoot, frameworkDir, agentAdapter);
  const targets = resolveBridgeTargets(
    scanExtensionSkills(repoRoot, options.extensionDirRel, options.declaredSkillIds),
    options.reserved ?? loadReservedBridgeIds(frameworkDir),
  ).targets;
  const expected = new Map<string, { ownership: ExtensionBridgeOwnership; body: string }>();
  const roots: Array<{ base: string; kind: ExtensionBridgeKind }> = [];
  const add = (absPath: string, kind: ExtensionBridgeKind, bridgeId: string, sourceRel: string) => {
    const ownership = { kind, adapter: agentAdapter, bridgeId, sourceRel };
    const targetRel = path.relative(repoRoot, absPath).replace(/\\/g, '/');
    expected.set(absPath, { ownership, body: canonicalOwnedBridge(ownership, targetRel, frameworkDir, repoRoot) });
  };
  if (stubDir) {
    const base = path.join(repoRoot, ...stubDir.replace(/\\/g, '/').split('/').filter(Boolean));
    roots.push({ base, kind: 'skill_stub' });
    for (const target of targets) add(path.join(base, target.bridgeId, 'SKILL.md'), 'skill_stub', target.bridgeId, target.skillMdRepoRel);
  }
  if (bridgeCfg?.commands_target_dir) {
    const base = path.join(repoRoot, ...bridgeCfg.commands_target_dir.replace(/\\/g, '/').split('/').filter(Boolean));
    roots.push({ base, kind: 'command' });
    for (const target of targets) add(path.join(base, `${target.bridgeId}.md`), 'command', target.bridgeId, target.skillMdRepoRel);
  }
  const out: InstanceBridgeArtifactInspection[] = [];
  for (const [absPath, item] of expected) {
    const targetRel = path.relative(repoRoot, absPath).replace(/\\/g, '/');
    if (!fs.existsSync(absPath)) {
      out.push({ adapter: agentAdapter, bridgeId: item.ownership.bridgeId, sourceRel: item.ownership.sourceRel, path: targetRel, state: 'missing' });
      continue;
    }
    const current = fs.readFileSync(absPath, 'utf8');
    const ownership = readOwnership(current);
    const state = current === item.body
      ? 'present'
      : !ownership
        ? (current.includes(OWNERSHIP_PREFIX) ? 'drifted' : 'unowned')
        : current === canonicalOwnedBridge(ownership, targetRel, frameworkDir, repoRoot)
          ? 'stale'
          : 'drifted';
    out.push({ adapter: agentAdapter, bridgeId: item.ownership.bridgeId, sourceRel: item.ownership.sourceRel, path: targetRel, state });
  }
  for (const { base, kind } of roots) {
    for (const absPath of directBridgeCandidates(base, kind)) {
      if (expected.has(absPath)) continue;
      const current = fs.readFileSync(absPath, 'utf8');
      const ownership = readOwnership(current);
      if (!ownership || ownership.kind !== kind) continue;
      const targetRel = path.relative(repoRoot, absPath).replace(/\\/g, '/');
      out.push({
        adapter: agentAdapter, bridgeId: ownership.bridgeId, sourceRel: ownership.sourceRel, path: targetRel,
        state: current === canonicalOwnedBridge(ownership, targetRel, frameworkDir, repoRoot) ? 'orphan' : 'drifted',
      });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function emitInstanceSkillBridge(options: {
  repoRoot: string;
  frameworkDir: string;
  agentAdapter: string;
  extensionDirRel?: string;
  reserved?: Set<string>;
  declaredSkillIds?: readonly string[];
}): EmitInstanceSkillBridgeResult {
  const { repoRoot, frameworkDir, agentAdapter } = options;
  const warnings: string[] = [];
  const filesWritten: string[] = [];
  const filesRemoved: string[] = [];
  const driftedFiles: string[] = [];
  const untouchedFiles: string[] = [];

  const skillStubDir = resolveSkillStubTargetDir(repoRoot, frameworkDir, agentAdapter);
  const adapterPath = path.join(frameworkDir, 'agents', agentAdapter, 'adapter.yaml');
  const bridgeCfg = fs.existsSync(adapterPath)
    ? parseInstanceSkillBridgeFromAdapter(fs.readFileSync(adapterPath, 'utf8'))
    : null;

  if (!skillStubDir && !bridgeCfg?.commands_target_dir) {
    if (agentAdapter === 'generic') {
      warnings.push('[instance-skill-bridge] generic：未配置 paths.agent_bundle_root，跳过扩展 skill 跳板');
    }
    return { warnings, filesWritten, filesRemoved, driftedFiles, untouchedFiles };
  }

  const rows = scanExtensionSkills(repoRoot, options.extensionDirRel, options.declaredSkillIds);
  const reserved = options.reserved ?? loadReservedBridgeIds(frameworkDir);
  const { targets, warnings: rw } = resolveBridgeTargets(rows, reserved);
  warnings.push(...rw);

  const expected = new Map<string, string>();
  const candidateRoots: Array<{ base: string; kind: ExtensionBridgeKind }> = [];

  const addExpected = (
    absPath: string,
    kind: ExtensionBridgeKind,
    bridgeId: string,
    sourceRel: string,
  ) => {
    const targetRel = path.relative(repoRoot, absPath).replace(/\\/g, '/');
    expected.set(absPath, canonicalOwnedBridge({
      kind,
      adapter: agentAdapter,
      bridgeId,
      sourceRel,
    }, targetRel, frameworkDir, repoRoot));
  };

  const safeWrite = (absPath: string, body: string) => {
    const rel = path.relative(repoRoot, absPath).replace(/\\/g, '/');
    if (fs.existsSync(absPath)) {
      const current = fs.readFileSync(absPath, 'utf8');
      if (current === body) return;
      const ownership = readOwnership(current);
      if (!ownership) {
        if (current.includes(OWNERSHIP_PREFIX)) {
          driftedFiles.push(rel);
          warnings.push(`[instance-skill-bridge] ownership 标记损坏，保留不动：${rel}`);
        } else {
          untouchedFiles.push(rel);
          warnings.push(`[instance-skill-bridge] 未接管无 ownership 标记的文件：${rel}`);
        }
        return;
      }
      const canonical = canonicalOwnedBridge(ownership, rel, frameworkDir, repoRoot);
      if (current !== canonical) {
        driftedFiles.push(rel);
        warnings.push(`[instance-skill-bridge] ownership 文件内容已漂移，保留不动：${rel}`);
        return;
      }
    }
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, body, 'utf8');
    filesWritten.push(rel);
  };

  if (skillStubDir) {
    const base = path.join(repoRoot, ...skillStubDir.replace(/\\/g, '/').split('/').filter(Boolean));
    candidateRoots.push({ base, kind: 'skill_stub' });
    for (const t of targets) {
      const stubPath = path.join(base, t.bridgeId, 'SKILL.md');
      addExpected(stubPath, 'skill_stub', t.bridgeId, t.skillMdRepoRel);
    }
  }

  if (bridgeCfg?.commands_target_dir) {
    const base = path.join(repoRoot, ...bridgeCfg.commands_target_dir.replace(/\\/g, '/').split('/').filter(Boolean));
    candidateRoots.push({ base, kind: 'command' });
    for (const t of targets) {
      const cmdPath = path.join(base, `${t.bridgeId}.md`);
      addExpected(cmdPath, 'command', t.bridgeId, t.skillMdRepoRel);
    }
  }

  for (const [absPath, body] of expected) safeWrite(absPath, body);

  for (const { base, kind } of candidateRoots) {
    for (const absPath of directBridgeCandidates(base, kind)) {
      if (expected.has(absPath)) continue;
      const current = fs.readFileSync(absPath, 'utf8');
      const ownership = readOwnership(current);
      const rel = path.relative(repoRoot, absPath).replace(/\\/g, '/');
      if (!ownership) {
        if (current.includes(OWNERSHIP_PREFIX)) {
          driftedFiles.push(rel);
          warnings.push(`[instance-skill-bridge] 孤儿 ownership 标记损坏，保留不动：${rel}`);
        }
        continue;
      }
      if (ownership.kind !== kind) continue;
      const canonical = canonicalOwnedBridge(ownership, rel, frameworkDir, repoRoot);
      if (current !== canonical) {
        driftedFiles.push(rel);
        warnings.push(`[instance-skill-bridge] 孤儿 ownership 文件内容已漂移，保留不动：${rel}`);
        continue;
      }
      fs.unlinkSync(absPath);
      if (kind === 'skill_stub') {
        const parent = path.dirname(absPath);
        if (fs.readdirSync(parent).length === 0) fs.rmdirSync(parent);
      }
      filesRemoved.push(rel);
    }
  }

  return { warnings, filesWritten, filesRemoved, driftedFiles, untouchedFiles };
}
