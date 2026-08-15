import * as fs from 'fs';
import * as path from 'path';

export interface UnitResultLike {
  name: string;
  ok: boolean;
  error?: string;
}

export interface UnitSuiteSummaryLike {
  id: string;
  results: UnitResultLike[];
}

export interface UnitFailureReportResult {
  path: string;
  failureCount: number;
}

export function defaultUnitFailureReportPath(): string {
  const override = process.env.MAISON_UNIT_FAILURE_REPORT?.trim();
  return override
    ? path.resolve(override)
    : path.resolve(__dirname, '..', '..', 'reports', 'unit-failures.json');
}

/**
 * 把全量 runner 的失败 case 写成一个短小、稳定的尾部取证点。
 * 全绿时删除旧报告，避免上一次红例冒充当前结果。
 */
export function writeUnitFailureReport(
  summaries: UnitSuiteSummaryLike[],
  reportPath: string = defaultUnitFailureReportPath(),
): UnitFailureReportResult {
  const failures = summaries.flatMap(summary =>
    summary.results
      .filter(result => !result.ok)
      .map(result => ({
        suite: summary.id,
        case: result.name,
        ...(result.error ? { error: result.error } : {}),
      })),
  );

  if (failures.length === 0) {
    fs.rmSync(reportPath, { force: true });
    return { path: reportPath, failureCount: 0 };
  }

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const tempPath = `${reportPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify({
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    failure_count: failures.length,
    failures,
  }, null, 2) + '\n', 'utf-8');
  // Windows rename 不覆盖既有目标；先清旧报告，再原子换入本轮结果。
  fs.rmSync(reportPath, { force: true });
  fs.renameSync(tempPath, reportPath);
  return { path: reportPath, failureCount: failures.length };
}
