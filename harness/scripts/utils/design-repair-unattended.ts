// ============================================================================
// design-repair-unattended.ts — plan 9c3d7e1a §5.5：无人值守时 B1 由框架派设计修复自动接手（一次尝试）
// ----------------------------------------------------------------------------
// 整个尝试在两层锁内（蓝图锁 + 该蓝图下全部 canonical CU 的 feature 锁，运行时对本 feature 的锁借入）：
//   取锁 → 记 attempted（落盘成功才继续）→ 只复制蓝图文件到 run 目录下的草稿 → 编写调用（只许写草稿）→
//   草稿外改动核对 → 运行时作废草稿整份旧质询、登记新 revision 与修订依据、旧派生结论标 stale、机器派生并写回准入 →
//   独立质询调用（只许改质询结果）→ 再派生准入、真实校验（草稿对象 + 真实宿主根）→ 复核 canonical 基线字节 →
//   单文件 temp→rename 发布 → 同一锁内调和 → 放锁 → 探针（与停放后的探针同一判定）。
// 发布前失败丢弃草稿、不发布；发布后不回滚，调和未完成或探针不过记未恢复。不新增状态、账本或锁实现。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { deriveBlueprintAdmission } from './blueprint-admission';
import { reconcileP1DerivedResults } from './blueprint-reconciliation';
import { requiredQuestioningScopes, unchangedViewQuestioningScopes } from './blueprint-questioning';
import { resolveBlueprintTarget } from './blueprint-addressing';
import { blueprintSourceRefFiles, type DesignAuthorityFinding, type DesignRepairClass } from './blueprint-skill-projection';
import {
  HeldFeatureLock,
  acquireBlueprintWriteLocks,
  reconcileHeldBlueprintRefs,
} from './change-unit-design-preparation';
import { changeUnitDirectory, enumerateCanonicalChangeUnits, parseChangeUnitFeatureId } from './change-unit-path';
import { LIVENESS_BEACON_FILENAME } from './liveness-beacon';
import { componentBlueprintPath } from './component-blueprint-path';
import { BlueprintRecord, asRecord, asRecords } from './component-blueprint-model';
import { blockerIssues, validateComponentBlueprint, validateComponentBlueprintUpstream } from './component-blueprint-validator';
import { probeDesignAuthorityRecovered } from './condition-wait';
import {
  PhaseInvocationChange,
  capturePhaseInvocationSnapshot,
  diffPhaseInvocationSnapshots,
} from './phase-write-boundary';
import { stableStringify } from './phase-evidence-manifest';

export const DESIGN_REPAIR_PREAUTH_KEY = 'design_repair.unattended_b1';
/** 子契约文档（发布件内，相对框架根）。 */
export const DESIGN_REPAIR_CONTRACT_DOC = path.join('skills', 'reference', 'design-repair-unattended.md');
/** 质询方标识：与编写方不同；校验器另要求它不等于蓝图的 authored_by。 */
export const DESIGN_REPAIR_QUESTIONING_PROVIDER = 'design-repair-questioning';
/** 链外调用的用途标识——写进 agent_invoke_start / end 的 `phase`，不属于阶段链，阶段读者按 phase 过滤时看不到它们。 */
export type DesignRepairPurpose = 'author' | 'questioning';
export const designRepairInvokeLabel = (purpose: DesignRepairPurpose): string => `design-repair-${purpose}`;

export interface DesignRepairBriefLike { class: DesignRepairClass; items: DesignAuthorityFinding[] }

/** 停机签名：feature + 责任阶段 + 设计 owner 阻断的检查 id 与原因码（不含 run_id、时间、草稿版本——后继借不了这些绕过判重）。 */
export function designRepairSignature(feature: string, phase: string, items: ReadonlyArray<Pick<DesignAuthorityFinding, 'check' | 'codes'>>): string {
  const checks = items.map(item => `${item.check}[${[...item.codes].sort().join(',')}]`).sort();
  return crypto.createHash('sha256').update(stableStringify({ feature, phase, checks }), 'utf8').digest('hex');
}

