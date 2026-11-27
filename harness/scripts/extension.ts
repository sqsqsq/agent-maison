#!/usr/bin/env node
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { parseArgs } from 'util';
import * as YAML from 'yaml';

import { loadFrameworkConfigWithSources } from '../config';
import { loadInstanceExtensions } from '../extension-loader';
import { detectRepoLayout } from '../repo-layout';
import { emitInstanceSkillBridge } from './utils/instance-skill-bridge';
import { formatExtensionInspection, inspectInstanceExtensions } from './utils/extension-inspect';
import { inspectExtensionRequest, recordExtensionManagementWrites } from './utils/extension-requests';
import {
  assertExtensionHostWritable, assertExtensionTargetProtocol, changeExtension, cleanupDeletedExtensionPlugins, extensionLocation,
  maintainExtensionIgnore, pendingExtensionUpgrades, prepareExtensionPlugins, targetExtensionFrameworkRoot, withExtensionWrite,
} from './utils/extension-lifecycle';
import { extensionTrackedTextEol, ordinaryFile, relativeExtensionPath, writeExtensionFileAtomic, type ObserveExtensionWrite } from './utils/extension-files';
import { assertNoUnreplacedPlaceholders, buildAgentsTemplateVars, renderAgentsTemplate } from './utils/template-renderer';

const ACTIONS = ['init', 'inspect', 'materialize', 'verify', 'install', 'enable', 'disable', 'uninstall', 'prepare-skill'] as const;
type Action = (typeof ACTIONS)[number];

function adaptersFromProject(projectRoot: string): string[] {
  const raw = loadFrameworkConfigWithSources(projectRoot).projectRaw;
  if (!Array.isArray(raw?.materialized_adapters)) return [];
  return [...new Set(raw.materialized_adapters
    .filter((value): value is string => typeof value === 'string' && /^[a-z0-9_-]+$/.test(value.trim()))
    .map(value => value.trim()))];
}

