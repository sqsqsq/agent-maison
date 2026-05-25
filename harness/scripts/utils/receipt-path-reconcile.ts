// ============================================================================
// Post-UPDATE receipt 路径 reconcile（legacy reports → doc/features/reports）
// ============================================================================
// init UPDATE 写入 reports_dir_pattern 后，回执 frontmatter 可能仍指向
// framework/harness/reports/...；若对应文件已迁到 doc/features/.../reports/，
// 本模块检测并（在用户确认后）patch 路径字段。

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import {
  featurePhaseReportsDir,
  loadFrameworkConfig,
  receiptFilePath,
  relFeaturePhaseReportsDir,
} from '../../config';

const LEGACY_REPORTS_PREFIX = 'framework/harness/reports/';

export interface ReceiptPathPatch {
  field: string;
  from: string;
  to: string;
}

export interface ReceiptReconcileCandidate {
  feature: string;
  phase: string;
  receipt_path: string;
  patches: ReceiptPathPatch[];
}

interface ReceiptFrontmatter {
  feature?: string;
  phase?: string;
  script_harness?: { report_dir?: string };
  verifier_subagent?: { report_path?: string };
  trace_json?: { path?: string };
  self_check?: { q1_trace_json_abs_path?: string };
}

function toPosixRel(projectRoot: string, absOrRel: string): string {
  if (path.isAbsolute(absOrRel)) {
    return path.relative(projectRoot, absOrRel).replace(/\\/g, '/');
  }
  return absOrRel.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function isReceiptPathReconcileEnabled(projectRoot: string): boolean {
  const pattern = loadFrameworkConfig(projectRoot).paths.reports_dir_pattern;
  return typeof pattern === 'string' && pattern.trim().length > 0;
}

export function isLegacyReportsRelPath(relPath: string): boolean {
  return relPath.replace(/\\/g, '/').replace(/^\.\//, '').startsWith(LEGACY_REPORTS_PREFIX);
}

function legacyReportsSuffix(feature: string, phase: string, legacyRel: string): string | null {
  const norm = legacyRel.replace(/\\/g, '/').replace(/^\.\//, '');
  const prefix = `${LEGACY_REPORTS_PREFIX}${feature}/${phase}/`;
  if (!norm.startsWith(prefix)) {
    return null;
  }
  return norm.slice(prefix.length);
}

export function resolveModernReportsRelForLegacyRef(
  projectRoot: string,
  feature: string,
  phase: string,
  declaredPath: string,
): string | null {
  const legacyRel = toPosixRel(projectRoot, declaredPath);
  if (!legacyRel.startsWith(LEGACY_REPORTS_PREFIX)) {
    return null;
  }
  const legacyAbs = path.resolve(projectRoot, legacyRel);
  if (fs.existsSync(legacyAbs)) {
    return null;
  }
  const suffix = legacyReportsSuffix(feature, phase, legacyRel);
  if (suffix === null) {
    return null;
  }
  const modernRel = `${relFeaturePhaseReportsDir(projectRoot, feature, phase)}/${suffix}`;
  const modernAbs = path.resolve(projectRoot, modernRel);
  if (!fs.existsSync(modernAbs)) {
    return null;
  }
  return modernRel;
}

function resolveModernReportDirRel(
  projectRoot: string,
  feature: string,
  phase: string,
  declaredDir: string,
): string | null {
  const legacyRel = toPosixRel(projectRoot, declaredDir).replace(/\/$/, '');
  const expectedLegacy = `${LEGACY_REPORTS_PREFIX}${feature}/${phase}`.replace(/\/$/, '');
  if (legacyRel !== expectedLegacy) {
    return null;
  }
  const modernRel = relFeaturePhaseReportsDir(projectRoot, feature, phase);
  const modernAbs = path.resolve(projectRoot, modernRel);
  if (!fs.existsSync(modernAbs)) {
    return null;
  }
  if (fs.existsSync(path.resolve(projectRoot, legacyRel))) {
    return null;
  }
  return modernRel;
}

function parseFrontmatterAndBody(raw: string): { frontmatter: ReceiptFrontmatter; body: string } {
  const trimmed = raw.replace(/^\uFEFF/, '');
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(trimmed);
  if (!fmMatch) {
    throw new Error('未找到 YAML frontmatter（必须以 `---` 开头并以 `---` 结束）。');
  }
  const data = YAML.parse(fmMatch[1]) as ReceiptFrontmatter | null;
  if (!data || typeof data !== 'object') {
    throw new Error('frontmatter 必须是对象类型。');
  }
  return { frontmatter: data, body: fmMatch[2] ?? '' };
}

function writeFrontmatterAndBody(
  receiptAbs: string,
  frontmatter: ReceiptFrontmatter,
  body: string,
): void {
  const yaml = YAML.stringify(frontmatter).trimEnd();
  fs.writeFileSync(receiptAbs, `---\n${yaml}\n---\n${body}`, 'utf-8');
}

export function detectReceiptPathPatches(
  projectRoot: string,
  feature: string,
  phase: string,
  frontmatter: ReceiptFrontmatter,
): ReceiptPathPatch[] {
  const patches: ReceiptPathPatch[] = [];

  const tracePath = frontmatter.trace_json?.path?.trim();
  if (tracePath) {
    const modernRel = resolveModernReportsRelForLegacyRef(projectRoot, feature, phase, tracePath);
    if (modernRel) {
      patches.push({ field: 'trace_json.path', from: tracePath, to: modernRel });
    }
  }

  const verifierPath = frontmatter.verifier_subagent?.report_path?.trim();
  if (verifierPath) {
    const modernRel = resolveModernReportsRelForLegacyRef(projectRoot, feature, phase, verifierPath);
    if (modernRel) {
      patches.push({ field: 'verifier_subagent.report_path', from: verifierPath, to: modernRel });
    }
  }

  const reportDir = frontmatter.script_harness?.report_dir?.trim();
  if (reportDir) {
    const modernDir = resolveModernReportDirRel(projectRoot, feature, phase, reportDir);
    if (modernDir) {
      patches.push({ field: 'script_harness.report_dir', from: reportDir, to: modernDir });
    }
  }

  const q1 = frontmatter.self_check?.q1_trace_json_abs_path?.trim();
  if (q1) {
    const modernRel = resolveModernReportsRelForLegacyRef(projectRoot, feature, phase, q1);
    if (modernRel) {
      const modernAbs = path.resolve(projectRoot, modernRel);
      patches.push({
        field: 'self_check.q1_trace_json_abs_path',
        from: q1,
        to: modernAbs.replace(/\\/g, '/'),
      });
    }
  }

  return patches;
}

function listReceiptTargets(
  projectRoot: string,
  filter?: { feature?: string; phase?: string },
): Array<{ feature: string; phase: string; receiptAbs: string }> {
  const cfg = loadFrameworkConfig(projectRoot);
  const featuresDir = path.resolve(projectRoot, cfg.paths.features_dir ?? 'doc/features');
  if (!fs.existsSync(featuresDir)) {
    return [];
  }

  const out: Array<{ feature: string; phase: string; receiptAbs: string }> = [];
  for (const feature of fs.readdirSync(featuresDir)) {
    if (filter?.feature && feature !== filter.feature) {
      continue;
    }
    const featureDir = path.join(featuresDir, feature);
    if (!fs.statSync(featureDir).isDirectory()) {
      continue;
    }
    for (const phase of fs.readdirSync(featureDir)) {
      if (filter?.phase && phase !== filter.phase) {
        continue;
      }
      const receiptAbs = receiptFilePath(projectRoot, feature, phase);
      if (fs.existsSync(receiptAbs)) {
        out.push({ feature, phase, receiptAbs });
      }
    }
  }
  return out;
}

export function scanReceiptPathReconcileCandidates(
  projectRoot: string,
  filter?: { feature?: string; phase?: string },
): ReceiptReconcileCandidate[] {
  if (!isReceiptPathReconcileEnabled(projectRoot)) {
    return [];
  }

  const candidates: ReceiptReconcileCandidate[] = [];
  for (const { feature, phase, receiptAbs } of listReceiptTargets(projectRoot, filter)) {
    const raw = fs.readFileSync(receiptAbs, 'utf-8');
    const { frontmatter } = parseFrontmatterAndBody(raw);
    const patches = detectReceiptPathPatches(projectRoot, feature, phase, frontmatter);
    if (patches.length === 0) {
      continue;
    }
    candidates.push({
      feature,
      phase,
      receipt_path: path.relative(projectRoot, receiptAbs).replace(/\\/g, '/'),
      patches,
    });
  }
  return candidates;
}

function applyPatchToFrontmatter(frontmatter: ReceiptFrontmatter, patch: ReceiptPathPatch): void {
  switch (patch.field) {
    case 'trace_json.path':
      frontmatter.trace_json = frontmatter.trace_json ?? {};
      frontmatter.trace_json.path = patch.to;
      break;
    case 'verifier_subagent.report_path':
      frontmatter.verifier_subagent = frontmatter.verifier_subagent ?? {};
      frontmatter.verifier_subagent.report_path = patch.to;
      break;
    case 'script_harness.report_dir':
      frontmatter.script_harness = frontmatter.script_harness ?? {};
      frontmatter.script_harness.report_dir = patch.to;
      break;
    case 'self_check.q1_trace_json_abs_path':
      frontmatter.self_check = frontmatter.self_check ?? {};
      frontmatter.self_check.q1_trace_json_abs_path = patch.to;
      break;
    default:
      throw new Error(`未知 patch 字段: ${patch.field}`);
  }
}

export function applyReceiptPathReconcileCandidate(
  projectRoot: string,
  candidate: ReceiptReconcileCandidate,
): void {
  const receiptAbs = path.resolve(projectRoot, candidate.receipt_path);
  const raw = fs.readFileSync(receiptAbs, 'utf-8');
  const { frontmatter, body } = parseFrontmatterAndBody(raw);
  for (const patch of candidate.patches) {
    applyPatchToFrontmatter(frontmatter, patch);
  }
  writeFrontmatterAndBody(receiptAbs, frontmatter, body);
}

export interface ApplyReceiptPathReconcileResult {
  applied: ReceiptReconcileCandidate[];
  skipped: ReceiptReconcileCandidate[];
}

export function applyReceiptPathReconcileCandidates(
  projectRoot: string,
  candidates: ReceiptReconcileCandidate[],
): ApplyReceiptPathReconcileResult {
  const applied: ReceiptReconcileCandidate[] = [];
  const skipped: ReceiptReconcileCandidate[] = [];

  for (const candidate of candidates) {
    try {
      applyReceiptPathReconcileCandidate(projectRoot, candidate);
      applied.push(candidate);
    } catch {
      skipped.push(candidate);
    }
  }
  return { applied, skipped };
}

/** 供 init / agent 使用：扫描并可选 apply（apply 须用户确认后再调用）。 */
export function runReceiptPathReconcile(options: {
  projectRoot: string;
  apply?: boolean;
  feature?: string;
  phase?: string;
}): { exitCode: number; candidates: ReceiptReconcileCandidate[] } {
  const { projectRoot, apply = false, feature, phase } = options;
  if (!isReceiptPathReconcileEnabled(projectRoot)) {
    console.log('reconcile-receipt-paths: 未配置 paths.reports_dir_pattern，跳过。');
    return { exitCode: 0, candidates: [] };
  }

  const candidates = scanReceiptPathReconcileCandidates(projectRoot, { feature, phase });
  if (candidates.length === 0) {
    console.log('reconcile-receipt-paths: 未发现需 reconcile 的回执路径。');
    return { exitCode: 0, candidates: [] };
  }

  for (const c of candidates) {
    console.log(`\n📋 ${c.receipt_path} (${c.feature}/${c.phase})`);
    for (const p of c.patches) {
      console.log(`   ${p.field}:`);
      console.log(`     - ${p.from}`);
      console.log(`     + ${p.to}`);
    }
  }

  if (!apply) {
    console.log('\n（dry-run）加 --apply 才会写入 frontmatter。');
    return { exitCode: 0, candidates };
  }

  const result = applyReceiptPathReconcileCandidates(projectRoot, candidates);
  console.log(`\n✅ 已 patch ${result.applied.length} 份回执`);
  if (result.skipped.length > 0) {
    console.error(`❌ 跳过 ${result.skipped.length} 份（写入失败）`);
    return { exitCode: 1, candidates };
  }
  return { exitCode: 0, candidates };
}

export const __testing = {
  parseFrontmatterAndBody,
  featurePhaseReportsDir,
};
