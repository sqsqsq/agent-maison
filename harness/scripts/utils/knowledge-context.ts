import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_PATHS, catalogPath, glossaryPath, architectureMdPath, conventionsPath,
  componentIndexPath, componentCatalogPath, loadFrameworkConfig,
  isConventionsPathExplicitlyConfigured,
  type FrameworkPaths,
} from '../../config';
import { loadInstanceExtensions } from '../../extension-loader';
import { inferRepoLayout, type RepoLayout } from '../../repo-layout';
import { parseCodeGraphFile } from '../../code-graph/file-schema';
import { resolveGraphModule } from '../../code-graph/module-graph-probe';
import { loadCatalog, findModulesByTerm } from './catalog-parser';
import { loadGlossary, allKnownTerms, lookupTerm } from './glossary-parser';
import { componentReviewContext } from './component-selection-check';
import { loadSkillAssetsManifest, resolveSkillAssetPath } from './profile-skill-assets';
import { loadFeatureContracts, phaseContractIndex } from './skill-contract';
import { validateProjectRelativePath } from './project-relative-path';
import type { ContextFileEntry, ContractsSpec, ExtensionBundle, ExtensionKnowledgeEntry } from './types';

// 路径和默认送达；更新权限、phase 义务与 gate 仍由原有责任方定义。
const NATIVE_KNOWLEDGE = [
  { kind: 'module-catalog', key: 'module_catalog', resolve: catalogPath, purpose: '模块职责、反例与易混项；完整索引可继续探索' },
  { kind: 'glossary', key: 'glossary', resolve: glossaryPath, purpose: '术语与 alias 候选；字面命中不替代语义消歧' },
  { kind: 'architecture', key: 'architecture_md', resolve: architectureMdPath, purpose: '架构背景；设计依据仍按原权威链引用' },
  { kind: 'conventions', key: 'conventions', resolve: conventionsPath, purpose: '存在时读全文；review 独立选适用项并打开范例' },
  { kind: 'component-index', key: 'component_index', resolve: componentIndexPath, purpose: '完整组件库存；与策展按 id 联合读取并反查源码' },
  { kind: 'component-catalog', key: 'component_catalog', resolve: componentCatalogPath, purpose: '组件适用/不适用与易混项；不覆盖源码事实' },
] as const;

export interface KnowledgeContext {
  projectRoot: string;
  frameworkRoot?: string;
  phase?: string;
  skill?: string;
  subject?: 'feature' | 'request' | 'component-design' | 'global';
  role?: 'author' | 'verifier';
  requirement?: string;
  contracts?: ContractsSpec | null;
  targetFiles?: readonly string[];
  extensionBundle?: ExtensionBundle;
  /** init 静态投影可在 config 尚未落盘时使用已有配置候选，不读取任务材料。 */
  staticOnly?: boolean;
  paths?: Partial<FrameworkPaths>;
  profileName?: string;
  inlineBudgetChars?: number;
}

export interface KnowledgeEntry {
  kind: string;
  path: string;
  purpose: string;
  available: boolean;
  content?: string;
}

export interface KnowledgeAssembly {
  entries: KnowledgeEntry[];
  notices: string[];
  extensionInstructions: string;
}

const relative = (root: string, file: string): string => path.relative(root, file).replace(/\\/g, '/');

/** 路由的唯一视图；1.0 声明可检视，不自动获得 1.1 audience。 */
export function extensionKnowledgeRoutes(bundle: ExtensionBundle | undefined, root: string) {
  if (!bundle || bundle.errors.length) return [];
  return bundle.knowledge.map(entry => ({
    entry,
    path: relative(root, entry.absPath),
    routed: bundle.manifestVersion === '1.1',
    audience: entry.audience === 'global' ? ['global'] : entry.legacy ? bundle.featurePhases : entry.audience,
  }));
}

