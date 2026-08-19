import minimist from 'minimist';
import {
  ComponentBlueprintResolutionError,
} from './utils/component-blueprint-model';
import {
  loadCanonicalBlueprint,
  resolveComponentBlueprintRef,
} from './utils/component-blueprint-path';
import { validateComponentBlueprint } from './utils/component-blueprint-validator';

interface CliArgs {
  'project-root'?: string;
  component?: string;
  ref?: string;
  json?: boolean;
}

export function checkCanonicalComponentBlueprint(projectRoot: string, componentId: string) {
  const loaded = loadCanonicalBlueprint(projectRoot, componentId);
  const issues = validateComponentBlueprint(loaded.blueprint, { projectRoot, canonicalPath: loaded.canonicalPath });
  if (loaded.blueprint.component_id !== componentId) {
    issues.unshift({
      id: 'component_identity_mismatch',
      severity: 'BLOCKER' as const,
      path: '$.component_id',
      message: `component identity 不一致：path=${componentId}, yaml=${String(loaded.blueprint.component_id)}。`,
    });
  }
  return { ...loaded, issues };
}

function main(): void {
  const args = minimist<CliArgs>(process.argv.slice(2), {
    string: ['project-root', 'component', 'ref'],
    boolean: ['json'],
    default: { 'project-root': process.cwd(), json: false },
  });
  if (!args.component) {
    console.error('用法：check-component-blueprint --project-root <root> --component <component-id> [--ref <json>] [--json]');
    process.exit(2);
  }
  try {
    const result = checkCanonicalComponentBlueprint(args['project-root']!, args.component);
    let resolvedTarget: unknown;
    if (args.ref) resolvedTarget = resolveComponentBlueprintRef(args['project-root']!, JSON.parse(args.ref)).target;
    const failed = result.issues.some(item => item.severity === 'BLOCKER');
    if (args.json) {
      console.log(JSON.stringify({
        status: failed ? 'FAIL' : 'PASS',
        canonical_path: result.canonicalPath,
        artifact_sha256: result.artifactSha256,
        resolved_target: resolvedTarget,
        issues: result.issues,
      }, null, 2));
    } else if (failed) {
      console.error(`❌ Component blueprint FAIL (${result.issues.length} issues)`);
      for (const item of result.issues) console.error(`  [${item.severity}] ${item.id} ${item.path}: ${item.message}`);
    } else {
      console.log(`✅ Component blueprint PASS — ${result.canonicalPath}`);
      console.log(`   artifact_sha256=${result.artifactSha256}`);
    }
    process.exit(failed ? 1 : 0);
  } catch (error) {
    const code = error instanceof ComponentBlueprintResolutionError ? error.code : 'component_blueprint_check_failed';
    const payload = { status: 'FAIL', issues: [{ id: code, severity: 'BLOCKER', path: '$', message: (error as Error).message }] };
    if (args.json) console.log(JSON.stringify(payload, null, 2));
    else console.error(`❌ ${code}: ${(error as Error).message}`);
    process.exit(1);
  }
}

if (require.main === module) main();
