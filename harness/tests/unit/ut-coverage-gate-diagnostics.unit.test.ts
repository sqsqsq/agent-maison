import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  checkAcceptanceCoverage,
  checkItNameHasAcOrBranchTag,
  checkUtCoverageEvidenceMappingsComplete,
  checkUtCoverageEvidenceResolves,
  checkUtHypiumMockkitPolicy,
  computeUtFileBaseline,
  type CoverageEvidenceObservation,
  type DagLoadObservation,
} from '../../scripts/check-ut';
import type { CheckContext } from '../../scripts/utils/types';
import type { UnitCaseResult } from './ut-artifact-validate.unit.test';
import { codingBasePath, recordCodingBase } from '../../scripts/utils/pass-snapshot';
import { resolveUtTargets } from '../../scripts/utils/ut-target-resolver';
import {
  evaluateSuiteRatchet,
  targetCaseKey,
  writeSuiteFailureBaselineOnce,
} from '../../scripts/utils/ut-suite-baseline';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function makeCtx(): CheckContext {
  const projectRoot = path.resolve(__dirname, '../../..');
  return {
    projectRoot,
    frameworkRoot: projectRoot,
    feature: 'demo',
    phaseRule: {
      structure_checks: {
        it_name_has_ac_or_branch_tag: { description: 'traceability name tag' },
      },
      traceability_checks: {
        acceptance_coverage: { description: 'DAG acceptance coverage' },
        ut_coverage_evidence_mappings_complete: { description: 'mapping complete' },
        ut_coverage_evidence_resolves: { description: 'evidence resolves' },
      },
    } as unknown as CheckContext['phaseRule'],
    featureSpec: {
      acceptance: {
        criteria: [{
          id: 'AC-01',
          priority: 'P0',
          ut_layer: 'unit',
          description: 'demo criterion',
        }],
        boundaries: [],
      },
    } as unknown as CheckContext['featureSpec'],
    resolvedProfile: {
      name: 'hmos-app',
      profileDir: path.join(projectRoot, 'profiles', 'hmos-app'),
      personalPrerequisites: {},
    },
  } as CheckContext;
}

function testBoundaryTagIsValidNamePrefix(): void {
  const ctx = makeCtx();
  const directBoundary = checkItNameHasAcOrBranchTag(ctx, [{
    path: 'module/src/ohosTest/ets/test/Boundary.test.ets',
    content: "it('[BD-01] empty result', 0, () => { expect(true); });",
  }])[0];
  assert(directBoundary.status === 'PASS', directBoundary.details);

  const untagged = checkItNameHasAcOrBranchTag(ctx, [{
    path: 'module/src/ohosTest/ets/test/Untagged.test.ets',
    content: "it('empty result', 0, () => { expect(true); });",
  }])[0];
  assert(untagged.status === 'FAIL', untagged.details);
  assert(untagged.suggestion?.includes('[BD-xxx]') === true, untagged.suggestion ?? '');
}

// plan 423e5d0f P0：path-c characterization 用例 [CHAR-*] 是合法起始标签——
// 该场景无 acceptance.yaml，不得逼其虚构 [AC-*]（解除 path-c 自死锁）。
function testCharTagIsValidNamePrefix(): void {
  const ctx = makeCtx();
  const charTagged = checkItNameHasAcOrBranchTag(ctx, [{
    path: 'module/src/ohosTest/ets/test/flow_characterization.test.ets',
    content: "it('[CHAR-openCard] replay observed flow', 0, () => { expect(true); });",
  }])[0];
  assert(charTagged.status === 'PASS', charTagged.details);
  // [REG-*] 仅 repair/cover_existing 工作模式合法（allowRegTag=true 时放行）；
  // cover_feature_change（默认）不放行——防需求 UT 借 REG 绕开 AC 绑定。
  const regFile = [{
    path: 'module/src/ohosTest/ets/test/legacy_regression.test.ets',
    content: "it('[REG-walletInit] guard existing behavior', 0, () => { expect(true); });",
  }];
  const regDefault = checkItNameHasAcOrBranchTag(ctx, regFile)[0];
  assert(regDefault.status === 'FAIL', `默认模式 REG 不放行：${regDefault.status}`);
  const regAllowed = checkItNameHasAcOrBranchTag(ctx, regFile, undefined, { allowRegTag: true })[0];
  assert(regAllowed.status === 'PASS', regAllowed.details);
}

