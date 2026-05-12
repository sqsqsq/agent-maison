// ============================================================================
// Fixture Runner — 在隔离 tmpdir 里跑 framework harness，断言 result[]
// ============================================================================
//
// 设计：
//   - 典型根目录：`framework/harness/tests/fixtures/<group>/<name>/`；
//     亦可位于 `framework/profiles/hmos-app/harness/tests/fixtures/`（同源结构，便于 profile 拆分）。
//     * INPUT/          — 拷贝到 tmpdir 作为 projectRoot，**然后 git add + commit**
//                         作为 baseline；记入 trace.json 的 start_commit
//     * AFTER_BASELINE/（可选） — baseline commit **之后**再 overlay 到 tmpdir
//                         （**不 commit**），模拟"开发期 AI 擅自改了业务源码
//                         但未 commit" 的情形；供 ut_no_src_mutation 等规则使用
//     * REPORTS/（可选）— 临时放到隔离的 reports 根下（通过环境变量
//                         HARNESS_REPORTS_ROOT_OVERRIDE 接入），支持 fixture 提供
//                         gap-notes.md 做"已授权"断言；目录结构应与真实
//                         framework/harness/reports/<feature>/ 一致，例如：
//                           REPORTS/demo/fixture-run/gap-notes.md
//     * CMD.json        — { phase, feature, env? }
//     * EXPECTED.json   — { rules: [{ id, status, severity, details_includes? }] }
//   - 跑 harness 时复用真实的 frameworkRoot（即当前仓库的 framework/）；
//     fixture 不需要拷 framework 资产，只装 feature/源码骨架；
//   - 跳过 Step 4/5（AI prompt + merged report），只验 Step 3 result[]；
//   - 自动 git init fixture tmpdir，使得 ut_no_src_mutation 等依赖 git 的规则能跑。
//
// 用法（被 run-tests.ts 调用）：
//   const result = await runFixture('<abs>/.../profiles/hmos-app/harness/tests/fixtures/v2_2/ut_tsc_compiles_fail');
//     或由 run-tests.ts 合并扫描的任一 **.../tests/fixtures/** 根（逻辑展示名锚定在同一后缀；禁止同名双份）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import {
  Phase,
  CheckContext,
  CheckResult,
  PhaseChecker,
  GLOBAL_FEATURE_SENTINEL,
} from '../../scripts/utils/types';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { resolvePaths, clearFrameworkConfigCache, loadFrameworkConfig } from '../../config';
import { loadResolvedProfile, loadPhaseRuleWithOverlays, isPhaseDisabledByProfile } from '../../profile-loader';
import { resolveWorkflowSpec, isPhaseGlobalInWorkflow } from '../../workflow-loader';

// 真实的 framework/harness 与 framework/ 根（脚本本身就在 framework/harness/tests/utils 里）
const FIXTURE_HARNESS_ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE_FRAMEWORK_ROOT = path.resolve(FIXTURE_HARNESS_ROOT, '..');

/** CMD.json 的形态 */
export interface FixtureCmd {
  phase: Phase;
  feature?: string;
  /** init 阶段：透传到 CheckContext.adapter（其他阶段忽略） */
  adapter?: string;
  /** 额外环境变量（如 HARNESS_SKIP_HVIGOR=1） */
  env?: Record<string, string>;
}

/** EXPECTED.json 中单条规则期望 */
export interface ExpectedRule {
  id: string;
  status?: 'PASS' | 'FAIL' | 'WARN' | 'SKIP';
  severity?: 'BLOCKER' | 'MAJOR' | 'MINOR' | 'INFO';
  /** details 必须包含的子串（用于精准断言） */
  details_includes?: string;
  /** 该规则**不应**出现在 result[] 中（用于"故意没触发"的反向断言） */
  must_be_absent?: boolean;
}

