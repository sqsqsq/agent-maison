// ============================================================================
// instance-skill-bridge — 扫描 doc/extensions/skills 并生成 Cursor 跳板 / Claude slash
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';

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
  const cursorSkills = path.join(frameworkDir, 'agents', 'cursor', 'templates', 'skills');
  if (fs.existsSync(cursorSkills)) {
    for (const ent of fs.readdirSync(cursorSkills, { withFileTypes: true })) {
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

export function scanExtensionSkills(projectRoot: string, extensionDirRel = 'doc/extensions'): ExtensionSkillScanRow[] {
  const rel = extensionDirRel.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const extRoot = path.join(projectRoot, ...rel.split('/').filter(Boolean));
  const skillsRoot = path.join(extRoot, 'skills');
  if (!fs.existsSync(skillsRoot) || !fs.statSync(skillsRoot).isDirectory()) {
    return [];
  }
  const rows: ExtensionSkillScanRow[] = [];
  for (const ent of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!ent.isDirectory()) {
      continue;
    }
    const sourceSlug = ent.name;
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

export function formatExtensionSkillSectionMarkdown(targets: ResolvedBridgeTarget[]): string {
  if (targets.length === 0) {
    return '';
  }
  const lines: string[] = [
    '',
    '### 实例扩展 Skill（doc/extensions）',
    '',
    '以下由 `render-agents-md` 扫描 `doc/extensions/skills/*/SKILL.md` 自动生成；若与框架内置 Skill 跳板 / slash **同名**，桥接产物会自动加 `ext-` 前缀（见标识列）。',
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
    return null;
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
    return null;
  }
  return { skill_stub_target_dir, commands_target_dir };
}

/** `.cursor/skills/<bridgeId>/SKILL.md` → 正文 SKILL.md 的相对链接 */
export function posixRelativeFromCursorSkillStubTo(skillMdRepoRelPosix: string): string {
  const stubDirDepth = 3;
  return `${'../'.repeat(stubDirDepth)}${skillMdRepoRelPosix}`;
}

/** `.claude/commands/<bridgeId>.md` → 正文 SKILL.md 的相对链接 */
export function posixRelativeFromClaudeCommandTo(skillMdRepoRelPosix: string): string {
  return `../../${skillMdRepoRelPosix}`;
}

export function renderCursorSkillStubMarkdown(bridgeId: string, skillMdRepoRelPosix: string): string {
  const relFromStub = posixRelativeFromCursorSkillStubTo(skillMdRepoRelPosix);
  return [
    '---',
    `name: ${bridgeId}`,
    `description: 实例扩展 Skill（跳板）。正文见 ${skillMdRepoRelPosix}`,
    '---',
    '',
    '# 跳板文件',
    '',
    `完整 Skill 定义请阅读：**[${skillMdRepoRelPosix}](${relFromStub})**`,
    '',
  ].join('\n');
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
}

export function emitInstanceSkillBridge(options: {
  repoRoot: string;
  frameworkDir: string;
  agentAdapter: string;
  extensionDirRel?: string;
  reserved?: Set<string>;
}): EmitInstanceSkillBridgeResult {
  const { repoRoot, frameworkDir, agentAdapter } = options;
  const warnings: string[] = [];
  const filesWritten: string[] = [];

  const adapterPath = path.join(frameworkDir, 'agents', agentAdapter, 'adapter.yaml');
  if (!fs.existsSync(adapterPath)) {
    warnings.push(`[instance-skill-bridge] adapter.yaml 不存在：${adapterPath}`);
    return { warnings, filesWritten };
  }

  const bridgeCfg = parseInstanceSkillBridgeFromAdapter(fs.readFileSync(adapterPath, 'utf8'));
  if (!bridgeCfg) {
    return { warnings, filesWritten };
  }

  const rows = scanExtensionSkills(repoRoot, options.extensionDirRel);
  const reserved = options.reserved ?? loadReservedBridgeIds(frameworkDir);
  const { targets, warnings: rw } = resolveBridgeTargets(rows, reserved);
  warnings.push(...rw);

  const mkdirWrite = (absPath: string, body: string) => {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, body, 'utf8');
    filesWritten.push(path.relative(repoRoot, absPath).replace(/\\/g, '/'));
  };

  if (bridgeCfg.skill_stub_target_dir) {
    const base = path.join(
      repoRoot,
      ...bridgeCfg.skill_stub_target_dir.replace(/\\/g, '/').split('/').filter(Boolean),
    );
    for (const t of targets) {
      const stubPath = path.join(base, t.bridgeId, 'SKILL.md');
      mkdirWrite(stubPath, renderCursorSkillStubMarkdown(t.bridgeId, t.skillMdRepoRel));
    }
  }

  if (bridgeCfg.commands_target_dir) {
    const base = path.join(repoRoot, ...bridgeCfg.commands_target_dir.replace(/\\/g, '/').split('/').filter(Boolean));
    for (const t of targets) {
      const cmdPath = path.join(base, `${t.bridgeId}.md`);
      mkdirWrite(cmdPath, renderClaudeSlashMarkdown(t.bridgeId, t.skillMdRepoRel));
    }
  }

  return { warnings, filesWritten };
}
