// ============================================================================
// adjudication.unit.test.ts — 统一裁决内核契约与元门禁（plan a5f9c3e2 t4）
// ----------------------------------------------------------------------------
// 覆盖：
//   ① 三条分层铁律（facts 不产授权 / authority 不改事实 / can_prompt_now ≠ 已授权）
//   ② 一致性契约 (a) 相同原始证据 → 相同 canonical facts（provenance 允许不同）
//   ③ 一致性契约 (b) 相同 facts+authority+context → 相同决定
//   ④ 元门禁：goal-runner 的 halt_reason 全集必须在 INCIDENT_REGISTRY 注册（未注册即红）
//   ⑤ 立项两事故的闭环断言（含「agent 自行触发 reset 一无所获」负例）
//   ⑥ lint：新增 gate 不得直接读 goal env（存量 legacy 豁免清单）
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  INCIDENT_REGISTRY,
  isStructuralFactsIncident,
  NO_AUTHORITY,
  UNTRUSTED_DRIFT_REASON,
  canPromptNow,
  canonicalDriftFields,
  canonicalizeSourceDrift,
  decide,
  dispositionOf,
  incidentClassOf,
  lookupIncident,
  normalizeIncidentId,
  runDispositionFields,
  withRunDisposition,
  projectToObservedActionability,
  type AuthorityFacts,
  type ExecutionContext,
  type IncidentClass,
  type IncidentFacts,
  type SourceDriftFacts,
} from '../../scripts/utils/adjudication';
import { partitionDriftByGitStatus } from '../../scripts/utils/source-drift-facts';
import {
  EXTERNAL_RETRY_RESPONSIBILITY_KINDS,
  resolveAssessHaltIncident,
} from '../../scripts/utils/goal-failure-classifier';
import { resolveRequirementInput } from '../../scripts/utils/goal-manifest';
import { reduceRunState, supervisorAction } from '../../scripts/utils/run-state-reducer';
import {
  renderPhaseDiagnosticProse,
  renderPhaseDispositionCell,
} from '../../scripts/utils/goal-report-generator';
import {
  buildGoalManifestFromInput,
  computeManifestIdentityFields,
  inheritSuccessorManifest,
  isSuccessorRepairRequirement,
  mergeSuccessorRequirement,
  SUCCESSOR_REQUIREMENT_INCREMENT_MARKER,
  type GoalManifest,
} from '../../scripts/utils/goal-manifest';

const SCRIPTS_DIR = path.resolve(__dirname, '..', '..', 'scripts');

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEq<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}（期望 ${String(expected)}，实得 ${String(actual)}）`);
}

/**
 * 剥「整行注释」，保持字符偏移不变（等长空白替换）——源码级断言只看代码，不看散文。
 *
 * 刻意**按行**做而不用跨行正则：`/\*[\s\S]*?\*\//` 会被源码里正则字面量/字符串中的
 * `/*` 触发假阳性（实测吞掉 17904 字符、把整段真代码抹平，断言随之全部误红）。
 * 本文件的断言只需要屏蔽独立成行的注释，按行判定足够且不会误伤。
 */
function stripComments(raw: string): string {
  return raw
    .split('\n')
    .map((line) => {
      const t = line.trimStart();
      return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')
        ? ' '.repeat(line.length)
        : line;
    })
    .join('\n');
}

function ctx(over: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    orchestration: 'goal',
    owner_kind: 'process',
    can_prompt_now: false,
    invocation: 'fresh',
    ...over,
  };
}

function tmpProject(run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adjudication-'));
  try { run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

interface TestCase { name: string; run: () => void }

// ---------------------------------------------------------------------------
// ① 三条分层铁律
// ---------------------------------------------------------------------------

const ironLawCases: TestCase[] = [
  {
    name: '铁律(b)：decide 不修改入参（facts / authority / context 全部 frozen 亦可运行）',
    run: () => {
      const facts = Object.freeze<IncidentFacts>({
        incident: 'unauthorized_source_mutation',
        chain_has_coding_review: true,
        backtrack_budget_remaining: 1,
      });
      const authority = Object.freeze<AuthorityFacts>({ grants: Object.freeze([]) as never });
      const context = Object.freeze(ctx());
      const before = JSON.stringify({ facts, authority, context });
      decide(facts, authority, context);
      assert(JSON.stringify({ facts, authority, context }) === before, 'decide 修改了入参');
    },
  },
  {
    name: '只有已验证 grant 放行：binding 为空的 grant 不采信',
    run: () => {
      const facts: IncidentFacts = { incident: 'await_human_visual_confirm' };
      const empty = decide(
        facts,
        { grants: [{ action: 'human_visual_acceptance', source: 'verified_receipt', binding: '' }] },
        ctx(),
      );
      assert(empty.kind === 'waiting', '空 binding 的 grant 不得放行');
      const ok = decide(
        facts,
        { grants: [{ action: 'human_visual_acceptance', source: 'verified_receipt', binding: 'sha256:abc' }] },
        ctx(),
      );
      assert(ok.kind === 'continue', `已验证 grant 应放行，实际 ${ok.kind}`);
    },
  },
];

// ---------------------------------------------------------------------------
// ② / ③ 一致性契约
// ---------------------------------------------------------------------------

const consistencyCases: TestCase[] = [
  {
    name: '契约(a)：同一原始证据经两个 provider 归一后 canonical facts 逐字段相等（provenance 允许不同）',
    run: () => {
      // goal provider 形态：closure attestation 直接给出三元组
      const goalSide: SourceDriftFacts = canonicalizeSourceDrift({
        added: ['src/main/ets/B.ets', 'src/main/ets/A.ets'],
        modified: ['src/main/ets/C.ets'],
        deleted: [],
        provenance: 'review-closure-attestation:bc-openCard',
        baseline_kind: 'review_closure_attestation',
      });
      // direct provider 形态：同一份证据经 git 分区（无 baseRef → 全部 modified 是保守分类，
      // 故此处用 untracked 显式表达 added，验证「同证据同 canonical」）
      const directSide = partitionDriftByGitStatus({
        projectRoot: path.resolve(__dirname),
        baseRef: undefined,
        files: ['src\\main\\ets\\A.ets', 'src/main/ets/B.ets', 'src/main/ets/C.ets'],
        untrackedFiles: ['src/main/ets/A.ets', 'src\\main\\ets\\B.ets'],
        provenance: 'trace-start-commit:deadbeef',
      });
      assert(
        JSON.stringify(canonicalDriftFields(goalSide)) === JSON.stringify(canonicalDriftFields(directSide)),
        `canonical facts 不等：\n  goal=${JSON.stringify(canonicalDriftFields(goalSide))}` +
        `\n  direct=${JSON.stringify(canonicalDriftFields(directSide))}`,
      );
      // 来源字段允许不同，且**不入等值断言**
      assert(goalSide.provenance !== directSide.provenance, 'provenance 本就应不同');
      assert(goalSide.baseline_kind !== directSide.baseline_kind, 'baseline_kind 本就应不同');
    },
  },
  {
    name: '契约(a)：canonical 归一（POSIX / 去重 / 排序）稳定',
    run: () => {
      const f = canonicalizeSourceDrift({
        added: ['b/x.ts', 'a\\y.ts', 'b/x.ts', '  '],
        modified: [], deleted: [],
        provenance: 'p', baseline_kind: 'trace_start_commit',
      });
      assert(JSON.stringify(f.added) === JSON.stringify(['a/y.ts', 'b/x.ts']), JSON.stringify(f.added));
    },
  },
  {
    name: '契约(b)：相同 facts+authority+context → 相同决定（决定性）',
    run: () => {
      for (const incident of Object.keys(INCIDENT_REGISTRY)) {
        const facts: IncidentFacts = { incident, chain_has_coding_review: true, backtrack_budget_remaining: 2 };
        const a = decide(facts, NO_AUTHORITY, ctx());
        const b = decide({ ...facts }, { grants: [] }, ctx());
        assert(JSON.stringify(a) === JSON.stringify(b), `${incident}: 决定不稳定`);
      }
    },
  },
  {
    name: 'disposition 投影覆盖四态且与 decide 一一对应',
    run: () => {
      assert(dispositionOf({ kind: 'continue', reason: '' }) === 'RESUME_READY', 'continue');
      assert(dispositionOf({ kind: 'recover', action: 'backtrack_to_coding', reason: '' }) === 'RECOVERY_PENDING', 'recover');
      assert(dispositionOf({ kind: 'waiting', wait_kind: 'human', reason: '' }) === 'WAITING', 'waiting');
      assert(dispositionOf({ kind: 'terminal', reason: '' }) === 'TERMINAL', 'terminal');
    },
  },
  {
    name: '普通模式等值：partition 只分区不增删——union 排序后与改造前 changedFiles 口径逐字相等',
    run: () => {
      // 改造前：businessChanges = filterProtected(diff.changedFiles)，而 diff.changedFiles
      // 是 normalizeSorted（POSIX + sort）的结果。改造后走 partition 再 union 排序。
      const before = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'].sort();
      const facts = partitionDriftByGitStatus({
        projectRoot: path.resolve(__dirname),
        baseRef: undefined, // 无 baseRef → 无 status，保守全归 modified
        files: before,
        untrackedFiles: ['src/d.ts'],
        provenance: 'p',
      });
      const after = [...new Set([...facts.added, ...facts.modified, ...facts.deleted])].sort();
      assert(JSON.stringify(after) === JSON.stringify(before), `集合口径变了：${JSON.stringify(after)}`);
      // 分区本身：untracked 归 added，其余保守归 modified（集合不变、分类保守）
      assert(JSON.stringify(facts.added) === JSON.stringify(['src/d.ts']), JSON.stringify(facts.added));
      assert(facts.deleted.length === 0, '无 status 时不得凭空判删除');
    },
  },
  {
    name: 'canPromptNow 单一产地：session=可问、process=不可问',
    run: () => {
      assert(canPromptNow('session') === true, 'session');
      assert(canPromptNow('process') === false, 'process');
    },
  },
];

// ---------------------------------------------------------------------------
// ④ 元门禁
// ---------------------------------------------------------------------------

/**
 * 非 halt_reason 的同行噪声（action 值 / 事件名）——显式列出，新增须具名豁免。
 */
const NON_HALT_REASON_TOKENS: ReadonlySet<string> = new Set(['halt', 'phase_halt', 'run_end']);

/**
 * 从 span 里剥掉**比较操作数**再提取——`failureKind === 'toolchain' ? 'no_progress_…'`
 * 里的 `'toolchain'` 是判据不是 incident id。不剥会把它误报成未注册
 *（且此前只是被 300 字符截断侥幸掩盖，属同一类脆弱）。
 */
const stripComparisonOperands = (span: string): string =>
  span.replace(/[!=]==?\s*'[^']*'/g, ' ');

function scanHaltReasonLiteralsIn(src: string): string[] {
  const spans: string[] = [];
  // 窗口放宽到 600：展开后的多分支三元比 300 长，截断会让后面的分支静默逃逸
  //（此前 no_progress_* 家族正是这样漏掉的）。
  for (const m of src.matchAll(/haltReason\s*=[\s\S]{0,600}?;/g)) spans.push(m[0]);
  for (const m of src.matchAll(/halt_reason:\s*[\s\S]{0,200}?[,}]/g)) spans.push(m[0]);
  const hits = new Set<string>();
  for (const span of spans.map(stripComparisonOperands)) {
    for (const m of span.matchAll(/'([a-z][a-z0-9_]{3,})'/g)) {
      if (!NON_HALT_REASON_TOKENS.has(m[1])) hits.add(m[1]);
    }
  }
  return [...hits].sort();
}

/**
 * 元门禁扫描域（codex 七轮 P1 订正）：**不能只扫 goal-runner.ts**。
 * halt_reason 还由 session driver 与 delegated producer 产出——
 * 只扫单文件会让「全覆盖」变成虚的（实测漏掉 in_session_* / device_* / no_progress_* 等
 * 约 10 条）。这里递归扫 scripts/ 全树，新增产出点自动进扫描域。
 */
function scanHaltReasonLiterals(): string[] {
  const hits = new Set<string>();
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!e.isFile() || !e.name.endsWith('.ts')) continue;
      for (const r of scanHaltReasonLiteralsIn(fs.readFileSync(abs, 'utf8'))) hits.add(r);
    }
  };
  walk(SCRIPTS_DIR);
  return [...hits].sort();
}

