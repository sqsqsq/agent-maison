import minimist from 'minimist';
import {
  ChangeUnitResolutionError,
  loadCanonicalChangeUnit,
} from './utils/change-unit-path';
import { validateChangeUnit } from './utils/change-unit-validator';
import { validateChangeUnitDesign } from './utils/change-unit-design-gate';

interface CliArgs {
  'project-root'?: string;
  blueprint?: string;
  unit?: string;
  json?: boolean;
}

export function checkCanonicalChangeUnit(projectRoot: string, blueprintId: string, changeUnitId: string) {
  const loaded = loadCanonicalChangeUnit(projectRoot, blueprintId, changeUnitId);
  const artifactIssues = validateChangeUnit(loaded.changeUnit, {
    projectRoot,
    canonicalPath: loaded.canonicalPath,
  });
  const design = artifactIssues.some(item => item.severity === 'BLOCKER')
    ? undefined
    : validateChangeUnitDesign(projectRoot, loaded.changeUnit);
  return { ...loaded, issues: [...artifactIssues, ...(design?.issues ?? [])], design };
}

function main(): void {
  const args = minimist<CliArgs>(process.argv.slice(2), {
    string: ['project-root', 'blueprint', 'unit'],
    boolean: ['json'],
    default: { 'project-root': process.cwd(), json: false },
  });
  if (!args.blueprint || !args.unit) {
    console.error('用法：check-change-unit --project-root <root> --blueprint <blueprint-id> --unit <change-unit-id> [--json]');
    process.exit(2);
  }
  try {
    const result = checkCanonicalChangeUnit(args['project-root']!, args.blueprint, args.unit);
    const failed = result.issues.some(item => item.severity === 'BLOCKER');
    if (args.json) {
      console.log(JSON.stringify({
        status: failed ? 'FAIL' : 'PASS',
        canonical_path: result.canonicalPath,
        artifact_sha256: result.artifactSha256,
        component_id: result.changeUnit.component_id,
        blueprint_id: result.changeUnit.blueprint_id,
        constructability: result.design?.verdict,
        issues: result.issues,
      }, null, 2));
    } else if (failed) {
      console.error(`❌ Change Unit FAIL (${result.issues.length} issues)`);
      for (const item of result.issues) console.error(`  [${item.severity}] ${item.id} ${item.path}: ${item.message}`);
    } else {
      console.log(`✅ Change Unit PASS — ${result.canonicalPath}`);
      console.log(`   component_id=${String(result.changeUnit.component_id)} blueprint_id=${String(result.changeUnit.blueprint_id)}`);
      console.log(`   artifact_sha256=${result.artifactSha256}`);
    }
    process.exit(failed ? 1 : 0);
  } catch (error) {
    const code = error instanceof ChangeUnitResolutionError ? error.code : 'change_unit_check_failed';
    const payload = { status: 'FAIL', issues: [{ id: code, severity: 'BLOCKER', path: '$', message: (error as Error).message }] };
    if (args.json) console.log(JSON.stringify(payload, null, 2));
    else console.error(`❌ ${code}: ${(error as Error).message}`);
    process.exit(1);
  }
}

if (require.main === module) main();
