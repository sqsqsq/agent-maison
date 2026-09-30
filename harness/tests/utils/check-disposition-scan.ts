// ============================================================================
// check-disposition-scan.ts — 处置策略开发期静态守卫的扫描器与基线生成（plan f7045213 §3.4）
// ----------------------------------------------------------------------------
// 扫描生产代码（harness/** 与 profiles/*/harness/**，剔 tests/ 与 node_modules/）：
//   · 阻断构造：含字面 `severity: 'BLOCKER'` 且带 `status:` 键的对象字面量（CheckResult 形状；
//     不带 status 的 issue / lint 违规不在射程）。id 为纯字符串字面量的收进 id 集合，其余
//     （模板、常量、展开、简写）按文件计数；
//   · 字面判断："状态为失败且严重级别为阻断"的逐行字面比较（含德摩根取反形态）。
// 严重级别与状态由变量、展开或辅助函数给出的构造不在射程——与既有 blocker-suggestion-ratchet
// 同一边界；这类构造运行时走处置函数第 3 条，行为不变。
//
// 基线生成（随开发仓版本管理，不手写）：
//   cd harness && npx ts-node tests/utils/check-disposition-scan.ts --write
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

export const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');
export const BASELINE_PATH = path.join(__dirname, 'check-disposition-baseline.json');
/** 谓词模块本身：字面判断的唯一合法出处。 */
export const PREDICATE_MODULE = 'harness/scripts/utils/check-disposition.ts';

export interface FileScan {
  literal_ids: string[];
  dynamic_count: number;
}

export interface DispositionBaseline {
  files: Record<string, FileScan>;
}

const SKIP_DIRS = new Set(['tests', 'node_modules', 'dist', 'reports', 'state', 'trace']);

function listTsFiles(dir: string, out: string[]): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.has(ent.name)) listTsFiles(abs, out);
    } else if (ent.isFile() && ent.name.endsWith('.ts') && !ent.name.endsWith('.d.ts')) {
      out.push(abs);
    }
  }
  return out;
}

/** 生产源文件（仓库相对路径 → 源码）。 */
export function readProductionSources(root: string = FRAMEWORK_ROOT): Map<string, string> {
  const files: string[] = [];
  if (fs.existsSync(path.join(root, 'harness'))) listTsFiles(path.join(root, 'harness'), files);
  const profilesDir = path.join(root, 'profiles');
  if (fs.existsSync(profilesDir)) {
    for (const ent of fs.readdirSync(profilesDir, { withFileTypes: true })) {
      const h = path.join(profilesDir, ent.name, 'harness');
      if (ent.isDirectory() && fs.existsSync(h)) listTsFiles(h, files);
    }
  }
  const out = new Map<string, string>();
  for (const abs of files.sort()) {
    out.set(path.relative(root, abs).replace(/\\/g, '/'), fs.readFileSync(abs, 'utf-8'));
  }
  return out;
}

/**
 * 从 idx 向前做括号平衡，找最近的包围对象字面量起点（与 blocker-suggestion-ratchet 同一算法）；
 * 字面量终点由 topLevelKeys 按字符串/模板感知的方式确定。
 */
function enclosingLiteral(src: string, idx: number): string | null {
  let depth = 0;
  for (let i = idx; i >= 0; i--) {
    const ch = src[i];
    if (ch === '}') depth++;
    else if (ch === '{') {
      if (depth === 0) return src.slice(i);
      depth--;
    }
  }
  return null;
}

/**
 * 对象字面量的顶层键 → 值文本起点。只认前面（跳过空白）是 `{` 或 `,` 的标识符，
 * 以免把 `cond ? a : b` 里的 `a` 当键；跳过引号字符串、模板文本与注释。
 */
function topLevelKeys(lit: string): Map<string, number> {
  const keys = new Map<string, number>();
  const stack: string[] = [];
  let lastSignificant = '';
  let i = 0;
  while (i < lit.length) {
    const ch = lit[i];
    const top = stack[stack.length - 1];
    if (top === 'T') {
      if (ch === '\\') { i += 2; continue; }
      if (ch === '`') { stack.pop(); lastSignificant = '`'; i++; continue; }
      if (ch === '$' && lit[i + 1] === '{') { stack.push('{'); i += 2; continue; }
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      i++;
      while (i < lit.length && lit[i] !== ch) i += lit[i] === '\\' ? 2 : 1;
      i++;
      lastSignificant = ch;
      continue;
    }
    if (ch === '`') { stack.push('T'); i++; continue; }
    if (ch === '/' && lit[i + 1] === '/') { while (i < lit.length && lit[i] !== '\n') i++; continue; }
    if (ch === '/' && lit[i + 1] === '*') { const end = lit.indexOf('*/', i + 2); i = end < 0 ? lit.length : end + 2; continue; }
    if (ch === '{' || ch === '[' || ch === '(') { stack.push(ch); lastSignificant = ch; i++; continue; }
    if (ch === '}' || ch === ']' || ch === ')') {
      stack.pop();
      if (stack.length === 0) break; // 字面量结束
      lastSignificant = ch;
      i++;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < lit.length && /[\w$]/.test(lit[j])) j++;
      const word = lit.slice(i, j);
      if (stack.length === 1 && (lastSignificant === '{' || lastSignificant === ',')) {
        let k = j;
        while (k < lit.length && /\s/.test(lit[k])) k++;
        if (lit[k] === ':') keys.set(word, k + 1);
        else if (lit[k] === ',' || lit[k] === '}') keys.set(word, -1); // 简写
      }
      lastSignificant = 'w';
      i = j;
      continue;
    }
    if (!/\s/.test(ch)) lastSignificant = ch;
    i++;
  }
  return keys;
}

