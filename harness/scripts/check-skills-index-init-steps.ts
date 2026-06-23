#!/usr/bin/env ts-node
// ============================================================================
// check-skills-index-init-steps.ts — skills.index init_next_steps lint CLI
// ============================================================================

import * as path from 'path';

import { lintSkillsIndexInitNextSteps } from './utils/skills-index-init-steps';

function parseArgs(argv: string[]): { frameworkRoot: string } {
  let frameworkRoot = '';
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--framework-root' && argv[i + 1]) {
      frameworkRoot = path.resolve(argv[++i]);
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      process.stdout.write(
        'Usage: npx ts-node scripts/check-skills-index-init-steps.ts --framework-root <path>\n',
      );
      process.exit(0);
    }
  }
  if (!frameworkRoot) {
    process.stderr.write('[check-skills-index-init-steps] --framework-root 必填\n');
    process.exit(1);
  }
  return { frameworkRoot };
}

function main(): void {
  const { frameworkRoot } = parseArgs(process.argv);
  const hits = lintSkillsIndexInitNextSteps(frameworkRoot);
  if (hits.length === 0) {
    process.stdout.write(`[check-skills-index-init-steps] PASS (${frameworkRoot})\n`);
    process.exit(0);
  }
  process.stderr.write(`[check-skills-index-init-steps] FAIL (${frameworkRoot}):\n`);
  for (const h of hits) {
    const loc = h.skillId ? ` [${h.skillId}${h.stepId ? `/${h.stepId}` : ''}]` : '';
    process.stderr.write(`  - ${h.id}${loc}: ${h.message}\n`);
  }
  process.exit(1);
}

if (require.main === module) {
  main();
}
