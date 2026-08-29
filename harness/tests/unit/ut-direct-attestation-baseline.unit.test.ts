// ============================================================================
// ut-direct-attestation-baseline.unit.test.ts — plan f3a9d2c7 T3
// ----------------------------------------------------------------------------
// 覆盖 `ut_no_src_mutation` 在 **direct（非 goal）** 模式的分派全路：
//   ① attested clean PASS —— 工作区挂满未提交 coding 产物照样 PASS；非 git 目录也 PASS；
//   ② attested 漂移 FAIL —— failure_kind/affected_files/无授权提法；
//   ③ review 已闭环但 attestation 缺失 → fail-closed，**不回退 git**；
//   ④ 孤儿 attestation（summary 仍 open / 被删）→ 不进 attested 分支，且**不降级到 git**：
//      闭环证据半有半无即 fail-closed（review 返修 P1：否则删 summary 就是 commit-wash 许可证）；
//   ⑤ review 从未闭环（无 summary 且无 attestation）→ 与既有 git 行为等值；
//   ⑥ commit 洗码负例 —— attested 分支下 UT 改码后 `git commit`，仍 FAIL；
//   ⑦ 组合逃逸回归 —— 闭环 → 改源码并 commit → 删 summary → 仍 FAIL；
//   ⑧ 探测不可核实 —— 闭环产物所在路径结构损坏（ENOTDIR 一类）不得被谎报成"不存在"；
//   ⑨ 结构损坏的 attestation（合法 JSON、错误结构）落 review_closure_baseline_unavailable；
//   ⑩ 探针本体：工程外中段为文件 / 悬空 junction —— 两种"可观察的损坏"不得被判 absent。
//
// 夹具纪律：attestation 由**生产 writer**（writeReviewClosureAttestation）现算，与
// closed-feature-fixture.ts 同源；summary.json 按 phase-closure-finalizer 提交的字段
// 形态直写（schema_version 1.2 + closure_status closed + closure_commit 1.0）。
// 绝不手搓 inventory 哈希——手搓的快照测不出对账逻辑本身。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

import { checkUtNoSrcMutation, probeFilePresence } from '../../scripts/check-ut';
import {
  reviewClosureAttestationPath,
  writeReviewClosureAttestation,
} from '../../scripts/utils/closure-attestation';
import { clearFrameworkConfigCache, featurePhaseReportsDir, loadFrameworkConfig } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
import { SUMMARY_SCHEMA_VERSION_CURRENT } from '../../scripts/utils/quality-axes';
import type { CheckContext, CheckResult } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');
const FEATURE = 'demo';
const SRC_REL = '02-Feature/Demo/src/main/ets/domain/flow/DemoFlow.ets';
const CODING_ARTIFACT_REL = '02-Feature/Demo/src/main/ets/domain/flow/DemoRepo.ets';
const UT_REL = '02-Feature/Demo/src/ohosTest/ets/test/DemoFlow.test.ets';

function assert(cond: boolean, label: string): void {
  if (!cond) throw new Error(label);
}

