// 实际实现域与原需求范围共享判定。文件/模块预测只作线索；写入归属由阶段观察负责。
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { resolveProbeFrameworkRoot } from '../../repo-layout';
import { loadFrameworkConfig, getOuterLayerIds } from '../../config';
import { loadCatalog, findModule } from './catalog-parser';
import { diffChangedFilesWithStatus, readFileAtRef, type StatusDiffEntry } from './git-diff';
import { parseScope } from './scope-parser';
import { isInsideProjectRoot, validateProjectRelativePath } from './project-relative-path';
import type { ContractsSpec, ContextFileEntry, FeatureSpec } from './types';
import type { ResolvedPhaseInputs } from './capability-resolution';

// --------------------------------------------------------------------------
// 层级前缀与分类
// --------------------------------------------------------------------------

/**
 * "架构层级目录前缀"由 framework.config.json 的 outer_layers[].id 推导，
 * 每个 layer id 被追加 "/" 作为顶层目录前缀。
 */
export function layerDirPrefixes(projectRoot: string): string[] {
  return getOuterLayerIds(loadFrameworkConfig(projectRoot).architecture).map(id => `${id}/`);
}

export function isUnderLayerDir(relPath: string, prefixes: string[]): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  return prefixes.some(prefix => normalized.startsWith(prefix));
}

export interface DiffScopeClassification {
  /** 层目录下且不在任何 in_scope 模块前缀内（越界） */
  violations: string[];
  /** 层目录下且命中 in_scope 模块前缀 */
  inScopeHits: string[];
  /** 不在任何层目录下（框架性/文档等中性变更） */
  neutralCount: number;
}

export function classifyChangedFiles(
  files: string[],
  allowedPrefixes: string[],
  layerPrefixes: string[],
): DiffScopeClassification {
  const violations: string[] = [];
  const inScopeHits: string[] = [];
  let neutralCount = 0;
  for (const file of files) {
    const normalized = file.replace(/\\/g, '/');
    if (!isUnderLayerDir(normalized, layerPrefixes)) {
      neutralCount++;
      continue;
    }
    const hit = allowedPrefixes.find(p => normalized.startsWith(p));
    if (hit) inScopeHits.push(normalized);
    else violations.push(normalized);
  }
  return { violations, inScopeHits, neutralCount };
}

// --------------------------------------------------------------------------
// 模块名 → 路径前缀解析（施工范围与责任边界共享）
// --------------------------------------------------------------------------

/** 规范化为目录前缀：正斜杠 + 恰一个尾随 "/" */
function toDirPrefix(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '') + '/';
}

export interface ModulePrefixResolution {
  /** 已解析出的 in_scope 模块目录前缀（正斜杠、含尾随 /） */
  allowedPrefixes: string[];
  /** 无法映射到路径前缀的模块名（fail-closed 判定的证据） */
  unmapped: string[];
  /** moduleName → 目录前缀（已解析成功的模块） */
  prefixByModule: Map<string, string>;
  /** moduleName → 映射来源描述（contracts / catalog.entry_file / layer-dir） */
  sources: Map<string, string>;
}

/**
 * 把 in_scope 模块名解析为目录前缀，三级回退：
 *   1. contracts.yaml modules[].package_path
 *   2. module-catalog.yaml modules[].entry_file 的 dirname（catalog 是模块画像 SSOT）
 *   3. `<layer>/<name>/` 目录在磁盘上真实存在（catalog 有卡片但缺 entry_file 时的
 *      保守回退——目录不存在则不猜，计入 unmapped）
 * 全部失败 → 计入 unmapped，由调用方按 fail-closed 语义处置。
 */
