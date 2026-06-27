/**
 * ArkUI static rules — regex-based .ets scans for common Sheet/Nav pitfalls.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CheckContext, CheckResult } from '../../../harness/scripts/utils/types';
import type { FileAnalysis } from '../../../harness/scripts/utils/ast-analyzer';

const ALLOW_RE = /arkui-lint:allow\s+(\S+)/;

function readEtsContent(ctx: CheckContext, filePath: string): string {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(ctx.projectRoot, filePath);
  if (!fs.existsSync(abs)) return '';
  return fs.readFileSync(abs, 'utf-8');
}

function fileHasAllow(content: string, ruleId: string): boolean {
  for (const line of content.split(/\r?\n/)) {
    const m = ALLOW_RE.exec(line);
    if (m && m[1] === ruleId) return true;
  }
  return false;
}

function ruleDesc(ctx: CheckContext, id: string): string {
  const checks = ctx.phaseRule.structure_checks as Record<string, { description: string }>;
  return checks?.[id]?.description?.trim() ?? id;
}

/** bindSheet builder 内自定义 xmark 但 options 未 showClose:false */
export function checkArkuiBindsheetDoubleClose(
  ctx: CheckContext,
  analyses: FileAnalysis[],
): CheckResult[] {
  const id = 'arkui_bindsheet_double_close';
  const hits: string[] = [];

  for (const a of analyses) {
    const content = readEtsContent(ctx, a.filePath);
    if (fileHasAllow(content, id)) continue;
    if (!/bindSheet\s*\(/.test(content)) continue;

    const hasCustomClose =
      /sys\.symbol\.xmark|SymbolGlyph\s*\(\s*.*xmark|\.xmark\b/i.test(content);
    const showCloseFalse = /showClose\s*:\s*false/.test(content);

    if (hasCustomClose && !showCloseFalse) {
      hits.push(`${a.filePath}: bindSheet 含自定义关闭按钮但未设置 showClose: false`);
    }
  }

  if (hits.length === 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, id),
      severity: 'BLOCKER',
      status: analyses.length > 0 ? 'PASS' : 'SKIP',
      details: analyses.length > 0 ? '未发现 bindSheet 双关闭按钮风险。' : '无 .ets 文件可分析。',
    }];
  }

  return [{
    id,
    category: 'structure',
    description: ruleDesc(ctx, id),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: hits.join('\n'),
    affected_files: [...new Set(hits.map(h => h.split(':')[0]!))],
    suggestion:
      'bindSheet options 显式设置 showClose: false，或移除 builder 内自定义 xmark；豁免：// arkui-lint:allow arkui_bindsheet_double_close',
  }];
}

/** onChange/syncFromFlow 内 pushPath 无一次性消费 guard */
export function checkArkuiPushWithoutGuard(
  ctx: CheckContext,
  analyses: FileAnalysis[],
): CheckResult[] {
  const id = 'arkui_push_without_guard';
  const hits: string[] = [];

  for (const a of analyses) {
    const content = readEtsContent(ctx, a.filePath);
    if (fileHasAllow(content, id)) continue;

    const lines = content.split(/\r?\n/);
    let inWatchCallback = false;
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (/syncFromFlow|@Watch\s*\(|\.onChange\s*\(/.test(line)) {
        inWatchCallback = true;
        braceDepth = 0;
      }
      if (!inWatchCallback) continue;

      braceDepth += (line.match(/\{/g) ?? []).length;
      braceDepth -= (line.match(/\}/g) ?? []).length;

      if (/pushPath(ByName)?\s*\(/.test(line)) {
        const window = lines.slice(Math.max(0, i - 8), i + 3).join('\n');
        const hasGuard =
          /consumed|handled|once|guard|pendingNav|navConsumed|alreadyShown|if\s*\(\s*!/.test(window);
        if (!hasGuard) {
          hits.push(`${a.filePath}:${i + 1}: Flow/onChange 回调内 pushPath 未见一次性消费 guard`);
        }
      }

      if (braceDepth <= 0 && inWatchCallback && /\}/.test(line)) {
        inWatchCallback = false;
      }
    }
  }

  if (hits.length === 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, id),
      severity: 'MAJOR',
      status: analyses.length > 0 ? 'PASS' : 'SKIP',
      details: analyses.length > 0 ? '未发现无 guard 的 pushPath 调用。' : '无 .ets 文件可分析。',
    }];
  }

  return [{
    id,
    category: 'structure',
    description: ruleDesc(ctx, id),
    severity: 'MAJOR',
    status: 'FAIL',
    details: hits.slice(0, 15).join('\n'),
    affected_files: [...new Set(hits.map(h => h.split(':')[0]!))],
    suggestion:
      'Flow 状态变更触发导航时须一次性消费标志（置位/清标志后再 pushPath）；豁免：// arkui-lint:allow arkui_push_without_guard',
  }];
}

