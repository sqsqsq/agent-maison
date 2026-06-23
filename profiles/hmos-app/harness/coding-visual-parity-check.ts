// ============================================================================
// coding · visual parity 确定性守门（hmos-app / coding.visual_parity capability）
// ============================================================================
// 边界（review#5）：D 查「在不在」非「对不对」——必要不充分。
// unverified ui-spec 下只报结构 presence，报告显式标注「基线未校验，非保真结论」。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import type { CheckContext, CheckResult } from '../../../harness/scripts/utils/types';
import { relFeatureArtifact, relFeatureFile } from '../../../harness/config';
import {
  UI_CHANGE_REQUIRES_UI_SPEC,
  collectCopyTexts,
  flattenResourceKeyEntries,
  loadUiSpecFile,
  parseUiChangeFromSpecMarkdown,
  structureFailOrWarn,
  uiSpecAbsPath,
  uiSpecRelPath,
  type VisualEnforcementMode,
} from '../../../harness/scripts/utils/ui-spec-shared';
import { computeStaticFidelityScore } from './static-fidelity-score';
import {
  resourceKeyToRef,
  scanFeatureSourceTree,
  sequenceMatchRatio,
} from './source-ref-scan';
import {
  loadVisualParityMappings,
  mappedComponentSequenceForScreen,
} from './visual-structure-parity';

function ruleDesc(
  ctx: CheckContext,
  section: 'structure_checks' | 'semantic_checks' | 'traceability_checks',
  id: string,
): string {
  const checks = ctx.phaseRule[section] as Record<string, { description: string }>;
  return checks?.[id]?.description?.trim() ?? id;
}

function loadSpecMarkdown(ctx: CheckContext): string | null {
  const p = path.join(ctx.projectRoot, 'doc', 'features', ctx.feature, 'spec', 'spec.md');
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf-8');
}

function readResourceJsonFiles(projectRoot: string, contracts: NonNullable<CheckContext['featureSpec']['contracts']>): {
  stringValues: Set<string>;
  colorKeys: Set<string>;
} {
  const stringValues = new Set<string>();
  const colorKeys = new Set<string>();

  for (const mod of contracts.modules ?? []) {
    const base = path.join(projectRoot, mod.package_path, 'src', 'main', 'resources');
    if (!fs.existsSync(base)) continue;
    walkResources(base, (filePath, data) => {
      if (filePath.endsWith('string.json')) {
        collectJsonValues(data, stringValues);
      } else if (filePath.endsWith('color.json')) {
        collectJsonKeys(data, 'color', colorKeys);
      }
    });
  }
  return { stringValues, colorKeys };
}

function walkResources(dir: string, fn: (file: string, data: unknown) => void): void {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkResources(full, fn);
    } else if (ent.name.endsWith('.json')) {
      try {
        fn(full, JSON.parse(fs.readFileSync(full, 'utf-8')));
      } catch {
        /* skip */
      }
    } else if (/\.(png|svg|webp|jpg|jpeg)$/i.test(ent.name)) {
      fn(full, null);
    }
  }
}

function collectJsonValues(data: unknown, out: Set<string>): void {
  if (!data || typeof data !== 'object') return;
  const obj = data as Record<string, unknown>;
  const inner = obj.string ?? obj.color ?? obj;
  if (inner && typeof inner === 'object') {
    for (const v of Object.values(inner as Record<string, unknown>)) {
      if (typeof v === 'string') out.add(v);
      else if (v && typeof v === 'object' && 'value' in (v as object)) {
        const val = (v as { value?: string }).value;
        if (typeof val === 'string') out.add(val);
      }
    }
  }
}

function collectJsonKeys(data: unknown, kind: string, out: Set<string>): void {
  if (!data || typeof data !== 'object') return;
  const obj = data as Record<string, unknown>;
  const inner = obj[kind] ?? obj;
  if (inner && typeof inner === 'object') {
    for (const k of Object.keys(inner as Record<string, unknown>)) {
      out.add(k);
    }
  }
}

