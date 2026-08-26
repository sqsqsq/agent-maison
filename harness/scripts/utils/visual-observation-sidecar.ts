// ============================================================================
// visual-observation-sidecar.ts — spec 期视觉观察 sidecar（plan ab072691 t4）
// ============================================================================
// 地位与 `spec/reports/ocr/<slug>.ocr.json` **逐字对齐**：
//   · best-effort 上下文，**不是门禁产物**，不产任何 check；
//   · 单图失败不阻断其余；整体生产失败也不阻断 spec（对应图没有 sidecar 而已）；
//   · spec 是唯一生产者，plan/coding 只列出盘上已有的产物。
//
// 复用键是三元组 `image_hash + provider(adapter, model) + protocol_version`：换 endpoint
// 或升协议后**必须重产**，否则会拿旧模型对旧图的观察去描述新图/新模型——这正是
// 「不能用旧结果制造 PASS」在 best-effort 面上的同一条纪律。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import { featurePhaseReportsDir } from '../../config';
import {
  extractJsonObjectFromText,
  hashImageFile,
  invokeVisualProvider,
  resolveSpecObservationBudget,
  type VisualProviderInvocation,
} from './visual-provider-invoke';
import type { ProviderRef } from './types';

/** 观察协议版本——形态/prompt 契约变更时 +1，旧 sidecar 自动 stale 重产。 */
export const VISUAL_OBSERVATION_PROTOCOL_VERSION = 1;

export const VISUAL_OBSERVATION_SCHEMA_VERSION = '1.0';

export interface VisualObservationEntry {
  /** 观察区域的自然语言定位（如 "顶部导航栏" / "卡片右下角按钮"） */
  region: string;
  /** 该区域的**事实**陈述——不是评价、不是裁决 */
  fact: string;
}

export interface VisualObservationDoc {
  schema_version: string;
  protocol_version: number;
  /** 回指原参考图（project-relative）——与 ocr.json 的 source_image 同款理由：
   * 盲 agent 没有它就只能靠文件名猜「哪份观察对应哪张图」。 */
  source_image: string;
  image_hash: string;
  provider: ProviderRef;
  observations: VisualObservationEntry[];
}

export function visualObservationsDirAbs(
  projectRoot: string,
  feature: string,
  frameworkRoot?: string,
): string {
  return path.join(
    featurePhaseReportsDir(projectRoot, feature, 'spec', frameworkRoot),
    'visual-observations',
  );
}

/** slug 归一——与 OCR 预扫描同款（同一批参考图产出同名前缀，人读时天然对齐）。 */
export function sanitizeVisualObservationSlug(name: string): string {
  const slug = name.replace(/[^a-zA-Z0-9_一-鿿-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return slug || 'screen';
}

/** 列出盘上已有的 sidecar（plan/coding 只走这条路；spec 生产后也用它回列）。 */
export function listVisualObservationOutputs(
  projectRoot: string,
  frameworkRoot: string,
  feature: string,
): string[] {
  const dir = visualObservationsDirAbs(projectRoot, feature, frameworkRoot);
  try {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter(f => f.endsWith('.visual.json'))
      .map(f => path.relative(projectRoot, path.join(dir, f)).replace(/\\/g, '/'))
      .sort();
  } catch {
    return [];
  }
}

/** 三元复用键：hash + provider + 协议版本齐等才复用，否则重产。 */
export function isVisualObservationReusable(
  doc: unknown,
  expected: { imageHash: string; provider: ProviderRef },
): boolean {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return false;
  const d = doc as Partial<VisualObservationDoc>;
  return (
    d.protocol_version === VISUAL_OBSERVATION_PROTOCOL_VERSION &&
    d.image_hash === expected.imageHash &&
    d.provider?.adapter === expected.provider.adapter &&
    d.provider?.model === expected.provider.model &&
    Array.isArray(d.observations)
  );
}

/** 观察 prompt——只要**事实**，明确禁止裁决/打分/建议修复（那是 review 的事，不是这里）。 */
export function buildVisualObservationPrompt(imageAbsPath: string, imageHash: string): string {
  return [
    'You are a READ-ONLY visual observer. You cannot and must not modify anything in this project.',
    '',
    `Look at this image: ${imageAbsPath}`,
    '',
    'Describe what is actually visible, region by region: layout structure, element positions and',
    'relationships, text content and its placement, colors, spacing, iconography. State FACTS only.',
    'Do NOT judge quality, do NOT score, do NOT suggest fixes, do NOT guess intent — another step',
    'does that. If a region is unclear, say so plainly instead of inventing detail.',
    '',
    'Reply with ONE JSON object and nothing else:',
    '{',
    `  "schema_version": "${VISUAL_OBSERVATION_SCHEMA_VERSION}",`,
    `  "protocol_version": ${VISUAL_OBSERVATION_PROTOCOL_VERSION},`,
    `  "image_hashes": ["${imageHash}"],`,
    '  "observations": [ { "region": "<where>", "fact": "<what is actually there>" } ]',
    '}',
  ].join('\n');
}

/**
 * 解析观察载荷。**best-effort**：解析失败即该图无 sidecar，不产 check、不阻断。
 * 仍然校验 image_hashes 回显——旧图的观察绝不写进新图的 sidecar。
 */
export function parseVisualObservationPayload(
  body: string,
  expected: { imageHash: string },
): { ok: true; observations: VisualObservationEntry[] } | { ok: false; reason: string } {
  const doc = extractJsonObjectFromText(body);
  if (!doc) return { ok: false, reason: '正文中没有可解析的 JSON 对象' };
  const hashes = doc.image_hashes;
  if (!Array.isArray(hashes) || !hashes.includes(expected.imageHash)) {
    return { ok: false, reason: `image_hashes 未回显当前图片 hash（${expected.imageHash}）` };
  }
  const raw = doc.observations;
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, reason: 'observations 缺失或为空' };
  const observations: VisualObservationEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const region = typeof row.region === 'string' ? row.region.trim() : '';
    const fact = typeof row.fact === 'string' ? row.fact.trim() : '';
    if (region && fact) observations.push({ region, fact });
  }
  if (observations.length === 0) return { ok: false, reason: 'observations 无合法条目' };
  return { ok: true, observations };
}

