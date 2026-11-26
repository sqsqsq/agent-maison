// ============================================================================
// phase-closure-finalizer.unit.test.ts — summary 1.2 staged closure invariants
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { execFileSync } from 'child_process';
import {
  featurePhaseReportsDir,
  resolveReceiptFilePath,
} from '../../config';
import { clearFrameworkConfigCache } from '../../config';
import { finalizePhaseClosure } from '../../scripts/utils/phase-closure-finalizer';
import { syncPhaseStateOnReceiptPassStrict } from '../../scripts/utils/phase-state';
import { patchSummarySoftAdvisory } from '../../scripts/check-receipt';
import {
  loadPhaseEvidenceManifest,
  recomputePhaseEvidenceStaleness,
  resolvePhaseEvidenceManifest,
  sha256File,
} from '../../scripts/utils/phase-evidence-manifest';
import { prepareFeatureScopeCandidate } from '../../scripts/utils/feature-track';
import { buildGoalManifestFromInput } from '../../scripts/utils/goal-manifest';
import { createGoalRun, loadEffectiveExecutionScope } from '../../scripts/utils/goal-run-creation';
import { checkPlanAuthority } from '../../scripts/utils/scope-replan';
import type { HarnessRunSummary, CheckResult, Phase } from '../../scripts/utils/types';
import { generateScriptReport } from '../../scripts/utils/report-generator';
import { writeRunSummaryBase } from '../../harness-runner';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

interface Case {
  name: string;
  run: () => void;
}

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');
const FEATURE = 'demo';
const PHASE = 'spec';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/** Transaction fixtures publish current raw checks and the same derived summary as the real entry. */
function seedCurrentSummary(root: string, feature: string, phase: string, source: string, runId?: string, checks?: CheckResult[]): string {
  const previousRun = process.env.MAISON_GOAL_RUN_ID;
  if (runId) process.env.MAISON_GOAL_RUN_ID = runId; else delete process.env.MAISON_GOAL_RUN_ID;
  try {
    const report = generateScriptReport(path.join(FRAMEWORK_ROOT, 'harness'), phase as Phase, feature, root, checks ?? [{
      id: 'fixture_current_source', category: 'structure', severity: 'BLOCKER', description: 'controlled current input read for closure transaction',
      status: fs.readFileSync(path.join(root, source), 'utf8').trim() ? 'PASS' : 'FAIL', details: `Read actual current source: ${source}`,
    }], FRAMEWORK_ROOT);
    writeRunSummaryBase(root, report, FRAMEWORK_ROOT);
    return fs.readFileSync(path.join(featurePhaseReportsDir(root, feature, phase, FRAMEWORK_ROOT), 'summary.json'), 'utf8');
  } finally {
    if (previousRun === undefined) delete process.env.MAISON_GOAL_RUN_ID; else process.env.MAISON_GOAL_RUN_ID = previousRun;
  }
}

function mkProject(): {
  root: string;
  summaryPath: string;
  receiptPath: string;
  originalSummary: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-finalizer-'));
  fs.writeFileSync(
    path.join(root, 'framework.config.json'),
    JSON.stringify({
      schema_version: '1.1',
      project_name: 'phase-finalizer-test',
      project_profile: { name: 'generic' },
      agent_adapter: 'generic',
      architecture: {
        outer_layers: [{ id: 'app', can_depend_on: [], intra_layer_deps: 'forbid' }],
        module_inner_layers: ['content'],
        inner_dependency_direction: 'upward',
        cross_module_exports_file: 'index.ts',
      },
      paths: { features_dir: 'doc/features' },
    }),
    'utf8',
  );
  const featureRoot = path.join(root, 'doc', 'features', FEATURE);
  fs.mkdirSync(path.join(featureRoot, 'spec'), { recursive: true });
  fs.writeFileSync(path.join(featureRoot, 'spec', 'spec.md'), '# Demo\n', 'utf8');
  fs.writeFileSync(path.join(featureRoot, 'acceptance.yaml'), 'criteria: []\n', 'utf8');

  const summaryPath = path.join(
    featurePhaseReportsDir(root, FEATURE, PHASE, FRAMEWORK_ROOT),
    'summary.json',
  );
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  const originalSummary = seedCurrentSummary(root, FEATURE, PHASE, `doc/features/${FEATURE}/spec/spec.md`);

  const receiptPath = resolveReceiptFilePath(root, FEATURE, PHASE).path;
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, '# receipt\n\nclaimed: true\n', 'utf8');
  return { root, summaryPath, receiptPath, originalSummary };
}

function finalize(
  fixture: ReturnType<typeof mkProject>,
  persistPhaseState: () => void = () => undefined,
  assessAfterCommit?: () => unknown,
  faultAt?: 'after_staged_summary' | 'after_manifest_publish' | 'after_phase_state' | 'after_summary_rename',
) {
  return finalizePhaseClosure({
    projectRoot: fixture.root,
    frameworkRoot: FRAMEWORK_ROOT,
    feature: FEATURE,
    phase: PHASE,
    persistPhaseState,
    prepareEvidence: () => ({ extraInputs: [], extraOutputs: [], requirementSha: null }),
    now: () => new Date('2026-07-30T00:00:00.000Z'),
    assessAfterCommit,
    faultAt,
  });
}

function finalizeWithProductionEvidence(fixture: ReturnType<typeof mkProject>) {
  return finalizePhaseClosure({
    projectRoot: fixture.root,
    frameworkRoot: FRAMEWORK_ROOT,
    feature: FEATURE,
    phase: PHASE,
    persistPhaseState: () => undefined,
    now: () => new Date('2026-07-30T00:00:00.000Z'),
  });
}

