import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { loadFrameworkConfig } from '../../config';
import { loadInstanceExtensions } from '../../extension-loader';
import { componentBlueprintPath } from './component-blueprint-path';
import { asRecord } from './component-blueprint-model';
import { resolveRequirementReferenceImages } from './fidelity-shared';
import { assembleKnowledge, DESIGN_PREPARATION_AT, renderKnowledge, type KnowledgeAssembly } from './knowledge-context';
import { auditSchemaSupport, validateLiteSchema } from './lite-json-schema';
import { isInsideProjectRoot, realProjectPath } from './project-relative-path';
import type { ExtensionBinding } from './types';

const UX = 'ux-behavior-spec';
const toRelative = (root: string, file: string) => path.relative(root, file).replace(/\\/g, '/');
const isUx = (file: string) => /\.ux\.yaml$/i.test(file);
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
    reference_images: string[];
    bindings: DesignBindingDelivery[];
    skipped: string[];
    ux?: { candidates: Array<{ path: string; delivery: 'inline' | 'pointer' }>; output_dir: string };
  };
}

interface DesignPreparationInput {
  projectRoot: string;
  frameworkRoot: string;
  blueprintId: string;
  requirement?: string;
  requirementSources?: readonly string[];
  uxSources?: readonly string[];
  skipActions?: readonly string[];
  lookupOnly?: boolean;
  requestFile?: string;
  inlineBudgetChars?: number;
}

function fileInProject(root: string, file: string): string {
  const absolute = realProjectPath(root, file, '设计准备来源');
  if (!fs.statSync(absolute).isFile()) throw new Error('设计准备来源必须是文件：' + file);
  return absolute;
}

function uxFiles(root: string, directory: string): string[] {
  if (!isInsideProjectRoot(root, directory) || !fs.existsSync(directory)) return [];
  const physical = directory === root ? root : realProjectPath(root, toRelative(root, directory), 'UX 来源目录');
  return fs.readdirSync(physical, { withFileTypes: true })
    .filter(entry => entry.isFile() && isUx(entry.name)).map(entry => path.join(physical, entry.name)).sort();
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
  const explicitUx = [...new Set([...(input.uxSources ?? []), ...sourceFiles.filter(isUx)])];
  const referenceImages = bindings.length ? resolveRequirementReferenceImages(root, input.blueprintId, input.requirement, { requirementSourceFiles: sourceFiles })
    .flatMap(file => {
      try { return [toRelative(root, fileInProject(root, toRelative(root, file)))]; } catch { return []; }
    }) : [];
  const uxOutput = path.join(path.dirname(canonicalPath), 'ux');
  const readUx = bindings.some(binding => binding.ability === UX && binding.id === 'read-upstream' && binding.kind === 'knowledge');
  const fillUx = bindings.some(binding => binding.ability === UX && binding.id === 'fill-missing' && binding.kind === 'action');
  const reviewedUx = new Map<string, 'inline' | 'pointer'>();
  if (readUx || fillUx) {
    const directories = new Set(sourceFiles.filter(file => isInsideProjectRoot(root, path.resolve(root, file)))
      .map(file => path.dirname(path.resolve(root, file))));
    const listUx = (directory: string) => {
      try { return uxFiles(root, directory).map(file => toRelative(root, file)); }
      catch (error) { knowledge.notices.push(`UX 目录 ${toRelative(root, directory)} 无法读取：${(error as Error).message}`); return []; }
    };
    const upstream = explicitUx.length ? explicitUx : [...directories].flatMap(listUx);
    const drafts = listUx(uxOutput);
    const files = [...new Set([...upstream, ...drafts])];
    let budget = Math.max(0, (input.inlineBudgetChars ?? 16_000)
      - knowledge.entries.reduce((used, entry) => used + (entry.content?.length ?? 0), 0));
    let schema: Record<string, unknown> | undefined;
    if (files.length && bundle.rootDir) {
      try {
        const schemaPath = toRelative(root, path.join(bundle.rootDir, 'skills', UX, 'schema/ux-behavior.schema.json'));
        schema = asRecord(JSON.parse(fs.readFileSync(fileInProject(root, schemaPath), 'utf8')));
        if (!schema || auditSchemaSupport(schema).length) throw new Error('UX Schema 无效或含当前校验器不支持的规则');
      } catch (error) {
        schema = undefined;
        knowledge.notices.push('UX 稿待核对，无法自动校验：' + (error as Error).message);
      }
    }
    for (const file of files) {
      try {
        if (!isUx(file)) throw new Error('预制稿路径须以 .ux.yaml 结尾');
        const absolute = fileInProject(root, file);
        const content = fs.readFileSync(absolute, 'utf8');
        const parsed = YAML.parse(content);
        if (!schema) continue;
        const [issue] = validateLiteSchema(parsed, schema);
        if (issue) throw new Error(`${issue.path} ${issue.message}`);
        const relative = toRelative(root, absolute);
        if (reviewedUx.has(relative)) continue;
        const inline = readUx && content.length <= budget;
        reviewedUx.set(relative, inline ? 'inline' : 'pointer');
        if (!readUx) continue;
        if (inline) budget -= content.length;
        knowledge.entries.push({ kind: 'ux-upstream', path: relative, available: true,
          purpose: (drafts.includes(file) ? '当前蓝图已落盘 UX 草稿' : '上游 UX 候选稿') + (inline ? '；按当前范围及原始依据核对' : '；超内联预算，按路径逐段读取原文'),
          ...(inline ? { content } : {}) });
      } catch (error) {
        knowledge.notices.push(`UX 稿 ${file} 无法复用：${(error as Error).message}`);
      }
    }
  }

  return { ...result, extension_preparation: {
    at: DESIGN_PREPARATION_AT, blueprint_id: input.blueprintId, role: 'author' as const,
    write_dir: toRelative(root, path.dirname(canonicalPath)), ...(input.requestFile ? { request_file: input.requestFile } : {}),
    requirement_sources: sources, reference_images: [...new Set(referenceImages)],
    bindings, skipped, ...(readUx || fillUx ? { ux: { candidates: [...reviewedUx].map(([path, delivery]) => ({ path, delivery })), output_dir: toRelative(root, uxOutput) } } : {}),
  } };
}