/** 多个 NavDestination 订阅同一 showXSheet 状态 */
export function checkArkuiSingletonFlowMultiSubscriber(
  ctx: CheckContext,
  analyses: FileAnalysis[],
): CheckResult[] {
  const id = 'arkui_singleton_flow_multi_subscriber';
  const sheetBindings = new Map<string, string[]>();

  for (const a of analyses) {
    const content = readEtsContent(ctx, a.filePath);
    if (fileHasAllow(content, id)) continue;
    if (!/NavDestination/.test(content)) continue;

    const sheetVars = [...content.matchAll(/show(\w+)Sheet|(\w+)SheetVisible/gi)].map(m => m[0]);
    for (const v of sheetVars) {
      const list = sheetBindings.get(v) ?? [];
      list.push(a.filePath);
      sheetBindings.set(v, list);
    }
  }

  const hits: string[] = [];
  for (const [varName, files] of sheetBindings) {
    const unique = [...new Set(files)];
    if (unique.length > 1) {
      hits.push(`${varName}: ${unique.length} 个文件监听同一 Sheet 状态 (${unique.join(', ')})`);
    }
  }

  if (hits.length === 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, id),
      severity: 'MAJOR',
      status: analyses.length > 0 ? 'PASS' : 'SKIP',
      details: analyses.length > 0 ? '未发现多 NavDestination 重复订阅 Sheet 状态。' : '无 .ets 文件可分析。',
    }];
  }

  return [{
    id,
    category: 'structure',
    description: ruleDesc(ctx, id),
    severity: 'MAJOR',
    status: 'FAIL',
    details: hits.join('\n'),
    suggestion:
      '同一 singleton Flow 的 Sheet 展示应仅在一处 NavDestination 订阅；豁免：// arkui-lint:allow arkui_singleton_flow_multi_subscriber',
  }];
}

/** a1 容器尺寸阈值：滚动容器固定高度 ≤ 此值且含 Image 子项 → 疑似裁切 */
const SMALL_CONTAINER_VP = 100;
const SCROLL_CONTAINERS = ['Swiper', 'Grid', 'List'];
/** 关联滚动容器/Stack 的窗口行数（ArkUI builder 修饰符在 {} 后链式，故向后取窗口近似关联） */
const ARKUI_WINDOW_LINES = 30;

/**
 * 纯检测（便于单测）：扫源码文本，返回裁切/叠帧/重叠风险命中行（低置信启发式）。
 * R1 裁切：Swiper/Grid/List 含 Image 且窗口内有固定矮高度(.height(≤100vp))；
 * R2 叠帧：Swiper 窗口内 .displayCount(≥2) 或 prev/nextMargin（单 banner 多项可见）；
 * R3 重叠：Stack 含 Image+Text 且绝对定位(position/offset/markAnchor) 但未 .clip(true)。
 */
