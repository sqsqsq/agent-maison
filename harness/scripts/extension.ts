#!/usr/bin/env node
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { parseArgs } from 'util';
import * as YAML from 'yaml';

import { loadFrameworkConfigWithSources } from '../config';
import { extensionSkillIdsForBridge, loadInstanceExtensions } from '../extension-loader';
import { detectRepoLayout } from '../repo-layout';
import { emitInstanceSkillBridge } from './utils/instance-skill-bridge';
import { formatExtensionInspection, inspectInstanceExtensions } from './utils/extension-inspect';
import { inspectExtensionRequest, recordExtensionManagementWrites } from './utils/extension-requests';
import { changeExtension, extensionLocation, targetExtensionFrameworkRoot, withExtensionWrite } from './utils/extension-lifecycle';
import { ordinaryFile, relativeExtensionPath, writeExtensionFileAtomic, type ObserveExtensionWrite } from './utils/extension-files';
import { assertNoUnreplacedPlaceholders, buildAgentsTemplateVars, renderAgentsTemplate } from './utils/template-renderer';

const ACTIONS = ['init', 'inspect', 'materialize', 'verify', 'install', 'enable', 'disable', 'uninstall'] as const;
type Action = (typeof ACTIONS)[number];

function adaptersFromProject(projectRoot: string): string[] {
  const raw = loadFrameworkConfigWithSources(projectRoot).projectRaw;
  if (!Array.isArray(raw?.materialized_adapters)) return [];
  return [...new Set(raw.materialized_adapters
    .filter((value): value is string => typeof value === 'string' && /^[a-z0-9_-]+$/.test(value.trim()))
    .map(value => value.trim()))];
}

export function initExtension(projectRoot: string, frameworkDir: string, observeWrite?: ObserveExtensionWrite): string[] {
  const { root } = extensionLocation(projectRoot, frameworkDir);
  const templateRoot = path.join(frameworkDir, 'skills', 'project', 'extension', 'templates', 'extension-skeleton');
  const copies = [
    ['manifest.yaml.template', 'manifest.yaml'],
    ['skills/.gitkeep', 'skills/.gitkeep'],
    ['knowledge/.gitkeep', 'knowledge/.gitkeep'],
    ['hooks/.gitkeep', 'hooks/.gitkeep'],
  ];
  const written: string[] = [];
  for (const [sourceRel, targetRel] of copies) {
    const target = ordinaryFile(root, targetRel);
    if (fs.existsSync(target)) continue;
    const bytes = fs.readFileSync(path.join(templateRoot, ...sourceRel.split('/')));
    writeExtensionFileAtomic(target, bytes, true, observeWrite);
    written.push(relativeExtensionPath(projectRoot, target));
  }
  return written;
}

const ENTRY_SECTIONS = ['EXTENSION_SKILL_SECTION', 'COMPONENT_DESIGN_KNOWLEDGE'] as const;
type EntrySection = (typeof ENTRY_SECTIONS)[number];
type EntrySections = Record<EntrySection, string>;
const entryDigest = (text: string): string => createHash('sha256').update(text).digest('hex');

function entryStart(key: EntrySection): string {
  return `<!-- agent-maison:instance-extension:${key} `;
}

function entryEnd(key: EntrySection): string {
  return `<!-- /agent-maison:instance-extension:${key} -->`;
}

function markedEntry(key: EntrySection, body: string): string {
  return `${entryStart(key)}${entryDigest(body)} -->\n${body}\n${entryEnd(key)}`;
}

function entryWithSection(current: string, key: EntrySection, previous: string, body: string): string | undefined {
  const prefix = entryStart(key);
  const suffix = entryEnd(key);
  const start = current.indexOf(prefix);
  if (start >= 0) {
    const contentStart = current.indexOf('\n', start) + 1;
    const end = current.indexOf('\n' + suffix, contentStart);
    const header = current.slice(start, contentStart - 1);
    if (contentStart === 0 || end < 0
      || header !== `${prefix}${entryDigest(current.slice(contentStart, end))} -->`) return undefined;
    return current.slice(0, start) + markedEntry(key, body) + current.slice(end + suffix.length + 1);
  }
  const position = previous ? current.indexOf(previous) : -1;
  if (position >= 0 && position === current.lastIndexOf(previous)) {
    return current.slice(0, position) + markedEntry(key, body) + current.slice(position + previous.length);
  }
  return body && (key === 'EXTENSION_SKILL_SECTION' || previous !== body)
    ? current + (current.endsWith('\n') ? '\n' : '\n\n') + markedEntry(key, body) + '\n'
    : current;
}

