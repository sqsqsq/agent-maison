// plan-version-lib.mjs — plan frontmatter 解析与 semver 比较（dev-only）
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;
const TERMINAL_TODO = new Set(['completed', 'cancelled']);

/**
 * @param {string} v
 * @returns {boolean}
 */
export function isValidSemver(v) {
  return typeof v === 'string' && SEMVER_RE.test(v.trim());
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {-1 | 0 | 1}
 */
export function compareSemver(a, b) {
  const ma = SEMVER_RE.exec(a.trim());
  const mb = SEMVER_RE.exec(b.trim());
  if (!ma || !mb) throw new Error(`invalid semver: ${a} or ${b}`);
  for (let i = 1; i <= 3; i += 1) {
    const na = Number(ma[i]);
    const nb = Number(mb[i]);
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

/**
 * @param {string} repoRoot
 */
export function readCurrentVersion(repoRoot) {
  const pkgPath = path.join(repoRoot, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (!pkg.version || !isValidSemver(pkg.version)) {
    throw new Error('package.json missing valid semver version');
  }
  return pkg.version.trim();
}

/**
 * @param {string} repoRoot
 * @returns {string[]}
 */
export function listPlanFiles(repoRoot) {
  const plansDir = path.join(repoRoot, '.cursor', 'plans');
  if (!fs.existsSync(plansDir)) return [];
  return fs
    .readdirSync(plansDir)
    .filter((f) => f.endsWith('.plan.md'))
    .map((f) => path.join(plansDir, f))
    .sort();
}

/**
 * @param {string} content
 * @returns {{ version?: string, deferred_to?: string, deferred_from?: string, name?: string, overview?: string, todos: { id?: string, content?: string, status: string }[], rawFrontmatter: string, body: string }}
 */
export function parsePlanFile(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) {
    return { todos: [], rawFrontmatter: '', body: content };
  }
  const fm = match[1];
  const body = content.slice(match.index + match[0].length);
  /** @type {{ version?: string, deferred_to?: string, deferred_from?: string, name?: string, overview?: string, todos: { id?: string, content?: string, status: string }[] }} */
  const out = { todos: [] };

  const scalarKeys = ['version', 'deferred_to', 'deferred_from', 'name', 'overview'];
  for (const key of scalarKeys) {
    const m = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(fm);
    if (m) {
      const val = m[1].trim().replace(/^["']|["']$/g, '');
      out[key] = val;
    }
  }

  const todoBlocks = fm.split(/\n\s*-\s+id:\s*/).slice(1);
  for (const block of todoBlocks) {
    const idM = /^(\S+)/.exec(block);
    const statusM = /\n\s*status:\s*(\S+)/.exec(block);
    const contentM = /\n\s*content:\s*(.+)/.exec(block);
    out.todos.push({
      id: idM ? idM[1] : undefined,
      content: contentM ? contentM[1].trim() : undefined,
      status: statusM ? statusM[1].trim() : 'pending',
    });
  }

  return { ...out, rawFrontmatter: fm, body };
}

/**
 * plan a3e7d1c9：frontmatter `todos:` 是唯一机器待办 SSOT——正文里的未勾 `- [ ]`
 * 门禁看不见，会形成假绿（实测 d8c5f3a7/e9c4a7f3 两份 plan 整体不进发布统计）。
 * 本函数只做**注册面**检出：找出正文中的未勾复选框，**不解析其内容、不推导 todo 状态**。
 *
 * 已勾 `- [x]` 不计——历史勾选可保留作叙述，重新打开任务时须先在 frontmatter 登记。
 * 围栏代码块内的示例复选框不计（plan 正文常含 markdown 示例，误报会逼人删文档）。
 *
 * @param {string} body plan 正文（frontmatter 之后）
 * @returns {{ line: number, text: string }[]} 未勾项，行号以正文首行为 1
 */
export function findOpenChecklistItems(body) {
  if (typeof body !== 'string' || !body) return [];
  const lines = body.split(/\r?\n/);
  /** @type {{ line: number, text: string }[]} */
  const out = [];
  let fenceChar = '';
  let fenceLen = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // CommonMark：closing fence 须与 opening **同字符**、长度 **不少于** opening，且其后只允许空白。
    // 只记字符不记长度会让「四反引号外层包三反引号」提前闭合，把文档示例里的 `- [ ]` 误当待办。
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      const [, run, rest] = fence;
      if (!fenceChar) {
        fenceChar = run[0];
        fenceLen = run.length;
        continue;
      }
      if (run[0] === fenceChar && run.length >= fenceLen && rest.trim() === '') {
        fenceChar = '';
        fenceLen = 0;
      }
      continue;
    }
    if (fenceChar) continue;
    if (/^\s*[-*+]\s+\[ \]/.test(line)) {
      out.push({ line: i + 1, text: line.trim().slice(0, 80) });
    }
  }
  return out;
}

/**
 * @param {{ status: string }[]} todos
 */
export function hasOpenTodos(todos) {
  return todos.some((t) => !TERMINAL_TODO.has(t.status));
}

/**
 * @param {{ status: string }[]} todos
 */
export function allTodosTerminal(todos) {
  if (todos.length === 0) return true;
  return todos.every((t) => TERMINAL_TODO.has(t.status));
}

/**
 * legacy allowlist 仅豁免：有 frontmatter + todos 非空且全终态 + 无 version + 无 deferred_to
 * @param {ReturnType<typeof parsePlanFile>} parsed
 */
export function isLegacyAllowlistEligible(parsed) {
  const { version, deferred_to, todos, rawFrontmatter } = parsed;
  if (!rawFrontmatter || !rawFrontmatter.trim()) return false;
  if (todos.length === 0) return false;
  if (!allTodosTerminal(todos)) return false;
  if (version) return false;
  if (deferred_to) return false;
  return true;
}

/**
 * @param {string} [repoRoot]
 * @returns {Set<string>}
 */
export function loadPreFrontmatterAllowlist(repoRoot = path.resolve(__dirname, '..')) {
  const p = path.join(repoRoot, 'scripts', 'plan-version-pre-frontmatter-allowlist.json');
  if (!fs.existsSync(p)) return new Set();
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  const files = Array.isArray(data.files) ? data.files : [];
  return new Set(files);
}

/**
 * @param {string} [repoRoot]
 * @returns {Set<string>}
 */
export function loadLegacyAllowlist(repoRoot = path.resolve(__dirname, '..')) {
  const p = path.join(repoRoot, 'scripts', 'plan-version-legacy-allowlist.json');
  if (!fs.existsSync(p)) return new Set();
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  const files = Array.isArray(data.files) ? data.files : [];
  return new Set(files);
}

/**
 * @param {string} repoRoot
 * @returns {{ basename: string, abs: string, rel: string, parsed: ReturnType<typeof parsePlanFile> }[]}
 */
export function loadAllPlans(repoRoot) {
  return listPlanFiles(repoRoot).map((abs) => {
    const content = fs.readFileSync(abs, 'utf8');
    const basename = path.basename(abs);
    return {
      basename,
      abs,
      rel: `.cursor/plans/${basename}`,
      parsed: parsePlanFile(content),
    };
  });
}

/**
 * @param {string} level patch|minor|major
 * @param {string} current
 */
export function bumpSemver(level, current) {
  const m = SEMVER_RE.exec(current.trim());
  if (!m) throw new Error(`invalid semver: ${current}`);
  let major = Number(m[1]);
  let minor = Number(m[2]);
  let patch = Number(m[3]);
  if (level === 'patch') patch += 1;
  else if (level === 'minor') {
    minor += 1;
    patch = 0;
  } else if (level === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else {
    throw new Error(`unknown bump level: ${level}`);
  }
  return `${major}.${minor}.${patch}`;
}