/**
 * fixture 可多根目录（见 run-tests.ts）；对外展示名与 filter 匹配的 key 均以路径中最后一次
 * `/tests/fixtures/` 之后的相对段为准（例：`v2_2/ut_tsc_compiles_pass`）。
 */
export function fixtureDisplayName(fixtureDir: string): string {
  const n = path.resolve(fixtureDir).replace(/\\/g, '/');
  const needle = '/tests/fixtures/';
  const idx = n.lastIndexOf(needle);
  if (idx >= 0) return n.slice(idx + needle.length);
  return path
    .relative(path.resolve(__dirname, '..', 'fixtures'), fixtureDir)
    .replace(/\\/g, '/');
}

/** EXPECTED.json 顶层 */
export interface FixtureExpected {
  /** 期望的整体 verdict（可选） */
  verdict?: 'PASS' | 'FAIL';
  /** 关心的规则断言列表（不在此处的规则不强制） */
  rules: ExpectedRule[];
}

/** 单个 fixture 的运行结果 */
export interface FixtureRunResult {
  name: string;
  ok: boolean;
  /** 失败的断言列表（ok=false 时） */
  failures: string[];
  /** 实际跑出的 result[]（用于诊断） */
  actualResults?: CheckResult[];
  /** tmpdir 路径（保留供调试，运行结束后会自动清理） */
  tmpdir?: string;
  /** 整个 fixture 跑崩了的异常 */
  error?: Error;
}

/**
 * 跑单个 fixture：
 *   1. 拷 INPUT 到 tmpdir
 *   2. git init + add + commit（让 ut_no_src_mutation 等规则有 baseRef）
 *   3. 在隔离 cwd 下加载 SpecLoader、构造 CheckContext、调 checker.check
 *   4. 比对 EXPECTED.json
 */
