import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import minimist from 'minimist';
import {
  ComponentBlueprintResolutionError, BLUEPRINT_SCHEMA, asRecord, asRecords, type BlueprintRecord,
} from './utils/component-blueprint-model';
import {
  componentBlueprintPath, loadCanonicalBlueprint,
  resolveComponentBlueprintRef,
  validateComponentBlueprintRefShape,
} from './utils/component-blueprint-path';
import { validateComponentBlueprint, isSmallBlueprintRequest, type ComponentBlueprintValidationContext } from './utils/component-blueprint-validator';
import { profileHasDesignLens } from './utils/blueprint-provider-boundary';
import { prepareDesignRequest, bindDesignRequestBlueprint, createDesignPreparationWrite, readDesignGoalOrigin, requestTestingScope, RequestDesignReviewRequired, type DesignPreparationWrite } from './utils/automatic-request';
import { enumerateCanonicalChangeUnitIds } from './utils/change-unit-path';
import { currentScopeItems } from './utils/blueprint-requirement-traceability';
import { loadEventsJsonlStrict } from './utils/goal-runner-phase';
import { realProjectPath } from './utils/project-relative-path';
import { resolveProbeFrameworkRoot } from '../repo-layout';
import { deriveContentImpact } from './utils/content-impact';
import { renderBlueprintReviewMarkdown } from './utils/blueprint-review-projection';
import { selectBlueprintRequestContent } from './utils/blueprint-skill-projection';
import type { AcceptanceSpec } from './utils/types';
import { loadFrameworkConfig } from '../config';
import { prepareDesignExtensions, renderDesignExtensionPreparation } from './utils/design-extension-preparation';
import { inspectBlueprintReview, materializeBlueprintReview } from './utils/blueprint-review-materialization';
import { computeBlueprintReaderGuideSourceDigest, inspectBlueprintReaderGuide } from './utils/blueprint-reader-guide';
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
  'write-review'?: boolean;
  'reader-guide-digest'?: boolean;
  'design-knowledge'?: boolean;
  'prepare-design'?: boolean;
  'material-source'?: string | string[];
  'skip-extension-action'?: string | string[];
  'session-ref'?: string;
  'request-file'?: string;
  'report-dir'?: string;
  'framework-root'?: string;
  'requirement-source'?: string | string[];
  target?: string | string[];
  'prepare-source'?: boolean;
}


export function checkCanonicalComponentBlueprint(projectRoot: string, blueprintId: string, context: ComponentBlueprintValidationContext = {}) {
  const profile = loadFrameworkConfig(projectRoot).project_profile.name;
  if (!profileHasDesignLens(profile)) {
    throw new ComponentBlueprintResolutionError(
      'blueprint_design_lens_unsupported',
      `project_profile=${profile} 缺少 design lens（当前仅 hmos-app 支持 App 部件蓝图）；需由该 profile 的独立变更补齐 lens。`,
    );
  }
  // M5A：身份失败（path↔yaml blueprint_id 不一致等）原样抛 ComponentBlueprintResolutionError，
  // 由 CLI catch 出口统一报错码/诊断；不构造伪造的成功形状（review 2026-08-22）。
  const loaded = loadCanonicalBlueprint(projectRoot, blueprintId);
  const issues = validateComponentBlueprint(loaded.blueprint, { ...context, projectRoot, canonicalPath: loaded.canonicalPath });
  return { ...loaded, issues };
}

/**
 * M5A review：`--blueprint` 与 `--ref` 必须绑定同一 blueprint_id。resolver 只按
 * `--blueprint` 定位工作区；ref 指向另一工作区时报告两值并失败（跨工作区混用不得 PASS）。
 * 先复用既有 ref 形状校验（validateComponentBlueprintRefShape），形状非法时保持既有
 * `component_blueprint_ref_invalid` 诊断，不因提前读 blueprint_id 产生原生 TypeError 或误报。
 */