export function resolveModulePathPrefixes(
  projectRoot: string,
  moduleNames: string[],
  contractsModules?: Array<{ name?: string; package_path?: string }>,
): ModulePrefixResolution {
  const allowedPrefixes: string[] = [];
  const unmapped: string[] = [];
  const prefixByModule = new Map<string, string>();
  const sources = new Map<string, string>();

  const addMapping = (name: string, prefix: string, source: string): void => {
    allowedPrefixes.push(prefix);
    prefixByModule.set(name, prefix);
    sources.set(name, source);
  };

  const contractsByName = new Map<string, string>();
  for (const mod of contractsModules ?? []) {
    if (mod?.name && mod.package_path) contractsByName.set(mod.name, mod.package_path);
  }

  const catalogLoad = loadCatalog(projectRoot);
  const catalog = catalogLoad.ok ? catalogLoad.catalog : null;

  for (const name of moduleNames) {
    const fromContracts = contractsByName.get(name);
    if (fromContracts) {
      addMapping(name, toDirPrefix(fromContracts), `contracts.yaml package_path=${fromContracts}`);
      continue;
    }

    const card = catalog ? findModule(catalog, name) : undefined;
    if (card?.entry_file) {
      const dir = path.posix.dirname(card.entry_file.replace(/\\/g, '/'));
      if (dir && dir !== '.') {
        addMapping(name, toDirPrefix(dir), `catalog entry_file=${card.entry_file}`);
        continue;
      }
    }
    if (card?.layer) {
      const guess = `${card.layer}/${name}`;
      if (fs.existsSync(path.join(projectRoot, guess))) {
        addMapping(name, toDirPrefix(guess), `layer-dir ${guess}/（磁盘存在性验证）`);
        continue;
      }
    }

    unmapped.push(name);
  }

  return { allowedPrefixes, unmapped, prefixByModule, sources };
}

/** Project source domains are not the predicted set of modules for one implementation. */
export function projectImplementationModules(projectRoot: string,
  hints: Array<{ name?: string; package_path?: string }> = []): Array<{ name: string; package_path: string }> {
  const modules = new Map<string, { name: string; package_path: string }>();
  const add = (name: string, rel: string): void => {
    const safe = validateProjectRelativePath(projectRoot, rel, 'implementation module');
    const physical = fs.existsSync(path.join(projectRoot, safe)) ? fs.realpathSync(path.join(projectRoot, safe)) : path.resolve(projectRoot, safe);
    const relative = path.relative(fs.realpathSync(projectRoot), physical).split(path.sep).join('/');
    const identity = process.platform === 'win32' ? relative.toLowerCase() : relative;
    if (identity === 'framework' || identity.startsWith('framework/')) return;
    if (!modules.has(safe)) modules.set(safe, { name, package_path: safe });
  };
  for (const mod of hints) if (mod.name && mod.package_path) add(mod.name, mod.package_path);
  for (const prefix of layerDirPrefixes(projectRoot)) {
    const dir = path.join(projectRoot, prefix);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) add(entry.name, prefix + entry.name);
    }
  }
  return [...modules.values()].sort((a, b) => a.package_path.localeCompare(b.package_path));
}

/** Only a Scope in the original request is an explicit machine-readable restriction. */
export function resolveImplementationScope(projectRoot: string, feature: string,
  hints: Array<{ name?: string; package_path?: string }> = [], runId?: string, originalRequirement?: string) {
  const modules = projectImplementationModules(projectRoot, hints);
  const { collectCurrentRequirementText } = require('./fidelity-shared') as typeof import('./fidelity-shared');
  const requirement = originalRequirement ?? collectCurrentRequirementText(projectRoot, feature,
    loadFrameworkConfig(projectRoot).paths?.features_dir ?? 'doc/features', runId);
  const explicit = parseScope(requirement).scope;
  const selected = explicit ? modules.filter(module => explicit.in_scope_modules.includes(module.name)
    && !explicit.out_of_scope_modules.includes(module.name)) : modules;
  return { modules, sourcePrefixes: [...new Set([...layerDirPrefixes(projectRoot), ...modules.map(module => toDirPrefix(module.package_path))])], allowedPrefixes: selected.map(module => toDirPrefix(module.package_path)),
    explicit, requirement };
}