// P1-1 显式 target（MAISON_UT_TARGETS）：可指向未在 scoped 的存量文件——repair 模式的机器化通道。
function testResolverExplicitTargetsBeyondScoped(): void {
  withTmpGitRepo(repo => {
    withEnv({
      HARNESS_DIFF_BASE_REF: 'HEAD~1',
      MAISON_GOAL_RUN_ID: undefined,
      MAISON_UT_MODE: 'repair_existing_ut',
      MAISON_UT_TARGETS: 'mod/src/ohosTest/ets/test/Main.test.ets',
    }, () => {
      const legacy = { path: 'mod/src/ohosTest/ets/test/Main.test.ets', content: 'legacy' };
      const all = [legacy, { path: 'mod/src/ohosTest/ets/test/Other.test.ets', content: 'x' }];
      // Main.test.ets 未在 scoped（未触碰/未提及），但被用户明确指定 → 强制进入执行责任域；
      // 身份仍是存量（codex 五轮 #1）：不得进 targetCaseView 被房规问责其存量 it
      const r = resolveUtTargets(baselineCtx(repo), all, []);
      assert(r.mode === 'repair_existing_ut', r.mode);
      assert(r.explicitRequested === 1 && r.explicitMatched === 1,
        `显式命中计数：${r.explicitRequested}/${r.explicitMatched}`);
      assert(r.explicitTargetFiles.length === 1 && r.explicitTargetFiles[0].path === legacy.path,
        `显式指定进执行责任域：${JSON.stringify(r.explicitTargetFiles.map(f => f.path))}`);
      assert(!r.targetCaseView.some(f => f.path === legacy.path),
        '存量身份的显式目标（无新增 it）不得进入房规问责视图');
      assert(r.selectionReasons.some(s => s.includes('显式执行目标')), r.selectionReasons.join(' | '));
      // 拼错路径 → 未命中计数与诊断（runner 层 fail-closed 消费）
      const miss = resolveUtTargets(baselineCtx(repo), all, [], {
        explicitTargets: ['mod/src/ohosTest/ets/test/NoSuch.test.ets'],
      });
      assert(miss.explicitRequested === 1 && miss.explicitMatched === 0, '未命中应计数为 0');
      assert(miss.selectionReasons.some(s => s.includes('未在已发现 UT 文件中命中')), miss.selectionReasons.join(' | '));
      // codex 七轮：cover_existing_code 的有效产出只认"新建文件 / 存量新增 it"——
      // 显式点名存量文件、或只改注释空格 import 等文本，责任域必须仍为空
      //（check-ut 的 ut_target_resolution 据此 FAIL，不得空转 PASS）。
      assert(r.targetFiles.length === 0 && r.legacyIncrements.length === 0,
        `原样点名不构成产出：${JSON.stringify({ t: r.targetFiles.length, i: r.legacyIncrements.length })}`);
      const commentOnly = resolveUtTargets(
        baselineCtx(repo),
        [{ path: legacy.path, content: 'legacy // 只加了注释，没有新增用例' }],
        [{ path: legacy.path, content: 'legacy // 只加了注释，没有新增用例' }],
      );
      assert(commentOnly.targetFiles.length === 0 && commentOnly.legacyIncrements.length === 0,
        `注释级变化不构成测试产出：${JSON.stringify(commentOnly.selectionReasons)}`);
      // 真新增 it → 责任域非空（正向对照）
      const withNewCase = resolveUtTargets(
        baselineCtx(repo),
        [{ path: legacy.path, content: "legacy\nit('[REG-x] new guard', 0, () => {});" }],
        [{ path: legacy.path, content: "legacy\nit('[REG-x] new guard', 0, () => {});" }],
      );
      assert(withNewCase.legacyIncrements.length === 1,
        `新增 it 才算产出：${JSON.stringify(withNewCase.selectionReasons)}`);
    });
  });
}