function materializeEntryFiles(projectRoot: string, frameworkDir: string, adapters: string[], priorSections?: EntrySections, observeWrite?: ObserveExtensionWrite) {
  const sources = loadFrameworkConfigWithSources(projectRoot);
  const template = fs.readFileSync(path.join(frameworkDir, 'templates', 'AGENTS.md.template'), 'utf8');
  const targets = new Set<string>();
  for (const adapter of adapters) {
    const adapterPath = path.join(frameworkDir, 'agents', adapter, 'adapter.yaml');
    if (!fs.existsSync(adapterPath)) throw new Error(`adapter 不存在：${adapter}`);
    const yaml = YAML.parse(fs.readFileSync(adapterPath, 'utf8')) as Record<string, unknown>;
    const entry = yaml.agent_entry_file as Record<string, unknown> | undefined;
    if (typeof entry?.target_path === 'string' && entry.target_path.trim()) targets.add(entry.target_path.trim());
  }
  const entryFilesWritten: string[] = [];
  const entryFilesRetained: string[] = [];
  for (const target of targets) {
    const vars = buildAgentsTemplateVars(sources.projectRaw ?? {}, { entryFile: target, projectRoot, frameworkRoot: frameworkDir });
    const abs = ordinaryFile(projectRoot, target);
    const current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : undefined;
    let rendered = current;
    if (current === undefined) {
      for (const key of ENTRY_SECTIONS) vars[key] = markedEntry(key, vars[key].trim());
      rendered = renderAgentsTemplate(template, vars);
      assertNoUnreplacedPlaceholders(rendered, '/extension materialize');
    } else {
      rendered = current;
      for (const key of ENTRY_SECTIONS) {
        const body = vars[key].trim();
        const updated = entryWithSection(rendered, key, priorSections?.[key].trim() ?? body, body);
        if (updated !== undefined) rendered = updated;
        else if (!entryFilesRetained.includes(target)) entryFilesRetained.push(target);
      }
    }
    if (current !== rendered) {
      writeExtensionFileAtomic(abs, rendered, current === undefined, observeWrite);
      entryFilesWritten.push(target);
    }
  }
  return { entryFilesWritten, entryFilesRetained };
}

export function materializeExtensions(projectRoot: string, frameworkDir: string, priorSections?: EntrySections,
  observeWrite?: ObserveExtensionWrite): Record<string, unknown> {
  const adapters = adaptersFromProject(projectRoot);
  if (adapters.length === 0 && priorSections === undefined) throw new Error('framework.config.json.materialized_adapters[] 必须非空');
  const extensionDirRel = loadFrameworkConfigWithSources(projectRoot).config.paths?.extension_dir;
  const bundle = loadInstanceExtensions(projectRoot, extensionDirRel, { frameworkRoot: frameworkDir });
  if (!bundle.manifestUsable) throw new Error(`extension manifest 非法：${bundle.errors.map(error => error.code).join(', ')}`);
  if (adapters.length === 0) return { adapters, entryFilesWritten: [], entryFilesRetained: [], bridges: [] };
  const bridges = adapters.map(adapter => ({ adapter, ...emitInstanceSkillBridge({
    repoRoot: projectRoot, frameworkDir, agentAdapter: adapter,
    extensionDirRel, observeWrite,
    declaredSkillIds: extensionSkillIdsForBridge(bundle),
  }) }));
  return { adapters, ...materializeEntryFiles(projectRoot, frameworkDir, adapters, priorSections, observeWrite), bridges };
}

function toolVisibility(visible?: string, missing?: string): Record<string, boolean> {
  return Object.fromEntries([[visible, true], [missing, false]].flatMap(([flag, enabled]) => typeof flag === 'string'
    ? flag.split(',').map(item => item.trim()).filter(Boolean).map(item => [item, enabled as boolean])
    : []));
}