/** Default to HEAD against current bytes; the frozen run start is a historical reference. */
export function readCurrentImplementationDiff(projectRoot: string, runId?: string) {
  const { resolveHarnessDiffBaseRef } = require('./phase-state') as typeof import('./phase-state');
  return diffChangedFilesWithStatus({ projectRoot, baseRef: (!runId ? resolveHarnessDiffBaseRef() : undefined) ?? 'HEAD' });
}

/** Review material comes from the requirement's signed references and actual resolver dependencies. */
export function implementationPathSelector(projectRoot: string, contracts?: Pick<ContractsSpec, 'files' | 'modules'>,
  resolvedInputs?: ResolvedPhaseInputs, modules: readonly { package_path?: string }[] = contracts?.modules ?? []): (file: string) => boolean {
  const rel = (file: string) => path.relative(projectRoot, path.resolve(projectRoot, file)).replace(/\\/g, '/');
  const bound = Object.values(resolvedInputs?.values ?? {}).flatMap(input => input.state === 'resolved'
    && input.binding.source.kind === 'derive' && ['derive.codebase', 'derive.test-targets'].includes(input.binding.source.provider_id)
    ? input.binding.dependencies.filter(dep => dep.role === 'derive' && isInsideProjectRoot(projectRoot, dep.path)).map(dep => rel(dep.path)) : []);
  const files = new Set([...(contracts?.files ?? []).map(rel), ...bound]);
  const modulePrefixes = modules.flatMap(module => module.package_path ? [toDirPrefix(rel(module.package_path))] : []);
  return file => files.size > 0 ? files.has(rel(file)) : isUnderLayerDir(rel(file), modulePrefixes);
}

export function coveredReviewPaths(report: string, candidates: readonly string[]): string[] {
  const { getSectionContent } = require('./markdown-parser') as typeof import('./markdown-parser');
  const scope = (getSectionContent(report, '审查范围') ?? '').replace(/\\/g, '/');
  return candidates.filter(file => {
    const escaped = file.replace(/\\/g, '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\w./-])(?:\\./)?${escaped}(?![\\w./-])`).test(scope);
  });
}

/** Files explicitly used by the typed design or named in this feature's review coverage. */
export function implementationReviewReferences(projectRoot: string, feature: string, options: {
  frameworkRoot?: string; resolvedInputs?: ResolvedPhaseInputs; featureSpec?: Pick<FeatureSpec, 'feature' | 'referenceClosure'>;
} = {}): string[] {
  if (options.featureSpec && options.featureSpec.feature !== feature) throw new Error('review reference feature subject mismatch');
  const { SpecLoader } = require('./spec-loader') as typeof import('./spec-loader');
  const { resolveFeatureArtifact } = require('../../config') as typeof import('../../config');
  const { getSectionContent } = require('./markdown-parser') as typeof import('./markdown-parser');
  const reportFile = resolveFeatureArtifact(projectRoot, feature, 'review-report.md').actualPath;
  const spec = options.featureSpec ?? new SpecLoader(projectRoot, undefined, undefined,
    options.frameworkRoot ?? resolveProbeFrameworkRoot(projectRoot)).loadFeatureSpec(feature, options.resolvedInputs);
  const references = new Set(spec.referenceClosure?.references.map(reference => reference.path) ?? []);
  try {
    const report = fs.readFileSync(reportFile, 'utf8');
    const coverage = getSectionContent(report, '审查范围') ?? '';
    for (const token of coverage.match(/`[^`\r\n]+`|[^\s,;:，。；、：|<>(){}"'`]+/g) ?? []) {
      const file = token.replace(/^`|`$/g, '').replace(/\\/g, '/');
      if (!file.includes('/') || !path.posix.extname(file)) continue;
      try {
        const relative = path.posix.normalize(validateProjectRelativePath(projectRoot, file, 'review reference'));
        const absolute = path.resolve(projectRoot, relative);
        const stat = fs.statSync(absolute, { throwIfNoEntry: false });
        if (!stat || stat.isFile() && isInsideProjectRoot(fs.realpathSync(projectRoot), fs.realpathSync(absolute))) references.add(relative);
      } catch { /* Unusable text references are not source bindings. */ }
    }
  } catch { /* Existing report and input readers still diagnose missing review evidence. */ }
  return [...references].sort();
}

