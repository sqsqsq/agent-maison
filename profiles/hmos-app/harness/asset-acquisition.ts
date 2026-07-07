// ============================================================================
// asset-acquisition.ts — ui-spec 资产裁图/落地（半确定性，依赖 image-toolkit/jimp）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import type { CheckContext, CheckResult } from '../../../harness/scripts/utils/types';
import { relFeatureArtifact, featureFilePath, relFeatureFile } from '../../../harness/config';
import {
  loadUiSpecFile,
  parseUiChangeFromSpecMarkdown,
  uiSpecAbsPath,
  UI_CHANGE_REQUIRES_UI_SPEC,
} from '../../../harness/scripts/utils/ui-spec-shared';
import { cropAssetFromBbox, isJimpAvailable, sampleColorFromBbox } from './image-toolkit';
import { writeUiSpecYaml } from './visual-structure-parity';
import {
  buildAuthoritativeRefImageIndex,
  resolveRefSourceImage,
} from './authoritative-ref-images';
import { validateProjectRelativePath } from '../../../harness/scripts/utils/project-relative-path';
import { isPixel1to1, fidelityRatchetFailOrWarn, isAutomationSigner, USER_REQUIREMENT_CONFIRMER } from '../../../harness/scripts/utils/fidelity-shared';
import { isGoalHeadlessEnv } from '../../../harness/scripts/utils/phase-state';

/**
 * G4b + P0-C（plan f2d8c4a6 授权/验真拆位）：crop **授权**判据——human_crop_confirmed:true 且
 * （headless 下）crop_confirmed_by 为非自动化身份或 user_requirement。
 * 语义边界（round6 教训）：本判据只回答"允不允许走截图裁剪路径"（能不能裁），**绝不**回答
 * "这个 bbox 裁出来的产物对不对"（裁没裁对）——后者由 asset_crop_validation（P0-B）独立验真：
 * 确定性 sanity + VL 隔离辨认/真人 bbox_verified_by。user_requirement 是用户 NL 的**总体裁剪授权**，
 * round6 事故即把它误当 23 个 bbox 的逐框验真，废图全免检——授权恒不豁免验真。
 */
function isCropAuthorized(
  a: { human_crop_confirmed?: boolean; crop_confirmed_by?: string },
  headless: boolean,
): boolean {
  if (a.human_crop_confirmed !== true) return false;
  if (isAutomationSigner(a.crop_confirmed_by)) return false;
  // headless：须有前置授权者——user_requirement(用户 NL 前置授权) 或真人署名；缺/自动化=自报。
  if (headless) {
    const by = typeof a.crop_confirmed_by === 'string' ? a.crop_confirmed_by.trim() : '';
    if (by === USER_REQUIREMENT_CONFIRMER) return true; // 授权路径显式认可（验真另走 P0-B，不在此豁免）
    return by.length > 0;
  }
  return true;
}

function ruleDesc(ctx: CheckContext): string {
  const checks = ctx.phaseRule.structure_checks as Record<string, { description: string }>;
  return checks?.asset_acquisition?.description?.trim() ?? 'asset_acquisition';
}

