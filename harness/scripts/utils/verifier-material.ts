// ============================================================================
// verifier-material.ts — verifier subject 的「审前材料视图」（plan 07a41ec6 T7 /
// openspec efficiency-first-closure「Verifier runs once per material」）
// ----------------------------------------------------------------------------
// 此前 subject 直接哈希 ai-prompt.md 字节：模板里的 {timestamp} 让每次 harness 重跑都换代，
// 宿主 2026-09-02 回归 34 次 verifier 里绝大多数审的是同一批材料。现在 subject 按
// **verifier 实际要审的材料**寻址：
//   · phase 输入/产物文件（spec-loader REQUIRED/OPTIONAL 表，经 evidence manifest 解析）；
//   · verifier 会读的上下文文件（源码 / 用例 / 图片，即 collectContextFiles 的实体文件）；
//   · phase 规则文本、prompt 模板（含 overlay）、gate 指纹；
//   · 脚本报告的 `<id>=<status>/<severity>` 投影（细节文案含时间戳/路径，不入材料）。
// 明确排除：ai-prompt.md 自身、reports/ 下的运行期产物（summary / verifier 报告 / merged-report /
// script-report）、回执；**例外**：verifier 必读的运行期证据（testing 最新真机 run 的 trace.json、
// visual-diff.json）由 runner 以路径条目送进 contextFiles，因此仍在材料内（codex review）。材料未变 → 同 subject → 既有报告直接复用；
// 材料变了但本 phase 历史已有 PASS → 闭环沿用并如实登记未重审差异（check-receipt）。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { featurePhaseReportsDir } from '../../config';
import { resolvePhaseEvidenceManifest } from './phase-evidence-manifest';
import type { ContextFileEntry, Phase } from './types';

export const VERIFIER_MATERIAL_SCHEMA = 'maison-verifier-material@1';

export interface VerifierMaterialFile {
  /** 仓根相对 posix 路径 */
  path: string;
  /** 文件字节 sha256；不存在为 null */
  sha256: string | null;
}

export interface VerifierMaterialView {
  schema: string;
  feature: string;
  phase: string;
  gate_fingerprint: string | null;
  phase_rule_sha256: string;
  template_sha256: string;
  /** 脚本报告投影：`<id>=<status>/<severity>`，排序 */
  script_checks: string[];
  /** lifecycle hook fragments（装配进 prompt 的实例/profile 片段）哈希；无片段为空串 */
  lifecycle_sha256: string;
  /** 按路径排序的材料文件 */
  files: VerifierMaterialFile[];
  material_sha256: string;
}

function sha256Text(text: string): string {
  return crypto.createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf-8').digest('hex');
}

function sha256FileOrNull(abs: string): string | null {
  try {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
    return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
  } catch {
    return null;
  }
}

function toPosixRel(root: string, abs: string): string {
  return path.relative(root, abs).replace(/\\/g, '/');
}

/** 材料指纹：字段顺序固定，不依赖 JSON 键序。 */
export function computeMaterialSha256(view: Omit<VerifierMaterialView, 'material_sha256'>): string {
  return sha256Text(
    [
      view.schema,
      `feature=${view.feature}`,
      `phase=${view.phase}`,
      `gate_fingerprint=${view.gate_fingerprint ?? '<absent>'}`,
      `phase_rule_sha256=${view.phase_rule_sha256}`,
      `template_sha256=${view.template_sha256}`,
      `lifecycle_sha256=${view.lifecycle_sha256 ?? ''}`,
      ...view.script_checks.map(c => `check=${c}`),
      ...view.files.map(f => `file=${f.path} sha256=${f.sha256 ?? '<absent>'}`),
    ].join('\n'),
  );
}

export interface BuildVerifierMaterialInput {
  projectRoot: string;
  feature: string;
  phase: string;
  frameworkRoot?: string;
  gateFingerprint: string | null;
  /** 装配进 prompt 的 phase 规则文本（YAML.stringify(phaseRule)） */
  phaseRuleText: string;
  /** 装配所用模板文本（含 profile overlay） */
  templateText: string;
  checks: ReadonlyArray<{ id: string; status: string; severity: string }>;
  contextFiles: ReadonlyArray<ContextFileEntry>;
  /** 装配进 prompt 的 lifecycle hook fragments（实例 / profile / framework） */
  lifecycleFragments?: ReadonlyArray<string>;
}