function seedOldClosureBinding(fixture: ReturnType<typeof mkProject>): {
  manifestSha: string;
  pointerSha: string;
} {
  finalize(fixture);
  const oldManifest = loadPhaseEvidenceManifest(fixture.root, FEATURE, PHASE);
  assert(Boolean(oldManifest), 'old manifest missing');
  const oldPointer = oldManifest!.fileSha256; // plan 07a41ec6：回执指针已退出证据链，形状保留

  const reopened = JSON.parse(fixture.originalSummary) as HarnessRunSummary;
  reopened.warn_count = 1;
  fs.writeFileSync(fixture.summaryPath, JSON.stringify(reopened, null, 2), 'utf8');
  return { manifestSha: oldManifest!.fileSha256, pointerSha: oldPointer! };
}
// ============================================================================
// OWN-T1..T6（plan b5c1e9d7 §4 + codex review 返修）——闭环归属必须经**生产的最终闭环入口**产生。
// 既有 P1-T5 / P1-T12 只手工调 manifest writer 并手喂 `factsContext`，锁不住本缺陷：
// goal 的 `finalizePhaseClosure` 根本没有那个入参。这几条一律不喂 `factsContext`，
// 由 finalizer 自己按 `goalRunId`（goal 主路径）或 `summary.run_id`（恢复闭环）重建上下文。
// ============================================================================

const OWN_FEATURE = 'demo-own';
// 产品源码 inventory 只认 <模块根>/src/main（closure-attestation.ts:77）；后缀还必须落在
// profile 声明的 `sourceFileSuffixes` 里（hmos-app = `.ets`），否则归属侧按非源码处理。
const OWN_SOURCE = 'src/demo/src/main/BankPage.ets';
/** 合格 facts 允许声明的**非源码**研究来源（`context-facts.unit.test.ts:72` 同形）。 */
const OWN_NON_SOURCE = 'doc/research-notes.md';
/** **模块包路径内**的非源码文件：落在 coding 写边界内，plan c3f8a2d7 §3.1 起按写边界归 coding（与运行时写入归属一致）。 */
const OWN_MODULE_DOC = 'src/demo/src/main/README.md';
const OWN_REQUIREMENT = '把银行列表页接上真实数据源';

interface OwnershipProject {
  root: string;
  runId: string;
  chain: string[];
}

/**
 * 1.2（obligation-driven，与真实宿主 `framework.config.json:122` 同模式）的最小工程：
 * 候选与出生范围都走**生产函数**（`prepareFeatureScopeCandidate` = `--prepare-scope` CLI 的同一个
 * 函数），`context/facts.md` 是链首阶段的建立事实。不手写任何冻结字段。
 */
function mkOwnershipProject(requestedPhases: string[], approvedDesign = false): OwnershipProject {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'own-closure-')));
  const write = (rel: string, value: string): void => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, value, 'utf8');
  };
  write('framework.config.json', JSON.stringify({
    schema_version: '1.1',
    project_name: 'own-closure',
    // 必须是声明了 `sourceFileSuffixes` 的 profile——归属侧用它区分源码与文档研究来源
    // （`profiles/hmos-app/harness/coding-host-rules` = `['.ets']`；generic 没有该声明）。
    project_profile: { name: 'hmos-app', sub_variant: 'app' },
    active_workflow: 'obligation-driven',
    paths: { features_dir: 'doc/features' },
    architecture: {
      outer_layers: [{ id: 'src', can_depend_on: [] }],
      module_inner_layers: ['shared', 'data', 'domain', 'presentation'],
    },
  }));
  clearFrameworkConfigCache();
  write(OWN_SOURCE, 'export const banks: string[] = [];\n');
  write(OWN_NON_SOURCE, '# 研究笔记\n\n列表数据源现状。\n');
  write(OWN_MODULE_DOC, '# 模块说明\n\n本模块的对外说明。\n');
  // 纯验证范围（OWN-T3）：设计与验收都已批准在盘，spec/plan 没有未兑现义务、也没有
  // implementation 义务——链就只剩 review 自己。
  if (approvedDesign) {
    write(`doc/features/${OWN_FEATURE}/contracts.yaml`, YAML.stringify({
      feature: OWN_FEATURE, source: 'approved design', version: '1',
      modules: [{ name: 'demo', layer: 'src', package_path: 'src/demo' }],
      // 写集里**故意**混一个非源码路径：`contracts.schema.yaml` 只要求非空字符串，
      // 生产里确实可能出现（OWN-T7 的对象）。
      files: [OWN_SOURCE, OWN_NON_SOURCE, OWN_MODULE_DOC], module_dependencies: {}, data_models: [], interfaces: [], components: [],
      prd_to_code_traceability: [{ prd_id: 'AC-1', key_files: [OWN_SOURCE] }],
    }));
    write(`doc/features/${OWN_FEATURE}/acceptance.yaml`, YAML.stringify({
      feature: OWN_FEATURE, source: 'approved behavior', version: '1', boundaries: [],
      criteria: [{ id: 'AC-1', description: '银行列表展示', priority: 'P1', testable: true,
        verification_steps: ['打开页面'], expected_result: '列表可见', ut_layer: 'unit', ut_focus: ['列表渲染'] }],
    }));
  }
  // review 起链时生产链要算真实 diff 基线（`resolveEffectiveDiffBaseline`），所以工程必须是
  // 一个真 git 仓——不是为了造 diff，是为了让"基线可用"这个前提成立。
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'own@test');
  git('config', 'user.name', 'own');
  git('config', 'commit.gpgsign', 'false');
  git('add', '-A');
  git('commit', '-qm', 'baseline');
  const prepared = prepareFeatureScopeCandidate({
    projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, feature: OWN_FEATURE,
    completionTarget: 'feature', requestedResults: ['银行列表展示'],
    requestedPhases, requirement: OWN_REQUIREMENT, overwrite: true,
  });
  const chain = prepared.scope.phase_chain.map(String);
  const runId = `own-${chain[0]}`;
  const manifest = buildGoalManifestFromInput({
    feature: OWN_FEATURE, run_id: runId, requirement: OWN_REQUIREMENT,
    execution_scope: prepared.scope, chain_override: prepared.scope.phase_chain,
    unattended: { write_mode: 'full-access', approval_mode: 'never' },
  }, { projectRoot: root });
  createGoalRun({ frameworkRoot: FRAMEWORK_ROOT, projectRoot: root, manifest, chain: prepared.scope.phase_chain });
  // 建立事实：schema 1.1 + run 载体身份位 run_id（capability-resolution-entry-input.ts:290/:331）。
  write(`doc/features/${OWN_FEATURE}/context/facts.md`, [
    '---', 'schema_version: "1.1"', `feature: ${OWN_FEATURE}`, `run_id: ${runId}`,
    `established_by: ${chain[0]}`, 'ready_to_produce: true', 'has_blocker_coverage_risk: false',
    'exploration_mode: sequential', 'source_code_paths:', `  - ${OWN_SOURCE}`, `  - ${OWN_NON_SOURCE}`, `  - ${OWN_MODULE_DOC}`, '---', '',
    '## Code Facts', '', '| 路径 | 事实 | 对本阶段影响 |', '|------|------|--------------|',
    `| ${OWN_SOURCE} | 列表数据源为空 | 需要接入 |`, `| ${OWN_NON_SOURCE} | 现状记录 | 只读参考 |`, `| ${OWN_MODULE_DOC} | 模块说明 | 只读参考 |`, '',
  ].join('\n'));
  return { root, runId, chain };
}

