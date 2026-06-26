// ============================================================================
// device_test.visual_diff — Hylyre 截图报告校验（禁假 PASS）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type { CheckContext, CheckResult } from '../../../harness/scripts/utils/types';
import { relFeatureArtifact } from '../../../harness/config';
import {
  UI_CHANGE_REQUIRES_UI_SPEC,
  loadUiSpecFile,
  parseUiChangeFromSpecMarkdown,
  uiSpecAbsPath,
  collectAllComponentNodes,
  type UiSpecDoc,
} from '../../../harness/scripts/utils/ui-spec-shared';
import { extractCodeBlocks } from '../../../harness/scripts/utils/markdown-parser';
import { collectP0VisualTargetIds } from './visual-diff-targets';
import { isPixel1to1, fidelityRatchetFailOrWarn } from '../../../harness/scripts/utils/fidelity-shared';
import { loadRefElementsFile, refElementsAbsPath } from '../../../harness/scripts/utils/fidelity-shared';
import { createRequire } from 'module';

const requireHarness = createRequire(path.resolve(__dirname, '../../../harness/harness-runner.ts'));
const YAML = requireHarness('yaml') as { parse: (s: string) => unknown };

/**
 * verdict=pass 时 fidelity_score / geometric_iou 的最低阈值。
 * 低于此值视为「自报 0 分却宣称 pass」的假 PASS，降级 WARN。
 * warn verdict 不设下限（warn 本就表示有残差）。
 */
const PASS_MIN_FIDELITY = 0.6;
const PASS_MIN_IOU = 0.5;
/** VL fidelity 显著高于 score_floor 时触发复核 WARN */
const SCORE_FLOOR_SENTINEL_GAP = 0.35;

function ruleDesc(ctx: CheckContext): string {
  const checks = ctx.phaseRule.structure_checks as Record<string, { description: string }>;
  return checks?.visual_diff?.description?.trim() ?? 'visual_diff';
}

function loadSpecMarkdown(ctx: CheckContext): string | null {
  const p = path.join(ctx.projectRoot, 'doc', 'features', ctx.feature, 'spec', 'spec.md');
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf-8');
}

export interface VisualDiffScreenEntry {
  screen_id: string;
  verdict: 'pass' | 'warn' | 'fail' | 'skipped' | 'pending';
  screenshot_path?: string;
  ref_path?: string;
  ref_id?: string;
  fidelity_score?: number;
  geometric_iou?: number;
  /** jimp 半定量客观下限/哨兵（不参与 PASS 阈值） */
  score_floor?: number;
  must_fix?: string[];
  /** 当前 screenshot_path 对应 PNG 的 sha256 前缀（16 hex） */
  screenshot_hash?: string;
  /** VL/agent 判定 verdict 时所依据的截图 hash；须与当前文件 hash 一致 */
  evaluated_screenshot_hash?: string;
  /** 反向 diff：参考图有、实现无的元素 id 清单 */
  reverse_missing?: string[];
}

export interface VisualDiffReport {
  schema_version: string;
  screens: VisualDiffScreenEntry[];
  degraded?: boolean;
  degrade_reason?: string;
}

function resolveShotPath(projectRoot: string, shot: string): string {
  return path.isAbsolute(shot) ? shot : path.resolve(projectRoot, shot);
}