export function featureReviewCoverageDisclosure(projectRoot: string, feature: string): string {
  const { resolveFeatureArtifact } = require('../../config') as typeof import('../../config');
  let report = '';
  try { report = fs.readFileSync(resolveFeatureArtifact(projectRoot, feature, 'review-report.md').actualPath, 'utf8'); }
  catch { /* No readable coverage was declared. */ }
  return reviewCoverageDisclosure(projectRoot, [], report);
}

export function reviewCoverageDisclosure(projectRoot: string, reviewedPaths: readonly string[], reviewReport?: string): string {
  const diff = diffChangedFilesWithStatus({ projectRoot, baseRef: 'HEAD' });
  const reviewed = new Set(reviewedPaths.map(file => path.relative(projectRoot, path.resolve(projectRoot, file)).replace(/\\/g, '/')));
  const changed = [...new Set(diff.entries.flatMap(entry => [entry.path, ...(entry.oldPath ? [entry.oldPath] : [])]))];
  if (reviewReport) for (const file of coveredReviewPaths(reviewReport, changed)) reviewed.add(file);
  const pending = changed.filter(file => !reviewed.has(file)).sort();
  return '未纳入本次 review 的工作区改动：' + (!diff.executed ? '路径未取得' : pending.length ? pending.join('、') : '无');
}

/** Actual changed files plus existing planning references; never persisted as another inventory. */
export function implementationFiles(projectRoot: string, _feature: string, contracts?: Pick<ContractsSpec, 'files' | 'modules'>,
  runId?: string, changes?: readonly StatusDiffEntry[] | null, reviewReferences: readonly string[] = []): string[] {
  const explicitReview = changes !== undefined;
  if (changes === undefined) changes = readCurrentImplementationDiff(projectRoot, runId).entries;
  const inScope = implementationPathSelector(projectRoot, contracts);
  const reviewRefs = new Set(reviewReferences);
  const modules = implementationPathSelector(projectRoot, undefined, undefined, contracts?.modules);
  const fallback = !contracts?.files?.length && !contracts?.modules?.length ? layerDirPrefixes(projectRoot) : [];
  const relevant = (file: string) => explicitReview || inScope(file) || reviewRefs.has(file) || modules(file) || isUnderLayerDir(file, fallback);

  const files = new Set(contracts?.files ?? []);
  for (const entry of changes ?? []) {
    if (relevant(entry.path) || entry.oldPath && relevant(entry.oldPath)) files.add(entry.path);
  }
  return [...files].map(file => validateProjectRelativePath(projectRoot, file, 'implementation input'))
    .filter(file => fs.existsSync(path.join(projectRoot, file)) && fs.statSync(path.join(projectRoot, file)).isFile()).sort();
}

export interface ImplementationReviewChanges {
  entries: StatusDiffEntry[];
  contextFiles: ContextFileEntry[];
  preimages: Array<{ status: 'D' | 'R'; path: string; target?: string; sha256: string | null }>;
}