/**
 * 同一签名是否已经尝试过：只认 `attempted`（落盘在派发之前；调用期间被删会由 events.jsonl 的只追加核对检出并补回）。
 * 事件来自当前 run 与既有祖先回放，不建账本。
 */
export function designRepairAttempted(events: ReadonlyArray<object>, signature: string): boolean {
  return (events as ReadonlyArray<Record<string, unknown>>).some(event => event.type === 'design_authority_repair' && event.action === 'content_repair'
    && event.stage === 'attempted' && event.signature === signature);
}

/** `containmentUnresolved`：子进程收容绑定失败且没能证明它已消失——不是普通失败，由运行时走既有 agent_containment_unresolved 处置。 */
export interface DesignRepairInvokeOutcome { started: boolean; ok: boolean; detail: string; containmentUnresolved?: boolean }

export interface UnattendedDesignRepairInput {
  projectRoot: string;
  frameworkRoot: string;
  feature: string;
  phase: string;
  runId: string;
  /** run 目录（工程相对）——草稿与调用日志都在这里，属于本次调用必要的运行时写入。 */
  reportDir: string;
  brief: DesignRepairBriefLike;
  signature: string;
  heldFeatureLock: HeldFeatureLock | null;
  /** 调用期间运行时自己会写的其它路径（本 feature 锁的心跳），工程相对。 */
  runtimeWrites: string[];
  emit: (event: Record<string, unknown>) => void;
  invoke: (purpose: DesignRepairPurpose, prompt: string) => Promise<DesignRepairInvokeOutcome>;
  /** 尝试期间多持的锁登记进运行时的统一放锁（信号处理也经它）；null = 已释放。 */
  registerLockRelease: (release: (() => void) | null) => void;
  /** 开始记录运行时经唯一发射口写出的事件行；返回的函数停止记录并交回记下的行（原顺序）。 */
  recordEventLines: () => () => Array<{ file: string; line: string }>;
}

export type UnattendedDesignRepairResult =
  | { outcome: 'not_dispatched'; reason: string }
  | { outcome: 'failed'; step: string; reason: string }
  /** 草稿外改动，或必需快照不可验证（`changes` 为空）——两者都走既有违规处置，不降为设计等待。 */
  | { outcome: 'violation'; step: DesignRepairPurpose; reason: string; changes: PhaseInvocationChange[]; preSnapshot: string; postSnapshot: string }
  | { outcome: 'published'; recovered: boolean; step?: string; revision: number; reason: string }
  /** 收容未证明消失：不发布、不再启动下一次调用、不挂设计探针。 */
  | { outcome: 'containment_unresolved'; step: DesignRepairPurpose; reason: string };

class AttemptFailure extends Error {
  constructor(
    readonly step: string, message: string,
    readonly violation?: Omit<Extract<UnattendedDesignRepairResult, { outcome: 'violation' }>, 'outcome' | 'reason' | 'step'>,
    readonly containmentUnresolved = false,
  ) { super(message); }
}

const canon = (value: unknown): string => stableStringify(value ?? null);
const reviewOf = (doc: BlueprintRecord): Record<string, unknown> => asRecord(doc.review_summary) ?? {};

/** 运行时随后覆盖的根 provenance 登记键（与下方登记同一组）。 */
const RUNTIME_PROVENANCE_KEYS = ['source_kind', 'source_ref', 'source_revision', 'observed_at', 'extraction_method'] as const;

const setOrDelete = (record: Record<string, unknown>, key: string, value: unknown): void => {
  if (value === undefined) delete record[key]; else record[key] = structuredClone(value);
};

/** 两份文档不同的位置（点分路径，对象逐键、等长数组逐项下钻；其余整体算一处）。 */
function differingPaths(a: unknown, b: unknown, at = ''): string[] {
  if (canon(a) === canon(b)) return [];
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.flatMap((item, i) => differingPaths(item, b[i], `${at}[${i}]`));
  const ra = asRecord(a);
  const rb = asRecord(b);
  if (ra && rb && !Array.isArray(a) && !Array.isArray(b)) {
    return [...new Set([...Object.keys(ra), ...Object.keys(rb)])].flatMap(key => differingPaths(ra[key], rb[key], at ? `${at}.${key}` : key));
  }
  return [at || '(根)'];
}

