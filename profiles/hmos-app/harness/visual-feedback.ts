// ============================================================================
// visual-feedback.ts — 确定性视觉反馈回路（blind-visual-hardening d6 / plan a9d4c7e2 P1-E）
// ----------------------------------------------------------------------------
// 盲模型的"文本化眼睛"：参考图 × 设备截图 → 结构化差异 JSON（SSOT）+ md 投影，
// 喂 coding agent 逐条修复。两类信号分立（codex 三轮⑥/四轮⑤）：
//   hard（离散事实：ui-spec 声明文案在参考图侧可见而设备侧缺失）——可判定可阻断；
//   advisory（连续指标：区域主色 ΔE / 行距节奏比）——默认不阻断，只报事实。
// 【阻断承载声明（measured rollout）】本模块产出 = 修复输入 SSOT；文本缺失类阻断由既有
// OCR 门禁（visual-diff-ocr-gates gross-missing-anchor 等）继续承载，本 check 观察产出
// （WARN 列 hard findings）——待 P1-G 宿主实测回灌后再评估是否把 hard 升独立 BLOCKER，
// 避免同一事实双 BLOCKER 抖动。红线：不产单一全局相似度当质量结论（历史证伪）。
// 收敛：与上一轮 feedback JSON 的指纹集对比（converging|stalled|regressing|converged）；
// stalled 与既有 visual-rounds-ledger no-progress fuse 同源事实（defect 指纹由 visual_diff
// 结构化轮次承载——本模块不并行造熔断状态机，见 openspec visual-diff spec）。
// 身份：framework_version + package digest（RELEASE-MANIFEST.sha256，发布包环境）+
// gate_fingerprint + commit（可空）——至少 digest/commit 其一非空。
// deterministic_feedback 派生：effective_image_input=none ∧ ui_change 需 ui-spec——
// harness 机器派生，非 agent 可关配置。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import type { CheckContext, CheckResult } from '../../../harness/scripts/utils/types';
import { featureDir } from '../../../harness/config';
import { computeGateFingerprint } from '../../../harness/scripts/utils/gate-fingerprint';
import {
  UI_CHANGE_REQUIRES_UI_SPEC,
  loadUiSpecFile,
  parseUiChangeFromSpecMarkdown,
  uiSpecAbsPath,
  type UiSpecDoc,
} from '../../../harness/scripts/utils/ui-spec-shared';
import { loadSpecMarkdown } from '../../../harness/scripts/utils/fidelity-shared';
import { deltaE2000, hexToLab, isJimpAvailable, sampleColorFromBbox } from './image-toolkit';
import { clusterOcrLines, collectAuditableOcrLines, isOcrAvailable, ocrImageWords, type OcrLine } from './ocr-toolkit';
import { buildAuthoritativeRefImageIndex, resolveRefSourceImage } from './authoritative-ref-images';

export const VISUAL_FEEDBACK_SCHEMA_VERSION = '1.0';
/** advisory 升级冻结阈值（超过才值得列；不作 axis 裁决） */
export const COLOR_DELTA_E_REPORT_THRESHOLD = 12;
export const RHYTHM_RATIO_MIN = 0.6;
export const RHYTHM_RATIO_MAX = 1.7;

export type FeedbackKind = 'hard' | 'advisory';
export type ConvergenceState = 'first_round' | 'converged' | 'converging' | 'stalled' | 'regressing';

export interface VisualFeedbackFinding {
  id: string;
  screen_id: string;
  kind: FeedbackKind;
  metric: 'text_missing' | 'text_extra' | 'region_color' | 'line_rhythm';
  detail: string;
  fingerprint: string;
}

export interface VisualFeedbackIdentity {
  framework_version: string | null;
  framework_package_digest: string | null;
  gate_fingerprint: string | null;
  framework_commit_sha: string | null;
}

export interface VisualFeedbackScreen {
  screen_id: string;
  reference_sha256: string;
  actual_sha256: string;
  findings: VisualFeedbackFinding[];
}