function writeFile(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

function git(root: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr ?? ''}`);
}

/** 建一个最小 direct 工程：可发现的产品源码根 + 一个业务源文件。 */
function makeProject(opts?: { git?: boolean }): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ut-attest-')));
  writeFile(root, 'build-profile.json5', JSON.stringify({
    app: { products: [{ name: 'default' }] },
    modules: [{ name: 'Demo', srcPath: './02-Feature/Demo' }],
  }, null, 2) + '\n');
  writeFile(root, SRC_REL, 'export class DemoFlow { run(): number { return 1; } }\n');
  writeFile(root, `doc/features/${FEATURE}/contracts.yaml`, `feature: ${FEATURE}\nfiles: []\n`);
  clearFrameworkConfigCache();
  if (opts?.git !== false) {
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['config', 'user.email', 'unit@example.com']);
    git(root, ['config', 'user.name', 'Unit Test']);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'baseline']);
  }
  return root;
}

/**
 * 写 review 闭环 summary（字段形态取自 phase-closure-finalizer 的最终提交产物）。
 *
 * 代际参数化（plan a9d4e7c2）：attestation-first 基线判据认的是**闭环域版本集**
 * （1.2 ∪ 1.3），不是某个字面量。默认写当代 1.3，显式传 '1.2' 覆盖旧代兼容用例——
 * 写死字面量会让"当代 review closed 能不能作基线"根本没有测试钉住。
 */
function writeReviewSummary(root: string, closed: boolean, schemaVersion: string = SUMMARY_SCHEMA_VERSION_CURRENT): void {
  const dir = featurePhaseReportsDir(root, FEATURE, 'review', FRAMEWORK_ROOT);
  fs.mkdirSync(dir, { recursive: true });
  const summary: Record<string, unknown> = {
    schema_version: schemaVersion,
    feature: FEATURE,
    phase: 'review',
    verdict: 'PASS',
    blocker_count: 0,
    assurance: 'full',
    receipt_status: closed ? 'passed' : 'missing',
    closure_status: closed ? 'closed' : 'open',
  };
  if (closed) {
    summary.closure_commit = {
      schema_version: '1.0',
      committed_at: '2026-08-28T00:00:00.000Z',
      receipt_path: `doc/features/${FEATURE}/review/phase-completion-receipt.md`,
      evidence_manifest_path: `doc/features/${FEATURE}/review/reports/phase-evidence-manifest.json`,
    };
  }
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
}

/** 生产 writer 现算 attestation（review 闭环点的真实行为）。 */
function writeAttestation(root: string): void {
  writeReviewClosureAttestation({
    projectRoot: root,
    feature: FEATURE,
    expectProductSources: true,
    gateFingerprint: 'unit',
    runIdentity: null,
  });
}

function makeCtx(root: string): CheckContext {
  clearFrameworkConfigCache();
  const cfg = loadFrameworkConfig(root);
  return {
    phase: 'ut',
    feature: FEATURE,
    projectRoot: root,
    frameworkRoot: FRAMEWORK_ROOT,
    phaseRule: {
      structure_checks: {
        ut_no_src_mutation: { description: 'UT 阶段不得擅改业务源码' },
      },
    } as unknown as CheckContext['phaseRule'],
    featureSpec: { feature: FEATURE } as unknown as CheckContext['featureSpec'],
    resolvedProfile: loadResolvedProfile(root, cfg),
  } as unknown as CheckContext;
}

/** direct 模式断言前提：本进程不得携带任何 goal 信号（否则测的是 goal 分支）。 */
function withDirectEnv<T>(fn: () => T): T {
  const keys = [
    'MAISON_GOAL_RUN_ID', 'MAISON_GOAL_ATTEMPT', 'MAISON_GOAL_ATTEMPT_PHASE',
    'MAISON_GOAL_RUNNER', 'MAISON_GOAL_HEADLESS', 'HARNESS_DIFF_BASE_REF',
  ];
  const saved: Record<string, string | undefined> = {};
  for (const k of keys) { saved[k] = process.env[k]; delete process.env[k]; }
  try {
    return fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

function one(root: string): CheckResult {
  const out = withDirectEnv(() => checkUtNoSrcMutation(makeCtx(root)));
  assert(out.length === 1, `期望单条结果，实际 ${out.length}`);
  assert(out[0].id === 'ut_no_src_mutation', `id 必须沿用 ut_no_src_mutation，实际 ${out[0].id}`);
  return out[0];
}

function cleanup(root: string): void {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
}

/** 漂移/fail-closed 结论里不得出现任何授权/人签放行的提法。 */
const AUTHORIZATION_WORDING = /授权|approved_src_mutations|人签|confirmed_by/;

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: '① attested clean PASS：review 闭环 + 未提交 coding 产物 + UT 只写 ohosTest → PASS',
    run: () => {
      const root = makeProject();
      try {
        // coding 阶段产物：改一个业务源文件 + 新增一个业务源文件，**全部不提交**。
        writeFile(root, SRC_REL, 'export class DemoFlow { run(): number { return 2; } }\n');
        writeFile(root, CODING_ARTIFACT_REL, 'export class DemoRepo { load(): void {} }\n');
        // review 在这个工作区形态上闭环 → attestation 固化的正是这份（未提交的）源码。
        writeAttestation(root);
        writeReviewSummary(root, true);
        // UT 阶段只写测试目录（attestation inventory 天然排除 ohosTest）。
        writeFile(root, UT_REL, 'describe("demo", () => {});\n');

        const r = one(root);
        assert(r.status === 'PASS', `期望 PASS，实际 ${r.status}：${r.details}`);
        assert(
          (r.details ?? '').includes('基线=review closure attestation'),
          `details 应标注 attestation 基线：${r.details}`,
        );
        assert(
          !(r.details ?? '').includes('baseRef='),
          `attested 分支不得出现 git baseRef：${r.details}`,
        );
      } finally {
        cleanup(root);
      }
    },
  },
  {
    name: '①b 代际双向：当代 review closed 与上一代 1.2 closed 都是合法 attestation-first 基线',
    run: () => {
      // 验收 17 第三款。判据是**闭环域版本集**（1.2 ∪ 1.3），不是某个字面量——
      // 写死字面量时，升级到当代会让整条 attestation-first 路径静默退回 git 分支。
      for (const schemaVersion of [SUMMARY_SCHEMA_VERSION_CURRENT, '1.2']) {
        const root = makeProject();
        try {
          writeFile(root, SRC_REL, 'export class DemoFlow { run(): number { return 2; } }\n');
          writeFile(root, CODING_ARTIFACT_REL, 'export class DemoRepo { load(): void {} }\n');
          writeAttestation(root);
          writeReviewSummary(root, true, schemaVersion);
          writeFile(root, UT_REL, 'describe("demo", () => {});\n');

          const r = one(root);
          assert(r.status === 'PASS', `schema=${schemaVersion} 期望 PASS，实际 ${r.status}：${r.details}`);
          assert(
            (r.details ?? '').includes('基线=review closure attestation'),
            `schema=${schemaVersion} 应走 attestation 基线而非 git：${r.details}`,
          );
        } finally {
          cleanup(root);
        }
      }
    },
  },
  {
    name: '① 附带收益：非 git 目录下 attested clean 同样 PASS（git 路径本会 FAIL "要求项目是 git 仓库"）',
    run: () => {
      const root = makeProject({ git: false });
      try {
        writeFile(root, CODING_ARTIFACT_REL, 'export class DemoRepo { load(): void {} }\n');
        writeAttestation(root);
        writeReviewSummary(root, true);
        writeFile(root, UT_REL, 'describe("demo", () => {});\n');

        const r = one(root);
        assert(r.status === 'PASS', `非 git 目录期望 PASS，实际 ${r.status}：${r.details}`);
      } finally {
        cleanup(root);
      }
    },
  },
  {
    name: '② attested 漂移 FAIL：failure_kind=post_review_source_drift + affected_files 精确 + 零授权提法',
    run: () => {
      const root = makeProject();
      try {
        writeAttestation(root);
        writeReviewSummary(root, true);
        // review 之后改了一个业务源文件。
        writeFile(root, SRC_REL, 'export class DemoFlow { run(): number { return 99; } }\n');

        const r = one(root);
        assert(r.status === 'FAIL' && r.severity === 'BLOCKER', `期望 BLOCKER FAIL：${r.status}`);
        assert(
          r.failure_kind === 'post_review_source_drift',
          `failure_kind 应为 post_review_source_drift，实际 ${r.failure_kind}`,
        );
        assert(
          r.blocking_class === 'ut_no_src_mutation',
          `blocking_class 应沿用 ut_no_src_mutation，实际 ${r.blocking_class}`,
        );
        assert(
          JSON.stringify(r.affected_files) === JSON.stringify([SRC_REL]),
          `affected_files 应精确列出漂移文件，实际 ${JSON.stringify(r.affected_files)}`,
        );
        // 归因措辞：说「review 后源码漂移」，不说「UT 改了码」。
        assert((r.details ?? '').includes('review 后源码漂移'), `归因措辞不符：${r.details}`);
        assert(
          !AUTHORIZATION_WORDING.test((r.details ?? '') + (r.suggestion ?? '')),
          `不得出现授权/人签放行提法：${r.details}\n${r.suggestion}`,
        );
        // guidance 只有两路：回 coding 重走 review 闭环 / 按 attestation 逐文件 sha 回退。
        const sug = r.suggestion ?? '';
        assert(sug.includes('回 coding'), `缺「回 coding 重走 review 闭环」出路：${sug}`);
        assert(
          sug.includes('本地历史/备份') && sug.includes('sha256 **核对**'),
          `恢复出路必须可执行——attestation 只存哈希不存内容，只能核对不能还原：${sug}`,
        );
        assert(
          !/按 attestation .{0,12}sha .{0,8}回退/.test(sug),
          `不得把「按 sha 回退」写成可执行的恢复动作：${sug}`,
        );
        assert(
          !/HARNESS_DIFF_BASE_REF|git commit|提交 coding/.test(sug),
          `不得给出提交/改 diff 基线的药方：${sug}`,
        );
      } finally {
        cleanup(root);
      }
    },
  },
  {
    name: '③ review 已闭环但 attestation 被删 → fail-closed BLOCKER，不静默回退 git',
    run: () => {
      const root = makeProject();
      try {
        writeAttestation(root);
        writeReviewSummary(root, true);
        fs.rmSync(reviewClosureAttestationPath(root, FEATURE));
        // 工作区对 git 而言是干净的——若回退 git fallback 会得到 PASS，故 FAIL 即证明未回退。
        git(root, ['add', '-A']);
        git(root, ['commit', '-q', '-m', 'review reports']);

        const r = one(root);
        assert(r.status === 'FAIL' && r.severity === 'BLOCKER', `期望 fail-closed，实际 ${r.status}`);
        assert(
          r.failure_kind === 'review_closure_baseline_unavailable',
          `failure_kind 应为 review_closure_baseline_unavailable，实际 ${r.failure_kind}`,
        );
        assert(!(r.details ?? '').includes('baseRef='), `不得回退 git 基线：${r.details}`);
        assert(
          !AUTHORIZATION_WORDING.test((r.details ?? '') + (r.suggestion ?? '')),
          'fail-closed 不得给授权放行通道',
        );
      } finally {
        cleanup(root);
      }
    },
  },
  {
    name: '④ 孤儿 attestation（attestation 在、summary 仍 open）→ 不进 attested 分支，也不降级 git：证据残缺 fail-closed',
    run: () => {
      const root = makeProject();
      try {
        writeAttestation(root);
        writeReviewSummary(root, false); // 闭环中途崩溃：快照已写、closure 未提交
        // 改动全部提交：若降级到默认 working diff 会看不见任何改动而 PASS——FAIL 即证明未降级。
        writeFile(root, SRC_REL, 'export class DemoFlow { run(): number { return 7; } }\n');
        git(root, ['add', '-A']);
        git(root, ['commit', '-q', '-m', 'orphan attestation + committed edit']);

        const r = one(root);
        assert(r.status === 'FAIL', `期望 fail-closed，实际 ${r.status}：${r.details}`);
        assert(
          r.failure_kind === 'review_closure_baseline_unavailable',
          `闭环证据残缺应 fail-closed（failure_kind 实际 ${r.failure_kind}）`,
        );
        // 不进 attested 分支：孤儿快照的**内容**一个字都没读，只用了"它在不在"。
        assert(
          !(r.details ?? '').includes('review 后源码漂移'),
          `孤儿 attestation 不得被采信为基线：${r.details}`,
        );
        assert(!(r.details ?? '').includes('baseRef='), `不得降级到 git 基线：${r.details}`);
        assert((r.details ?? '').includes('闭环证据残缺'), `应说明残缺原因：${r.details}`);
      } finally {
        cleanup(root);
      }
    },
  },
  {
    name: '④ legacy summary + attestation 在盘 → 同样按证据残缺 fail-closed（不得退回 git）',
    run: () => {
      const root = makeProject();
      try {
        writeAttestation(root);
        const dir = featurePhaseReportsDir(root, FEATURE, 'review', FRAMEWORK_ROOT);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          path.join(dir, 'summary.json'),
          JSON.stringify({ schema_version: '1.1', verdict: 'PASS' }, null, 2),
          'utf-8',
        );

        const r = one(root);
        assert(r.status === 'FAIL', `期望 fail-closed，实际 ${r.status}：${r.details}`);
        assert(
          r.failure_kind === 'review_closure_baseline_unavailable',
          `failure_kind=${r.failure_kind}`,
        );
        assert(!(r.details ?? '').includes('baseRef='), `不得降级到 git 基线：${r.details}`);
      } finally {
        cleanup(root);
      }
    },
  },
  {
    name: '⑤ review 从未闭环（无 summary 且无 attestation）→ 与既有 git 行为等值：FAIL 归因/话术/affected_files 不变',
    run: () => {
      const root = makeProject();
      try {
        writeFile(root, SRC_REL, 'export class DemoFlow { run(): number { return 7; } }\n');

        const r = one(root);
        assert(r.status === 'FAIL' && r.severity === 'BLOCKER', `期望 FAIL：${r.status}`);
        assert(r.failure_kind === 'unauthorized_src_mutation', `failure_kind=${r.failure_kind}`);
        assert(r.blocking_class === 'ut_no_src_mutation', `blocking_class=${r.blocking_class}`);
        assert(
          JSON.stringify(r.affected_files) === JSON.stringify([SRC_REL]),
          `affected_files=${JSON.stringify(r.affected_files)}`,
        );
        assert(
          (r.details ?? '').includes('legacy approved_src_mutations/用户回复不参与质量放行'),
          `既有 fallback 话术须逐字保留：${r.details}`,
        );
        assert(
          (r.suggestion ?? '').includes('停止 UT 阶段改码'),
          `既有 fallback suggestion 须逐字保留：${r.suggestion}`,
        );
        assert(
          (r.details ?? '').includes('review 阶段 summary.json 未在盘'),
          `fallback 应说明基线降级原因：${r.details}`,
        );
        assert((r.details ?? '').includes('baseRef='), `应走 git 基线：${r.details}`);
      } finally {
        cleanup(root);
      }
    },
  },
  {
    name: '⑤ review 从未闭环且工作区无业务改动 → 仍走 git 基线 PASS（等值：存量 fixture 形态）',
    run: () => {
      const root = makeProject();
      try {
        writeFile(root, UT_REL, 'describe("demo", () => {});\n');
        const r = one(root);
        assert(r.status === 'PASS', `期望 PASS，实际 ${r.status}：${r.details}`);
        assert((r.details ?? '').includes('baseRef='), `应走 git 基线：${r.details}`);
      } finally {
        cleanup(root);
      }
    },
  },
  {
    name: '⑥ commit 洗码负例：attested 分支下 UT 改码后 git commit，仍 FAIL',
    run: () => {
      const root = makeProject();
      try {
        writeAttestation(root);
        writeReviewSummary(root, true);
        // UT 改产品源码，然后 commit——git working diff 从此看不见它。
        writeFile(root, SRC_REL, 'export class DemoFlow { run(): number { return 0; } }\n');
        git(root, ['add', '-A']);
        git(root, ['commit', '-q', '-m', 'ut sneaks a source edit']);

        const r = one(root);
        assert(r.status === 'FAIL', `commit 不得洗白漂移，实际 ${r.status}：${r.details}`);
        assert(
          r.failure_kind === 'post_review_source_drift',
          `failure_kind=${r.failure_kind}`,
        );
        assert(
          (r.affected_files ?? []).includes(SRC_REL),
          `affected_files 应含被改文件：${JSON.stringify(r.affected_files)}`,
        );
      } finally {
        cleanup(root);
      }
    },
  },
  {
    name: '⑦ 组合逃逸回归：闭环 → 改源码并 commit → 删除 review summary → 仍 FAIL（不得降级到 working diff）',
    run: () => {
      const root = makeProject();
      try {
        writeAttestation(root);
        writeReviewSummary(root, true);
        git(root, ['add', '-A']);
        git(root, ['commit', '-q', '-m', 'review closed']);
        // ① UT 改产品源码并提交——默认 working 基线对已提交改动是瞎的。
        writeFile(root, SRC_REL, 'export class DemoFlow { run(): number { return 42; } }\n');
        git(root, ['add', '-A']);
        git(root, ['commit', '-q', '-m', 'ut edits source']);
        // ② 删掉 review summary，试图把门禁降级回 git 基线。
        fs.rmSync(path.join(
          featurePhaseReportsDir(root, FEATURE, 'review', FRAMEWORK_ROOT), 'summary.json',
        ));

        const r = one(root);
        assert(r.status === 'FAIL', `删 summary 不得洗白已提交漂移，实际 ${r.status}：${r.details}`);
        assert(
          r.failure_kind === 'review_closure_baseline_unavailable',
          `failure_kind=${r.failure_kind}`,
        );
        assert(!(r.details ?? '').includes('baseRef='), `不得降级到 git 基线：${r.details}`);
      } finally {
        cleanup(root);
      }
    },
  },
  {
    name: '⑧ 闭环产物路径结构损坏（reports 是文件而非目录）→ 不可核实 fail-closed，不得被 existsSync 谎报成"从未闭环"',
    run: () => {
      const root = makeProject();
      try {
        // 闭环 → 改源码并提交（working diff 对它是瞎的）。
        writeAttestation(root);
        writeReviewSummary(root, true);
        git(root, ['add', '-A']);
        git(root, ['commit', '-q', '-m', 'review closed']);
        writeFile(root, SRC_REL, 'export class DemoFlow { run(): number { return 13; } }\n');
        git(root, ['add', '-A']);
        git(root, ['commit', '-q', '-m', 'ut edits source']);

        // 把整个 reports 目录换成一个普通文件：summary 与 attestation 的 stat 都会拿到
        // ENOTDIR——而 fs.existsSync() 对 ENOTDIR 是**静默 false**，正是本例要钉死的坑。
        const reportsDir = featurePhaseReportsDir(root, FEATURE, 'review', FRAMEWORK_ROOT);
        fs.rmSync(reportsDir, { recursive: true, force: true });
        fs.writeFileSync(reportsDir, 'not a directory\n', 'utf-8');
        assert(!fs.existsSync(path.join(reportsDir, 'summary.json')), 'existsSync 前提：ENOTDIR 静默 false');

        const r = one(root);
        assert(r.status === 'FAIL', `探测不可核实必须 fail-closed，实际 ${r.status}：${r.details}`);
        assert(
          r.failure_kind === 'review_closure_baseline_unavailable',
          `failure_kind=${r.failure_kind}`,
        );
        assert(!(r.details ?? '').includes('baseRef='), `不得降级到 git 基线：${r.details}`);
      } finally {
        cleanup(root);
      }
    },
  },
  {
    name: '⑨ closed summary + 结构损坏 attestation（合法 JSON）→ review_closure_baseline_unavailable，不是 framework_bug',
    run: () => {
      const root = makeProject();
      try {
        writeAttestation(root);
        writeReviewSummary(root, true);
        // schema_version 对，但 inventory.files 元素缺 sha256——旧 loader 会放行，
        // 一路抛到 reconcile 变成 TypeError（生产上被 safeRun 兜成 framework_bug）。
        fs.writeFileSync(reviewClosureAttestationPath(root, FEATURE), JSON.stringify({
          schema_version: '1.0',
          feature: FEATURE,
          inventory: { roots: ['02-Feature/Demo'], files: [{ path: SRC_REL }], file_count: 1 },
        }, null, 2), 'utf-8');

        const r = one(root);
        assert(r.status === 'FAIL', `期望 fail-closed，实际 ${r.status}：${r.details}`);
        assert(
          r.failure_kind === 'review_closure_baseline_unavailable',
          `结构损坏须落基线不可用而非 framework_bug（实际 ${r.failure_kind}）`,
        );
        assert(!(r.details ?? '').includes('baseRef='), `不得降级到 git 基线：${r.details}`);
      } finally {
        cleanup(root);
      }
    },
  },
  {
    name: '闭环状态不可核实（summary.json 损坏）→ fail-closed，不进 attested 也不回退 git',
    run: () => {
      const root = makeProject();
      try {
        writeAttestation(root);
        const dir = featurePhaseReportsDir(root, FEATURE, 'review', FRAMEWORK_ROOT);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'summary.json'), '{ broken', 'utf-8');
        writeFile(root, SRC_REL, 'export class DemoFlow { run(): number { return 5; } }\n');

        const r = one(root);
        assert(r.status === 'FAIL', `期望 fail-closed，实际 ${r.status}`);
        assert(
          r.failure_kind === 'review_closure_baseline_unavailable',
          `failure_kind=${r.failure_kind}`,
        );
        assert(!(r.details ?? '').includes('baseRef='), `不得回退 git：${r.details}`);
        assert(
          !(r.details ?? '').includes('review 后源码漂移'),
          `不得进 attested 裁决：${r.details}`,
        );
      } finally {
        cleanup(root);
      }
    },
  },
];

// ---------------------------------------------------------------------------
// ⑩ 探针本体（review 三轮 P1）：`ut_no_src_mutation` 的降级判定完全押在"absent 还是
// unverifiable"上，而 `receipt_dir_pattern` / `reports_dir_pattern` 经 path.resolve 可以
// 落到 projectRoot **之外**，路径中段也可能是 symlink/junction——两种形态在 Windows 上都
// 会让单点 statSync 报 ENOENT。故直接对探针做定点断言，不绕经门禁。
// ---------------------------------------------------------------------------
cases.push(
  {
    name: '⑩ 探针：工程外路径的中段是普通文件 → unverifiable（Windows 单点 stat 会报 ENOENT）',
    run: () => {
      const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ut-outside-')));
      try {
        fs.writeFileSync(path.join(outside, 'outside-reports'), 'not a directory\n', 'utf-8');
        const target = path.join(outside, 'outside-reports', 'demo', 'review', 'summary.json');
        // 前提：单点 stat 在本平台确实分辨不出来（Windows 报 ENOENT 而非 ENOTDIR）。
        let singleShotCode = '';
        try { fs.statSync(target); } catch (e) { singleShotCode = (e as NodeJS.ErrnoException).code ?? ''; }
        assert(singleShotCode !== '', '前提：单点 stat 应当抛错');

        const r = probeFilePresence(target);
        assert(
          r.state === 'unverifiable',
          `中段是文件必须判 unverifiable（单点 stat 给的是 ${singleShotCode}），实际 ${r.state}`,
        );
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    },
  },
  {
    name: '⑩ 探针：路径中段是悬空 symlink/junction → unverifiable（lstat 能证明它还在）',
    run: () => {
      const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ut-dangling-')));
      try {
        const link = path.join(outside, 'reports-link');
        try {
          fs.symlinkSync(path.join(outside, 'no-such-target'), link, 'junction');
        } catch {
          return; // 本机不允许建链接（无权限）时跳过，不制造假绿也不误红
        }
        const target = path.join(link, 'summary.json');
        const r = probeFilePresence(target);
        assert(
          r.state === 'unverifiable',
          `悬空 junction 是可观察的损坏痕迹，不得判 absent，实际 ${r.state}`,
        );
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    },
  },
  {
    name: '⑩ 探针：真·不存在 → absent；正常文件 → present（防止把探针改成"永远 unverifiable"的假严格）',
    run: () => {
      const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ut-probe-')));
      try {
        const missing = probeFilePresence(path.join(dir, 'a', 'b', 'summary.json'));
        assert(missing.state === 'absent', `不存在应判 absent，实际 ${missing.state}`);
        const f = path.join(dir, 'summary.json');
        fs.writeFileSync(f, '{}', 'utf-8');
        assert(probeFilePresence(f).state === 'present', '普通文件应判 present');
        assert(
          probeFilePresence(dir).state === 'unverifiable',
          '目标是目录应判 unverifiable',
        );
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
);

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

if (require.main === module) {
  const r = runAll();
  for (const x of r) {
    console.log(x.ok ? `PASS ${x.name}` : `FAIL ${x.name}: ${x.error}`);
  }
  process.exit(r.every(x => x.ok) ? 0 : 1);
}
