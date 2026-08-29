// blueprint-host-seams.ts — M7 三条 Story 类宿主接缝的机器契约校验。
//
// 方向与 owner 各自独立（P1 spec「Three Story-class host seams are separate directional
// contracts」）：
//   1. requirement-source-materialization  宿主 → Maison   （本文件：物化输入校验）
//   2. blueprint-review-publication        Maison → 宿主   （本文件：投影一致性校验；
//      schema 与 renderer 复用既有 app-component-blueprint.schema.json /
//      blueprint-review-projection.ts，不新建平行 schema）
//   3. blueprint-review-feedback           宿主 → Maison   （本文件：reconciliation intake）
//
// 三者都挂在既有 `check:component-blueprint` CLI 上，不新增顶层 CLI、registry、状态或
// 第二真源。解析来源材料复用既有 `resolveCurrentScopeSource`，不造 resolver 副本。

import * as fs from 'fs';
import * as path from 'path';
import {
  BlueprintIssue,
  BlueprintRecord,
  asRecord,
  asRecords,
  asStrings,
  issue,
  nonEmptyString,
} from './component-blueprint-model';
import { validateLiteSchema } from './lite-json-schema';
import { stableAddressIndex } from './blueprint-addressing';
import { CurrentScopeItem, validateCurrentScopeItemShape } from './blueprint-requirement-traceability';
import { renderBlueprintReviewMarkdown } from './blueprint-review-projection';

export const MATERIALIZATION_ARTIFACT = 'requirement-source-materialization@1' as const;
export const REVIEW_FEEDBACK_ARTIFACT = 'blueprint-review-feedback@1' as const;

function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', '..', 'schemas', name), 'utf8'),
  ) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 1. requirement-source-materialization（宿主 → Maison）
// ---------------------------------------------------------------------------

export interface MaterializationContext {
  projectRoot: string;
  /** 可选：绑定到某份蓝图；不一致即 fail-closed（不同工作区材料不得混用）。 */
  blueprintId?: string;
  componentId?: string;
}

/**
 * 校验宿主物化的来源材料是否可被蓝图 `discovery.inputs.current_scope_items` 直接消费。
 *
 * required 语义：本函数只回答"这份材料是否合法"。"正式需求缺材料 = blocker"由调用方
 * （/component-design 入口与 CLI）按 `--require-materialization` 判定，不在这里假设。
 */
export function validateRequirementSourceMaterialization(
  value: unknown,
  context: MaterializationContext,
): BlueprintIssue[] {
  const doc = asRecord(value);
  if (!doc) {
    return [issue('materialization_root_invalid', '$', 'materialization 输入根对象必须是 map。')];
  }
  const out: BlueprintIssue[] = [];
  for (const violation of validateLiteSchema(doc, loadSchema('requirement-source-materialization.schema.json'))) {
    out.push(issue('materialization_schema_invalid', violation.path, violation.message));
  }
  if (doc.artifact !== MATERIALIZATION_ARTIFACT) {
    out.push(issue('materialization_artifact_invalid', '$.artifact', `artifact 必须为 ${MATERIALIZATION_ARTIFACT}。`));
  }
  if (nonEmptyString(context.blueprintId) && doc.blueprint_id !== context.blueprintId) {
    out.push(issue(
      'materialization_blueprint_mismatch',
      '$.blueprint_id',
      `materialization blueprint_id=${String(doc.blueprint_id)} 与目标工作区 ${context.blueprintId} 不一致；跨工作区材料不得混用。`,
    ));
  }
  if (nonEmptyString(context.componentId) && doc.component_id !== context.componentId) {
    out.push(issue(
      'materialization_component_mismatch',
      '$.component_id',
      `materialization component_id=${String(doc.component_id)} 与蓝图 ${context.componentId} 不一致。`,
    ));
  }

  const items = asRecords(doc.items);
  if (items.length === 0) {
    out.push(issue('materialization_items_empty', '$.items', 'materialization 至少要交出一项来源材料。'));
  }
  const seenIds = new Map<string, string>();
  items.forEach((item, index) => {
    const base = `$.items[${index}]`;
    const itemId = String(item.item_id ?? '');
    if (!nonEmptyString(itemId)) return;
    const declaredSha = String(item.source_sha256 ?? '');
    const previousSha = seenIds.get(itemId);
    if (previousSha !== undefined) {
      // 同一 item_id 出现两份不同字节 → fail-closed，报告双方，禁止 last-write-wins。
      out.push(issue(
        'materialization_source_conflict',
        `${base}.item_id`,
        previousSha === declaredSha
          ? `item_id=${itemId} 重复出现。`
          : `item_id=${itemId} 出现冲突来源：${previousSha} 与 ${declaredSha}；权威冲突 fail-closed，不得后写取胜。`,
      ));
    }
    seenIds.set(itemId, declaredSha);

    const authority = asRecord(item.authority);
    if (!authority || !nonEmptyString(authority.owner)) {
      out.push(issue('materialization_authority_missing', `${base}.authority`, '每项来源材料必须可归属到一个 owner。'));
    }

    // **字段语义权威唯一**：source_ref / hash / provenance（含 source_revision 一致性）的判据
    // 直接复用 P1 的 current-scope helper，不在此复制一套会漂移的语义；解析同样落到既有
    // resolveCurrentScopeSource（项目相对路径 + 原始字节 hash），不造 resolver 副本。
    out.push(...validateCurrentScopeItemShape(
      item as unknown as CurrentScopeItem,
      base,
      'materialization',
      context.projectRoot,
    ));
  });
  return out;
}

