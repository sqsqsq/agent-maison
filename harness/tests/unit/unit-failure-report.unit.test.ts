import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeUnitFailureReport } from '../utils/unit-failure-report';
import type { UnitCaseResult } from '../run-unit';

function withTempReport(run: (reportPath: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-unit-failures-'));
  try {
    run(path.join(root, 'reports', 'unit-failures.json'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: '失败报告只落失败 suite/case/error，供截断输出后定位 flaky',
    run: () => withTempReport(reportPath => {
      const result = writeUnitFailureReport([
        { id: 'stable', results: [{ name: 'ok', ok: true }] },
        { id: 'flaky-suite', results: [
          { name: 'sometimes red', ok: false, error: 'expected 1, got 0' },
          { name: 'also ok', ok: true },
        ] },
      ], reportPath);
      if (result.failureCount !== 1 || !fs.existsSync(reportPath)) {
        throw new Error(`失败报告未落盘：${JSON.stringify(result)}`);
      }
      const doc = JSON.parse(fs.readFileSync(reportPath, 'utf-8')) as {
        failure_count?: number;
        failures?: Array<{ suite?: string; case?: string; error?: string }>;
      };
      const failure = doc.failures?.[0];
      if (doc.failure_count !== 1 || failure?.suite !== 'flaky-suite'
        || failure.case !== 'sometimes red' || failure.error !== 'expected 1, got 0') {
        throw new Error(`失败报告内容不完整：${JSON.stringify(doc)}`);
      }
    }),
  },
  {
    name: '全绿删除旧失败报告，避免陈旧红例误导',
    run: () => withTempReport(reportPath => {
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, '{"stale":true}\n', 'utf-8');
      const result = writeUnitFailureReport([{ id: 'stable', results: [{ name: 'ok', ok: true }] }], reportPath);
      if (result.failureCount !== 0 || fs.existsSync(reportPath)) {
        throw new Error(`全绿后应清理旧报告：${JSON.stringify(result)}`);
      }
    }),
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(testCase => {
    try {
      testCase.run();
      return { name: testCase.name, ok: true };
    } catch (error) {
      return { name: testCase.name, ok: false, error: (error as Error).stack ?? String(error) };
    }
  });
}
