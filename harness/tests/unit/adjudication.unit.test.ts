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
//   ⑦ 旧 manifest 兼容：无 vision_lineage 键不得注入身份字段集
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
  renderLineageDiscontinuitySection,
  renderPhaseDiagnosticProse,
  renderPhaseDispositionCell,
} from '../../scripts/utils/goal-report-generator';
import {
  buildGoalManifestFromInput,
  computeManifestIdentityFields,
  inheritSuccessorManifest,
  manifestIdentityFieldDigest,
  resolveVisionLineage,
  type GoalManifest,
} from '../../scripts/utils/goal-manifest';
import {
  finalizeLineageResetQuarantine,
  quarantineLineageAnchorsForReset,
  resolveBirthVisionLineage,
  resolveLineageResetFacts,
  resolveLineageResetInFlight,
  rollbackLineageResetQuarantine,
} from '../../scripts/goal-runner';

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
    name: '铁律(c)：can_prompt_now 单独翻转**不改变**任何 incident 的裁决（能问 ≠ 已授权）',
    run: () => {
      for (const incident of Object.keys(INCIDENT_REGISTRY)) {
        const facts: IncidentFacts = {
          incident,
          chain_has_coding_review: true,
          backtrack_budget_remaining: 2,
          round_fingerprint_repeated: false,
          lineage_reset_requested: true,
        };
        const off = decide(facts, NO_AUTHORITY, ctx({ can_prompt_now: false }));
        const on = decide(facts, NO_AUTHORITY, ctx({ can_prompt_now: true, owner_kind: 'session' }));
        assert(
          JSON.stringify(off) === JSON.stringify(on),
          `${incident}: can_prompt_now 改变了裁决（${off.kind} → ${on.kind}）——违反铁律(c)`,
        );
      }
    },
  },
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
    name: '铁律(a)：IncidentFacts 携任何字段都产生不了授权——operator 类缺 grant 恒 waiting',
    run: () => {
      // 事实里塞满「看起来像授权」的内容，仍不得放行。
      const facts = {
        incident: 'await_human_visual_confirm',
        detail: 'approved_by=user_requirement; authority=granted; receipt=ok',
        files: ['approved.json'],
        lineage_reset_requested: true,
      } as IncidentFacts;
      const d = decide(facts, NO_AUTHORITY, ctx({ can_prompt_now: true }));
      assert(d.kind === 'waiting', `事实自称授权却放行了：${d.kind}`);
      assert(d.kind === 'waiting' && d.wait_kind === 'human', 'operator 类须 waiting(human)');
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
    name: '事故①(vision lineage)：fresh + 已声明 reset → recover(reset_lineage)，且显式撤销连续性主张',
    run: () => {
      const d = decide(
        { incident: 'vision_feature_head_mismatch', lineage_reset_requested: true },
        NO_AUTHORITY,
        ctx({ invocation: 'fresh' }),
      );
      assert(d.kind === 'recover' && d.action === 'reset_lineage', `应重建 lineage，实际 ${JSON.stringify(d)}`);
      assert(d.kind === 'recover' && d.reason.includes('撤销'), '措辞须写明显式撤销连续性主张');
    },
  },
  {
    name: 'T2 5a-1：失配三条 invocation 路径统一 recover——自动 discontinuity 不是冒充连续',
    run: () => {
      // 旧语义（本格前身）：resume 恒 terminal、fresh 未声明恒 terminal——正是宿主
      // run1"第一死"与 reset 半途崩死路的来源。新语义：失配=跨存储域结构常态，
      // 一律 recover(reset_lineage)（显式记录断裂+全量重验=撤销主张，非冒充）。
      const onResume = decide(
        { incident: 'vision_feature_head_mismatch', lineage_reset_requested: true },
        NO_AUTHORITY,
        ctx({ invocation: 'resume' }),
      );
      assert(onResume.kind === 'recover' && onResume.action === 'reset_lineage',
        `resume 失配应自动重建，实际 ${JSON.stringify(onResume)}`);
      const undeclared = decide(
        { incident: 'vision_feature_head_mismatch', lineage_reset_requested: false },
        NO_AUTHORITY,
        ctx({ invocation: 'fresh' }),
      );
      assert(undeclared.kind === 'recover' && undeclared.action === 'reset_lineage',
        `未声明失配同样自动重建（不停死），实际 ${JSON.stringify(undeclared)}`);
      assert(undeclared.kind === 'recover' && /不冒充连续/.test(undeclared.reason),
        '自动重建的措辞须写明"不冒充连续"（显式断裂 ≠ 冒充）');
    },
  },
  {
    name: '负例：agent 自行触发 reset **一无所获**——不进 grants、必留断裂、不得声称连续',
    run: () => {
      const d = decide(
        { incident: 'vision_feature_head_mismatch', lineage_reset_requested: true },
        NO_AUTHORITY,
        ctx({ invocation: 'fresh' }),
      );
      // ① reset 走 recover 而非 continue —— 不是「放行」，是「重新证明一遍」
      assert(d.kind === 'recover', 'reset 必须走恢复路而非放行');
      // ② 该路径不消费也不产生任何 authority grant
      const withFakeGrant = decide(
        { incident: 'vision_feature_head_mismatch', lineage_reset_requested: true },
        { grants: [{ action: 'vision_lineage_reset', source: 'verified_receipt', binding: 'x' }] },
        ctx({ invocation: 'fresh' }),
      );
      assert(
        JSON.stringify(withFakeGrant) === JSON.stringify(d),
        'reset 裁决不得受 grants 影响（它不是授权路径）',
      );
      // ③ 结论口径：只能声称「新 lineage 已全链验证」
      assert(d.kind === 'recover' && d.reason.includes('全链重验'), '须声明全链重验');
      assert(d.kind === 'recover' && !d.reason.includes('连续性得以保持'), '不得声称连续性保持');
    },
  },
  {
    name: '事故①事务边界：reset 提交点在 head + checkpoint 之后（HWM 已随 5a 退役）',
    run: () => {
      const src = stripComments(fs.readFileSync(path.join(SCRIPTS_DIR, 'goal-runner.ts'), 'utf8'));
      const headWrite = src.indexOf('const headWrite = writeVisionFeatureHead');
      const cpWrite = src.indexOf('writeVisionCheckpoint({');
      const finalize = src.indexOf('finalizeLineageResetQuarantine({ projectRoot, feature: manifest.feature })');
      assert(headWrite > 0 && cpWrite > 0 && finalize > 0, '锚点缺失');
      assert(finalize > headWrite, '提交点须在 head 写入之后');
      assert(finalize > cpWrite, '提交点须在 checkpoint 写入之后');
      // T2 5a 完成刀：HWM/appendVisionHwm 已整体退役——两件套写毕即提交，
      // 崩溃窗兜底=「head absent + 已声明 reset」自然重入（rollback→重做）
      assert(!/appendVisionHwm\(/.test(src), 'HWM 追加不得复活（5a 完成刀）');
    },
  },
  {
    name: '事故①：显式 reset 不得因 head 状态被静默忽略（无条件遵从）',
    run: () => {
      const src = stripComments(fs.readFileSync(path.join(SCRIPTS_DIR, 'goal-runner.ts'), 'utf8'));
      assert(
        /if \(lineageResetGranted\) \{/.test(src),
        'reset 执行不得再被 head.state 限定——否则「fresh 显式声明 reset 但 head 正常」变静默 no-op',
      );
      // 前置字符不得是 `!`——否则会把合法的 `!lineageResetGranted && (head.state === 'ok'`
      // 当成残留（本仓硬学习：散文/代码断言的子串误判）。
      assert(
        !/[^!]lineageResetGranted && \(head\.state ===/.test(src),
        '残留 head.state 限定（reset 执行仍被 head 状态圈住）',
      );
      // 且后续基于 head.state 的处置必须让位。
      // T2 5a-3（2026-08-07）：invalid **独立分支已整体删除**（并入
      // lineageIncidentPresent 走自动重建——reseal 出路退役）；"让位"的新形态=
      // 不存在独立 invalid 处置 + 事故在场判定含 invalid。
      assert(!/head\.state === 'invalid' && !lineageResetGranted/.test(src),
        'invalid 不得再有独立处置分支（应并入自动重建）');
      assert(/head\.state === 'invalid'\s*$/m.test(src) || /\|\| head\.state === 'invalid'/.test(src),
        'lineageIncidentPresent 须含 invalid（锚不可复用=与失配同路重建）');
      assert(/!lineageResetGranted && head\.state === 'ok'/.test(src), 'ok 分支未让位');
      assert(/head\.state === 'absent' && ledgersPresent && !lineageResetGranted/.test(src), 'absent ack 未让位');
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
  {
    name: 'lineage quarantine 事务（收口刀 head-only）：head 改名让路、HWM 原地不动 → 提交后场外无残留',
    run: () => withTrustDir((root, feature) => {
      const runId = '20260802T000000Z-aaaaaa';
      const q0 = quarantineLineageAnchorsForReset({ projectRoot: root, feature, runId });
      assert(q0.old_head_sha256 === null && q0.head_backup === null, '无锚时应 no-op');

      const { headPath, hwmPath } = seedAnchors(root, feature);
      const hwmBytes = fs.readFileSync(hwmPath, 'utf8');
      const q = quarantineLineageAnchorsForReset({ projectRoot: root, feature, runId });
      assert(q.old_head_sha256 !== null, '应记录旧 head hash');
      assert(!fs.existsSync(headPath), '旧 head 应已改名让路');
      // codex P1-3 核心：HWM 已退出事务——不读、不改名（惰性遗留物）
      assert(fs.existsSync(hwmPath) && fs.readFileSync(hwmPath, 'utf8') === hwmBytes,
        '旧 .hwm.jsonl 必须原地不动（reset 事务只涉 head）');
      assert(fs.existsSync(q.head_backup!), '备份应在场（供事务失败回滚）');

      const removed = finalizeLineageResetQuarantine({ projectRoot: root, feature, runId });
      assert(removed === 1, `提交应删除 1 个场外备份（head-only），实际 ${removed}`);
      assert(!fs.existsSync(q.head_backup!), '场外不得残留（不是历史档案库）');
      assert(finalizeLineageResetQuarantine({ projectRoot: root, feature, runId }) === 0, '提交须幂等');
    }),
  },
  {
    name: 'lineage 事务**中途崩溃可回滚**：改名后崩溃 → 下次启动还原旧 head，不伪装成「head 被删」',
    run: () => withTrustDir((root, feature) => {
      const { headPath, hwmPath } = seedAnchors(root, feature);
      const headSha = fs.readFileSync(headPath, 'utf8');
      // run A：quarantine 后崩溃（不写新 head、不提交）
      quarantineLineageAnchorsForReset({ projectRoot: root, feature, runId: 'runA' });
      assert(!fs.existsSync(headPath), '崩溃时原位为空');

      // 下次启动：无条件回滚 → 旧 head 原样还原（而不是让人看见「head 缺失」这个假象）
      const restored = rollbackLineageResetQuarantine({ projectRoot: root, feature });
      assert(restored.length === 1, `应还原 1 个锚（head-only），实际 ${JSON.stringify(restored)}`);
      assert(fs.readFileSync(headPath, 'utf8') === headSha, '还原内容须逐字节一致');
      assert(fs.existsSync(hwmPath), 'HWM 全程不参与（原地未动）');
      assert(rollbackLineageResetQuarantine({ projectRoot: root, feature }) .length === 0, '回滚须幂等');
    }),
  },
  {
    name: '收口刀（codex P1-3 实测反例转正）：旧 .hwm.jsonl 是**异常实体（目录）**时 reset 照常工作——EISDIR 死点已删',
    run: () => withTrustDir((root, feature) => {
      // codex 复现：宿主遗留 .hwm.jsonl 为目录 → 旧实现 quarantine 读它 EISDIR，
      // run 在 phase 前 uncaught 中断。现 HWM 零参与，异常实体不再有炸 run 的机会。
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const gr = require('../../scripts/goal-runner') as {
        visionFeatureHeadPath: (r: string, f: string) => string;
      };
      const headPath = gr.visionFeatureHeadPath(root, feature);
      const hwmPath = headPath.replace(/\.json$/, '.hwm.jsonl');
      fs.mkdirSync(path.dirname(headPath), { recursive: true });
      fs.writeFileSync(headPath, '{"generation":7,"feature":"bc-openCard"}', 'utf8');
      fs.mkdirSync(hwmPath, { recursive: true }); // 异常实体：目录顶着 HWM 的名字
      const q = quarantineLineageAnchorsForReset({ projectRoot: root, feature, runId: 'runD' });
      assert(q.old_head_sha256 !== null, '异常 HWM 在场时 head quarantine 照常成功');
      const restored = rollbackLineageResetQuarantine({ projectRoot: root, feature });
      assert(restored.length === 1 && fs.existsSync(headPath), '回滚照常还原 head');
      assert(fs.statSync(hwmPath).isDirectory(), '异常实体原样不动（不读不删不改名）');
    }),
  },
  {
    name: '收口刀四（codex P1 实测反例转正）：**目录形态的 .bak** 零识别——不得被改名成 canonical head，finalize 不虚假提交',
    run: () => withTrustDir((root, feature) => {
      // codex 复现链：目录形态 .bak → 旧 finalize 吞删除失败照常返回 → committed 照写
      // → 下次 rollback 删新 head、把目录改名成 canonical head → head 永久变目录。
      // 现残留只认普通文件：目录 bak 零识别（不还原、不清扫、不计数），
      // 已识别普通文件备份的删除失败则**上抛**交 commitVisionAnchors catch
      // （persist_failed+继续，committed 不写——虚假提交根除）。
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const gr = require('../../scripts/goal-runner') as {
        visionFeatureHeadPath: (r: string, f: string) => string;
      };
      const headPath = gr.visionFeatureHeadPath(root, feature);
      fs.mkdirSync(path.dirname(headPath), { recursive: true });
      fs.writeFileSync(headPath, '{"generation":9}', 'utf8');
      fs.mkdirSync(`${headPath}.reset-runDir.bak`, { recursive: true }); // 异常形态残留
      const restored = rollbackLineageResetQuarantine({ projectRoot: root, feature });
      assert(restored.length === 0, `目录 bak 不得被还原：${JSON.stringify(restored)}`);
      assert(fs.readFileSync(headPath, 'utf8') === '{"generation":9}',
        'canonical head 不得被目录顶替（原文件原样在场）');
      assert(finalizeLineageResetQuarantine({ projectRoot: root, feature }) === 0,
        '目录 bak 不计入清扫（零识别，留给人工删除）');
      assert(fs.existsSync(`${headPath}.reset-runDir.bak`), '异常形态残留原样不动');
    }),
  },
  {
    name: '收口终刀二（codex P1 故障注入）：删除/枚举失败 finalize 必须抛出（交 commit catch，committed 不写）；rollback 侧降级',
    run: () => withTrustDir((root, feature) => {
      // codex 口径订正：上一格只验目录 bak 被过滤——即使 finalize 加回 catch 它照样绿。
      // 本格用 fs 定向故障注入直接命中"吞错=虚假提交"分支（不加生产 seam）。
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const gr = require('../../scripts/goal-runner') as {
        visionFeatureHeadPath: (r: string, f: string) => string;
      };
      const headPath = gr.visionFeatureHeadPath(root, feature);
      fs.mkdirSync(path.dirname(headPath), { recursive: true });
      const bak = `${headPath}.reset-runF.bak`;
      fs.writeFileSync(bak, '{"generation":2}', 'utf8');
      // 注入必须打在**裸 require 的 fs 模块单例**上——`import * as fs` 的命名空间是
      // 只读 getter 包装，且与生产模块内的 fs 不保证同一实例
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fsMod = require('fs') as { rmSync: typeof fs.rmSync; readdirSync: typeof fs.readdirSync };
      // ① 已识别普通文件备份删除失败 → finalize 上抛（committed 由 commit catch 拦住不写）
      const realRm = fsMod.rmSync;
      let delThrew = '';
      fsMod.rmSync = ((..._a: unknown[]) => { throw new Error('injected-delete-denied'); }) as unknown as typeof fs.rmSync;
      try {
        try { finalizeLineageResetQuarantine({ projectRoot: root, feature }); } catch (e) { delThrew = (e as Error).message; }
      } finally { fsMod.rmSync = realRm; }
      assert(delThrew.includes('injected-delete-denied'), `删除失败必须上抛，实得：${delThrew || '(未抛)'}`);
      assert(fs.existsSync(bak), '备份仍在场（"事务未完成"是真实事实，不得宣称已提交）');
      // ② 枚举失败 → finalize 同样上抛（"无法确认备份是否清空"≠"没有备份"）；
      //    rollback 在自己的调用点降级为无残留继续（不抛）
      const realReaddir = fsMod.readdirSync;
      let scanThrew = '';
      fsMod.readdirSync = ((..._a: unknown[]) => { throw new Error('injected-scan-denied'); }) as unknown as typeof fs.readdirSync;
      try {
        try { finalizeLineageResetQuarantine({ projectRoot: root, feature }); } catch (e) { scanThrew = (e as Error).message; }
        assert(rollbackLineageResetQuarantine({ projectRoot: root, feature }).length === 0,
          'rollback 侧枚举失败＝无残留继续（降级只在需要它的一侧）');
      } finally { fsMod.readdirSync = realReaddir; }
      assert(scanThrew.includes('injected-scan-denied'), `枚举失败必须上抛，实得：${scanThrew || '(未抛)'}`);
      // 注入解除后清扫恢复正常（残留不留给后续用例）
      assert(finalizeLineageResetQuarantine({ projectRoot: root, feature }) === 1, '注入解除后清扫成功');
    }),
  },
  {
    name: '收口刀二（codex P1-2\' 实测反例转正）：canonical HWM=目录 + 旧 .reset-*.bak 在场 → rollback 零识别零抛错',
    run: () => withTrustDir((root, feature) => {
      // codex 复现：上一刀的"legacy hwm 残留兼容回滚"自身是死点——还原目标是目录时
      // rmSync 撞 ERR_FS_EISDIR，启动即崩。现残留扫描彻底不识别 HWM：残留原样留着
      // （人工删除即可），head 侧照常工作。
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const gr = require('../../scripts/goal-runner') as {
        visionFeatureHeadPath: (r: string, f: string) => string;
      };
      const headPath = gr.visionFeatureHeadPath(root, feature);
      const hwmPath = headPath.replace(/\.json$/, '.hwm.jsonl');
      fs.mkdirSync(path.dirname(headPath), { recursive: true });
      fs.mkdirSync(hwmPath, { recursive: true });                       // canonical HWM=目录
      fs.writeFileSync(`${hwmPath}.reset-runOld.bak`, '{"seq":9}\n', 'utf8'); // 旧版本残留
      fs.writeFileSync(`${hwmPath}.reset-runOld2.absent`, '', 'utf8');        // 旧墓碑残留
      const restored = rollbackLineageResetQuarantine({ projectRoot: root, feature });
      assert(restored.length === 0, `HWM 残留不得被识别/回滚：${JSON.stringify(restored)}`);
      assert(fs.existsSync(`${hwmPath}.reset-runOld.bak`) && fs.statSync(hwmPath).isDirectory(),
        'HWM 残留与异常实体原样不动（惰性遗留物，允许人工删除）');
      // head 侧不受影响：正常 quarantine/回滚照走
      fs.writeFileSync(headPath, '{"generation":5}', 'utf8');
      quarantineLineageAnchorsForReset({ projectRoot: root, feature, runId: 'runE' });
      assert(rollbackLineageResetQuarantine({ projectRoot: root, feature }).length === 1,
        'head 残留照常回滚（HWM 零参与不连坐）');
    }),
  },
  {
    name: 'lineage 事务：无任何旧锚时 reset = 首次建链，不留墓碑（正常首建不该变成未提交事务）',
    run: () => withTrustDir((root, feature) => {
      const q = quarantineLineageAnchorsForReset({ projectRoot: root, feature, runId: 'runN' });
      assert(q.old_head_sha256 === null, '无锚时无旧 hash');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const gr = require('../../scripts/goal-runner') as { visionFeatureHeadPath: (r: string, f: string) => string };
      const dir = path.dirname(gr.visionFeatureHeadPath(root, feature));
      const residue = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter((n) => /\.reset-/.test(n))
        : [];
      assert(residue.length === 0, `首建不应留墓碑：${JSON.stringify(residue)}`);
      assert(rollbackLineageResetQuarantine({ projectRoot: root, feature }).length === 0, '无残留可回滚');
    }),
  },
  {
    name: 'lineage 事务：崩溃残留不得成为孤儿——新 run 提交时清扫**全部** .reset-*.bak',
    run: () => withTrustDir((root, feature) => {
      const { headPath } = seedAnchors(root, feature);
      quarantineLineageAnchorsForReset({ projectRoot: root, feature, runId: 'runA' }); // 崩溃
      // run B 重做：quarantine 前置回滚会先还原 runA 的备份，再以 runB 名义改名
      const qB = quarantineLineageAnchorsForReset({ projectRoot: root, feature, runId: 'runB' });
      assert(qB.rolled_back_from.length === 1, `应先回滚上一次残留（head-only），实际 ${JSON.stringify(qB.rolled_back_from)}`);
      assert(qB.old_head_sha256 !== null, 'runB 应拿到旧 head hash');
      const dir = path.dirname(headPath);
      const baks = fs.readdirSync(dir).filter((n) => /\.reset-.*\.bak$/.test(n));
      assert(baks.length === 1, `场外任一时刻最多一代备份，实际 ${JSON.stringify(baks)}`);
      assert(baks.every((n) => n.includes('runB')), `残留应只属当前 run：${JSON.stringify(baks)}`);

      finalizeLineageResetQuarantine({ projectRoot: root, feature, runId: 'runB' });
      assert(
        fs.readdirSync(dir).filter((n) => /\.reset-.*\.bak$/.test(n)).length === 0,
        '提交后场外不得有任何 reset 残留',
      );
    }),
  },
];

/** 把场外 trust 根指向临时目录跑（避免污染真实 ~/.maison）。 */
function withTrustDir(run: (projectRoot: string, feature: string) => void): void {
  tmpProject((root) => {
    const prev = process.env.MAISON_GOAL_CHECKPOINT_DIR;
    process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'home', 'goal-checkpoints');
    try { run(root, 'bc-openCard'); } finally {
      if (prev === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR;
      else process.env.MAISON_GOAL_CHECKPOINT_DIR = prev;
    }
  });
}

/** 走真实路径函数造出旧 head；旁边再放一份惰性 .hwm.jsonl 遗留物（生产已无该路径
 * 函数——`visionHwmPath` 随收口刀二删除，测试按文件名惯例自拼，用于证明"零参与"）。 */
function seedAnchors(projectRoot: string, feature: string): { headPath: string; hwmPath: string } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const gr = require('../../scripts/goal-runner') as {
    visionFeatureHeadPath: (r: string, f: string) => string;
  };
  const headPath = gr.visionFeatureHeadPath(projectRoot, feature);
  const hwmPath = headPath.replace(/\.json$/, '.hwm.jsonl');
  fs.mkdirSync(path.dirname(headPath), { recursive: true });
  fs.writeFileSync(headPath, '{"generation":23,"feature":"bc-openCard"}', 'utf8');
  fs.writeFileSync(hwmPath, '{"seq":1}\n', 'utf8');
  return { headPath, hwmPath };
}

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
    name: '旧 manifest（无 vision_lineage 键）身份字段集**不得注入该键**——否则既有 run resume 误判漂移',
    run: () => tmpProject((root) => {
      const legacy = buildGoalManifestFromInput(baseManifestInput(), { projectRoot: root });
      assert(!('vision_lineage' in legacy), 'fresh 未声明时不得落键');
      const fields = computeManifestIdentityFields(legacy);
      assert(!('vision_lineage' in fields), '身份字段集不得凭空多出 vision_lineage');
      assert(resolveVisionLineage(legacy) === 'continue', '缺键行为按 continue');
    }),
  },
  {
    name: '声明后：键在场即入身份字段集（停机期间被补写仍会被既有 drift 检测发现）',
    run: () => tmpProject((root) => {
      const declared = buildGoalManifestFromInput(
        baseManifestInput({ vision_lineage: 'reset' }),
        { projectRoot: root },
      );
      assert(declared.vision_lineage === 'reset', '应落键');
      const fields = computeManifestIdentityFields(declared);
      assert('vision_lineage' in fields, '键在场须入身份字段集');
      // 篡改为 continue → 身份字段变化可被检出
      const tampered = computeManifestIdentityFields({ ...declared, vision_lineage: 'continue' });
      assert(fields.vision_lineage !== tampered.vision_lineage, '改写该键须导致身份字段漂移');
    }),
  },
  {
    name: 'vision_lineage 非法枚举 fail-closed；中途升级 reset 的防线=身份 drift+出生冻结（decide 恒 recover）',
    run: () => tmpProject((root) => {
      let msg = '';
      try {
        buildGoalManifestFromInput(baseManifestInput({ vision_lineage: 'nuke' }), { projectRoot: root });
      } catch (e) { msg = (e as Error).message; }
      assert(msg.includes('vision_lineage'), `应拒绝非法枚举，实际：${msg}`);

      // e5d8a2c4 T1③：基于出生字段的 resume 硬拒**已删除**（它把「已消费的出生声明」
      // 与「中途塞入」连坐）。此处改为钉住接替它的两道门仍在：
      // ① vision_lineage 计入 manifest 身份字段 → 停机期被补写会被 events 出生基线 drift 检出；
      const withReset = buildGoalManifestFromInput(
        baseManifestInput({ vision_lineage: 'reset' }), { projectRoot: root });
      const withoutReset = buildGoalManifestFromInput(baseManifestInput({}), { projectRoot: root });
      const fReset = computeManifestIdentityFields(withReset);
      const fPlain = computeManifestIdentityFields(withoutReset);
      assert('vision_lineage' in fReset, 'reset 在场须入身份字段集（否则中途补写检测不到）');
      assert(!('vision_lineage' in fPlain), '未声明时不得凭空补键（否则旧 run resume 误判漂移）');
      // ② T2 5a-1 后 decide 层不再裁"声明合法性"（三路径统一 recover）——"中途升级"
      // 的防线整体移交：①的身份字段 drift 检测（events 出生基线，停机改 manifest 先被拦）
      // + 出生冻结值判据（补写拿不到 in_flight）。此处只钉 decide 恒 recover 的新契约。
      const midRunReset = decide(
        { incident: 'vision_feature_head_mismatch', lineage_reset_requested: true },
        NO_AUTHORITY,
        { orchestration: 'goal', owner_kind: 'process', can_prompt_now: false, invocation: 'resume' },
      );
      assert(midRunReset.kind === 'recover', `5a-1 后失配裁决恒 recover，实得 ${midRunReset.kind}`);

      // T1③(b)(c)：**未完成的 reset 事务**判据——它不是"中途升级"（那条被出生冻结值
      // 挡在判据之外），而是同一笔已获准事务的幂等完成。崩溃窗实锤（立项时旧语义）：
      // discontinuity 已写、committed 未写时崩溃，resume 回滚旧锚后 reset 被静默丢弃。
      const ev = (t: string): Record<string, unknown> => ({ type: t });
      assert(
        resolveLineageResetInFlight('reset', [ev('lineage_discontinuity')]) === true,
        'discontinuity 无 committed → 未完成，须幂等续做',
      );
      assert(
        resolveLineageResetInFlight('reset', [ev('lineage_discontinuity'), ev('lineage_reset_committed')]) === false,
        'committed 在场 → 已消费，不得重做',
      );
      // codex 二轮：一个 run **只有一次出生 reset**，"committed 后再起新事务"不是合法
      // 形态——原用例连同那套可反复开合的状态机一并删除。
      assert(
        resolveLineageResetInFlight('reset', [ev('lineage_reset_committed'), ev('lineage_discontinuity')]) === false,
        'committed 一旦出现即已消费，其后再有 discontinuity 也不重开',
      );
      // **覆盖更早的崩溃窗**：quarantine 已改场外锚、discontinuity 尚未落盘时崩溃，
      // 事件里什么都没有——初版判据在此返回 false（旧锚失配→terminal / 旧锚有效→静默跳过）。
      assert(
        resolveLineageResetInFlight('reset', [ev('run_start')]) === true,
        'discontinuity 落盘前崩溃 → 仍须判未完成（出生声明为起点，不依赖过程事件）',
      );
      assert(
        resolveLineageResetInFlight('continue', [ev('lineage_discontinuity')]) === false,
        '出生未声明 reset 时恒 false——单靠伪造过程事件拿不到 reset',
      );
      assert(
        resolveLineageResetInFlight('reset', []) === true,
        '声明了 reset 且无 committed → 待消费（判据是出生声明，不是过程事件）',
      );
    }),
  },
  {
    // codex 三轮 P1：上一版判据读的是**当前盘上的 manifest**，注释却写"出生冻结"。
    // 真实攻击面不是伪造 events，而是**停机窗口改 manifest**——首次 vision checkpoint
    // 尚未生成时 drift 按「无基线」放行，于是中途补写 reset 就能骗到 recover，
    // 正好绕过"中途升级 reset 无效"这条红线（当时的裁决还是 terminal，现恒 recover——
    // 红线的承载者是出生冻结判据本身，不是裁决种类）。
    name: 'T1③ 出生冻结 lineage：resume 只认首个 run_start，停机期改 manifest 无效',
    run: () => {
      const reset = { vision_lineage: 'reset' } as Pick<GoalManifest, 'vision_lineage'>;
      // **夹具必须按真实 writer 的形状造**（fable 四批 P0）：生产写进 run_start 的
      // `manifest_identity_fields` 是逐字段 sha256 截断，**不是原值**。初版夹具手写
      // `{vision_lineage:'reset'}`，于是判据里那句 `=== 'reset'` 在夹具上成立、在
      // 生产上恒 false——功能等于没修，还全绿穿过了四轮 review。
      const runStart = (lineage?: string): Record<string, unknown> => ({
        type: 'run_start',
        ...(lineage === undefined
          ? {}
          : { manifest_identity_fields: { vision_lineage: manifestIdentityFieldDigest(lineage) } }),
      });

      // 形状断言：夹具里存的必须是指纹。手写回原值 → 这一格立刻红。
      const fields = (runStart('reset').manifest_identity_fields ?? {}) as Record<string, string>;
      assert(
        /^[0-9a-f]{16}$/.test(fields.vision_lineage) && fields.vision_lineage !== 'reset',
        `夹具须与真实 writer 同形状（逐字段 sha256 截断），实得 ${fields.vision_lineage}`,
      );
      // 并且这个指纹确实来自真实 writer——不是本用例自己另算一份
      assertEq(
        fields.vision_lineage,
        computeManifestIdentityFields(
          buildGoalManifestFromInput(baseManifestInput({ vision_lineage: 'reset' }), { projectRoot: process.cwd() }),
        ).vision_lineage,
        '夹具指纹须与 computeManifestIdentityFields 的产出逐字节一致',
      );

      // fresh：本 run 尚未落 run_start → 当前 manifest 就是出生值
      assertEq(resolveBirthVisionLineage([], reset), 'reset', 'fresh 取当前 manifest');

      // resume 且出生确实声明了 reset → 续做成立
      assertEq(
        resolveBirthVisionLineage([runStart('reset')], { vision_lineage: 'continue' }),
        'reset',
        '出生为 reset 时，即便当前 manifest 已被改回 continue 也须认出生值',
      );

      // **攻击面正例**：出生是 continue，停机期把 manifest 改成 reset
      assertEq(
        resolveBirthVisionLineage([runStart('continue')], reset),
        'continue',
        '停机期补写 reset 不得被认成出生声明',
      );
      // 出生时压根没有该键（未声明）——身份字段集里也不会有它
      assertEq(
        resolveBirthVisionLineage([{ type: 'run_start', manifest_identity_fields: {} }], reset),
        'continue',
        '出生未声明该键 → 中途补写同样无效',
      );
      // 旧 schema：run_start 无身份字段快照 → 出生意图不可证 → fail-closed，
      // **不得**回落到当前 manifest（那个回落就是攻击面本身）
      assertEq(
        resolveBirthVisionLineage([runStart(undefined)], reset),
        'continue',
        '缺身份字段快照须 fail-closed，不得回落当前 manifest',
      );

      // 端到端：篡改后的 resume 必须仍然 terminal
      const tamperedInFlight = resolveLineageResetInFlight(
        resolveBirthVisionLineage([runStart('continue')], reset),
        [runStart('continue')],
      );
      assertEq(tamperedInFlight, false, '篡改后不得判为未完成事务');
      const verdict = decide(
        {
          incident: 'vision_feature_head_mismatch',
          lineage_reset_requested: true,          // 盘上 manifest 确实写着 reset
          lineage_reset_in_flight: tamperedInFlight,
        },
        NO_AUTHORITY,
        { orchestration: 'goal', owner_kind: 'process', can_prompt_now: false, invocation: 'resume' },
      );
      // T2 5a-1：decide 恒 recover——补写者"一无所获"的保证不再由 decide 承担：
      // 重建=撤销主张+全量重验（非权限），且停机改 manifest 早被身份 drift 检测拦下。
      assertEq(verdict.kind, 'recover', '5a-1 后失配裁决恒 recover（防线在 drift 层）');
    },
  },
  {
    // codex 四批 P1：同一次裁决里 lineage_reset_in_flight 用出生冻结值、
    // lineage_reset_requested 却读当前盘上 manifest = **同一事实两个来源**。
    name: 'T1③ reset 两项事实同源：出生 reset + 停机期改回 continue + 未 committed + resume → recover',
    run: () => {
      const birthReset = [{
        type: 'run_start',
        manifest_identity_fields: { vision_lineage: manifestIdentityFieldDigest('reset') },
      }];
      // 盘上 manifest 已被改回 continue（或干脆删了该键）——出生值不因此改变
      const birthLineage = resolveBirthVisionLineage(birthReset, { vision_lineage: 'continue' });
      assertEq(birthLineage, 'reset', '出生值只认首个 run_start');

      // **消费生产的组装点**（codex 五批 P1）：此前这里手拼 `birthLineage === 'reset'`，
      // 与 goal-runner 调用点各写一遍——于是"把生产改回读当前 manifest"这个变异
      // 咬不到本用例，而我把它记成了咬中（变异脚本改的是本文件自己＝自证循环）。
      const facts = resolveLineageResetFacts(birthReset, { vision_lineage: 'continue' });
      assertEq(facts.lineage_reset_requested, true, 'requested 须取出生值，不读当前 manifest');
      assertEq(facts.lineage_reset_in_flight, true, '无 committed → 事务未完成');
      const decision = decide(
        { incident: 'vision_feature_head_mismatch', ...facts },
        NO_AUTHORITY,
        { orchestration: 'goal', owner_kind: 'process', can_prompt_now: false, invocation: 'resume' },
      );
      assertEq(decision.kind, 'recover', `未完成的出生事务须幂等续做，实得 ${decision.kind}`);

      // 对照：出生就是 continue（真·中途升级）→ 补写者拿不到出生事实（in_flight=false），
      // 红线没被这条修复削弱——裁决虽恒 recover，但 recover 不授予任何权限
      const midRunDecision = decide(
        {
          incident: 'vision_feature_head_mismatch',
          ...resolveLineageResetFacts(
            [{
              type: 'run_start',
              manifest_identity_fields: { vision_lineage: manifestIdentityFieldDigest('continue') },
            }],
            { vision_lineage: 'reset' },   // 停机期补写 reset
          ),
        },
        NO_AUTHORITY,
        { orchestration: 'goal', owner_kind: 'process', can_prompt_now: false, invocation: 'resume' },
      );
      // T2 5a-1：同源判据仍然成立（in_flight=false 因出生是 continue），只是裁决
      // 从 terminal 改 recover——重建不授予任何权限，补写者依旧一无所获。
      assertEq(midRunDecision.kind, 'recover', '5a-1 后失配裁决恒 recover（同源判据不变）');
    },
  },
  {
    name: 'T3 后继 manifest 继承源 run 的完整启动契约与去重指纹，不继承阶段完成态',
    run: () => tmpProject((root) => {
      const source = buildGoalManifestFromInput(baseManifestInput({
        run_id: '20260807T000000Z-source',
        end_phase: 'ut',
        vision_lineage: 'reset',
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
        assertEq(JSON.stringify(successor[key]), JSON.stringify(source[key]), `后继不得丢失 ${key}`);
      }
      assertEq(successor.successor_of, source.run_id, '后继须绑定源 run');
      assert(!Object.prototype.hasOwnProperty.call(successor, 'vision_lineage'),
        '后继不得继承已消费的一次性 vision_lineage 出生指令');
      assertEq(resolveVisionLineage(successor), 'continue', '后继默认继续源 lineage，不得重复 reset');
      const explicitReset = buildGoalManifestFromInput(baseManifestInput({
        run_id: '20260807T000002Z-successor-reset',
        vision_lineage: 'reset',
      }), { projectRoot: root });
      const resetSuccessor = inheritSuccessorManifest(explicitReset, source, { round: [], drift: [] });
      assert(Object.prototype.hasOwnProperty.call(resetSuccessor, 'vision_lineage'),
        'fresh successor 显式声明 reset 时必须保留该出生字段');
      assertEq(resolveVisionLineage(resetSuccessor), 'reset',
        'fresh successor 显式 reset 不得被继承清理逻辑静默吞掉');
      assertEq(JSON.stringify(successor.inherited_round_fingerprints), JSON.stringify(['round-a']), 'round 指纹须去重');
      assertEq(JSON.stringify(successor.inherited_drift_fingerprints), JSON.stringify(['drift-a', 'drift-b']), 'drift 指纹须去重');
      const identity = computeManifestIdentityFields(successor);
      assert('successor_of' in identity && 'inherited_round_fingerprints' in identity
        && 'inherited_drift_fingerprints' in identity, '后继身份字段须绑定继承元数据');
      assert(!('phase_outcomes' in successor), '后继不得复制源 run 阶段完成态');
    }),
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
      for (const id of ['unauthorized_source_mutation', 'vision_feature_head_mismatch',
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
    name: 't5③ lineage 断裂展示：报告须显示连续性已撤销，且全文无「连续性保持」口径',
    run: () => {
      const md = renderLineageDiscontinuitySection([
        {
          type: 'lineage_discontinuity', reason: '账本与 feature head 失配',
          old_head_sha256: 'aaa', old_generation: 23, continuity_claim: 'revoked',
        },
        { type: 'lineage_reset_committed', new_head_sha256: 'bbb', new_generation: 1 },
      ]).join('\n');
      assert(md.includes('历史连续性'), '须点明连续性话题');
      assert(/撤销|revoked/.test(md), `须明示已撤销：${md}`);
      assert(md.includes('aaa') && md.includes('bbb'), '须含新旧 hash 供核对');
      assert(!/连续性得以保持|连续性保持/.test(md), '**绝不得**出现连续性保持口径');
      // 无断裂事件时不产生该节（不给未 reset 的 run 平白加噪音）
      assert(renderLineageDiscontinuitySection([], 'CHAIN_SLICE_COMPLETED').length === 0, '无断裂应无该节');
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
    name: 't5③ lineage 声明**逐级递进**：未提交 / 未走完全链时不得宣称「已全链验证」',
    run: () => {
      const discontinuity = {
        type: 'lineage_discontinuity', reason: 'r', old_head_sha256: 'aaa', continuity_claim: 'revoked',
      };
      // ① 只有断裂：不得说已建立、更不得说已全链验证
      const onlyBroken = renderLineageDiscontinuitySection([discontinuity]).join('\n');
      assert(onlyBroken.includes('已撤销'), '须声明连续性已撤销');
      assert(onlyBroken.includes('尚未建立'), `reset 未提交却宣称已建立：${onlyBroken}`);
      assert(!/已全链验证(?!」)/.test(onlyBroken.replace(/尚不能声称「已全链验证」/g, '')),
        `未走完全链却宣称已全链验证：${onlyBroken}`);
      // ② 已提交但 run 没走完：可说已建立，仍不得说已全链验证
      const committedOnly = renderLineageDiscontinuitySection([
        discontinuity, { type: 'lineage_reset_committed', new_head_sha256: 'bbb', new_generation: 1 },
        { type: 'run_end', status: 'HALTED' },
      ]).join('\n');
      assert(committedOnly.includes('已建立'), '已提交应可声明已建立');
      assert(committedOnly.includes('尚不能声称'), `HALTED 收尾仍宣称全链验证：${committedOnly}`);
      // ③ 已提交 + 完成终态：才可声明已全链验证。**终态由调用方传 report.status**——
      // 生产顺序是 writeGoalReport 先于 emit(run_end)，报告生成时事件流里还没有本次终态。
      const committedEvents = [
        discontinuity,
        { type: 'lineage_reset_committed', new_head_sha256: 'bbb', new_generation: 1 },
      ];
      const full = renderLineageDiscontinuitySection(committedEvents, 'CHAIN_SLICE_COMPLETED').join('\n');
      assert(full.includes('已全链验证'), '完成终态应可声明全链验证');
      assert(!full.includes('尚不能声称'), '完成终态不应再说尚不能声称');
      // 反向钉死生产时序陷阱：**光靠事件里的 run_end 不算数**（那时它还没落盘）。
      // 若哪天有人把判据改回扫事件，本断言会红。
      const eventsOnly = renderLineageDiscontinuitySection(
        [...committedEvents, { type: 'run_end', status: 'CHAIN_SLICE_COMPLETED' }],
        undefined,
      ).join('\n');
      assert(
        eventsOnly.includes('尚不能声称'),
        '判据回退到扫 events 了——生产时序下报告生成早于 run_end 落盘，' +
        '每个成功 run 都会被写成「尚不能声称已全链验证」',
      );
      // 三种情形都不得出现「连续性保持」
      for (const md of [onlyBroken, committedOnly, full]) {
        assert(!/连续性得以保持|连续性保持/.test(md), '绝不得出现连续性保持口径');
      }
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
        'resume 携 --requirement-file 须 fail-closed（同 --vision-lineage 的禁止静默忽略原则）',
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
