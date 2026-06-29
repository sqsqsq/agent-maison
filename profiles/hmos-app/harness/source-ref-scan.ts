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
  /** 按 pages → components → 其余目录的文件顺序收集 struct 名（用于结构序 LCS） */
  structNamesOrdered: string[];
  etsFiles: string[];
}

export function scanFeatureSourceTree(
  projectRoot: string,
  contracts: NonNullable<CheckContext['featureSpec']['contracts']>,
): SourceScanResult {
  const resourceRefs = new Set<string>();
  const structNames = new Set<string>();
  const structNamesOrdered: string[] = [];
  const etsFiles: string[] = [];

  for (const mod of contracts.modules ?? []) {
    const etsRoot = path.join(projectRoot, mod.package_path, 'src', 'main', 'ets');
    const scanDirs = [
      path.join(etsRoot, 'presentation', 'pages'),
      path.join(etsRoot, 'presentation', 'components'),
      path.join(etsRoot, 'shared'),
      path.join(etsRoot, 'data'),
      etsRoot,
    ];
    const seenFiles = new Set<string>();
    for (const dir of scanDirs) {
      walkEtsSorted(dir, (file) => {
        if (seenFiles.has(file)) return;
        seenFiles.add(file);
        scanEtsFile(file, resourceRefs, structNames, structNamesOrdered, etsFiles);
      });
    }
  }

  return { resourceRefs, structNames, structNamesOrdered, etsFiles };
}

/**
 * ref（如 `app.media.x`）→ 引用它的模块 package_path 集合。
 * 用于按"写 $r 的源码文件所属模块"定位资源（堵跨模块同名 media 误放行）。
 */
export function scanResourceRefModules(
  projectRoot: string,
  contracts: NonNullable<CheckContext['featureSpec']['contracts']>,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const mod of contracts.modules ?? []) {
    const etsRoot = path.join(projectRoot, mod.package_path, 'src', 'main', 'ets');
    walkEts(etsRoot, (file) => {
      const text = fs.readFileSync(file, 'utf-8');
      for (const m of text.matchAll(new RegExp(RESOURCE_REF_RE.source, 'g'))) {
        const ref = m[1];
        let set = map.get(ref);
        if (!set) {
          set = new Set<string>();
          map.set(ref, set);
        }
        set.add(mod.package_path);
      }
    });
  }
  return map;
}

function walkEtsSorted(dir: string, fn: (file: string) => void): void {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkEtsSorted(full, fn);
    else if (ent.name.endsWith('.ets')) fn(full);
  }
}

function scanEtsFile(
  file: string,
  resourceRefs: Set<string>,
  structNames: Set<string>,
  structNamesOrdered: string[],
  etsFiles: string[],
): void {
  etsFiles.push(file);
  const text = fs.readFileSync(file, 'utf-8');
  for (const m of text.matchAll(RESOURCE_REF_RE)) {
    resourceRefs.add(m[1]);
  }
  for (const m of text.matchAll(STRUCT_NAME_RE)) {
    structNames.add(m[1]);
    structNamesOrdered.push(m[1]);
  }
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

const STRUCT_DECL_RE = /\bstruct\s+([A-Za-z_][A-Za-z0-9_]*)/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 跳过行注释或块注释；若命中返回下一个下标，否则 null */
function skipComment(source: string, i: number): number | null {
  if (source[i] === '/' && source[i + 1] === '/') {
    i += 2;
    while (i < source.length && source[i] !== '\n') i++;
    return i;
  }
  if (source[i] === '/' && source[i + 1] === '*') {
    i += 2;
    while (i < source.length - 1 && !(source[i] === '*' && source[i + 1] === '/')) i++;
    return Math.min(i + 2, source.length);
  }
  return null;
}

/** 跳过 ' " ` 字符串/模板字面量；若命中返回下一个下标，否则 null */
function skipStringLiteral(source: string, i: number): number | null {
  const quote = source[i];
  if (quote !== '\'' && quote !== '"' && quote !== '`') return null;
  i++;
  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2;
      continue;
    }
    if (quote === '`' && source[i] === '$' && source[i + 1] === '{') {
      const close = findBalancedBraceEnd(source, i + 1);
      if (close === null) return null;
      i = close + 1;
      continue;
    }
    if (source[i] === quote) return i + 1;
    i++;
  }
  return null;
}