/** PNG 文件 sha256 前 16 hex，用于截图变更检测 */
export function hashScreenshotFile(absPath: string): string | null {
  if (!fs.existsSync(absPath)) return null;
  try {
    return createHash('sha256').update(fs.readFileSync(absPath)).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

/** pending/skipped 可被采集覆盖；pass/warn/fail 须 hash 一致才保留 */
export function isCaptureMutableVerdict(verdict: VisualDiffScreenEntry['verdict'] | undefined): boolean {
  return verdict === undefined || verdict === 'pending' || verdict === 'skipped';
}

/** pass/warn/fail 须显式写入 evaluated_screenshot_hash（不得仅靠 screenshot_hash 充数） */
export function isMissingEvaluatedScreenshotHash(screen: VisualDiffScreenEntry): boolean {
  if (isCaptureMutableVerdict(screen.verdict)) return false;
  return typeof screen.evaluated_screenshot_hash !== 'string' || !screen.evaluated_screenshot_hash.trim();
}

/** finalized verdict 的 evaluated_screenshot_hash 是否与当前截图文件不一致 */
export function isStaleVisualDiffVerdict(
  screen: VisualDiffScreenEntry,
  projectRoot: string,
): boolean {
  if (isCaptureMutableVerdict(screen.verdict) || isMissingEvaluatedScreenshotHash(screen)) return false;
  const shot = screen.screenshot_path;
  if (typeof shot !== 'string' || !shot.trim()) return false;
  const currentHash = hashScreenshotFile(resolveShotPath(projectRoot, shot));
  if (!currentHash) return true;
  return currentHash !== screen.evaluated_screenshot_hash!.trim();
}

function collectAuthoritativeRefIds(specMd: string, uiDoc: ReturnType<typeof loadUiSpecFile>): Set<string> {
  const ids = new Set<string>();
  for (const s of uiDoc?.screens ?? []) {
    if (s.ref_id) ids.add(s.ref_id);
    ids.add(s.id);
  }
  for (const b of extractCodeBlocks(specMd, 'yaml')) {
    try {
      const doc = YAML.parse(b.content) as Record<string, unknown>;
      const vh = doc?.visual_handoff as Record<string, unknown> | undefined;
      const refs = vh?.authoritative_refs as Array<{ id?: string }> | undefined;
      if (Array.isArray(refs)) {
        for (const r of refs) {
          if (typeof r.id === 'string' && r.id.trim()) ids.add(r.id.trim());
        }
      }
    } catch { /* skip */ }
  }
  return ids;
}

export function validateVisualDiffJson(
  raw: unknown,
  projectRoot: string,
  opts?: { authoritativeRefIds?: Set<string> },
):
  | { ok: true; report: VisualDiffReport; errors: string[]; fatal: false }
  | { ok: false; report: VisualDiffReport | null; errors: string[]; fatal: boolean } {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, report: null, errors: ['root must be object'], fatal: true };
  }
  const rep = raw as Record<string, unknown>;
  const schemaVersion =
    typeof rep.schema_version === 'string' && rep.schema_version.trim() ? rep.schema_version.trim() : '';
  if (!schemaVersion) {
    errors.push('schema_version 必填');
  }
  if (!Array.isArray(rep.screens) || rep.screens.length === 0) {
    // 无 screens 数组 = 无可门禁对象（fatal）；其余 schema 问题走 best-effort 部分 report。
    errors.push('screens 须为非空数组');
    return { ok: false, report: null, errors, fatal: true };
  }

  // G0：凡有合法 screen_id + verdict 的屏都进 best-effort report，让下游 P0-pending /
  // 撞-hash / 缺屏 / score-floor 等实质门禁仍可计算；缺图、非法 ref_id 等 schema 问题
  // 记入 errors 由调用方「追加一条 finding」，不再因一处 schema 错就早退出掩盖真 BLOCKER。
  const bestEffortScreens: VisualDiffScreenEntry[] = [];
  {
    for (const [i, s] of (rep.screens as unknown[]).entries()) {
      if (!s || typeof s !== 'object') {
        errors.push(`screens[${i}] 须为 object`);
        continue;
      }
      const row = s as Record<string, unknown>;
      const screenIdValid = typeof row.screen_id === 'string' && Boolean(row.screen_id.trim());
      if (!screenIdValid) {
        errors.push(`screens[${i}].screen_id 必填`);
      }
      const verdict = row.verdict;
      const verdictValid =
        verdict === 'pass' ||
        verdict === 'warn' ||
        verdict === 'fail' ||
        verdict === 'skipped' ||
        verdict === 'pending';
      if (!verdictValid) {
        errors.push(`screens[${i}].verdict 非法：${String(verdict)}`);
      }
      const shot = row.screenshot_path;
      if (typeof shot !== 'string' || !shot.trim()) {
        errors.push(`screens[${i}].screenshot_path 必填`);
      } else if (!fs.existsSync(resolveShotPath(projectRoot, shot))) {
        errors.push(`screens[${i}].screenshot_path 不存在：${shot}`);
      }
      const refPath = row.ref_path;
      const refId = row.ref_id;
      if (typeof refPath === 'string' && refPath.trim()) {
        if (!fs.existsSync(resolveShotPath(projectRoot, refPath))) {
          errors.push(`screens[${i}].ref_path 不存在：${refPath}`);
        }
      } else if (typeof refId !== 'string' || !refId.trim()) {
        errors.push(`screens[${i}] 须含 ref_path（reachable 文件）或 ref_id`);
      } else if (opts?.authoritativeRefIds && opts.authoritativeRefIds.size > 0) {
        if (!opts.authoritativeRefIds.has(refId.trim())) {
          errors.push(`screens[${i}].ref_id=${refId} 不在 ui-spec/spec authoritative_refs`);
        }
      }
      if (verdict === 'pass' || verdict === 'warn') {
        const fsScore = row.fidelity_score;
        const iou = row.geometric_iou;
        if (typeof fsScore !== 'number' || Number.isNaN(fsScore)) {
          errors.push(`screens[${i}] verdict=${verdict} 时 fidelity_score 须为 number`);
        } else if (fsScore < 0 || fsScore > 1) {
          errors.push(`screens[${i}] fidelity_score 须在 [0,1]，收到 ${fsScore}`);
        }
        if (typeof iou !== 'number' || Number.isNaN(iou)) {
          errors.push(`screens[${i}] verdict=${verdict} 时 geometric_iou 须为 number`);
        } else if (iou < 0 || iou > 1) {
          errors.push(`screens[${i}] geometric_iou 须在 [0,1]，收到 ${iou}`);
        }
      }
      if (verdict === 'fail') {
        const mf = row.must_fix;
        if (!Array.isArray(mf) || mf.length === 0 || !mf.every(x => typeof x === 'string' && x.trim())) {
          errors.push(`screens[${i}] verdict=fail 时 must_fix 须为非空字符串数组`);
        }
      }
      const reverseMissing = row.reverse_missing;
      if (reverseMissing !== undefined && reverseMissing !== null) {
        if (!Array.isArray(reverseMissing) || !reverseMissing.every(x => typeof x === 'string')) {
          errors.push(`screens[${i}] reverse_missing 须为字符串数组`);
        }
      }
      const scoreFloor = row.score_floor;
      if (scoreFloor !== undefined && scoreFloor !== null) {
        if (typeof scoreFloor !== 'number' || Number.isNaN(scoreFloor)) {
          errors.push(`screens[${i}] score_floor 须为 number`);
        } else if (scoreFloor < 0 || scoreFloor > 1) {
          errors.push(`screens[${i}] score_floor 须在 [0,1]，收到 ${scoreFloor}`);
        }
      }

      if (screenIdValid && verdictValid) {
        bestEffortScreens.push(row as unknown as VisualDiffScreenEntry);
      }
    }
  }

  const report: VisualDiffReport = {
    schema_version: schemaVersion || '0',
    screens: bestEffortScreens,
    ...(typeof rep.degraded === 'boolean' ? { degraded: rep.degraded } : {}),
    ...(typeof rep.degrade_reason === 'string' ? { degrade_reason: rep.degrade_reason } : {}),
  };
  if (errors.length > 0) {
    return { ok: false, report, errors, fatal: false };
  }
  return { ok: true, report, errors: [], fatal: false };
}

