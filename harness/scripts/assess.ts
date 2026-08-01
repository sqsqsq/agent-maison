#!/usr/bin/env node

import * as path from 'path';
import minimist from 'minimist';
import { assessFeature } from './utils/assess';

export function parseAssessCliArgs(args: string[]): ReturnType<typeof minimist> {
  return minimist(args, {
    string: ['feature', 'project-root', 'framework-root', 'goal-end', 'mode', 'through-phase', 'run-id', 'attempt-id'],
    boolean: ['write'],
    default: { write: true },
  });
}

function main(): void {
  const argv = parseAssessCliArgs(process.argv.slice(2));
  const feature = String(argv.feature ?? '').trim();
  if (!feature) {
    console.error('用法: assess.ts --feature <slug> [--project-root <path>] [--goal-end <phase>]');
    process.exitCode = 2;
    return;
  }
  const projectRoot = path.resolve(String(argv['project-root'] ?? process.cwd()));
  const frameworkRoot = argv['framework-root']
    ? path.resolve(String(argv['framework-root']))
    : undefined;
  const mode = String(argv.mode ?? 'manual');
  if (!['manual', 'batch_authorized', 'goal_mode'].includes(mode)) {
    throw new Error(`--mode 非法：${mode}`);
  }
  const result = assessFeature({
    projectRoot,
    frameworkRoot,
    feature,
    goalEnd: argv['goal-end'] ? String(argv['goal-end']) : undefined,
    authorization: {
      mode: mode as 'manual' | 'batch_authorized' | 'goal_mode',
      ...(argv['through-phase'] ? { through_phase: String(argv['through-phase']) } : {}),
    },
    runId: argv['run-id'] ? String(argv['run-id']) : undefined,
    attemptId: argv['attempt-id'] ? String(argv['attempt-id']) : undefined,
    writeProjection: argv.write !== false,
  });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[assess] ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