export function resolveCliRefTarget(projectRoot: string, blueprintId: string, refValue: unknown, context: ComponentBlueprintValidationContext = {}): unknown {
  const ref = validateComponentBlueprintRefShape(refValue);
  if (ref.blueprint_id !== blueprintId) {
    throw new ComponentBlueprintResolutionError(
      'component_blueprint_ref_mismatch',
      `--ref 的 blueprint_id=${JSON.stringify(ref.blueprint_id)} 与 --blueprint=${JSON.stringify(blueprintId)} 不一致；resolver 只按 --blueprint 定位工作区。`,
    );
  }
  return resolveComponentBlueprintRef(projectRoot, ref, undefined, context).target;
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
      projectRoot,
      String(loaded.blueprint.blueprint_id),
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

interface BlueprintSourcePreparationOptions {
  requestFile?: string;
  write?: DesignPreparationWrite;
}

/** Source equality alone does not transfer an older request's blueprint to a new request. */
function assertBlueprintSourceOwner(projectRoot: string, blueprintId: string, file: string, draft: BlueprintRecord,
  context: ComponentBlueprintValidationContext, requestFile?: string): BlueprintRecord | undefined {
  const deny = (detail: string): never => { throw new Error(`source准备仅允许本请求自有的未完成蓝图；小型须使用本请求自己的 blueprint_id：${detail}`); };
  if (enumerateCanonicalChangeUnitIds(projectRoot, blueprintId).length) deny('已有 canonical CU，继续原设计/CU责任，不重绑定来源。');
  if (asRecord(asRecord(draft.review_summary)?.admission)?.status === 'pass') deny('完整设计已 admitted，继续原完整设计责任。');
  const expected = new Set((context.requestSourceItems ?? []).map(item => item.source_ref));
  if (currentScopeItems(draft).some(item => !expected.has(item.source_ref))) deny('已有其它请求的来源。');
  const provenance = asRecord(draft.provenance);
  if (provenance?.source_ref !== undefined && !expected.has(String(provenance.source_ref))) deny('原 provenance 不属于本请求。');
  const intake = context.requestIntake!;
  const request = requestFile && fs.existsSync(requestFile) ? asRecord(JSON.parse(fs.readFileSync(requestFile, 'utf8'))) : undefined;
  const binding = asRecord(asRecord(request?.blueprint)?.ref);
  const prior = asRecord(request?.intake_context);
  const sameRequest = prior?.session_id === intake.session_id && asRecord(prior?.user)?.id === intake.user.id;
  if (binding && (!sameRequest || binding.blueprint_id !== blueprintId
    || draft.component_id !== undefined && binding.component_id !== draft.component_id)) deny('原 request 绑定的请求或蓝图身份不一致。');

  let managedOwner = false;
  const runs = path.join(path.dirname(path.dirname(file)), 'goal-runs');
  for (const entry of fs.existsSync(runs) ? fs.readdirSync(runs, { withFileTypes: true }) : []) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const directory = path.join(runs, entry.name), events = path.join(directory, 'events.jsonl');
    if (fs.existsSync(events) && loadEventsJsonlStrict(events).events.some(event => event.type === 'run_end' && String(event.status).startsWith('COMPLETED'))) {
      deny('该工作区已有历史完成记录。');
    }
    const manifestFile = path.join(directory, 'manifest.json');
    if (!fs.existsSync(manifestFile) || typeof request?.origin_request !== 'string'
      || path.resolve(projectRoot, request.origin_request) !== manifestFile) continue;
    const origin = readDesignGoalOrigin(projectRoot, request.origin_request), manifest = origin.manifest;
    const businessSources = new Set((manifest.requirement_source_files?.length ? manifest.requirement_source_files : [origin.reference + '#requirement']).map(source => {
      const [sourcePath, ...fragment] = source.split('#');
      return path.relative(projectRoot, realProjectPath(projectRoot, sourcePath, 'original requirement source')).replace(/\\/g, '/')
        + (fragment.length ? '#' + fragment.join('#') : '');
    }));
    if (sameRequest && manifest.feature === blueprintId && businessSources.size === expected.size
      && [...businessSources].every(source => expected.has(source))) managedOwner = true;
  }
  if (binding || managedOwner) return binding;
  const relative = path.relative(projectRoot, file).replace(/\\/g, '/');
  if (sameRequest && (request?.design_target === relative || (intake.user_messages ?? [intake.user]).some(message =>
    message.text.replace(/\\/g, '/').includes(relative)))) return undefined;
  return deny('缺少原 request 绑定、明确授权的设计路径或受管设计地址。');
}