/** 合法 materialization → 可直接进入 `discovery.inputs.current_scope_items` 的条目。 */
export function materializedScopeItems(value: unknown): BlueprintRecord[] {
  return asRecords(asRecord(value)?.items).map(item => ({
    item_id: item.item_id,
    kind: item.kind,
    source_ref: item.source_ref,
    ...(nonEmptyString(item.source_revision) ? { source_revision: item.source_revision } : {}),
    source_sha256: item.source_sha256,
    provenance: item.provenance,
  }));
}

/** 上游显式把某项标为正式需求时该分类具有权威性；unspecified 由人确认，不猜测。 */
export function declaredFormalRequirementItems(value: unknown): string[] {
  return asRecords(asRecord(value)?.items)
    .filter(item => asRecord(item.authority)?.formality === 'formal_requirement')
    .map(item => String(item.item_id ?? ''))
    .filter(id => id.length > 0);
}

// ---------------------------------------------------------------------------
// 2. blueprint-review-publication（Maison → 宿主）
// ---------------------------------------------------------------------------

/**
 * 投影一致性：宿主拿到的评审投影必须与 canonical YAML 确定性同源，且**零新设计事实**。
 * 复用既有 renderer 重算并逐字节比对——比对失败即说明投影被改写或夹带了 canonical 中
 * 不存在的内容。derived_from 头由 renderer 生成，因此同一比对同时锁住 revision 绑定。
 */
export function validateBlueprintReviewPublication(
  projection: string,
  blueprint: BlueprintRecord,
  artifactSha256: string,
): BlueprintIssue[] {
  let expected: string;
  try {
    expected = renderBlueprintReviewMarkdown(blueprint, artifactSha256);
  } catch (error) {
    return [issue('publication_projection_render_failed', '$', (error as Error).message)];
  }
  if (projection === expected) return [];
  const expectedHeader = `  artifact_sha256: ${artifactSha256}`;
  if (!projection.includes(expectedHeader)) {
    return [issue(
      'publication_derived_from_mismatch',
      '$.derived_from',
      `投影未精确绑定被评审 revision：缺 ${expectedHeader}。`,
    )];
  }
  return [issue(
    'publication_projection_added_facts',
    '$',
    '评审投影与 canonical YAML 的确定性派生结果不一致：投影是零新事实的单向派生物，不得新增、改写或删除设计事实。',
  )];
}

// ---------------------------------------------------------------------------
// 3. blueprint-review-feedback（宿主 → Maison）
// ---------------------------------------------------------------------------

/**
 * intake 的输出**全部是候选**，不是既成事实。
 *
 * 本函数只回答"哪些反馈**够格**进入 reconciliation"，**不回答"哪些已被接受"**——它没有
 * "Maison 已接受"这个输入，因此任何"已接受 / 已升 revision"的断言都不能由它给出。是否接受
 * 由蓝图 write owner 裁决；接受之后才复用既有 P1「新事实、权威裁决 MUST 生成新 revision」
 * 规则。这里不新增 acceptance 状态、revision engine 或 ledger。
 */
export interface ReviewFeedbackIntake {
  issues: BlueprintIssue[];
  /** 过了 authority 门槛、**可以**进入 `decided_with_authority` 的候选 feedback_id。 */
  authoritativeRulingCandidateIds: string[];
  /** 结构合法、带证据的事实补充**候选**；被接受后才落入既有 revision 递进规则。 */
  factSupplementCandidateIds: string[];
  /**
   * 本批次是否存在**够格进入 reconciliation** 的候选（授权裁决或事实补充）。
   *
   * 它 **不**表示"已经要升 revision"——意见与建议永远不产生此类候选。
   */
  requiresReconciliation: boolean;
}

/**
 * reconciliation intake 校验。核心不变量：
 * - 只有 `authoritative_ruling` 且同时具备 authority + source_revision + 明确 decision
 *   语义者才能进入 `decided_with_authority`；
 * - 反馈的 source_revision 必须指向**当前被评审的 revision**，不得回写旧 revision；
 * - intake **只判候选资格**：既不接受反馈、也不改写任何 revision；被接受之后才由既有
 *   reconciliation 按「新事实、权威裁决 MUST 生成新 revision」处理。
 */
