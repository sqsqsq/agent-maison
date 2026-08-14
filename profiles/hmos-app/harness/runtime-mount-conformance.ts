// ============================================================================
// runtime-mount-conformance.ts — 结构保真运行时挂载轴（visual-capability-truth S7 / P2-J.1）
// ----------------------------------------------------------------------------
// 拆轴（codex plan 审查二轮：coding 无真机树，不能把静态分替换成运行时）：
//   static_structure_conformance = coding 期声明面（现状保留于静态保真分/结构台账）；
//   runtime_mount_conformance    = testing 期证据面（uitree dump）——声明在而未挂载不计分。
// 无设备/无 dump → SKIP（NOT_APPLICABLE 语义，不装死不冒充覆盖）。
// 分母复用 locator-required 集（与 P1-H 同一口径，防两套分母漂移）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import type { CheckContext, CheckResult } from '../../../harness/scripts/utils/types';
import { loadUiSpecFile, uiSpecAbsPath } from '../../../harness/scripts/utils/ui-spec-shared';
import { isHardPixelContract } from '../../../harness/scripts/utils/fidelity-shared';
import { extractLayoutDumpFacets } from './visual-diff-nav';
import { deviceScreenshotsDir, resolveLayoutDumpPath } from './visual-diff-capture';
import {
  collectLocatorRequiredElements,
  collectNavIdentityIdMembers,
  collectNavStepTargetIdsByScreen,
  collectRegionAttestElementIdsByScreen,
  navConfigExists,
} from './coding-visual-parity-check';

export function checkRuntimeMountConformance(ctx: CheckContext): CheckResult[] {
  const id = 'runtime_mount_conformance';
  const description = '结构保真·运行时挂载轴（声明元素在设备 uitree 实际挂载；声明在而未挂载不计分）';
  const doc = loadUiSpecFile(uiSpecAbsPath(ctx.projectRoot, ctx.feature));
  if (!doc) return [];
  const shotsDir = deviceScreenshotsDir(ctx.projectRoot, ctx.feature);
  const identityIds = collectNavIdentityIdMembers(ctx.projectRoot, ctx.feature);
  // S6（e9c4a7f3 s6-locator-calibrate）：按屏隔离上下文 + nav 缺失才启用交互回退
  const navStepIdsByScreen = collectNavStepTargetIdsByScreen(ctx.projectRoot, ctx.feature);
  const attestByScreen = collectRegionAttestElementIdsByScreen(ctx.projectRoot, ctx.feature);
  const interactiveFallbackEnabled = !navConfigExists(ctx.projectRoot, ctx.feature);
  let total = 0;
  let mounted = 0;
  const missing: string[] = [];
  let dumpsSeen = 0;
  let addressConflicts = 0;
  for (const s of doc.screens ?? []) {
    if (s.priority !== 'P0') continue;
    // t2b：与 T8/calibrate 同一共享寻址解析器——canonical 优先、legacy 兼容、并存 fail-closed
    const resolved = resolveLayoutDumpPath(shotsDir, s.id);
    if (resolved.status === 'conflict') {
      addressConflicts++;
      missing.push(`${s.id}（命名冲突：canonical 与 legacy 并存，须清理后重采）`);
      continue;
    }
    if (resolved.status === 'missing') continue;
    let facets: { texts: string[]; ids: string[] };
    try {
      facets = extractLayoutDumpFacets(JSON.parse(fs.readFileSync(resolved.abs, 'utf-8')));
    } catch {
      continue;
    }
    dumpsSeen++;
    const idSet = new Set(facets.ids);
    for (const el of collectLocatorRequiredElements(s, identityIds, {
      navStepIds: navStepIdsByScreen.get(s.id),
      attestRegions: attestByScreen.get(s.id),
      interactiveFallbackEnabled,
    })) {
      total++;
      if (idSet.has(el.elementId)) mounted++;
      else missing.push(`${s.id}/${el.elementId}`);
    }
  }
  if (dumpsSeen === 0 || total === 0) {
    return [{
      id, category: 'structure', description,
      severity: 'MINOR', status: 'SKIP',
      details:
        addressConflicts > 0
          ? `布局 dump 命名冲突（${addressConflicts} 屏 canonical/legacy 并存——须清理后重采；不读取、不猜测）。`
          : dumpsSeen === 0
            ? '无设备 uitree dump（layout-*.json）——运行时挂载轴不适用（无设备环境不装死；静态轴照常）。'
            : 'P0 屏无 locator-required 声明元素——挂载轴无分母。',
    }];
  }
  const rate = mounted / total;
  if (missing.length > 0) {
    const hard = isHardPixelContract(ctx);
    return [{
      id, category: 'structure', description,
      severity: hard ? 'BLOCKER' : 'MAJOR',
      status: hard ? 'FAIL' : 'WARN',
      details: [
        `【运行时挂载缺口】声明元素在设备 uitree 未挂载（挂载率 ${(rate * 100).toFixed(0)}%，${mounted}/${total}）：`,
        ...missing.slice(0, 12).map(m => `  - ${m}`),
        ...(missing.length > 12 ? [`  …共 ${missing.length} 处`] : []),
        '静态声明在而运行时不挂载=结构分虚高的根源——本轴以挂载树为证据，声明不计分。',
      ].join('\n'),
      suggestion: '确认组件真实渲染在目标页面（.id() 设置 + 条件渲染路径覆盖）；或修正 ui-spec 声明与实现一致。',
    }];
  }
  return [{
    id, category: 'structure', description,
    severity: 'BLOCKER', status: 'PASS',
    details: `locator-required 元素运行时挂载 ${mounted}/${total}（${dumpsSeen} 屏 dump 证据）。`,
  }];
}