export interface VisualFeedbackDoc {
  schema_version: string;
  feature: string;
  identity: VisualFeedbackIdentity;
  screens: VisualFeedbackScreen[];
  convergence: {
    state: ConvergenceState;
    current_fingerprints: string[];
    resolved_since_prev: string[];
    new_since_prev: string[];
  };
}

// ---------------------------------------------------------------------------
// 身份
// ---------------------------------------------------------------------------

export function resolveFeedbackIdentity(
  projectRoot: string,
  frameworkRoot: string,
  phase: string,
): VisualFeedbackIdentity {
  const gate = computeGateFingerprint(frameworkRoot, phase) ?? null;
  const framework_version = gate ? gate.split(':')[0] : null;
  let framework_package_digest: string | null = null;
  const manifestPath = path.join(frameworkRoot, 'RELEASE-MANIFEST.sha256');
  if (fs.existsSync(manifestPath)) {
    framework_package_digest = crypto.createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex');
  }
  let framework_commit_sha: string | null = null;
  try {
    const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: frameworkRoot, encoding: 'utf-8', shell: false });
    framework_commit_sha = r.status === 0 ? r.stdout.trim() : null;
  } catch { /* 发布包环境无 git——digest 承担身份 */ }
  return { framework_version, framework_package_digest, gate_fingerprint: gate, framework_commit_sha };
}

// ---------------------------------------------------------------------------
// 纯判定件（单测面）
// ---------------------------------------------------------------------------

function fp(parts: string[]): string {
  return crypto.createHash('sha256').update(parts.join(''), 'utf-8').digest('hex').slice(0, 16);
}

const normText = (s: string): string => s.replace(/\s+/g, '').toLowerCase();

/** 文本差异：ref 侧可审计行 vs 设备侧——声明文案缺失=hard，其余=advisory */
export function diffTextLines(
  screenId: string,
  refLines: OcrLine[],
  actualLines: OcrLine[],
  declaredTexts: Set<string>,
): VisualFeedbackFinding[] {
  const actualSet = new Set(actualLines.map(l => normText(l.text)));
  const refSet = new Set(refLines.map(l => normText(l.text)));
  const out: VisualFeedbackFinding[] = [];
  for (const l of refLines) {
    const t = normText(l.text);
    if (actualSet.has(t)) continue;
    // 子串容错：设备行含参考行（或反向）不算缺失（OCR 拼行噪声）
    if ([...actualSet].some(a => a.includes(t) || t.includes(a))) continue;
    const declared = [...declaredTexts].some(d => t.includes(normText(d)) || normText(d).includes(t));
    out.push({
      id: `${screenId}:text_missing:${t.slice(0, 16)}`,
      screen_id: screenId,
      kind: declared ? 'hard' : 'advisory',
      metric: 'text_missing',
      detail: `参考图文本「${l.text.trim()}」设备侧缺失${declared ? '（ui-spec 声明文案——硬不变量）' : '（OCR 观察，容噪）'}`,
      fingerprint: fp([screenId, 'text_missing', t]),
    });
  }
  for (const l of actualLines) {
    const t = normText(l.text);
    if (refSet.has(t)) continue;
    if ([...refSet].some(a => a.includes(t) || t.includes(a))) continue;
    out.push({
      id: `${screenId}:text_extra:${t.slice(0, 16)}`,
      screen_id: screenId,
      kind: 'advisory',
      metric: 'text_extra',
      detail: `设备侧多出文本「${l.text.trim()}」（参考图无——原图没有的文案不得无中生有）`,
      fingerprint: fp([screenId, 'text_extra', t]),
    });
  }
  return out;
}

