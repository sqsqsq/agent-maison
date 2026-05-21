// ============================================================================
// run-unit.ts — Framework Harness 单元测试 runner
// ============================================================================
//
// 与 run-tests.ts 的区别：
//   - run-tests.ts：扫 fixtures/，对 framework checker 跑端到端断言
//   - run-unit.ts ：直接 import 工具函数（hdc-runner / spec-loader 等的纯函数），
//                   做白盒级断言，DevEco / hypium 升级时第一时间挂出来
//
// 用法（在仓库根）：
//   npx ts-node framework/harness/tests/run-unit.ts
//   npx ts-node framework/harness/tests/run-unit.ts --filter parseHypium
//
// 退出码：0 全部通过；1 至少一个用例失败。
// ============================================================================

import * as path from 'path';
import * as fs from 'fs';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function discoverProfileUnitSuites(): Array<{ id: string; modulePath: string }> {
  const profilesRoot = path.resolve(__dirname, '..', '..', 'profiles');
  const out: Array<{ id: string; modulePath: string }> = [];
  if (!fs.existsSync(profilesRoot)) return out;
  for (const ent of fs.readdirSync(profilesRoot, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const unitDir = path.join(profilesRoot, ent.name, 'harness', 'tests', 'unit');
    if (!fs.existsSync(unitDir)) continue;
    for (const fn of fs.readdirSync(unitDir)) {
      if (!fn.endsWith('.unit.test.ts')) continue;
      const absNoExt = path.join(unitDir, fn.replace(/\.ts$/, ''));
      const rel = path.relative(__dirname, absNoExt).replace(/\\/g, '/');
      out.push({
        id: `profile:${ent.name}:${fn.replace(/\.unit\.test\.ts$/, '')}`,
        modulePath: rel.startsWith('.') ? rel : `./${rel}`,
      });
    }
  }
  return out;
}

const CORE_SUITES: Array<{ id: string; modulePath: string }> = [
  { id: 'doc-freshness',    modulePath: './unit/doc-freshness.unit.test' },
  { id: 'diff-staleness',   modulePath: './unit/diff-staleness.unit.test' },
  { id: 'feature-artifacts', modulePath: './unit/feature-artifacts.unit.test' },
  { id: 'init-eol',         modulePath: './unit/init-eol.unit.test' },
  { id: 'canonical-gitignore', modulePath: './unit/canonical-gitignore.unit.test' },
  { id: 'init-update-policy', modulePath: './unit/init-update-policy.unit.test' },
  { id: 'hook-stale-state', modulePath: './unit/hook-stale-state.unit.test' },
  { id: 'profile-routing',  modulePath: './unit/profile-routing.unit.test' },
  { id: 'review-context',   modulePath: './unit/review-context.unit.test' },
  { id: 'summary-schema',   modulePath: './unit/summary-schema.unit.test' },
  { id: 'ut-artifact-parse', modulePath: './unit/ut-artifact-parse.unit.test' },
  { id: 'visual-handoff',   modulePath: './unit/visual-handoff.unit.test' },
  { id: 'profile-decoupling', modulePath: './unit/profile-decoupling.unit.test' },
  { id: 'profile-skill-assets', modulePath: './unit/profile-skill-assets.unit.test' },
  { id: 'ut-business-src-scope', modulePath: './unit/ut-business-src-scope.unit.test' },
  { id: 'coding-failure-kinds', modulePath: './unit/coding-failure-kinds.unit.test' },
  { id: 'root-zero-host-name', modulePath: './unit/root-zero-host-name.unit.test' },
  { id: 'generic-coding-host', modulePath: './unit/generic-coding-host.unit.test' },
  { id: 'workflow-loader', modulePath: './unit/workflow-loader.unit.test' },
  { id: 'compat-loader', modulePath: './unit/compat-loader.unit.test' },
  { id: 'extension-loader', modulePath: './unit/extension-loader.unit.test' },
  { id: 'hooks-dispatcher', modulePath: './unit/hooks-dispatcher.unit.test' },
  { id: 'adapter-bridge', modulePath: './unit/adapter-bridge.unit.test' },
  { id: 'generic-bundle', modulePath: './unit/generic-bundle.unit.test' },
  { id: 'config-field-merger', modulePath: './unit/config-field-merger.unit.test' },
  { id: 'derived-hylyre-plan', modulePath: './unit/derived-hylyre-plan.unit.test' },
  { id: 'adhoc-nl-split', modulePath: './unit/adhoc-nl-split.unit.test' },
  { id: 'adhoc-derive-helpers', modulePath: './unit/adhoc-derive-helpers.unit.test' },
  { id: 'hylyre-steps-normalize', modulePath: './unit/hylyre-steps-normalize.unit.test' },
  { id: 'adhoc-summarize-dump', modulePath: './unit/adhoc-summarize-dump.unit.test' },
  { id: 'adhoc-input-path', modulePath: './unit/adhoc-input-path.unit.test' },
  { id: 'hylyre-planned-step-lint', modulePath: './unit/hylyre-planned-step-lint.unit.test' },
  { id: 'adhoc-trace-placeholder', modulePath: './unit/adhoc-trace-placeholder.unit.test' },
  { id: 'confirmation-ux', modulePath: './unit/confirmation-ux.unit.test' },
];

const SUITES: Array<{ id: string; modulePath: string }> = [...CORE_SUITES, ...discoverProfileUnitSuites()];
interface SuiteSummary {
  id: string;
  results: UnitCaseResult[];
}

async function main(): Promise<void> {
  const filterIdx = process.argv.indexOf('--filter');
  const filter = filterIdx >= 0 ? process.argv[filterIdx + 1] : undefined;

  console.log('\nFramework Harness Unit Tests\n');
  console.log('='.repeat(72));

  const summaries: SuiteSummary[] = [];

  for (const suite of SUITES) {
    const fullPath = path.resolve(__dirname, suite.modulePath + '.ts');
    if (!fs.existsSync(fullPath)) {
      console.log(`  [SKIP] suite ${suite.id} 不存在：${fullPath}`);
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(suite.modulePath) as { runAll: () => UnitCaseResult[] | Promise<UnitCaseResult[]> };
    if (typeof mod.runAll !== 'function') {
      console.log(`  [FAIL] suite ${suite.id} 未导出 runAll()`);
      summaries.push({ id: suite.id, results: [{ name: '<suite-load>', ok: false, error: '未导出 runAll()' }] });
      continue;
    }
    const all = await mod.runAll();
    const filtered = filter ? all.filter(r => r.name.includes(filter)) : all;
    summaries.push({ id: suite.id, results: filtered });
  }

  console.log('');
  let totalPass = 0;
  let totalFail = 0;
  for (const s of summaries) {
    const passed = s.results.filter(r => r.ok).length;
    const failed = s.results.length - passed;
    totalPass += passed;
    totalFail += failed;
    console.log(`Suite [${s.id}]  PASS=${passed}  FAIL=${failed}`);
    for (const r of s.results) {
      if (r.ok) {
        console.log(`  PASS  ${r.name}`);
      } else {
        console.log(`  FAIL  ${r.name}`);
        if (r.error) {
          for (const line of r.error.split('\n')) {
            console.log(`        ${line}`);
          }
        }
      }
    }
    console.log('');
  }

  console.log('='.repeat(72));
  console.log(`\n结果：${totalPass} passed, ${totalFail} failed (共 ${totalPass + totalFail})\n`);

  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