export function initExtension(projectRoot: string, frameworkDir: string, observeWrite?: ObserveExtensionWrite): string[] {
  assertExtensionTargetProtocol(frameworkDir);
  const { root } = extensionLocation(projectRoot, frameworkDir);
  const templateRoot = path.join(frameworkDir, 'skills', 'project', 'extension', 'templates', 'extension-skeleton');
  assertExtensionHostWritable(root);
  const written: string[] = [];
  const target = ordinaryFile(root, 'manifest.yaml');
  if (!fs.existsSync(target)) {
    const bytes = fs.readFileSync(path.join(templateRoot, 'manifest.yaml.template'));
    writeExtensionFileAtomic(target, bytes, true, observeWrite);
    written.push(relativeExtensionPath(projectRoot, target));
  }
  if (maintainExtensionIgnore(root, [], observeWrite)) written.push(relativeExtensionPath(projectRoot, path.join(root, '.gitignore')));
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

const entryLf = (body: string) => body.replace(/\r\n/g, '\n');

function markedEntry(key: EntrySection, body: string, eol = '\n'): string {
  const lf = entryLf(body);
  return `${entryStart(key)}${entryDigest(lf)} -->\n${lf}\n${entryEnd(key)}`.replace(/\n/g, eol);
}

function entryWithSection(current: string, key: EntrySection, previous: string, body: string, checkoutCrlf: boolean): string | undefined {
  const prefix = entryStart(key);
  const suffix = entryEnd(key);
  const start = current.indexOf(prefix);
  if (start >= 0) {
    const headerEnd = current.indexOf('\n', start);
    if (headerEnd < 0) return undefined;
    const contentStart = headerEnd + 1;
    const end = current.indexOf('\n' + suffix, contentStart);
    if (end < 0) return undefined;
    const eol = current[headerEnd - 1] === '\r' ? '\r\n' : '\n';
    const footerEol = current[end - 1] === '\r' ? '\r\n' : '\n';
    const header = current.slice(start, contentStart - eol.length);
    const old = current.slice(contentStart, end + 1 - footerEol.length);
    const canonical = entryLf(old);
    const signed = (value: string) => header === `${prefix}${entryDigest(value)} -->`;
    if (footerEol !== eol || old !== canonical.replace(/\n/g, eol) || (!signed(canonical) && !signed(old))) {
      return undefined;
    }
    if (canonical === entryLf(body)) return current;
    return current.slice(0, start) + markedEntry(key, body, eol) + current.slice(end + suffix.length + 1);
  }
  const eol = /\r?\n/.exec(current)?.[0] ?? '\n';
  const previousInFile = checkoutCrlf ? entryLf(previous).replace(/\n/g, '\r\n') : previous;
  const position = previousInFile ? current.indexOf(previousInFile) : -1;
  if (position >= 0 && position === current.lastIndexOf(previousInFile)) {
    return current.slice(0, position) + markedEntry(key, body, eol) + current.slice(position + previousInFile.length);
  }
  return body && (key === 'EXTENSION_SKILL_SECTION' || previous !== body)
    ? current + (current.endsWith('\n') ? eol : eol + eol) + markedEntry(key, body, eol) + eol
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
  const checkoutEol = extensionTrackedTextEol(projectRoot);
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
      const checkoutCrlf = current.includes('\r\n') && checkoutEol(target) === 'crlf';
      for (const key of ENTRY_SECTIONS) {
        const body = vars[key].trim();
        const updated = entryWithSection(rendered, key, priorSections?.[key].trim() ?? body, body, checkoutCrlf);
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
  const normal = loadInstanceExtensions(projectRoot, extensionDirRel, { frameworkRoot: frameworkDir });
  const pending = pendingExtensionUpgrades(normal);
  const bundle = pending.size ? loadInstanceExtensions(projectRoot, extensionDirRel, { frameworkRoot: frameworkDir, excludedPlugins: pending }) : normal;
  if (!bundle.manifestUsable) throw new Error(`extension manifest 非法：${bundle.errors.map(error => error.code).join(', ')}`);
  if (adapters.length === 0) return { adapters, entryFilesWritten: [], entryFilesRetained: [], bridges: [] };
  const bridges = adapters.map(adapter => ({ adapter, ...emitInstanceSkillBridge({
    repoRoot: projectRoot, frameworkDir, agentAdapter: adapter,
    observeWrite,
    skills: bundle.manualSkills,
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
    plugin: { type: 'string' }, skill: { type: 'string' },
    'no-enable': { type: 'boolean' }, at: { type: 'string' }, phase: { type: 'string' },
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
  if (positional.length || (action === 'prepare-skill' ? !values.plugin || !values.skill || !!ability : values.plugin || values.skill) || (source && action !== 'install') || (binding && action !== 'enable' && action !== 'disable')
    || (values['no-enable'] && action !== 'install')
    || ((values.at !== undefined || values.phase !== undefined) && (action !== 'enable' || !binding))
    || (values.request && action !== 'inspect') || (ability && ['init', 'materialize', 'verify'].includes(action))) {
    throw new Error('extension 操作参数与用法不匹配');
  }

  if (action !== 'inspect' && action !== 'verify' && action !== 'prepare-skill' && (process.env.MAISON_GOAL_RUN_ID?.trim() || process.env.MAISON_GOAL_ATTEMPT?.trim())) {
    throw new Error('受管 Goal 作者只能检视或校验扩展，持久开关请从宿主管理入口操作');
  }

  const layout = detectRepoLayout(__dirname);
  const projectRoot = path.resolve(values['project-root'] ?? layout.projectRoot);
  const frameworkDir = targetExtensionFrameworkRoot(projectRoot, layout.frameworkRoot);
  if (action === 'prepare-skill') {
    const plugin = values.plugin!;
    const { bundle, cleaned } = prepareExtensionPlugins(projectRoot, frameworkDir, bundle =>
      bundle.plugins[plugin]?.skills.some(item => item.skillId === values.skill) ? [plugin] : []);
    const prepared = bundle.manualSkills.find(item => item.pluginId === plugin && item.skillId === values.skill);
    const issue = prepared ? undefined : bundle.errors.find(error => error.ability === plugin || !error.ability)?.message
      ?? `插件 ${plugin} 未启用或未声明 Skill ${values.skill}`;
    process.stdout.write(`${JSON.stringify({ action, cleaned, plugin, skill: values.skill,
      ...(prepared ? { path: relativeExtensionPath(projectRoot, prepared.absPath) } : { issue }) }, null, 2)}\n`);
    if (!prepared) process.exitCode = 1;
    return;
  }
  const cleaned = cleanupDeletedExtensionPlugins(projectRoot, frameworkDir);
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
      const closedMaterializations: Record<string, unknown>[] = [];
      const result = changeExtension(action, {
        projectRoot, frameworkRoot: frameworkDir, source: source ? path.resolve(source) : undefined, ability, binding, observeWrite,
        noEnable: values['no-enable'], at: values.at, phase: values.phase,
        closeEntries: () => {
          closedMaterializations.push(materializeExtensions(projectRoot, frameworkDir, priorSections, observeWrite));
        },
      });
      const pending = result.requestIds?.length;
      const failed = result.outcomes.some(item => item.state === 'failed');
      if (pending || failed) process.exitCode = 1;
      const message = pending && (action === 'install' ? '等待已有请求交回后重试安装。'
        : action === 'enable' ? '等待资源占用解除后重试启用。'
          : '已停止新调度。资源仍被受管请求占用，交回后请重试原命令。');
      return {
        ...result,
        ...(message ? { message, occupancyScope: '受管蓝图和 CU 作者的原签发。直接交互会话沿用非受管边界。' } : {}),
        ...(closedMaterializations.length ? { closedMaterializations } : {}),
        ...(result.changed || !pending && !failed
          ? { materialization: materializeExtensions(projectRoot, frameworkDir, priorSections, observeWrite) } : {}),
      };
    }));
  }
  const inspection = inspectInstanceExtensions(projectRoot, frameworkDir, inspectOptions);
  const request = values.request ? inspectExtensionRequest(projectRoot, values.request, ability) : undefined;
  if (values.json) process.stdout.write(`${JSON.stringify({ action, cleaned, mutation, inspection, request }, null, 2)}\n`);
  else {
    if (cleaned.length) process.stdout.write(`${JSON.stringify({ cleaned }, null, 2)}\n\n`);
    if (mutation) process.stdout.write(`${JSON.stringify(mutation, null, 2)}\n\n`);
    process.stdout.write(`${formatExtensionInspection(inspection)}\n`);
    if (request) process.stdout.write(`\n${JSON.stringify(request, null, 2)}\n`);
  }
  if (action === 'verify' && (inspection.manifestErrors.length || inspection.timingCatalogError)) process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[extension] ${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}
