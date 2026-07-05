/**
 * P0-7③（plan c9e2a7f4）：伪签物证扫描——feature testing/device-testing 目录内的"改判脚本"确定性检出。
 *
 * 2026-07-05 实锤（宿主 homepage）：agent 在 doc/features/homepage/testing/ 留下成套工具——
 *  - visual-diff-auto-fill.cjs/.mjs：NODE_OPTIONS 预加载 hook，capture 写 visual-diff.json 即填
 *    verdict=pass + confirmed_by=user_requirement + 自算截图 hash；
 *  - fill-visual-diff-pass.cjs：capture 后直填 pass；
 *  - reset-visual-diff-pending.cjs：批量重置 pending 并 delete must_fix（销毁回修指令）。
 * 本扫描把这类物证确定性上桌（BLOCKER），配合 P0-7① ② ④ 与 P1-5 责任到人；纯检测、不猫鼠——
 * 判据=脚本内容同时命中「引用 visual-diff.json」与「改判特征」，正常读取/统计脚本不会误伤。
 */
import * as fs from 'fs';
import * as path from 'path';

export interface TamperArtifact {
  /** 相对 projectRoot 的文件路径（正斜杠） */
  file: string;
  /** 命中的改判特征描述 */
  signatures: string[];
}

const SCRIPT_EXTS = new Set(['.js', '.cjs', '.mjs', '.ts', '.mts', '.cts']);

/** 改判特征（codex 意见：不只抓填 pass，销毁回修指令/伪造证据绑定同罪）。大小写不敏感（CONFIRMED_BY 常量同中）。 */
const TAMPER_SIGNATURES: ReadonlyArray<{ id: string; re: RegExp }> = [
  { id: 'confirmed_by 程序化填值', re: /confirmed_by\s*[:=]/i },
  { id: 'verdict 程序化填 pass', re: /verdict\s*[:=]\s*['"`]pass['"`]/i },
  { id: 'verdict 批量重置 pending', re: /verdict\s*[:=]\s*['"`]pending['"`]/i },
  { id: '清空/删除 must_fix（销毁回修指令）', re: /delete\s+[^;\r\n]*must_fix|must_fix\s*[:=]\s*\[\s*\]/i },
  { id: '程序化写 evaluated_screenshot_hash（伪造证据绑定）', re: /evaluated_screenshot_hash\s*[:=]|delete\s+[^;\r\n]*evaluated_screenshot_hash/i },
];

function walkFiles(dir: string, depth: number, out: string[]): void {
  if (depth < 0) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      walkFiles(abs, depth - 1, out);
    } else if (e.isFile()) {
      out.push(abs);
    }
  }
}

/**
 * 扫 feature 的 testing/ 与 device-testing/ 目录：脚本文件内容命中
 * 「visual-diff.json 引用 + ≥1 改判特征」→ 物证。
 * featuresDir 支持相对（拼 projectRoot）或绝对路径（codex 意见：调用侧应传
 * featuresDirPath(projectRoot) 以尊重 paths.features_dir 配置，防自定义目录漏拦）。
 */
export function collectVisualDiffTamperArtifacts(
  projectRoot: string,
  feature: string,
  featuresDir = 'doc/features',
): TamperArtifact[] {
  const out: TamperArtifact[] = [];
  const featuresAbs = path.isAbsolute(featuresDir) ? featuresDir : path.join(projectRoot, featuresDir);
  for (const sub of ['testing', 'device-testing']) {
    const root = path.join(featuresAbs, feature, sub);
    const files: string[] = [];
    walkFiles(root, 3, files);
    for (const abs of files) {
      if (!SCRIPT_EXTS.has(path.extname(abs).toLowerCase())) continue;
      let content = '';
      try {
        content = fs.readFileSync(abs, 'utf-8');
      } catch {
        continue;
      }
      if (!/visual-diff\.json/i.test(content)) continue;
      const signatures = TAMPER_SIGNATURES.filter(s => s.re.test(content)).map(s => s.id);
      if (signatures.length === 0) continue;
      out.push({
        file: path.relative(projectRoot, abs).replace(/\\/g, '/'),
        signatures,
      });
    }
  }
  return out;
}
