#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';

import { loadFrameworkConfigWithSources } from '../config';
import { extensionSkillIdsForBridge, loadInstanceExtensions } from '../extension-loader';
import { detectRepoLayout } from '../repo-layout';
import { emitInstanceSkillBridge } from './utils/instance-skill-bridge';
import { formatExtensionInspection, inspectInstanceExtensions } from './utils/extension-inspect';
import { assertNoUnreplacedPlaceholders, buildAgentsTemplateVars, renderAgentsTemplate } from './utils/template-renderer';
import { validateProjectRelativePath } from './utils/project-relative-path';

type Action = 'init' | 'inspect' | 'materialize' | 'verify';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function toolVisibility(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [flag, visible] of [['--tool-visible', true], ['--tool-missing', false]] as const) {
    const value = arg(flag);
    for (const id of value?.split(',').map(item => item.trim()).filter(Boolean) ?? []) out[id] = visible;
  }
  return out;
}

function adaptersFromProject(projectRoot: string): string[] {
  const raw = loadFrameworkConfigWithSources(projectRoot).projectRaw;
  if (!Array.isArray(raw?.materialized_adapters)) return [];
  return [...new Set(raw.materialized_adapters
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(value => value.trim()))];
}

function extensionRoot(projectRoot: string): string {
  const config = loadFrameworkConfigWithSources(projectRoot).config;
  const rel = config.paths?.extension_dir ?? 'doc/extensions';
  return path.resolve(projectRoot, validateProjectRelativePath(projectRoot, rel, 'paths.extension_dir'));
}

export function initExtension(projectRoot: string, frameworkDir: string): string[] {
  const root = extensionRoot(projectRoot);
  const templateRoot = path.join(frameworkDir, 'skills', 'project', 'extension', 'templates', 'extension-skeleton');
  const copies = [
    ['manifest.yaml.template', 'manifest.yaml'],
    ['skills/.gitkeep', 'skills/.gitkeep'],
    ['knowledge/.gitkeep', 'knowledge/.gitkeep'],
    ['hooks/.gitkeep', 'hooks/.gitkeep'],
  ];
  const written: string[] = [];
  for (const [sourceRel, targetRel] of copies) {
    const target = path.join(root, ...targetRel.split('/'));
    if (fs.existsSync(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(templateRoot, ...sourceRel.split('/')), target);
    written.push(path.relative(projectRoot, target).replace(/\\/g, '/'));
  }
  return written;
}

function materializeEntryFiles(projectRoot: string, frameworkDir: string, adapters: string[]): string[] {
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
  const written: string[] = [];
  for (const target of targets) {
    const rendered = renderAgentsTemplate(template, buildAgentsTemplateVars(sources.projectRaw ?? {}, {
      entryFile: target, projectRoot, frameworkRoot: frameworkDir,
    }));
    assertNoUnreplacedPlaceholders(rendered, '/extension materialize');
    const targetAbs = path.resolve(projectRoot, target);
    fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
    if (!fs.existsSync(targetAbs) || fs.readFileSync(targetAbs, 'utf8') !== rendered) {
      fs.writeFileSync(targetAbs, rendered, 'utf8');
      written.push(target.replace(/\\/g, '/'));
    }
  }
  return written;
}

export function materializeExtensions(projectRoot: string, frameworkDir: string): Record<string, unknown> {
  const adapters = adaptersFromProject(projectRoot);
  if (adapters.length === 0) throw new Error('framework.config.json.materialized_adapters[] 必须非空');
  const extensionDirRel = loadFrameworkConfigWithSources(projectRoot).config.paths?.extension_dir;
  const bundle = loadInstanceExtensions(projectRoot, extensionDirRel, { frameworkRoot: frameworkDir });
  if (bundle.errors.length > 0) throw new Error(`extension manifest 非法：${bundle.errors.map(error => error.code).join(', ')}`);
  const bridges = adapters.map(adapter => ({ adapter, ...emitInstanceSkillBridge({
    repoRoot: projectRoot, frameworkDir, agentAdapter: adapter,
    extensionDirRel,
    declaredSkillIds: extensionSkillIdsForBridge(bundle),
  }) }));
  return { adapters, entryFilesWritten: materializeEntryFiles(projectRoot, frameworkDir, adapters), bridges };
}

function main(): void {
  const layout = detectRepoLayout(__dirname);
  const projectRoot = path.resolve(arg('--project-root') ?? layout.projectRoot);
  const action = (arg('--action') ?? 'inspect') as Action;
  const json = process.argv.includes('--json');
  if (!['init', 'inspect', 'materialize', 'verify'].includes(action)) {
    throw new Error(`--action 仅支持 init|inspect|materialize|verify，收到 ${action}`);
  }
  let mutation: Record<string, unknown> | undefined;
  if (action === 'init') mutation = { filesWritten: initExtension(projectRoot, layout.frameworkRoot) };
  if (action === 'materialize') mutation = materializeExtensions(projectRoot, layout.frameworkRoot);
  const inspection = inspectInstanceExtensions(projectRoot, layout.frameworkRoot, { toolVisibility: toolVisibility() });
  if (json) process.stdout.write(`${JSON.stringify({ action, mutation, inspection }, null, 2)}\n`);
  else {
    if (mutation) process.stdout.write(`${JSON.stringify(mutation, null, 2)}\n\n`);
    process.stdout.write(`${formatExtensionInspection(inspection)}\n`);
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
