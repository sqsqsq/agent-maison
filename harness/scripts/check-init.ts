// ============================================================================
// Init 阶段脚本 Harness — check-init.ts
// ============================================================================
// 作用对象: framework-init Skill 0.3 体检表 11 项产物。
//
// 设计要点（v2.6 弱模型工作流强制门 · L2+）:
//   - 11 项 MISSING / EMPTY / POPULATED 判定全部由本脚本基于模板感知比对
//     与 fs.existsSync 计算，**AI 无任何自由度**；
//   - 文本模板项使用 EOL-aware 比对：仅 CRLF/LF 不同不算用户漂移；
//   - 双输出：
//       (a) JSON   → framework/harness/reports/_global/init/<timestamp>/
//                    check-init.json （机器读，给 SKILL 0.3.2 推策略）
//       (b) stdout → SKILL 0.3.3 体检表（含 `update_policy` 列；#3 可按文件展开，总行数≥基线；
//                     AI 仅原样搬运）
//   - 由 PhaseChecker 接口对齐 harness-runner.ts 调度（与 catalog/glossary/
//     docs 三个全局阶段同型），不单独跑 main()。
//
// 元阶段三件套**刻意不对称**：
//   - 不接 verify-init.md（init 阶段 AI 语义审无可审）
//   - 不给 init 接 Stop hook（避免 hook 拦自己安装的循环依赖）
//   - 不写 init 完成回执模板（init 无 feature 维度，回执模板不匹配）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as YAML from 'yaml';

import { DEFAULT_PROJECT_PROFILE_SUB_VARIANT_DISPLAY } from '../config';
import {
  detectMissingBackfillFields,
  MissingFieldEntry,
} from './utils/config-field-merger';
import { PhaseChecker, CheckContext, CheckResult } from './utils/types';

// --------------------------------------------------------------------------
// 公共类型
// --------------------------------------------------------------------------

export type InspectionStatus = 'MISSING' | 'EMPTY' | 'POPULATED';
export type InitMode = 'create' | 'update';
export type AdapterUpdatePolicy = 'auto_overwrite' | 'prompt_if_changed';

export interface Inspection {
  index: number;                       // 1..11
  target_path: string;                 // 体检对象（相对实例工程根，POSIX 正斜杠）
  template_source: string | null;      // 第 2/3/4/7 项有值；其余为 null
  status: InspectionStatus;
  hash_template: string | null;        // sha256；非比对项为 null
  hash_target: string | null;
  diff_summary: string | null;         // POPULATED 项给前 50 行 unified-style diff
  planned_strategy: string;            // 命中 SKILL 0.3.2 哪一行的策略文案
  diagnosis: string;                   // 本行的诊断短句（写进 stdout 表）
  /** 体检第 3 项逐文件展开时：该模板文件所属 adapter 段的 update_policy；其余行为 null */
  update_policy?: AdapterUpdatePolicy | null;
  /**
   * 第 1 项专用：UPDATE 模式下 framework.config.json 缺失的白名单字段（点分路径）。
   * 来源：scripts/utils/config-field-merger.ts BACKFILL_FIELDS。
   * 当本字段非空时，Skill 00 §5.1 应触发 Q1.A「字段补缺合并」子问题；
   * 推荐执行：`node framework/harness/scripts/merge-framework-config.mjs --apply`。
   * CREATE 模式（cfg 不存在）或非 POPULATED 状态下为 null / 不设置。
   */
  missing_keys?: string[] | null;
}

export interface CheckInitReport {
  schema_version: '1.1';
  mode: InitMode;
  adapter: string | null;
  inspections: Inspection[];
  blockers: string[];
  verdict: 'PASS' | 'FAIL';
  generated_at: string;
  /** init 通过后自动对齐 auto_overwrite 机制产物时的备份目录（相对实例根），无对齐时为 null */
  mechanism_backup_rel_dir?: string | null;
  mechanism_synced_files?: number;
}

// --------------------------------------------------------------------------
// 路径常量
// --------------------------------------------------------------------------

/**
 * frameworkRoot：从本脚本位置反推 framework/ 根。
 *   __dirname = framework/harness/scripts → ../.. = framework
 */
const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..');
const HARNESS_ROOT = path.resolve(__dirname, '..');

/** 与 framework/harness/config.ts DEFAULT_PATHS 完全一致；本脚本独立维护一份
 *  以确保 CREATE 模式下（无 framework.config.json）也能正常推 paths.* 默认值。
 */
const DEFAULT_PATHS = {
  features_dir: 'doc/features',
  module_catalog: 'doc/module-catalog.yaml',
  glossary: 'doc/glossary.yaml',
  glossary_seed: 'doc/glossary-seed.txt',
  architecture_md: 'doc/architecture.md',
} as const;

/** SKILL 5.4.5.1 canonical .gitignore patterns */
const CANONICAL_IGNORE_PATTERNS: ReadonlyArray<string> = [
  'framework/harness/node_modules/',
  'framework/harness/dist/',
  'framework/harness/reports/*',
  '!framework/harness/reports/.gitkeep',
  'framework/harness/trace/',
  'framework/harness/package-lock.json',
  'framework/harness/state/*',
  '!framework/harness/state/.gitkeep',
  // Skill 0：合并入 SSOT 前的 staging 草稿目录，不入仓
  'doc/catalog-staging/',
  'doc/glossary-staging/',
  // init：auto_overwrite 机制同步时的旧文件备份根（managed by check-init / Skill 00）
  '.framework-backup/',
];

/** SKILL 5.4.5.2 等价覆盖映射 */
const IGNORE_EQUIV_PATTERNS: Record<string, string[]> = {
  'framework/harness/node_modules/': [
    '**/node_modules',
    '**/node_modules/',
    'node_modules/',
    'framework/**/node_modules/',
    'framework/harness/node_modules',
    'framework/harness/node_modules/',
  ],
  'framework/harness/package-lock.json': [
    '**/package-lock.json',
    'package-lock.json',
    'framework/**/package-lock.json',
    'framework/harness/package-lock.json',
  ],
  'framework/harness/dist/': [
    'framework/harness/dist',
    'framework/harness/dist/',
    'framework/**/dist/',
  ],
  'framework/harness/reports/*': ['framework/harness/reports/*'],
  '!framework/harness/reports/.gitkeep': ['!framework/harness/reports/.gitkeep'],
  'framework/harness/trace/': [
    'framework/harness/trace',
    'framework/harness/trace/',
  ],
  'framework/harness/state/*': [
    'framework/harness/state/*',
    'framework/harness/state',
    'framework/harness/state/',
  ],
  '!framework/harness/state/.gitkeep': ['!framework/harness/state/.gitkeep'],
  'doc/catalog-staging/': ['doc/catalog-staging/', 'doc/catalog-staging', '**/catalog-staging/'],
  'doc/glossary-staging/': ['doc/glossary-staging/', 'doc/glossary-staging', '**/glossary-staging/'],
  '.framework-backup/': [
    '.framework-backup',
    '.framework-backup/',
    '**/.framework-backup/',
  ],
};

type TextArtifactCompareKind = 'byte_equal' | 'eol_only' | 'content_different';

interface TextArtifactComparison {
  kind: TextArtifactCompareKind;
  templateHash: string;
  targetHash: string;
  templateText: string;
  targetText: string;
}

// --------------------------------------------------------------------------
// 通用工具
// --------------------------------------------------------------------------

function sha256(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf-8') : buf;
  return crypto.createHash('sha256').update(b).digest('hex');
}