/** id 值是否为纯字符串字面量（可带 `as const`）。 */
function literalIdValue(lit: string, valueStart: number): string | null {
  if (valueStart < 0) return null;
  const rest = lit.slice(valueStart);
  const m = /^\s*(['"])((?:\\.|(?!\1)[^\\\n])*)\1\s*(?:as\s+const\s*)?(?=[,}\n]|\/[/*])/.exec(rest);
  return m ? m[2] : null;
}

export function scanBlockingConstructions(src: string): FileScan {
  const sevRe = /severity:\s*['"]BLOCKER['"]/g;
  const literalIds = new Set<string>();
  let dynamic = 0;
  let m: RegExpExecArray | null;
  while ((m = sevRe.exec(src)) !== null) {
    const lit = enclosingLiteral(src, m.index);
    if (!lit) continue;
    const keys = topLevelKeys(lit);
    if (!keys.has('status') || !keys.has('severity')) continue;
    const id = keys.has('id') ? literalIdValue(lit, keys.get('id')!) : null;
    if (id !== null) literalIds.add(id);
    else dynamic++;
  }
  return { literal_ids: [...literalIds].sort(), dynamic_count: dynamic };
}

const JUDGEMENT_PATTERNS: readonly RegExp[] = [
  /status\s*===\s*['"]FAIL['"]\s*&&\s*\(?\s*[\w$.?[\]]*severity\s*===\s*['"]BLOCKER['"]/,
  /severity\s*===\s*['"]BLOCKER['"]\s*&&\s*\(?\s*[\w$.?[\]]*status\s*===\s*['"]FAIL['"]/,
  /severity\s*!==\s*['"]BLOCKER['"]\s*\|\|\s*\(?\s*[\w$.?[\]]*status\s*!==\s*['"]FAIL['"]/,
  /status\s*!==\s*['"]FAIL['"]\s*\|\|\s*\(?\s*[\w$.?[\]]*severity\s*!==\s*['"]BLOCKER['"]/,
];

/** 逐行统计"状态为失败且严重级别为阻断"的字面判断（注释行不计）。 */
export function countLiteralBlockingJudgements(src: string): number {
  let n = 0;
  for (const line of src.split('\n')) {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
    if (JUDGEMENT_PATTERNS.some(re => re.test(line))) n++;
  }
  return n;
}

/**
 * 动态族的生产点：以 `id:` 键产出、且值里有以该前缀开头的字符串或模板的行（逐行计一次）。
 * 去向表里的 `prefix:` 声明、`startsWith('<prefix>')` 之类的消费方引用都不是 `id:` 的值，不计入。
 * 调用方另行排除去向表所在的谓词模块（表里精确 id 条目也写作 `id:`）。
 */
export function countIdProducerLines(src: string, prefix: string): number {
  const opener = new RegExp(`['"\`]${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  let n = 0;
  for (const line of src.split('\n')) {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*')) continue;
    const re = /\bid\s*:/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (opener.test(idValueText(line, m.index + m[0].length))) { n++; break; }
    }
  }
  return n;
}

/** `id:` 之后到同层 `,` `}` `)` `;` 为止的值文本（跳过引号字符串与模板；`(id: string)` 这类类型标注因此只取到 `string`）。 */
function idValueText(line: string, from: number): string {
  let depth = 0;
  let i = from;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      i++;
      while (i < line.length && line[i] !== ch) i += line[i] === '\\' ? 2 : 1;
      i++;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) break;
      depth--;
    } else if ((ch === ',' || ch === ';') && depth === 0) break;
    i++;
  }
  return line.slice(from, i);
}

export function buildBaseline(sources: Map<string, string>): DispositionBaseline {
  const files: Record<string, FileScan> = {};
  for (const [rel, src] of sources) {
    const scan = scanBlockingConstructions(src);
    if (scan.literal_ids.length > 0 || scan.dynamic_count > 0) files[rel] = scan;
  }
  return { files };
}

export function loadBaseline(file: string = BASELINE_PATH): DispositionBaseline {
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as DispositionBaseline;
}

if (require.main === module) {
  const baseline = buildBaseline(readProductionSources());
  const text = JSON.stringify(baseline, null, 2) + '\n';
  if (process.argv.includes('--write')) {
    fs.writeFileSync(BASELINE_PATH, text, 'utf-8');
    const n = Object.values(baseline.files);
    console.log(
      `wrote ${path.relative(FRAMEWORK_ROOT, BASELINE_PATH)}: ${n.length} files, ` +
        `${n.reduce((a, f) => a + f.literal_ids.length, 0)} literal ids, ${n.reduce((a, f) => a + f.dynamic_count, 0)} dynamic`,
    );
  } else {
    process.stdout.write(text);
  }
}