function main(): void {
  const argv = parseArgs({ options: {
    action: { type: 'string' }, 'project-root': { type: 'string' }, source: { type: 'string' },
    ability: { type: 'string' }, binding: { type: 'string' }, request: { type: 'string' }, json: { type: 'boolean' },
    'tool-visible': { type: 'string' }, 'tool-missing': { type: 'string' },
  }, allowPositionals: true });
  const values = argv.values;
  const positional = [...argv.positionals];
  const selectedAction = values.action ?? positional.shift() ?? 'inspect';
  if (!ACTIONS.includes(selectedAction as Action)) throw new Error(`extension 操作仅支持 ${ACTIONS.join('|')}，收到 ${selectedAction}`);
  const action = selectedAction as Action;
  const source = action === 'install' ? values.source ?? positional.shift() : values.source;
  const ability = values.ability ?? positional.shift();
  const binding = action === 'enable' || action === 'disable' ? values.binding ?? positional.shift() : values.binding;
  if (positional.length || (source && action !== 'install') || (binding && action !== 'enable' && action !== 'disable')
    || (values.request && action !== 'inspect') || (ability && ['init', 'materialize', 'verify'].includes(action))) {
    throw new Error('extension 操作参数与用法不匹配');
  }

  if (action !== 'inspect' && action !== 'verify' && (process.env.MAISON_GOAL_RUN_ID?.trim() || process.env.MAISON_GOAL_ATTEMPT?.trim())) {
    throw new Error('受管 Goal 作者只能检视或校验扩展，持久开关请从宿主管理入口操作');
  }

  const layout = detectRepoLayout(__dirname);
  const projectRoot = path.resolve(values['project-root'] ?? layout.projectRoot);
  const frameworkDir = targetExtensionFrameworkRoot(projectRoot, layout.frameworkRoot);
  const inspectOptions = { toolVisibility: toolVisibility(values['tool-visible'], values['tool-missing']), ability };
  let mutation: Record<string, unknown> | undefined;
  if (action === 'init') mutation = withExtensionWrite(projectRoot, frameworkDir, () => ({ filesWritten: initExtension(projectRoot, frameworkDir) }));
  if (action === 'materialize') mutation = withExtensionWrite(projectRoot, frameworkDir, () => materializeExtensions(projectRoot, frameworkDir));
  if (action === 'install' || action === 'enable' || action === 'disable' || action === 'uninstall') {
    mutation = withExtensionWrite(projectRoot, frameworkDir, () => recordExtensionManagementWrites(projectRoot, observeWrite => {
      const sources = loadFrameworkConfigWithSources(projectRoot);
      const priorSections = buildAgentsTemplateVars(sources.projectRaw ?? {}, {
        entryFile: 'AGENTS.md', projectRoot, frameworkRoot: frameworkDir,
      }) as EntrySections;
      const result = changeExtension(action, {
        projectRoot, frameworkRoot: frameworkDir, source, ability, binding, observeWrite,
      });
      if (result.requestIds?.length) {
        process.exitCode = 1;
        return { ...result, message: action === 'install' ? '等待已有请求交回后重试安装。' : '等待已有请求交回后重试卸载。' };
      }
      return {
        ...result,
        ...(action === 'install' ? { skeletonFilesWritten: initExtension(projectRoot, frameworkDir, observeWrite) } : {}),
        materialization: materializeExtensions(projectRoot, frameworkDir, priorSections, observeWrite),
      };
    }));
  }
  const inspection = inspectInstanceExtensions(projectRoot, frameworkDir, inspectOptions);
  const request = values.request ? inspectExtensionRequest(projectRoot, values.request, ability) : undefined;
  if (values.json) process.stdout.write(`${JSON.stringify({ action, mutation, inspection, request }, null, 2)}\n`);
  else {
    if (mutation) process.stdout.write(`${JSON.stringify(mutation, null, 2)}\n\n`);
    process.stdout.write(`${formatExtensionInspection(inspection)}\n`);
    if (request) process.stdout.write(`\n${JSON.stringify(request, null, 2)}\n`);
  }
  if (action === 'verify' && inspection.manifestErrors.length > 0) process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[extension] ${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}
