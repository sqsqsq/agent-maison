// ============================================================================
// source-ref-scan.ts — 从 ArkTS/ETS 源码扫描 $r() 与 struct 名
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import type { CheckContext } from '../../../harness/scripts/utils/types';
import type { UiSpecComponentNode } from '../../../harness/scripts/utils/ui-spec-shared';

const RESOURCE_REF_RE = /\$r\s*\(\s*['"](app\.(?:color|media|string|float|pattern)\.[^'"]+)['"]\s*\)/g;
const STRUCT_NAME_RE = /\bstruct\s+([A-Za-z_][A-Za-z0-9_]*)/g;

export interface SourceScanResult {
  resourceRefs: Set<string>;
  structNames: Set<string>;
  etsFiles: string[];
}

export function scanFeatureSourceTree(
  projectRoot: string,
  contracts: NonNullable<CheckContext['featureSpec']['contracts']>,
): SourceScanResult {
  const resourceRefs = new Set<string>();
  const structNames = new Set<string>();
  const etsFiles: string[] = [];

  for (const mod of contracts.modules ?? []) {
    const srcRoot = path.join(projectRoot, mod.package_path, 'src', 'main', 'ets');
    walkEts(srcRoot, (file) => {
      etsFiles.push(file);
      const text = fs.readFileSync(file, 'utf-8');
      for (const m of text.matchAll(RESOURCE_REF_RE)) {
        resourceRefs.add(m[1]);
      }
      for (const m of text.matchAll(STRUCT_NAME_RE)) {
        structNames.add(m[1]);
      }
    });
  }

  return { resourceRefs, structNames, etsFiles };
}

function walkEts(dir: string, fn: (file: string) => void): void {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkEts(full, fn);
    else if (ent.name.endsWith('.ets')) fn(full);
  }
}

/** ui-spec 单屏 type 顺序（跳过 navigation_frame 容器本身，保留子节点 type） */
export function collectScreenTypeSequence(root: UiSpecComponentNode | undefined): string[] {
  const types: string[] = [];
  if (!root) return types;
  const walk = (node: UiSpecComponentNode, skipRootNav: boolean) => {
    if (!(skipRootNav && node.type === 'navigation_frame')) {
      if (node.type) types.push(node.type);
    }
    const sorted = [...(node.children ?? [])].sort((a, b) => a.order - b.order);
    for (const c of sorted) walk(c, false);
  };
  walk(root, true);
  return types;
}

/** LCS 比例（0–1） */
export function sequenceMatchRatio(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const lcs = dp[a.length][b.length];
  return lcs / Math.max(a.length, b.length);
}

export function resourceKeyToRef(key: string, kind: 'color' | 'media' | 'string'): string {
  const snake = key.replace(/\./g, '_');
  return `app.${kind}.${snake}`;
}
