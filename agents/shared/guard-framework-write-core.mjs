// ============================================================================
// guard-framework-write-core.mjs — framework/ 写时守卫共享判定核心
// （plan e8f5a2c7 G1；claude PreToolUse 壳与 cursor preToolUse 壳共同调用）
// ============================================================================
// 运行时约束：独立 node ESM，不依赖 ts-node / 任何 npm 包——hook 进程由宿主 IDE
// 直接以 `node xxx.mjs` 拉起，必须零依赖可跑。
//
// 策略 SSOT：specs/runtime-artifact-policy.json（与 framework-integrity.ts /
// canonical-gitignore.ts 三方共读；三方一致性单测钉死，勿在本文件另立清单）。
//
// 人签 allowlist 语义：复刻 framework-integrity.ts 的 approvalInvalidReason /
// fidelity-shared.ts 的 isHumanVerified（legacy 字符串、自动化身份、user_requirement
// 哨兵、缺 rationale/签名均无效）——两实现有跨实现一致性单测对齐，改任一侧须同步。
//
// 诚实边界（plan 钉死）：只拦编辑类工具的路径；Bash 重定向/node -e 写文件不在射程；
// 判定异常一律 fail-open（G2 查时扫描恒为兜底）。

import * as fs from 'fs';
import * as path from 'path';

// --------------------------------------------------------------------------
// 策略加载（SSOT）
// --------------------------------------------------------------------------

/** @typedef {{ignored_runtime_patterns: string[], generated_file_patterns: string[], reserved_metadata_files: string[]}} RuntimeArtifactPolicy */

/**
 * 读 specs/runtime-artifact-policy.json。frameworkRoot = 消费端 <repo>/framework 或
 * 源仓根（agent-maison 自身）。读取失败 → null（调用方 fail-open）。
 * @param {string} frameworkRoot
 * @returns {RuntimeArtifactPolicy | null}
 */