/**
 * 真实读取本轮 facts，经报告/summary 生产链准备事务，再走生产最终闭环。
 *
 * `identity` 分两种，对应生产里真实存在的两类调用方：
 * - `'param'`：goal 主路径（`goal-phase-runtime.ts` 两处）——显式给 `goalRunId`；
 * - `'summary'`：`--sync-closure` / 恢复闭环（`utils/phase-state.ts`）——**不给** `goalRunId`
 *   （给了会顺带打开 requirement 血缘强制门，见 finalizer 里 `rebuildFactsContext` 的注释），
 *   身份只能从正在闭环的这份 summary 的 `run_id` 取。两种都不喂 `factsContext`。
 */
function closeOwnershipPhase(project: OwnershipProject, phase: string, consumed: string[], identity: 'param' | 'summary' = 'param'): void {
  const sources = consumed.map(file => {
    const pathToSource = path.join(project.root, file);
    return { path: file, exists: fs.existsSync(pathToSource), sha256: sha256File(pathToSource), role: 'artifact' };
  });
  seedCurrentSummary(project.root, OWN_FEATURE, phase, `doc/features/${OWN_FEATURE}/context/facts.md`, project.runId,
    [{ id: 'fixture_current_source', category: 'structure', description: 'current phase inputs', severity: 'BLOCKER', status: 'PASS',
      details: 'Read current source dependencies', affected_files: consumed, structured: { source_attempt_dependencies: sources } }]);
  finalizePhaseClosure({ projectRoot: project.root, frameworkRoot: FRAMEWORK_ROOT, feature: OWN_FEATURE,
    phase, persistPhaseState: () => undefined, ...(identity === 'param' ? { goalRunId: project.runId } : {}) });
}

function closureInput(project: OwnershipProject, phase: string, file: string) {
  const loaded = loadPhaseEvidenceManifest(project.root, OWN_FEATURE, phase);
  assert(Boolean(loaded?.integrityOk), `${phase}: manifest missing or tampered`);
  return loaded!.manifest.inputs.find(entry => entry.path === file);
}