/** 从 `{` 位置做括号平衡（跳过字符串/注释），返回匹配的 `}` 下标 */
function findBalancedBraceEnd(source: string, openBraceIndex: number): number | null {
  if (source[openBraceIndex] !== '{') return null;
  let depth = 0;
  let i = openBraceIndex;
  while (i < source.length) {
    const commentNext = skipComment(source, i);
    if (commentNext !== null) {
      i = commentNext;
      continue;
    }
    const strNext = skipStringLiteral(source, i);
    if (strNext !== null) {
      i = strNext;
      continue;
    }
    const ch = source[i];
    if (ch === '{') {
      depth++;
      i++;
      continue;
    }
    if (ch === '}') {
      depth--;
      if (depth === 0) return i;
      i++;
      continue;
    }
    i++;
  }
  return null;
}

/** 从 from 起扫描到首个不在字符串/注释内的 `{` */
function findOpeningBrace(source: string, from: number): number | null {
  let i = from;
  while (i < source.length) {
    const commentNext = skipComment(source, i);
    if (commentNext !== null) {
      i = commentNext;
      continue;
    }
    const strNext = skipStringLiteral(source, i);
    if (strNext !== null) {
      i = strNext;
      continue;
    }
    if (source[i] === '{') return i;
    i++;
  }
  return null;
}

/** 在有效代码区定位 struct 声明起始下标（跳过注释/字符串） */
function findStructDeclIndex(source: string, structName: string): number | null {
  const declRe = new RegExp(`\\bstruct\\s+${escapeRegExp(structName)}\\b`);
  let i = 0;
  while (i < source.length) {
    const commentNext = skipComment(source, i);
    if (commentNext !== null) {
      i = commentNext;
      continue;
    }
    const strNext = skipStringLiteral(source, i);
    if (strNext !== null) {
      i = strNext;
      continue;
    }
    const tail = source.slice(i);
    const m = declRe.exec(tail);
    if (m && m.index === 0) return i;
    i++;
  }
  return null;
}

/** 提取单个 struct 声明体 `{ ... }`（不含同文件其它 struct；声明定位跳过注释/字符串） */
export function extractStructBody(source: string, structName: string): string | null {
  const declIndex = findStructDeclIndex(source, structName);
  if (declIndex === null) return null;

  const declRe = new RegExp(`\\bstruct\\s+${escapeRegExp(structName)}\\b`);
  const decl = declRe.exec(source.slice(declIndex));
  if (!decl) return null;

  const open = findOpeningBrace(source, declIndex + decl[0].length);
  if (open === null) return null;
  const close = findBalancedBraceEnd(source, open);
  if (close === null) return null;
  return source.slice(open, close + 1);
}

/** 在有效代码区（跳过注释/字符串）收集 $r() 引用 */
export function collectResourceRefsInActiveCode(source: string): Set<string> {
  const refs = new Set<string>();
  const re = new RegExp(RESOURCE_REF_RE.source, 'g');
  let i = 0;
  while (i < source.length) {
    const commentNext = skipComment(source, i);
    if (commentNext !== null) {
      i = commentNext;
      continue;
    }
    const strNext = skipStringLiteral(source, i);
    if (strNext !== null) {
      i = strNext;
      continue;
    }
    re.lastIndex = i;
    const m = re.exec(source);
    if (m && m.index === i) {
      refs.add(m[1]);
      i = m.index + m[0].length;
      continue;
    }
    i++;
  }
  return refs;
}

/** 定位 struct 声明所在 .ets 文件并扫描该 struct 体内的 $r() 引用 */
export function scanStructResourceRefs(
  projectRoot: string,
  contracts: NonNullable<CheckContext['featureSpec']['contracts']>,
  structName: string,
): Set<string> {
  const scan = scanFeatureSourceTree(projectRoot, contracts);
  const target = structName.trim();
  if (!target) return new Set();

  for (const file of scan.etsFiles) {
    const text = fs.readFileSync(file, 'utf-8');
    const body = extractStructBody(text, target);
    if (!body) continue;
    return collectResourceRefsInActiveCode(body);
  }
  return new Set();
}