export function buildVerifierMaterialView(input: BuildVerifierMaterialInput): VerifierMaterialView {
  const { projectRoot, feature, phase } = input;
  const reportsRel = toPosixRel(projectRoot, featurePhaseReportsDir(projectRoot, feature, phase, input.frameworkRoot));
  const files = new Map<string, string | null>();
  const isRuntimeArtifact = (rel: string): boolean =>
    rel === reportsRel || rel.startsWith(`${reportsRel}/`) || path.basename(rel) === 'phase-completion-receipt.md';

  try {
    const manifest = resolvePhaseEvidenceManifest({
      projectRoot,
      feature,
      phase: phase as Phase,
      frameworkRoot: input.frameworkRoot,
    });
    for (const entry of [...manifest.inputs, ...manifest.outputs]) {
      if (isRuntimeArtifact(entry.path)) continue;
      files.set(entry.path, entry.sha256);
    }
  } catch {
    /* manifest 解析失败（无 frameworkRoot 等）→ 只按上下文文件寻址 */
  }

  for (const cf of input.contextFiles) {
    const abs = cf.imagePath
      ? cf.imagePath
      : cf.label && !cf.label.startsWith('(') && !path.isAbsolute(cf.label)
        ? path.join(projectRoot, cf.label)
        : null;
    if (!abs) continue;
    const rel = toPosixRel(projectRoot, abs);
    // contextFiles 是 verifier 实际读取面：显式送进来的运行期证据（trace / visual-diff）不受 reports/ 排除规则限制
    if (files.has(rel)) continue;
    const sha = sha256FileOrNull(abs);
    if (sha !== null) files.set(rel, sha);
  }

  const base = {
    schema: VERIFIER_MATERIAL_SCHEMA,
    feature,
    phase,
    gate_fingerprint: input.gateFingerprint,
    phase_rule_sha256: sha256Text(input.phaseRuleText),
    template_sha256: sha256Text(input.templateText),
    lifecycle_sha256: input.lifecycleFragments && input.lifecycleFragments.length > 0 ? sha256Text(input.lifecycleFragments.join('\n---\n')) : '',
    script_checks: input.checks.map(c => `${c.id}=${c.status}/${c.severity}`).sort(),
    files: [...files.entries()].map(([p, sha256]) => ({ path: p, sha256 })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  };
  return { ...base, material_sha256: computeMaterialSha256(base) };
}

/** 材料视图按 subject 分区落盘（与 request / report 同目录）。 */
export function verifierMaterialFilename(subjectId: string): string {
  if (!/^[0-9a-f]{64}$/.test(subjectId)) {
    throw new Error(`[verifier-material] 非法 subject id：${JSON.stringify(subjectId)}`);
  }
  return `verifier.material.${subjectId}.json`;
}

export function writeVerifierMaterial(reportsDir: string, subjectId: string, view: VerifierMaterialView): string {
  const abs = path.join(reportsDir, verifierMaterialFilename(subjectId));
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(view, null, 2)}\n`, 'utf-8');
  return abs;
}

export function readVerifierMaterialOrNull(reportsDir: string, subjectId: string): VerifierMaterialView | null {
  try {
    const abs = path.join(reportsDir, verifierMaterialFilename(subjectId));
    if (!fs.existsSync(abs)) return null;
    const parsed = JSON.parse(fs.readFileSync(abs, 'utf-8')) as VerifierMaterialView;
    return parsed && parsed.schema === VERIFIER_MATERIAL_SCHEMA && Array.isArray(parsed.files) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 两份材料视图的差异（人读列表，写进 summary.verifier_closure.current_material_not_reverified）。
 * 上一份缺失时无法逐项对账，如实写「(prior material manifest unavailable)」。
 */
export function diffVerifierMaterial(prev: VerifierMaterialView | null, curr: VerifierMaterialView | null): string[] {
  if (!prev || !curr) return ['(prior material manifest unavailable)'];
  const out: string[] = [];
  if (prev.gate_fingerprint !== curr.gate_fingerprint) out.push('gate_fingerprint');
  if (prev.phase_rule_sha256 !== curr.phase_rule_sha256) out.push('phase_rules');
  if (prev.template_sha256 !== curr.template_sha256) out.push('verifier_prompt_template');
  if ((prev.lifecycle_sha256 ?? '') !== (curr.lifecycle_sha256 ?? '')) out.push('lifecycle_hook_fragments');
  if (prev.script_checks.join('\n') !== curr.script_checks.join('\n')) out.push('script_report_checks');
  const prevFiles = new Map(prev.files.map(f => [f.path, f.sha256]));
  const currFiles = new Map(curr.files.map(f => [f.path, f.sha256]));
  for (const [p, sha] of currFiles) {
    if (!prevFiles.has(p)) out.push(`+${p}`);
    else if (prevFiles.get(p) !== sha) out.push(p);
  }
  for (const p of prevFiles.keys()) if (!currFiles.has(p)) out.push(`-${p}`);
  return out;
}