export interface ProduceVisualObservationsInput {
  projectRoot: string;
  frameworkRoot: string;
  feature: string;
  provider: ProviderRef;
  /** 参考图绝对路径（工程内真实路径，不复制不暂存） */
  referenceImages: string[];
  /** 证据落盘根目录（通常 `<report_dir>/visual-review/`）；缺省=不落事件流 */
  evidenceRoot?: string;
  runId?: string;
  /** 每次 provider 调用的事件回调（`visual_provider_invoke`；调用方负责落事件流） */
  onInvocation?: (inv: VisualProviderInvocation) => void;
  timeoutMs?: number;
}

/**
 * spec 期逐图生产 sidecar（**幂等**：三元复用键齐等即跳过）。
 *
 * 失败语义与 OCR 预扫描逐字对齐：单图失败 `continue`，整体异常也只是少几份 sidecar，
 * **绝不抛出、绝不阻断 spec**。批次上限 = min(参考图数, 单 run 封顶)。
 *
 * 返回：盘上可用的 sidecar 的 project-relative 路径（含本轮新产与既有复用）。
 */
export async function produceVisualObservationSidecars(
  input: ProduceVisualObservationsInput,
): Promise<string[]> {
  const dir = visualObservationsDirAbs(input.projectRoot, input.feature, input.frameworkRoot);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    return listVisualObservationOutputs(input.projectRoot, input.frameworkRoot, input.feature);
  }

  const budget = resolveSpecObservationBudget(input.referenceImages.length);
  const used = new Set<string>();
  let spent = 0;

  for (const imgAbs of input.referenceImages) {
    const base = sanitizeVisualObservationSlug(path.basename(imgAbs, path.extname(imgAbs)));
    let slug = base;
    let n = 2;
    while (used.has(slug)) slug = `${base}_${n++}`;
    used.add(slug);

    const outAbs = path.join(dir, `${slug}.visual.json`);
    const imageHash = hashImageFile(imgAbs);
    if (!imageHash) continue; // 读不到图：跳过，不产 sidecar，不报错

    // 三元复用键命中即跳过（换 endpoint / 升协议 / 换图都会落空 → 重产）
    if (fs.existsSync(outAbs)) {
      try {
        const prior = JSON.parse(fs.readFileSync(outAbs, 'utf-8')) as unknown;
        if (isVisualObservationReusable(prior, { imageHash, provider: input.provider })) continue;
      } catch {
        /* 坏文件按未命中处理，下面重产覆盖 */
      }
    }
    if (spent >= budget) continue; // 批次上限：超出部分本轮不产（下轮再补）
    spent += 1;

    const invokeId = `obs-${slug}-${imageHash}`;
    const inv = await invokeVisualProvider({
      projectRoot: input.projectRoot,
      frameworkRoot: input.frameworkRoot,
      provider: input.provider,
      purpose: 'spec_observation',
      prompt: buildVisualObservationPrompt(imgAbs, imageHash),
      imagePaths: [imgAbs],
      invokeId,
      ...(input.evidenceRoot ? { evidenceDir: path.join(input.evidenceRoot, invokeId) } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    });
    input.onInvocation?.(inv);
    if (inv.outcome !== 'success' || !inv.body) continue;

    const parsed = parseVisualObservationPayload(inv.body, { imageHash });
    if (!parsed.ok) continue;

    const doc: VisualObservationDoc = {
      schema_version: VISUAL_OBSERVATION_SCHEMA_VERSION,
      protocol_version: VISUAL_OBSERVATION_PROTOCOL_VERSION,
      source_image: path.relative(input.projectRoot, imgAbs).replace(/\\/g, '/'),
      image_hash: imageHash,
      provider: { ...input.provider },
      observations: parsed.observations,
    };
    try {
      const tmp = `${outAbs}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf-8');
      fs.renameSync(tmp, outAbs);
    } catch {
      /* 写盘失败：该图无 sidecar，不阻断其余 */
    }
  }

  return listVisualObservationOutputs(input.projectRoot, input.frameworkRoot, input.feature);
}