export function selectExtensionPhaseKnowledge(bundle: ExtensionBundle | undefined, phase: string, opts?: { includeBound?: boolean }): ExtensionKnowledgeEntry[] {
  if (!bundle || bundle.manifestVersion !== '1.1' || bundle.errors.length || !bundle.featurePhases.includes(phase)) return [];
  const entries = bundle.knowledge.filter(item => item.legacy || (Array.isArray(item.audience) && item.audience.includes(phase)));
  if (opts?.includeBound) for (const bindings of Object.values(bundle.phaseBindings[phase] ?? {})) {
    for (const binding of bindings ?? []) {
      const entry = binding.kind === 'knowledge' && bundle.knowledge.find(item => item.path === binding.ref);
      if (entry && !entries.some(item => item.path === entry.path)) entries.push(entry);
    }
  }
  return entries;
}

export function renderExtensionPhaseInputs(bundle: ExtensionBundle | undefined, phase: string, root: string): string {
  if (!bundle || bundle.manifestVersion !== '1.1' || bundle.errors.length || !bundle.featurePhases.includes(phase)) return '';
  const knowledge = selectExtensionPhaseKnowledge(bundle, phase);
  const slots = bundle.phaseBindings[phase] ?? {};
  if (!knowledge.length && !Object.keys(slots).length) return '';
  const lines = ['## Instance extension inputs', ''];
  if (knowledge.length) {
    lines.push('### Knowledge index', '');
    for (const item of knowledge) lines.push('- `' + relative(root, item.absPath) + '`' + (item.summary ? ` — ${item.summary}` : ''));
    lines.push('');
  }
  for (const slot of ['before_phase_work', 'before_phase_verify', 'after_phase_verify_before_close'] as const) {
    if (!slots[slot]?.length) continue;
    lines.push(`### ${slot}`, '');
    for (const item of slots[slot]!) {
      const action = item.kind === 'mcp' ? bundle.mcpActions[item.ref] : undefined;
      lines.push(action
        ? '- mcp `' + item.ref + '` → tool `' + action.tool + '`; ' + action.usage + '; produces: ' + action.produces.map(value => '`' + value + '`').join(', ')
        : `- ${item.kind} ` + '`' + item.ref + '`');
    }
    lines.push('');
  }
  lines.push('各槽位只在标明时点执行；after_phase_verify_before_close 不得提前执行。');
  return lines.join('\n').trimEnd();
}

export function renderExtensionKnowledgeRoutes(bundle: ExtensionBundle, root: string): string {
  const rows = extensionKnowledgeRoutes(bundle, root).filter(row => row.routed);
  const lines: string[] = [];
  if (rows.length) {
    lines.push('### 实例知识路由', '', '| 路径 | audience / 读取时机 | 摘要 |', '|---|---|---|');
    for (const row of rows) lines.push(`| [${row.path}](${row.path}) | ${row.audience.join(', ')} | ${row.entry.summary || '—'} |`);
  }
  if (bundle.manifestVersion === '1.1' && !bundle.errors.length) {
    for (const [phase, slots] of Object.entries(bundle.phaseBindings)) {
      if (!slots.before_phase_work?.length) continue;
      lines.push('', '- `' + phase + '` 动笔前：先按 `' + relative(root, bundle.manifestPath!) + '` 处理 '
        + slots.before_phase_work.map(item => `${item.kind}:${item.ref}`).join('、') + '；运行 `/extension inspect` 查看路径、usage 与消费者。');
    }
  }
  return lines.join('\n');
}

/** 可选 key：不在根 Skill 使用会被 docs 当必填的 asset marker。 */
export function resolveDesignKnowledge(context: KnowledgeContext, bundle: ExtensionBundle, layout: RepoLayout, profile: string): { path?: string; notice?: string } {
  if (bundle.errors.length) return { notice: 'component-design knowledge：extension manifest 不可用，不能视为未声明或回退 profile。' };
  const loaded = loadSkillAssetsManifest(context.projectRoot, profile, layout);
  const hasExtension = Boolean(bundle.skillAssetAbsPaths['component-design']?.knowledge);
  if (!hasExtension && !loaded.ok) return { notice: 'component-design knowledge：profile 清单不可读：' + loaded.errors.join('；') };
  const hasProfile = Boolean(loaded.manifest?.assets['component-design']?.knowledge);
  if (!hasExtension && !hasProfile) return { notice: 'component-design knowledge：未声明可选资产（extension → profile）。' };
  const result = resolveSkillAssetPath(context.projectRoot, profile,
    loaded.manifest ?? { schema_version: '1.0', profile, assets: {} }, 'component-design', 'knowledge', layout, bundle.skillAssetAbsPaths);
  return result.ok ? { path: result.absPath } : { notice: result.error };
}

