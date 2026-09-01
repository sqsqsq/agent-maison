// ============================================================================
// guard-framework-write-core.mjs — framework/ 写时守卫共享判定核心
// （plan e8f5a2c7 G1；claude PreToolUse 壳与 cursor preToolUse 壳共同调用）
// ============================================================================
// 运行时约束：独立 node ESM，不依赖 ts-node / 任何 npm 包——hook 进程由宿主 IDE
// 直接以 `node xxx.mjs` 拉起，必须零依赖可跑。
//
// 策略 SSOT：specs/runtime-artifact-policy.json（与 canonical-gitignore.ts 共读；
// 勿在本文件另立运行时写放行清单）。
//
// 放行通道（plan a6c4e9f2 D5）：**没有**。`integrity.drift_allowlist` /
// `allow_local_drift` 的解锁语义已随 runtime hash 家族一并退役——同一可写主体既能改
// framework 也能改审批文件，"具名审批"在这种环境里不是边界。存量字段读取即忽略。
//
// 诚实边界（plan 钉死）：只拦编辑类工具的路径；Bash 重定向/node -e 写文件不在射程；
// 判定异常一律 fail-open。它是**合作型**防误操作，不是安全边界——真正的隔离由
// task sandbox / 只读挂载 / 受限 OS token 在执行环境侧提供。无法强隔离时，shell 重定向、
// 脚本、node -e 与场外进程是明确盲区；没有 Git/hash 查时 detector 兜底。

import * as fs from 'fs';
import * as path from 'path';

// --------------------------------------------------------------------------
// 策略加载（SSOT）
// --------------------------------------------------------------------------

/** @typedef {{ignored_runtime_patterns: string[], shipped_files_in_runtime_dirs: string[], generated_file_patterns: string[], reserved_metadata_files: string[]}} RuntimeArtifactPolicy */

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
      // 旧发布件无此键 → []（不炸；届时行为回落为整目录忽略的历史语义）
      shipped_files_in_runtime_dirs: arr(doc.shipped_files_in_runtime_dirs),
      generated_file_patterns: arr(doc.generated_file_patterns),
      reserved_metadata_files: arr(doc.reserved_metadata_files),
    };
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------
// glob-lite 匹配（语义与 policy JSON 头部注释、canonical-gitignore 一致）
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
 * rel 是否属于**写时放行**的运行时产物（第七轮 codex P1-1：与扫描谓词拆开）——
 * reserved_metadata_files（RELEASE-MANIFEST.sha256 等完整性锚点）由 pack 产出、agent
 * 绝不该手写，写时必须 deny；只有 harness 运行时目录与按需生成文件（金丝雀）可写。
 * @param {string} rel @param {RuntimeArtifactPolicy} policy @returns {boolean}
 */
export function isWriteAllowedPath(rel, policy) {
  // e5d8a2c4 T4#1：ignored 目录内的**发布件**先行 deny——它们随 pack 产出、由
  // RELEASE-MANIFEST 逐字节校验，是发布件不是运行时产物。此前它们被目录级
  // ignored_runtime_patterns 顺带放行，等于 agent 可随意覆写 trace.schema.json。
  const normalized = String(rel).replace(/\\/g, '/');
  if (policy.shipped_files_in_runtime_dirs.includes(normalized)) return false;
  const writable = [...policy.ignored_runtime_patterns, ...policy.generated_file_patterns];
  return writable.some((p) => matchesPolicyPattern(rel, p));
}

// --------------------------------------------------------------------------
// 放行通道已退场（plan a6c4e9f2 D5 / T6）
// --------------------------------------------------------------------------
// `integrity.drift_allowlist` 与 `integrity.allow_local_drift` 的解锁语义已删除：
// 写权限来自**执行环境授予的安全主体**，不来自被检查方自己可编辑的一个文件。
// 同一可写主体既能改 framework、也能改 allowlist——"具名审批"在这种环境里不构成边界，
// 只会让越权写看起来被批准过。存量字段读取即忽略，deny 文案里点名它已失效。

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
 *   - 其余 → deny + 教育文案（**没有** allowlist 解锁通道）。
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

    return { decision: 'deny', reason: denyText(`framework/${rel}`) };
  } catch {
    return { decision: 'allow' }; // 任何判定异常 fail-open；无查时扫描兜底
  }
}

/** @param {string} target @returns {string} */
function denyText(target) {
  return [
    `[framework 写保护] 已阻止写入 ${target}。`,
    'framework/ 是 Maison 发布件控制面（consumer-framework-boundary.md）：',
    '  - 临时诊断脚本请放 <repo-root>/scratch/（gitignored）或系统临时目录，不要写进 framework/；',
    '  - 升级分两步：①用户/CI 的 updater 或集成操作镜像覆盖已验证发布件；',
    '    ②随后运行 /framework-init UPDATE，刷新宿主 config/adapter 物化产物并执行全局 phase；',
    '  - 没有放行通道：integrity.drift_allowlist / allow_local_drift 已退役，写入这里不再有"具名审批"可用',
    '    （同一主体既能改 framework 也能改审批文件，那不是边界）。真正的隔离来自 task sandbox /',
    '    只读挂载 / 受限 OS token——请在执行环境侧配置，而不是在被检查方的配置里开口子。',
    '  - 当前守卫不覆盖 shell 重定向、脚本、node -e 或场外进程，也没有事后 Git/hash detector 兜底。',
    '发现框架自身问题请 halt 上报，回灌 agent-maison 源仓修复后重新发布，不要就地修改。',
  ].join('\n');
}
