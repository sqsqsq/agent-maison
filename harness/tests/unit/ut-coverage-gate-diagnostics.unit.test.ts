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

// 【已知限制锁定 · P1-1 修复目标】责任域是文件粒度：本需求若在**存量文件里新增 it()**，
// 该文件仍整体豁免（新 it 的 MockKit/标签都不被问责）→ 假绿窗口。统一 target 解析器
// （用例级）落地前，本用例锁定该行为——它开始 FAIL 时说明粒度已改，须同步 plan 423e5d0f。
function testKnownLimitationLegacyFileNewCaseIsExempt(): void {
  const ctx = makeCtx();
  const legacyWithNewCase = {
    path: LEGACY_MOCKKIT_UT.path,
    content: `${LEGACY_MOCKKIT_UT.content}\nit('本需求新增却无标签', 0, () => { expect(1).assertEqual(1); });`,
  };
  const results = checkUtHypiumMockkitPolicy(ctx, null, [], [], [legacyWithNewCase], '');
  assert(results[0].status === 'SKIP', `当前文件级粒度下应整体豁免（已知限制）：${results[0].status}`);
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
    { name: 'KNOWN LIMITATION: new case inside legacy file is exempt (P1-1 target)', fn: testKnownLimitationLegacyFileNewCaseIsExempt },
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