const LEGACY_MOCKKIT_UT = {
  path: '03-CommonBusiness/LifecycleFramework/src/ohosTest/ets/test/Main.test.ets',
  content: [
    'import { describe, it, expect, MockKit, when } from "@ohos/hypium";',
    'const mockKit = new MockKit();',
    'const fn: Function = mockKit.mockFunc(during, during.toRegister);',
    'when(fn)().afterAction(() => {});',
    "it('[AC-01] mainTest', 0, () => { expect(1).assertEqual(1); });",
  ].join('\n'),
};

// plan 423e5d0f P0：mockkit 政策只问责本 feature 责任域——存量文件 import MockKit
// 不得倒逼本 feature mock-plan 登记（宿主 2.3.0 死局的根治面）。
function testMockkitPolicyExemptsLegacyFiles(): void {
  const ctx = makeCtx();
  const results = checkUtHypiumMockkitPolicy(ctx, null, [], [], [LEGACY_MOCKKIT_UT], '\n身份基线：基线=abc1234');
  assert(results[0].status === 'SKIP', `${results[0].status}: ${results[0].details}`);
  assert(results[0].details.includes('责任域外豁免'), results[0].details);
  assert(results[0].details.includes('Main.test.ets'), results[0].details);
}

// P1-1 已修复原"文件级豁免"已知限制：纯 legacy（无新增用法）仍豁免；
// 但 legacy 文件内**新增的 mock 用法**通过 legacyIncrements 通道进入增量问责。
function testLegacyFileWithoutNewUsageStillExempt(): void {
  const ctx = makeCtx();
  const results = checkUtHypiumMockkitPolicy(ctx, null, [], [], [LEGACY_MOCKKIT_UT], '');
  assert(results[0].status === 'SKIP', `纯 legacy 无新增应豁免：${results[0].status}`);
}

function testLegacyIncrementNewMockUsageIsGoverned(): void {
  const ctx = makeCtx();
  const newContent = [
    LEGACY_MOCKKIT_UT.content,
    'const fn2: Function = mockKit.mockFunc(gw, NewGateway.call);',
    'when(fn2)().afterReturn(1);',
    "it('[AC-01] new case', 0, () => { expect(1).assertEqual(1); });",
  ].join('\n');
  const increment = {
    path: LEGACY_MOCKKIT_UT.path,
    content: newContent,
    baselineContent: LEGACY_MOCKKIT_UT.content,
    newCases: new Set(['[AC-01] new case']),
  };
  // 无 mock-plan mockkit 条目 + 存量文件内新增 mock 用法 → FAIL（增量问责，不再整体豁免）
  const results = checkUtHypiumMockkitPolicy(ctx, null, [], [], [], '', [increment]);
  assert(results[0].status === 'FAIL', `新增 mock 用法应被问责：${results[0].status}: ${results[0].details}`);
  assert(results[0].details.includes('存量文件内新增 mock 用法'), results[0].details);
  // 基线已有用法不升级问责：增量为空时仍 SKIP
  const noNew = { ...increment, content: LEGACY_MOCKKIT_UT.content, newCases: new Set<string>() };
  const results2 = checkUtHypiumMockkitPolicy(ctx, null, [], [], [], '', [noNew]);
  assert(results2[0].status === 'SKIP', `无新增用法应豁免：${results2[0].status}`);
}

// P1-1 标签门禁用例级：legacy 文件只问责新增 it，基线已有的无标签 it 不再中招。
function testTagGateOnlyChecksLegacyNewCases(): void {
  const ctx = makeCtx();
  const file = {
    path: 'mod/src/ohosTest/ets/test/Main.test.ets',
    content: [
      "it('mainTest', 0, () => { expect(1).assertEqual(1); });", // 基线已有，无标签
      "it('[AC-01] added by feature', 0, () => { expect(1).assertEqual(1); });",
      "it('added but untagged', 0, () => { expect(1).assertEqual(1); });",
    ].join('\n'),
  };
  const newCases = new Map([[file.path, new Set(['[AC-01] added by feature', 'added but untagged'])]]);
  const results = checkItNameHasAcOrBranchTag(ctx, [file], newCases);
  assert(results[0].status === 'FAIL', results[0].details);
  assert(results[0].details.includes('added but untagged'), '新增无标签 it 应被问责');
  assert(!results[0].details.includes('"mainTest"'), `基线已有 it 不得中招：${results[0].details}`);
}

