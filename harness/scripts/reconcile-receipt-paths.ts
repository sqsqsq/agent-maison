// ============================================================================
// reconcile-receipt-paths.ts — init UPDATE 后 receipt legacy 路径扫描 / patch
// ============================================================================
// 用法：
//   npx ts-node framework/harness/scripts/reconcile-receipt-paths.ts
//   npx ts-node framework/harness/scripts/reconcile-receipt-paths.ts --apply
//   npx ts-node framework/harness/scripts/reconcile-receipt-paths.ts --feature demo --phase review

import * as path from 'path';
import minimist from 'minimist';
import { runReceiptPathReconcile } from './utils/receipt-path-reconcile';

function parseArgs() {
  const args = minimist(process.argv.slice(2), {
    string: ['feature', 'phase', 'project-root'],
    boolean: ['help', 'apply'],
    alias: { f: 'feature', p: 'phase', h: 'help' },
  });

  if (args.help) {
    console.log(`
reconcile-receipt-paths — init UPDATE 后 receipt legacy 路径 reconcile

用法：
  npx ts-node framework/harness/scripts/reconcile-receipt-paths.ts [--feature <name>] [--phase <phase>]
  npx ts-node framework/harness/scripts/reconcile-receipt-paths.ts --apply [--feature <name>] [--phase <phase>]

说明：
  - 仅当 framework.config.json 已配置 paths.reports_dir_pattern 时生效
  - 默认 dry-run；--apply 写入 frontmatter（须用户确认后再执行）
  - patch 后建议对每个 feature/phase 跑 harness-runner --sync-closure
`);
    process.exit(0);
  }

  const projectRoot = path.resolve(
    (args['project-root'] as string | undefined) ??
      path.resolve(__dirname, '..', '..', '..'),
  );

  return {
    projectRoot,
    apply: Boolean(args.apply),
    feature: args.feature as string | undefined,
    phase: args.phase as string | undefined,
  };
}

function main(): void {
  const { projectRoot, apply, feature, phase } = parseArgs();
  const { exitCode } = runReceiptPathReconcile({ projectRoot, apply, feature, phase });
  process.exit(exitCode);
}

main();