/** 供 harness / 白盒单测调用 */
export function checkVisualParity(ctx: CheckContext): CheckResult[] {
  const enforcement = ctx.visualParityEnforcement as VisualEnforcementMode | undefined;
  const desc = ruleDesc(ctx, 'structure_checks', 'visual_parity');
  const uiSpecRel = uiSpecRelPath(ctx.projectRoot, ctx.feature);

  if (ctx.skipVisualParity) {
    return [{
      id: 'visual_parity',
      category: 'structure',
      description: desc,
      severity: 'MINOR',
      status: 'SKIP',
      details: '已跳过 visual parity（--skip-visual-parity）',
      affected_files: [uiSpecRel],
    }];
  }

  if (enforcement === 'off') {
    return [{
      id: 'visual_parity',
      category: 'structure',
      description: desc,
      severity: 'MINOR',
      status: 'SKIP',
      details: 'framework.config.json 中 coding.visual_parity_enforcement=off',
      affected_files: [uiSpecRel],
    }];
  }

  const specMd = loadSpecMarkdown(ctx);
  const uiChange = specMd ? parseUiChangeFromSpecMarkdown(specMd) : null;
  if (!uiChange || !UI_CHANGE_REQUIRES_UI_SPEC.has(uiChange)) {
    return [];
  }

  const doc = loadUiSpecFile(uiSpecAbsPath(ctx.projectRoot, ctx.feature));
  if (!doc) {
    const { severity, status } = structureFailOrWarn(enforcement);
    return [{
      id: 'visual_parity',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: `${uiSpecRel} 不存在，无法做 parity 核对。`,
      affected_files: [uiSpecRel],
    }];
  }

  const baselineUnverified = (doc.verified ?? 'unverified') === 'unverified';
  const contracts = ctx.featureSpec.contracts;
  const sourceScan = contracts ? scanFeatureSourceTree(ctx.projectRoot, contracts) : null;
  const issues: string[] = [];
  const presenceOk: string[] = [];

  // --- assets ---
  for (const a of doc.assets ?? []) {
    if (a.placeholder) {
      presenceOk.push(`asset ${a.key}：显式 placeholder`);
      continue;
    }
    if (a.resolved_path) {
      const abs = path.resolve(ctx.projectRoot, a.resolved_path);
      if (fs.existsSync(abs)) {
        presenceOk.push(`asset ${a.key}：文件存在`);
      } else {
        issues.push(`asset ${a.key}：resolved_path 不存在 ${a.resolved_path}`);
      }
    }
    const rkList = flattenResourceKeyEntries(contracts?.resource_keys);
    const rk = rkList.find(r => r.key === a.key || r.key?.includes(a.key.replace(/\./g, '_')));
    if (!rk && !baselineUnverified) {
      issues.push(`asset ${a.key}：contracts.resource_keys 无映射`);
    }
    if (rk && (rk as { path?: string }).path) {
      const abs = path.resolve(ctx.projectRoot, (rk as { path: string }).path);
      if (!fs.existsSync(abs)) {
        issues.push(`contracts resource_keys ${rk.key} 路径不存在`);
      } else {
        presenceOk.push(`resource_key ${rk.key}：存在`);
      }
    }
    if (sourceScan && !a.placeholder) {
      const mediaRef = resourceKeyToRef(a.key, 'media');
      const snakeRef = resourceKeyToRef(a.key.replace(/\./g, '_'), 'media');
      if (!sourceScan.resourceRefs.has(mediaRef) && !sourceScan.resourceRefs.has(snakeRef)) {
        if (!baselineUnverified) {
          issues.push(`asset ${a.key}：源码未引用 $r('${mediaRef}')`);
        }
      } else {
        presenceOk.push(`asset ${a.key}：源码已引用`);
      }
    }
  }

  // --- tokens (color) ---
  const res = contracts ? readResourceJsonFiles(ctx.projectRoot, contracts) : null;
  for (const [tokenKey, tok] of Object.entries(doc.tokens ?? {})) {
    if (tok.kind === 'color') {
      const rkList = flattenResourceKeyEntries(contracts?.resource_keys);
      const contractKey = rkList.find(r =>
        r.key?.includes(tokenKey.replace(/\./g, '_')) || r.key === tokenKey,
      );
      if (contractKey) {
        presenceOk.push(`token ${tokenKey}：contracts 有映射 ${contractKey.key}`);
      } else if (res) {
        const snake = tokenKey.replace(/\./g, '_');
        if (res.colorKeys.has(snake) || res.colorKeys.has(tokenKey)) {
          presenceOk.push(`token ${tokenKey}：color.json 有 key`);
        } else if (!baselineUnverified) {
          issues.push(`token ${tokenKey}：未在 color 资源或 contracts.resource_keys 找到`);
        }
      }
      if (sourceScan && !baselineUnverified) {
        const colorRef = resourceKeyToRef(tokenKey, 'color');
        const snakeRef = resourceKeyToRef(tokenKey.replace(/\./g, '_'), 'color');
        if (!sourceScan.resourceRefs.has(colorRef) && !sourceScan.resourceRefs.has(snakeRef)) {
          issues.push(`token ${tokenKey}：源码未引用 $r('${colorRef}')`);
        }
      }
    }
  }

  // --- copy ---
  const copies = collectCopyTexts(doc);
  if (res && copies.length > 0) {
    let hit = 0;
    for (const t of copies) {
      if (res.stringValues.has(t)) hit++;
      else if (!baselineUnverified) {
        issues.push(`文案未命中 string 资源："${t.length > 40 ? `${t.slice(0, 40)}…` : t}"`);
      }
    }
    if (hit > 0) {
      presenceOk.push(`文案命中 ${hit}/${copies.length}`);
    }
  }

  // --- component tree（经 visual-parity.yaml 映射 vs 源码 struct）---
  const vpMappings = loadVisualParityMappings(ctx.projectRoot, ctx.feature);
  for (const s of doc.screens ?? []) {
    if (!s.root || s.lightweight) continue;
    const mapped = mappedComponentSequenceForScreen(s, vpMappings);
    if (mapped.length === 0) {
      if (vpMappings?.components?.length) {
        presenceOk.push(`screen ${s.id}：无 components 节点映射，结构 presence 跳过`);
      } else {
        presenceOk.push(`screen ${s.id}：缺 visual-parity components 映射（禁止 taxonomy 直比）`);
      }
      continue;
    }
    if (!sourceScan) {
      presenceOk.push(`screen ${s.id}：映射 ${mapped.length} 项（无源码扫描）`);
      continue;
    }
    const structList = [...sourceScan.structNames].map(x => x.toLowerCase());
    const ratio = sequenceMatchRatio(
      mapped.map(x => x.toLowerCase()),
      structList,
    );
    presenceOk.push(`screen ${s.id} 映射序 LCS=${(ratio * 100).toFixed(0)}% (${mapped.join('>')})`);
    if (ratio < 0.3 && mapped.length > 2 && !baselineUnverified) {
      issues.push(`screen ${s.id}：映射组件序与源码 struct 匹配过低 (${(ratio * 100).toFixed(0)}%)`);
    }
  }

  const boundaryNote =
    '【边界】visual_parity 查「在不在」非「对不对」——值错名、版面对照样可 PASS；保真信号见 static_fidelity_score 与 device visual_diff。';
  const baselineNote = baselineUnverified
    ? '【基线未校验】ui-spec verified=unverified：以下仅为结构 presence，非保真结论。'
    : '';

  const results: CheckResult[] = [];

  if (issues.length > 0) {
    const { severity, status } = structureFailOrWarn(enforcement);
    results.push({
      id: 'visual_parity',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: [baselineNote, boundaryNote, issues.join('；')].filter(Boolean).join('\n'),
      affected_files: [uiSpecRel, relFeatureFile(ctx.projectRoot, ctx.feature, 'contracts.yaml')],
    });
  } else {
    results.push({
      id: 'visual_parity',
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'PASS',
      details: [baselineNote, boundaryNote, presenceOk.join('；')].filter(Boolean).join('\n'),
      affected_files: [uiSpecRel],
    });
  }

  // static fidelity score (K)
  results.push(...computeStaticFidelityScore(ctx, doc, baselineUnverified));

  return results;
}
