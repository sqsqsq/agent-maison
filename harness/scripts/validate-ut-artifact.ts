#!/usr/bin/env node
/**
 * UT 产物格式预校验 CLI（不写 harness 全量 check）。
 *
 * 用法：
 *   npx ts-node harness/scripts/validate-ut-artifact.ts --type testability-audit --file <path>
 *   npx ts-node harness/scripts/validate-ut-artifact.ts --type mock-plan --file <path> [--project-root <dir>]
 *
 * --file 可为相对工程根的路径（如 doc/features/<feature>/ut/mock-plan.yaml）；
 * 在 framework/harness 下执行时，未命中 cwd 会自动相对 project root 解析。
 */
import minimist from 'minimist';
import {
  resolveUtArtifactFilePath,
  validateCoverageEvidenceFile,
  validateMockPlanFile,
  validateTestabilityAuditFile,
  type ArtifactValidationResult,
} from './utils/ut-artifact-validate';

function main(): void {
  const argv = minimist(process.argv.slice(2), {
    string: ['type', 'file', 'project-root', 'projectRoot', 't', 'f'],
    alias: { t: 'type', f: 'file', 'project-root': 'projectRoot' },
  });
  const type = (argv.type ?? argv.t ?? '').trim();
  const fileArg = (argv.file ?? argv.f ?? '').trim();
  const projectRoot = (argv['project-root'] ?? argv.projectRoot ?? '').trim() || undefined;

  if (!type || !fileArg) {
    console.error(
      '用法: validate-ut-artifact.ts --type testability-audit|mock-plan|coverage-evidence --file <path> [--project-root <dir>]',
    );
    process.exit(2);
  }

  const file = resolveUtArtifactFilePath(fileArg, projectRoot);

  let result: ArtifactValidationResult;
  if (type === 'testability-audit') {
    result = validateTestabilityAuditFile(file);
  } else if (type === 'mock-plan') {
    result = validateMockPlanFile(file);
  } else if (type === 'coverage-evidence') {
    result = validateCoverageEvidenceFile(file);
  } else {
    console.error(JSON.stringify({ ok: false, errors: [{ field: 'type', message: `未知 type: ${type}` }], warnings: [] }));
    process.exit(2);
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main();