interface VisualDiffHit {
  id: string;
  severity: 'BLOCKER' | 'MAJOR';
  status: 'FAIL' | 'WARN';
  line: string;
  rank: number;
}

function visualDiffHitRank(severity: 'BLOCKER' | 'MAJOR', status: 'FAIL' | 'WARN'): number {
  return severity === 'BLOCKER' || status === 'FAIL' ? 3 : 2;
}

function pushVisualDiffHit(hits: VisualDiffHit[], hit: Omit<VisualDiffHit, 'rank'>): void {
  hits.push({ ...hit, rank: visualDiffHitRank(hit.severity, hit.status) });
}

function uiSpecCoversElementId(
  elementId: string,
  nodeIds: Set<string>,
  mustHave: Set<string>,
): boolean {
  if (nodeIds.has(elementId) || mustHave.has(elementId)) return true;
  const lower = elementId.toLowerCase();
  for (const id of nodeIds) {
    if (id.toLowerCase() === lower) return true;
  }
  for (const id of mustHave) {
    if (id.toLowerCase() === lower) return true;
  }
  return false;
}

function finalizeVisualDiffHits(
  desc: string,
  reportRel: string,
  baseDetails: string,
  hits: VisualDiffHit[],
): CheckResult {
  if (hits.length === 0) {
    return {
      id: 'visual_diff',
      category: 'structure',
      description: desc,
      severity: 'MAJOR',
      status: 'PASS',
      details: baseDetails,
      affected_files: [reportRel],
    };
  }
  hits.sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id));
  const top = hits[0];
  const resultId = hits.some(h => h.rank >= 3) ? 'visual_diff' : top.id;
  return {
    id: resultId,
    category: 'structure',
    description: desc,
    severity: top.severity,
    status: top.status,
    details: `${baseDetails}\n${hits.map(h => h.line).join('\n')}`,
    affected_files: [reportRel],
  };
}