export function validateBlueprintReviewFeedback(
  value: unknown,
  blueprint: BlueprintRecord,
): ReviewFeedbackIntake {
  const doc = asRecord(value);
  if (!doc) {
    return {
      issues: [issue('review_feedback_root_invalid', '$', 'review feedback 根对象必须是 map。')],
      authoritativeRulingCandidateIds: [],
      factSupplementCandidateIds: [],
      requiresReconciliation: false,
    };
  }
  const out: BlueprintIssue[] = [];
  for (const violation of validateLiteSchema(doc, loadSchema('blueprint-review-feedback.schema.json'))) {
    out.push(issue('review_feedback_schema_invalid', violation.path, violation.message));
  }
  if (doc.artifact !== REVIEW_FEEDBACK_ARTIFACT) {
    out.push(issue('review_feedback_artifact_invalid', '$.artifact', `artifact 必须为 ${REVIEW_FEEDBACK_ARTIFACT}。`));
  }
  const currentRevision = Number(blueprint.revision);
  if (doc.blueprint_id !== blueprint.blueprint_id) {
    out.push(issue(
      'review_feedback_blueprint_mismatch',
      '$.blueprint_id',
      `feedback blueprint_id=${String(doc.blueprint_id)} 与目标蓝图 ${String(blueprint.blueprint_id)} 不一致。`,
    ));
  }
  if (doc.component_id !== blueprint.component_id) {
    out.push(issue(
      'review_feedback_component_mismatch',
      '$.component_id',
      `feedback component_id=${String(doc.component_id)} 与目标蓝图 ${String(blueprint.component_id)} 不一致；身份核验与 blueprint_id 同等 fail-closed。`,
    ));
  }
  if (Number(doc.source_revision) !== currentRevision) {
    out.push(issue(
      'review_feedback_stale_source_revision',
      '$.source_revision',
      `feedback 指向 revision=${String(doc.source_revision)}，当前 canonical revision=${currentRevision}；反馈必须针对当前 revision，合法裁决经调和产生新 revision，不得回写旧 revision。`,
    ));
  }

  let addresses: Map<string, BlueprintRecord>;
  try {
    addresses = stableAddressIndex(blueprint);
  } catch {
    addresses = new Map();
  }

  const rulingCandidateIds: string[] = [];
  const factCandidateIds: string[] = [];
  const seen = new Set<string>();
  asRecords(doc.items).forEach((item, index) => {
    const base = `$.items[${index}]`;
    const id = String(item.feedback_id ?? '');
    if (!nonEmptyString(id)) return;
    if (seen.has(id)) out.push(issue('review_feedback_duplicate', `${base}.feedback_id`, `feedback_id=${id} 重复。`));
    seen.add(id);

    if (Number(item.source_revision) !== Number(doc.source_revision)) {
      out.push(issue(
        'review_feedback_item_revision_mismatch',
        `${base}.source_revision`,
        `逐条 source_revision 必须与批次一致（批次 ${String(doc.source_revision)}，本条 ${String(item.source_revision)}）。`,
      ));
    }
    const target = String(item.target_ref ?? '');
    if (nonEmptyString(target) && addresses.size > 0 && !addresses.has(target)) {
      out.push(issue(
        'review_feedback_target_unresolvable',
        `${base}.target_ref`,
        `target_ref 无法在该 revision 内解析：${target}。`,
      ));
    }

    const kind = String(item.kind ?? '');
    if (kind === 'fact_supplement') {
      if (asStrings(item.evidence_refs).length === 0) {
        out.push(issue('review_feedback_fact_without_evidence', `${base}.evidence_refs`, '事实补充必须带 evidence_refs。'));
      } else {
        factCandidateIds.push(id);
      }
    }
    if (kind === 'authoritative_ruling') {
      const authority = asRecord(item.authority);
      const decision = asRecord(item.decision);
      const hasAuthority = Boolean(authority) && nonEmptyString(authority!.owner) && nonEmptyString(authority!.role);
      const hasDecision = Boolean(decision)
        && ['accept', 'reject', 'amend'].includes(String(decision!.verdict))
        && nonEmptyString(decision!.rationale);
      if (!hasAuthority || !hasDecision) {
        out.push(issue(
          'review_feedback_authority_insufficient',
          base,
          '声称授权裁决必须同时具备 authority（owner + role）与明确 decision（verdict + rationale）；不足者只能记为意见/事实补充/建议，不得进入 decided_with_authority。',
        ));
      } else {
        rulingCandidateIds.push(id);
      }
    } else if (asRecord(item.decision)) {
      out.push(issue(
        'review_feedback_non_ruling_carries_decision',
        `${base}.decision`,
        `kind=${kind} 不得携带 decision——只有 authoritative_ruling 有决策语义。`,
      ));
    }
  });

  const blocking = out.some(item => item.severity === 'BLOCKER');
  // 批次内有 BLOCKER → 不产出任何候选（fail-closed）。
  const rulings = blocking ? [] : rulingCandidateIds.sort();
  const facts = blocking ? [] : factCandidateIds.sort();
  return {
    issues: out,
    authoritativeRulingCandidateIds: rulings,
    factSupplementCandidateIds: facts,
    // 只表示"够格进入 reconciliation"；接受与否、是否真的升 revision 都不由 intake 决定。
    requiresReconciliation: rulings.length > 0 || facts.length > 0,
  };
}