/**
 * 编写调用的授权边界（plan 9c3d7e1a t6 codex 第五轮）：草稿与基线逐字段比，只允许本次 B1 发现项定位到的字段子树
 *（映射过期只允许删掉那条引用）与运行时随后覆盖的字段（revision、根 provenance 五个登记键、derived_results）不同。
 * 做法：把这些位置在草稿副本里还原成基线值，剩下的差异就是越权的位置。
 */
export function outOfScopePaths(base: BlueprintRecord, draft: BlueprintRecord, blueprintId: string, items: readonly DesignAuthorityFinding[]): string[] {
  const normalized = structuredClone(draft);
  setOrDelete(normalized, 'revision', base.revision);
  setOrDelete(normalized, 'derived_results', base.derived_results);
  const provenance = asRecord(normalized.provenance);
  if (provenance) for (const key of RUNTIME_PROVENANCE_KEYS) setOrDelete(provenance, key, asRecord(base.provenance)?.[key]);
  const targetOf = (doc: BlueprintRecord, target: { kind: string; view_id?: string; id: string }): Record<string, unknown> | undefined => {
    try { return asRecord(resolveBlueprintTarget(doc, target as Parameters<typeof resolveBlueprintTarget>[1])); } catch { return undefined; }
  };
  for (const item of items) {
    for (const location of item.locations ?? []) {
      if (location.blueprint_id !== blueprintId) continue;
      const from = targetOf(base, location.target);
      const to = targetOf(normalized, location.target);
      if (!from || !to) continue;
      const keys = location.field.split('.');
      const leaf = keys.pop()!;
      const parentOf = (node: Record<string, unknown>): Record<string, unknown> | undefined => keys.reduce<Record<string, unknown> | undefined>((at, key) => asRecord(at?.[key]), node);
      const fromParent = parentOf(from);
      const toParent = parentOf(to);
      if (!fromParent || !toParent) continue;
      if (item.codes.includes('authority_content_not_machine_structure')) setOrDelete(toParent, leaf, fromParent[leaf]);
      // 映射过期：只允许删掉那条引用（改成别的值不算）。
      else if (item.codes.includes('authority_cu_mapping_stale') && !(leaf in toParent)) setOrDelete(toParent, leaf, fromParent[leaf]);
    }
  }
  return differingPaths(base, normalized);
}

const sha256Hex = (bytes: Buffer): string => crypto.createHash('sha256').update(bytes).digest('hex');

/** 蓝图工作区里现有的全部 run 事件文件（本 run、祖先 run 与兄弟 CU 的 run）：判重、预算与会话分段的输入。 */
function workspaceEventFiles(workspace: string): string[] {
  const files: string[] = [];
  const subdirs = (dir: string): string[] => {
    try { return fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => path.join(dir, entry.name)); } catch { return []; }
  };
  for (const unit of subdirs(workspace)) {
    for (const run of subdirs(path.join(unit, 'goal-runs'))) {
      const file = path.join(run, 'events.jsonl');
      if (fs.existsSync(file)) files.push(file);
    }
  }
  return files.sort();
}

/**
 * 事件文件的整文件期望值核对（调用期间它们唯一合法的写入者是运行时自己）：期望 = 调用前字节 + 运行时本次经发射口写出的行（原顺序）。
 * 实际不等于期望 → 记一条变化（按越界违规处置），并把文件整文件写回期望值——这是运行时自己的记录，写回后会话分段、attempted 与调用
 * 计数都与没被改过一样；不是还原工程文件。
 */
function restoreEventFiles(before: Map<string, Buffer>, written: ReadonlyArray<{ file: string; line: string }>, projectRoot: string): PhaseInvocationChange[] {
  const changes: PhaseInvocationChange[] = [];
  for (const [file, bytes] of before) {
    const expected = Buffer.concat([bytes, ...written.filter(item => path.resolve(item.file) === path.resolve(file)).map(item => Buffer.from(item.line, 'utf8'))]);
    let actual: Buffer | null;
    try { actual = fs.readFileSync(file); } catch { actual = null; }
    if (actual && actual.equals(expected)) continue;
    fs.writeFileSync(file, expected);
    changes.push({ path: path.relative(projectRoot, file).replace(/\\/g, '/'), how: actual ? 'modified' : 'removed', preSha256: sha256Hex(bytes), postSha256: actual ? sha256Hex(actual) : null });
  }
  return changes;
}

