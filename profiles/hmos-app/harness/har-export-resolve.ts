// ============================================================================
// HAR 导出入口路径解析（hmos-app / Harmony HAR）
// ============================================================================
// 由 check-coding.ts 的 har_index_export 规则按 profile 动态加载。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

function readFileIfExists(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8');
}

function parseJson5(content: string): unknown {
  let stripped = content.replace(/^\s*\/\/.*$/gm, '');
  stripped = stripped.replace(/([^"':])\s*\/\/.*$/gm, '$1');
  stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, '');
  stripped = stripped.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(stripped);
}

export function normalizeRelativePath(relPath: string): string {
  return relPath
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

export interface HarExportEntryResolution {
  relPath: string;
  source: 'oh-package.json5 main' | 'framework.config fallback';
  warning?: string;
  error?: string;
}

export function resolveHarExportEntryPath(
  projectRoot: string,
  mod: Pick<{ name: string; package_path: string }, 'name' | 'package_path'>,
  indexFileName: string,
): HarExportEntryResolution {
  const packagePath = normalizeRelativePath(mod.package_path);
  const ohPackagePath = path.join(projectRoot, packagePath, 'oh-package.json5');
  const ohPackageContent = readFileIfExists(ohPackagePath);

  if (ohPackageContent) {
    try {
      const ohPkg = parseJson5(ohPackageContent) as Record<string, unknown>;
      const main = typeof ohPkg.main === 'string' ? ohPkg.main.trim() : '';
      if (main) {
        const normalizedMain = normalizeRelativePath(main);
        if (path.posix.basename(normalizedMain) !== indexFileName) {
          return {
            relPath: `${packagePath}/${normalizedMain}`,
            source: 'oh-package.json5 main',
            error: `${mod.name}: oh-package.json5 main 指向 ${normalizedMain}，但架构约定 HAR 导出入口文件名必须是 ${indexFileName}`,
          };
        }
        return {
          relPath: `${packagePath}/${normalizedMain}`,
          source: 'oh-package.json5 main',
        };
      }
    } catch {
      return {
        relPath: `${packagePath}/src/main/ets/${indexFileName}`,
        source: 'framework.config fallback',
        warning: `${mod.name}: oh-package.json5 解析失败，已回退到默认出口路径`,
      };
    }
  }

  return {
    relPath: `${packagePath}/src/main/ets/${indexFileName}`,
    source: 'framework.config fallback',
  };
}
