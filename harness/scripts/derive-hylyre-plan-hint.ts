#!/usr/bin/env npx ts-node
/**
 * 从 doc/features/<feature>/testing/test-plan.md（兼容旧扁平路径）抽取用例行，默认将 JSON
 * 写到 testing reports 的 derive-hint-from-plan.json 并输出 stdout，再据此生成 test-plan.hylyre.md。
 *
 * 用法（在实例仓库根目录）：
 *   cd framework/harness && npx ts-node scripts/derive-hylyre-plan-hint.ts --feature home-page
 *   cd framework/harness && npx ts-node scripts/derive-hylyre-plan-hint.ts --feature home-page --out ../../doc/features/home-page/testing/reports/hint.json
 */
import * as fs from 'fs';
import * as path from 'path';
import minimist from 'minimist';
import { buildCanonicalDeriveHintPayload, writeCanonicalDeriveHint } from './utils/test-plan-derive-hint';
import { resolveFeatureArtifact, featurePhaseReportsDir } from '../config';

const argv = minimist(process.argv.slice(2), {
  string: ['feature', 'f', 'project-root', 'p', 'out', 'o'],
});

function defaultProjectRoot(): string {
  const cwd = process.cwd();
  if (path.basename(cwd) === 'harness' && path.basename(path.dirname(cwd)) === 'framework') {
    return path.resolve(cwd, '..', '..');
  }
  return cwd;
}

const projectRoot = path.resolve(argv['project-root'] || argv.p || defaultProjectRoot());
const feature = (argv.feature || argv.f || '').trim();
const outPath = (argv.out || argv.o || '').trim();

if (!feature) {
  console.error('用法: npx ts-node scripts/derive-hylyre-plan-hint.ts --feature <name> [--project-root <dir>] [--out <file.json>]');
  process.exit(2);
}

const planResolved = resolveFeatureArtifact(projectRoot, feature, 'test-plan.md');
if (!planResolved.exists) {
  console.error(
    JSON.stringify(
      { error: 'test_plan_not_found', path: planResolved.canonicalPath, legacy: planResolved.legacyPath },
      null,
      2,
    ),
  );
  process.exit(1);
}

const payload = buildCanonicalDeriveHintPayload(projectRoot, feature);
const canonical = path.join(featurePhaseReportsDir(projectRoot, feature, 'testing'), 'derive-hint-from-plan.json');
const target = path.resolve(outPath || canonical);
const pathKey = (file: string): string => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
if (pathKey(target) === pathKey(canonical)) {
  const result = writeCanonicalDeriveHint(target, payload);
  console.error(`${result.updated ? '已更新基线' : '基线语义未变'}：${target}`);
  process.stdout.write(`${JSON.stringify(result.payload, null, 2)}\n`);
} else {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.error(`已导出当前完整上下文（canonical 基线不变）：${target}`);
}
