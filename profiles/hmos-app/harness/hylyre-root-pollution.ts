/**
 * 宿主工程根 Hylyre/Hypium 误落盘检测（`reports/`、`tmp_hypium/`）。
 * 段首先清理 tmp_hypium 再快照，避免「清理前后 exists 均为 true」漏报。
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  HYPIUM_TMP_DIR_NAME,
  legacyHypiumTmpAtProjectRoot,
  removeLegacyHypiumTmpAtProjectRoot,
} from './device-test-hypium-workdir';

export const ROOT_HYLYRE_POLLUTION_ANCHOR = 'ROOT_HYLYRE_POLLUTION=1';

export const ROOT_REPORTS_DIR_NAME = 'reports';

export interface RootPathSnapshot {
  exists: boolean;
  mtimeMs: number | null;
  entryCount: number | null;
}

export interface RootHylyrePollutionSnapshot {
  tmp_hypium: RootPathSnapshot;
  reports: RootPathSnapshot;
}

export interface RootPollutionDiff {
  tmp_hypium_new: boolean;
  reports_new: boolean;
  reports_changed: boolean;
}

export interface RootPollutionMeta {
  tmp_hypium: boolean;
  reports: boolean;
  reports_changed?: boolean;
  detected_at: string;
  phase: 'ensure' | 'run';
}

export function legacyReportsAtProjectRoot(projectRoot: string): string {
  return path.join(projectRoot, ROOT_REPORTS_DIR_NAME);
}

function snapshotOnePath(absPath: string): RootPathSnapshot {
  if (!fs.existsSync(absPath)) {
    return { exists: false, mtimeMs: null, entryCount: null };
  }
  try {
    const st = fs.statSync(absPath);
    let entryCount: number | null = null;
    if (st.isDirectory()) {
      try {
        entryCount = fs.readdirSync(absPath).length;
      } catch {
        entryCount = null;
      }
    }
    return { exists: true, mtimeMs: st.mtimeMs, entryCount };
  } catch {
    return { exists: false, mtimeMs: null, entryCount: null };
  }
}

export function snapshotRootHylyrePaths(projectRoot: string): RootHylyrePollutionSnapshot {
  return {
    tmp_hypium: snapshotOnePath(legacyHypiumTmpAtProjectRoot(projectRoot)),
    reports: snapshotOnePath(legacyReportsAtProjectRoot(projectRoot)),
  };
}

export function diffRootHylyrePollution(
  before: RootHylyrePollutionSnapshot,
  after: RootHylyrePollutionSnapshot,
): RootPollutionDiff {
  const tmp_hypium_new = after.tmp_hypium.exists && !before.tmp_hypium.exists;
  const reports_new = after.reports.exists && !before.reports.exists;
  let reports_changed = false;
  if (before.reports.exists && after.reports.exists) {
    const mtimeDiff =
      before.reports.mtimeMs !== null &&
      after.reports.mtimeMs !== null &&
      before.reports.mtimeMs !== after.reports.mtimeMs;
    const countDiff =
      before.reports.entryCount !== null &&
      after.reports.entryCount !== null &&
      before.reports.entryCount !== after.reports.entryCount;
    reports_changed = mtimeDiff || countDiff;
  }
  return { tmp_hypium_new, reports_new, reports_changed };
}

export function rootPollutionDetected(diff: RootPollutionDiff): boolean {
  return diff.tmp_hypium_new || diff.reports_new || diff.reports_changed;
}

/** 段首：清理工程根 tmp_hypium 后采 before 快照。 */
export function beginHylyrePhasePollutionGuard(projectRoot: string): RootHylyrePollutionSnapshot {
  removeLegacyHypiumTmpAtProjectRoot(projectRoot);
  return snapshotRootHylyrePaths(projectRoot);
}

export function emitRootHylyrePollutionAlerts(args: {
  diff: RootPollutionDiff;
  phase: 'ensure' | 'run';
  logPath?: string;
}): void {
  const lines = [
    `${ROOT_HYLYRE_POLLUTION_ANCHOR}`,
    `[warn] 宿主工程根检测到 Hylyre/Hypium 误落盘（phase=${args.phase}）`,
    `  tmp_hypium_new=${args.diff.tmp_hypium_new} reports_new=${args.diff.reports_new} reports_changed=${args.diff.reports_changed}`,
    `  预期 cwd 为 feature testing reports/.hypium-workdir，勿在工程根执行 python -m hylyre。\n`,
  ];
  for (const line of lines) {
    process.stderr.write(`${line}\n`);
  }
  if (args.logPath) {
    try {
      fs.appendFileSync(args.logPath, lines.join('\n') + '\n', 'utf-8');
    } catch {
      /* best-effort */
    }
  }
}

/** 段尾：对比快照；若污染则 stderr/log 锚点并返回 meta 字段。 */
export function finishHylyrePhasePollutionGuard(
  projectRoot: string,
  before: RootHylyrePollutionSnapshot,
  opts: { phase: 'ensure' | 'run'; logPath?: string },
): RootPollutionMeta | null {
  const after = snapshotRootHylyrePaths(projectRoot);
  const diff = diffRootHylyrePollution(before, after);
  if (!rootPollutionDetected(diff)) {
    removeLegacyHypiumTmpAtProjectRoot(projectRoot);
    return null;
  }
  emitRootHylyrePollutionAlerts({ diff, phase: opts.phase, logPath: opts.logPath });
  removeLegacyHypiumTmpAtProjectRoot(projectRoot);
  return {
    tmp_hypium: diff.tmp_hypium_new,
    reports: diff.reports_new || diff.reports_changed,
    ...(diff.reports_changed ? { reports_changed: true } : {}),
    detected_at: new Date().toISOString(),
    phase: opts.phase,
  };
}
