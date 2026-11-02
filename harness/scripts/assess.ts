#!/usr/bin/env node

import * as path from 'path';
import * as fs from 'fs';
import minimist from 'minimist';
import { featureFilePath } from '../config';
import { resolveProbeFrameworkRoot } from '../repo-layout';
import { isInitialDesignManifest, loadGoalRunManifestFromRun } from './utils/goal-manifest';
import { projectInitialDesignDelivery } from './utils/initial-design-delivery';
import { assessFeature } from './utils/assess';
import { assessFeature as assessFeatureCompletion } from './utils/feature-assessment';
import { resolveChangeUnitExpectedExecution } from './utils/change-unit-completion';

export function parseAssessCliArgs(args: string[]): ReturnType<typeof minimist> {
  return minimist(args, {
    string: ['feature', 'project-root', 'framework-root', 'goal-end', 'mode', 'through-phase', 'run-id', 'attempt-id'],
    boolean: ['write'],
    default: { write: false },
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
  const runId = argv['run-id'] ? String(argv['run-id']) : undefined;
  if (runId && fs.existsSync(featureFilePath(projectRoot, feature, `goal-runs/${runId}/manifest.json`))) {
    const manifest = loadGoalRunManifestFromRun(projectRoot, runId, { feature });
    if (isInitialDesignManifest(manifest)) {
      console.log(JSON.stringify(projectInitialDesignDelivery({ projectRoot,
        frameworkRoot: frameworkRoot ?? resolveProbeFrameworkRoot(projectRoot, path.resolve(__dirname, '..')), manifest }), null, 2));
      return;
    }
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
    runId,
    attemptId: argv['attempt-id'] ? String(argv['attempt-id']) : undefined,
    writeProjection: argv.write === true,
  });
  // plan b2d7f4e9 §3.5：完成评估（记录可信性 / uncovered 义务 / blocking）与阶段观察并列展示。
  let featureAssessment: unknown;
  try {
    const a = assessFeatureCompletion(projectRoot, feature, { ...resolveChangeUnitExpectedExecution(projectRoot, feature, false, frameworkRoot), frameworkRoot });
    featureAssessment = { complete: a.complete, current_disposition: a.currentDisposition, record: a.record,
      uncovered: a.obligations.filter(o => o.status === 'uncovered'), blocking: a.blocking };
  } catch (error) { featureAssessment = { error: (error as Error).message }; }
  console.log(JSON.stringify({ ...result, feature_assessment: featureAssessment }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[assess] ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