/** 行距节奏：可审计行 y 中心序列的平均间距比（连续指标，advisory） */
export function diffLineRhythm(
  screenId: string,
  refLines: OcrLine[],
  actualLines: OcrLine[],
): VisualFeedbackFinding | null {
  const gaps = (lines: OcrLine[]): number[] => {
    const ys = lines.map(l => l.box[1] + l.box[3] / 2).sort((a, b) => a - b);
    const out: number[] = [];
    for (let i = 1; i < ys.length; i++) out.push(ys[i] - ys[i - 1]);
    return out.filter(g => g > 0.005);
  };
  const refG = gaps(refLines);
  const actG = gaps(actualLines);
  if (refG.length < 2 || actG.length < 2) return null;
  const mean = (a: number[]): number => a.reduce((s, x) => s + x, 0) / a.length;
  const ratio = mean(actG) / mean(refG);
  if (ratio >= RHYTHM_RATIO_MIN && ratio <= RHYTHM_RATIO_MAX) return null;
  return {
    id: `${screenId}:line_rhythm`,
    screen_id: screenId,
    kind: 'advisory',
    metric: 'line_rhythm',
    detail: `行距节奏约为参考图 ${ratio.toFixed(2)} 倍（合理带 [${RHYTHM_RATIO_MIN}, ${RHYTHM_RATIO_MAX}]）——密度/留白偏差`,
    fingerprint: fp([screenId, 'line_rhythm', ratio > 1 ? 'sparse' : 'dense']),
  };
}

/** 收敛判定：指纹集对比（cur⊂prev→converging；==→stalled；新增→regressing；空→converged） */
export function classifyConvergence(
  prev: string[] | null,
  current: string[],
): VisualFeedbackDoc['convergence'] {
  const cur = [...new Set(current)].sort();
  if (prev === null) {
    return { state: cur.length === 0 ? 'converged' : 'first_round', current_fingerprints: cur, resolved_since_prev: [], new_since_prev: [] };
  }
  const prevSet = new Set(prev);
  const curSet = new Set(cur);
  const resolved = prev.filter(x => !curSet.has(x));
  const added = cur.filter(x => !prevSet.has(x));
  let state: ConvergenceState;
  if (cur.length === 0) state = 'converged';
  else if (added.length > 0) state = 'regressing';
  else if (resolved.length > 0) state = 'converging';
  else state = 'stalled';
  return { state, current_fingerprints: cur, resolved_since_prev: resolved, new_since_prev: added };
}

// ---------------------------------------------------------------------------
// 生成
// ---------------------------------------------------------------------------

export function visualFeedbackJsonPath(projectRoot: string, feature: string): string {
  return path.join(featureDir(projectRoot, feature), 'device-testing', 'visual-feedback.json');
}

export function visualFeedbackMdPath(projectRoot: string, feature: string): string {
  return path.join(featureDir(projectRoot, feature), 'device-testing', 'visual-feedback.md');
}

/** deterministic_feedback 机器派生（非 agent 可关配置）：盲档 ∧ UI 需求 */
export function isDeterministicFeedbackRequired(ctx: CheckContext): boolean {
  if (ctx.adapterImageInput !== 'none') return false;
  const specMd = loadSpecMarkdown(ctx.projectRoot, ctx.feature);
  const uiChange = specMd ? parseUiChangeFromSpecMarkdown(specMd) : null;
  return Boolean(uiChange && UI_CHANGE_REQUIRES_UI_SPEC.has(uiChange));
}

function collectDeclaredTextUniverse(doc: UiSpecDoc | null): Set<string> {
  const out = new Set<string>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const rec = node as Record<string, unknown>;
    if (typeof rec.text === 'string' && rec.text.trim().length >= 2 && !/[{}<]/.test(rec.text)) {
      out.add(rec.text.trim());
    }
    for (const key of ['children', 'root', 'item_template']) {
      const v = rec[key];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') walk(v);
    }
  };
  for (const s of doc?.screens ?? []) walk(s);
  return out;
}

