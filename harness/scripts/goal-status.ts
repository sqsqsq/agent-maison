#!/usr/bin/env ts-node
// ============================================================================
// Goal status — read progress projection (JSON / Markdown / watch)
// ============================================================================

import minimist from 'minimist';
import { detectRepoLayout } from '../repo-layout';
import { loadFrameworkConfig } from '../config';
import { resolveWorkflowSpec } from '../workflow-loader';
import { loadGoalManifestFromRun } from './utils/goal-manifest';
import {
  buildLiveGoalStatusSnapshot,
  formatGoalStatusJson,
  formatGoalStatusText,
  generateProgressMarkdown,
  resolveLatestRunId,
  runStatusWatchLoop,
} from './utils/goal-progress';

async function main(): Promise<number> {
  const argv = minimist(process.argv.slice(2), {
    string: ['feature', 'run-id'],
    boolean: ['json', 'markdown', 'watch', 'help'],
    alias: { f: 'feature', h: 'help' },
    default: { 'run-id': 'latest' },
  });

  if (argv.help) {
    console.log(`
Goal status — progress projection reader

  npx ts-node scripts/goal-status.ts --feature <f> [--run-id latest|id] [--json|--markdown] [--watch] [--tail N] [--max-ticks N]
`);
    return 0;
  }

  const feature = argv.feature ? String(argv.feature) : '';
  if (!feature) {
    console.error('[goal-status] BLOCKER: --feature required');
    return 1;
  }

  const layout = detectRepoLayout(__dirname);
  const projectRoot = layout.projectRoot;
  const frameworkRoot = layout.frameworkRoot;
  const cfg = loadFrameworkConfig(projectRoot);
  const featuresDir = cfg.paths.features_dir ?? 'doc/features';
  const workflow = resolveWorkflowSpec(projectRoot, { config: cfg, frameworkRoot });

  let runId = String(argv['run-id'] ?? 'latest');
  if (runId === 'latest') {
    const latest = resolveLatestRunId(projectRoot, featuresDir, feature);
    if (!latest) {
      console.error(`[goal-status] no goal runs for feature ${feature}`);
      return 1;
    }
    runId = latest;
  }

  let manifest;
  try {
    manifest = loadGoalManifestFromRun(projectRoot, runId, { feature, featuresDir });
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }

  const tailN = Number(argv.tail) || 0;
  const watch = Boolean(argv.watch);
  const maxTicks = Number(argv['max-ticks']) || 0;
  const wantJson = Boolean(argv.json);
  const wantMd = Boolean(argv.markdown);

  const renderOnce = (): void => {
    const snapshot = buildLiveGoalStatusSnapshot({
      projectRoot,
      manifest,
      workflow,
      featuresDir,
      feature,
      runId,
      tailN: tailN > 0 ? tailN : undefined,
    });

    if (wantJson) {
      console.log(formatGoalStatusJson(snapshot));
      return;
    }

    if (wantMd) {
      console.log(generateProgressMarkdown(snapshot));
      return;
    }

    console.log(formatGoalStatusText(snapshot, feature, runId));
  };

  if (watch) {
    await runStatusWatchLoop({
      render: () => {
        try {
          console.clear();
        } catch {
          /* non-TTY */
        }
        renderOnce();
      },
      maxTicks,
    });
    return 0;
  }

  renderOnce();
  return 0;
}

void main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error((err as Error).message ?? err);
    process.exit(1);
  });