/** 草稿外改动的覆盖范围：工程根下全部顶层条目（依赖、缓存、构建目录按快照既有规则排除）。 */
function snapshotRoots(projectRoot: string): string[] {
  return fs.readdirSync(projectRoot).sort();
}

/** 运行时写回准入：只用校验器同源的派生函数；不复用作者对象（YAML 别名可能共享节点），整段换成新对象。 */
function writeBackAdmission(draft: BlueprintRecord, context: { projectRoot: string; canonicalPath: string }): ReturnType<typeof deriveBlueprintAdmission> {
  const derived = deriveBlueprintAdmission(draft, validateComponentBlueprintUpstream(draft, context));
  const review = reviewOf(draft);
  const admission = asRecord(review.admission) ?? {};
  const slice = asRecord(admission.current_slice);
  draft.review_summary = {
    ...review,
    admission: {
      ...admission,
      status: derived.status,
      root_questions_complete: derived.root_questions_complete,
      ...(slice ? { current_slice: { ...slice, contracts_ready: derived.contracts_ready, design_refs_ready: derived.design_refs_ready } } : {}),
      blocker_refs: derived.status === 'pass' ? [] : [...new Set(derived.blocker_ids)],
    },
  };
  return derived;
}

function authorPrompt(input: UnattendedDesignRepairInput, draftFile: string, canonicalRel: string): string {
  let contract = '';
  try { contract = fs.readFileSync(path.join(input.frameworkRoot, DESIGN_REPAIR_CONTRACT_DOC), 'utf8'); } catch { contract = `（子契约文档 ${DESIGN_REPAIR_CONTRACT_DOC} 读不到：以下规则仍然适用——只做 B1 修复、只依据既有事实、不改决定、不扩范围、不改 revision / provenance、不写 review_summary.admission 与质询结果。）`; }
  return [
    '# 无人值守设计修复 · 编写',
    `run ${input.runId} · ${input.feature} · ${input.phase} 的设计权威门报了 B1 类阻断（在既有授权内、依据明确）。按下面的修复简报只修这些问题。`,
    '',
    `草稿文件（唯一允许写入的文件）：${draftFile}`,
    `canonical 蓝图（只读，禁止写入，发布由框架完成）：${canonicalRel}`,
    '除草稿文件外，工程里任何文件（含 canonical 蓝图、Change Unit、需求、契约、产品源码、framework.local.json）都不得改动——改了即判越界写入，本次修复作废。',
    '',
    '## 修复简报',
    ...input.brief.items.map(item => `- 检查 ${item.check}［${item.codes.join(', ')}］→ 产物 ${item.artifacts.join('、') || '蓝图'}；只许改的位置：${(item.locations ?? []).map(at => `${at.target.kind}:${at.target.view_id ? `${at.target.view_id}/` : ''}${at.target.id}.${at.field}`).join('、') || '（未定位：本次不能改蓝图）'}；修法：${item.needs.join('；')}；依据：${item.basis}`),
    '',
    '## 子契约',
    contract.trim(),
  ].join('\n');
}

function questioningPrompt(input: UnattendedDesignRepairInput, draftFile: string, draft: BlueprintRecord): string {
  const scopes = [...requiredQuestioningScopes(draft)].map(([ref, kind]) => `- ${ref}（${kind}）`);
  const unchanged = [...unchangedViewQuestioningScopes(draft)].map(([ref, refs]) => `- ${ref}：须核实不变声明及其依据（answered_with_evidence，evidence_refs 至少含其一：${refs.join(', ') || '（未声明）'}）`);
  return [
    '# 蓝图独立质询',
    '你是独立质询方，与蓝图编写方隔离。输入只有：草稿蓝图、下面的结构化证据包，以及蓝图里已登记的外部输入（discovery 事实、需求与契约引用）。',
    '',
    `草稿文件：${draftFile}`,
    '只允许写入草稿里的 `review_summary.questioning`，草稿其余内容与工程里任何其它文件都不得改动。',
    `质询方标识 provider_id：${DESIGN_REPAIR_QUESTIONING_PROVIDER}`,
    '结果形状：status: complete；isolated_context: true；writes_ssot: false；frontier_budget；repeated_frontier_count；items[]（每项 question_id / question / frontier_fingerprint / owner / scope_kind / scope_ref / disposition / verification_refs / provenance，answered_with_evidence 另需 answer 与 evidence_refs）。',
    '',
    '## 必答范围（每个恰好一项）',
    ...scopes,
    ...(unchanged.length ? ['', '## verified_unchanged 视图', ...unchanged] : []),
  ].join('\n');
}