function scanGoalEnvOffenders(files: Array<{ name: string; text: string }>): string[] {
  return files
    .filter((f) => !GOAL_ENV_LEGACY_ALLOWLIST.has(f.name) && GOAL_ENV_PATTERN.test(f.text))
    .map((f) => f.name);
}

const metaGateCases: TestCase[] = [
  {
    name: '元门禁：goal-runner 出现的每个 halt_reason 都必须在 INCIDENT_REGISTRY 注册（未注册即红）',
    run: () => {
      const missing = scanHaltReasonLiterals().filter((r) => !lookupIncident(r));
      assert(
        missing.length === 0,
        `以下 halt_reason 未在 INCIDENT_REGISTRY 注册（新增 incident 必须登记，否则裁决表有洞）：\n  ` +
        missing.join('\n  '),
      );
    },
  },
  {
    name: '元门禁**自证**：注入一个未注册 halt_reason，扫描器必须报出（防空门禁）',
    run: () => {
      // 若扫描器抓不到人为注入的新 halt_reason，说明这道元门禁是摆设——
      // 「新增 incident 不注册即红」的保证就不成立。三种真实写法各测一遍。
      const forms = [
        `goalEvents.emit({ type: 'phase_halt', halt_reason: 'totally_new_reason', verdict });`,
        `haltReason = 'another_new_reason';`,
        `haltReason = cond\n  ? 'ternary_new_reason'\n  : 'backtrack_limit';`,
      ];
      for (const src of forms) {
        const found = scanHaltReasonLiteralsIn(src);
        const novel = found.filter((r) => !lookupIncident(r));
        assert(novel.length === 1, `扫描器漏掉了新 halt_reason：${src} → ${JSON.stringify(found)}`);
      }
      // 反向：已注册的不得误报
      assert(
        scanHaltReasonLiteralsIn(`halt_reason: 'backtrack_limit',`).every((r) => Boolean(lookupIncident(r))),
        '已注册项被误报为缺失',
      );
    },
  },
  {
    name: '元门禁：禁止**模板串生成** incident id（构造上无法注册 → 会绕过全部覆盖检查）',
    run: () => {
      // codex 七轮 P0：扫描器只提字面量，`no_progress_${failureKind}` 这类模板生成的 id
      // 完全隐形——实测 6 个真实可达 id 未注册而测试仍全绿。现在把这个洞变成红灯：
      // incident id 必须是稳定 literal，可变部分放诊断字段（如 failure_kind_classified）。
      const offenders: string[] = [];
      const walk = (dir: string): void => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const abs = path.join(dir, e.name);
          if (e.isDirectory()) { walk(abs); continue; }
          if (!e.isFile() || !e.name.endsWith('.ts')) continue;
          const src = stripComments(fs.readFileSync(abs, 'utf8'));
          // `haltReason = ` 或 `halt_reason:` 后跟含 ${ 的模板串
          const re = /(haltReason\s*=|halt_reason\s*:)\s*`[^`]*\$\{/g;
          for (const m of src.matchAll(re)) {
            offenders.push(`${path.relative(SCRIPTS_DIR, abs)} :: ${m[0].replace(/\s+/g, ' ')}`);
          }
        }
      };
      walk(SCRIPTS_DIR);
      assert(
        offenders.length === 0,
        'incident id 不得由模板串生成（注册表与元门禁都看不见它）——改为稳定 literal，' +
        `可变部分放诊断字段：\n  ${offenders.join('\n  ')}`,
      );
    },
  },
  {
    name: '元门禁**自证**：模板串检测器能抓到人为注入的动态 id',
    run: () => {
      const re = /(haltReason\s*=|halt_reason\s*:)\s*`[^`]*\$\{/g;
      const bad = 'haltReason = `no_progress_${failureKind}`;';
      const bad2 = "goalEvents.emit({ halt_reason: `cumulative_${k}` });";
      const good = "haltReason = 'no_progress_guard';";
      assert([...bad.matchAll(re)].length === 1, '漏抓赋值式模板');
      assert([...bad2.matchAll(re)].length === 1, '漏抓字面量属性式模板');
      assert([...good.matchAll(re)].length === 0, '误伤稳定 literal');
    },
  },
  {
    name: '统一投影唯一出口 runDispositionFields：四态字段正确，且只有 WAITING 携带 run_wait_kind',
    run: () => {
      const cont = runDispositionFields({ kind: 'continue', reason: '' });
      assert(cont.run_disposition === 'RESUME_READY' && !('run_wait_kind' in cont), JSON.stringify(cont));
      const rec = runDispositionFields({ kind: 'recover', action: 'backtrack_to_coding', reason: '' });
      assert(rec.run_disposition === 'RECOVERY_PENDING' && !('run_wait_kind' in rec), JSON.stringify(rec));
      const term = runDispositionFields({ kind: 'terminal', reason: '' });
      assert(term.run_disposition === 'TERMINAL' && !('run_wait_kind' in term), JSON.stringify(term));
      for (const k of ['human', 'external'] as const) {
        const w = runDispositionFields({ kind: 'waiting', wait_kind: k, reason: '' });
        assert(w.run_disposition === 'WAITING' && w.run_wait_kind === k, JSON.stringify(w));
      }
      // 字段名不得回退到已被占用的 `disposition`
      assert(!('disposition' in cont), 'run_disposition 不得写成 disposition（events 里已被占用）');
    },
  },
  {
    name: '语义表驱动：关键 incident 的 run_disposition / run_wait_kind 逐条锁死（元门禁只证「已注册」，证不了「判得对」）',
    run: () => {
      // codex 八轮建议：注册表覆盖 + 可裁决 ≠ 分类正确。此前正是靠人眼才发现
      // no_progress_agent_timeout 被错判成「等人」、cumulative 家族丢了 external/human 区分。
      // 这张表把「等谁」写死成断言——改错分类即红。
      const expect: Array<[string, string, string | undefined]> = [
        // 基建/环境类：等环境恢复，不是等人
        ['no_progress_agent_timeout', 'WAITING', 'external'],
        ['no_progress_toolchain', 'WAITING', 'external'],
        ['no_progress_capture', 'WAITING', 'external'],
        ['no_progress_cumulative_external', 'WAITING', 'external'],
        ['await_operator_toolchain', 'WAITING', 'external'],
        ['device_not_ready', 'WAITING', 'external'],
        // 需要人做决定
        ['no_progress_cumulative_human', 'WAITING', 'human'],
        ['no_progress_visual_gap', 'WAITING', 'human'],
        ['no_progress_guard', 'WAITING', 'human'],
        ['await_human_gate_deferral', 'WAITING', 'human'],
        // 多设备歧义：等人配 target_serial，**不是**等环境自愈
        ['device_target_ambiguous', 'WAITING', 'human'],
        // 结构上无法在本 run 继续
        ['in_session_reconcile_fused', 'TERMINAL', undefined],
        ['backtrack_limit', 'TERMINAL', undefined],
        ['testing_write_violation', 'TERMINAL', undefined],
        // 框架缺陷：修复重新发布后继续
        ['in_session_phase_exception', 'WAITING', 'external'],
        ['closure_probe_error', 'WAITING', 'external'],
        ['framework_bug', 'WAITING', 'external'],
      ];
      for (const [incident, wantDisp, wantKind] of expect) {
        const fields = runDispositionFields(decide({ incident }, NO_AUTHORITY, ctx()));
        assert(
          fields.run_disposition === wantDisp,
          `${incident}: run_disposition 期望 ${wantDisp}，实际 ${fields.run_disposition}`,
        );
        assert(
          fields.run_wait_kind === wantKind,
          `${incident}: run_wait_kind 期望 ${String(wantKind)}，实际 ${String(fields.run_wait_kind)}` +
          '（等人 vs 等环境判错会直接产出误导报告）',
        );
      }
    },
  },
  {
    name: '元门禁：注册表每条都能被 decide 消费，且不落 unknown 兜底',
    run: () => {
      const classes = new Set<IncidentClass>();
      for (const [incident, spec] of Object.entries(INCIDENT_REGISTRY)) {
        assert(incidentClassOf(incident) === spec.class, `${incident}: class 解析不一致`);
        assert(spec.class !== 'unknown', `${incident}: 不得注册为 unknown（unknown 只作 fail-safe）`);
        const d = decide({ incident }, NO_AUTHORITY, ctx());
        assert(
          ['continue', 'recover', 'waiting', 'terminal'].includes(d.kind),
          `${incident}: decide 输出非法 ${d.kind}`,
        );
        classes.add(spec.class);
      }
      // 四类均有实际使用（避免注册表退化成单一分类）
      for (const c of ['recoverable', 'operator', 'external', 'framework_fault'] as IncidentClass[]) {
        assert(classes.has(c), `注册表缺少 ${c} 类样本`);
      }
    },
  },
  {
    name: '未注册 incident → fail-safe waiting(human)，绝不自动恢复也不自动放行',
    run: () => {
      const d = decide({ incident: 'brand_new_never_seen' }, NO_AUTHORITY, ctx());
      assert(d.kind === 'waiting', `未注册应 waiting，实际 ${d.kind}`);
      assert(d.kind === 'waiting' && d.wait_kind === 'human', 'fail-safe 须 human');
      assert(incidentClassOf('brand_new_never_seen') === 'unknown', 'unknown 兜底');
    },
  },
  {
    name: 'incident id 归一：assess_halt:<detail> 命中基名注册项',
    run: () => {
      assert(normalizeIncidentId('assess_halt:blah blah') === 'assess_halt', 'normalize');
      assert(Boolean(lookupIncident('assess_halt:whatever')), '带后缀应命中');
    },
  },
  {
    name: '观测层投影：四类映射稳定（reconcile actionability 兼容词汇）',
    run: () => {
      assert(projectToObservedActionability('recoverable') === 'automatic', 'recoverable');
      assert(projectToObservedActionability('operator') === 'human', 'operator');
      assert(projectToObservedActionability('external') === 'external', 'external');
      assert(projectToObservedActionability('framework_fault') === 'unknown', 'framework_fault');
      assert(projectToObservedActionability('unknown') === 'unknown', 'unknown');
    },
  },
  {
    name: '5b 六条 suspected_misclassified 转正：证据故障自动恢复，基础设施 external probe',
    run: () => {
      const expected = {
        pass_snapshot_unavailable: { class: 'recoverable', action: 'retry_transaction' },
        pass_snapshot_restore_refused: { class: 'recoverable', action: 'retry_transaction' },
        pass_snapshot_journal_unverifiable: { class: 'recoverable', action: 'retry_transaction' },
        pre_invoke_snapshot_failed: { class: 'external', action: undefined },
        closure_finalization_failed: { class: 'recoverable', action: 'retry_transaction' },
        goal_review_closure_baseline_unavailable: { class: 'recoverable', action: 'backtrack_to_coding' },
      } as const;
      const suspects = Object.entries(INCIDENT_REGISTRY).filter(([, s]) => s.suspected_misclassified);
      assert(suspects.length === Object.keys(expected).length, `疑似误分类应为 6 条，实际 ${suspects.length}`);
      for (const [incident, shape] of Object.entries(expected)) {
        const spec = lookupIncident(incident);
        assert(Boolean(spec?.suspected_misclassified), `${incident} 必须保留来源标注`);
        assert(spec?.class === shape.class, `${incident} class 实得 ${spec?.class}`);
        assert(spec?.recover_action === shape.action, `${incident} recover_action 实得 ${spec?.recover_action}`);
        const d = decide({
          incident,
          chain_has_coding_review: true,
          backtrack_budget_remaining: 2,
          round_fingerprint_repeated: false,
        }, NO_AUTHORITY, ctx());
        if (shape.class === 'external') {
          assert(d.kind === 'waiting' && d.wait_kind === 'external', `${incident} 必须 external waiting：${JSON.stringify(d)}`);
        } else {
          assert(d.kind === 'recover' && d.action === shape.action, `${incident} 必须自动恢复：${JSON.stringify(d)}`);
        }
        assert(d.kind !== 'waiting' || d.wait_kind !== 'human', `${incident} 不得 waiting(human)`);
        assert(d.kind !== 'terminal', `${incident} 不得 terminal`);
      }
    },
  },
];

