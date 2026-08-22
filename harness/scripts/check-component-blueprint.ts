import minimist from 'minimist';
import {
  ComponentBlueprintResolutionError,
} from './utils/component-blueprint-model';
import {
  loadCanonicalBlueprint,
  resolveComponentBlueprintRef,
  validateComponentBlueprintRefShape,
} from './utils/component-blueprint-path';
import { validateComponentBlueprint } from './utils/component-blueprint-validator';

interface CliArgs {
  'project-root'?: string;
  blueprint?: string;
  ref?: string;
  json?: boolean;
}

export function checkCanonicalComponentBlueprint(projectRoot: string, blueprintId: string) {
  // M5A：身份失败（path↔yaml blueprint_id 不一致等）原样抛 ComponentBlueprintResolutionError，
  // 由 CLI catch 出口统一报错码/诊断；不构造伪造的成功形状（review 2026-08-22）。
  const loaded = loadCanonicalBlueprint(projectRoot, blueprintId);
  const issues = validateComponentBlueprint(loaded.blueprint, { projectRoot, canonicalPath: loaded.canonicalPath });
  return { ...loaded, issues };
}

/**
 * M5A review：`--blueprint` 与 `--ref` 必须绑定同一 blueprint_id。resolver 只按
 * `--blueprint` 定位工作区；ref 指向另一工作区时报告两值并失败（跨工作区混用不得 PASS）。
 * 先复用既有 ref 形状校验（validateComponentBlueprintRefShape），形状非法时保持既有
 * `component_blueprint_ref_invalid` 诊断，不因提前读 blueprint_id 产生原生 TypeError 或误报。
 */
export function resolveCliRefTarget(projectRoot: string, blueprintId: string, refValue: unknown): unknown {
  const ref = validateComponentBlueprintRefShape(refValue);
  if (ref.blueprint_id !== blueprintId) {
    throw new ComponentBlueprintResolutionError(
      'component_blueprint_ref_mismatch',
      `--ref 的 blueprint_id=${JSON.stringify(ref.blueprint_id)} 与 --blueprint=${JSON.stringify(blueprintId)} 不一致；resolver 只按 --blueprint 定位工作区。`,
    );
  }
  return resolveComponentBlueprintRef(projectRoot, ref).target;
}

function main(): void {
  const args = minimist<CliArgs>(process.argv.slice(2), {
    string: ['project-root', 'blueprint', 'ref'],
    boolean: ['json'],
    default: { 'project-root': process.cwd(), json: false },
  });
  if (!args.blueprint) {
    console.error('用法：check-component-blueprint --project-root <root> --blueprint <blueprint-id> [--ref <json>] [--json]');
    process.exit(2);
  }
  try {
    const result = checkCanonicalComponentBlueprint(args['project-root']!, args.blueprint);
    let resolvedTarget: unknown;
    if (args.ref) {
      resolvedTarget = resolveCliRefTarget(args['project-root']!, args.blueprint, JSON.parse(args.ref));
    }
    const failed = result.issues.some(item => item.severity === 'BLOCKER');
    if (args.json) {
      console.log(JSON.stringify({
        status: failed ? 'FAIL' : 'PASS',
        canonical_path: result.canonicalPath,
        artifact_sha256: result.artifactSha256,
        component_id: result.blueprint.component_id,
        resolved_target: resolvedTarget,
        issues: result.issues,
      }, null, 2));
    } else if (failed) {
      console.error(`❌ Component blueprint FAIL (${result.issues.length} issues)`);
      for (const item of result.issues) console.error(`  [${item.severity}] ${item.id} ${item.path}: ${item.message}`);
    } else {
      console.log(`✅ Component blueprint PASS — ${result.canonicalPath}`);
      console.log(`   component_id=${String(result.blueprint.component_id)}`);
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