export function renderDesignExtensionPreparation(result: DesignPreparation): string {
  const prepared = result.extension_preparation;
  if (!prepared) return renderKnowledge(result.knowledge);
  const lines = [renderKnowledge(result.knowledge)];
  if (prepared.requirement_sources.length) lines.push('本次原始需求文件：' + prepared.requirement_sources.join('、'));
  if (prepared.reference_images.length) lines.push('本次参考图原件（用实际支持图片的工具打开，工具失败或不支持时如实记为未观察）：\n'
    + prepared.reference_images.map(file => '- ' + file).join('\n'));
  if (prepared.skipped.length) lines.push('本次明确跳过动作：' + prepared.skipped.join('、'));
  if (prepared.ux) {
    lines.push('UX 候选原稿：' + (prepared.ux.candidates.map(file => file.path + (file.delivery === 'pointer' ? '（须打开原件）' : '')).join('、') || '未发现可复用稿。'));
    lines.push('按本轮需求核对适用的屏、流转、元素 ID 和原始出处。已有适用稿优先；从现有稿取得的观察须保留原出处。');
    if (!prepared.bindings.some(binding => binding.ability === UX && binding.id === 'fill-missing')) lines.push('本次准备未发放 UX 缺稿动作；沿可用原始需求或适用上游稿做蓝图。');
  }
  for (const binding of prepared.bindings.filter(binding => binding.kind === 'action')) {
    const action = binding.ability === UX && binding.id === 'fill-missing'
      ? `仅当本次请求涉及相应 UI 行为、用户未排除提取且没有适用旧稿时，由本次作者打开绑定的 Skill，先在 ${prepared.ux!.output_dir}/ 生成有效 UX、解析回读，再在蓝图用例和验收引用对应屏幕ID.元素ID。已有适用稿时报告复用；非 UI 或用户排除时报告原因并跳过。AI 推导稿保留证据强度与待决，原需求和上游原稿保持只读。`
      : '本次作者按当前请求范围和 Skill 适用条件执行。用户排除或不适用时报告跳过；缺少必需依赖时报告缺口。';
    lines.push(`设计前动作 ${selector(binding)} [${binding.path}]。 ${action}`);
  }
  if (prepared.bindings.length) lines.push('在本次已有作者交回中每条已参与绑定保留一行 extension-result: {"ability":"能力 ID","binding":"绑定 ID","status":"read|reused|generated|skipped|failed","artifacts":["项目相对路径"],"reason":"适用的结果、读入不足或失败原因"}。明确实际回读的材料、接收者及已引用的元素。知识只收到路径时，分段打开原件后再报告 read。');
  return lines.join('\n\n');
}