export function detectClipOverlapRisks(content: string, filePath: string): string[] {
  const hits: string[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const winLines = lines.slice(i, Math.min(lines.length, i + ARKUI_WINDOW_LINES));
    const win = winLines.join('\n');

    const cont = SCROLL_CONTAINERS.find(c => new RegExp(`\\b${c}\\s*\\(`).test(line));
    if (cont) {
      const hasImage = winLines.some(l => /\bImage\s*\(/.test(l));
      // 容器矮高度：仅取非子项(Image/Text/SymbolGlyph/Button)行上的 .height，避免把小图标自身高度误判
      const smallContainerH = winLines.some(l => {
        if (/\b(Image|Text|SymbolGlyph|Button)\s*\(/.test(l)) return false;
        // 兼容 .height(80) / .height('80vp') / .height("80")；变量高度仍漏（低置信可接受）
        const m = /\.height\s*\(\s*['"]?(\d+)/.exec(l);
        return m ? Number(m[1]) <= SMALL_CONTAINER_VP : false;
      });
      if (hasImage && smallContainerH) {
        hits.push(`${filePath}:${i + 1}: ${cont} 含 Image 且固定矮高度(≤${SMALL_CONTAINER_VP}vp) — 疑似裁切子项`);
      }
      const dispMulti = [...win.matchAll(/\.displayCount\s*\(\s*(\d+)/g)].some(m => Number(m[1]) >= 2);
      const peekMargin = /\.(prevMargin|nextMargin)\s*\(/.test(win);
      if (cont === 'Swiper' && (dispMulti || peekMargin)) {
        hits.push(`${filePath}:${i + 1}: Swiper 多项可见(displayCount≥2 或 prev/nextMargin) — 单 banner 场景疑似叠帧`);
      }
    }

    if (/\bStack\s*\(/.test(line)) {
      const hasOverlay = /\bImage\s*\(/.test(win) && /\bText\s*\(/.test(win);
      const absPos = /\.(position|offset|markAnchor)\s*\(/.test(win);
      const clipped = /\.clip\s*\(\s*true/.test(win);
      if (hasOverlay && absPos && !clipped) {
        hits.push(`${filePath}:${i + 1}: Stack 内 Image/Text 绝对定位且父未 .clip(true) — 疑似重叠/溢出`);
      }
    }
  }
  return [...new Set(hits)];
}

/** a1：Swiper/Grid 裁切 + 叠帧 + Image 压 Text 重叠（低置信 WARN，以 device visual-diff 为准） */
export function checkArkuiClipOverlapRisk(ctx: CheckContext, analyses: FileAnalysis[]): CheckResult[] {
  const id = 'arkui_clip_overlap_risk';
  const hits: string[] = [];
  for (const a of analyses) {
    const content = readEtsContent(ctx, a.filePath);
    if (fileHasAllow(content, id)) continue;
    hits.push(...detectClipOverlapRisks(content, a.filePath));
  }
  const uniq = [...new Set(hits)];

  if (uniq.length === 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, id),
      severity: 'MAJOR',
      status: analyses.length > 0 ? 'PASS' : 'SKIP',
      details: analyses.length > 0 ? '未发现 Swiper/Grid 裁切或叠帧/重叠风险。' : '无 .ets 文件可分析。',
    }];
  }

  return [{
    id,
    category: 'structure',
    description: ruleDesc(ctx, id),
    severity: 'MAJOR',
    status: 'WARN',
    details: ['【低置信启发式·以 device visual-diff 为准】', ...uniq.slice(0, 15)].join('\n'),
    affected_files: [...new Set(uniq.map(h => h.split(':')[0]!))],
    suggestion:
      '确认 Swiper/Grid 高度容纳子项(含 label)、单 banner 设 .displayCount(1)、Image 覆盖区父设 .clip(true)；豁免：// arkui-lint:allow arkui_clip_overlap_risk',
  }];
}

export function runArkuiStaticRules(ctx: CheckContext, analyses: FileAnalysis[]): CheckResult[] {
  return [
    ...checkArkuiBindsheetDoubleClose(ctx, analyses),
    ...checkArkuiPushWithoutGuard(ctx, analyses),
    ...checkArkuiSingletonFlowMultiSubscriber(ctx, analyses),
    ...checkArkuiClipOverlapRisk(ctx, analyses),
  ];
}
