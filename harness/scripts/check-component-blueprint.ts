import * as fs from 'fs';
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
import {
  validateBlueprintReviewFeedback,
  validateBlueprintReviewPublication,
  validateRequirementSourceMaterialization,
} from './utils/blueprint-host-seams';

interface CliArgs {
  'project-root'?: string;
  blueprint?: string;
  ref?: string;
  /** M7 seam 1：宿主物化的来源材料（requirement-source-materialization@1）JSON 路径。 */
  materialization?: string;
  /** M7 seam 2：待核对的评审投影 Markdown 路径（零新设计事实 + derived_from 绑定）。 */
  projection?: string;
  /** M7 seam 3：宿主结构化评审反馈（blueprint-review-feedback@1）JSON 路径。 */
  feedback?: string;
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

/**
 * M7 seam 1 的**前蓝图**模式。materialization 在编排上位于建立蓝图**之前**
 * （`/component-design`：需求源物化 → 蓝图），因此它 MUST NOT 要求 canonical blueprint
 * 已存在——新需求的第一次物化时工作区里还没有蓝图。
 *
 * 这里只校验 envelope、`source_ref`、原始字节 hash、provenance 与 authority；
 * `--blueprint` 只做**字符串一致性**核对（材料声明的归属与命令行意图是否一致），不读盘。
 * 蓝图建立之后，current scope 与 canonical blueprint 的一致性由既有 P1 validator
 * （`validateRequirementTraceability`）承担，不在此重复。
 */
export function checkMaterializationOnly(
  projectRoot: string,
  blueprintId: string,
  materializationPath: string,
) {
  return {
    modes: ['requirement-source-materialization'],
    issues: validateRequirementSourceMaterialization(
      JSON.parse(fs.readFileSync(materializationPath, 'utf8')),
      { projectRoot, blueprintId },
    ),
  };
}

/**
 * M7：三条 Story 类宿主接缝的材料校验模式，挂在既有 CLI 上（不新增顶层 CLI）。
 * 每种模式独立可用；未传对应参数即不评估该接缝，不产生伪 PASS。
 *
 * 本函数是**蓝图已存在**时的路径；只跑 materialization 时走 `checkMaterializationOnly`。
 */
export function checkHostSeamMaterials(
  projectRoot: string,
  loaded: ReturnType<typeof checkCanonicalComponentBlueprint>,
  args: Pick<CliArgs, 'materialization' | 'projection' | 'feedback'>,
) {
  const issues = [];
  const modes: string[] = [];
  if (args.materialization) {
    modes.push('requirement-source-materialization');
    issues.push(...validateRequirementSourceMaterialization(
      JSON.parse(fs.readFileSync(args.materialization, 'utf8')),
      {
        projectRoot,
        blueprintId: String(loaded.blueprint.blueprint_id),
        componentId: String(loaded.blueprint.component_id),
      },
    ));
  }
  if (args.projection) {
    modes.push('blueprint-review-publication');
    issues.push(...validateBlueprintReviewPublication(
      fs.readFileSync(args.projection, 'utf8'),
      loaded.blueprint,
      loaded.artifactSha256,
    ));
  }
  if (args.feedback) {
    modes.push('blueprint-review-feedback');
    issues.push(...validateBlueprintReviewFeedback(
      JSON.parse(fs.readFileSync(args.feedback, 'utf8')),
      loaded.blueprint,
    ).issues);
  }
  return { issues, modes };
}

function main(): void {
  const args = minimist<CliArgs>(process.argv.slice(2), {
    string: ['project-root', 'blueprint', 'ref', 'materialization', 'projection', 'feedback'],
    boolean: ['json'],
    default: { 'project-root': process.cwd(), json: false },
  });
  if (!args.blueprint) {
    console.error('用法：check-component-blueprint --project-root <root> --blueprint <blueprint-id> [--ref <json>]'
      + ' [--materialization <path>] [--projection <path>] [--feedback <path>] [--json]');
    process.exit(2);
  }
  try {
    // 只跑 materialization 时不加载 canonical blueprint：物化发生在建立蓝图之前。
    // projection / feedback / ref 模式仍要求蓝图存在（它们本质上就是对某个 revision 的操作）。
    const materializationOnly = Boolean(args.materialization) && !args.projection && !args.feedback && !args.ref;
    if (materializationOnly) {
      const only = checkMaterializationOnly(args['project-root']!, args.blueprint, args.materialization!);
      const failedOnly = only.issues.some(item => item.severity === 'BLOCKER');
      if (args.json) {
        console.log(JSON.stringify({
          status: failedOnly ? 'FAIL' : 'PASS',
          blueprint_id: args.blueprint,
          blueprint_loaded: false,
          host_seam_modes: only.modes,
          issues: only.issues,
        }, null, 2));
      } else if (failedOnly) {
        console.error(`❌ requirement-source-materialization FAIL (${only.issues.length} issues)`);
        for (const item of only.issues) console.error(`  [${item.severity}] ${item.id} ${item.path}: ${item.message}`);
      } else {
        console.log('✅ requirement-source-materialization PASS（前蓝图模式：未加载 canonical blueprint）');
        console.log(`   blueprint_id=${args.blueprint}`);
      }
      process.exit(failedOnly ? 1 : 0);
    }

    const result = checkCanonicalComponentBlueprint(args['project-root']!, args.blueprint);
    let resolvedTarget: unknown;
    if (args.ref) {
      resolvedTarget = resolveCliRefTarget(args['project-root']!, args.blueprint, JSON.parse(args.ref));
    }
    const seams = checkHostSeamMaterials(args['project-root']!, result, args);
    result.issues.push(...seams.issues);
    const failed = result.issues.some(item => item.severity === 'BLOCKER');
    if (args.json) {
      console.log(JSON.stringify({
        status: failed ? 'FAIL' : 'PASS',
        canonical_path: result.canonicalPath,
        artifact_sha256: result.artifactSha256,
        component_id: result.blueprint.component_id,
        resolved_target: resolvedTarget,
        host_seam_modes: seams.modes,
        issues: result.issues,
      }, null, 2));
    } else if (failed) {
      console.error(`❌ Component blueprint FAIL (${result.issues.length} issues)`);
      for (const item of result.issues) console.error(`  [${item.severity}] ${item.id} ${item.path}: ${item.message}`);
    } else {
      console.log(`✅ Component blueprint PASS — ${result.canonicalPath}`);
      console.log(`   component_id=${String(result.blueprint.component_id)}`);
      console.log(`   artifact_sha256=${result.artifactSha256}`);
      if (seams.modes.length > 0) console.log(`   host_seam_modes=${seams.modes.join(', ')}`);
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