/** device-testing 渲染回环报告校验 */
export function checkVisualDiff(ctx: CheckContext): CheckResult[] {
  const desc = ruleDesc(ctx);
  const reportRel = relFeatureArtifact(ctx.projectRoot, ctx.feature, 'visual-diff.md');
  const reportDir = path.join(
    ctx.projectRoot,
    'doc',
    'features',
    ctx.feature,
    'device-testing',
    'device-screenshots',
  );

  const specMd = loadSpecMarkdown(ctx);
  const uiChange = specMd ? parseUiChangeFromSpecMarkdown(specMd) : null;
  if (!uiChange || !UI_CHANGE_REQUIRES_UI_SPEC.has(uiChange)) {
    return [];
  }

  if (process.env.HARNESS_SKIP_VISUAL_DIFF === '1') {
    return [{
      id: 'visual_diff',
      category: 'structure',
      description: desc,
      severity: 'MINOR',
      status: 'SKIP',
      details: 'HARNESS_SKIP_VISUAL_DIFF=1',
      affected_files: [reportRel],
    }];
  }

  const mdPath = path.join(
    ctx.projectRoot,
    'doc',
    'features',
    ctx.feature,
    'device-testing',
    'visual-diff.md',
  );
  const jsonPath = path.join(reportDir, 'visual-diff.json');

  const deviceUnavailable =
    process.env.HARNESS_VISUAL_DIFF_DEGRADED === '1' ||
    process.env.HARNESS_SKIP_HVIGOR === '1';

  if (deviceUnavailable) {
    return [{
      id: 'visual_diff',
      category: 'structure',
      description: desc,
      severity: 'MAJOR',
      status: 'SKIP',
      details:
        '设备渲染回环未执行（warmup/无设备/Hylyre 不可用）；仅静态保真分生效。显式标注 degraded。',
      affected_files: [reportRel],
    }];
  }

  if (!fs.existsSync(mdPath) && !fs.existsSync(jsonPath)) {
    return [{
      id: 'visual_diff',
      category: 'structure',
      description: desc,
      severity: 'MAJOR',
      status: 'WARN',
      details:
        'visual-diff 报告尚未产出。device-testing 须执行 Hylyre 截图 QA + 多模态 vs 原图对照，写入 device-testing/visual-diff.md。',
      suggestion: '见 device-testing SKILL visual diff 步骤；MVP 先覆盖可直达顶层屏。',
      affected_files: [reportRel],
    }];
  }

  if (!fs.existsSync(jsonPath)) {
    return [{
      id: 'visual_diff',
      category: 'structure',
      description: desc,
      severity: 'MAJOR',
      status: 'WARN',
      details: 'visual-diff.md 存在但缺少 device-screenshots/visual-diff.json 结构化报告。',
      affected_files: [reportRel],
    }];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  } catch (e) {
    return [{
      id: 'visual_diff',
      category: 'structure',
      description: desc,
      severity: 'MAJOR',
      status: 'FAIL',
      details: `visual-diff.json 解析失败：${(e as Error).message}`,
      affected_files: [reportRel],
    }];
  }

  const uiDoc = loadUiSpecFile(uiSpecAbsPath(ctx.projectRoot, ctx.feature));
  const refIds = specMd ? collectAuthoritativeRefIds(specMd, uiDoc) : new Set<string>();
  const validated = validateVisualDiffJson(parsed, ctx.projectRoot, { authoritativeRefIds: refIds });
  const bestEffortReport = validated.report;
  if (validated.fatal || !bestEffortReport) {
    // root 非法 / screens 数组缺失：无可门禁对象。UI change=new_or_changed 且有 P0 目标屏时
    // 不得静默放行（视为「无有效视觉证据」），升 BLOCKER。
    const p0Targets = collectP0VisualTargetIds(uiDoc);
    const fatalBlocker = uiChange === 'new_or_changed' && p0Targets.length > 0;
    return [{
      id: 'visual_diff',
      category: 'structure',
      description: desc,
      severity: fatalBlocker ? 'BLOCKER' : 'MAJOR',
      status: 'FAIL',
      details: `visual-diff.json 无法解析为可校验报告：${validated.errors.join('；')}`,
      affected_files: [reportRel],
    }];
  }

  // G0：非 fatal 的 schema 问题（缺图 / 非法 ref_id 等）转 finding 追加，绝不掩盖下方实质门禁。
  const rep = bestEffortReport;
  const schemaErrors = validated.errors;
  const mustFix = rep.screens.flatMap(s => s.must_fix ?? []);
  const failScreens = rep.screens.filter(s => s.verdict === 'fail');
  const warnScreens = rep.screens.filter(s => s.verdict === 'warn');
  const passScreens = rep.screens.filter(s => s.verdict === 'pass');
  const skippedScreens = rep.screens.filter(s => s.verdict === 'skipped');
  const pendingScreens = rep.screens.filter(s => s.verdict === 'pending');
  const byScreenId = new Map(rep.screens.map(s => [s.screen_id, s] as const));

  // --- P0 覆盖：ui-spec 的 P0 屏必须出现且 verdict 非 skipped/pending ---
  const p0Ids = collectP0VisualTargetIds(uiDoc);
  const p0Uncovered = p0Ids.filter(id => {
    const entry = byScreenId.get(id);
    return !entry || entry.verdict === 'skipped' || entry.verdict === 'pending';
  });

  // --- pass 屏的分数必须达最低阈值（堵「自报 0 分仍 pass」假 PASS）---
  const lowScorePass = passScreens.filter(
    s =>
      (typeof s.fidelity_score === 'number' && s.fidelity_score < PASS_MIN_FIDELITY) ||
      (typeof s.geometric_iou === 'number' && s.geometric_iou < PASS_MIN_IOU),
  );

  const scoreFloorSentinel = rep.screens.filter(s => {
    if (typeof s.score_floor !== 'number' || typeof s.fidelity_score !== 'number') return false;
    return s.fidelity_score - s.score_floor >= SCORE_FLOOR_SENTINEL_GAP;
  });

  const reverseMissingAll = rep.screens.flatMap(s => s.reverse_missing ?? []);

  const missingEvalHashScreens = rep.screens.filter(s => isMissingEvaluatedScreenshotHash(s));
  const staleScreens = rep.screens.filter(s => isStaleVisualDiffVerdict(s, ctx.projectRoot));

  const hashGroups = new Map<string, string[]>();
  for (const s of rep.screens) {
    const h = s.screenshot_hash?.trim();
    if (!h) continue;
    const list = hashGroups.get(h) ?? [];
    list.push(s.screen_id);
    hashGroups.set(h, list);
  }
  const duplicateHashScreens = [...hashGroups.entries()]
    .filter(([, ids]) => ids.length >= 2)
    .map(([h, ids]) => `${h}:${ids.join('+')}`);

  const pixel1to1 = isPixel1to1(ctx);
  const refElementsPath = refElementsAbsPath(ctx.projectRoot, ctx.feature);
  const refElementsDoc = fs.existsSync(refElementsPath)
    ? loadRefElementsFile(refElementsPath)
    : null;
  const screensMissingReverseEnum = pixel1to1
    ? rep.screens.filter(s => !isCaptureMutableVerdict(s.verdict) && s.reverse_missing === undefined)
    : [];

  const details = [
    `screens=${rep.screens.length}`,
    `pass=${passScreens.length}`,
    `warn=${warnScreens.length}`,
    `fail=${failScreens.length}`,
    `skipped=${skippedScreens.length}`,
    `pending=${pendingScreens.length}`,
    `must_fix=${mustFix.length}`,
    `p0=${p0Ids.length}`,
    rep.degraded ? 'degraded' : '',
  ].filter(Boolean).join('；');

  const hits: VisualDiffHit[] = [];

  if (schemaErrors.length > 0) {
    pushVisualDiffHit(hits, {
      id: 'visual_diff_schema',
      severity: 'MAJOR',
      status: 'FAIL',
      line:
        `visual-diff.json 结构问题（已继续计算实质门禁、未掩盖）：` +
        `${schemaErrors.slice(0, 6).join('；')}${schemaErrors.length > 6 ? '…' : ''}`,
    });
  }

  if (p0Uncovered.length > 0) {
    const uiChangeGate = uiChange === 'new_or_changed';
    pushVisualDiffHit(hits, {
      id: 'visual_diff',
      severity: uiChangeGate ? 'BLOCKER' : 'MAJOR',
      status: uiChangeGate ? 'FAIL' : 'WARN',
      line: `P0 屏/overlay 未覆盖或被 skipped/pending：${p0Uncovered.join(', ')}`,
    });
  }

  const effectiveScreens = passScreens.length + warnScreens.length + failScreens.length;
  if (effectiveScreens === 0) {
    const pendingHint =
      pendingScreens.length > 0
        ? '所有屏 verdict=pending（VL 未完成判定），无有效视觉对照'
        : '所有屏 verdict=skipped，无有效视觉对照';
    const uiChangeGate = uiChange === 'new_or_changed' && p0Ids.length > 0 && pendingScreens.length > 0;
    pushVisualDiffHit(hits, {
      id: 'visual_diff',
      severity: uiChangeGate ? 'BLOCKER' : 'MAJOR',
      status: uiChangeGate ? 'FAIL' : 'WARN',
      line: `${pendingHint}；不得作为视觉保真 PASS`,
    });
  }

  if (lowScorePass.length > 0) {
    const ratchet = pixel1to1
      ? fidelityRatchetFailOrWarn(ctx, false)
      : { severity: 'MAJOR' as const, status: 'WARN' as const };
    pushVisualDiffHit(hits, {
      id: 'visual_diff',
      severity: ratchet.severity,
      status: ratchet.status,
      line:
        `verdict=pass 但分数低于阈值（fidelity<${PASS_MIN_FIDELITY} 或 iou<${PASS_MIN_IOU}）：` +
        lowScorePass.map(s => `${s.screen_id}(f=${s.fidelity_score ?? 'n/a'},iou=${s.geometric_iou ?? 'n/a'})`).join(', '),
    });
  }

  if (missingEvalHashScreens.length > 0) {
    pushVisualDiffHit(hits, {
      id: 'visual_diff',
      severity: pixel1to1 ? 'BLOCKER' : 'MAJOR',
      status: pixel1to1 ? 'FAIL' : 'WARN',
      line:
        `finalized verdict 缺少 evaluated_screenshot_hash：` +
        missingEvalHashScreens.map(s => s.screen_id).join(', '),
    });
  }

  if (staleScreens.length > 0) {
    pushVisualDiffHit(hits, {
      id: 'visual_diff',
      severity: pixel1to1 ? 'BLOCKER' : 'MAJOR',
      status: pixel1to1 ? 'FAIL' : 'WARN',
      line:
        `verdict 所依据截图已变更，须 VL 重判：` +
        staleScreens.map(s => s.screen_id).join(', '),
    });
  }

  if (scoreFloorSentinel.length > 0) {
    const ratchet = pixel1to1
      ? fidelityRatchetFailOrWarn(ctx, false)
      : { severity: 'MAJOR' as const, status: 'WARN' as const };
    pushVisualDiffHit(hits, {
      id: 'visual_diff',
      severity: ratchet.severity,
      status: ratchet.status,
      line:
        `VL 高分但客观相似度低（fidelity-score_floor>=${SCORE_FLOOR_SENTINEL_GAP}）：` +
        scoreFloorSentinel.map(s => `${s.screen_id}(f=${s.fidelity_score},floor=${s.score_floor})`).join(', '),
    });
  }

  if (duplicateHashScreens.length > 0) {
    // x-capture-bug：≥2 个不同屏共享 hash = Tab 未切换/重复采集，至少一屏是错图，
    // VL 在错图上闭环（homepage：home 与 mine 同 d3bea384…）。pixel_1to1 下升 BLOCKER。
    const ratchet = pixel1to1
      ? fidelityRatchetFailOrWarn(ctx, false)
      : { severity: 'MAJOR' as const, status: 'WARN' as const };
    pushVisualDiffHit(hits, {
      id: 'visual_diff_screenshot_dedup',
      severity: ratchet.severity,
      status: ratchet.status,
      line: `≥2 屏共享 screenshot_hash（疑似 Tab 未切换/重复采集，至少一屏为错图）：${duplicateHashScreens.join('; ')}`,
    });
  }

  if (screensMissingReverseEnum.length > 0) {
    const ratchet = fidelityRatchetFailOrWarn(ctx, false);
    pushVisualDiffHit(hits, {
      id: 'visual_diff_reverse_enum',
      severity: ratchet.severity,
      status: ratchet.status,
      line:
        `pixel_1to1 须逐屏填写 reverse_missing（可为 []）：` +
        screensMissingReverseEnum.map(s => s.screen_id).join(', '),
    });
  }

  if (reverseMissingAll.length > 0) {
    const ratchet = pixel1to1
      ? fidelityRatchetFailOrWarn(ctx, false)
      : { severity: 'MAJOR' as const, status: 'WARN' as const };
    pushVisualDiffHit(hits, {
      id: 'visual_diff_reverse_missing',
      severity: ratchet.severity,
      status: ratchet.status,
      line: `反向 diff 残差（参考图有、实现无）：${reverseMissingAll.slice(0, 12).join(', ')}${reverseMissingAll.length > 12 ? '…' : ''}`,
    });
  }

  if (refElementsDoc && pixel1to1 && uiDoc && passScreens.length > 0) {
    const nodes = collectAllComponentNodes(uiDoc);
    const nodeIds = new Set(nodes.map(n => n.id).filter((id): id is string => Boolean(id)));
    const mustHave = new Set((uiDoc.screens ?? []).flatMap(s => s.must_have_elements ?? []));
    const reverseLower = new Set(reverseMissingAll.map(r => r.toLowerCase()));
    const implementIds = refElementsDoc.elements
      .filter(e => e.disposition !== 'defer')
      .map(e => e.element_id);
    const unaccounted = implementIds.filter(id => {
      if (uiSpecCoversElementId(id, nodeIds, mustHave)) return false;
      const lower = id.toLowerCase();
      if (reverseLower.has(lower)) return false;
      for (const r of reverseLower) {
        if (r.includes(lower) || lower.includes(r)) return false;
      }
      return true;
    });
    if (unaccounted.length > 0) {
      const ratchet = fidelityRatchetFailOrWarn(ctx, false);
      pushVisualDiffHit(hits, {
        id: 'visual_diff_bidirectional_residual',
        severity: ratchet.severity,
        status: ratchet.status,
        line:
          `ref-elements implement 未进 ui-spec 也未写入 reverse_missing：` +
          `${unaccounted.slice(0, 12).join(', ')}${unaccounted.length > 12 ? '…' : ''}`,
      });
    }
  }

  if (failScreens.length > 0 || mustFix.length > 0) {
    const ratchet = pixel1to1
      ? fidelityRatchetFailOrWarn(ctx, false)
      : { severity: 'MAJOR' as const, status: 'WARN' as const };
    pushVisualDiffHit(hits, {
      id: 'visual_diff',
      severity: ratchet.severity,
      status: ratchet.status,
      line: `must-fix：${mustFix.slice(0, 5).join('；')}${failScreens.length > 0 ? `；fail 屏：${failScreens.map(s => s.screen_id).join(', ')}` : ''}`,
    });
  }

  return [finalizeVisualDiffHits(desc, reportRel, details, hits)];
}
