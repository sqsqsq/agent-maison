import * as fs from 'fs';
import * as path from 'path';
import { loadFrameworkConfig } from '../../config';
import { loadInstanceExtensions } from '../../extension-loader';
import { componentBlueprintPath } from './component-blueprint-path';
import { resolveRequirementReferenceImages } from './fidelity-shared';
import { assembleKnowledge, DESIGN_PREPARATION_AT, renderKnowledge, type KnowledgeAssembly } from './knowledge-context';
import { realProjectPath } from './project-relative-path';
import type { ExtensionBinding } from './types';

const toRelative = (root: string, file: string) => path.relative(root, file).replace(/\\/g, '/');
const selector = ({ ability, id }: Pick<ExtensionBinding, 'ability' | 'id'>) => `${ability}:${id}`;

type DesignBindingDelivery = Pick<ExtensionBinding, 'source' | 'ability' | 'id' | 'at' | 'ref' | 'required'> & {
  kind: 'knowledge' | 'action';
  path: string;
  delivery: 'inline' | 'pointer' | 'action';
};

interface DesignPreparation {
  canonical_path: string;
  knowledge: KnowledgeAssembly;
  extension_preparation?: {
    at: typeof DESIGN_PREPARATION_AT;
    blueprint_id: string;
    role: 'author';
    write_dir: string;
    request_file?: string;
    requirement_sources: string[];
    material_sources: string[];
    reference_images: string[];
    bindings: DesignBindingDelivery[];
    skipped: string[];
    author_instructions?: string[];
  };
}

interface DesignPreparationInput {
  projectRoot: string;
  frameworkRoot: string;
  blueprintId: string;
  requirement?: string;
  requirementSources?: readonly string[];
  materialSources?: readonly string[];
  skipActions?: readonly string[];
  lookupOnly?: boolean;
  requestFile?: string;
  inlineBudgetChars?: number;
}

function authorInstructions(bindings: readonly DesignBindingDelivery[], writeDir: string): string[] {
  const lines = [`本次蓝图写入目录：${writeDir}。以当前作者的请求范围和已有写权限为准。动笔前按已发放的知识资源和动作指引处理。仅收到知识路径时，打开适用原文。`];
  for (const binding of bindings) {
    if (binding.kind !== 'action') continue;
    lines.push(`设计前动作 ${selector(binding)} [${binding.path}]。打开绑定资源，按其中的条件和本次用户限制执行。跳过或缺少依赖时报告具体原因。`);
  }
  lines.push('在本次已有作者交回中，每条参与绑定按下列格式另起一行，行首直接写 extension-result，不加项目符号。'
    + 'status 按实际结果选 read、reused、generated、skipped 或 failed。\n'
    + 'extension-result: {"ability":"能力ID","binding":"绑定ID","status":"reused","artifacts":["项目相对路径"],"reason":"本次结果、实际取用或缺口"}');
  return lines;
}

function fileInProject(root: string, file: string): string {
  const absolute = realProjectPath(root, file, '设计准备来源');
  if (!fs.statSync(absolute).isFile()) throw new Error('设计准备来源必须是文件：' + file);
  return absolute;
}

/** Read-only for both transports. The signed or interactive author owns any action and its handback. */
export function prepareDesignExtensions(input: DesignPreparationInput): DesignPreparation {
  const root = fs.realpathSync(input.projectRoot);
  const canonicalPath = componentBlueprintPath(root, input.blueprintId);
  const bundle = loadInstanceExtensions(root, loadFrameworkConfig(root).paths.extension_dir, { frameworkRoot: input.frameworkRoot });
  const knowledge = assembleKnowledge({ projectRoot: root, frameworkRoot: input.frameworkRoot, extensionBundle: bundle,
    subject: 'component-design', role: 'author', inlineBudgetChars: input.inlineBudgetChars }, 'design-knowledge');
  const result = { canonical_path: canonicalPath, knowledge };
  if (input.lookupOnly) return result;

  const candidates = bundle.bindings.filter(binding => binding.at === DESIGN_PREPARATION_AT);
  const bindings: DesignBindingDelivery[] = [];
  const skipped: string[] = [];
  for (const binding of candidates) {
    if (!binding.enabled || !binding.absPath || !binding.kind) {
      if (binding.issue && binding.required && binding.selected) knowledge.notices.push(`必需绑定 ${selector(binding)}：${binding.issue}`);
      continue;
    }
    if (binding.kind === 'action' && input.skipActions?.includes(selector(binding))) {
      skipped.push(selector(binding));
      continue;
    }
    const { source, ability, id, at, kind, ref, required } = binding;
    const file = toRelative(root, binding.absPath);
    const entry = knowledge.entries.find(item => item.path === file);
    if (kind === 'knowledge' && !entry?.available) {
      knowledge.notices.push(`${selector(binding)} 的知识不可读：${file}`);
      continue;
    }
    bindings.push({ source, ability, id, at, kind, ref, ...(required ? { required } : {}), path: file,
      delivery: kind === 'action' ? 'action' : entry?.content !== undefined ? 'inline' : 'pointer' });
  }

  const sources = [...new Set(input.requirementSources ?? [])];
  const sourceFiles = sources.map(source => source.split('#', 1)[0]);
  const materials = [...new Set(input.materialSources ?? [])].flatMap(file => {
    try { return [toRelative(root, fileInProject(root, file))]; }
    catch (error) {
      knowledge.notices.push(`补充材料 ${file} 无法读取：${(error as Error).message}`);
      return [];
    }
  });
  const referenceImages = resolveRequirementReferenceImages(root, input.blueprintId, input.requirement, { requirementSourceFiles: sourceFiles })
    .flatMap(file => {
      try { return [toRelative(root, fileInProject(root, toRelative(root, file)))]; } catch { return []; }
    });

  const writeDir = toRelative(root, path.dirname(canonicalPath));
  return { ...result, extension_preparation: {
    at: DESIGN_PREPARATION_AT, blueprint_id: input.blueprintId, role: 'author' as const,
    write_dir: writeDir, ...(input.requestFile ? { request_file: input.requestFile } : {}),
    requirement_sources: sources, material_sources: [...new Set(materials)], reference_images: [...new Set(referenceImages)],
    bindings, skipped, ...(bindings.length ? { author_instructions: authorInstructions(bindings, writeDir) } : {}),
  } };
}

export function renderDesignExtensionPreparation(result: DesignPreparation): string {
  const prepared = result.extension_preparation;
  if (!prepared) return renderKnowledge(result.knowledge);
  const lines = [renderKnowledge(result.knowledge)];
  if (prepared.requirement_sources.length) lines.push('本次原始需求文件：' + prepared.requirement_sources.join('、'));
  if (prepared.material_sources.length) lines.push('本次显式补充材料：' + prepared.material_sources.join('、'));
  if (prepared.reference_images.length) lines.push('本次参考图原件（用实际支持图片的工具打开，工具失败或不支持时如实记为未观察）：\n'
    + prepared.reference_images.map(file => '- ' + file).join('\n'));
  if (prepared.skipped.length) lines.push('本次明确跳过动作：' + prepared.skipped.join('、'));
  lines.push(...(prepared.author_instructions ?? []));
  return lines.join('\n\n');
}
