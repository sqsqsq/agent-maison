/**
 * hypium 默认在进程 cwd 下创建 `./tmp_hypium`（UI 树、截图等）。
 * 将 Hylyre/hypium 子进程的 cwd 定向到 testing reports 下的 `.hypium-workdir`，
 * 避免污染工程根目录；并清理历史遗留的 `<projectRoot>/tmp_hypium`。
 */
import * as fs from 'fs';
import * as path from 'path';

/** 与 hypium `get_tmp_dir()` 相对 cwd 的子目录名一致；实际落盘为 `<workDir>/tmp_hypium/` */
export const HYPIUM_TMP_DIR_NAME = 'tmp_hypium';

/** 置于 `doc/features/<feature>/testing/reports/.hypium-workdir`（reports 已在 .gitignore） */
export const HYPIUM_WORKDIR_BASENAME = '.hypium-workdir';

export function resolveHypiumWorkDir(reportsBase: string): string {
  return path.join(reportsBase, HYPIUM_WORKDIR_BASENAME);
}

export function ensureHypiumWorkDir(reportsBase: string): string {
  const workDir = resolveHypiumWorkDir(reportsBase);
  fs.mkdirSync(workDir, { recursive: true });
  return workDir;
}

export function legacyHypiumTmpAtProjectRoot(projectRoot: string): string {
  return path.join(projectRoot, HYPIUM_TMP_DIR_NAME);
}

/**
 * 删除工程根下旧版 harness 遗留的 `tmp_hypium/`（best-effort，失败不抛）。
 */
export function removeLegacyHypiumTmpAtProjectRoot(
  projectRoot: string,
): { attempted: boolean; removed: boolean; legacyPath: string; error?: string } {
  const legacyPath = legacyHypiumTmpAtProjectRoot(projectRoot);
  if (!fs.existsSync(legacyPath)) {
    return { attempted: false, removed: false, legacyPath };
  }
  try {
    fs.rmSync(legacyPath, { recursive: true, force: true });
    return { attempted: true, removed: true, legacyPath };
  } catch (e) {
    return {
      attempted: true,
      removed: false,
      legacyPath,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