// ---------------------------------------------------------------------------
// ⑤ 立项两事故闭环
// ---------------------------------------------------------------------------

const incidentClosureCases: TestCase[] = [
  {
    name: '事故②(ut drift)：结构前提满足 → 自动 recover(backtrack_to_coding)，全程无 authority',
    run: () => {
      const d = decide(
        {
          incident: 'unauthorized_source_mutation',
          phase: 'ut',
          files: ['src/main/ets/BankCardRepository.ets'],
          chain_has_coding_review: true,
          backtrack_budget_remaining: 2,
          round_fingerprint_repeated: false,
        },
        NO_AUTHORITY, // ← 无任何 grant
        ctx({ can_prompt_now: false }), // ← 无人值守
      );
      assert(d.kind === 'recover', `应自动恢复，实际 ${d.kind}`);
      assert(d.kind === 'recover' && d.action === 'backtrack_to_coding', 'action');
      assert(d.kind === 'recover' && d.reason.includes(UNTRUSTED_DRIFT_REASON), '原因须为未受信重验，不得冒充授权');
      assert(dispositionOf(d) === 'RECOVERY_PENDING', 'disposition');
    },
  },
  {
    name: '事故②边界：截断链 / 预算耗尽 / 同 fingerprint 重现 → terminal（不无限回退）',
    run: () => {
      const base: IncidentFacts = {
        incident: 'unauthorized_source_mutation',
        chain_has_coding_review: true,
        backtrack_budget_remaining: 2,
        round_fingerprint_repeated: false,
      };
      const trunc = decide({ ...base, chain_has_coding_review: false }, NO_AUTHORITY, ctx());
      assert(trunc.kind === 'terminal' && trunc.reason.includes('截断链'), `截断链：${JSON.stringify(trunc)}`);
      const budget = decide({ ...base, backtrack_budget_remaining: 0 }, NO_AUTHORITY, ctx());
      assert(budget.kind === 'terminal' && budget.reason.includes('预算'), `预算：${JSON.stringify(budget)}`);
      const repeat = decide({ ...base, round_fingerprint_repeated: true }, NO_AUTHORITY, ctx());
      assert(repeat.kind === 'terminal' && repeat.reason.includes('指纹'), `指纹：${JSON.stringify(repeat)}`);
    },
  },
  {
    name: '事故②跨 resume：drift 指纹须落 events 且从 priorEvents 回放（重启不得失忆白吃预算）',
    run: () => {
      const src = stripComments(fs.readFileSync(path.join(SCRIPTS_DIR, 'goal-runner.ts'), 'utf8'));
      // ① 保守恢复事件必须持久化 drift_fingerprint
      assert(
        /drift_fingerprint:\s*driftDecision\.driftFingerprint/.test(src),
        'phase_backtrack_requested 未持久化 drift_fingerprint —— resume 后无从回放',
      );
      // ② 启动期必须从 events 回放进 seenDriftFingerprints
      assert(
        /seenDriftFingerprints\.add\(ev\.drift_fingerprint\)/.test(src),
        '启动期未从 priorEvents 回放 drift 指纹',
      );
      // ③ 声明必须早于回放循环（否则 TDZ / 回放落空）
      const declIdx = src.indexOf('const seenDriftFingerprints');
      const replayIdx = src.indexOf('seenDriftFingerprints.add(ev.drift_fingerprint)');
      assert(declIdx > 0 && replayIdx > declIdx, '声明必须早于 events 回放');
      // ④ 全文只有一处声明（防止又出现第二个「每进程新建」的集合）
      assert(
        src.split('const seenDriftFingerprints').length - 1 === 1,
        'seenDriftFingerprints 只允许一处声明',
      );
    },
  },
  {
    name: '保守恢复路**不产授权语义**：matched_receipts 只在 authorized_backtrack 分支出现',
    run: () => {
      // 只看代码：注释里提到 matched_receipts（如"不产 matched_receipts"）不算构造点。
      const src = stripComments(fs.readFileSync(path.join(SCRIPTS_DIR, 'goal-runner.ts'), 'utf8'));
      const idx: number[] = [];
      for (const m of src.matchAll(/matched_receipts/g)) idx.push(m.index ?? -1);
      assert(idx.length === 1, `matched_receipts 应只在一处构造，实际 ${idx.length} 处`);
      const window = src.slice(Math.max(0, idx[0] - 400), idx[0] + 200);
      assert(
        /driftDecision\.kind === 'authorized_backtrack'/.test(window),
        'matched_receipts 未被 authorized_backtrack 判据包住——保守恢复路可能冒充授权',
      );
      assert(
        /reason: UNTRUSTED_DRIFT_REASON[\s\S]{0,80}authorized: false/.test(window),
        '保守恢复分支须显式 authorized:false + untrusted 原因',
      );
    },
  },
];