export function checkAssetAcquisition(ctx: CheckContext): CheckResult[] {
  const desc = ruleDesc(ctx);
  const uiSpecRel = relFeatureArtifact(ctx.projectRoot, ctx.feature, 'ui-spec.yaml');
  const specPath = featureFilePath(ctx.projectRoot, ctx.feature, path.join('spec', 'spec.md'));
  if (!fs.existsSync(specPath)) return [];
  const specMd = fs.readFileSync(specPath, 'utf-8');
  const uiChange = parseUiChangeFromSpecMarkdown(specMd);
  if (!uiChange || !UI_CHANGE_REQUIRES_UI_SPEC.has(uiChange)) return [];

  if (!isJimpAvailable()) {
    return [{
      id: 'asset_acquisition',
      category: 'structure',
      description: desc,
      severity: 'MAJOR',
      status: 'SKIP',
      details: 'jimp 未安装；资产裁图/采色 capability SKIP（见 docs/spikes/image-tool-spike.md）。',
      affected_files: [uiSpecRel],
    }];
  }

  const doc = loadUiSpecFile(uiSpecAbsPath(ctx.projectRoot, ctx.feature));
  if (!doc) return [];

  const refIndex = buildAuthoritativeRefImageIndex(ctx, specMd);
  if (!refIndex.firstReachable && refIndex.byId.size === 0) {
    return [{
      id: 'asset_acquisition',
      category: 'structure',
      description: desc,
      severity: 'MAJOR',
      status: 'WARN',
      details: '未解析到 reachable 的 PNG/JPEG authoritative_ref，跳过自动裁图。',
      affected_files: [uiSpecRel],
    }];
  }

  const notes: string[] = [];
  const cropPendingConfirm: string[] = [];
  const headless = isGoalHeadlessEnv();
  let uiSpecDirty = false;
  const uiSpecAbs = uiSpecAbsPath(ctx.projectRoot, ctx.feature);

  for (const a of doc.assets ?? []) {
    if (a.acquisition !== 'crop' || a.placeholder) continue;
    const outRelCandidate = a.resolved_path ?? relFeatureFile(ctx.projectRoot, ctx.feature, `spec/assets/${a.key}.png`);
    let safeRelForExists: string;
    try {
      safeRelForExists = validateProjectRelativePath(ctx.projectRoot, outRelCandidate, `asset ${a.key}.resolved_path`);
    } catch (e) {
      notes.push(`${a.key}：裁图目标路径逃逸 project-root，已跳过（${(e as Error).message}）`);
      continue;
    }
    if (fs.existsSync(path.resolve(ctx.projectRoot, safeRelForExists))) {
      // 已存在只免"重复裁剪"，不免验真——asset_crop_validation（P0-B）对已存在产物一律重验
      notes.push(`${a.key}：已存在（验真归 asset_crop_validation）`);
      continue;
    }
    if (!a.source_bbox || a.source_bbox.length !== 4) {
      notes.push(`${a.key}：缺 source_bbox`);
      continue;
    }
    if (!isCropAuthorized(a, headless)) {
      // G4b：未授权（headless 下还须非自动化/user_requirement crop_confirmed_by，堵自报）→ 授权门禁
      cropPendingConfirm.push(a.key);
      notes.push(`${a.key}：待授权裁剪（human_crop_confirmed${headless ? ' + crop_confirmed_by 非自动化身份或 user_requirement' : ''}）后自动裁图`);
      continue;
    }
    const srcPick = resolveRefSourceImage(refIndex, a.source_ref);
    if (!srcPick.path) {
      notes.push(`${a.key}：${srcPick.note ?? '无法解析 source_ref 对应原图'}`);
      continue;
    }
    if (srcPick.note) notes.push(`${a.key}：${srcPick.note}`);
    const outRel = outRelCandidate;
    const outAbs = path.resolve(ctx.projectRoot, safeRelForExists);
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    const crop = cropAssetFromBbox(srcPick.path, a.source_bbox, outAbs);
    if (crop.ok) {
      notes.push(`${a.key}：裁图 → ${outRel}`);
      if (!a.resolved_path) {
        a.resolved_path = outRel;
        uiSpecDirty = true;
      }
    } else notes.push(`${a.key}：裁图失败 ${crop.error}`);
  }

  for (const [key, tok] of Object.entries(doc.tokens ?? {})) {
    if (tok.sampled || !tok.source_bbox || tok.kind !== 'color') continue;
    const tokenRef = tok.source_ref;
    const srcPick = resolveRefSourceImage(refIndex, tokenRef);
    if (!srcPick.path) {
      notes.push(`token ${key}：${srcPick.note ?? '无法解析采色原图'}`);
      continue;
    }
    if (srcPick.note) notes.push(`token ${key}：${srcPick.note}`);
    const sample = sampleColorFromBbox(srcPick.path, tok.source_bbox);
    if (sample.sampled && sample.hex) {
      tok.value = sample.hex;
      tok.sampled = true;
      uiSpecDirty = true;
      notes.push(`token ${key}：采样 ${sample.hex} → 已回写 ui-spec`);
    } else if (sample.error) notes.push(`token ${key}：采样失败 ${sample.error}`);
  }

  if (uiSpecDirty) {
    writeUiSpecYaml(uiSpecAbs, doc);
  }

  const results: CheckResult[] = [];

  // G4b：crop 资产待授权 → 门禁（解耦 G1 自签：不自动置 confirmed，改走 goal-runner halt-confirm）。
  // pixel_1to1 → BLOCKER（headless 无授权即挡；交互/goal 经既有确认 UX 暂停求人授权后裁）；否则 WARN。
  // P0-C 语义拆位：此门只管**授权**（能不能裁）；产物**验真**（裁没裁对）由 asset_crop_validation 独立把关，
  // 授权（含 user_requirement）绝不豁免验真。
  if (cropPendingConfirm.length > 0) {
    const { severity, status } = fidelityRatchetFailOrWarn(ctx, true);
    results.push({
      id: 'asset_crop_confirm_required',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: `crop 资产待授权裁剪（human_crop_confirmed）：${cropPendingConfirm.join(', ')}`,
      suggestion:
        'goal-runner 暂停求人授权/微调 bbox；或在需求中自然授权从原图/截图裁剪资源并记录 crop_confirmed_by=user_requirement。' +
        '授权后置 human_crop_confirmed 自动裁剪；headless 无授权即 BLOCKER（不自动伪造）。' +
        '注意：授权只解锁裁剪路径，产物验真由 asset_crop_validation 把关（sanity+VL 辨认/真人 bbox_verified_by）。',
      affected_files: [uiSpecRel],
    });
  }

  results.push({
    id: 'asset_acquisition',
    category: 'structure',
    description: desc,
    severity: 'MAJOR',
    status: notes.some(n => /失败|逃逸|已跳过/.test(n)) ? 'WARN' : 'PASS',
    details: notes.length ? notes.join('；') : '无 crop 资产待处理',
    affected_files: [uiSpecRel],
  });

  return results;
}