function sha256File(p: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function ocrAuditableLines(imageAbs: string): OcrLine[] | null {
  const r = ocrImageWords(imageAbs);
  if (!r.ok || !r.words) return null;
  return collectAuditableOcrLines(clusterOcrLines(r.words));
}

/** 主生成入口：采集物+参考图在即评；缺任何前置（OCR/参考图/截图）→ null（调用方如实降级） */
export function generateVisualFeedback(ctx: CheckContext): VisualFeedbackDoc | null {
  if (!isOcrAvailable()) return null;
  const shotsDir = path.join(featureDir(ctx.projectRoot, ctx.feature), 'device-testing', 'device-screenshots');
  if (!fs.existsSync(shotsDir)) return null;
  const uiDoc = loadUiSpecFile(uiSpecAbsPath(ctx.projectRoot, ctx.feature));
  if (!uiDoc) return null;
  const declared = collectDeclaredTextUniverse(uiDoc);
  const specMd = loadSpecMarkdown(ctx.projectRoot, ctx.feature);
  if (!specMd) return null;
  const refIndex = buildAuthoritativeRefImageIndex(ctx, specMd);

  const screens: VisualFeedbackScreen[] = [];
  for (const s of uiDoc.screens ?? []) {
    const shotAbs = path.join(shotsDir, `shot-${s.id}.png`);
    if (!fs.existsSync(shotAbs)) continue;
    const refAbs = resolveRefSourceImage(refIndex, s.ref_id ?? s.id).path;
    if (!refAbs || !fs.existsSync(refAbs)) continue;
    const refLines = ocrAuditableLines(refAbs);
    const actualLines = ocrAuditableLines(shotAbs);
    if (!refLines || !actualLines) continue;

    const findings: VisualFeedbackFinding[] = [
      ...diffTextLines(s.id, refLines, actualLines, declared),
    ];
    const rhythm = diffLineRhythm(s.id, refLines, actualLines);
    if (rhythm) findings.push(rhythm);

    // OCR 锚定分区主色（连续指标）：取面积前 3 的参考行区域
    if (isJimpAvailable()) {
      const top = [...refLines]
        .sort((a, b) => b.box[2] * b.box[3] - a.box[2] * a.box[3])
        .slice(0, 3);
      for (const l of top) {
        const refC = sampleColorFromBbox(refAbs, l.box, 0.1);
        const actC = sampleColorFromBbox(shotAbs, l.box, 0.1);
        if (!refC.sampled || !actC.sampled) continue;
        const dE = deltaE2000(hexToLab(refC.hex), hexToLab(actC.hex));
        if (dE > COLOR_DELTA_E_REPORT_THRESHOLD) {
          findings.push({
            id: `${s.id}:region_color:${normText(l.text).slice(0, 12)}`,
            screen_id: s.id,
            kind: 'advisory',
            metric: 'region_color',
            detail: `「${l.text.trim()}」锚定区主色偏差：参考 ${refC.hex} vs 实现 ${actC.hex}（ΔE=${dE.toFixed(1)} > ${COLOR_DELTA_E_REPORT_THRESHOLD}）`,
            fingerprint: fp([s.id, 'region_color', normText(l.text)]),
          });
        }
      }
    }
    screens.push({ screen_id: s.id, reference_sha256: sha256File(refAbs), actual_sha256: sha256File(shotAbs), findings });
  }
  if (screens.length === 0) return null;

  let prevFingerprints: string[] | null = null;
  const jsonPath = visualFeedbackJsonPath(ctx.projectRoot, ctx.feature);
  if (fs.existsSync(jsonPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as VisualFeedbackDoc;
      prevFingerprints = prev.convergence?.current_fingerprints ?? null;
    } catch { prevFingerprints = null; }
  }
  const allFps = screens.flatMap(s => s.findings.map(f => f.fingerprint));
  return {
    schema_version: VISUAL_FEEDBACK_SCHEMA_VERSION,
    feature: ctx.feature,
    identity: resolveFeedbackIdentity(ctx.projectRoot, ctx.frameworkRoot, String(ctx.phase)),
    screens,
    convergence: classifyConvergence(prevFingerprints, allFps),
  };
}

export function renderVisualFeedbackMd(doc: VisualFeedbackDoc): string {
  const hard = doc.screens.flatMap(s => s.findings.filter(f => f.kind === 'hard'));
  const advisory = doc.screens.flatMap(s => s.findings.filter(f => f.kind === 'advisory'));
  return [
    `# 视觉反馈 — ${doc.feature}`,
    '',
    '> 本文件为 visual-feedback.json（机器真值）的人类投影。逐条修复后重跑设备采集对账收敛。',
    `> 收敛：${doc.convergence.state}（本轮 ${doc.convergence.current_fingerprints.length} 项；较上轮 -${doc.convergence.resolved_since_prev.length} / +${doc.convergence.new_since_prev.length}）`,
    '',
    `## 硬不变量（${hard.length}）`,
    ...(hard.length > 0 ? hard.map(f => `- [${f.screen_id}] ${f.detail}`) : ['（无）']),
    '',
    `## 连续指标 advisory（${advisory.length}）——默认不阻断，禁止用单一全局相似度裁决整体质量`,
    ...(advisory.length > 0 ? advisory.map(f => `- [${f.screen_id}] ${f.detail}`) : ['（无）']),
    '',
  ].join('\n');
}

export function writeVisualFeedback(projectRoot: string, doc: VisualFeedbackDoc): void {
  const jsonPath = visualFeedbackJsonPath(projectRoot, doc.feature);
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf-8');
  fs.writeFileSync(visualFeedbackMdPath(projectRoot, doc.feature), renderVisualFeedbackMd(doc), 'utf-8');
}

/** check 面：盲档 UI 需求生成反馈（观察产出；阻断承载见文件头声明） */
export function checkVisualFeedback(ctx: CheckContext): CheckResult[] {
  const id = 'visual_feedback';
  const description = '确定性视觉反馈（盲档 deterministic_feedback：JSON SSOT + md 投影，两类信号分立）';
  if (!isDeterministicFeedbackRequired(ctx)) return [];
  const doc = generateVisualFeedback(ctx);
  if (!doc) {
    return [{
      id, category: 'structure', description,
      severity: 'MINOR', status: 'SKIP',
      details: '前置不齐（OCR 环境/参考图索引/设备截图任一缺失）——反馈未生成；采集完备性归既有门禁。',
    }];
  }
  writeVisualFeedback(ctx.projectRoot, doc);
  const hard = doc.screens.flatMap(s => s.findings.filter(f => f.kind === 'hard'));
  const advisory = doc.screens.flatMap(s => s.findings.filter(f => f.kind === 'advisory'));
  if (hard.length === 0) {
    return [{
      id, category: 'structure', description,
      severity: 'MAJOR', status: 'PASS',
      details: `反馈已生成（${doc.screens.length} 屏；advisory=${advisory.length}；收敛=${doc.convergence.state}）；无硬不变量违例。`,
    }];
  }
  return [{
    id, category: 'structure', description,
    severity: 'MAJOR', status: 'WARN',
    details: [
      `【视觉反馈】硬不变量 ${hard.length} 项（声明文案设备侧缺失）+ advisory ${advisory.length} 项；收敛=${doc.convergence.state}：`,
      ...hard.slice(0, 8).map(f => `  - [${f.screen_id}] ${f.detail}`),
      '（阻断承载：文本存在性 BLOCKER 归既有 OCR 门禁；本条为修复输入 SSOT——见 visual-feedback.md）',
    ].join('\n'),
    suggestion: '按 visual-feedback.md 逐条修复后重跑设备采集；stalled/regressing 会被轮次账本熔断链捕获。',
    structured: { kind: 'visual_feedback', convergence: doc.convergence.state, hard: hard.length, advisory: advisory.length },
  }];
}
