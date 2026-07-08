#!/usr/bin/env node
// init-readiness.mjs — Tier_1 harness 依赖就绪探测（Node-only，不写盘）
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_HARNESS_ROOT = path.resolve(__dirname, '..');
const RECOMMENDED_COMMAND = 'cd framework/harness && npm install';
const RECOMMENDED_EXECUTABLE = 'npm';
const RECOMMENDED_ARGS = ['install'];
/** E5 未初始化/解析失败时的默认回落 profile——与 config.ts 的 fallback 一致。 */
const DEFAULT_PROFILE_FALLBACK = 'hmos-app';

/**
 * E5（多模态降级阶梯 plan d4a8f3c6）：复刻 repo-layout.ts 的 standalone/consumer 判据
 * （纯 fs+path，不 import TS 模块——Tier_1 在 ts-node 就绪确认之前跑，不能依赖它）。
 * codex review（2026-07-08）：与 repo-layout.ts 的 detectRepoLayout 同步修正——不能只检查
 * grandparent/framework/skills「某处是否存在」（无关 sibling 同名目录会误判），须先确认
 * harnessRoot 自身的 parent 目录名即为 'framework'（consumer 布局下恒成立）。
 * @param {string} harnessRoot
 * @returns {string} projectRoot
 */
function detectProjectRootFromHarnessRoot(harnessRoot) {
  const parent = path.resolve(harnessRoot, '..');
  const grandparent = path.resolve(harnessRoot, '../..');
  if (path.basename(parent) === 'framework' && fs.existsSync(path.join(parent, 'skills'))) {
    return grandparent; // consumer：<projectRoot>/framework/harness
  }
  return parent; // standalone：<projectRoot>/harness
}

/**
 * 读取 <projectRoot>/framework.config.json 的 project_profile.name（纯 JSON.parse，
 * 未初始化/格式有误一律回落默认 profile——不阻断 Tier_1，那是后续 gate 的职责）。
 * @param {string} projectRoot
 * @returns {string}
 */
function detectActiveProfileName(projectRoot) {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'framework.config.json'), 'utf-8'),
    );
    const name = raw && raw.project_profile && raw.project_profile.name;
    return typeof name === 'string' && name.trim() ? name.trim() : DEFAULT_PROFILE_FALLBACK;
  } catch {
    return DEFAULT_PROFILE_FALLBACK;
  }
}

/**
 * active profile 是否具备 OCR 工具链（存在性判据，非硬编码 'hmos-app'——其余 profile
 * 若未来也带 ocr-toolkit 同样会被条件化纳入）。
 * @param {string} frameworkRoot
 * @param {string} profileName
 * @returns {boolean}
 */
function activeProfileHasOcrToolkit(frameworkRoot, profileName) {
  const base = path.join(frameworkRoot, 'profiles', profileName, 'harness', 'ocr-toolkit');
  return fs.existsSync(`${base}.ts`) || fs.existsSync(`${base}.js`);
}

/**
 * @param {string} harnessRoot absolute path to framework/harness
 * @param {string} [cwd] process cwd to validate (default harnessRoot)
 */
export function checkInitReadiness(harnessRoot, cwd = harnessRoot) {
  const frameworkRoot = path.resolve(harnessRoot, '..');
  const checks = [
    {
      label: 'framework/harness/package.json',
      file: path.join(harnessRoot, 'package.json'),
    },
    {
      label: 'framework/harness/node_modules/ts-node/package.json',
      file: path.join(harnessRoot, 'node_modules', 'ts-node', 'package.json'),
    },
    {
      label: 'framework/harness/node_modules/@types/node/package.json',
      file: path.join(harnessRoot, 'node_modules', '@types', 'node', 'package.json'),
    },
  ];

  // E5：active profile 具备 OCR 工具链时才条件化检查（非案B主因——OCR 环境实际正常，
  // 但内网 npm 局部失败会漏到门禁运行时才炸；此处让 Tier_1 提前发现）。
  const projectRoot = detectProjectRootFromHarnessRoot(harnessRoot);
  const activeProfile = detectActiveProfileName(projectRoot);
  if (activeProfileHasOcrToolkit(frameworkRoot, activeProfile)) {
    checks.push(
      {
        label:
          'framework/harness/node_modules/tesseract.js/package.json' +
          '（OCR 依赖缺失：cd framework/harness && npm install）',
        file: path.join(harnessRoot, 'node_modules', 'tesseract.js', 'package.json'),
      },
      {
        label:
          `framework/profiles/${activeProfile}/vendor/tessdata/chi_sim.traineddata` +
          '（tessdata 属 framework 发布件内容，非 npm 包——缺失=分发不完整，非漏装；' +
          '请重新拉取/更新 framework 子模块，而非 npm install）',
        file: path.join(frameworkRoot, 'profiles', activeProfile, 'vendor', 'tessdata', 'chi_sim.traineddata'),
      },
    );
  }

  /** @type {string[]} */
  const missing = [];
  for (const check of checks) {
    if (!fs.existsSync(check.file)) {
      missing.push(check.label);
    }
  }
  const normalizedCwd = path.resolve(cwd);
  const normalizedHarness = path.resolve(harnessRoot);
  if (normalizedCwd !== normalizedHarness) {
    missing.push(`cwd must be framework/harness (current: ${cwd})`);
  }
  return {
    ok: missing.length === 0,
    missing,
    recommended_command: RECOMMENDED_COMMAND,
    recommended_cwd: harnessRoot,
    recommended_executable: RECOMMENDED_EXECUTABLE,
    recommended_args: RECOMMENDED_ARGS,
    harness_root: harnessRoot,
  };
}

/** CLI 默认：脚本所在 harness 根 + process.cwd() */
export function runReadiness() {
  return checkInitReadiness(DEFAULT_HARNESS_ROOT, process.cwd());
}

export {
  DEFAULT_HARNESS_ROOT as HARNESS_ROOT,
  RECOMMENDED_COMMAND,
  RECOMMENDED_EXECUTABLE,
  RECOMMENDED_ARGS,
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = runReadiness();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 1);
}