const cases: Case[] = [
  {
    name: 'spec closure binds an actual source read and excludes unrelated research notes',
    run: () => {
      const project = mkOwnershipProject(['spec', 'plan', 'coding', 'review', 'ut', 'testing']);
      try {
        assert(!project.chain.includes('coding'), 'fixture starts with design only');
        closeOwnershipPhase(project, 'spec', [OWN_SOURCE]);
        assert(Boolean(closureInput(project, 'spec', OWN_SOURCE)), 'the checked source belongs to the original spec result');
        assert(!closureInput(project, 'spec', OWN_NON_SOURCE), 'unconsumed research notes do not enter the evidence');
        fs.appendFileSync(path.join(project.root, OWN_NON_SOURCE), '\nAnother investigation.\n');
        assert(recomputePhaseEvidenceStaleness(project.root, OWN_FEATURE, ['spec'], { frameworkRoot: FRAMEWORK_ROOT })[0].verdict === 'fresh', 'unconsumed changes leave the current result valid');
        fs.appendFileSync(path.join(project.root, OWN_SOURCE), '\nexport const nextBanks = true;\n');
        const drift = recomputePhaseEvidenceStaleness(project.root, OWN_FEATURE, ['spec'], { frameworkRoot: FRAMEWORK_ROOT, pendingOwnerPhase: 'coding' });
        assert(drift[0].verdict === 'stale' && drift[0].changed_paths.includes(OWN_SOURCE), JSON.stringify(drift));
      } finally { fs.rmSync(project.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
    },
  },
  {
    name: 'plan authority requires current bytes for a consumed source regardless of who is writing',
    run: () => {
      const project = mkOwnershipProject(['spec', 'plan', 'coding', 'review', 'ut', 'testing']);
      try {
        closeOwnershipPhase(project, 'spec', []);
        closeOwnershipPhase(project, 'plan', [OWN_SOURCE]);
        assert(Boolean(closureInput(project, 'plan', OWN_SOURCE)), 'the checked source belongs to the original plan result');
        const gate = { projectRoot: project.root, feature: OWN_FEATURE, frameworkRoot: FRAMEWORK_ROOT, currentRunId: project.runId };
        assert(checkPlanAuthority(gate).kind === 'ok', 'original plan evidence must qualify');
        fs.appendFileSync(path.join(project.root, OWN_SOURCE), '\nexport const nextBanks = true;\n');
        for (const pendingOwnerPhase of [undefined, 'coding']) {
          const result = checkPlanAuthority({ ...gate, pendingOwnerPhase });
          assert(result.kind === 'replan' && result.reason === 'live_drift', JSON.stringify(result));
        }
      } finally { fs.rmSync(project.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
    },
  },
  {
    name: 'sync closure preserves actual consumed inputs without an explicit goalRunId',
    run: () => {
      const project = mkOwnershipProject(['spec', 'plan', 'coding', 'review', 'ut', 'testing']);
      try {
        closeOwnershipPhase(project, 'spec', [OWN_SOURCE], 'summary');
        assert(closureInput(project, 'spec', OWN_SOURCE)?.sha256 === sha256File(path.join(project.root, OWN_SOURCE)), 'sync preserves the actual source binding');
        assert(!closureInput(project, 'spec', OWN_NON_SOURCE), 'unconsumed research notes do not enter the evidence');
        const current = recomputePhaseEvidenceStaleness(project.root, OWN_FEATURE, ['spec'], { frameworkRoot: FRAMEWORK_ROOT, runId: project.runId });
        assert(current[0].verdict === 'fresh', JSON.stringify(current));
      } finally { fs.rmSync(project.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
    },
  },
  {
    name: 'verification-only review is invalidated by a changed implementation it actually reviewed',
    run: () => {
      const project = mkOwnershipProject(['review'], true);
      try {
        assert(project.chain[0] === 'review' && !project.chain.includes('coding'), JSON.stringify(project.chain));
        closeOwnershipPhase(project, 'review', [OWN_SOURCE]);
        assert(Boolean(closureInput(project, 'review', OWN_SOURCE)), 'the actual reviewed source belongs to the original evidence');
        assert(!closureInput(project, 'review', OWN_MODULE_DOC), 'the unrelated module document was never checked');
        fs.appendFileSync(path.join(project.root, OWN_SOURCE), '\nexport const nextBanks = true;\n');
        const after = recomputePhaseEvidenceStaleness(project.root, OWN_FEATURE, ['review'], { frameworkRoot: FRAMEWORK_ROOT });
        assert(after[0].verdict === 'stale' && after[0].changed_paths.includes(OWN_SOURCE), JSON.stringify(after));
      } finally { fs.rmSync(project.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
    },
  },
  {
    name: 'facts 来源绑定经 closure finalizer 同样校验，变化或删除不得提交',
    run: () => {
      for (const mutation of ['unchanged', 'changed', 'deleted']) {
        const fixture = mkProject();
        const source = path.join(fixture.root, 'source.ts');
        fs.writeFileSync(source, 'before');
        const dependency = { path: source, exists: true, sha256: sha256File(source), role: 'derive' as const };
        if (mutation === 'changed') fs.writeFileSync(source, 'after');
        if (mutation === 'deleted') fs.unlinkSync(source);
        let failure = '';
        try {
          finalizePhaseClosure({
            projectRoot: fixture.root, frameworkRoot: FRAMEWORK_ROOT, feature: FEATURE, phase: PHASE,
            factsContext: { subject: { feature: FEATURE, run_id: 'run' }, first_phase: PHASE, source_paths: ['source.ts'], required_input_snippets: [], baseline: { established_by: PHASE, fingerprint: 'baseline', dependencies: [dependency] } },
            persistPhaseState: () => undefined,
            prepareEvidence: () => ({ extraInputs: [], extraOutputs: [], requirementSha: null }),
            assessAfterCommit: () => undefined,
          });
        } catch (error) { failure = (error as Error).message; }
        if (mutation === 'unchanged') assert(!failure, failure);
        else {
          assert(failure.includes('input binding stale'), failure || 'silently published changed facts source');
          assert(JSON.parse(fs.readFileSync(fixture.summaryPath, 'utf8')).closure_status !== 'closed', 'invalid source committed closure');
        }
      }
    },
  },
  {
    name: 'production evidence binds the project files that PASS checks actually executed',
    run: () => {
      const fixture = mkProject();
      const outsideRel = `../outside-${path.basename(fixture.root)}.ts`;
      const outsideAbs = path.resolve(fixture.root, outsideRel);
      try {
        // 被执行的证明源码：真实存在的项目文件，由 PASS check 的 affected_files 点名。
        const executed = path.join(fixture.root, 'src', 'demo', 'Executed.ts');
        fs.mkdirSync(path.dirname(executed), { recursive: true });
        fs.writeFileSync(executed, 'export function proven(): boolean { return true; }\n', 'utf8');
        // 两个负例必须单变量：文件都真实存在，被拒的原因只能是「当前明确不适用」和
        // 「路径越出项目根」，而不是被"文件不存在"顺带滤掉。
        const notExecuted = path.join(fixture.root, 'src', 'demo', 'NotExecuted.ts');
        fs.writeFileSync(notExecuted, 'export function unproven(): boolean { return true; }\n', 'utf8');
        fs.writeFileSync(outsideAbs, 'export function outside(): boolean { return true; }\n', 'utf8');
        const check = (id: string, files: string[]): CheckResult => ({ id, category: 'structure', severity: 'BLOCKER', status: 'PASS',
          description: 'controlled evidence reference', details: 'actual references supplied for production binding', affected_files: files });
        seedCurrentSummary(fixture.root, FEATURE, PHASE, `doc/features/${FEATURE}/spec/spec.md`, undefined, [
          { ...check('proven', ['src/demo/Executed.ts']), status: fs.readFileSync(executed, 'utf8').includes('return true') ? 'PASS' : 'FAIL' },
          { ...check('skipped', ['src/demo/NotExecuted.ts']), status: 'SKIP', structured: { applicability: 'not_applicable' } },
          check('ghost', ['src/demo/DoesNotExist.ts']), check('escape', [outsideRel]),
        ]);
        finalizeWithProductionEvidence(fixture);
        const manifest = loadPhaseEvidenceManifest(fixture.root, FEATURE, PHASE)!;
        const inputs = manifest.manifest.inputs.map((entry) => entry.path);
        // 没有这条绑定，改动被执行源码不会让任何阶段 stale，旧 PASS 报告会继续为其背书
        // （下游 component-closure-evidence.manifestTracksAuthority 正是消费它）。
        assert(inputs.includes('src/demo/Executed.ts'), `执行过的源码未进 manifest：${inputs.join(', ')}`);
        assert(fs.existsSync(notExecuted), 'NotExecuted.ts 未建出——该负例退化成"文件不存在"');
        assert(!inputs.some((p) => p.includes('NotExecuted')), '明确不适用 check 的对象不得冒充已执行证据');
        assert(!inputs.some((p) => p.includes('DoesNotExist')), '不存在的文件不得入证据链');
        assert(fs.existsSync(outsideAbs), '越界文件未建出——该负例退化成"文件不存在"');
        assert(!inputs.some((p) => p.includes('outside')), '越出项目根的路径不得入证据链');
        const bound = manifest.manifest.inputs.find((entry) => entry.path === 'src/demo/Executed.ts')!;
        assert(bound.exists === true && typeof bound.sha256 === 'string', '被执行源码未按字节登记');
        fs.writeFileSync(executed, 'export function proven(): boolean { return false; }\n', 'utf8');
        const stale = require('../../scripts/utils/phase-evidence-manifest')
          .recomputePhaseEvidenceStaleness(fixture.root, FEATURE, [PHASE]);
        assert(stale[0].verdict !== 'fresh', '改动被执行源码后该阶段仍判 fresh');
      } finally {
        fs.rmSync(outsideAbs, { force: true });
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'plan 07a41ec6 T7：summaryPatch 把 verifier_closure 写进闭环 summary（沿用既往 PASS 的诚实标注）',
    run: () => {
      const fixture = mkProject();
      try {
        const record = {
          mode: 'completed_with_prior_review',
          reviewed_subject_id: 'a'.repeat(64),
          current_subject_id: 'b'.repeat(64),
          current_material_not_reverified: ['doc/features/x/spec/spec.md'],
        };
        finalizePhaseClosure({
          projectRoot: fixture.root,
          frameworkRoot: FRAMEWORK_ROOT,
          feature: FEATURE,
          phase: PHASE,
          persistPhaseState: () => undefined,
          prepareEvidence: () => ({ extraInputs: [], extraOutputs: [], requirementSha: null }),
          now: () => new Date('2026-07-30T00:00:00.000Z'),
          summaryPatch: { verifier_closure: record },
        });
        const closed = JSON.parse(fs.readFileSync(fixture.summaryPath, 'utf8')) as Record<string, unknown>;
        assert(closed.closure_status === 'closed', 'summary 应闭环');
        assert(JSON.stringify(closed.verifier_closure) === JSON.stringify(record), `summaryPatch 应进入闭环 summary：${JSON.stringify(closed.verifier_closure)}`);
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'production evidence binds project fallback attempts but never framework contracts',
    run: () => {
      const fixture = mkProject();
      try {
        const preferred = path.join(fixture.root, 'doc', 'features', FEATURE, 'spec', 'preferred-input.md');
        const summary = JSON.parse(fs.readFileSync(fixture.summaryPath, 'utf8')) as Record<string, unknown>;
        summary.capability_resolutions = [{
          id: 'capability_spec_requirement', axis: 'functional', active: true, state: 'resolved',
          applicability_dependencies: [],
          inputs: [{
            id: 'requirement', state: 'resolved', selected_source: 'derive.requirement',
            selected_source_fingerprint: 'a'.repeat(64),
            attempts: [
              { kind: 'artifact', source: 'preferred@1', state: 'absent', dependencies: [{ path: preferred, exists: false, sha256: null, role: 'artifact' }] },
              { kind: 'derive', source: 'derive.requirement', state: 'resolved', dependencies: [] },
            ],
          }],
        }];
        summary.capability_resolution_contract_fingerprint = 'b'.repeat(64);
        fs.writeFileSync(fixture.summaryPath, JSON.stringify(summary, null, 2), 'utf8');
        finalizeWithProductionEvidence(fixture);
        const manifest = loadPhaseEvidenceManifest(fixture.root, FEATURE, PHASE)!;
        assert(manifest.manifest.inputs.some((entry) => entry.path.endsWith('preferred-input.md') && entry.exists === false), 'absent attempt not bound');
        assert(
          !manifest.manifest.inputs.some((entry) => entry.path.endsWith('skills/feature/spec/contract.yaml')),
          'framework contract must bind through contract_fingerprint, not feature evidence input',
        );
        fs.writeFileSync(preferred, 'now preferred\n', 'utf8');
        const stale = require('../../scripts/utils/phase-evidence-manifest').recomputePhaseEvidenceStaleness(fixture.root, FEATURE, [PHASE]);
        assert(stale[0].verdict === 'stale', JSON.stringify(stale[0]));
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'staged output hash is recorded under canonical summary path',
    run: () => {
      const fixture = mkProject();
      try {
        const finalBytes = '{"schema_version":"1.2","closure_status":"closed"}';
        const manifest = resolvePhaseEvidenceManifest({
          projectRoot: fixture.root,
          frameworkRoot: FRAMEWORK_ROOT,
          feature: FEATURE,
          phase: PHASE,
          stagedOutputs: [{
            canonicalPath: fixture.summaryPath,
            sha256: sha256(finalBytes),
          }],
        });
        const rel = path.relative(fixture.root, fixture.summaryPath).replace(/\\/g, '/');
        const entry = manifest.outputs.find((output) => output.path === rel);
        assert(Boolean(entry), 'canonical summary entry missing');
        assert(entry!.sha256 === sha256(finalBytes), 'manifest did not use staged hash');
        assert(entry!.sha256 !== sha256File(fixture.summaryPath), 'manifest used current open summary');
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'successful finalization publishes manifest-bound final summary last',
    run: () => {
      const fixture = mkProject();
      let persisted = 0;
      try {
        const result = finalize(fixture, () => { persisted += 1; });
        assert(result.transitioned, 'expected transition');
        assert(persisted === 1, `persist count=${persisted}`);
        const publishedRaw = fs.readFileSync(fixture.summaryPath, 'utf8');
        const published = JSON.parse(publishedRaw) as HarnessRunSummary;
        assert(published.closure_status === 'closed', 'summary not closed');
        assert(published.closure_commit?.schema_version === '1.0', 'closure_commit missing');
        assert(
          !Object.prototype.hasOwnProperty.call(published.closure_commit ?? {}, 'evidence_manifest_sha256'),
          'closure_commit must not contain manifest hash',
        );
        assert(result.closure_fingerprint === sha256(publishedRaw), 'closure fingerprint mismatch');
        const loaded = loadPhaseEvidenceManifest(fixture.root, FEATURE, PHASE);
        assert(Boolean(loaded), 'manifest missing');
        const rel = path.relative(fixture.root, fixture.summaryPath).replace(/\\/g, '/');
        const entry = loaded!.manifest.outputs.find((output) => output.path === rel);
        assert(entry?.sha256 === sha256(publishedRaw), 'manifest does not bind published summary');
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'phase-state failure occurs after canonical summary commit; retry only resyncs compatibility state',
    run: () => {
      const fixture = mkProject();
      try {
        const result = finalize(fixture, () => { throw new Error('state denied'); });
        assert(result.phase_state_error === 'state denied', 'expected state sync warning');
        assert(JSON.parse(fs.readFileSync(fixture.summaryPath, 'utf8')).closure_status === 'closed', 'summary must commit before state sync');
        const staged = fs.readdirSync(path.dirname(fixture.summaryPath))
          .filter((name) => name.includes('.staged-'));
        assert(staged.length === 0, `committed summary must not leave staged witness=${staged.join(',')}`);
        let resynced = 0;
        const recovered = finalize(fixture, () => { resynced += 1; });
        assert(recovered.transitioned === false, 'retry should observe already committed summary');
        assert(resynced === 1, 'retry must resync compatibility state');
        assert(JSON.parse(fs.readFileSync(fixture.summaryPath, 'utf8')).closure_status === 'closed', 'summary not closed');
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'legacy closed summary remains legacy_unverified until harness rerun',
    run: () => {
      const fixture = mkProject();
      try {
        const legacy = JSON.parse(fixture.originalSummary) as Record<string, unknown>;
        legacy.schema_version = '1.1';
        legacy.closure_status = 'closed';
        delete legacy.assurance;
        const legacyRaw = JSON.stringify(legacy, null, 2);
        fs.writeFileSync(fixture.summaryPath, legacyRaw, 'utf8');
        let message = '';
        try {
          finalize(fixture);
        } catch (error) {
          message = (error as Error).message;
        }
        assert(message.includes('legacy_unverified'), message);
        assert(fs.readFileSync(fixture.summaryPath, 'utf8') === legacyRaw, 'legacy summary changed');
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'blocked assurance cannot be finalized even if a malformed summary claims PASS',
    run: () => {
      const fixture = mkProject();
      try {
        const summary = JSON.parse(fixture.originalSummary) as HarnessRunSummary;
        summary.assurance = 'blocked';
        const raw = JSON.stringify(summary, null, 2);
        fs.writeFileSync(fixture.summaryPath, raw, 'utf8');
        let message = '';
        try { finalize(fixture); } catch (error) { message = (error as Error).message; }
        assert(message.includes('blocked capability assurance'), message);
        assert(fs.readFileSync(fixture.summaryPath, 'utf8') === raw, 'blocked summary must stay open');
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },  {
    name: 'missing assurance cannot be finalized',
    run: () => {
      const fixture = mkProject();
      try {
        const summary = JSON.parse(fixture.originalSummary) as HarnessRunSummary;
        delete summary.assurance;
        const unknownRaw = JSON.stringify(summary, null, 2);
        fs.writeFileSync(fixture.summaryPath, unknownRaw, 'utf8');
        let message = '';
        try {
          finalize(fixture);
        } catch (error) {
          message = (error as Error).message;
        }
        assert(message.includes('assurance'), message);
        assert(fs.readFileSync(fixture.summaryPath, 'utf8') === unknownRaw, 'missing-assurance summary changed');
        const staged = fs.readdirSync(path.dirname(fixture.summaryPath))
          .filter((name) => name.includes('.staged-'));
        assert(staged.length === 0, `staged leftovers=${staged.join(',')}`);
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'repeated finalization is idempotent after commit',
    run: () => {
      const fixture = mkProject();
      try {
        const first = finalize(fixture);
        const second = finalize(fixture);
        assert(first.transitioned, 'first should transition');
        assert(!second.transitioned, 'second should be no-op');
        assert(first.closure_fingerprint === second.closure_fingerprint, 'fingerprint changed');
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'direct receipt and sync-closure callers converge on identical commit bytes',
    run: () => {
      const direct = mkProject();
      // Compare the two callers against the same real source/report bytes, including their true project_root.
      const sync = direct;
      try {
        const directResult = finalize(direct);
        const directBytes = fs.readFileSync(direct.summaryPath, 'utf8');
        const directManifest = loadPhaseEvidenceManifest(direct.root, FEATURE, PHASE);
        fs.writeFileSync(sync.summaryPath, sync.originalSummary, 'utf8');
        fs.rmSync(path.join(path.dirname(sync.summaryPath), 'phase-evidence-manifest.json'));
        fs.writeFileSync(sync.receiptPath, '# receipt\n\nclaimed: true\n', 'utf8');
        const syncResult = finalize(sync, () => syncPhaseStateOnReceiptPassStrict(
          sync.root, FEATURE, PHASE, {
            status: 'passed',
            receipt_path: path.relative(sync.root, sync.receiptPath).replace(/\\\\/g, '/'),
          },
          { frameworkRoot: FRAMEWORK_ROOT },
        ));
        const syncBytes = fs.readFileSync(sync.summaryPath, 'utf8');
        assert(directBytes === syncBytes, 'entry routes published different summary bytes');
        assert(
          directResult.closure_fingerprint === syncResult.closure_fingerprint,
          'entry routes produced different closure fingerprints',
        );
        const syncManifest = loadPhaseEvidenceManifest(sync.root, FEATURE, PHASE);
        assert(
          directManifest?.manifest.aggregate_sha256 === syncManifest?.manifest.aggregate_sha256,
          'entry routes produced different evidence aggregate',
        );
        assert(fs.existsSync(path.join(sync.root, 'framework', 'harness', 'state', '.current-phase.json'))
          || fs.existsSync(path.join(sync.root, '.current-phase.json')), 'sync route did not persist phase state');
        const phaseStateSource = fs.readFileSync(path.resolve(__dirname, '../../scripts/utils/phase-state.ts'), 'utf8');
        const syncCallback = phaseStateSource.indexOf('persistPhaseState: () =>');
        const strictPersist = phaseStateSource.indexOf('syncPhaseStateOnReceiptPassStrict', syncCallback);
        assert(syncCallback >= 0 && strictPersist > syncCallback, 'sync route lost strict finalizer wiring');
      } finally {
        fs.rmSync(direct.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'post-commit assess result is returned after closure is durable',
    run: () => {
      const fixture = mkProject();
      try {
        const result = finalize(fixture, () => undefined, () => ({ recommendation: 'plan' }));
        assert(result.transitioned, 'closure did not commit');
        assert((result.assess as { recommendation?: string })?.recommendation === 'plan', 'assess result');
        assert(JSON.parse(fs.readFileSync(fixture.summaryPath, 'utf8')).closure_status === 'closed', 'not closed');
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'post-commit assess failure does not roll back a verified closure',
    run: () => {
      const fixture = mkProject();
      try {
        const result = finalize(fixture, () => undefined, () => { throw new Error('assess failed'); });
        assert(result.assess_error === 'assess failed', 'assess error not preserved');
        assert(JSON.parse(fs.readFileSync(fixture.summaryPath, 'utf8')).closure_status === 'closed', 'closure rolled back');
        assert(!finalize(fixture).transitioned, 'committed closure was not idempotent');
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },  {
    name: 'closed summary advisory is byte-preserving',
    run: () => {
      const fixture = mkProject();
      try {
        finalize(fixture);
        const before = fs.readFileSync(fixture.summaryPath, 'utf8');
        patchSummarySoftAdvisory(
          fixture.root,
          path.relative(fixture.root, path.dirname(fixture.summaryPath)).replace(/\\/g, '/'),
          { id: 'visual_multimodal_parity', status: 'SKIP', details: 'test advisory' },
        );
        const after = fs.readFileSync(fixture.summaryPath, 'utf8');
        assert(after === before, 'closed summary advisory changed manifest-bound bytes');
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'idempotent finalizer rejects mismatched closed summary bytes without rebinding them',
    run: () => {
      const fixture = mkProject();
      try {
        finalize(fixture);
        const manifestBefore = fs.readFileSync(
          path.join(path.dirname(fixture.summaryPath), 'phase-evidence-manifest.json'),
          'utf8',
        );
        const drifted = `${fs.readFileSync(fixture.summaryPath, 'utf8')}\n`;
        fs.writeFileSync(fixture.summaryPath, drifted, 'utf8');
        let message = '';
        try { finalize(fixture); } catch (error) { message = (error as Error).message; }
        assert(message.includes('禁止按当前字节重新绑定'), message);
        assert(fs.readFileSync(fixture.summaryPath, 'utf8') === drifted, 'drifted user bytes changed');
        assert(
          fs.readFileSync(path.join(path.dirname(fixture.summaryPath), 'phase-evidence-manifest.json'), 'utf8') === manifestBefore,
          'mismatched closed summary rewrote evidence manifest',
        );
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'old manifest plus staged-only crash cleans the unprovable runner temp and requires owner backtrack',
    run: () => {
      const fixture = mkProject();
      try {
        const old = seedOldClosureBinding(fixture);
        let crashed = false;
        try { finalize(fixture, () => undefined, undefined, 'after_staged_summary'); }
        catch (error) { crashed = (error as Error).message.includes('after_staged_summary'); }
        assert(crashed, 'staged-only crash was not injected');

        let message = '';
        try { finalize(fixture); } catch (error) { message = (error as Error).message; }
        assert(message.includes('无法证明'), `unexpected recovery result: ${message}`);
        const staged = fs.readdirSync(path.dirname(fixture.summaryPath))
          .filter((name) => name.includes('.staged-'));
        assert(staged.length === 0, `unprovable staged temp was not cleaned: ${staged.join(',')}`);
        assert(loadPhaseEvidenceManifest(fixture.root, FEATURE, PHASE)?.fileSha256 === old.manifestSha,
          'old manifest should remain untouched for owner invalidation');
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'new manifest proves the staged closure and recovery resumes it（plan 07a41ec6：回执指针已退出证据链）',
    run: () => {
      const fixture = mkProject();
      try {
        const old = seedOldClosureBinding(fixture);
        let crashed = false;
        try { finalize(fixture, () => undefined, undefined, 'after_manifest_publish'); }
        catch (error) { crashed = (error as Error).message.includes('after_manifest_publish'); }
        assert(crashed, 'manifest crash was not injected');

        const published = loadPhaseEvidenceManifest(fixture.root, FEATURE, PHASE);
        assert(Boolean(published), 'new manifest missing');
        assert(published!.fileSha256 !== old.manifestSha, 'new manifest did not replace the old binding');

        const recovered = finalize(fixture);
        assert(recovered.recovered_partial === true, 'new manifest transaction was not resumed');
        assert(JSON.parse(fs.readFileSync(fixture.summaryPath, 'utf8')).closure_status === 'closed',
          'recovery did not publish the canonical summary');
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'every closure publication cut is idempotently recoverable without stale rebinding',
    run: () => {
      const cuts = [
        'after_staged_summary',
        'after_manifest_publish',
        'after_phase_state',
        'after_summary_rename',
      ] as const;
      for (const cut of cuts) {
        const fixture = mkProject();
        try {
          let crashed = false;
          try { finalize(fixture, () => undefined, undefined, cut); }
          catch (error) { crashed = (error as Error).message.includes(`simulated closure crash at ${cut}`); }
          assert(crashed, `${cut} did not inject crash`);
          const recovered = finalize(fixture);
          const publishedRaw = fs.readFileSync(fixture.summaryPath, 'utf8');
          assert(JSON.parse(publishedRaw).closure_status === 'closed', `${cut} did not close summary`);
          const loaded = loadPhaseEvidenceManifest(fixture.root, FEATURE, PHASE);
          const rel = path.relative(fixture.root, fixture.summaryPath).replace(/\\/g, '/');
          assert(
            loaded?.manifest.outputs.find((output) => output.path === rel)?.sha256 === sha256(publishedRaw),
            `${cut} manifest does not bind canonical summary`,
          );
          assert(!finalize(fixture).transitioned, `${cut} repeat was not idempotent`);
          if (cut === 'after_manifest_publish') {
            assert(recovered.recovered_partial === true, `${cut} did not resume the published transaction`);
          }
        } finally {
          fs.rmSync(fixture.root, { recursive: true, force: true });
        }
      }
    },
  },
  {
    name: 'receipt is absent before closure and projected only after summary closes; projection failure is WARN-only',
    run: () => {
      const absent = mkProject();
      try {
        fs.unlinkSync(absent.receiptPath);
        const result = finalize(absent);
        assert(result.summary.closure_status === 'closed', 'summary should close without receipt input');
        assert(fs.existsSync(absent.receiptPath), 'closed summary should best-effort project receipt');
        assert(/receipt_schema:\s*"2\.1"/.test(fs.readFileSync(absent.receiptPath, 'utf8')), 'expected 2.1 projection');
      } finally {
        fs.rmSync(absent.root, { recursive: true, force: true });
      }

      const unwritable = mkProject();
      try {
        fs.unlinkSync(unwritable.receiptPath);
        fs.mkdirSync(unwritable.receiptPath);
        const result = finalize(unwritable);
        assert(result.summary.closure_status === 'closed', 'receipt projection failure must not roll back closure');
        assert(Boolean(result.receipt_projection_error), 'projection failure must be returned as warning detail');
        assert(JSON.parse(fs.readFileSync(unwritable.summaryPath, 'utf8')).closure_status === 'closed', 'closed summary must remain durable');
      } finally {
        fs.rmSync(unwritable.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'live closure mutex rejects a concurrent finalizer',
    run: () => {
      const fixture = mkProject();
      try {
        const lockPath = `${fixture.summaryPath}.finalize.lock`;
        fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }));
        let message = '';
        try { finalize(fixture); } catch (error) { message = (error as Error).message; }
        assert(message.includes('closure finalization busy'), message);
        assert(fs.readFileSync(fixture.summaryPath, 'utf8') === fixture.originalSummary, 'busy finalizer mutated summary');
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'stale closure mutex is recovered before finalization',
    run: () => {
      const fixture = mkProject();
      try {
        const lockPath = `${fixture.summaryPath}.finalize.lock`;
        fs.writeFileSync(lockPath, JSON.stringify({ pid: 2147483647, created_at: '2000-01-01T00:00:00.000Z' }));
        const result = finalize(fixture);
        assert(result.transitioned, 'stale lock was not recovered');
        assert(!fs.existsSync(lockPath), 'closure mutex leaked after finalization');
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map((testCase) => {
    try {
      testCase.run();
      return { name: testCase.name, ok: true };
    } catch (error) {
      return { name: testCase.name, ok: false, error: (error as Error).message };
    }
  });
}