// ---------------------------------------------------------------------------
// ⑥ lint：新增 gate 不得直接读 goal env
// ---------------------------------------------------------------------------

/**
 * 存量豁免（plan a5f9c3e2 移出范围：历史调用点不在本 plan，逐步收敛）。
 * **新增 gate 文件出现「从 env 反推执行环境」即红** —— 分叉只许在 decide()。
 */
const GOAL_ENV_LEGACY_ALLOWLIST: ReadonlySet<string> = new Set([
  'check-spec.ts',
  'check-receipt.ts',
  'check-ut.ts',
]);

/**
 * 只拦**推断式**谓词（「我是不是在 goal 里 / 能不能问人」），不拦**身份式**读取
 * （MAISON_GOAL_RUN_ID / _ATTEMPT / _GATE_HARNESS 用于定位 run 目录与 gate 权限——
 * resolveRunOwnerKind 自身也这么读，属正当用途）。这条区分是本 lint 的核心：
 * 反推环境才是「同一件事写两份」的入口，读 run 身份不是。
 */
const GOAL_ENV_PATTERN =
  /isGoalOrchestrationEnv\s*\(|isGoalHeadlessEnv\s*\(|process\.env\.MAISON_GOAL_(RUNNER|HEADLESS)\b/;

const lintCases: TestCase[] = [
  {
    name: 'lint：gate 脚本不得新增 goal env 反推（存量走具名 legacy 豁免）',
    run: () => {
      const offenders: string[] = [];
      for (const name of fs.readdirSync(SCRIPTS_DIR)) {
        if (!name.startsWith('check-') || !name.endsWith('.ts')) continue;
        if (GOAL_ENV_LEGACY_ALLOWLIST.has(name)) continue;
        const text = fs.readFileSync(path.join(SCRIPTS_DIR, name), 'utf8');
        if (GOAL_ENV_PATTERN.test(text)) offenders.push(name);
      }
      assert(
        offenders.length === 0,
        '以下 gate 直接读 goal 环境变量反推执行环境（应改为消费 ExecutionContext / ' +
        `resolveRunOwnerKind，或具名加入 legacy 豁免并说明理由）：\n  ${offenders.join('\n  ')}`,
      );
    },
  },
  {
    name: 'lint **自证**：注入一个反推 goal env 的新 gate，必须被抓（防空 lint）',
    run: () => {
      const offenders = scanGoalEnvOffenders([
        { name: 'check-brandnew.ts', text: 'if (isGoalOrchestrationEnv()) { /* 反推 */ }' },
        { name: 'check-brandnew2.ts', text: "const g = process.env.MAISON_GOAL_HEADLESS === '1';" },
      ]);
      assert(offenders.length === 2, `lint 漏抓：${JSON.stringify(offenders)}`);
      // 身份式读取不得误伤（run id / attempt / gate authority 是正当用途）
      const innocent = scanGoalEnvOffenders([
        { name: 'check-innocent.ts', text: "const id = process.env.MAISON_GOAL_RUN_ID?.trim();" },
        { name: 'check-innocent2.ts', text: "if (process.env.MAISON_GOAL_GATE_HARNESS !== '1') return [];" },
      ]);
      assert(innocent.length === 0, `身份式读取被误伤：${JSON.stringify(innocent)}`);
      // legacy 豁免仍然生效
      assert(
        scanGoalEnvOffenders([{ name: 'check-ut.ts', text: 'isGoalOrchestrationEnv()' }]).length === 0,
        'legacy 豁免失效',
      );
    },
  },
  {
    name: 'lint：裁决内核自身保持纯净——不读 env、不做文件 I/O',
    run: () => {
      const text = fs.readFileSync(path.join(SCRIPTS_DIR, 'utils', 'adjudication.ts'), 'utf8');
      const body = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      assert(!/process\.env/.test(body), 'adjudication.ts 不得读 env');
      assert(!/require\(['"]fs['"]\)|from ['"]fs['"]/.test(body), 'adjudication.ts 不得做文件 I/O');
    },
  },
];

// ---------------------------------------------------------------------------
// ⑦ 旧 manifest 兼容
// ---------------------------------------------------------------------------

function baseManifestInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    feature: 'bc-openCard',
    requirement: 'r',
    adapter: 'cursor',
    start_phase: 'spec',
    end_phase: 'testing',
    run_id: '20260802T000000Z-abcdef',
    unattended: { write_mode: 'workspace-write', approval_mode: 'never', max_turns: 20 },
    ...over,
  };
}

const manifestCompatCases: TestCase[] = [
  {
    name: 'T3 后继 manifest 继承源 run 的完整启动契约与去重指纹，不继承阶段完成态',
    run: () => tmpProject((root) => {
      const source = buildGoalManifestFromInput(baseManifestInput({
        run_id: '20260807T000000Z-source',
        end_phase: 'ut',
        requirement: 'source requirement',
        adapter: 'source-adapter',
        chain_override: ['spec', 'coding', 'review', 'ut'],
        minimum_assurance: { ut: 'full' },
        fidelity: 'semantic_layout',
        fidelity_receipt: 'doc/receipts/source.json',
        dependency_policy: {
          deferrable_blocking_classes: ['sourceBlocked'],
          deferrable_failure_kinds: ['source_failure'],
          propagate_to_downstream: false,
        },
        pre_authorized_mutations: [{
          phase: 'ut', allowed_files: ['02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets'],
          max_files: 1, approved_by: 'source-reviewer',
        }],
        budget: { max_total_turns: 7, max_backtracks: 1 },
        unattended: { write_mode: 'workspace-write', approval_mode: 'never', max_turns: 11 },
      }), { projectRoot: root });
      const fresh = buildGoalManifestFromInput(baseManifestInput({
        run_id: '20260807T000001Z-successor',
        budget: { max_total_turns: 99, max_backtracks: 99 },
        unattended: { write_mode: 'workspace-write', approval_mode: 'never', max_turns: 99 },
        requirement: 'fresh 字段值（非 CLI 显式 flag——不得被误判为增量）',
      }), { projectRoot: root });
      const successor = inheritSuccessorManifest(fresh, source, {
        round: ['round-a', 'round-a', ''],
        drift: ['drift-a', 'drift-a', 'drift-b'],
      });
      assertEq(JSON.stringify(successor.budget), JSON.stringify(source.budget), '后继不得刷新预算上限');
      assertEq(JSON.stringify(successor.unattended), JSON.stringify(source.unattended), '后继不得刷新无人值守上限');
      assertEq(successor.start_phase, fresh.start_phase, '后继只接受新 run 明确要求的起点');
      for (const key of [
        'end_phase', 'requirement', 'adapter', 'chain_override', 'minimum_assurance',
        'fidelity', 'fidelity_receipt', 'dependency_policy', 'pre_authorized_mutations',
      ] as const) {
        assertEq(JSON.stringify(successor[key]), JSON.stringify(source[key]),
          `后继不得丢失 ${key}（requirement 逐字继承源——增量合并是 runner 侧显式 flag 门控，不在本函数）`);
      }
      assert(!isSuccessorRepairRequirement(successor.requirement), '合同继承不得带合并标记');
      assertEq(successor.successor_of, source.run_id, '后继须绑定源 run');
      assertEq(JSON.stringify(successor.inherited_round_fingerprints), JSON.stringify(['round-a']), 'round 指纹须去重');
      assertEq(JSON.stringify(successor.inherited_drift_fingerprints), JSON.stringify(['drift-a', 'drift-b']), 'drift 指纹须去重');
      const identity = computeManifestIdentityFields(successor);
      assert('successor_of' in identity && 'inherited_round_fingerprints' in identity
        && 'inherited_drift_fingerprints' in identity, '后继身份字段须绑定继承元数据');
      assert(!('phase_outcomes' in successor), '后继不得复制源 run 阶段完成态');
    }),
  },
  {
    name: 'e9d4b7a3 t1：mergeSuccessorRequirement 幂等（不二次嵌套标记）；检测器只看标记在场',
    run: () => {
      const once = mergeSuccessorRequirement('源', '增量：logo 29 项');
      assert(once.includes('源') && once.includes('增量：logo 29 项'), '合并须同时含源正文与增量');
      assert(once.includes(SUCCESSOR_REQUIREMENT_INCREMENT_MARKER), '合并须带稳定标记');
      assert(isSuccessorRepairRequirement(once), '合并产物须被检测器识别');
      const twice = mergeSuccessorRequirement(once, '第二轮增量');
      assertEq((twice.match(new RegExp(SUCCESSOR_REQUIREMENT_INCREMENT_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length, 1,
        '重复合并不得二次嵌套标记');
      assert(!isSuccessorRepairRequirement(undefined), 'undefined 不是修复增量');
      assert(!isSuccessorRepairRequirement(''), '空串不是修复增量');
    },
  },
];

// ---------------------------------------------------------------------------
// ⑧ d6 t5⓪ / t5⓪-b：统一投影生产面 + 单 reducer 全函数
// ---------------------------------------------------------------------------

const projectionCases: TestCase[] = [
  {
    name: 't5⓪：写盘层自动为带 halt_reason 的事件补投影；已显式携带者原样放行',
    run: () => {
      const auto = withRunDisposition({ type: 'phase_halt', halt_reason: 'device_not_ready' });
      assert(auto.run_disposition === 'WAITING', JSON.stringify(auto));
      assert(auto.run_wait_kind === 'external', JSON.stringify(auto));
      // 显式投影（调用方投的是真实 decide() 结果，含结构性事实）不得被按 id 重算覆盖
      const explicit = withRunDisposition({
        type: 'phase_halt', halt_reason: 'unauthorized_source_mutation',
        run_disposition: 'RECOVERY_PENDING',
      });
      assert(explicit.run_disposition === 'RECOVERY_PENDING', JSON.stringify(explicit));
      // 无 halt_reason 的普通事件不被污染
      const plain = withRunDisposition({ type: 'phase_verdict', verdict: 'PASS' });
      assert(!('run_disposition' in plain), JSON.stringify(plain));
    },
  },
  {
    name: 't5⓪ 元门禁（T1⑤ 收敛版）：非结构敏感 incident 写盘必产投影；**结构敏感缺投影拒绝化妆**',
    run: () => {
      const missing: string[] = [];
      const disguised: string[] = [];
      for (const incident of Object.keys(INCIDENT_REGISTRY)) {
        const ev = withRunDisposition({ type: 'phase_halt', halt_reason: incident });
        if (isStructuralFactsIncident(incident)) {
          // T1⑤：decide() 读结构 facts 的家族——写盘层兜底只有 halt_reason，
          // 化妆会把 TERMINAL 算成 RECOVERY_PENDING（d6 t5④ 原始反例）。守卫=原样放行。
          if (typeof ev.run_disposition === 'string') disguised.push(incident);
          continue;
        }
        if (typeof ev.run_disposition !== 'string') missing.push(incident);
        if (ev.run_disposition === 'WAITING' && typeof ev.run_wait_kind !== 'string') {
          missing.push(`${incident}(WAITING 缺 wait_kind)`);
        }
      }
      assert(missing.length === 0, `以下 incident 落盘后无完整投影：\n  ${missing.join('\n  ')}`);
      assert(disguised.length === 0,
        `以下结构敏感 incident 被写盘层用兜底 facts 化妆（T1⑤ 禁止）：\n  ${disguised.join('\n  ')}`);
    },
  },
  {
    name: 'T1⑤：敏感集合由注册表派生（recoverable 非 terminal）；等价家族兜底=生产点计算逐字段一致',
    run: () => {
      // 集合派生正确性（不手写第二份清单的机器面）
      for (const id of ['unauthorized_source_mutation',
        'goal_post_review_source_mutation_unresolved', 'pass_snapshot_unavailable',
        'pass_snapshot_restore_refused', 'pass_snapshot_journal_unverifiable',
        'closure_finalization_failed', 'goal_review_closure_baseline_unavailable']) {
        assert(isStructuralFactsIncident(id), `${id} 应属结构敏感（decide 读结构 facts）`);
      }
      for (const id of ['backtrack_limit', 'backtrack_fingerprint_repeat', 'backtrack_target_absent',
        'device_not_ready', 'pre_invoke_snapshot_failed']) {
        assert(!isStructuralFactsIncident(id),
          `${id} 不属结构敏感（structurally_terminal 零 facts 或纯 incident 映射）`);
      }
      // 等价性契约：非敏感 incident 的写盘兜底与生产点显式计算是纯函数同输入——逐字段一致。
      // 这个等价是"写盘层保留补算"的全部合法性来源，一旦被打破本格必红。
      for (const id of ['device_not_ready', 'backtrack_limit', 'budget_wall_clock', 'device_toolchain']) {
        const production = runDispositionFields(
          decide({ incident: id }, NO_AUTHORITY,
            { orchestration: 'goal', owner_kind: 'process', can_prompt_now: false, invocation: 'fresh' }));
        const sink = withRunDisposition({ type: 'phase_halt', halt_reason: id });
        assert(sink.run_disposition === production.run_disposition
          && sink.run_wait_kind === production.run_wait_kind,
          `${id} 兜底与生产点投影不一致：sink=${JSON.stringify(sink)} prod=${JSON.stringify(production)}`);
      }
    },
  },
  {
    name: 't5⓪ 元门禁：两条事件写入路径都必须过投影注入点（新增写入路径漏接即红）',
    run: () => {
      const paths = [
        ['goal-runner.ts', 'createGoalReconcileBoundary'],
        [path.join('utils', 'goal-in-session-evidence.ts'), 'appendFileSync'],
      ] as const;
      for (const [rel, anchor] of paths) {
        const src = stripComments(fs.readFileSync(path.join(SCRIPTS_DIR, rel), 'utf8'));
        assert(src.includes(anchor), `${rel}: 锚点 ${anchor} 不在——写入路径可能已重构`);
        assert(
          /withRunDisposition\s*\(/.test(src),
          `${rel}: 事件写入路径未调用 withRunDisposition —— 该路径产出的 halt 将无投影`,
        );
      }
    },
  },
  {
    name: 't5⓪-b reducer 全函数：空序列 / 仅 run_start 均给确定四态，绝不 undefined',
    run: () => {
      assert(reduceRunState([]).run_disposition === 'RESUME_READY', '空序列');
      assert(reduceRunState([{ type: 'run_start' }]).run_disposition === 'RESUME_READY', '仅 run_start');
      // 垃圾输入不得抛也不得 undefined
      assert(reduceRunState([null, 42, 'x', {}]).run_disposition === 'RESUME_READY', '脏输入');
    },
  },
  {
    name: '第九批收尾 P1：启动期 BLOCKER 的 run_end 显式投影须被采用（裸 HALTED 不得退回 RESUME_READY）',
    run: () => {
      // 最小复现（codex 实测）：run_start → run_end{HALTED, supersede_target_invalid}。
      // 修前：reducer 对 HALTED"保留此前投影"→ 退回 run_start 的 RESUME_READY →
      // supervisor action=resume——把一个需要人修启动参数的 run 重新拉起。
      // 修后：run_end 自带显式投影（concludeStartupBlocker 经 withRunDisposition）
      // 时优先采用并封口。
      const s = reduceRunState([
        { type: 'run_start' },
        {
          type: 'run_end', status: 'HALTED', halt_reason: 'supersede_target_invalid',
          run_disposition: 'WAITING', run_wait_kind: 'human',
        },
      ]);
      assert(s.run_disposition === 'WAITING' && s.run_wait_kind === 'human' && s.sealed,
        `显式投影须被采用并封口，实得 ${JSON.stringify(s)}`);
      // codex 第九批收尾二订：初版传了 `{...s, stale:true} as never`——参数形状错
      // （真实签名={beaconStale, state}），beaconStale 为 undefined 时函数天然 no_op，
      // 断言无论 disposition 是什么都能过（假绿）。用真实参数形状：
      // beacon 已 stale（进程死了）+ WAITING(human) → 仍必须 no_op（等人，不拉起）。
      assert(supervisorAction({ beaconStale: true, state: s }) === 'no_op',
        'supervisor 不得把等待人修参数的 run 重新拉起（beacon stale + WAITING/human = no_op）');
      // 反向对照（证明断言有区分度）：同样 beacon stale，若投影是 RESUME_READY 则会 resume
      assert(supervisorAction({ beaconStale: true, state: { run_disposition: 'RESUME_READY' } }) === 'resume',
        '对照组：RESUME_READY + stale 应 resume——否则上一条断言没有区分度');
      // 无显式投影的 HALTED 仍保留此前投影（既有语义不变）
      const legacy = reduceRunState([
        { type: 'run_start' },
        { type: 'phase_halt', run_disposition: 'WAITING', run_wait_kind: 'external' },
        { type: 'run_end', status: 'HALTED' },
      ]);
      assert(legacy.run_disposition === 'WAITING' && legacy.run_wait_kind === 'external',
        `无显式投影保留生产端权威值：${JSON.stringify(legacy)}`);
    },
  },
  {
    name: 't5⓪-b reducer：取最新 authoritative 投影；resume 解封上一轮终局',
    run: () => {
      const s1 = reduceRunState([
        { type: 'run_start' },
        { type: 'phase_halt', run_disposition: 'WAITING', run_wait_kind: 'external' },
        { type: 'phase_backtrack_requested', run_disposition: 'RECOVERY_PENDING' },
      ]);
      assert(s1.run_disposition === 'RECOVERY_PENDING', JSON.stringify(s1));
      assert(s1.run_wait_kind === undefined, 'RECOVERY_PENDING 不得残留 wait_kind');
      // WAITING → 条件修好 → resume：不得仍报 WAITING
      const s2 = reduceRunState([
        { type: 'run_start' },
        { type: 'phase_halt', run_disposition: 'WAITING', run_wait_kind: 'human' },
        { type: 'run_end', status: 'HALTED' },
        { type: 'run_start', resume: 'r1' },
      ]);
      assert(s2.run_disposition === 'RESUME_READY', `resume 后应解封，实际 ${JSON.stringify(s2)}`);
      assert(s2.sealed === false, 'resume 须解封');
    },
  },
  {
    name: 't5⓪-b reducer：run_end 封口——完成类判 TERMINAL，HALTED 保留停机前投影（不冤判永不重启）',
    run: () => {
      const done = reduceRunState([{ type: 'run_start' }, { type: 'run_end', status: 'CHAIN_SLICE_COMPLETED' }]);
      assert(done.run_disposition === 'TERMINAL' && done.sealed, JSON.stringify(done));
      // HALTED：停机是 liveness 的事实，能不能续是 disposition 的事实——保留最后投影
      const halted = reduceRunState([
        { type: 'run_start' },
        { type: 'phase_halt', run_disposition: 'WAITING', run_wait_kind: 'human' },
        { type: 'run_end', status: 'HALTED' },
      ]);
      assert(halted.run_disposition === 'WAITING' && halted.run_wait_kind === 'human',
        `HALTED 不得把 WAITING 冤判成 TERMINAL：${JSON.stringify(halted)}`);
      assert(halted.sealed === true, 'run_end 须封口');
      // 封口后更早投影不得翻转终局
      const sealed = reduceRunState([
        { type: 'run_start' },
        { type: 'run_end', status: 'CHAIN_SLICE_COMPLETED' },
        { type: 'phase_halt', run_disposition: 'RECOVERY_PENDING' },
      ]);
      assert(sealed.run_disposition === 'TERMINAL', `封口后被翻转：${JSON.stringify(sealed)}`);
    },
  },
  {
    name: 'a4 supervisor 矩阵：beacon × run_disposition 两轴正交（stale+RECOVERY_PENDING 必须拉起）',
    run: () => {
      const four = ['RESUME_READY', 'RECOVERY_PENDING', 'WAITING', 'TERMINAL'] as const;
      // beacon fresh：进程还活着，任何 disposition 都不介入
      for (const d of four) {
        assert(
          supervisorAction({ beaconStale: false, state: { run_disposition: d } }) === 'no_op',
          `fresh+${d} 应不介入`,
        );
      }
      assert(supervisorAction({ beaconStale: true, state: { run_disposition: 'RESUME_READY' } }) === 'resume', 'stale+READY');
      assert(
        supervisorAction({ beaconStale: true, state: { run_disposition: 'RECOVERY_PENDING' } }) === 'resume',
        'stale+RECOVERY_PENDING **必须拉起**——恢复途中进程死亡正是 a4 立项要解决的场景',
      );
      assert(supervisorAction({ beaconStale: true, state: { run_disposition: 'WAITING' } }) === 'no_op', 'stale+WAITING');
      assert(
        supervisorAction({ beaconStale: true, state: { run_disposition: 'TERMINAL' } }) === 'never_restart',
        'stale+TERMINAL',
      );
    },
  },
  {
    name: 't5⓪-b 收编：progress 快照带裁决轴，且与 liveness 轴**正交共存**（不合并成大枚举）',
    run: () => {
      const src = stripComments(
        fs.readFileSync(path.join(SCRIPTS_DIR, 'utils', 'goal-progress.ts'), 'utf8'),
      );
      assert(/reduceRunState\s*\(/.test(src), 'goal-progress 未消费单一 reducer——仍在独立推导');
      assert(/run_disposition:\s*runState\.run_disposition/.test(src), '快照未落裁决轴');
      // 两轴必须并存：status（liveness）与 run_disposition（裁决）都在 snapshot 里
      assert(/status:\s*ProgressRunStatus/.test(src), 'liveness 轴 status 应保留');
      assert(
        /run_disposition:\s*Disposition/.test(src),
        '裁决轴须是独立字段，不得并进 ProgressRunStatus 枚举',
      );
    },
  },
  {
    name: 't5④ **等价性断言**：固定 disposition 后任意替换 halt_reason，Disposition 列逐字不变',
    run: () => {
      // 这是「不得重建分类表」的行为版判据（替代字符串扫描）：诊断散文可以随 reason 变，
      // 但控制语义（这个 phase 算什么状态、下一步该谁动手）必须只由 disposition 决定。
      const reasons = [
        'unauthorized_source_mutation', 'device_not_ready', 'framework_bug',
        'testing_write_violation', 'no_progress_toolchain', 'brand_new_unregistered',
      ];
      // 附带的结构性保证：renderPhaseDispositionCell 的入参类型**根本不含 halt_reason**，
      // 想按事故原因分叉连编译都过不了。此处仍做行为断言，防将来有人放宽签名。
      const cell = (o: Record<string, unknown>): string =>
        renderPhaseDispositionCell(o as Parameters<typeof renderPhaseDispositionCell>[0]);
      for (const d of ['RESUME_READY', 'RECOVERY_PENDING', 'TERMINAL'] as const) {
        const cells = new Set(
          reasons.map((r) => cell({ run_disposition: d, halt_reason: r, halted: true })),
        );
        assert(cells.size === 1, `disposition=${d} 下 Disposition 列随 halt_reason 变了：${[...cells]}`);
      }
      // WAITING 只随 wait_kind 分叉（等人 ≠ 等环境），仍与 halt_reason 无关
      for (const kind of ['human', 'external'] as const) {
        const cells = new Set(
          reasons.map((r) =>
            cell({ run_disposition: 'WAITING', run_wait_kind: kind, halt_reason: r, halted: true }),
          ),
        );
        assert(cells.size === 1, `WAITING(${kind}) 列随 halt_reason 变了：${[...cells]}`);
      }
      assert(
        renderPhaseDispositionCell({ run_disposition: 'WAITING', run_wait_kind: 'human' }) !==
        renderPhaseDispositionCell({ run_disposition: 'WAITING', run_wait_kind: 'external' }),
        '等人与等环境必须可区分',
      );
    },
  },
  {
    name: 't5④ 诊断散文：优先 halt_guidance 首行；无 guidance 退化为 halted(<reason>)，缺项不影响判定',
    run: () => {
      const withGuidance = renderPhaseDiagnosticProse({
        halt_reason: 'framework_bug', halt_guidance: '  \n第一行指引 | 含竖线\n第二行', halted: true,
      });
      assert(withGuidance.startsWith('第一行指引'), `应取 guidance 首行：${withGuidance}`);
      assert(withGuidance.includes('\\|'), '表格单元格内竖线须转义');
      // 未登记散文的 reason → 通用兜底，不抛不留空
      const fallback = renderPhaseDiagnosticProse({ halt_reason: 'brand_new_unregistered', halted: true });
      assert(fallback === 'halted (brand_new_unregistered)', fallback);
      assert(renderPhaseDiagnosticProse({ halted: false }) === '—', '未 halt 应为 —');
    },
  },
  {
    name: 'reducer 映射订正：可 --resume 的 run_end status **不得**判 TERMINAL',
    run: () => {
      // codex 实锤：runner 的封卷守卫只对 CHAIN_SLICE_COMPLETED / COMPLETED 拒绝启动面，
      // 其余 status 都可 --resume。此前把它们统一映射成 TERMINAL，会让 supervisor 永不
      // 重启、报告也谎称「结构上无法继续」。
      for (const [status, kind] of [
        ['AWAITING_HUMAN_REVIEW', 'human'],
        ['DEFERRED', 'external'],
        ['DEFERRED_CAPABILITY_MISSING', 'external'],
      ] as const) {
        const st = reduceRunState([{ type: 'run_start' }, { type: 'run_end', status }]);
        assert(st.run_disposition === 'WAITING', `${status} 被判 ${st.run_disposition}，应为 WAITING`);
        assert(st.run_wait_kind === kind, `${status} 的 wait_kind 应为 ${kind}`);
      }
      // 真终局仍是 TERMINAL
      for (const status of ['CHAIN_SLICE_COMPLETED', 'COMPLETED'] as const) {
        const st = reduceRunState([{ type: 'run_start' }, { type: 'run_end', status }]);
        assert(st.run_disposition === 'TERMINAL', `${status} 应为 TERMINAL`);
      }
      // PARTIAL / HALTED：保留停机前的权威投影，不替生产端改判
      const partial = reduceRunState([
        { type: 'run_start' },
        { type: 'phase_halt', run_disposition: 'RECOVERY_PENDING' },
        { type: 'run_end', status: 'PARTIAL' },
      ]);
      assert(
        partial.run_disposition === 'RECOVERY_PENDING',
        `PARTIAL 覆盖了生产端投影：${partial.run_disposition}`,
      );
    },
  },
  {
    name: 't5④ 报告**不得二次裁决**：report 端不再调 withRunDisposition（重算会翻转真实 TERMINAL）',
    run: () => {
      const src = stripComments(
        fs.readFileSync(path.join(SCRIPTS_DIR, 'utils', 'goal-report-generator.ts'), 'utf8'),
      );
      assert(
        !/withRunDisposition\s*\(/.test(src),
        'report 仍在调 withRunDisposition —— 那会用中性上下文按 halt_reason 重新 decide，' +
        '丢掉 runner 的结构事实（回退预算/截断链/重复指纹），把 TERMINAL 翻成 RECOVERY_PENDING',
      );
      // 反例锁死：同一 incident 在「结构前提不满足」时生产端算 TERMINAL，
      // 而中性重算会得到 RECOVERY_PENDING —— 证明这两者确实会分叉，不是空担心
      const neutral = runDispositionFields(
        decide({ incident: 'unauthorized_source_mutation' }, NO_AUTHORITY, ctx()),
      );
      const real = runDispositionFields(
        decide(
          { incident: 'unauthorized_source_mutation', backtrack_budget_remaining: 0 },
          NO_AUTHORITY,
          ctx(),
        ),
      );
      assert(
        neutral.run_disposition !== real.run_disposition,
        '本断言的前提（中性重算与真实裁决会分叉）已不成立，需重新评估该风险',
      );
      assert(real.run_disposition === 'TERMINAL' && neutral.run_disposition === 'RECOVERY_PENDING',
        `分叉方向变了：real=${real.run_disposition} neutral=${neutral.run_disposition}`);
    },
  },
  {
    name: 't5① next_action 由投影决定：四态各有不同控制动作（等人 ≠ 等环境）',
    run: () => {
      const src = stripComments(
        fs.readFileSync(path.join(SCRIPTS_DIR, 'utils', 'goal-progress.ts'), 'utf8'),
      );
      // 控制性 next_action 必须读 runState，而不是只把它复制进快照字段
      assert(
        /runState\.run_disposition === 'TERMINAL'/.test(src) &&
        /runState\.run_disposition === 'RECOVERY_PENDING'/.test(src) &&
        /runState\.run_disposition === 'WAITING'/.test(src),
        'next_action 未按四态分支——reducer 只是展示字段，不是控制真值',
      );
      assert(
        /run_wait_kind === 'external'/.test(src),
        '等人与等环境必须给出不同 next_action',
      );
    },
  },
  {
    name: 'reducer 不重建分类：源码不得读 halt_reason 自行判类（分类 SSOT 在注册表）',
    run: () => {
      const src = stripComments(
        fs.readFileSync(path.join(SCRIPTS_DIR, 'utils', 'run-state-reducer.ts'), 'utf8'),
      );
      assert(!/halt_reason/.test(src), 'reducer 读了 halt_reason —— 那是第二张分类表的入口');
      assert(
        !/lookupIncident|INCIDENT_REGISTRY|\bdecide\s*\(/.test(src),
        'reducer 不得直接调用裁决内核，只折叠已落盘投影',
      );
    },
  },
  // ==========================================================================
  // f9c2e6b4 t3 —— 重试耗尽必须保留责任类别
  // 立项 run 20260803T103413Z-3f72a8：真因 project_build（内容），却因
  // `assess_halt:<reason>` 被 normalizeIncidentId 截成 `assess_halt` → operator
  // → WAITING/human；而 WAITING 会让 supervisor 永不拉起（goal-supervisor.ts:17）。
  // ==========================================================================
  {
    name: 't3 content_retry_exhausted → TERMINAL（重启同一 run 只会原地再死）',
    run: () => {
      const d = decide({ incident: 'content_retry_exhausted' }, NO_AUTHORITY, ctx());
      assert(d.kind === 'terminal', `内容失败耗尽应终局，实得 ${d.kind}`);
    },
  },
  {
    name: 't3 external_retry_exhausted → WAITING(external)（等环境，不是等人做决定）',
    run: () => {
      const d = decide({ incident: 'external_retry_exhausted' }, NO_AUTHORITY, ctx());
      assert(d.kind === 'waiting', `应停放，实得 ${d.kind}`);
      assert(
        d.kind === 'waiting' && d.wait_kind === 'external',
        `外部条件耗尽须判 external，实得 ${d.kind === 'waiting' ? d.wait_kind : '-'}`,
      );
    },
  },
  {
    name: 't3 反向回归：旧写法 assess_halt:<reason> 仍会被洗成 human（故不得再用）',
    run: () => {
      // 这条钉的是"为什么必须改"：同一条真因走旧 id 形态，结论是 human；
      // 将来若有人把产生端改回拼接，本用例与 goal-assess-driver 的契约断言会一起提醒。
      const legacy = decide(
        { incident: 'assess_halt:phase_verdict:halt; failure_kind=project_build' },
        NO_AUTHORITY,
        ctx(),
      );
      assert(
        legacy.kind === 'waiting' && legacy.wait_kind === 'human',
        '旧形态应被洗成 waiting(human)——这正是本项要消除的行为',
      );
      assert(
        normalizeIncidentId('assess_halt:phase_verdict:halt; failure_kind=project_build') === 'assess_halt',
        '归一确实截断到首个冒号（洗白链的机制根因）',
      );
    },
  },
  {
    name: 'b3 t2/t3 upstream_closure_gap → WAITING(human)：上游闭环缺口须人看，但不是内容失败',
    run: () => {
      const d = decide({ incident: 'upstream_closure_gap' }, NO_AUTHORITY, ctx());
      assert(d.kind === 'waiting', `应停放等人，实得 ${d.kind}`);
      assert(
        d.kind === 'waiting' && d.wait_kind === 'human',
        `应 waiting(human)，实得 ${d.kind === 'waiting' ? d.wait_kind : '-'}`,
      );
      // 反向：绝不能再被洗成 content_retry_exhausted（那是 TERMINAL，supervisor 永不拉起）
      const wrong = decide({ incident: 'content_retry_exhausted' }, NO_AUTHORITY, ctx());
      assert(wrong.kind === 'terminal', '对照组：content_retry_exhausted 仍是 TERMINAL');
    },
  },
  {
    // codex 复核 P1：只扫源码里有没有 budgetExhausted = 假绿。改成**行为矩阵**。
    name: 'b3 t3 halt 标签来源穷尽（行为矩阵）：只有充分证据才叫 exhausted',
    run: () => {
      const base = {
        retriesUsed: 2, maxRetriesPerPhase: 2, runnerAction: 'halt',
        verdict: 'FAIL', fused: false, failureKind: 'code_regression' as never,
      };
      // 充分证据齐备 → 按 FailureKind 二分
      assert(
        resolveAssessHaltIncident(base) === 'content_retry_exhausted',
        '内容失败且证据齐备 → content_retry_exhausted',
      );
      assert(
        resolveAssessHaltIncident({ ...base, failureKind: 'toolchain' as never })
          === 'external_retry_exhausted',
        '外部条件且证据齐备 → external_retry_exhausted',
      );
      // 宿主实锤形态：预算未耗尽（1/2）却落进 catch-all —— 绝不能标 exhausted
      assert(
        resolveAssessHaltIncident({ ...base, retriesUsed: 1 }) === 'framework_bug',
        '预算未耗尽 → 不得标 exhausted（run 20260804T033834Z-99c0a1 的错误标签）',
      );
      // 其余未识别来源：非 phase-outcome halt / 本轮 PASS / 已熔断
      assert(
        resolveAssessHaltIncident({ ...base, runnerAction: undefined }) === 'framework_bug',
        '推荐非 phase-outcome halt（无路由类）→ fail-closed',
      );
      assert(
        resolveAssessHaltIncident({ ...base, verdict: 'PASS' }) === 'framework_bug',
        '本轮 PASS 不可能是内容重试耗尽 → fail-closed',
      );
      assert(
        resolveAssessHaltIncident({ ...base, fused: true }) === 'framework_bug',
        '已熔断另有原因 → fail-closed',
      );
    },
  },
  {
    name: 't3 责任集合复用既有 FailureKind 分类，未另建第二套分类表',
    run: () => {
      // codex 开工原则①：直接消费现有规范化失败分类。集合成员必须都是合法 FailureKind，
      // 且集合定义与既有 SIGNATURE_HALT_KINDS / CUMULATIVE_HALT_FAMILY 同文件同风格。
      const src = stripComments(
        fs.readFileSync(path.join(SCRIPTS_DIR, 'utils', 'goal-failure-classifier.ts'), 'utf8'),
      );
      assert(
        /EXTERNAL_RETRY_RESPONSIBILITY_KINDS: ReadonlySet<FailureKind>/.test(src),
        '责任集合须建立在既有 FailureKind 之上（而非新造枚举）',
      );
      for (const kind of EXTERNAL_RETRY_RESPONSIBILITY_KINDS) {
        assert(typeof kind === 'string' && kind.length > 0, '集合成员须为 FailureKind 字面');
      }
      assert(
        !EXTERNAL_RETRY_RESPONSIBILITY_KINDS.has('code_regression' as never),
        'code_regression 是内容失败，不得归外部',
      );
    },
  },
  // ==========================================================================
  // f9c2e6b4 t4 —— --requirement-file 的单一读取入口
  // 立项事实：指引只给 `--requirement "<string>"`，宿主 544 字节多行中文需求撞 Windows
  // 引号，agent 每次自造 launch-*.js 包装器 + *-requirement.txt（两份不同名的需求文件，
  // 重跑旧 launcher 即把旧需求带进新 run）。
  // ==========================================================================
  {
    name: 't4 相对路径按 projectRoot 解析；保留换行、去 BOM、首尾裁白',
    run: () => {
      tmpProject((root) => {
        fs.mkdirSync(path.join(root, 'doc'), { recursive: true });
        const body = ['第一行；含中文标点', '', '第二行'].join('\n');
        // 带 BOM + 尾随空行落盘：这正是宿主编辑器写出的真实形态
        fs.writeFileSync(path.join(root, 'doc', 'req.md'), `﻿${body}\n`, 'utf-8');
        const out = resolveRequirementInput({ requirementFile: 'doc/req.md', projectRoot: root });
        assert(out === body, `内容不符：${JSON.stringify(out)}`);
      });
    },
  },
  {
    name: 't4 与 --requirement 互斥（同给即 fail-closed，不猜哪个是真值）',
    run: () => {
      tmpProject((root) => {
        fs.writeFileSync(path.join(root, 'r.md'), 'from file', 'utf-8');
        let threw = false;
        try {
          resolveRequirementInput({ requirement: 'inline', requirementFile: 'r.md', projectRoot: root });
        } catch {
          threw = true;
        }
        assert(threw, '两个真值来源同给必须报错');
        assert(
          resolveRequirementInput({ requirement: 'inline', projectRoot: root }) === 'inline',
          '只给 --requirement 时行为不变',
        );
      });
    },
  },
  {
    name: 't4 缺文件 / 空文件一律 fail-closed（不静默产出空需求）',
    run: () => {
      tmpProject((root) => {
        let missingThrew = false;
        try {
          resolveRequirementInput({ requirementFile: 'nope.md', projectRoot: root });
        } catch {
          missingThrew = true;
        }
        assert(missingThrew, '文件不存在须报错');
        fs.writeFileSync(path.join(root, 'blank.md'), '   \n', 'utf-8');
        let blankThrew = false;
        try {
          resolveRequirementInput({ requirementFile: 'blank.md', projectRoot: root });
        } catch {
          blankThrew = true;
        }
        assert(blankThrew, '空文件须报错——空需求会让整条链跑一个没有目标的 run');
      });
    },
  },
  {
    name: 't4 两个启动入口共用同一读取函数（不得各写一份）',
    run: () => {
      const runner = stripComments(fs.readFileSync(path.join(SCRIPTS_DIR, 'goal-runner.ts'), 'utf8'));
      const entry = stripComments(fs.readFileSync(path.join(SCRIPTS_DIR, 'goal-mode-entry.ts'), 'utf8'));
      for (const [name, src] of [['goal-runner', runner], ['goal-mode-entry', entry]] as const) {
        assert(/resolveRequirementInput\(/.test(src), `${name} 未复用共享读取函数`);
        assert(
          !/readFileSync\([^)]*requirement-file/.test(src),
          `${name} 自行读了 requirement 文件——两份实现必然漂移`,
        );
      }
      // resume 不得重读源文件：runner 侧解析必须被 fresh 条件圈住
      assert(
        /if \(!argv\.resume\) \{[\s\S]{0,400}?resolveRequirementInput\(/.test(runner),
        'runner 必须只在 fresh 分支解析 requirement-file（resume 只认已冻结 manifest）',
      );
      // codex 复核 P2：resume 携该参数必须**显式拒绝**，不得静默忽略
      assert(
        /argv\.resume && typeof argv\['requirement-file'\][\s\S]{0,300}?process\.exit\(2\)/.test(runner),
        'resume 携 --requirement-file 须 fail-closed（禁止静默忽略显式输入）',
      );
      // codex 复核 P2：manifest override 校验必须在 requirement 解析之后，
      // 否则 `--manifest + --requirement-file` 未带 override 时内容被静默忽略
      const resolveAt = runner.indexOf('resolveRequirementInput({');
      const validateAt = runner.indexOf('validateManifestCliOverrides(manifestArgv)');
      assert(resolveAt > 0 && validateAt > 0, '两个锚点都应存在');
      assert(
        validateAt > resolveAt,
        'manifest override 校验必须晚于 requirement 解析，否则 --manifest + --requirement-file 静默失效',
      );
    },
  },
];

const cases: TestCase[] = [
  ...projectionCases,
  ...ironLawCases,
  ...consistencyCases,
  ...metaGateCases,
  ...incidentClosureCases,
  ...lintCases,
  ...manifestCompatCases,
];

export function runAll(): Array<{ name: string; ok: boolean; error?: string }> {
  return cases.map((testCase) => {
    try {
      testCase.run();
      return { name: testCase.name, ok: true };
    } catch (error) {
      return { name: testCase.name, ok: false, error: (error as Error).message };
    }
  });
}