/** The presentation and identity use one observed diff and one read of each preimage. */
export function readImplementationReviewChanges(projectRoot: string, feature: string, options: {
  runId?: string; frameworkRoot?: string; resolvedInputs?: ResolvedPhaseInputs;
  modules?: Array<{ name?: string; package_path?: string }>; preimagesOnly?: boolean;
} = {}): ImplementationReviewChanges | null {
  try {
    const diff = readCurrentImplementationDiff(projectRoot, options.runId);
    if (!diff.executed || !diff.baseSha) return null;
    const candidates = options.preimagesOnly ? diff.entries.filter(entry => entry.status === 'D' || entry.status === 'R') : diff.entries;
    const { decodeTextFile, SpecLoader } = require('./spec-loader') as typeof import('./spec-loader');
    const frameworkRoot = options.frameworkRoot ?? resolveProbeFrameworkRoot(projectRoot);
    const featureSpec = new SpecLoader(projectRoot, undefined, undefined, frameworkRoot).loadFeatureSpec(feature, options.resolvedInputs);
    const contracts = featureSpec.contracts;
    const modules = options.modules ?? contracts?.modules ?? [];
    const inScope = implementationPathSelector(projectRoot, contracts, options.resolvedInputs, modules);
    const references = new Set(implementationReviewReferences(projectRoot, feature, { featureSpec }));
    const moduleChanges = implementationPathSelector(projectRoot, undefined, undefined, modules);
    const legacyPrefixes = !contracts?.files?.length && !modules.length ? layerDirPrefixes(projectRoot) : [];
    const scopedHistory = !options.runId && diff.baseRef !== 'HEAD';
    const used = (file: string) => inScope(file) || references.has(file) || isUnderLayerDir(file, legacyPrefixes)
      || scopedHistory && moduleChanges(file);
    const entries = candidates.filter(entry => used(entry.path) || !!entry.oldPath && used(entry.oldPath));
    const preimages: ImplementationReviewChanges['preimages'] = [];
    const contextFiles: ContextFileEntry[] = [];
    const root = fs.realpathSync(projectRoot);
    if (!options.preimagesOnly) {
      const nearby = candidates.filter(entry => !used(entry.path) && moduleChanges(entry.path)).map(entry => entry.path);
      if (nearby.length) contextFiles.push({ label: '(implementation review candidates)', content:
        '合同模块内还有这些差异。核查实际调用、注册或共享输入，仅把本次实际采用的文件写入审查范围：\n' + nearby.join('\n') });
    }
    if (entries.length && !options.preimagesOnly) contextFiles.push({ label: '(actual implementation changes)', kind: 'text',
      content: '逐项核对当前实现、验收条件和实际调用方。\n'
        + entries.map(entry => entry.status + ': ' + (entry.oldPath ? entry.oldPath + ' -> ' : '') + entry.path).join('\n') });
    for (const entry of entries) {
      const prior = entry.status === 'D' ? entry.path : entry.oldPath;
      if (prior) {
        const bytes = readFileAtRef(projectRoot, diff.baseSha, prior);
        if (entry.status === 'D' || entry.status === 'R') preimages.push({ status: entry.status, path: prior,
          ...(entry.status === 'R' ? { target: entry.path } : {}), sha256: bytes ? createHash('sha256').update(bytes).digest('hex') : null });
        if (!options.preimagesOnly) contextFiles.push({ label: '(before ' + diff.baseSha + ') ' + prior, kind: 'text',
          content: (bytes && decodeTextFile(bytes)) ?? (bytes ? '二进制旧原件，按此 Git 基线和路径核对。' : '基线旧原件不可读取，保留证据缺口。') });
      }
      if (entry.status === 'D' || options.preimagesOnly) continue;
      const abs = path.resolve(projectRoot, entry.path);
      try {
        if (!isInsideProjectRoot(projectRoot, abs) || !isInsideProjectRoot(root, fs.realpathSync(abs))) throw new Error('source leaves project');
        const content = decodeTextFile(fs.readFileSync(abs));
        if (content === null) contextFiles.push({ label: entry.path, kind: 'path', content: '实际变更的二进制原件' });
        else contextFiles.push({ label: entry.path, content, references: ['本轮实际变更'] });
      } catch {
        contextFiles.push({ label: '(implementation evidence gap)', content: entry.path + '：本轮实际变更原件不可读取。' });
      }
    }
    return { entries, contextFiles, preimages };
  } catch { return null; }
}

export function readImplementationChangeContext(projectRoot: string, feature: string, runId?: string, modules: Array<{ name?: string; package_path?: string }> = []): ContextFileEntry[] | null {
  return readImplementationReviewChanges(projectRoot, feature, { runId, modules })?.contextFiles ?? null;
}

export function implementationChangeContext(projectRoot: string, feature: string, runId?: string, modules: Array<{ name?: string; package_path?: string }> = []): ContextFileEntry[] {
  return readImplementationChangeContext(projectRoot, feature, runId, modules) ?? [];
}