export function assembleKnowledge(context: KnowledgeContext): KnowledgeAssembly {
  const root = context.projectRoot;
  const frameworkRoot = context.frameworkRoot ?? inferRepoLayout(root).frameworkRoot;
  const layout: RepoLayout = { projectRoot: root, frameworkRoot, frameworkRel: relative(root, frameworkRoot), kind: root === frameworkRoot ? 'standalone' : 'consumer' };
  const config = context.staticOnly ? undefined : loadFrameworkConfig(root);
  const profile = context.profileName ?? config?.project_profile.name ?? 'hmos-app';
  const bundle = context.extensionBundle ?? loadInstanceExtensions(root, context.paths?.extension_dir ?? config?.paths.extension_dir, { frameworkRoot });
  const out: KnowledgeAssembly = { entries: [], notices: [], extensionInstructions: renderExtensionPhaseInputs(bundle, context.phase ?? '', root) };
  if (bundle.errors.length) out.notices.push('extension 输入不可用：' + bundle.errors.map(error => `${error.code}: ${error.message}`).join('；'));
  // global 材料由各自现有 collector 提供；不混入 Feature 知识，也不关闭自定义 global verifier。
  if (context.subject === 'global') return out;
  let budget = Math.max(0, context.inlineBudgetChars ?? 16_000);
  const add = (kind: string, absolute: string, purpose: string, content?: string): KnowledgeEntry => {
    const file = relative(root, absolute);
    const previous = out.entries.find(entry => entry.path === file);
    if (previous) { if (!previous.purpose.includes(purpose)) previous.purpose += '；' + purpose; return previous; }
    let available = false;
    try { available = fs.statSync(absolute).isFile(); } catch { /* 只披露；原 checker 决定缺失的处置 */ }
    const entry: KnowledgeEntry = { kind, path: file, purpose, available };
    if (content && !context.staticOnly) {
      if (content.length <= budget) { entry.content = content; budget -= content.length; }
      else entry.purpose += '；正文超过内联预算，须按原路径分批读取，未声称读完';
    }
    out.entries.push(entry);
    return entry;
  };
  const read = (absolute: string): string | undefined => {
    if (context.staticOnly) return undefined;
    try { return fs.readFileSync(absolute, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') out.notices.push(relative(root, absolute) + ' 读取失败：' + (error as Error).message);
      return undefined;
    }
  };
  for (const source of NATIVE_KNOWLEDGE) {
    if (!context.staticOnly && context.role === 'verifier') {
      if (source.kind === 'conventions' && context.phase !== 'review') continue;
      if (source.kind.startsWith('component-') && context.phase !== 'review') continue;
      if (source.kind === 'architecture' && !['plan', 'review'].includes(context.phase ?? '')) continue;
    }
    const absolute = context.staticOnly
      ? path.resolve(root, context.paths?.[source.key] ?? DEFAULT_PATHS[source.key]!)
      : source.resolve(root);
    const full = source.kind === 'conventions' || (source.kind === 'architecture'
      && !(context.role === 'verifier' && context.phase === 'review')
      && (context.skill === 'component-design' || ['plan', 'review'].includes(context.phase ?? '')));
    const entry = add(source.kind, absolute, source.purpose, full ? read(absolute) : undefined);
    if (source.kind === 'conventions' && !entry.available && !context.staticOnly && isConventionsPathExplicitlyConfigured(root)) {
      out.notices.push(entry.path + ' 是显式配置但不可读的惯例；保持 unknown/degraded，不当作未启用。');
    }
  }
  const design = context.skill === 'component-design' || context.subject === 'component-design';
  if (design) {
    const asset = resolveDesignKnowledge(context, bundle, layout, profile);
    if (asset.path) add('design-knowledge', asset.path, 'P1 discovery 前读取；只引用原文，不扩大 authority', read(asset.path));
    if (asset.notice) out.notices.push(asset.notice);
  }
  for (const entry of selectExtensionPhaseKnowledge(bundle, context.phase ?? '', { includeBound: true })) {
    const audienceMatch = selectExtensionPhaseKnowledge(bundle, context.phase ?? '').some(item => item.path === entry.path);
    const slots = Object.entries(bundle.phaseBindings[context.phase ?? ''] ?? {}).filter(([, bindings]) => bindings?.some(binding => binding.kind === 'knowledge' && binding.ref === entry.path)).map(([slot]) => slot);
    add('extension', entry.absPath, (entry.summary || '实例知识') + (audienceMatch ? '' : '；仅在 ' + slots.join(' / ') + ' 原槽位读取，此处只导航，不提前执行'));
  }
  let skill = context.skill;
  if (!skill && context.phase) {
    try { skill = phaseContractIndex(loadFeatureContracts(frameworkRoot)).get(context.phase)?.contract.skill; } catch { /* 未具备 phase contract 的静态入口仍有原生索引 */ }
  }
  add('framework-reference', path.join(frameworkRoot, 'docs', 'README.md'), '框架背景索引，按当前任务跟随相关原始链接');
  add('profile-reference', path.join(frameworkRoot, 'profiles', profile, 'skills', 'README.md'), '当前 profile 知识与 Skill 资产协议');
  if (skill) {
    const addendum = path.join(frameworkRoot, 'profiles', profile, 'skills', skill, 'profile-addendum.md');
    if (fs.existsSync(addendum)) add('profile-reference', addendum, `执行 ${skill} 前阅读当前 profile 补充`, read(addendum));
  }
  if (context.staticOnly) {
    add('code-graph', path.resolve(root, context.paths?.module_graphs_dir ?? '<module>/code-graph.yaml'), '按相关模块替换 <module>；无图回源码，不自动建图');
    return out;
  }
  if (context.phase === 'review' || design) {
    const conventions = read(conventionsPath(root)) ?? '';
    for (const line of conventions.split(/\r?\n/).filter(line => /^\s*(?:-\s*)?范例[：:]/.test(line))) {
      const ref = line.match(/范例[：:]\s*`?([^`\s#]+\.[a-zA-Z0-9]+)(?:#[^`\s]+)?/);
      if (!ref) continue;
      try { add('convention-source', path.resolve(root, validateProjectRelativePath(root, ref[1], 'conventions example')), '惯例范例原文；review 独立判断适用性'); }
      catch (error) { out.notices.push('惯例范例不可读：' + (error as Error).message); }
    }
  }

  const query = context.requirement ?? '';
  const files = context.targetFiles ?? context.contracts?.files ?? [];
  const catalog = loadCatalog(root);
  const glossary = loadGlossary(root);
  const modules = new Set((context.contracts?.modules ?? []).map(module => module.name));
  const terms = glossary.ok ? allKnownTerms(glossary.glossary).filter(term => term && query.includes(term)) : [];
  if (glossary.ok) {
    const matches = [...new Set(terms.map(term => lookupTerm(glossary.glossary, term)!.term))];
    for (const term of matches) modules.add(term.canonical_module);
    if (matches.length) {
      const entry = out.entries.find(item => item.kind === 'glossary')!;
      const text = JSON.stringify(matches, null, 2);
      if (text.length <= budget) { entry.content = text; budget -= text.length; }
      else entry.purpose += '；术语候选过大，按原路径逐条读取';
    }
  } else out.notices.push('术语候选不可用：' + glossary.error.kind + '；继续按索引/源码探索。');
  if (catalog.ok) {
    for (const card of catalog.catalog.modules) {
      const prefix = `${card.layer}/${card.name}/`;
      if (files.some(file => file.replace(/\\/g, '/').startsWith(prefix)) || card.typical_business_terms.some(term => term && query.includes(term))) modules.add(card.name);
    }
    for (const term of terms) {
      const hits = findModulesByTerm(catalog.catalog, term);
      for (const card of [...hits.exactHits, ...hits.fuzzyHits]) modules.add(card.name);
    }
    const cards = catalog.catalog.modules.filter(card => modules.has(card.name));
    if (cards.length) {
      const entry = out.entries.find(item => item.kind === 'module-catalog')!;
      const text = JSON.stringify(cards, null, 2);
      if (text.length <= budget) { entry.content = text; budget -= text.length; }
      else entry.purpose += '；候选画像过大，按原路径读取相关模块';
    }
    for (const name of modules) {
      try {
        const selected = resolveGraphModule(root, name, context.contracts?.modules.find(module => module.name === name)?.package_path, catalog);
        add('code-graph', selected.graphPath, '相关模块节点导航，core 只高亮；无图/无命中回源码 ' + selected.packagePath);
        try { fs.statSync(selected.graphPath); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          out.notices.push(relative(root, selected.graphPath) + ' 不存在；回源码探索 ' + selected.packagePath + '，不自动建图。');
          continue;
        }
        const parsed = parseCodeGraphFile(selected.graphPath, relative(root, selected.graphPath));
        const graph = parsed.graph;
        const nodes = graph?.nodes.filter(node => !files.length || files.includes(node.anchor.file));
        if (graph) {
          const entry = out.entries.find(item => item.path === relative(root, selected.graphPath))!;
          const text = JSON.stringify({ nodes, signatures: graph.derived?.signatures?.filter(item => !files.length || files.includes(item.file)),
            import_edges: graph.derived?.import_edges?.filter(item => !files.length || files.includes(item.from_file)),
            call_edges: graph.derived?.call_edges?.filter(item => !files.length || files.includes(item.caller_file)) }, null, 2);
          if (text.length <= budget) { entry.content = text; budget -= text.length; }
          else entry.purpose += '；节点候选过大，按原路径分批读取';
        }
        if (parsed.error) out.notices.push(parsed.error + '；回源码探索，不自动建图。');
      } catch (error) { out.notices.push(`CodeGraph ${name}: ${(error as Error).message}；回目标源码探索。`); }
    }
  } else out.notices.push('画像候选不可用：' + catalog.error.kind + '；继续按索引/源码探索。');
  if (!terms.length) out.notices.push('无术语字面候选不代表无适用知识；继续读取完整索引并语义消歧。');

  if (context.phase === 'review' || design) {
    try {
      for (const file of componentReviewContext(root)) {
        if (file.label.startsWith('(')) {
          if (file.content.length <= budget) { out.notices.push(file.label + ': ' + file.content); budget -= file.content.length; }
          else out.notices.push('组件 live 调用样本超过内联预算；按完整 index/catalog 与下列定义/样本源路径分批核对，不代表没有调用。');
        } else {
          const existing = out.entries.find(entry => entry.path === file.label);
          if (existing) {
            if (file.content.length <= budget) { existing.content = file.content; budget -= file.content.length; }
            else existing.purpose += '；完整内容按原路径分批读取';
          } else add('component-source', path.resolve(root, file.label), file.content);
        }
      }
    } catch (error) { out.notices.push('组件资料不可用：' + (error as Error).message); }
  }
  return out;
}

export function renderKnowledge(assembly: KnowledgeAssembly, inline = true): string {
  const lines = ['## Knowledge inputs', '', '动笔前读取适用原文；索引/候选不是事实确认或已读证明。维护写入须沿原授权与时点，不在 run 内擅自刷新图谱。', ''];
  for (const entry of assembly.entries) {
    lines.push('- `' + entry.path + '` — ' + entry.purpose + (entry.available ? '' : '（文件缺失 / 未启用；不声称已消费）'));
    if (inline && entry.content) lines.push('', entry.content, '');
  }
  for (const notice of assembly.notices) lines.push('- ' + notice);
  if (assembly.extensionInstructions) lines.push('', assembly.extensionInstructions);
  return lines.join('\n');
}

export function knowledgeContextFiles(assembly: KnowledgeAssembly): ContextFileEntry[] {
  return assembly.entries.filter(entry => entry.available).map(entry => ({
    label: entry.path, kind: entry.content ? 'text' : 'path',
    content: entry.content && ['glossary', 'module-catalog', 'code-graph'].includes(entry.kind)
      ? '候选摘录，非全文，按路径读完整来源。\n\n' + entry.content
      : entry.content ?? entry.purpose,
  }));
}