function normalizeEol(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

function compareTextArtifact(template: Buffer | string, target: Buffer | string): TextArtifactComparison {
  const templateText = Buffer.isBuffer(template) ? template.toString('utf-8') : template;
  const targetText = Buffer.isBuffer(target) ? target.toString('utf-8') : target;
  const templateHash = sha256(templateText);
  const targetHash = sha256(targetText);
  let kind: TextArtifactCompareKind = 'content_different';
  if (templateHash === targetHash) {
    kind = 'byte_equal';
  } else if (normalizeEol(templateText) === normalizeEol(targetText)) {
    kind = 'eol_only';
  }
  return {
    kind,
    templateHash,
    targetHash,
    templateText,
    targetText,
  };
}

function eolOnlyDiffSummary(): string {
  return 'no content diff (EOL-only difference ignored)';
}

function safeReadBuffer(p: string): Buffer | null {
  try { return fs.readFileSync(p); } catch { return null; }
}

function safeReadText(p: string): string | null {
  try { return fs.readFileSync(p, 'utf-8'); } catch { return null; }
}

function existsAbs(p: string): boolean {
  try { fs.statSync(p); return true; } catch { return false; }
}

function isDir(p: string): boolean {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function nowStamp(): string {
  // 形如 20260427T160500Z（UTC，文件系统安全，便于排序）
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

/**
 * 极简 line-based diff 摘要（不是 LCS，但够给人看）。
 * 当 a/b 字节相等返回 'no diff'；否则返回前 maxLines 条不相同行（unified-ish 格式）。
 */
function unifiedDiffSummary(a: string, b: string, maxLines = 50): string {
  if (a === b) return 'no diff';
  const al = a.split(/\r?\n/);
  const bl = b.split(/\r?\n/);
  const out: string[] = [
    `--- template (${al.length} lines, sha256=${sha256(a).slice(0, 12)})`,
    `+++ target   (${bl.length} lines, sha256=${sha256(b).slice(0, 12)})`,
  ];
  let shown = 0;
  const maxLen = Math.max(al.length, bl.length);
  for (let i = 0; i < maxLen && shown < maxLines; i++) {
    const x = al[i] ?? '';
    const y = bl[i] ?? '';
    if (x !== y) {
      out.push(`@@ line ${i + 1} @@`);
      out.push(`- ${x}`);
      out.push(`+ ${y}`);
      shown += 3;
    }
  }
  if (shown >= maxLines) out.push('... (diff truncated to first 50 changed lines)');
  return out.join('\n');
}

// --------------------------------------------------------------------------
// framework.config.json 解析（独立于 framework/harness/config.ts，
// 因为后者会回退到 LEGACY 默认值，会污染"是否真的已 init"的判定）
// --------------------------------------------------------------------------

interface RawFrameworkConfig {
  exists: boolean;
  parseable: boolean;
  parseError?: string;
  raw?: any;
  paths: typeof DEFAULT_PATHS & {
    state_file?: string;
    receipt_dir_pattern?: string;
  };
  outerLayersLen: number;
  agentAdapter: string | null;
  toolchainInstallPath: string | null;
  /**
   * UPDATE 模式下：framework.config.json 中缺失的白名单字段（按 BACKFILL_FIELDS 顺序）。
   * CREATE 模式（exists=false / parseable=false）下为空数组。
   * 来源：scripts/utils/config-field-merger.ts detectMissingBackfillFields。
   */
  missingBackfillFields: MissingFieldEntry[];
}

function loadRawFrameworkConfig(projectRoot: string): RawFrameworkConfig {
  const cfgPath = path.join(projectRoot, 'framework.config.json');
  const txt = safeReadText(cfgPath);
  if (txt === null) {
    return {
      exists: false,
      parseable: false,
      paths: { ...DEFAULT_PATHS },
      outerLayersLen: 0,
      agentAdapter: null,
      toolchainInstallPath: null,
      missingBackfillFields: [],
    };
  }
  let raw: any;
  try {
    raw = JSON.parse(txt);
  } catch (e) {
    return {
      exists: true,
      parseable: false,
      parseError: (e as Error).message,
      paths: { ...DEFAULT_PATHS },
      outerLayersLen: 0,
      agentAdapter: null,
      toolchainInstallPath: null,
      missingBackfillFields: [],
    };
  }
  const paths = {
    ...DEFAULT_PATHS,
    ...((raw && typeof raw.paths === 'object') ? raw.paths : {}),
  };
  const outerLayers = raw?.architecture?.outer_layers;
  const installPath = raw?.toolchain?.devEcoStudio?.installPath;
  return {
    exists: true,
    parseable: true,
    raw,
    paths,
    outerLayersLen: Array.isArray(outerLayers) ? outerLayers.length : 0,
    agentAdapter: typeof raw?.agent_adapter === 'string' ? raw.agent_adapter : null,
    toolchainInstallPath: typeof installPath === 'string' && installPath.length > 0 ? installPath : null,
    missingBackfillFields: detectMissingBackfillFields(raw),
  };
}

// --------------------------------------------------------------------------
// adapter.yaml 解析
// --------------------------------------------------------------------------

interface AdapterTemplateFile {
  /** 相对实例工程根 */
  targetRel: string;
  /** 相对 framework/ 根 */
  templateRel: string;
  /** 落地方式：rendered（占位符替换）/ verbatim（字节相等比对） */
  kind: 'rendered' | 'verbatim';
  /** 映射来源字段名（用于诊断） */
  origin: string;
  /** UPDATE 模式下第 3 项 POPULATED 时的对齐策略；缺省 prompt_if_changed */
  update_policy: AdapterUpdatePolicy;
}

interface AdapterDescriptor {
  name: string;
  yamlPath: string;
  yamlExists: boolean;
  yamlParseable: boolean;
  parseError?: string;
  /** agent_entry_file，单文件 */
  entryFile: AdapterTemplateFile | null;
  /** 第 3 项体检：commands / subagents / skill_bridge / rules / settings_file / hooks
   *  全部解析后的"逐文件"列表 */
  templateFiles: AdapterTemplateFile[];
  /** adapter.yaml 中声明的所有 template 路径，用于 template_files_resolvable */
  declaredTemplatePaths: Array<{ field: string; abs: string; exists: boolean }>;
}

/**
 * 收集目录下所有文件（递归），返回相对 dir 的 POSIX 路径。
 */
function listFilesRecursive(dirAbs: string): string[] {
  if (!isDir(dirAbs)) return [];
  const out: string[] = [];
  const stack: string[] = [''];
  while (stack.length) {
    const rel = stack.pop()!;
    const cur = path.join(dirAbs, rel);
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) stack.push(r);
      else if (ent.isFile()) out.push(r);
    }
  }
  return out;
}

export function parseUpdatePolicy(raw: unknown): AdapterUpdatePolicy {
  if (raw === 'auto_overwrite') return 'auto_overwrite';
  return 'prompt_if_changed';
}

function loadAdapter(adapter: string): AdapterDescriptor {
  const adapterDir = path.join(FRAMEWORK_ROOT, 'agents', adapter);
  const yamlPath = path.join(adapterDir, 'adapter.yaml');
  const desc: AdapterDescriptor = {
    name: adapter,
    yamlPath,
    yamlExists: existsAbs(yamlPath),
    yamlParseable: false,
    entryFile: null,
    templateFiles: [],
    declaredTemplatePaths: [],
  };
  if (!desc.yamlExists) return desc;

  const txt = safeReadText(yamlPath);
  if (txt === null) return desc;
  let cfg: any;
  try {
    cfg = YAML.parse(txt);
  } catch (e) {
    desc.parseError = (e as Error).message;
    return desc;
  }
  if (!cfg || typeof cfg !== 'object') {
    desc.parseError = 'adapter.yaml 顶层不是对象';
    return desc;
  }
  if (!cfg.adapter_name || !cfg.agent_entry_file) {
    desc.parseError = 'adapter.yaml 缺少必需字段 adapter_name / agent_entry_file';
    return desc;
  }
  desc.yamlParseable = true;

  // ----- agent_entry_file（template_path 相对 framework/，target_path 相对实例根）
  const entry = cfg.agent_entry_file;
  if (entry?.template_path && entry?.target_path) {
    desc.entryFile = {
      targetRel: entry.target_path,
      templateRel: entry.template_path,
      kind: 'rendered',
      origin: 'agent_entry_file',
      update_policy: parseUpdatePolicy(entry.update_policy),
    };
    desc.declaredTemplatePaths.push({
      field: 'agent_entry_file.template_path',
      abs: path.join(FRAMEWORK_ROOT, entry.template_path),
      exists: existsAbs(path.join(FRAMEWORK_ROOT, entry.template_path)),
    });
  }

  // ----- commands.template_dir / commands.subagents.template_dir
  const collectDir = (
    relUnderAdapter: string,
    targetDir: string,
    fieldLabel: string,
    updatePolicy: AdapterUpdatePolicy,
  ): void => {
    const absDir = path.join(adapterDir, relUnderAdapter);
    desc.declaredTemplatePaths.push({
      field: fieldLabel,
      abs: absDir,
      exists: existsAbs(absDir),
    });
    if (!isDir(absDir)) return;
    for (const fileRel of listFilesRecursive(absDir)) {
      desc.templateFiles.push({
        targetRel: toPosix(path.join(targetDir, fileRel)),
        // 注意：相对 framework/ = agents/<name>/<rel-under-adapter>/<file>
        templateRel: toPosix(path.join('agents', adapter, relUnderAdapter, fileRel)),
        kind: 'verbatim',
        origin: `${fieldLabel}/${fileRel}`,
        update_policy: updatePolicy,
      });
    }
  };

  if (cfg.commands && typeof cfg.commands === 'object') {
    if (cfg.commands.template_dir && cfg.commands.target_dir) {
      collectDir(
        cfg.commands.template_dir,
        cfg.commands.target_dir,
        'commands.template_dir',
        parseUpdatePolicy(cfg.commands.update_policy),
      );
    }
    if (cfg.commands.subagents && cfg.commands.subagents.template_dir && cfg.commands.subagents.target_dir) {
      collectDir(
        cfg.commands.subagents.template_dir,
        cfg.commands.subagents.target_dir,
        'commands.subagents.template_dir',
        parseUpdatePolicy(cfg.commands.subagents.update_policy),
      );
    }
  }
  if (cfg.skill_bridge && typeof cfg.skill_bridge === 'object'
    && cfg.skill_bridge.template_dir && cfg.skill_bridge.target_dir) {
    collectDir(
      cfg.skill_bridge.template_dir,
      cfg.skill_bridge.target_dir,
      'skill_bridge.template_dir',
      parseUpdatePolicy(cfg.skill_bridge.update_policy),
    );
  }
  if (cfg.rules && typeof cfg.rules === 'object'
    && cfg.rules.template_dir && cfg.rules.target_dir) {
    collectDir(
      cfg.rules.template_dir,
      cfg.rules.target_dir,
      'rules.template_dir',
      parseUpdatePolicy(cfg.rules.update_policy),
    );
  }
  if (cfg.hooks && typeof cfg.hooks === 'object'
    && cfg.hooks.template_dir && cfg.hooks.target_dir) {
    collectDir(
      cfg.hooks.template_dir,
      cfg.hooks.target_dir,
      'hooks.template_dir',
      parseUpdatePolicy(cfg.hooks.update_policy),
    );
  }
  if (cfg.settings_file && typeof cfg.settings_file === 'object'
    && cfg.settings_file.template_path && cfg.settings_file.target_path) {
    const tplAbs = path.join(adapterDir, cfg.settings_file.template_path);
    desc.declaredTemplatePaths.push({
      field: 'settings_file.template_path',
      abs: tplAbs,
      exists: existsAbs(tplAbs),
    });
    desc.templateFiles.push({
      targetRel: cfg.settings_file.target_path,
      templateRel: toPosix(path.join('agents', adapter, cfg.settings_file.template_path)),
      kind: 'verbatim',
      origin: 'settings_file',
      update_policy: parseUpdatePolicy(cfg.settings_file.update_policy),
    });
  }

  return desc;
}

// --------------------------------------------------------------------------
// 占位符渲染
// --------------------------------------------------------------------------

interface RenderEnv {
  agent_entry_file: string;
  project_name: string;
  project_type: string;
  project_type_label: string;
  agent_adapter: string;
  project_profile_name: string;
  project_profile_sub_variant: string;
  architecture_summary: string;
  architecture_md_path: string;
  module_catalog_path: string;
  glossary_path: string;
  features_dir: string;
  module_inner_layers_csv: string;
  cross_module_exports_file: string;
  profile_agent_ssot_rows: string;
  profile_agent_guardrails: string;
}

function projectTypeLabel(kind: string): string {
  if (kind === 'app') return '应用工程';
  if (kind === 'atomic_service') return '元服务工程';
  return kind;
}

function buildArchitectureSummary(arch: any): string {
  if (!arch || typeof arch !== 'object') return '<待生成>';
  const layers: any[] = Array.isArray(arch.outer_layers) ? arch.outer_layers : [];
  const inner: any[] = Array.isArray(arch.module_inner_layers) ? arch.module_inner_layers : [];
  const ids = layers.map(l => l?.id).filter(Boolean);
  const exitFile = arch.cross_module_exports_file ?? 'index.ets';
  const layerPart = ids.length === 0
    ? '0 个外层'
    : `${ids.length} 个外层（${ids[0]}…${ids[ids.length - 1]}）`;
  const innerPart = inner.length === 0
    ? '模块内 0 层'
    : `模块内 ${inner.length} 层 ${inner.join('→')}`;
  return `${layerPart}，${innerPart}，跨模块出口 ${exitFile}`;
}

function loadProfileAgentsPartial(profileName: string, fileBase: string): string {
  const name = profileName.trim() !== '' ? profileName.trim() : 'hmos-app';
  const candidates = [
    path.join(FRAMEWORK_ROOT, 'profiles', name, 'templates', 'agents-md', `${fileBase}.partial.md`),
    path.join(FRAMEWORK_ROOT, 'profiles', 'generic', 'templates', 'agents-md', `${fileBase}.partial.md`),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    return fs.readFileSync(p, 'utf8').replace(/\s+$/, '');
  }
  return '';
}

function projectProfileNameFromRaw(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return 'hmos-app';
  const pp = (raw as Record<string, unknown>).project_profile;
  if (pp && typeof pp === 'object') {
    const nm = (pp as Record<string, unknown>).name;
    if (typeof nm === 'string') {
      const trimmed = nm.trim();
      if (trimmed !== '') return trimmed;
    }
  }
  return 'hmos-app';
}

/** 与 Skill 00 Step 5.2 / init 体检第 4 项一致：profile doc-skeletons → generic → Skill 模板 */
function resolveArchitectureSkeletonSource(profileName: string): { tplRel: string; tplAbs: string } {
  const name = profileName.trim() !== '' ? profileName.trim() : 'hmos-app';
  const orderedAbs = [
    path.join(FRAMEWORK_ROOT, 'profiles', name, 'doc-skeletons', 'architecture.md.skeleton.md'),
    path.join(FRAMEWORK_ROOT, 'profiles', 'generic', 'doc-skeletons', 'architecture.md.skeleton.md'),
    path.join(FRAMEWORK_ROOT, 'skills', '00-framework-init', 'templates', 'architecture.md.skeleton.md'),
  ];
  for (const abs of orderedAbs) {
    if (fs.existsSync(abs)) {
      return { tplRel: path.relative(FRAMEWORK_ROOT, abs).replace(/\\/g, '/'), tplAbs: abs };
    }
  }
  const fallbackAbs = orderedAbs[orderedAbs.length - 1]!;
  return { tplRel: 'skills/00-framework-init/templates/architecture.md.skeleton.md', tplAbs: fallbackAbs };
}

function buildRenderEnv(
  cfg: RawFrameworkConfig,
  adapter: AdapterDescriptor | null,
): RenderEnv | null {
  if (!cfg.parseable || !cfg.raw || !adapter || !adapter.entryFile) return null;
  const raw = cfg.raw;
  const pp =
    raw.project_profile && typeof raw.project_profile === 'object'
      ? (raw.project_profile as Record<string, unknown>)
      : {};
  let profileName = 'hmos-app';
  let subVariant = DEFAULT_PROJECT_PROFILE_SUB_VARIANT_DISPLAY;
  if (typeof pp.name === 'string' && pp.name.trim() !== '') profileName = pp.name.trim();
  if (typeof pp.sub_variant === 'string' && pp.sub_variant.trim() !== '') subVariant = pp.sub_variant.trim();
  return {
    agent_entry_file: adapter.entryFile.targetRel,
    project_name: typeof raw.project_name === 'string' ? raw.project_name : '',
    project_type: typeof raw.project_type === 'string' ? raw.project_type : 'app',
    project_type_label: projectTypeLabel(raw.project_type ?? 'app'),
    agent_adapter: typeof raw.agent_adapter === 'string' ? raw.agent_adapter : adapter.name,
    project_profile_name: profileName,
    project_profile_sub_variant: subVariant,
    architecture_summary: buildArchitectureSummary(raw.architecture),
    architecture_md_path: cfg.paths.architecture_md,
    module_catalog_path: cfg.paths.module_catalog,
    glossary_path: cfg.paths.glossary,
    features_dir: cfg.paths.features_dir,
    module_inner_layers_csv: Array.isArray(raw?.architecture?.module_inner_layers)
      ? raw.architecture.module_inner_layers.join(' / ')
      : 'shared / data / domain / presentation',
    cross_module_exports_file: raw?.architecture?.cross_module_exports_file ?? 'index.ets',
    profile_agent_ssot_rows: loadProfileAgentsPartial(profileName, 'agent-ssot-rows'),
    profile_agent_guardrails: loadProfileAgentsPartial(profileName, 'agent-guardrails'),
  };
}

function renderTemplate(text: string, env: RenderEnv): string {
  return text
    .replace(/\{\{AGENT_ENTRY_FILE\}\}/g, env.agent_entry_file)
    .replace(/\{\{PROJECT_NAME\}\}/g, env.project_name)
    .replace(/\{\{PROJECT_TYPE_LABEL\}\}/g, env.project_type_label)
    .replace(/\{\{PROJECT_TYPE\}\}/g, env.project_type)
    .replace(/\{\{AGENT_ADAPTER\}\}/g, env.agent_adapter)
    .replace(/\{\{PROJECT_PROFILE_NAME\}\}/g, env.project_profile_name)
    .replace(/\{\{PROJECT_PROFILE_SUB_VARIANT\}\}/g, env.project_profile_sub_variant)
    .replace(/\{\{PROFILE_AGENT_SSOT_ROWS\}\}/g, env.profile_agent_ssot_rows)
    .replace(/\{\{PROFILE_AGENT_GUARDRAILS\}\}/g, env.profile_agent_guardrails)
    .replace(/\{\{ARCHITECTURE_SUMMARY\}\}/g, env.architecture_summary)
    .replace(/\{\{ARCHITECTURE_MD_PATH\}\}/g, env.architecture_md_path)
    .replace(/\{\{MODULE_CATALOG_PATH\}\}/g, env.module_catalog_path)
    .replace(/\{\{GLOSSARY_PATH\}\}/g, env.glossary_path)
    .replace(/\{\{FEATURES_DIR\}\}/g, env.features_dir)
    .replace(/\{\{MODULE_INNER_LAYERS_CSV\}\}/g, env.module_inner_layers_csv)
    .replace(/\{\{CROSS_MODULE_EXPORTS_FILE\}\}/g, env.cross_module_exports_file);
}

// --------------------------------------------------------------------------
// 11 项 inspector — 每项一个独立函数（便于单测）
// --------------------------------------------------------------------------

interface InspectorEnv {
  projectRoot: string;
  cfg: RawFrameworkConfig;
  adapter: AdapterDescriptor | null;
  renderEnv: RenderEnv | null;
}

function strategyText(line: number, status: InspectionStatus): string {
  // 与 SKILL 0.3.2 策略矩阵一一对应；保持简短便于 stdout 表显示。
  const m: Record<number, Record<InspectionStatus, string>> = {
    1: {
      MISSING: 'Step 3.5 直接写',
      EMPTY: '等同 MISSING（直接写）',
      POPULATED: 'Step 3.5 前 diff + 用户 y（或与 Q1 决策一致的动作）',
    },
    2: {
      MISSING: 'Step 4.1 直接写',
      EMPTY: '保留现有文件（不重写）',
      POPULATED: 'Step 4.1 前 diff + 用户 y',
    },
    3: {
      MISSING: '直接拷贝',
      EMPTY: '保留现有文件（不重写）',
      POPULATED: '逐文件 diff + 用户 y（自建文件保留）',
    },
    4: {
      MISSING: 'Step 5.2 写骨架',
      EMPTY: '保留现有文件（不重写）',
      POPULATED: '默认跳过（不重置用户已迭代文档）',
    },
    5: {
      MISSING: '写空骨架（modules: []）',
      EMPTY: '保留原骨架',
      POPULATED: '永不覆盖（catalog-bootstrap 资产）',
    },
    6: {
      MISSING: '写空骨架（terms: []）',
      EMPTY: '保留原骨架',
      POPULATED: '永不覆盖（glossary-bootstrap 资产）',
    },
    7: {
      MISSING: '写骨架',
      EMPTY: '保留',
      POPULATED: '默认跳过（保留原文）',
    },
    8: {
      MISSING: '创建空目录 (+ .gitkeep)',
      EMPTY: '保留',
      POPULATED: '不进入、不扫描、不比对',
    },
    9: {
      MISSING: 'Step 5.5 npm install',
      EMPTY: '不适用',
      POPULATED: 'Step 5.5 幂等跳过',
    },
    10: {
      MISSING: 'Step 5.6 探测并写入 installPath',
      EMPTY: '等同 MISSING',
      POPULATED: 'Step 5.6 跳过',
    },
    11: {
      MISSING: 'Step 5.4.5 创建/追加缺失规则',
      EMPTY: '等同 MISSING',
      POPULATED: 'Step 5.4.5 跳过',
    },
  };
  return m[line][status];
}

/** 体检第 3 项逐文件：POPULATED + auto_overwrite 时由 check-init 机制同步（备份后覆盖） */
function strategyText3Template(status: InspectionStatus, policy: AdapterUpdatePolicy): string {
  if (status === 'MISSING') return strategyText(3, 'MISSING');
  if (status === 'EMPTY') return strategyText(3, 'EMPTY');
  if (policy === 'auto_overwrite') {
    return 'check-init PASS：自动备份至 .framework-backup/<ts>/ 后对齐模板';
  }
  return strategyText(3, 'POPULATED');
}

function validateInspectionShape(inspections: Inspection[]): boolean {
  const countByIndex = new Map<number, number>();
  for (const ins of inspections) {
    countByIndex.set(ins.index, (countByIndex.get(ins.index) ?? 0) + 1);
  }
  const singleRequired = [1, 2, 4, 5, 6, 7, 8, 9, 10, 11];
  for (const idx of singleRequired) {
    if (countByIndex.get(idx) !== 1) return false;
  }
  return (countByIndex.get(3) ?? 0) >= 1;
}

// ---- 第 1 项: framework.config.json ----------------------------------------
function inspect01(env: InspectorEnv): Inspection {
  const target = 'framework.config.json';
  if (!env.cfg.exists) {
    return {
      index: 1,
      target_path: target,
      template_source: null,
      status: 'MISSING',
      hash_template: null,
      hash_target: null,
      diff_summary: null,
      planned_strategy: strategyText(1, 'MISSING'),
      diagnosis: 'CREATE 模式：实例工程根尚无 framework.config.json',
      missing_keys: null,
    };
  }
  if (!env.cfg.parseable) {
    return {
      index: 1,
      target_path: target,
      template_source: null,
      status: 'POPULATED',
      hash_template: null,
      hash_target: null,
      diff_summary: env.cfg.parseError ?? 'JSON 解析失败',
      planned_strategy: strategyText(1, 'POPULATED'),
      diagnosis: `JSON 解析失败：${env.cfg.parseError ?? '未知'}`,
      missing_keys: null,
    };
  }
  if (env.cfg.outerLayersLen === 0) {
    return {
      index: 1,
      target_path: target,
      template_source: null,
      status: 'EMPTY',
      hash_template: null,
      hash_target: null,
      diff_summary: null,
      planned_strategy: strategyText(1, 'EMPTY'),
      diagnosis: 'architecture.outer_layers 为空',
      missing_keys: null,
    };
  }
  // POPULATED：进一步识别 UPDATE 模式下的「白名单字段缺失」，
  // 供 Skill 00 §5.1 Q1.A 触发 merge-framework-config.mjs --apply。
  const missingPaths = env.cfg.missingBackfillFields.map(f => f.path);
  const baseDiag = `outer_layers.length=${env.cfg.outerLayersLen}，已配置`;
  const diagnosis = missingPaths.length === 0
    ? baseDiag
    : `${baseDiag}；另有 ${missingPaths.length} 个白名单字段缺失（建议跑 merge-framework-config.mjs --apply 补齐）`;
  return {
    index: 1,
    target_path: target,
    template_source: null,
    status: 'POPULATED',
    hash_template: null,
    hash_target: null,
    diff_summary: null,
    planned_strategy: strategyText(1, 'POPULATED'),
    diagnosis,
    missing_keys: missingPaths.length > 0 ? missingPaths : null,
  };
}

// ---- 第 2 项: agent 入口文件 ----------------------------------------------
function inspect02(env: InspectorEnv): Inspection {
  const adapter = env.adapter;
  if (!adapter || !adapter.entryFile) {
    return {
      index: 2,
      target_path: '<agent_entry_file>',
      template_source: null,
      status: 'MISSING',
      hash_template: null,
      hash_target: null,
      diff_summary: null,
      planned_strategy: strategyText(2, 'MISSING'),
      diagnosis: adapter
        ? `adapter ${adapter.name} 未声明 agent_entry_file`
        : 'adapter 未选定或 adapter.yaml 不可解析',
    };
  }
  const targetAbs = path.join(env.projectRoot, adapter.entryFile.targetRel);
  const tplAbs = path.join(FRAMEWORK_ROOT, adapter.entryFile.templateRel);
  const targetBuf = safeReadBuffer(targetAbs);
  const tplText = safeReadText(tplAbs);

  // 目标不存在 → MISSING
  if (targetBuf === null) {
    return {
      index: 2,
      target_path: adapter.entryFile.targetRel,
      template_source: adapter.entryFile.templateRel,
      status: 'MISSING',
      hash_template: tplText !== null ? sha256(tplText) : null,
      hash_target: null,
      diff_summary: null,
      planned_strategy: strategyText(2, 'MISSING'),
      diagnosis: `${adapter.entryFile.targetRel} 不存在`,
    };
  }
  // 模板不可读 / RenderEnv 缺失（CREATE 模式）→ POPULATED（任何已存在内容都算"非默认"）
  if (tplText === null) {
    return {
      index: 2,
      target_path: adapter.entryFile.targetRel,
      template_source: adapter.entryFile.templateRel,
      status: 'POPULATED',
      hash_template: null,
      hash_target: sha256(targetBuf),
      diff_summary: '模板不可读，无法 diff',
      planned_strategy: strategyText(2, 'POPULATED'),
      diagnosis: `模板 ${adapter.entryFile.templateRel} 读取失败`,
    };
  }
  if (env.renderEnv === null) {
    // CREATE 模式：framework.config.json 还没有，渲染不出来。
    // 与 SKILL 0.3.2 第 2 行 MISSING 动作一致——按 POPULATED 处理（已有内容但
    // 无法证明等同于默认渲染骨架），交给用户决策是否覆盖。
    return {
      index: 2,
      target_path: adapter.entryFile.targetRel,
      template_source: adapter.entryFile.templateRel,
      status: 'POPULATED',
      hash_template: sha256(tplText),
      hash_target: sha256(targetBuf),
      diff_summary: 'CREATE 模式：framework.config.json 不存在，无法渲染默认骨架进行 diff',
      planned_strategy: strategyText(2, 'POPULATED'),
      diagnosis: 'CREATE 模式无法渲染默认骨架，记为 POPULATED 等待用户确认',
    };
  }
  const rendered = renderTemplate(tplText, env.renderEnv);
  const comparison = compareTextArtifact(rendered, targetBuf);
  if (comparison.kind === 'byte_equal' || comparison.kind === 'eol_only') {
    return {
      index: 2,
      target_path: adapter.entryFile.targetRel,
      template_source: adapter.entryFile.templateRel,
      status: 'EMPTY',
      hash_template: comparison.templateHash,
      hash_target: comparison.targetHash,
      diff_summary: comparison.kind === 'byte_equal' ? 'no diff' : eolOnlyDiffSummary(),
      planned_strategy: strategyText(2, 'EMPTY'),
      diagnosis: comparison.kind === 'byte_equal'
        ? '与按当前 DSL 渲染的默认骨架字节相等'
        : '与按当前 DSL 渲染的默认骨架仅换行符不同，已忽略',
    };
  }
  return {
    index: 2,
    target_path: adapter.entryFile.targetRel,
    template_source: adapter.entryFile.templateRel,
    status: 'POPULATED',
    hash_template: comparison.templateHash,
    hash_target: comparison.targetHash,
    diff_summary: unifiedDiffSummary(comparison.templateText, comparison.targetText, 50),
    planned_strategy: strategyText(2, 'POPULATED'),
    diagnosis: '与默认骨架存在差异，已附 diff_summary',
  };
}

// ---- 第 3 项: adapter templates 下逐文件（可展开多行） -----------------------
function inspect03(env: InspectorEnv): Inspection[] {
  const adapter = env.adapter;
  if (!adapter) {
    return [{
      index: 3,
      target_path: '<adapter templates>',
      template_source: null,
      status: 'MISSING',
      hash_template: null,
      hash_target: null,
      diff_summary: null,
      planned_strategy: strategyText(3, 'MISSING'),
      diagnosis: 'adapter 未选定 / adapter.yaml 不可解析',
      update_policy: null,
    }];
  }
  if (adapter.templateFiles.length === 0) {
    return [{
      index: 3,
      target_path: `agents/${adapter.name}/templates/`,
      template_source: null,
      status: 'EMPTY',
      hash_template: null,
      hash_target: null,
      diff_summary: 'adapter 未声明任何 commands/skill_bridge/rules/hooks/settings_file 模板',
      planned_strategy: strategyText(3, 'EMPTY'),
      diagnosis: `${adapter.name} adapter 无附加模板`,
      update_policy: null,
    }];
  }

  type FileRow = {
    f: AdapterTemplateFile;
    status: InspectionStatus;
    hash_template: string | null;
    hash_target: string | null;
    diff_summary: string | null;
    diagnosis: string;
  };
  const fileRows: FileRow[] = [];
  for (const f of adapter.templateFiles) {
    const tplAbs = path.join(FRAMEWORK_ROOT, f.templateRel);
    const tgAbs = path.join(env.projectRoot, f.targetRel);
    const tplBuf = safeReadBuffer(tplAbs);
    const tgBuf = safeReadBuffer(tgAbs);
    if (tplBuf === null) {
      fileRows.push({
        f,
        status: 'POPULATED',
        hash_template: null,
        hash_target: tgBuf !== null ? sha256(tgBuf) : null,
        diff_summary: `模板缺失或不可读：${f.templateRel}`,
        diagnosis: `模板 ${f.templateRel} 读取失败`,
      });
      continue;
    }
    if (tgBuf === null) {
      fileRows.push({
        f,
        status: 'MISSING',
        hash_template: sha256(tplBuf),
        hash_target: null,
        diff_summary: `目标缺失：${f.targetRel}`,
        diagnosis: `${f.targetRel} 不存在`,
      });
      continue;
    }
    const comparison = compareTextArtifact(tplBuf, tgBuf);
    if (comparison.kind === 'byte_equal' || comparison.kind === 'eol_only') {
      fileRows.push({
        f,
        status: 'EMPTY',
        hash_template: comparison.templateHash,
        hash_target: comparison.targetHash,
        diff_summary: comparison.kind === 'byte_equal' ? 'no diff' : eolOnlyDiffSummary(),
        diagnosis: comparison.kind === 'byte_equal'
          ? `与源模板字节相等：${f.targetRel}`
          : `与源模板仅换行符不同（已忽略）：${f.targetRel}`,
      });
      continue;
    }
    fileRows.push({
      f,
      status: 'POPULATED',
      hash_template: comparison.templateHash,
      hash_target: comparison.targetHash,
      diff_summary: unifiedDiffSummary(comparison.templateText, comparison.targetText, 50),
      diagnosis: `与源模板内容不一致：${f.targetRel}`,
    });
  }

  const needAttention = fileRows.filter(r => r.status !== 'EMPTY');
  if (needAttention.length === 0) {
    const tplHashAll = fileRows.map(r => r.hash_template!).filter(Boolean);
    const tgHashAll = fileRows.map(r => r.hash_target!).filter(Boolean);
    const aggTplHash = sha256(tplHashAll.join('\n'));
    const aggTgHash = sha256(tgHashAll.join('\n'));
    const eolOnly = fileRows.filter(r => r.diff_summary === eolOnlyDiffSummary()).length;
    return [{
      index: 3,
      target_path: `<adapter ${adapter.name} templates>`,
      template_source: `framework/agents/${adapter.name}/templates/**`,
      status: 'EMPTY',
      hash_template: aggTplHash,
      hash_target: aggTgHash,
      diff_summary: eolOnly === 0 ? 'no diff' : eolOnlyDiffSummary(),
      planned_strategy: strategyText(3, 'EMPTY'),
      diagnosis: eolOnly === 0
        ? `全部 ${fileRows.length} 个模板文件与源字节相等`
        : `全部 ${fileRows.length} 个模板文件与源内容相同，其中 ${eolOnly} 个仅换行符不同，已忽略`,
      update_policy: null,
    }];
  }

  return needAttention.map(r => ({
    index: 3,
    target_path: r.f.targetRel,
    template_source: r.f.templateRel,
    status: r.status,
    hash_template: r.hash_template,
    hash_target: r.hash_target,
    diff_summary: r.diff_summary,
    planned_strategy: strategyText3Template(r.status, r.f.update_policy),
    diagnosis: r.diagnosis,
    update_policy: r.f.update_policy,
  }));
}

// ---- 第 4 项: doc/architecture.md ------------------------------------------
function inspect04(env: InspectorEnv): Inspection {
  const targetRel = env.cfg.paths.architecture_md;
  const targetAbs = path.join(env.projectRoot, targetRel);
  const profileName = projectProfileNameFromRaw(env.cfg.raw);
  const { tplRel, tplAbs } = resolveArchitectureSkeletonSource(profileName);

  const targetBuf = safeReadBuffer(targetAbs);
  const tplText = safeReadText(tplAbs);
  if (targetBuf === null) {
    return {
      index: 4,
      target_path: targetRel,
      template_source: tplRel,
      status: 'MISSING',
      hash_template: tplText !== null ? sha256(tplText) : null,
      hash_target: null,
      diff_summary: null,
      planned_strategy: strategyText(4, 'MISSING'),
      diagnosis: `${targetRel} 不存在`,
    };
  }
  if (tplText === null || env.renderEnv === null) {
    // 无法渲染骨架对比：仍可记录「未渲染骨架模板哈希 vs 磁盘」以满足 POPULATED 可追溯性，
    // 避免 CREATE + 已有 architecture.md 时触发 diff_for_populated_provided BLOCKER。
    const templateHash = tplText !== null ? sha256(tplText) : null;
    return {
      index: 4,
      target_path: targetRel,
      template_source: tplRel,
      status: 'POPULATED',
      hash_template: templateHash,
      hash_target: sha256(targetBuf),
      diff_summary: tplText === null
        ? '骨架模板不可读'
        : 'CREATE：无 framework.config.json，无法渲染占位符骨架；仅能对比磁盘 architecture.md 与未渲染 skeleton 哈希（非字节级统一 diff）。',
      planned_strategy: strategyText(4, 'POPULATED'),
      diagnosis:
        tplText === null ? '骨架模板不可读' : '无法生成默认占位符骨架进行等价 diff；记为 POPULATED',
    };
  }
  const rendered = renderTemplate(tplText, env.renderEnv);
  const comparison = compareTextArtifact(rendered, targetBuf);
  if (comparison.kind === 'byte_equal' || comparison.kind === 'eol_only') {
    return {
      index: 4,
      target_path: targetRel,
      template_source: tplRel,
      status: 'EMPTY',
      hash_template: comparison.templateHash,
      hash_target: comparison.targetHash,
      diff_summary: comparison.kind === 'byte_equal' ? 'no diff' : eolOnlyDiffSummary(),
      planned_strategy: strategyText(4, 'EMPTY'),
      diagnosis: comparison.kind === 'byte_equal'
        ? '与渲染后骨架字节相等'
        : '与渲染后骨架仅换行符不同，已忽略',
    };
  }
  return {
    index: 4,
    target_path: targetRel,
    template_source: tplRel,
    status: 'POPULATED',
    hash_template: comparison.templateHash,
    hash_target: comparison.targetHash,
    diff_summary: unifiedDiffSummary(comparison.templateText, comparison.targetText, 50),
    planned_strategy: strategyText(4, 'POPULATED'),
    diagnosis: '已被用户编辑（与默认骨架不一致）',
  };
}

// ---- 第 5 项: doc/module-catalog.yaml --------------------------------------
function inspect05(env: InspectorEnv): Inspection {
  const targetRel = env.cfg.paths.module_catalog;
  const targetAbs = path.join(env.projectRoot, targetRel);
  const txt = safeReadText(targetAbs);
  if (txt === null) {
    return {
      index: 5,
      target_path: targetRel,
      template_source: null,
      status: 'MISSING',
      hash_template: null,
      hash_target: null,
      diff_summary: null,
      planned_strategy: strategyText(5, 'MISSING'),
      diagnosis: `${targetRel} 不存在`,
    };
  }
  let parsed: any;
  try { parsed = YAML.parse(txt); } catch (e) {
    return {
      index: 5,
      target_path: targetRel,
      template_source: null,
      status: 'POPULATED',
      hash_template: null,
      hash_target: sha256(txt),
      diff_summary: `YAML 解析失败：${(e as Error).message}`,
      planned_strategy: strategyText(5, 'POPULATED'),
      diagnosis: 'YAML 解析失败（永不覆盖，需用户排查）',
    };
  }
  const modules = Array.isArray(parsed?.modules) ? parsed.modules : [];
  if (modules.length === 0) {
    return {
      index: 5,
      target_path: targetRel,
      template_source: null,
      status: 'EMPTY',
      hash_template: null,
      hash_target: sha256(txt),
      diff_summary: null,
      planned_strategy: strategyText(5, 'EMPTY'),
      diagnosis: 'modules: [] 空骨架',
    };
  }
  return {
    index: 5,
    target_path: targetRel,
    template_source: null,
    status: 'POPULATED',
    hash_template: null,
    hash_target: sha256(txt),
    diff_summary: null,
    planned_strategy: strategyText(5, 'POPULATED'),
    diagnosis: `已积累 ${modules.length} 个 module 画像`,
  };
}

// ---- 第 6 项: doc/glossary.yaml --------------------------------------------
function inspect06(env: InspectorEnv): Inspection {
  const targetRel = env.cfg.paths.glossary;
  const targetAbs = path.join(env.projectRoot, targetRel);
  const txt = safeReadText(targetAbs);
  if (txt === null) {
    return {
      index: 6,
      target_path: targetRel,
      template_source: null,
      status: 'MISSING',
      hash_template: null,
      hash_target: null,
      diff_summary: null,
      planned_strategy: strategyText(6, 'MISSING'),
      diagnosis: `${targetRel} 不存在`,
    };
  }
  let parsed: any;
  try { parsed = YAML.parse(txt); } catch (e) {
    return {
      index: 6,
      target_path: targetRel,
      template_source: null,
      status: 'POPULATED',
      hash_template: null,
      hash_target: sha256(txt),
      diff_summary: `YAML 解析失败：${(e as Error).message}`,
      planned_strategy: strategyText(6, 'POPULATED'),
      diagnosis: 'YAML 解析失败（永不覆盖，需用户排查）',
    };
  }
  const terms = Array.isArray(parsed?.terms) ? parsed.terms : [];
  if (terms.length === 0) {
    return {
      index: 6,
      target_path: targetRel,
      template_source: null,
      status: 'EMPTY',
      hash_template: null,
      hash_target: sha256(txt),
      diff_summary: null,
      planned_strategy: strategyText(6, 'EMPTY'),
      diagnosis: 'terms: [] 空骨架',
    };
  }
  return {
    index: 6,
    target_path: targetRel,
    template_source: null,
    status: 'POPULATED',
    hash_template: null,
    hash_target: sha256(txt),
    diff_summary: null,
    planned_strategy: strategyText(6, 'POPULATED'),
    diagnosis: `已积累 ${terms.length} 个术语`,
  };
}

// ---- 第 7 项: doc/glossary-seed.txt ----------------------------------------
function inspect07(env: InspectorEnv): Inspection {
  const targetRel = env.cfg.paths.glossary_seed;
  const targetAbs = path.join(env.projectRoot, targetRel);
  const tplRel = 'skills/00-framework-init/templates/glossary-seed.skeleton.txt';
  const tplAbs = path.join(FRAMEWORK_ROOT, tplRel);

  const tgBuf = safeReadBuffer(targetAbs);
  const tplBuf = safeReadBuffer(tplAbs);
  if (tgBuf === null) {
    return {
      index: 7,
      target_path: targetRel,
      template_source: tplRel,
      status: 'MISSING',
      hash_template: tplBuf !== null ? sha256(tplBuf) : null,
      hash_target: null,
      diff_summary: null,
      planned_strategy: strategyText(7, 'MISSING'),
      diagnosis: `${targetRel} 不存在`,
    };
  }
  if (tplBuf === null) {
    return {
      index: 7,
      target_path: targetRel,
      template_source: tplRel,
      status: 'POPULATED',
      hash_template: null,
      hash_target: sha256(tgBuf),
      diff_summary: '骨架模板不可读',
      planned_strategy: strategyText(7, 'POPULATED'),
      diagnosis: '骨架模板不可读，记为 POPULATED',
    };
  }
  const comparison = compareTextArtifact(tplBuf, tgBuf);
  if (comparison.kind === 'byte_equal' || comparison.kind === 'eol_only') {
    return {
      index: 7,
      target_path: targetRel,
      template_source: tplRel,
      status: 'EMPTY',
      hash_template: comparison.templateHash,
      hash_target: comparison.targetHash,
      diff_summary: comparison.kind === 'byte_equal' ? 'no diff' : eolOnlyDiffSummary(),
      planned_strategy: strategyText(7, 'EMPTY'),
      diagnosis: comparison.kind === 'byte_equal'
        ? '与骨架字节相等'
        : '与骨架仅换行符不同，已忽略',
    };
  }
  return {
    index: 7,
    target_path: targetRel,
    template_source: tplRel,
    status: 'POPULATED',
    hash_template: comparison.templateHash,
    hash_target: comparison.targetHash,
    diff_summary: unifiedDiffSummary(comparison.templateText, comparison.targetText, 50),
    planned_strategy: strategyText(7, 'POPULATED'),
    diagnosis: '已被用户编辑（与骨架不一致）',
  };
}

// ---- 第 8 项: doc/features/ ------------------------------------------------
function inspect08(env: InspectorEnv): Inspection {
  const targetRel = env.cfg.paths.features_dir;
  const targetAbs = path.join(env.projectRoot, targetRel);
  if (!existsAbs(targetAbs)) {
    return {
      index: 8,
      target_path: targetRel + '/',
      template_source: null,
      status: 'MISSING',
      hash_template: null,
      hash_target: null,
      diff_summary: null,
      planned_strategy: strategyText(8, 'MISSING'),
      diagnosis: '目录不存在',
    };
  }
  if (!isDir(targetAbs)) {
    return {
      index: 8,
      target_path: targetRel + '/',
      template_source: null,
      status: 'POPULATED',
      hash_template: null,
      hash_target: null,
      diff_summary: null,
      planned_strategy: strategyText(8, 'POPULATED'),
      diagnosis: `路径存在但不是目录：${targetRel}`,
    };
  }
  const entries = fs.readdirSync(targetAbs).filter(n => n !== '.gitkeep');
  if (entries.length === 0) {
    return {
      index: 8,
      target_path: targetRel + '/',
      template_source: null,
      status: 'EMPTY',
      hash_template: null,
      hash_target: null,
      diff_summary: null,
      planned_strategy: strategyText(8, 'EMPTY'),
      diagnosis: '空目录或仅含 .gitkeep',
    };
  }
  return {
    index: 8,
    target_path: targetRel + '/',
    template_source: null,
    status: 'POPULATED',
    hash_template: null,
    hash_target: null,
    diff_summary: null,
    planned_strategy: strategyText(8, 'POPULATED'),
    diagnosis: `已含 ${entries.length} 个 feature 子项`,
  };
}

// ---- 第 9 项: framework/harness/node_modules/ts-node/package.json ----------
// 严格用 fs.existsSync——避免 .gitignore 假阴（修了上次 81d454c 的事故）。
function inspect09(_env: InspectorEnv): Inspection {
  const targetRel = 'framework/harness/node_modules/ts-node/package.json';
  const targetAbs = path.join(HARNESS_ROOT, 'node_modules', 'ts-node', 'package.json');
  const exists = fs.existsSync(targetAbs);
  if (!exists) {
    return {
      index: 9,
      target_path: targetRel,
      template_source: null,
      status: 'MISSING',
      hash_template: null,
      hash_target: null,
      diff_summary: null,
      planned_strategy: strategyText(9, 'MISSING'),
      diagnosis: 'ts-node 未安装（Step 5.5 将 npm install）',
    };
  }
  return {
    index: 9,
    target_path: targetRel,
    template_source: null,
    status: 'POPULATED',
    hash_template: null,
    hash_target: null,
    diff_summary: null,
    planned_strategy: strategyText(9, 'POPULATED'),
    diagnosis: 'ts-node 已安装（fs.existsSync 命中）',
  };
}

// ---- 第 10 项: toolchain.devEcoStudio.installPath --------------------------
function inspect10(env: InspectorEnv): Inspection {
  const targetRel = 'framework.config.json:toolchain.devEcoStudio.installPath';
  const installPath = env.cfg.toolchainInstallPath;
  if (!installPath) {
    return {
      index: 10,
      target_path: targetRel,
      template_source: null,
      status: 'MISSING',
      hash_template: null,
      hash_target: null,
      diff_summary: null,
      planned_strategy: strategyText(10, 'MISSING'),
      diagnosis: '字段缺失或为空字符串',
    };
  }
  const exists = existsAbs(installPath);
  if (!exists) {
    return {
      index: 10,
      target_path: targetRel,
      template_source: null,
      status: 'MISSING',
      hash_template: null,
      hash_target: null,
      diff_summary: null,
      planned_strategy: strategyText(10, 'MISSING'),
      diagnosis: `installPath="${installPath}" 在文件系统中不存在`,
    };
  }
  return {
    index: 10,
    target_path: targetRel,
    template_source: null,
    status: 'POPULATED',
    hash_template: null,
    hash_target: null,
    diff_summary: null,
    planned_strategy: strategyText(10, 'POPULATED'),
    diagnosis: `installPath="${installPath}" 路径存在`,
  };
}

// ---- 第 11 项: 实例工程根 .gitignore（init 约定忽略项：harness 产物 + Skill 0 staging）----
function parseGitignoreLines(text: string): string[] {
  // 移除注释行 / 空白行；保留模式（含 ! 反向规则）。
  return text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#'));
}

function patternIsCovered(canonical: string, lines: string[]): boolean {
  const equiv = IGNORE_EQUIV_PATTERNS[canonical] ?? [canonical];
  return equiv.some(p => lines.includes(p));
}

function inspect11(env: InspectorEnv): Inspection {
  const targetRel = '.gitignore';
  const targetAbs = path.join(env.projectRoot, targetRel);
  const txt = safeReadText(targetAbs);
  if (txt === null) {
    return {
      index: 11,
      target_path: targetRel + ' (init canonical ignores)',
      template_source: null,
      status: 'MISSING',
      hash_template: null,
      hash_target: null,
      diff_summary: null,
      planned_strategy: strategyText(11, 'MISSING'),
      diagnosis: '.gitignore 不存在',
    };
  }
  const lines = parseGitignoreLines(txt);
  const missingPatterns: string[] = [];
  for (const p of CANONICAL_IGNORE_PATTERNS) {
    if (!patternIsCovered(p, lines)) {
      missingPatterns.push(p);
    }
  }
  if (missingPatterns.length === 0) {
    return {
      index: 11,
      target_path: targetRel + ' (init canonical ignores)',
      template_source: null,
      status: 'POPULATED',
      hash_template: null,
      hash_target: sha256(txt),
      diff_summary: null,
      planned_strategy: strategyText(11, 'POPULATED'),
      diagnosis: `Step 5.4.5：${CANONICAL_IGNORE_PATTERNS.length} 条 canonical patterns 已全部等价覆盖`,
    };
  }
  return {
    index: 11,
    target_path: targetRel + ' (init canonical ignores)',
    template_source: null,
    status: 'MISSING',
    hash_template: null,
    hash_target: sha256(txt),
    diff_summary: `缺少 patterns:\n${missingPatterns.map(p => `  - ${p}`).join('\n')}`,
    planned_strategy: strategyText(11, 'MISSING'),
    diagnosis: `缺 ${missingPatterns.length} 条 canonical pattern（.gitignore 已存在但未覆盖完整）`,
  };
}

/**
 * adapter.yaml 中声明为 auto_overwrite 的模板：在 init 脚本 harness PASS 后，
 * 将实例根目标与 framework 模板对齐；已存在且内容不同则先备份至 .framework-backup/<UTC>/
 */
function applyInitMechanismSync(
  projectRoot: string,
  adapter: AdapterDescriptor,
): { syncedFiles: number; backupRelDir: string | null } {
  if (process.env.CHECK_INIT_SKIP_MECHANISM_SYNC === '1') {
    return { syncedFiles: 0, backupRelDir: null };
  }

  let syncedFiles = 0;
  let backupRelDir: string | null = null;

  for (const f of adapter.templateFiles) {
    if (f.update_policy !== 'auto_overwrite') continue;

    const tplAbs = path.join(FRAMEWORK_ROOT, f.templateRel);
    const tgAbs = path.join(projectRoot, f.targetRel);
    const tplBuf = safeReadBuffer(tplAbs);
    if (tplBuf === null) {
      process.stderr.write(`[check-init] mechanism sync skip（模板缺失）：${f.templateRel}\n`);
      continue;
    }

    const tgBuf = safeReadBuffer(tgAbs);
    if (tgBuf === null) {
      fs.mkdirSync(path.dirname(tgAbs), { recursive: true });
      fs.writeFileSync(tgAbs, tplBuf);
      syncedFiles++;
      continue;
    }

    const cmp = compareTextArtifact(tplBuf, tgBuf);
    if (cmp.kind === 'byte_equal' || cmp.kind === 'eol_only') {
      continue;
    }

    if (!backupRelDir) {
      const stamp = nowStamp();
      backupRelDir = `.framework-backup/${stamp}`;
      fs.mkdirSync(path.join(projectRoot, backupRelDir), { recursive: true });
    }
    const backupAbs = path.join(projectRoot, backupRelDir, f.targetRel);
    fs.mkdirSync(path.dirname(backupAbs), { recursive: true });
    fs.copyFileSync(tgAbs, backupAbs);
    fs.writeFileSync(tgAbs, tplBuf);
    syncedFiles++;
  }

  return { syncedFiles, backupRelDir };
}

/**
 * 与 SKILL 00 · §0.3.4.1 对齐：`auto_overwrite` 的 adapter 机制段已由 check-init 在 PASS 后自动对齐，
 * 不进入结构化 Q 收集；此处返回「实际需要用户在 0.3.4 收 y/n」的 inspection 行。
 */
export function inspectionsForInit034Prompt(inspections: Inspection[]): Inspection[] {
  return inspections.filter(ins => {
    if (ins.status !== 'POPULATED') return false;
    if (ins.index === 1 || ins.index === 2) return true;
    if (ins.index === 3) return ins.update_policy !== 'auto_overwrite';
    return false;
  });
}

// --------------------------------------------------------------------------
// 主流程
// --------------------------------------------------------------------------

function resolveAdapterName(ctx: CheckContext, cfg: RawFrameworkConfig): {
  name: string | null;
  source: string;
} {
  // 优先 CLI --adapter；UPDATE 模式回落到 framework.config.json.agent_adapter
  const cli = (ctx.adapter ?? '').trim();
  if (cli) return { name: cli, source: 'cli_flag:--adapter' };
  if (cfg.agentAdapter) return { name: cfg.agentAdapter, source: 'framework.config.json:agent_adapter' };
  return { name: null, source: '' };
}

function buildStdoutTable(report: CheckInitReport): string {
  // SKILL 0.3.3 体检表（6 列；#3 可展开）
  const header = [
    `Init 体检报告 [mode=${report.mode}, adapter=${report.adapter ?? 'N/A'}]`,
    `生成时间: ${report.generated_at}`,
    `verdict: ${report.verdict}${report.blockers.length > 0 ? `（${report.blockers.length} BLOCKER）` : ''}`,
  ].join('\n');

  const cols = ['#', '产物', '状态', 'update_policy', '计划动作', '诊断'];
  const policyCol = (i: Inspection): string => {
    if (i.index !== 3) return '—';
    if (i.update_policy === 'auto_overwrite') return 'auto_overwrite';
    if (i.update_policy === 'prompt_if_changed') return 'prompt_if_changed';
    return '—';
  };
  const rows: string[][] = report.inspections.map(i => [
    String(i.index),
    i.target_path,
    i.status,
    policyCol(i),
    i.planned_strategy,
    i.diagnosis,
  ]);
  const widths = cols.map((c, idx) =>
    Math.max(c.length, ...rows.map(r => visualWidth(r[idx]))),
  );

  function pad(s: string, w: number): string {
    const vis = visualWidth(s);
    if (vis >= w) return s;
    return s + ' '.repeat(w - vis);
  }

  const fmtRow = (r: string[]): string =>
    '| ' + r.map((c, i) => pad(c, widths[i])).join(' | ') + ' |';

  const sep = '|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|';

  const lines: string[] = [header, '', fmtRow(cols), sep, ...rows.map(fmtRow)];

  if (report.blockers.length > 0) {
    lines.push('');
    lines.push('BLOCKER:');
    report.blockers.forEach(b => lines.push(`  - ${b}`));
  }
  return lines.join('\n');
}

/** 估算字符串可视宽度（CJK 字符按 2，其他按 1）。 */
function visualWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    // U+4E00–U+9FFF（CJK 基础），U+3000–U+303F（CJK 标点），U+FF00–U+FFEF（半全角）
    const cp = ch.codePointAt(0) ?? 0;
    if (
      (cp >= 0x4E00 && cp <= 0x9FFF) ||
      (cp >= 0x3000 && cp <= 0x303F) ||
      (cp >= 0xFF00 && cp <= 0xFFEF) ||
      (cp >= 0x2E80 && cp <= 0x2EFF) ||
      (cp >= 0xAC00 && cp <= 0xD7A3) ||
      (cp >= 0x3040 && cp <= 0x30FF)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

function writeJsonReport(harnessRoot: string, report: CheckInitReport): string {
  const stamp = nowStamp();
  const dir = path.join(harnessRoot, 'reports', '_global', 'init', stamp);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'check-init.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf-8');
  return file;
}

// --------------------------------------------------------------------------
// PhaseChecker 实现
// --------------------------------------------------------------------------

const checker: PhaseChecker = {
  phase: 'init',

  async check(ctx: CheckContext): Promise<CheckResult[]> {
    const cfg = loadRawFrameworkConfig(ctx.projectRoot);
    const mode: InitMode = cfg.exists && cfg.parseable ? 'update' : 'create';

    const adapterPick = resolveAdapterName(ctx, cfg);
    const blockers: string[] = [];

    // 1. adapter_yaml_resolvable
    let adapter: AdapterDescriptor | null = null;
    let adapterCheckResult: CheckResult;
    if (!adapterPick.name) {
      adapterCheckResult = {
        id: 'adapter_yaml_resolvable',
        category: 'structure',
        description: '选定 adapter 的 adapter.yaml 必须可解析',
        severity: 'BLOCKER',
        status: 'FAIL',
        details: 'adapter 未指定：CREATE 模式下必须显式传 --adapter；UPDATE 模式下需 framework.config.json.agent_adapter 字段。',
        suggestion: '在命令行追加 --adapter <实例所选 adapter 目录名>，或检查 framework.config.json 的 agent_adapter 字段（须与 framework/agents/* 对齐）',
      };
      blockers.push('adapter_yaml_resolvable: adapter 未指定');
    } else {
      adapter = loadAdapter(adapterPick.name);
      if (!adapter.yamlExists) {
        adapterCheckResult = {
          id: 'adapter_yaml_resolvable',
          category: 'structure',
          description: '选定 adapter 的 adapter.yaml 必须可解析',
          severity: 'BLOCKER',
          status: 'FAIL',
          details: `framework/agents/${adapter.name}/adapter.yaml 不存在`,
          affected_files: [`framework/agents/${adapter.name}/adapter.yaml`],
        };
        blockers.push(`adapter_yaml_resolvable: framework/agents/${adapter.name}/adapter.yaml 不存在`);
      } else if (!adapter.yamlParseable) {
        adapterCheckResult = {
          id: 'adapter_yaml_resolvable',
          category: 'structure',
          description: '选定 adapter 的 adapter.yaml 必须可解析',
          severity: 'BLOCKER',
          status: 'FAIL',
          details: `adapter.yaml 解析失败：${adapter.parseError ?? '未知'}`,
          affected_files: [path.relative(ctx.projectRoot, adapter.yamlPath).replace(/\\/g, '/')],
        };
        blockers.push(`adapter_yaml_resolvable: ${adapter.parseError ?? '解析失败'}`);
      } else {
        adapterCheckResult = {
          id: 'adapter_yaml_resolvable',
          category: 'structure',
          description: '选定 adapter 的 adapter.yaml 必须可解析',
          severity: 'BLOCKER',
          status: 'PASS',
          details: `adapter=${adapter.name}（来源: ${adapterPick.source}），entry=${adapter.entryFile?.targetRel ?? '<none>'}，模板文件 ${adapter.templateFiles.length} 个`,
        };
      }
    }

    // 2. template_files_resolvable
    let tplResolveResult: CheckResult;
    if (adapter && adapter.yamlParseable) {
      const broken = adapter.declaredTemplatePaths.filter(p => !p.exists);
      if (broken.length === 0) {
        tplResolveResult = {
          id: 'template_files_resolvable',
          category: 'structure',
          description: 'adapter.yaml 声明的所有 template_path/template_dir 必须真实存在',
          severity: 'BLOCKER',
          status: 'PASS',
          details: `${adapter.declaredTemplatePaths.length} 条 template 路径全部可定位`,
        };
      } else {
        tplResolveResult = {
          id: 'template_files_resolvable',
          category: 'structure',
          description: 'adapter.yaml 声明的所有 template_path/template_dir 必须真实存在',
          severity: 'BLOCKER',
          status: 'FAIL',
          details: `${broken.length} 条 template 路径不存在：\n` +
            broken.map(b => `  - [${b.field}] ${path.relative(FRAMEWORK_ROOT, b.abs).replace(/\\/g, '/')}`).join('\n'),
          affected_files: broken.map(b => path.relative(FRAMEWORK_ROOT, b.abs).replace(/\\/g, '/')),
          suggestion: '检查 adapter.yaml 字段是否拼写错误，或对应模板尚未在 framework/agents/<adapter>/templates/ 下添加',
        };
        blockers.push(`template_files_resolvable: ${broken.length} template paths missing`);
      }
    } else {
      // adapter 不可用 → 跳过本检查
      tplResolveResult = {
        id: 'template_files_resolvable',
        category: 'structure',
        description: 'adapter.yaml 声明的所有 template_path/template_dir 必须真实存在',
        severity: 'BLOCKER',
        status: 'SKIP',
        details: 'adapter 不可用，跳过模板路径解析',
      };
    }

    // 3. 跑 11 项体检
    const renderEnv = buildRenderEnv(cfg, adapter);
    const inspectorEnv: InspectorEnv = {
      projectRoot: ctx.projectRoot,
      cfg,
      adapter,
      renderEnv,
    };
    const inspections: Inspection[] = [
      inspect01(inspectorEnv),
      inspect02(inspectorEnv),
      ...inspect03(inspectorEnv),
      inspect04(inspectorEnv),
      inspect05(inspectorEnv),
      inspect06(inspectorEnv),
      inspect07(inspectorEnv),
      inspect08(inspectorEnv),
      inspect09(inspectorEnv),
      inspect10(inspectorEnv),
      inspect11(inspectorEnv),
    ];

    // 4. inspection_table_complete
    const incomplete = inspections.filter(i =>
      !['MISSING', 'EMPTY', 'POPULATED'].includes(i.status));
    const shapeOk = validateInspectionShape(inspections);
    const tableCompleteResult: CheckResult =
      incomplete.length === 0 && shapeOk
        ? {
          id: 'inspection_table_complete',
          category: 'structure',
          description: '基线体检项（含第 3 项可展开）全部能给出 MISSING/EMPTY/POPULATED 判定且行数合法',
          severity: 'BLOCKER',
          status: 'PASS',
          details: `判定齐全：共 ${inspections.length} 行（索引 1–2、4–11 各恰好 1 行；索引 3≥1 行）`,
        }
        : (() => {
          const parts: string[] = [];
          if (incomplete.length > 0) {
            blockers.push(`inspection_table_complete: ${incomplete.length} 行无法判定`);
            parts.push(`${incomplete.length} 行状态非法：\n` +
              incomplete.map(i => `  - #${i.index} ${i.target_path}`).join('\n'));
          }
          if (!shapeOk) {
            blockers.push('inspection_table_complete: 体检行数/shape 不符合基线（应为 #1 #2 各 1 行、#3≥1 行、#4–#11 各 1 行）');
            parts.push('索引 1–2、4–11 须各出现恰好 1 行；索引 3 须至少 1 行（可展开多行）');
          }
          return {
            id: 'inspection_table_complete',
            category: 'structure',
            description: '基线体检项（含第 3 项可展开）shape 与三态合法',
            severity: 'BLOCKER',
            status: 'FAIL',
            details: parts.join('\n\n'),
          };
        })();

    // 5. diff_for_populated_provided
    const diffMissing = inspections.filter(i => {
      if (i.status !== 'POPULATED') return false;
      // 只对"有 template 对照"的项要求 hash + diff（第 2/3/4/7 项）
      if (![2, 3, 4, 7].includes(i.index)) return false;
      return !i.hash_template || !i.hash_target || !i.diff_summary;
    });
    const diffResult: CheckResult = diffMissing.length === 0
      ? {
          id: 'diff_for_populated_provided',
          category: 'traceability',
          description: '每个 POPULATED 模板项必须附带 hash + diff_summary',
          severity: 'BLOCKER',
          status: 'PASS',
          details: 'POPULATED 模板项的 hash 与 diff_summary 字段齐全',
        }
      : (() => {
          blockers.push(`diff_for_populated_provided: ${diffMissing.length} 项缺 hash/diff`);
          return {
            id: 'diff_for_populated_provided',
            category: 'traceability',
            description: '每个 POPULATED 模板项必须附带 hash + diff_summary',
            severity: 'BLOCKER',
            status: 'FAIL',
            details: `${diffMissing.length} 项 POPULATED 模板项缺字段：\n` +
              diffMissing.map(i => `  - #${i.index} ${i.target_path}`).join('\n'),
          };
        })();

    // 6. 装配 check-init.json + stdout 体检表（#3 可展开多行；check-init.json schema_version 1.1）
    const verdict: 'PASS' | 'FAIL' = blockers.length > 0 ? 'FAIL' : 'PASS';

    let mechanism_backup_rel_dir: string | null = null;
    let mechanism_synced_files = 0;
    if (verdict === 'PASS' && adapter) {
      const syncOutcome = applyInitMechanismSync(ctx.projectRoot, adapter);
      mechanism_backup_rel_dir = syncOutcome.backupRelDir;
      mechanism_synced_files = syncOutcome.syncedFiles;
    }

    const reportBase: Omit<CheckInitReport, keyof {
      mechanism_backup_rel_dir?: string | null;
      mechanism_synced_files?: number;
    }> = {
      schema_version: '1.1',
      mode,
      adapter: adapterPick.name,
      inspections,
      blockers,
      verdict,
      generated_at: new Date().toISOString(),
    };
    const report: CheckInitReport =
      verdict === 'PASS'
        ? {
            ...reportBase,
            mechanism_backup_rel_dir,
            mechanism_synced_files,
          }
        : reportBase;

    let writtenPath: string | null = null;
    try {
      writtenPath = writeJsonReport(HARNESS_ROOT, report);
    } catch (e) {
      // 写报告失败不影响判定，但要记录
      console.error(`[check-init] 写 check-init.json 失败：${(e as Error).message}`);
    }

    // stdout 体检表（被 SKILL 0.3.3 原样搬运）。环境变量 CHECK_INIT_QUIET=1 时
    // 抑制（fixture 单测使用，避免污染 jest 输出）。
    if (!process.env.CHECK_INIT_QUIET) {
      console.log('\n========== check-init: SKILL 0.3.3 体检表（脚本生成，AI 仅搬运） ==========');
      console.log(buildStdoutTable(report));
      if (writtenPath) {
        console.log(`\nJSON 报告: ${path.relative(ctx.projectRoot, writtenPath).replace(/\\/g, '/')}`);
      }
      console.log('========== end check-init ==========\n');
    }

    // 7. 返回 CheckResult[]：4 个聚合检查 + 11 个 inspection 详情（INFO 级别）
    const results: CheckResult[] = [
      adapterCheckResult,
      tplResolveResult,
      tableCompleteResult,
      diffResult,
    ];
    for (const ins of inspections) {
      const policyTag =
        ins.index === 3 && ins.update_policy
          ? ` update_policy=${ins.update_policy}`
          : '';
      results.push({
        id: `inspection_${String(ins.index).padStart(2, '0')}_${shortKey(ins.target_path)}`,
        category: 'traceability',
        description: `#${ins.index} ${ins.target_path}`,
        severity: 'MINOR',
        status: ins.status === 'MISSING' ? 'WARN' : 'PASS', // 状态非裁定，只为可读
        details: `[${ins.status}]${policyTag} ${ins.diagnosis}` +
          (ins.diff_summary && ins.diff_summary !== 'no diff'
            ? `\n${truncate(ins.diff_summary, 600)}`
            : ''),
      });
    }
    return results;
  },
};

function shortKey(p: string): string {
  return p
    .replace(/[\\\/<>:".|? *]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 60);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '… (truncated)';
}

export default checker;

// --------------------------------------------------------------------------
// 给单测使用的导出 —— 只暴露纯函数 / 装载器，不暴露内部状态
// --------------------------------------------------------------------------

export const __testing = {
  loadRawFrameworkConfig,
  loadAdapter,
  buildRenderEnv,
  renderTemplate,
  inspect01,
  inspect02,
  inspect03,
  inspect04,
  inspect05,
  inspect06,
  inspect07,
  inspect08,
  inspect09,
  inspect10,
  inspect11,
  buildStdoutTable,
  unifiedDiffSummary,
  normalizeEol,
  compareTextArtifact,
  CANONICAL_IGNORE_PATTERNS,
  IGNORE_EQUIV_PATTERNS,
  parseUpdatePolicy,
  inspectionsForInit034Prompt,
  applyInitMechanismSync,
};