/**
 * 一次无人值守 B1 修复尝试。调用方负责前提（无人值守、B1、预授权、签名未尝试过）与之后的续跑判断。
 * 取不到锁 → `not_dispatched`，不写 attempted、不调用 adapter。
 */
export async function runUnattendedDesignRepair(input: UnattendedDesignRepairInput): Promise<UnattendedDesignRepairResult> {
  const { projectRoot } = input;
  const { blueprintId } = parseChangeUnitFeatureId(input.feature);
  const canonicalPath = componentBlueprintPath(projectRoot, blueprintId);
  const canonicalRel = path.relative(projectRoot, canonicalPath).replace(/\\/g, '/');
  const context = { projectRoot, canonicalPath };
  const base = {
    type: 'design_authority_repair', phase: input.phase, blueprint_id: blueprintId, action: 'content_repair', signature: input.signature,
    checks: input.brief.items.map(item => ({ check: item.check, codes: item.codes })),
  };
  const allChangeUnits = enumerateCanonicalChangeUnits(projectRoot, blueprintId).map(loaded => String(loaded.changeUnit.change_unit_id));
  const locks = acquireBlueprintWriteLocks(projectRoot, blueprintId, allChangeUnits, input.heldFeatureLock ? [input.heldFeatureLock] : []);
  if ('busy' in locks) return { outcome: 'not_dispatched', reason: `取不到两层锁，未派发（不消耗本签名的修复机会）：${locks.busy}` };
  input.registerLockRelease(locks.release);
  const release = (): void => { locks.release(); input.registerLockRelease(null); };
  let published: { revision: number } | undefined;
  const evidence: Record<string, unknown> = {};
  try {
    // 记账：attempted 落盘成功后才派发（appendFileSync 抛错即整次尝试中止、不调用 adapter）。
    input.emit({ ...base, stage: 'attempted', preauthorization: DESIGN_REPAIR_PREAUTH_KEY });
    const baseline = fs.readFileSync(canonicalPath);
    const baseDoc = YAML.parse(baseline.toString('utf8')) as BlueprintRecord;
    const draftDir = path.join(projectRoot, input.reportDir, 'design-repair');
    const draftFile = path.join(draftDir, 'component-blueprint.yaml');
    fs.rmSync(draftDir, { recursive: true, force: true });
    fs.mkdirSync(draftDir, { recursive: true });
    fs.writeFileSync(draftFile, baseline);
    // 核对范围：本任务的工作区（蓝图工作区：canonical 蓝图、全部 CU、各 run 的 manifest / run-control）不套用通用的运行时目录排除；
    // 本任务实际引用的输入（蓝图 source_ref 指向的项目内文件）即使在通常排除的目录里也逐个核；只排除调用期间运行时自己会写的路径。
    // 工作区里的事件文件按整文件期望值单独核（restoreEventFiles）。
    const runRel = input.reportDir.replace(/\\/g, '/').replace(/\/+$/, '');
    const workspace = changeUnitDirectory(projectRoot, blueprintId);
    const owned = [path.relative(projectRoot, workspace)];
    const eventFiles = workspaceEventFiles(workspace);
    const excluded = [
      `${runRel}/design-repair`, `${runRel}/phases/${designRepairInvokeLabel('author')}`, `${runRel}/phases/${designRepairInvokeLabel('questioning')}`,
      `${runRel}/progress.json`, `${runRel}/progress.md`, `${runRel}/${LIVENESS_BEACON_FILENAME}`, ...input.runtimeWrites,
      ...eventFiles.map(file => path.relative(projectRoot, file)),
    ];
    const relOf = (file: string): string => path.relative(projectRoot, file).replace(/\\/g, '/');
    const baselineRefs = blueprintSourceRefFiles(projectRoot, baseDoc).map(relOf);
    const guarded = async (purpose: DesignRepairPurpose, prompt: string, referenced: readonly string[]): Promise<ReturnType<typeof capturePhaseInvocationSnapshot>> => {
      // 根在调用前后各列一次：调用里新建的顶层条目也要进差集。
      const capture = (): ReturnType<typeof capturePhaseInvocationSnapshot> => capturePhaseInvocationSnapshot(
        { projectRoot, protectedRoots: snapshotRoots(projectRoot) }, { ownedPrefixes: owned, runtimeExcluded: excluded, includeFiles: referenced });
      const pre = capture();
      // 调用前就不可验证：还没有派出调用，尝试失败（不发布）；调用后不可验证：可能有越界写入而无从核对，按违规处置。
      if (pre.failureReason) throw new AttemptFailure(purpose, `调用前写归因快照不可核实（不得当作干净继续）：${pre.failureReason}`);
      const eventsBefore = new Map(eventFiles.map(file => [file, fs.readFileSync(file)] as const));
      const stopRecording = input.recordEventLines();
      let written: Array<{ file: string; line: string }> = [];
      let result: DesignRepairInvokeOutcome;
      try {
        result = await input.invoke(purpose, prompt);
      } finally {
        written = stopRecording();
      }
      if (!result.started) throw new AttemptFailure(purpose, `未启动：${result.detail}`);
      // 收容没能证明子进程已消失：它可能还在写，后面的核对与发布都没有意义——交运行时走既有收容停机。
      if (result.containmentUnresolved) throw new AttemptFailure(purpose, `调用的子进程收容失败且未证明已消失：${result.detail}`, undefined, true);
      const post = capture();
      const diff = diffPhaseInvocationSnapshots(pre, post);
      const eventChanges = restoreEventFiles(eventsBefore, written, projectRoot);
      if (diff.kind === 'unverifiable') {
        throw new AttemptFailure(purpose, `调用后写归因快照不可核实（不得当作干净继续）：${diff.reason}`, { changes: eventChanges, preSnapshot: pre.sha256, postSnapshot: post.sha256 });
      }
      const changes = [...(diff.kind === 'changed' ? diff.changes : []), ...eventChanges];
      if (changes.length) {
        throw new AttemptFailure(purpose, `${purpose === 'author' ? '编写' : '质询'}调用改了草稿之外的文件：${changes.map(change => change.path).slice(0, 20).join('、')}`,
          { changes, preSnapshot: pre.sha256, postSnapshot: post.sha256 });
      }
      if (!result.ok) throw new AttemptFailure(purpose, `调用失败：${result.detail}`);
      return pre;
    };
    const readDraft = (step: string): BlueprintRecord => {
      try {
        const doc = asRecord(YAML.parse(fs.readFileSync(draftFile, 'utf8')));
        if (!doc) throw new Error('根不是对象');
        return doc;
      } catch (error) { throw new AttemptFailure(step, `草稿读不出来：${(error as Error).message}`); }
    };
    const writeDraft = (doc: BlueprintRecord): void => fs.writeFileSync(draftFile, YAML.stringify(doc));

    // ② 编写修复。
    const preAuthor = await guarded('author', authorPrompt(input, draftFile, canonicalRel), baselineRefs);
    const authored = readDraft('author');
    // 编写调用新引用的输入文件：调用前没有进核对（位于通常排除的目录），它在调用期间是否被改无从核实——不当作干净继续。
    const draftRefs = blueprintSourceRefFiles(projectRoot, authored).map(relOf);
    const unverified = draftRefs.filter(ref => !baselineRefs.includes(ref) && !preAuthor.entries.some(entry => entry.path === ref));
    if (unverified.length) {
      throw new AttemptFailure('author', `编写调用新引用了调用前未核对的输入文件，调用期间是否被改无从核实：${unverified.join('、')}`,
        { changes: [], preSnapshot: preAuthor.sha256, postSnapshot: preAuthor.sha256 });
    }
    // 自报：编写调用不得写准入、不得写质询结果（与基线比对，字节语义不变）。
    for (const field of ['admission', 'questioning'] as const) {
      if (canon(reviewOf(authored)[field]) !== canon(reviewOf(baseDoc)[field])) throw new AttemptFailure('self_reported', `编写调用改了 review_summary.${field}（自报，不予采信）`);
    }
    // 授权边界：只许改本次 B1 发现项定位到的字段；越权 = 尝试失败、丢弃草稿、不发布（canonical 未变，不走越界违规出口）。
    const outside = outOfScopePaths(baseDoc, authored, blueprintId, input.brief.items);
    if (outside.length) {
      throw new AttemptFailure('author_scope', `编写调用改了本次 B1 发现项定位之外的蓝图内容（越权，不发布）：${outside.slice(0, 20).join('、')}${outside.length > 20 ? ` 等 ${outside.length} 处` : ''}`);
    }
    // ③ 运行时：作废草稿整份旧质询（canonical 历史不动）；登记新 revision 与修订依据（根 provenance）；旧派生结论标 stale；机器派生并写回准入。
    const revision = Number(baseDoc.revision) + 1;
    const review = { ...reviewOf(authored) };
    delete review.questioning;
    authored.review_summary = review;
    authored.revision = revision;
    authored.provenance = {
      ...asRecord(authored.provenance),
      source_kind: 'design_repair_unattended',
      source_ref: `framework.local.json#${DESIGN_REPAIR_PREAUTH_KEY}`,
      source_revision: `revision-${String(baseDoc.revision)}`,
      observed_at: new Date().toISOString(),
      extraction_method: `unattended_b1_repair:${input.brief.items.map(item => `${item.check}[${item.codes.join(',')}]`).join(';')}`,
    };
    // 派生结论只从基线派生，作者对它的改动不采信（与上方"运行时覆盖"的豁免一致）：旧结论按既有规则标 stale、保留原输入版本。
    if (Array.isArray(baseDoc.derived_results)) {
      authored.derived_results = reconcileP1DerivedResults(asRecords(baseDoc.derived_results), revision, String(authored.source_fingerprint), String(authored.decision_fingerprint));
    } else delete authored.derived_results;
    const invalidated = writeBackAdmission(authored, context);
    evidence.admission_after_invalidation = invalidated.status;
    writeDraft(authored);
    const beforeQuestioning = readDraft('questioning');

    // ④ 独立质询：隔离的第二次调用，只许改质询结果。
    await guarded('questioning', questioningPrompt(input, draftFile, beforeQuestioning), [...new Set([...baselineRefs, ...draftRefs])]);
    const questioned = readDraft('questioning');
    const strip = (doc: BlueprintRecord): unknown => { const r = { ...reviewOf(doc) }; delete r.questioning; return { ...doc, review_summary: r }; };
    if (canon(strip(questioned)) !== canon(strip(beforeQuestioning))) throw new AttemptFailure('questioning', '质询调用改了质询结果之外的内容');
    if (!asRecord(reviewOf(questioned).questioning)) throw new AttemptFailure('questioning', '质询调用正常退出但没有产出质询结果（不沿用旧报告）');
    const derived = writeBackAdmission(questioned, context);
    evidence.admission_after_questioning = derived.status;
    // ⑤ 机器裁决：发布的就是这份字节——对它的解析结果（草稿对象）按真实宿主根与 canonical 路径校验。
    const text = YAML.stringify(questioned);
    const blockers = blockerIssues(validateComponentBlueprint(YAML.parse(text), context));
    if (derived.status !== 'pass' || blockers.length) {
      throw new AttemptFailure('validation', `草稿未通过校验 / 准入（${derived.status}）：${blockers.map(issue => `${issue.id}@${issue.path}`).slice(0, 12).join(', ')}`);
    }
    fs.writeFileSync(draftFile, text);
    // ⑥ 发布：单写者，先复核 canonical 字节仍等于基线（两层锁约束不了所有手工写入者）；rename 成功即发布边界。
    if (!fs.readFileSync(canonicalPath).equals(baseline)) throw new AttemptFailure('publish', 'canonical 蓝图在尝试期间被别处改动，不发布');
    const tmp = `${canonicalPath}.tmp-${process.pid}`;
    try {
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, canonicalPath);
    } catch (error) {
      fs.rmSync(tmp, { force: true });
      throw new AttemptFailure('publish', `发布写出失败（canonical 保持原字节）：${(error as Error).message}`);
    }
    published = { revision };
    // ⑦ 同一锁内调和（CU 指针升到新 revision）。抛错或自行回滚 = 已发布、调和未完成，不回滚发布。
    const { changeUnitId } = parseChangeUnitFeatureId(input.feature);
    let reconcileNote: string;
    let reconciled = false;
    try {
      const result = reconcileHeldBlueprintRefs(projectRoot, blueprintId, locks);
      const own = result.skipped.find(item => item.change_unit_id === changeUnitId);
      reconciled = !result.busy && !own && result.bumped.some(item => item.change_unit_id === changeUnitId);
      reconcileNote = result.busy ?? (own ? `本 CU 被调和器跳过：${own.reasons.join('；')}` : reconciled ? '本 CU 指针已升到新 revision' : '本 CU 未被升版');
      Object.assign(evidence, { bumped: result.bumped, skipped: result.skipped });
    } catch (error) {
      reconcileNote = `调和失败：${(error as Error).message}`;
    }
    release();
    const common = { ...base, stage: 'published', new_revision: revision, files: [canonicalRel], review_projection_stale: true, ...evidence };
    if (!reconciled) {
      const reason = `已发布 rev ${revision}、调和未完成：${reconcileNote}`;
      input.emit({ ...common, outcome: 'unrecovered', failed_step: 'reconcile', reason });
      return { outcome: 'published', recovered: false, step: 'reconcile', revision, reason };
    }
    // ⑧ 探针：与停放后的探针同一判定，显式传入本次真实阻断。
    const probe = probeDesignAuthorityRecovered(projectRoot, input.feature, input.phase, input.brief.items.map(item => item.check), input.runId);
    if (!probe.ready) {
      const reason = `已发布 rev ${revision}、探针未通过（记未恢复）：${probe.reason ?? ''}`;
      input.emit({ ...common, outcome: 'unrecovered', failed_step: 'probe', reason });
      return { outcome: 'published', recovered: false, step: 'probe', revision, reason };
    }
    const reason = `已发布 rev ${revision} 并调和，${probe.reason ?? '探针就绪'}`;
    input.emit({ ...common, outcome: 'recovered', reason });
    return { outcome: 'published', recovered: true, revision, reason };
  } catch (error) {
    release();
    const failure = error instanceof AttemptFailure ? error : new AttemptFailure(published ? 'post_publish' : 'runtime', (error as Error).message);
    if (published) {
      // 发布之后的意外：不回滚、不落入草稿失败分支。
      const reason = `已发布 rev ${published.revision}、之后失败：${failure.message}`;
      input.emit({ ...base, stage: 'published', new_revision: published.revision, files: [canonicalRel], outcome: 'unrecovered', failed_step: failure.step, reason, ...evidence });
      return { outcome: 'published', recovered: false, step: failure.step, revision: published.revision, reason };
    }
    fs.rmSync(path.join(projectRoot, input.reportDir, 'design-repair'), { recursive: true, force: true });
    const files = failure.violation?.changes.slice(0, 50).map(change => ({ path: change.path, how: change.how, pre_sha256: change.preSha256, post_sha256: change.postSha256 }));
    input.emit({ ...base, stage: 'failed', failed_step: failure.step, reason: failure.message, ...(files?.length ? { files } : {}), ...evidence });
    if (failure.containmentUnresolved) return { outcome: 'containment_unresolved', step: failure.step as DesignRepairPurpose, reason: failure.message };
    if (failure.violation) return { outcome: 'violation', step: failure.step as DesignRepairPurpose, reason: failure.message, ...failure.violation };
    return { outcome: 'failed', step: failure.step, reason: failure.message };
  }
}