export function loadRuntimeArtifactPolicy(frameworkRoot) {
  try {
    const abs = path.join(frameworkRoot, 'specs', 'runtime-artifact-policy.json');
    const doc = JSON.parse(fs.readFileSync(abs, 'utf-8'));
    if (!doc || typeof doc !== 'object') return null;
    const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
    return {
      ignored_runtime_patterns: arr(doc.ignored_runtime_patterns),
      generated_file_patterns: arr(doc.generated_file_patterns),
      reserved_metadata_files: arr(doc.reserved_metadata_files),
    };
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------
// glob-lite 匹配（语义与 policy JSON 头部注释一致；TS 侧 framework-integrity 有
// 等价实现，跨实现一致性单测对齐）
// --------------------------------------------------------------------------

/**
 * 段内 '*' 通配（不跨 '/'）；整段 '**' 匹配任意层。尾 '/' 目录前缀语义由调用方处理。
 * @param {string[]} patSegs @param {string[]} relSegs @returns {boolean}
 */
function segsMatch(patSegs, relSegs) {
  if (patSegs.length === 0) return relSegs.length === 0;
  const [head, ...rest] = patSegs;
  if (head === '**') {
    for (let skip = 0; skip <= relSegs.length; skip += 1) {
      if (segsMatch(rest, relSegs.slice(skip))) return true;
    }
    return false;
  }
  if (relSegs.length === 0) return false;
  const re = new RegExp('^' + head.split('*').map(escapeRe).join('[^/]*') + '$');
  if (!re.test(relSegs[0])) return false;
  return segsMatch(rest, relSegs.slice(1));
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * rel（framework 根相对、POSIX、无首尾斜杠）是否命中 pattern。
 * 尾 '/' = 该目录自身及其下所有内容。
 * @param {string} rel @param {string} pattern @returns {boolean}
 */
export function matchesPolicyPattern(rel, pattern) {
  const p = pattern.replace(/\\/g, '/');
  const isDir = p.endsWith('/');
  const patSegs = (isDir ? p.slice(0, -1) : p).split('/').filter(Boolean);
  const relSegs = rel.split('/').filter(Boolean);
  if (isDir) {
    // 目录自身或其任意后代：取 rel 的前缀段尝试匹配
    for (let take = patSegs.filter((s) => s !== '**').length; take <= relSegs.length; take += 1) {
      if (segsMatch(patSegs, relSegs.slice(0, take))) return true;
    }
    return false;
  }
  return segsMatch(patSegs, relSegs);
}

/**
 * rel 是否属于**扫描合法存在**的运行时产物（三段任一命中）——供 G2 extra-file 扫描：
 * sidecar（reserved_metadata_files）在磁盘上合法存在，不算 foreign。
 * @param {string} rel @param {RuntimeArtifactPolicy} policy @returns {boolean}
 */
export function isPolicyAllowedPath(rel, policy) {
  const all = [
    ...policy.ignored_runtime_patterns,
    ...policy.generated_file_patterns,
    ...policy.reserved_metadata_files,
  ];
  return all.some((p) => matchesPolicyPattern(rel, p));
}

/**
 * rel 是否属于**写时放行**的运行时产物（第七轮 codex P1-1：与扫描谓词拆开）——
 * reserved_metadata_files（RELEASE-MANIFEST.sha256 等完整性锚点）由 pack 产出、agent
 * 绝不该手写，写时必须 deny；只有 harness 运行时目录与按需生成文件（金丝雀）可写。
 * @param {string} rel @param {RuntimeArtifactPolicy} policy @returns {boolean}
 */
export function isWriteAllowedPath(rel, policy) {
  const writable = [...policy.ignored_runtime_patterns, ...policy.generated_file_patterns];
  return writable.some((p) => matchesPolicyPattern(rel, p));
}

// --------------------------------------------------------------------------
// 人签 allowlist（语义复刻 framework-integrity.ts / fidelity-shared.ts）
// --------------------------------------------------------------------------

/** 与 fidelity-shared.ts AUTOMATION_SIGNER_IDS 同步（跨实现一致性单测钉死）。 */
export const AUTOMATION_SIGNER_IDS_MJS = new Set([
  'goal-mode-auto',
  'goal-mode',
  'goal-runner',
  'headless',
  'headless-auto',
  'auto',
  'system',
]);

const USER_REQUIREMENT_CONFIRMER = 'user_requirement';

/**
 * 复刻 framework-integrity.ts approvalInvalidReason：null=有效，否则无效原因。
 * @param {unknown} rationale @param {unknown} approvedBy @returns {string | null}
 */
export function approvalInvalidReasonMjs(rationale, approvedBy) {
  if (typeof approvedBy !== 'string' || !approvedBy.trim()) return '缺 approved_by 真人签名';
  const norm = approvedBy.trim().toLowerCase();
  if (AUTOMATION_SIGNER_IDS_MJS.has(norm) || norm === USER_REQUIREMENT_CONFIRMER) {
    return `approved_by="${approvedBy.trim()}" 属自动化身份/授权哨兵（user_requirement），不算真人签名`;
  }
  if (typeof rationale !== 'string' || !rationale.trim()) return '缺 rationale';
  return null;
}

/**
 * 读 framework.config.json 的 integrity.drift_allowlist（仅结构化真人具名审批生效——
 * legacy 字符串/自动化身份/user_requirement/缺 rationale 一律无效，与查时语义一致，
 * 防"先写无效 allowlist 骗过写守卫、拖到 G2 才暴露"）。
 * @param {string} projectRoot @returns {Set<string>}
 */
export function loadValidDriftAllowlist(projectRoot) {
  const out = new Set();
  try {
    const cfgPath = path.join(projectRoot, 'framework.config.json');
    if (!fs.existsSync(cfgPath)) return out;
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    const entries = cfg?.integrity?.drift_allowlist;
    if (!Array.isArray(entries)) return out;
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue; // legacy 字符串等无效
      const p = typeof entry.path === 'string' ? entry.path.trim() : '';
      if (!p) continue;
      if (approvalInvalidReasonMjs(entry.rationale, entry.approved_by) !== null) continue;
      out.add(p.replace(/\\/g, '/'));
    }
  } catch {
    /* fail-open：allowlist 读不出来就当没有（拦得更严，且不崩 hook） */
  }
  return out;
}

// --------------------------------------------------------------------------
// 主判定
// --------------------------------------------------------------------------

/**
 * @typedef {{decision: 'allow'} | {decision: 'deny', reason: string}} GuardDecision
 */

/**
 * 判定一次编辑类工具写入是否放行。
 *   - 仅 consumer 布局生效：projectRoot/framework/RELEASE-MANIFEST.json 存在才拦
 *     （agent-maison 源仓开发不受影响）；
 *   - 目标不在 framework/ 下 → allow；
 *   - 命中 runtime-artifact-policy 三段 → allow；
 *   - 命中合法人签 drift_allowlist（framework 根相对路径）→ allow；
 *   - 其余 → deny + 教育文案。
 * @param {{projectRoot: string, filePath: string}} input
 * @returns {GuardDecision}
 */
export function evaluateFrameworkWrite(input) {
  try {
    const projectRoot = path.resolve(input.projectRoot);
    const frameworkRoot = path.join(projectRoot, 'framework');
    if (!fs.existsSync(path.join(frameworkRoot, 'RELEASE-MANIFEST.json'))) {
      return { decision: 'allow' }; // 源仓/未 vendored 布局：不拦
    }
    const abs = path.resolve(projectRoot, input.filePath);
    const relFromProject = path.relative(projectRoot, abs).replace(/\\/g, '/');
    if (relFromProject.startsWith('..') || path.isAbsolute(relFromProject)) {
      return { decision: 'allow' }; // 工程外路径不归本守卫管
    }
    if (relFromProject !== 'framework' && !relFromProject.startsWith('framework/')) {
      return { decision: 'allow' };
    }
    const rel = relFromProject === 'framework' ? '' : relFromProject.slice('framework/'.length);
    if (!rel) return { decision: 'deny', reason: denyText('framework/（目录自身）') };

    const policy = loadRuntimeArtifactPolicy(frameworkRoot);
    if (policy && isWriteAllowedPath(rel, policy)) return { decision: 'allow' };

    const allowlist = loadValidDriftAllowlist(projectRoot);
    if (allowlist.has(rel)) return { decision: 'allow' };

    return { decision: 'deny', reason: denyText(`framework/${rel}`) };
  } catch {
    return { decision: 'allow' }; // 任何判定异常 fail-open——G2 查时扫描兜底
  }
}

/** @param {string} target @returns {string} */
function denyText(target) {
  return [
    `[framework 写保护] 已阻止写入 ${target}。`,
    'framework/ 是只读 vendored 发布件（consumer-framework-boundary.md）：',
    '  - 临时诊断脚本请放 <repo-root>/scratch/（gitignored）或系统临时目录，不要写进 framework/；',
    '  - 升级/修改 framework 的唯一途径是 framework-init UPDATE（重新解包发布件）；',
    '  - 确需本地 fork 某文件：由真人在 framework.config.json integrity.drift_allowlist',
    '    添加 {path, rationale, approved_by} 具名审批（自动化身份/user_requirement 无效）。',
    '发现框架自身问题请 halt 上报，不要就地修改后自批放行。',
  ].join('\n');
}