/** Explicit source preparation changes only owned machine identity/source fields. */
export function prepareCanonicalBlueprintSource(projectRoot: string, blueprintId: string, context: ComponentBlueprintValidationContext,
  options: BlueprintSourcePreparationOptions = {}): string[] {
  const file = componentBlueprintPath(projectRoot, blueprintId);
  if (!isSmallBlueprintRequest(context) || !context.requestSourceItems?.length || !fs.existsSync(file)) return [];
  const original = fs.readFileSync(file, 'utf8'), draft = asRecord(YAML.parse(original));
  if (!draft) throw new Error('canonical蓝图必须是map。');
  if (draft.blueprint_id !== undefined && draft.blueprint_id !== blueprintId) throw new Error('source准备不得重绑定blueprint_id。');
  const priorBinding = assertBlueprintSourceOwner(projectRoot, blueprintId, file, draft, context, options.requestFile);
  draft.artifact ??= 'component-blueprint@1'; draft.blueprint_id ??= blueprintId; draft.component_id ??= priorBinding?.component_id ?? blueprintId; draft.revision ??= 1;
  draft.provenance ??= structuredClone(context.requestSourceItems[0].provenance);
  draft.discovery ??= {};
  const discovery = asRecord(draft.discovery);
  if (!discovery) throw new Error('discovery必须是map，source准备不覆盖坏的业务输入。');
  discovery.inputs ??= {};
  const inputs = asRecord(discovery.inputs);
  if (!inputs || inputs.current_scope_items !== undefined && !Array.isArray(inputs.current_scope_items)) throw new Error('current_scope_items必须是数组。');
  const items: unknown[] = inputs.current_scope_items === undefined ? [] : inputs.current_scope_items as unknown[];
  for (const source of context.requestSourceItems) {
    const existing = asRecords(items).find(item => item.item_id === source.item_id && item.source_ref === source.source_ref);
    if (existing) existing.source_sha256 = source.source_sha256;
    else items.push(structuredClone(source) as unknown as BlueprintRecord);
  }
  inputs.current_scope_items = items;
  discovery.requirement_traceability ??= [];
  const { refreshBlueprintFingerprints } = require('./utils/design-repair-unattended') as typeof import('./utils/design-repair-unattended');
  refreshBlueprintFingerprints(draft);
  const bytes = YAML.stringify(draft);
  if (bytes === original) return [];
  if (options.write) { options.write(file, bytes); return [file]; }
  const temporary = `${file}.source-${process.pid}.tmp`;
  try { fs.writeFileSync(temporary, bytes, { encoding: 'utf8', flag: 'wx' }); fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  return [file];
}

const argumentList = (value?: string | string[]): string[] | undefined => typeof value === 'string' ? [value] : value;

/** A prepared target locates the first draft before an accepted blueprint ref exists. */
function preparedDesignBlueprintId(projectRoot: string, request?: BlueprintRecord): string | undefined {
  const ref = asRecord(request?.blueprint)?.ref;
  if (ref !== undefined) return validateComponentBlueprintRefShape(ref).blueprint_id;
  if (typeof request?.design_target !== 'string') return undefined;
  const target = request.design_target.replace(/\\/g, '/');
  const blueprintId = target.split('/').at(-3);
  if (!blueprintId || target !== path.relative(projectRoot, componentBlueprintPath(projectRoot, blueprintId)).replace(/\\/g, '/')) {
    throw new Error('原 request 的 design_target 必须指向本项目的 canonical 蓝图。');
  }
  return blueprintId;
}

function main(): void {
  const args = minimist<CliArgs>(process.argv.slice(2), {
    alias: { 'material-source': 'ux-source' },
    string: ['project-root', 'blueprint', 'ref', 'materialization', 'projection', 'feedback', 'session-ref', 'request-file', 'report-dir', 'framework-root', 'requirement-source', 'target', 'material-source', 'skip-extension-action'],
    boolean: ['json', 'write-review', 'reader-guide-digest', 'design-knowledge', 'prepare-design', 'prepare-source'],
    default: { 'project-root': process.cwd(), json: false },
  });
  if (!args.blueprint && !(args['prepare-design'] && args['request-file'])) {
    console.error('用法：check-component-blueprint --project-root <root> --blueprint <blueprint-id> [--ref <json>]'
      + ' [--session-ref <native>#<user-id> | --request-file <component-design request>] [--report-dir <host-relative-dir>] [--target <file>] [--requirement-source <file>] [--prepare-source]'
      + ' [--design-knowledge | --reader-guide-digest | --write-review | --materialization <path> | --projection <path> | --feedback <path>] [--json]');
    console.error('设计前准备：--prepare-design [--blueprint <blueprint-id>] [--request-file <已准备请求>] [--requirement-source <path>] [--material-source <path>] [--skip-extension-action <能力ID:绑定ID>]');
    process.exit(2);
  }
  let prepared: ReturnType<typeof prepareDesignRequest> | undefined;
  let context: ComponentBlueprintValidationContext = {};
  const preparation = createDesignPreparationWrite();
  try {
    if (args['design-knowledge'] || args['prepare-design']) {
      const lookupOnly = Boolean(args['design-knowledge']);
      if (args['write-review'] || args['reader-guide-digest'] || args.materialization || args.projection || args.feedback || args.ref
        || args['session-ref'] || args['prepare-source'] || args['report-dir'] || args.target
        || lookupOnly && (args['prepare-design'] || args['request-file'] || args['requirement-source'] || args['material-source'] || args['skip-extension-action'])) {
        throw new Error('--design-knowledge / --prepare-design 是独立模式。');
      }
      const projectRoot = path.resolve(args['project-root']!);
      const frameworkRoot = args['framework-root'] ?? resolveProbeFrameworkRoot(projectRoot, __dirname);
      const requestFile = args['request-file'];
      const request = requestFile ? asRecord(JSON.parse(fs.readFileSync(realProjectPath(projectRoot, requestFile, 'component-design request'), 'utf8'))) : undefined;
      const boundId = preparedDesignBlueprintId(projectRoot, request);
      if (args.blueprint && boundId !== undefined && boundId !== args.blueprint) throw new Error('准备的蓝图 ID 必须与原 request 正式绑定一致。');
      const blueprintId = args.blueprint ?? boundId;
      if (!blueprintId) throw new Error('缺少 --blueprint 或原 request 正式绑定的蓝图 ID。');
      const original = requestFile ? prepareDesignRequest({ projectRoot, frameworkRoot, blueprintId, requestFile, readonly: true }) : undefined;
      const requirementSources = (argumentList(args['requirement-source']) ?? []).map(source => {
        const [file, ...fragment] = source.split('#');
        const absolute = realProjectPath(projectRoot, file, 'requirement source');
        if (!fs.statSync(absolute).isFile()) throw new Error('需求来源必须是文件：' + file);
        return [path.relative(projectRoot, absolute).replace(/\\/g, '/'), ...fragment].join('#');
      });
      const result = prepareDesignExtensions({ projectRoot, frameworkRoot, blueprintId, lookupOnly, requestFile,
        requirement: original?.intake?.user.text ?? (typeof request?.requested_result === 'string' ? request.requested_result : undefined),
        requirementSources: [...original?.sourceRefs ?? [], ...requirementSources],
        materialSources: argumentList(args['material-source']), skipActions: argumentList(args['skip-extension-action']) });
      console.log(args.json ? JSON.stringify(result, null, 2)
        : `蓝图位置：${result.canonical_path}\n\n${renderDesignExtensionPreparation(result)}`);
      return;
    }
    if (args['material-source'] || args['skip-extension-action']) throw new Error('--material-source / --skip-extension-action 只用于 --prepare-design。');
    if (!args.blueprint) throw new Error('缺少 --blueprint');
    if (args['reader-guide-digest']) {
      if (args['write-review'] || args.materialization || args.projection || args.feedback || args.ref) throw new Error('--reader-guide-digest 是独立只读模式，不能与其它模式混用。');
      const loaded = loadCanonicalBlueprint(args['project-root']!, args.blueprint);
      const sourceDigest = computeBlueprintReaderGuideSourceDigest(loaded.blueprint);
      console.log(args.json ? JSON.stringify({ reader_guide_source_digest: sourceDigest, canonical_path: loaded.canonicalPath, artifact_sha256: loaded.artifactSha256 }, null, 2) : sourceDigest);
      return;
    }
    if (args['write-review'] && (args.materialization || args.projection || args.feedback || args.ref)) throw new Error('--write-review 是独立生成模式，不能与 --ref/--materialization/--projection/--feedback 混用。');
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
      process.exitCode = failedOnly ? 1 : 0;
      return;
    }

    const root = path.resolve(args['project-root']!);
    const readonlyDesign = Boolean(args['request-file'] && !args['prepare-source']);
    const fullFields: string[] = BLUEPRINT_SCHEMA.$defs.fullContent.required;
    let shortShaped = false;
    try { const raw = loadCanonicalBlueprint(root, args.blueprint).blueprint; shortShaped = fullFields.some(field => raw[field] === undefined); } catch { /* Explicit first-check preparation can still publish readable source refs before the blueprint exists. */ }
    const wantsContext = Boolean(args['session-ref'] || args['request-file'] || args['prepare-source'] || args['report-dir'] || args.target || shortShaped);
    if (wantsContext) {
      if (!profileHasDesignLens(loadFrameworkConfig(root).project_profile.name)) throw new ComponentBlueprintResolutionError('blueprint_design_lens_unsupported', '当前profile没有已支持的design lens。');
      prepared = prepareDesignRequest({ projectRoot: root, frameworkRoot: args['framework-root'] ?? resolveProbeFrameworkRoot(root, __dirname),
        blueprintId: args.blueprint, sessionRef: args['session-ref'], requestFile: args['request-file'], reportDir: args['report-dir'],
        targets: argumentList(args.target), requirementSources: argumentList(args['requirement-source']), readonly: readonlyDesign,
        write: preparation.write });
      context = { requestIntake: prepared.intake, requestSourceItems: prepared.currentScopeItems };
      if (args['prepare-source'] && !prepared.originGap) {
        if (!fs.existsSync(componentBlueprintPath(root, args.blueprint))) {
          preparation.commit();
          if (args.json) console.log(JSON.stringify({ status: 'PREPARED', request_file: path.relative(root, prepared.requestFile).replace(/\\/g, '/'), source_refs: prepared.sourceRefs }, null, 2));
          else console.log(`原请求来源已准备，请在 ${componentBlueprintPath(root, args.blueprint)} 编写本请求蓝图。`);
          return;
        }
        prepareCanonicalBlueprintSource(root, args.blueprint, context, { requestFile: prepared.requestFile, write: preparation.write });
      }

    }
    const existingBinding = prepared && fs.existsSync(prepared.requestFile) ? asRecord(asRecord(JSON.parse(fs.readFileSync(prepared.requestFile, 'utf8')))?.blueprint) : undefined;
    if (readonlyDesign && existingBinding?.ref && !prepared?.originGap) resolveCliRefTarget(root, args.blueprint, existingBinding.ref, context);
    const result = checkCanonicalComponentBlueprint(root, args.blueprint, context);
    if (prepared?.originGap) result.issues.push({ id: 'component_blueprint_schema_invalid', severity: 'BLOCKER', path: '$.provenance', message: prepared.originGap });
    const small = isSmallBlueprintRequest(context);
    let resolvedTarget: unknown;
    if (args.ref) {
      resolvedTarget = resolveCliRefTarget(root, args.blueprint, JSON.parse(args.ref), context);
    }
    const seams = checkHostSeamMaterials(args['project-root']!, result, args);
    result.issues.push(...seams.issues);
    const failed = result.issues.some(item => item.severity === 'BLOCKER');
    if (small && !failed && prepared && !readonlyDesign && !prepared.originGap) {
      assertBlueprintSourceOwner(root, args.blueprint, result.canonicalPath, result.blueprint, context, prepared.requestFile);
    }
    let blueprintBinding = existingBinding;
    if (small && !failed && prepared && !readonlyDesign && !prepared.originGap) {
      const requestFile = path.relative(root, prepared.requestFile).replace(/\\/g, '/');
      try {
        blueprintBinding = bindDesignRequestBlueprint({ projectRoot: root, frameworkRoot: args['framework-root'] ?? resolveProbeFrameworkRoot(root, __dirname),
          requestFile, blueprintId: args.blueprint, write: preparation.write });
      } catch (error) {
        if (!args['prepare-source'] || !(error instanceof RequestDesignReviewRequired)) throw error;
        preparation.commit();
        if (args.json) console.log(JSON.stringify({ status: 'REVIEW_REQUIRED', request_file: requestFile, source_refs: prepared.sourceRefs,
          current_scope_items: prepared.currentScopeItems, review_required: error.message }, null, 2));
        else console.error(error.message);
        process.exitCode = 1;
        return;
      }
    }
    const reviewDocument = shortShaped && !small ? undefined : args['write-review']
      ? materializeBlueprintReview(root, args.blueprint, context) : inspectBlueprintReview(root, args.blueprint, context);
    const reviewFailed = args['write-review'] && reviewDocument?.status === 'failed';
    if (args.json) {
      const requestFile = prepared && path.relative(root, prepared.requestFile).replace(/\\/g, '/');
      const acceptance = small && !failed && blueprintBinding
        ? selectBlueprintRequestContent(result.blueprint).acceptance as unknown as AcceptanceSpec | undefined : undefined;
      const ids = blueprintBinding?.acceptance_ids;
      const device = acceptance && Array.isArray(ids) && ids.every(id => typeof id === 'string')
        ? requestTestingScope(root, prepared?.intake, acceptance, ids) : undefined;
      console.log(JSON.stringify({
        status: failed ? 'FAIL' : 'PASS',
        canonical_path: result.canonicalPath,
        artifact_sha256: result.artifactSha256,
        component_id: result.blueprint.component_id,
        resolved_target: resolvedTarget,
        host_seam_modes: seams.modes,
        issues: result.issues,
        review_document: reviewDocument,
        reader_guide: small || shortShaped ? undefined : inspectBlueprintReaderGuide(result.blueprint),
        design_scope: small ? 'small-request-design' : 'full-design',
        blueprint_binding: blueprintBinding,
        request_file: prepared ? path.relative(path.resolve(args['project-root']!), prepared.requestFile).replace(/\\/g, '/') : undefined, source_refs: prepared?.sourceRefs, origin_gap: prepared?.originGap,
        ...(prepared && failed ? { current_scope_items: prepared.currentScopeItems } : {}),
        summary: small && !failed ? renderBlueprintReviewMarkdown(result.blueprint, result.artifactSha256, undefined, context) : undefined,
        content_impact: prepared?.intake ? deriveContentImpact(root, prepared.intake) : undefined,
        ...(device ? { next: device.required ? [{ phase: 'testing', acceptance_ids: device.items.map(item => item.id),
          content_impact: device.impacts, command: `npm run check -- --project-root ${JSON.stringify(root)} --phase testing --request-file ${JSON.stringify(requestFile)} --prepare-request` }] : [] } : {}),
      }, null, 2));
    } else if (failed) {
      console.error(`❌ Component blueprint FAIL (${result.issues.length} issues)`);
      for (const item of result.issues) console.error(`  [${item.severity}] ${item.id} ${item.path}: ${item.message}`);
    } else {
      console.log(`✅ ${small ? '小型请求设计' : 'Component blueprint'} PASS — ${result.canonicalPath}`);
      console.log(`   component_id=${String(result.blueprint.component_id)}`);
      console.log(`   artifact_sha256=${result.artifactSha256}`);
      for (const diagnostic of result.issues.filter(item => item.severity === 'WARN')) console.log(`   [WARN] ${diagnostic.path}: ${diagnostic.message}`);
      if (seams.modes.length > 0) console.log(`   host_seam_modes=${seams.modes.join(', ')}`);
    }
    if (!args.json && reviewDocument) console.log(`   review_document=${reviewDocument.status} ${reviewDocument.path}\n   重建：${reviewDocument.rebuildCommand}`
      + ('reason' in reviewDocument && reviewDocument.reason ? `\n   原因：${reviewDocument.reason}` : '')
      + ('sourceGaps' in reviewDocument && reviewDocument.sourceGaps?.length ? `\n   来源缺口：${reviewDocument.sourceGaps.join('；')}` : ''));
    if (!failed && !reviewFailed) preparation.commit();
    process.exitCode = failed || reviewFailed ? 1 : 0;
  } catch (error) {
    const code = error instanceof ComponentBlueprintResolutionError ? error.code : 'component_blueprint_check_failed';
    const payload = { status: 'FAIL', request_file: prepared ? path.relative(path.resolve(args['project-root']!), prepared.requestFile).replace(/\\/g, '/') : undefined, source_refs: prepared?.sourceRefs, origin_gap: prepared?.originGap, issues: [{ id: code, severity: 'BLOCKER', path: '$', message: (error as Error).message }] };
    if (args.json) console.log(JSON.stringify(payload, null, 2));
    else console.error(`❌ ${code}: ${(error as Error).message}`);
    process.exitCode = 1;
  } finally {
    preparation.rollback();
  }
}

if (require.main === module) main();