export async function runFixture(fixtureDir: string): Promise<FixtureRunResult> {
  const name = fixtureDisplayName(fixtureDir);
  const failures: string[] = [];

  // 1. 读 CMD/EXPECTED
  const cmdPath = path.join(fixtureDir, 'CMD.json');
  const expectedPath = path.join(fixtureDir, 'EXPECTED.json');
  const inputDir = path.join(fixtureDir, 'INPUT');

  if (!fs.existsSync(cmdPath) || !fs.existsSync(expectedPath) || !fs.existsSync(inputDir)) {
    return {
      name,
      ok: false,
      failures: [
        `fixture 结构不完整，需要 INPUT/、CMD.json、EXPECTED.json 同时存在；缺：` +
          [
            !fs.existsSync(inputDir) && 'INPUT/',
            !fs.existsSync(cmdPath) && 'CMD.json',
            !fs.existsSync(expectedPath) && 'EXPECTED.json',
          ].filter(Boolean).join(', '),
      ],
    };
  }

  let cmd: FixtureCmd;
  let expected: FixtureExpected;
  try {
    cmd = JSON.parse(fs.readFileSync(cmdPath, 'utf-8'));
    expected = JSON.parse(fs.readFileSync(expectedPath, 'utf-8'));
  } catch (e) {
    return { name, ok: false, failures: [`CMD/EXPECTED JSON 解析失败：${(e as Error).message}`] };
  }

  // 2. 拷贝到 tmpdir
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-fixture-'));
  try {
    copyDir(inputDir, tmpdir);

    // 3. git init + commit baseline，让 git diff 有起点
    runGit(tmpdir, ['init', '-q', '-b', 'main']);
    runGit(tmpdir, ['config', 'user.email', 'fixture@example.com']);
    runGit(tmpdir, ['config', 'user.name', 'Fixture Runner']);
    runGit(tmpdir, ['add', '-A']);
    runGit(tmpdir, ['commit', '-q', '-m', 'fixture baseline']);

    // 3b. 若 fixture 含 AFTER_BASELINE/，baseline commit **之后**再 overlay 它，
    //     **不 commit** —— 模拟"开发期改了业务源码但未提交"的工作区状态，
    //     使 ut_no_src_mutation 这类 git-diff 规则能看到未登记的 workspace 改动。
    const afterBaselineDir = path.join(fixtureDir, 'AFTER_BASELINE');
    if (fs.existsSync(afterBaselineDir)) {
      copyDir(afterBaselineDir, tmpdir);
    }

    // 3c. 若 fixture 含 REPORTS/，把它拷到 tmpdir/__fixture_reports/，并通过
    //     环境变量 HARNESS_REPORTS_ROOT_OVERRIDE 告知 check-ut.ts 去这里找
    //     gap-notes.md / trace.json。不污染真实仓库 framework/harness/reports/。
    const reportsFixtureDir = path.join(fixtureDir, 'REPORTS');
    const reportsTmpRoot = path.join(tmpdir, '__fixture_reports');
    if (fs.existsSync(reportsFixtureDir)) {
      copyDir(reportsFixtureDir, reportsTmpRoot);
    }

    // 4. apply env hooks
    const savedEnv: Record<string, string | undefined> = {};
    const effectiveEnv: Record<string, string> = { ...(cmd.env ?? {}) };
    if (fs.existsSync(reportsFixtureDir)) {
      effectiveEnv['HARNESS_REPORTS_ROOT_OVERRIDE'] = reportsTmpRoot;
    }
    for (const [k, v] of Object.entries(effectiveEnv)) {
      savedEnv[k] = process.env[k];
      process.env[k] = v;
    }

    // framework.config.json 可能在 INPUT 中提供；否则走 LEGACY_DEFAULT_DSL
    clearFrameworkConfigCache();

    // 5. 构造 SpecLoader 与 CheckContext
    const phase = cmd.phase;
    const fwConfig = loadFrameworkConfig(tmpdir);
    const workflowSpec = resolveWorkflowSpec(tmpdir, {
      config: fwConfig,
      frameworkRoot: FIXTURE_FRAMEWORK_ROOT,
    });
    const feature =
      cmd.feature ?? (isPhaseGlobalInWorkflow(workflowSpec, phase) ? GLOBAL_FEATURE_SENTINEL : undefined);
    if (!feature) {
      throw new Error(`CMD.json 必须指定 feature（或使用全局阶段）`);
    }

    const paths = resolvePaths(tmpdir, FIXTURE_FRAMEWORK_ROOT);
    const vhMode = fwConfig.prd?.visual_handoff_enforcement as CheckContext['visualHandoffEnforcement'];

    const specLoader = new SpecLoader(tmpdir, paths.phaseRulesDir);
    let phaseRule = specLoader.loadPhaseRule(phase);
    const resolvedProfile = loadResolvedProfile(tmpdir, fwConfig);
    phaseRule = loadPhaseRuleWithOverlays(phase, phaseRule, resolvedProfile);
    const phaseIsGlobal = isPhaseGlobalInWorkflow(workflowSpec, phase);
    const featureSpec = phaseIsGlobal ? { feature } : specLoader.loadFeatureSpec(feature);

    const ctx: CheckContext = {
      phase,
      feature,
      projectRoot: tmpdir,
      phaseRule,
      featureSpec,
      adapter: cmd.adapter,
      visualHandoffEnforcement: vhMode,
      prdVisualSources: fwConfig.prd?.visual_sources,
      docsCommitted: fwConfig.paths.docs_committed ?? false,
      skipVisualHandoff: false,
      resolvedProfile,
    };

    /** 与 harness-runner 对齐：profile 禁用整阶段时不跑 check-*.ts */
    let actualResults: CheckResult[];
    if (isPhaseDisabledByProfile(phase, resolvedProfile)) {
      actualResults = [
        {
          id: 'phase_disabled_by_profile',
          category: 'structure',
          description: `阶段 ${phase} 已由 project_profile 禁用（跳过脚本规则集）`,
          severity: 'MINOR',
          status: 'SKIP',
          details:
            `profile=${resolvedProfile.name}，参见 framework/profiles/${resolvedProfile.name}/profile.yaml phases_disabled`,
        },
      ];
    } else {
      // 6. 直接 require checker（绕开 harness-runner 的 Step 4/5）
      const checkerPath = path.join(FIXTURE_HARNESS_ROOT, 'scripts', `check-${phase}.ts`);
      if (!fs.existsSync(checkerPath)) {
        throw new Error(`checker 不存在：${checkerPath}`);
      }
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const checkerModule = require(checkerPath);
      const checker: PhaseChecker = checkerModule.default || checkerModule.checker || checkerModule;
      if (typeof checker.check !== 'function') {
        throw new Error(`check-${phase}.ts 未导出有效 checker`);
      }
      actualResults = await checker.check(ctx);
    }

    // restore env
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }

    // 7. 断言
    const actualMap = new Map<string, CheckResult>();
    actualResults.forEach(r => {
      // 同 id 多条时（多文件违规），只保留第一条做基础断言；
      // details_includes 子串匹配仍可命中所有 detail 串联。
      if (!actualMap.has(r.id)) actualMap.set(r.id, r);
    });
    const allDetailsById = new Map<string, string>();
    actualResults.forEach(r => {
      const acc = allDetailsById.get(r.id) ?? '';
      allDetailsById.set(r.id, acc + (r.details ?? '') + '\n');
    });

    for (const want of expected.rules) {
      const actual = actualMap.get(want.id);
      if (want.must_be_absent) {
        if (actual) {
          failures.push(`规则 ${want.id} 期望不出现，但实际出现（status=${actual.status}）`);
        }
        continue;
      }
      if (!actual) {
        failures.push(`规则 ${want.id} 未出现在 result[] 中`);
        continue;
      }
      if (want.status && actual.status !== want.status) {
        failures.push(
          `规则 ${want.id}: 期望 status=${want.status}，实际 ${actual.status}` +
            (actual.details ? `\n    details: ${truncate(actual.details, 200)}` : ''),
        );
      }
      if (want.severity && actual.severity !== want.severity) {
        failures.push(
          `规则 ${want.id}: 期望 severity=${want.severity}，实际 ${actual.severity}`,
        );
      }
      if (want.details_includes) {
        const allDetails = allDetailsById.get(want.id) ?? '';
        if (!allDetails.includes(want.details_includes)) {
          failures.push(
            `规则 ${want.id}: details 期望包含 "${want.details_includes}"\n    实际 details: ${truncate(allDetails, 400)}`,
          );
        }
      }
    }

    if (expected.verdict) {
      const hasBlockerFail = actualResults.some(
        r => r.severity === 'BLOCKER' && r.status === 'FAIL',
      );
      const verdict: 'PASS' | 'FAIL' = hasBlockerFail ? 'FAIL' : 'PASS';
      if (verdict !== expected.verdict) {
        failures.push(`整体 verdict: 期望 ${expected.verdict}，实际 ${verdict}`);
      }
    }

    return { name, ok: failures.length === 0, failures, actualResults, tmpdir };
  } catch (e) {
    return { name, ok: false, failures: [`fixture 运行异常：${(e as Error).message}`], error: e as Error, tmpdir };
  } finally {
    // 清理 tmpdir（出错时也清，但若 KEEP_TMPDIR=1 保留供调试）
    if (!process.env.KEEP_TMPDIR) {
      try {
        fs.rmSync(tmpdir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

// --------------------------------------------------------------------------
// helpers
// --------------------------------------------------------------------------

function copyDir(src: string, dst: string): void {
  if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

function runGit(cwd: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8', shell: false });
  if (r.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} 在 ${cwd} 失败 (exit=${r.status})：\n${r.stderr}\n${r.stdout}`,
    );
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + '… (truncated)';
}
