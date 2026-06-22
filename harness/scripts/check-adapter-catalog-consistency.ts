#!/usr/bin/env ts-node
// ============================================================================
// check-adapter-catalog-consistency.ts — adapter catalog 双根门禁 CLI
// ============================================================================

import * as path from 'path';

import { checkAdapterCatalogConsistency } from './utils/adapter-catalog';

function parseArgs(argv: string[]): { frameworkRoot: string } {
  let frameworkRoot = '';
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--framework-root' && argv[i + 1]) {
      frameworkRoot = path.resolve(argv[++i]);
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      process.stdout.write(
        'Usage: npx ts-node scripts/check-adapter-catalog-consistency.ts --framework-root <path>\n',
      );
      process.exit(0);
    }
  }
  if (!frameworkRoot) {
    process.stderr.write('[check-adapter-catalog-consistency] --framework-root 必填\n');
    process.exit(1);
  }
  return { frameworkRoot };
}

function main(): void {
  const { frameworkRoot } = parseArgs(process.argv);
  const results = checkAdapterCatalogConsistency(frameworkRoot);
  const fails = results.filter(r => r.status === 'FAIL');
  if (fails.length === 0) {
    process.stdout.write(`[check-adapter-catalog-consistency] PASS (${frameworkRoot})\n`);
    process.exit(0);
  }
  process.stderr.write(`[check-adapter-catalog-consistency] FAIL (${frameworkRoot}):\n`);
  for (const f of fails) {
    process.stderr.write(`  - ${f.id}: ${f.details}\n`);
    if (f.affected_files?.length) {
      process.stderr.write(`    files: ${f.affected_files.join(', ')}\n`);
    }
  }
  process.exit(1);
}

if (require.main === module) {
  main();
}

export { main as runCheckAdapterCatalogConsistencyCli };
