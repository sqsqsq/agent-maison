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
import { reduceRunState, supervisorAction } from '../../scripts/utils/run-state-reducer';
import {
  renderLineageDiscontinuitySection,
  renderPhaseDiagnosticProse,
  renderPhaseDispositionCell,
} from '../../scripts/utils/goal-report-generator';
import {
  buildGoalManifestFromInput,
  computeManifestIdentityFields,
  resolveVisionLineage,
  visionLineageResumeIssue,
  type GoalManifest,
} from '../../scripts/utils/goal-manifest';
import {
  finalizeLineageResetQuarantine,
  quarantineLineageAnchorsForReset,
  rollbackLineageResetQuarantine,
} from '../../scripts/goal-runner';

const SCRIPTS_DIR = path.resolve(__dirname, '..', '..', 'scripts');

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
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
    name: '疑似误分类项**只标注不改行为**：suspected_misclassified 恒不影响裁决输出',
    run: () => {
      const suspects = Object.entries(INCIDENT_REGISTRY).filter(([, s]) => s.suspected_misclassified);
      assert(suspects.length === 6, `疑似误分类应为 6 条，实际 ${suspects.length}`);
      for (const [incident, spec] of suspects) {
        const d = decide({ incident }, NO_AUTHORITY, ctx());
        // 与「保持现行行为」同构：停下（waiting/terminal），不得自动恢复或放行
        assert(
          d.kind === 'waiting' || d.kind === 'terminal',
          `${incident}(${spec.class}): 只映射不改行为——不得产出 ${d.kind}`,
        );
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
    name: '事故①：resume + 失配恒 terminal（绝不冒充连续），未声明 reset 亦 terminal',
    run: () => {
      const onResume = decide(
        { incident: 'vision_feature_head_mismatch', lineage_reset_requested: true },
        NO_AUTHORITY,
        ctx({ invocation: 'resume' }),
      );
      assert(onResume.kind === 'terminal', `resume 须 terminal，实际 ${onResume.kind}`);
      const undeclared = decide(
        { incident: 'vision_feature_head_mismatch', lineage_reset_requested: false },
        NO_AUTHORITY,
        ctx({ invocation: 'fresh' }),
      );
      assert(undeclared.kind === 'terminal', '未声明 reset 不得擅自重建');
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
    name: '事故①事务边界：reset 提交点必须在 **head + checkpoint + HWM 三件套之后**',
    run: () => {
      const src = stripComments(fs.readFileSync(path.join(SCRIPTS_DIR, 'goal-runner.ts'), 'utf8'));
      const headWrite = src.indexOf('const headWrite = writeVisionFeatureHead');
      const cpWrite = src.indexOf('writeVisionCheckpoint({');
      const hwmWrite = src.indexOf('appendVisionHwm({');
      const finalize = src.indexOf('finalizeLineageResetQuarantine({ projectRoot, feature: manifest.feature })');
      assert(headWrite > 0 && cpWrite > 0 && hwmWrite > 0 && finalize > 0, '锚点缺失');
      assert(finalize > headWrite, '提交点须在 head 写入之后');
      assert(finalize > cpWrite, '提交点须在 checkpoint 写入之后');
      assert(
        finalize > hwmWrite,
        '提交点须在 HWM 写入之后——否则「新 head 已写、HWM 未写」时崩溃会旧锚已毁、新链未成',
      );
      // 提交前必须复验新链
      const window = src.slice(hwmWrite, finalize);
      assert(/readVisionHwmHighWater\(/.test(window), '提交前须复验新 HWM 链');
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
      // 且后续基于 head.state 的处置必须让位
      assert(/head\.state === 'invalid' && !lineageResetGranted/.test(src), 'invalid 分支未让位');
      assert(/!lineageResetGranted && \(head\.state === 'ok'/.test(src), 'ok 分支未让位');
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
    name: 'lineage quarantine 事务：改名让路 → 提交后场外无残留',
    run: () => withTrustDir((root, feature) => {
      const runId = '20260802T000000Z-aaaaaa';
      const q0 = quarantineLineageAnchorsForReset({ projectRoot: root, feature, runId });
      assert(q0.old_head_sha256 === null && q0.head_backup === null, '无锚时应 no-op');

      const { headPath, hwmPath } = seedAnchors(root, feature);
      const q = quarantineLineageAnchorsForReset({ projectRoot: root, feature, runId });
      assert(q.old_head_sha256 !== null && q.old_hwm_sha256 !== null, '应记录旧 head/HWM hash');
      assert(!fs.existsSync(headPath) && !fs.existsSync(hwmPath), '旧锚应已改名让路');
      assert(fs.existsSync(q.head_backup!), '备份应在场（供事务失败回滚）');

      const removed = finalizeLineageResetQuarantine({ projectRoot: root, feature, runId });
      assert(removed === 2, `提交应删除 2 个场外备份，实际 ${removed}`);
      assert(!fs.existsSync(q.head_backup!), '场外不得残留（不是历史档案库）');
      assert(finalizeLineageResetQuarantine({ projectRoot: root, feature, runId }) === 0, '提交须幂等');
    }),
  },
  {
    name: 'lineage 事务**中途崩溃可回滚**：改名后崩溃 → 下次启动还原旧锚，不伪装成「head 被删」',
    run: () => withTrustDir((root, feature) => {
      const { headPath, hwmPath } = seedAnchors(root, feature);
      const headSha = fs.readFileSync(headPath, 'utf8');
      // run A：quarantine 后崩溃（不写新 head、不提交）
      quarantineLineageAnchorsForReset({ projectRoot: root, feature, runId: 'runA' });
      assert(!fs.existsSync(headPath), '崩溃时原位为空');

      // 下次启动：无条件回滚 → 旧锚原样还原（而不是让人看见「head 缺失」这个假象）
      const restored = rollbackLineageResetQuarantine({ projectRoot: root, feature });
      assert(restored.length === 2, `应还原 2 个锚，实际 ${JSON.stringify(restored)}`);
      assert(fs.existsSync(headPath) && fs.existsSync(hwmPath), '旧锚应回到原位');
      assert(fs.readFileSync(headPath, 'utf8') === headSha, '还原内容须逐字节一致');
      assert(rollbackLineageResetQuarantine({ projectRoot: root, feature }) .length === 0, '回滚须幂等');
    }),
  },
  {
    name: 'lineage 事务：**新 head 已写、HWM 未写**时崩溃 → 回滚是全有全无，绝不拼出「新 head + 旧 HWM」混合链',
    run: () => withTrustDir((root, feature) => {
      const { headPath, hwmPath } = seedAnchors(root, feature);
      const oldHead = fs.readFileSync(headPath, 'utf8');
      const oldHwm = fs.readFileSync(hwmPath, 'utf8');
      quarantineLineageAnchorsForReset({ projectRoot: root, feature, runId: 'runA' });
      // 模拟最危险窗口：新 head 已落盘，checkpoint/HWM 尚未建立 → 崩溃
      fs.writeFileSync(headPath, '{"generation":1,"feature":"bc-openCard","NEW":true}', 'utf8');
      assert(!fs.existsSync(hwmPath), '该窗口下新 HWM 尚不存在');

      const restored = rollbackLineageResetQuarantine({ projectRoot: root, feature });
      assert(restored.length === 2, `应整体回滚 2 个锚，实际 ${JSON.stringify(restored)}`);
      assert(fs.readFileSync(headPath, 'utf8') === oldHead, '半成品新 head 必须被清除、旧 head 还原');
      assert(fs.readFileSync(hwmPath, 'utf8') === oldHwm, '旧 HWM 还原');
      // 反例守卫：绝不能出现「新 head 内容 + 旧 HWM」
      assert(!fs.readFileSync(headPath, 'utf8').includes('NEW'), '混合链：新 head 残留');
      const baks = fs.readdirSync(path.dirname(headPath)).filter((n) => /\.reset-.*\.bak$/.test(n));
      assert(baks.length === 0, `回滚后不应留备份：${JSON.stringify(baks)}`);
    }),
  },
  {
    name: 'lineage 事务 legacy 分支：**旧 head 在、旧 HWM absent** 时崩溃 → 回滚须把 HWM 恢复成 absent，不留「旧 head + 新 HWM」',
    run: () => withTrustDir((root, feature) => {
      // legacy 受支持形态：有 head、无 HWM（1.0 head 未声明 hwm_declared）
      const { headPath, hwmPath } = seedAnchors(root, feature);
      fs.rmSync(hwmPath, { force: true });
      const oldHead = fs.readFileSync(headPath, 'utf8');
      assert(!fs.existsSync(hwmPath), '前置：旧 HWM 应 absent');

      quarantineLineageAnchorsForReset({ projectRoot: root, feature, runId: 'runL' });
      // 最危险窗口：新 head + 新 HWM 都已写，finalize 之前崩溃
      fs.writeFileSync(headPath, '{"generation":1,"NEW":true}', 'utf8');
      fs.writeFileSync(hwmPath, '{"seq":1,"NEW":true}\n', 'utf8');

      const restored = rollbackLineageResetQuarantine({ projectRoot: root, feature });
      assert(restored.length === 2, `两个锚都须处理（含 absent 侧），实际 ${JSON.stringify(restored)}`);
      assert(fs.readFileSync(headPath, 'utf8') === oldHead, '旧 head 须逐字节还原');
      assert(
        !fs.existsSync(hwmPath),
        '旧值为 absent 的锚必须恢复成 absent——新 HWM 残留会与旧 head 拼成混合链',
      );
      const residue = fs.readdirSync(path.dirname(headPath)).filter((n) => /\.reset-/.test(n));
      assert(residue.length === 0, `回滚后不应留任何 reset 残留：${JSON.stringify(residue)}`);
    }),
  },
  {
    name: 'lineage 事务：无任何旧锚时 reset = 首次建链，不留墓碑（正常首建不该变成未提交事务）',
    run: () => withTrustDir((root, feature) => {
      const q = quarantineLineageAnchorsForReset({ projectRoot: root, feature, runId: 'runN' });
      assert(q.old_head_sha256 === null && q.old_hwm_sha256 === null, '无锚时无旧 hash');
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
      assert(qB.rolled_back_from.length === 2, `应先回滚上一次残留，实际 ${JSON.stringify(qB.rolled_back_from)}`);
      assert(qB.old_head_sha256 !== null, 'runB 应拿到旧 head hash');
      const dir = path.dirname(headPath);
      const baks = fs.readdirSync(dir).filter((n) => /\.reset-.*\.bak$/.test(n));
      assert(baks.length === 2, `场外任一时刻最多一代备份，实际 ${JSON.stringify(baks)}`);
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

/** 走真实路径函数造出旧 head + HWM。 */
function seedAnchors(projectRoot: string, feature: string): { headPath: string; hwmPath: string } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const gr = require('../../scripts/goal-runner') as {
    visionFeatureHeadPath: (r: string, f: string) => string;
    visionHwmPath: (r: string, f: string) => string;
  };
  const headPath = gr.visionFeatureHeadPath(projectRoot, feature);
  const hwmPath = gr.visionHwmPath(projectRoot, feature);
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
    name: 'vision_lineage 非法枚举 fail-closed；resume 携 reset 拒绝',
    run: () => tmpProject((root) => {
      let msg = '';
      try {
        buildGoalManifestFromInput(baseManifestInput({ vision_lineage: 'nuke' }), { projectRoot: root });
      } catch (e) { msg = (e as Error).message; }
      assert(msg.includes('vision_lineage'), `应拒绝非法枚举，实际：${msg}`);

      const reset = { vision_lineage: 'reset' } as Pick<GoalManifest, 'vision_lineage'>;
      assert(visionLineageResumeIssue(reset, 'fresh') === null, 'fresh 合法');
      assert((visionLineageResumeIssue(reset, 'resume') ?? '').includes('仅允许 fresh'), 'resume 须拒绝');
      assert(visionLineageResumeIssue({}, 'resume') === null, '未声明 reset 的 resume 不受影响');
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
    name: 't5⓪ 元门禁：**每一条**注册 incident 经写盘层都必须产出投影（无投影即 supervisor 无判据）',
    run: () => {
      const missing: string[] = [];
      for (const incident of Object.keys(INCIDENT_REGISTRY)) {
        const ev = withRunDisposition({ type: 'phase_halt', halt_reason: incident });
        if (typeof ev.run_disposition !== 'string') missing.push(incident);
        if (ev.run_disposition === 'WAITING' && typeof ev.run_wait_kind !== 'string') {
          missing.push(`${incident}(WAITING 缺 wait_kind)`);
        }
      }
      assert(missing.length === 0, `以下 incident 落盘后无完整投影：\n  ${missing.join('\n  ')}`);
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