// ---------------------------------------------------------------------------
// computeUtFileBaseline 集成测试（真实 git 仓走完整基线计算路径——codex P0 回归）
// ---------------------------------------------------------------------------

function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const saved = new Map<string, string | undefined>();
  for (const k of Object.keys(overrides)) saved.set(k, process.env[k]);
  try {
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function withTmpGitRepo(fn: (repo: string) => void): void {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ut-baseline-'));
  try {
    const git = (...args: string[]) =>
      spawnSync('git', args, { cwd: repo, encoding: 'utf-8', shell: false });
    git('init');
    git('config', 'user.email', 'test@test');
    git('config', 'user.name', 'test');
    fs.mkdirSync(path.join(repo, 'mod/src/ohosTest/ets/test'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'mod/src/ohosTest/ets/test/Main.test.ets'), 'legacy', 'utf-8');
    git('add', '-A');
    git('commit', '-m', 'legacy baseline');
    // 模拟"本轮新增 UT 已提交"——HEAD 因此已包含新文件（codex P0 场景）
    fs.writeFileSync(path.join(repo, 'mod/src/ohosTest/ets/test/NotLogin.test.ets'), 'new ut', 'utf-8');
    git('add', '-A');
    git('commit', '-m', 'agent adds new ut');
    fn(repo);
  } finally {
    try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function baselineCtx(repo: string): Parameters<typeof computeUtFileBaseline>[0] {
  return { projectRoot: repo, feature: 'demo' } as Parameters<typeof computeUtFileBaseline>[0];
}

// 显式 env 锚（用户提供 feature 前 commit）→ 可用，legacy 在集合、新 UT 不在。
function testBaselineExplicitEnvAnchor(): void {
  withTmpGitRepo(repo => {
    withEnv({ HARNESS_DIFF_BASE_REF: 'HEAD~1', MAISON_GOAL_RUN_ID: undefined }, () => {
      const b = computeUtFileBaseline(baselineCtx(repo));
      assert(b.available, b.note);
      assert(b.existing.has('mod/src/ohosTest/ets/test/Main.test.ets'), 'legacy 应在基线');
      assert(!b.existing.has('mod/src/ohosTest/ets/test/NotLogin.test.ets'), '新 UT 不得在基线');
    });
  });
}

// codex P0 放水回归锁：无显式锚时**不得**回退到 trace.start_commit / HEAD——
// "新增 UT → commit → 首跑 harness" 时那是含新 UT 的 HEAD，会把新文件洗成存量。
function testBaselineFailClosedWithoutTrustedAnchor(): void {
  withTmpGitRepo(repo => {
    withEnv({ HARNESS_DIFF_BASE_REF: undefined, MAISON_GOAL_RUN_ID: undefined }, () => {
      const b = computeUtFileBaseline(baselineCtx(repo));
      assert(!b.available, `无可信锚必须 fail-closed：${b.note}`);
      assert(b.note.includes('不消费 trace.start_commit'), b.note);
    });
  });
}

// P1-1 resolver：legacy 文件内新增 it → 用例级升格（legacyIncrements 检出）；
// 新建文件 → target 全责。走真实 git 仓完整路径。
function testResolverDetectsLegacyNewCases(): void {
  withTmpGitRepo(repo => {
    // 基线版 Main.test.ets 是 'legacy' 纯文本（无 it）；工作区版本加一个 it
    const legacyPath = 'mod/src/ohosTest/ets/test/Main.test.ets';
    const legacyNewContent = "legacy\nit('[AC-01] feature added in legacy file', 0, () => {});";
    fs.writeFileSync(path.join(repo, legacyPath), legacyNewContent, 'utf-8');
    withEnv({ HARNESS_DIFF_BASE_REF: 'HEAD~1', MAISON_GOAL_RUN_ID: undefined }, () => {
      const all = [
        { path: legacyPath, content: legacyNewContent },
        { path: 'mod/src/ohosTest/ets/test/NotLogin.test.ets', content: "it('[AC-02] x', 0, () => {});" },
      ];
      const r = resolveUtTargets(baselineCtx(repo), all, all);
      assert(r.targetFiles.length === 1 && r.targetFiles[0].path.endsWith('NotLogin.test.ets'),
        `新建文件应为 target：${JSON.stringify(r.targetFiles.map(f => f.path))}`);
      assert(r.legacyIncrements.length === 1, `应检出 legacy 增量：${r.selectionReasons.join(' | ')}`);
      assert(r.legacyIncrements[0].newCases.has('[AC-01] feature added in legacy file'),
        JSON.stringify([...r.legacyIncrements[0].newCases]));
      assert(r.legacyIncrements[0].baselineContent === 'legacy', '应携带基线内容供增量治理');
      // targetCaseView：新文件原样 + legacy 合成条目（只含新增 it，供全部需求房规统一消费）
      const viewLegacy = r.targetCaseView.find(f => f.path === legacyPath);
      assert(!!viewLegacy && viewLegacy.content.includes('[AC-01] feature added in legacy file'),
        `合成视图应含新增 it：${viewLegacy?.content}`);
      assert(!viewLegacy!.content.includes('legacy\n'), '合成视图不得含基线存量内容');
      assert(r.targetCaseView.some(f => f.path.endsWith('NotLogin.test.ets')), '新文件原样入视图');
    });
  });
}

// P1-2 ratchet（codex 修正语义）：无基线**不豁免**（本轮执行不得反推历史）；
// 授权基线（pre-agent 写入）内豁免、基线外判回归、target 永不豁免、基线只收紧。
function testSuiteRatchetLifecycle(): void {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ut-ratchet-'));
  const frameworkRoot = path.resolve(__dirname, '../../..');
  try {
    // target 身份含模块：ModA 的目标用例不得把 ModB 的同名用例也标成 target
    const targetSet = new Set([targetCaseKey('ModA', '[AC-01] target case')]);
    // ① 无基线：全部失败照常问责（包括非 target），suiteHealth=UNKNOWN——首轮执行不得洗基线
    const noBaseline = evaluateSuiteRatchet({
      projectRoot: repo,
      feature: 'demo',
      frameworkRoot,
      failures: [
        { module: 'ModA', suite: 'LegacySuite', test: 'old broken case' },
        { module: 'ModA', suite: 'NewSuite', test: '[AC-01] target case' },
      ],
      targetKeys: targetSet,
      modulesWithValidResults: new Set(['ModA', 'ModB']),
    });
    assert(noBaseline.suiteHealth === 'UNKNOWN', noBaseline.suiteHealth);
    assert(!noBaseline.baselineAvailable, '本轮执行不得生成基线');
    assert(noBaseline.newNonTargetFailures.length === 1, `无基线不豁免：${JSON.stringify(noBaseline)}`);
    assert(noBaseline.targetFailures.length === 1, 'target 失败照常');
    // ② 授权基线（模拟编排 pre-agent 写入，含两条历史失败）
    assert(
      writeSuiteFailureBaselineOnce(repo, 'demo', [
        { module: 'ModA', suite: 'LegacySuite', test: 'old broken case' },
        { module: 'ModA', suite: 'LegacySuite', test: 'flaky fixed case' },
      ], frameworkRoot),
      '授权基线写入',
    );
    const withBaseline = evaluateSuiteRatchet({
      projectRoot: repo,
      feature: 'demo',
      frameworkRoot,
      failures: [
        { module: 'ModA', suite: 'LegacySuite', test: 'old broken case' },
        { module: 'ModA', suite: 'LegacySuite', test: 'newly broken case' },
        // 跨模块同名（codex 五轮 #3）：ModB 的同名 suite/test 不得被 ModA 的基线豁免
        { module: 'ModB', suite: 'LegacySuite', test: 'old broken case' },
        { module: 'ModA', suite: 'NewSuite', test: '[AC-01] target case' },
      ],
      targetKeys: targetSet,
      modulesWithValidResults: new Set(['ModA', 'ModB']),
    });
    assert(withBaseline.baselineExempt.length === 1 && withBaseline.baselineExempt[0].module === 'ModA',
      `仅同模块基线失败豁免：${JSON.stringify(withBaseline.baselineExempt)}`);
    assert(withBaseline.newNonTargetFailures.length === 2
      && withBaseline.newNonTargetFailures.some(f => f.module === 'ModB' && f.test === 'old broken case'),
      `跨模块同名失败必须判回归：${JSON.stringify(withBaseline.newNonTargetFailures)}`);
    assert(withBaseline.targetFailures.length === 1, 'target 失败永不豁免');
    assert(withBaseline.suiteHealth === 'DEGRADED', withBaseline.suiteHealth);
    // 基线涉及模块（ModA）本轮有有效结果 → 允许收紧：'flaky fixed case' 不再失败被剔除
    assert(withBaseline.baselineTightenedTo === 1, `基线应收紧至 1 条：${withBaseline.baselineTightenedTo}`);
    // ③ 跨模块 target 身份：ModB 的同名 '[AC-01] target case' 不得被当作 target
    const crossModuleTarget = evaluateSuiteRatchet({
      projectRoot: repo,
      feature: 'demo',
      frameworkRoot,
      failures: [{ module: 'ModB', suite: 'NewSuite', test: '[AC-01] target case' }],
      targetKeys: targetSet,
      modulesWithValidResults: new Set(['ModB']), // ModA 未跑出有效结果 → 不得收紧
    });
    assert(crossModuleTarget.targetFailures.length === 0,
      `ModB 同名用例不得被判为 ModA 的 target：${JSON.stringify(crossModuleTarget.targetFailures)}`);
    // 基线里 ModA 的条目本轮没有有效结果（modulesWithValidResults 只含 ModB）→ 不得收紧
    assert(crossModuleTarget.baselineTightenedTo === undefined,
      '基线涉及模块未跑出有效结果时不得收紧（codex 六轮 #1）');
  } finally {
    try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// 成功路径：goal run 下 runner 锚定的 coding_base_sha 被自动识别，正确分离新旧 UT。
// 夹具用真实 writer（recordCodingBase）造，不手搓信任文件。
function testBaselineUsesRecordedCodingBase(): void {
  withTmpGitRepo(repo => {
    const runId = `run-ut-baseline-${Date.now()}`;
    const headBefore = spawnSync('git', ['rev-parse', 'HEAD~1'], {
      cwd: repo, encoding: 'utf-8', shell: false,
    }).stdout.trim();
    const rec = recordCodingBase({ projectRoot: repo, feature: 'demo', runId, baseSha: headBefore });
    assert(rec.kind === 'recorded', `recordCodingBase 应成功：${rec.kind}`);
    try {
      withEnv({ HARNESS_DIFF_BASE_REF: undefined, MAISON_GOAL_RUN_ID: runId }, () => {
        const b = computeUtFileBaseline(baselineCtx(repo));
        assert(b.available, b.note);
        assert(b.note.includes('coding_base_sha'), `锚来源应为 coding_base_sha：${b.note}`);
        assert(b.existing.has('mod/src/ohosTest/ets/test/Main.test.ets'), 'legacy 应在基线');
        assert(!b.existing.has('mod/src/ohosTest/ets/test/NotLogin.test.ets'), '新 UT 不得在基线');
      });
    } finally {
      try {
        fs.rmSync(path.dirname(codingBasePath(repo, 'demo', runId)), { recursive: true, force: true });
      } catch { /* ignore */ }
    }
  });
}

// goal runId 在场但 coding_base 记录缺失 → 同样 fail-closed，不回退。
function testBaselineFailClosedWhenCodingBaseAbsent(): void {
  withTmpGitRepo(repo => {
    withEnv({ HARNESS_DIFF_BASE_REF: undefined, MAISON_GOAL_RUN_ID: 'run-nonexistent' }, () => {
      const b = computeUtFileBaseline(baselineCtx(repo));
      assert(!b.available, `coding_base 缺失必须 fail-closed：${b.note}`);
    });
  });
}

// 豁免不放水：feature 责任域内文件 import MockKit 而无 mock-plan mockkit 条目仍 FAIL。
function testMockkitPolicyStillFailsForFeatureFiles(): void {
  const ctx = makeCtx();
  const featureUt = {
    path: '02-Feature/Demo/src/ohosTest/ets/test/demo_new.test.ets',
    content: LEGACY_MOCKKIT_UT.content,
  };
  const results = checkUtHypiumMockkitPolicy(ctx, null, [featureUt], [], [LEGACY_MOCKKIT_UT], '');
  assert(results[0].status === 'FAIL', `${results[0].status}: ${results[0].details}`);
  assert(results[0].details.includes('demo_new.test.ets'), results[0].details);
}

const missingEvidence: CoverageEvidenceObservation = {
  status: 'missing',
  relPath: 'doc/features/demo/ut/reports/coverage-evidence.json',
  absPath: 'C:/consumer/doc/features/demo/ut/reports/coverage-evidence.json',
};

function testAcceptanceCoverageIsDagOnlyWhileTagGatePasses(): void {
  const ctx = makeCtx();
  const dags = [{ path: 'module/test/dag/demo.dag.yaml', dag: { nodes: [] } }];
  const observation: DagLoadObservation = {
    files: [{ ...dags[0], raw: 'nodes: []', source: 'archived' }],
    candidatePaths: [dags[0].path],
    probedDirs: ['module/test/dag'],
    issues: [],
  };
  const acceptance = checkAcceptanceCoverage(ctx, dags, observation)[0];
  assert(acceptance.status === 'FAIL', acceptance.status);
  assert(acceptance.details.includes('不读取 it() 名'), acceptance.details);
  assert(acceptance.details.includes(dags[0].path), acceptance.details);
  assert(acceptance.suggestion?.includes('git add 不会改变本 gate') === true, acceptance.suggestion ?? '');

  const tagged = [{
    path: 'module/src/ohosTest/ets/test/Demo.test.ets',
    content: "it('[AC-01] tagged', 0, () => { expect(true); });",
  }];
  const resolves = checkUtCoverageEvidenceResolves(ctx, tagged, missingEvidence, observation.files)[0];
  assert(resolves.status === 'PASS', resolves.details);
  assert(resolves.details.includes(tagged[0].path), resolves.details);
}

function testDagCanResolveWithoutUtFiles(): void {
  const ctx = makeCtx();
  const dags = [{
    path: 'module/test/dag/demo.dag.yaml',
    raw: 'linked_acceptance: [AC-01]',
    source: 'archived' as const,
    dag: { linked_acceptance: ['AC-01'] },
  }];
  const result = checkUtCoverageEvidenceResolves(ctx, [], missingEvidence, dags)[0];
  assert(result.status === 'PASS', result.details);
  assert(result.details.includes('scoped_ut_files=(无)'), result.details);
  assert(result.details.includes('dag/demo.dag.yaml'), result.details);
}

function testMappingFailureNamesDeclaredSourceAndInputs(): void {
  const ctx = makeCtx();
  const observed: CoverageEvidenceObservation = {
    status: 'loaded',
    relPath: 'doc/features/demo/ut/reports/coverage-evidence.json',
    absPath: 'C:/consumer/doc/features/demo/ut/reports/coverage-evidence.json',
    warnings: [],
    evidence: {
      schema_version: '1.0',
      feature: 'demo',
      mappings: [{
        scope_id: 'AC-01',
        scope_kind: 'acceptance_criterion',
        evidence_source: 'ut_tags',
        evidence_ref: 'Demo.test.ets',
      }],
    },
  };
  const result = checkUtCoverageEvidenceMappingsComplete(ctx, [], observed, [], null)[0];
  assert(result.status === 'FAIL', result.details);
  assert(result.details.includes('declared evidence_source=ut_tags'), result.details);
  assert(result.details.includes('mapping=ut_tags:unresolved ref=Demo.test.ets'), result.details);
  assert(result.details.includes('coverage_evidence=loaded:'), result.details);
}

function testAcTagDoesNotResolveSameNumberedBoundary(): void {
  const ctx = makeCtx();
  ctx.featureSpec.acceptance!.boundaries = [{
    id: 'BD-01',
    priority: 'P0',
    ut_layer: 'unit',
    description: 'same suffix boundary',
  }] as never;
  const tagged = [{
    path: 'module/src/ohosTest/ets/test/Demo.test.ets',
    content: "it('[AC-01] criterion only', 0, () => { expect(true); });",
  }];
  const result = checkUtCoverageEvidenceResolves(ctx, tagged, missingEvidence, [])[0];
  assert(result.status === 'FAIL', result.details);
  assert(result.details.includes('BD-01'), result.details);
  assert(result.details.includes('BD-01: ut_tag_or_branch=false'), result.details);
}

function testEphemeralMappingDoesNotUseArchivedDag(): void {
  const ctx = makeCtx();
  const observed: CoverageEvidenceObservation = {
    status: 'loaded',
    relPath: 'doc/features/demo/ut/reports/coverage-evidence.json',
    absPath: 'C:/consumer/doc/features/demo/ut/reports/coverage-evidence.json',
    warnings: [],
    evidence: {
      schema_version: '1.0',
      feature: 'demo',
      mappings: [{
        scope_id: 'AC-01',
        scope_kind: 'acceptance_criterion',
        evidence_source: 'dag_ephemeral',
      }],
    },
  };
  const archived = [{
    path: 'module/test/dag/demo.dag.yaml',
    raw: 'linked_acceptance: [AC-01]',
    source: 'archived' as const,
    dag: { linked_acceptance: ['AC-01'] },
  }];
  const result = checkUtCoverageEvidenceMappingsComplete(ctx, [], observed, archived, null)[0];
  assert(result.status === 'FAIL', result.details);
  assert(result.details.includes('declared evidence_source=dag_ephemeral'), result.details);
  assert(result.details.includes('mapping=dag_ephemeral:unresolved'), result.details);
}

export function runAll(): UnitCaseResult[] {
  const cases = [
    { name: 'acceptance coverage is DAG-only while tag-aware gate passes', fn: testAcceptanceCoverageIsDagOnlyWhileTagGatePasses },
    { name: 'DAG evidence resolves without UT files', fn: testDagCanResolveWithoutUtFiles },
    { name: 'mapping failure names declared source and inspected inputs', fn: testMappingFailureNamesDeclaredSourceAndInputs },
    { name: 'AC tag does not resolve same-numbered boundary', fn: testAcTagDoesNotResolveSameNumberedBoundary },
    { name: 'ephemeral mapping does not use archived DAG', fn: testEphemeralMappingDoesNotUseArchivedDag },
    { name: 'direct boundary tag is a valid test-name prefix', fn: testBoundaryTagIsValidNamePrefix },
    { name: 'characterization CHAR tag is a valid test-name prefix (423e5d0f)', fn: testCharTagIsValidNamePrefix },
    { name: 'mockkit policy exempts out-of-scope legacy files (423e5d0f)', fn: testMockkitPolicyExemptsLegacyFiles },
    { name: 'legacy file without new mock usage still exempt (P1-1)', fn: testLegacyFileWithoutNewUsageStillExempt },
    { name: 'legacy increment: new mock usage is governed (P1-1 fixes known limitation)', fn: testLegacyIncrementNewMockUsageIsGoverned },
    { name: 'tag gate only checks legacy new cases (P1-1 case-level)', fn: testTagGateOnlyChecksLegacyNewCases },
    { name: 'resolver detects legacy new cases via real git baseline (P1-1)', fn: testResolverDetectsLegacyNewCases },
    { name: 'resolver explicit targets beyond scoped (repair mode wiring)', fn: testResolverExplicitTargetsBeyondScoped },
    { name: 'suite ratchet: no-baseline no-exempt / authorized baseline / tighten (P1-2)', fn: testSuiteRatchetLifecycle },
    { name: 'baseline: explicit env anchor separates legacy from new UT (423e5d0f P0)', fn: testBaselineExplicitEnvAnchor },
    { name: 'baseline: fail-closed without trusted pre-agent anchor (no trace/HEAD fallback)', fn: testBaselineFailClosedWithoutTrustedAnchor },
    { name: 'baseline: recorded coding_base_sha is auto-detected (goal run success path)', fn: testBaselineUsesRecordedCodingBase },
    { name: 'baseline: fail-closed when goal coding_base record is absent', fn: testBaselineFailClosedWhenCodingBaseAbsent },
    { name: 'mockkit policy still fails for feature-owned files', fn: testMockkitPolicyStillFailsForFeatureFiles },
  ];
  return cases.map(({ name, fn }) => {
    try {
      fn();
      return { name, ok: true };
    } catch (e) {
      return { name, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
