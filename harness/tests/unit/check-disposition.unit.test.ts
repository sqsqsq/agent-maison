// ============================================================================
// check-disposition.unit.test.ts — 处置函数、判定谓词与开发期静态守卫（plan f7045213 §3、§10）
// ----------------------------------------------------------------------------
//   A1 去向表为空（及只登记无关 id）时，处置函数对生产函数产出的检查输出等于其声明；
//   A2 静态守卫三条各有红的反例（临时夹具）；
//   A3 动态族前缀过宽或覆盖多个生产点时守卫变红；
//   守卫一、二、三对当前生产代码成立（基线由 tests/utils/check-disposition-scan.ts 生成）。
// ============================================================================

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  DISPOSITION_TABLE,
  findDispositionEntry,
  isBlockingCheck,
  resolveCheckDisposition,
  resolveCurrentDisposition,
  type DispositionEntry,
} from '../../scripts/utils/check-disposition';
import {
  FRAMEWORK_ROOT,
  PREDICATE_MODULE,
  buildBaseline,
  countIdProducerLines,
  countLiteralBlockingJudgements,
  loadBaseline,
  readProductionSources,
  scanBlockingConstructions,
  type DispositionBaseline,
} from '../utils/check-disposition-scan';
import type { CheckResult } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';

// ---------------------------------------------------------------------------
// 守卫（纯函数：生产用例与临时夹具反例共用同一实现）
// ---------------------------------------------------------------------------

/**
 * 守卫三的显式豁免：§4.1 标明保留原生语义、且确实写成字面判断的位置（按文件计数，行号漂移不影响）。
 * 另两处保留原生语义（报告合法性只看失败、request 入口任意失败即失败）与两处不读检查结果的位置
 * （视觉命中排序、扩展闭环回执映射）不是"失败且阻断"的合取字面判断，扫描本就不命中，无需豁免。
 */
const JUDGEMENT_EXEMPTIONS: Record<string, { count: number; reason: string }> = {
  'harness/compat-loader.ts': { count: 1, reason: 'compat 降级：命中豁免清单的改写，保留原生语义，执行位置不动（§4.1、§4.2）' },
  'harness/harness-runner.ts': { count: 1, reason: '违规钩子：同时处理 MAJOR 失败，保留原生语义（§4.1）' },
};

function baselineLiteralIds(baseline: DispositionBaseline): Set<string> {
  return new Set(Object.values(baseline.files).flatMap(f => f.literal_ids));
}

/** 守卫一：不在基线里的字面量阻断 id，且不在去向表里 → 红。 */
function guardNewLiteralIds(sources: Map<string, string>, baseline: DispositionBaseline, table: readonly DispositionEntry[]): string[] {
  const known = baselineLiteralIds(baseline);
  const problems: string[] = [];
  for (const [file, src] of sources) {
    for (const id of scanBlockingConstructions(src).literal_ids) {
      if (!known.has(id) && !findDispositionEntry(id, table)) {
        problems.push(`${file}: 新增阻断检查 id="${id}" 未在去向表登记保护对象（登记后重新生成基线）`);
      }
    }
  }
  return problems;
}

/** 守卫二：某文件 id 非字面量的阻断构造数超过基线 → 红。 */
function guardDynamicCounts(sources: Map<string, string>, baseline: DispositionBaseline): string[] {
  const problems: string[] = [];
  for (const [file, src] of sources) {
    const n = scanBlockingConstructions(src).dynamic_count;
    const allowed = baseline.files[file]?.dynamic_count ?? 0;
    if (n > allowed) {
      problems.push(`${file}: id 非字面量的阻断构造 ${n} > 基线 ${allowed}——新增动态族须在去向表登记该族并重新生成基线`);
    }
  }
  return problems;
}

/** 守卫三：谓词模块之外的"状态为失败且严重级别为阻断"字面判断 → 红（显式豁免按文件计数）。 */
function guardLiteralJudgements(sources: Map<string, string>, exemptions = JUDGEMENT_EXEMPTIONS): string[] {
  const problems: string[] = [];
  for (const [file, src] of sources) {
    if (file === PREDICATE_MODULE) continue;
    const n = countLiteralBlockingJudgements(src);
    const allowed = exemptions[file]?.count ?? 0;
    if (n > allowed) {
      problems.push(`${file}: ${n} 处"失败且阻断"字面判断（豁免 ${allowed}）——改用 check-disposition 的 isBlockingCheck`);
    }
  }
  return problems;
}

/** §3.2：去向表条目形状与动态族约束（A3）。 */
function validateDispositionTable(
  table: readonly DispositionEntry[],
  baseline: DispositionBaseline,
  sources: Map<string, string>,
): string[] {
  const problems: string[] = [];
  const literalIds = baselineLiteralIds(baseline);
  table.forEach((entry, index) => {
    const label = 'id' in entry.match ? `id=${entry.match.id}` : `prefix=${entry.match.prefix}`;
    if (entry.protects === 'result_basis' && !entry.owner) problems.push(`${label}: 结果依据类必须写明责任方`);
    if (!entry.basis.trim() || !entry.consequence.trim()) problems.push(`${label}: 须写明依据与放过的后果`);
    if ('id' in entry.match) return;
    const { prefix, producer } = entry.match;
    if (prefix.length === 0) {
      problems.push(`${label}: 空前缀`);
      return;
    }
    const shadowed = [...literalIds].filter(id => id.startsWith(prefix));
    if (shadowed.length > 0) problems.push(`${label}: 前缀过宽，覆盖已有检查 ${shadowed.slice(0, 5).join(', ')}`);
    table.forEach((other, j) => {
      if (j === index) return;
      const hit = 'id' in other.match
        ? other.match.id.startsWith(prefix)
        : other.match.prefix.startsWith(prefix) || prefix.startsWith(other.match.prefix);
      if (hit) problems.push(`${label}: 与去向表第 ${j} 条重叠`);
    });
    // 只数产出检查 id 的表达式；去向表所在的谓词模块不算生产点（表里精确 id 条目也写作 `id:`）。
    const producers: string[] = [];
    for (const [file, src] of sources) {
      if (file === PREDICATE_MODULE) continue;
      for (let k = countIdProducerLines(src, prefix); k > 0; k--) producers.push(file);
    }
    if (producers.length !== 1 || producers[0] !== producer) {
      problems.push(`${label}: 一个族只对应一个生产点（登记 ${producer}，实际 ${producers.length} 处：${[...new Set(producers)].join(', ') || '无'}）`);
    }
  });
  return problems;
}

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function mkTmp(tag: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `maison-disposition-${tag}-`));
}

function write(root: string, rel: string, content: string): string {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
  return abs;
}

const BLOCKER_FAIL_LITERAL = (id: string) =>
  `export const r = () => [{ id: '${id}', category: 'structure', description: 'd', severity: 'BLOCKER', status: 'FAIL', details: 'x', suggestion: 's' }];\n`;

/** 声明即处置：FAIL+BLOCKER 阻断（无表项），其余不阻断。 */
function assertDeclaredDisposition(check: CheckResult, table: readonly DispositionEntry[], label: string): void {
  const declaredBlocking = check.status === 'FAIL' && check.severity === 'BLOCKER';
  const d = resolveCheckDisposition(check, table);
  if (declaredBlocking) assert.deepStrictEqual(d, { action: 'block', entry: null }, `${label}: ${check.id} 应按声明阻断`);
  else assert.deepStrictEqual(d, { action: 'none' }, `${label}: ${check.id} 应按声明不阻断`);
  assert.strictEqual(isBlockingCheck(check, table), declaredBlocking, `${label}: 谓词须是处置函数的布尔投影（${check.id}）`);
}

/** 只登记与样本无关的 id 与动态族：表非空时，表里没有的检查仍按声明处置。 */
const UNRELATED_TABLE: readonly DispositionEntry[] = [
  { match: { id: 'unrelated_ledger_check' }, protects: 'ledger_shape', basis: 'test', consequence: 'none' },
  { match: { prefix: 'unrelated_family_', producer: 'harness/scripts/nowhere.ts' }, protects: 'ledger_shape', basis: 'test', consequence: 'none' },
];

/** A1 样本：全部由生产函数产出，不遍历生成的清单。 */
function productionSamples(): Array<{ label: string; checks: CheckResult[] }> {
  const out: Array<{ label: string; checks: CheckResult[] }> = [];

  // 字面量 id（经 `...base` 展开构造，静态扫描射程外，运行时走第 3 条）
  const { runProcessIntegrityPreflight } = require('../../scripts/utils/process-integrity') as typeof import('../../scripts/utils/process-integrity');
  const injected = mkTmp('integrity');
  write(injected, '.node-options', '--require ./evil.js\n');
  const integrity = runProcessIntegrityPreflight({ projectRoot: injected, harnessDir: injected });
  assert(integrity.some(c => c.id === 'node_options_injection' && c.status === 'FAIL'), JSON.stringify(integrity));
  out.push({ label: '字面量 id', checks: integrity });
  const clean = mkTmp('integrity-clean');
  out.push({ label: '字面量 id（PASS）', checks: runProcessIntegrityPreflight({ projectRoot: clean, harnessDir: clean }) });

  // 常量间接定义的 id（CANONICAL / LEGACY_CODING_COMPILE_ID）
  const { profileCodingHost } = require('../../../profiles/hmos-app/harness/coding-host-rules') as {
    profileCodingHost: { checkCodingCompile: (ctx: unknown) => CheckResult[] };
  };
  const compile = profileCodingHost.checkCodingCompile({
    phase: 'coding', feature: '_adhoc', projectRoot: FRAMEWORK_ROOT, phaseRule: {}, featureSpec: { feature: '_adhoc' },
    resolvedProfile: { name: 'hmos-app', profileDir: '', capabilities: { 'coding.compile': { provider: 'hvigor', severity: 'BLOCKER' } }, phasesDisabled: new Set<string>() },
    frameworkRoot: FRAMEWORK_ROOT, harnessRoot: FRAMEWORK_ROOT,
  });
  assert(compile.some(c => c.id === 'coding_compile' && c.status === 'FAIL'), JSON.stringify(compile.map(c => c.id)));
  out.push({ label: '常量 id', checks: compile });

  // runner 的致命失败 id（`runner_${stage}_failed`）
  const { failScriptReportWithFatalError } = require('../../scripts/utils/report-generator') as typeof import('../../scripts/utils/report-generator');
  const runnerRoot = mkTmp('runner');
  const fatal = failScriptReportWithFatalError(
    {
      phase: 'coding', feature: 'f', timestamp: '', project_root: runnerRoot, assurance: 'not_applicable',
      capability_resolutions: [], capability_resolution_contract_fingerprint: null, checks: [],
      summary: { total: 0, pass: 0, fail: 0, warn: 0, skip: 0, blockers: 0, verdict: 'PASS' },
    },
    'assemble_ai_prompt',
    new Error('boom'),
    runnerRoot,
  );
  assert(fatal.checks.some(c => c.id === 'runner_assemble_ai_prompt_failed'), JSON.stringify(fatal.checks.map(c => c.id)));
  out.push({ label: 'runner 致命失败 id', checks: fatal.checks });

  // testing 失败路由的动态 id（`testing_failure_routing_${case}_${step}`）
  const { __testing_checkHylyreFailureRouting } = require('../../scripts/check-testing') as typeof import('../../scripts/check-testing');
  const { parseHylyreTrace } = require('../../../profiles/hmos-app/harness/providers/device-test-run') as typeof import('../../../profiles/hmos-app/harness/providers/device-test-run');
  const traceRoot = mkTmp('trace');
  const golden = path.join(FRAMEWORK_ROOT, 'profiles/hmos-app/vendor/hylyre/src/hylyre/contracts/golden/trace/valid/bc-opencard-1.json');
  const tracePath = write(traceRoot, 'trace.json', fs.readFileSync(golden, 'utf-8'));
  const routed = __testing_checkHylyreFailureRouting(
    { projectRoot: traceRoot, feature: 'f', phase: 'testing', frameworkRoot: FRAMEWORK_ROOT } as never,
    parseHylyreTrace(tracePath),
    null,
    null,
  );
  assert(
    routed.some(c => c.id.startsWith('testing_failure_routing_') && c.id !== 'testing_failure_routing_protocol'),
    JSON.stringify(routed.map(c => c.id)),
  );
  out.push({ label: 'testing 动态 id', checks: routed });

  // 同一检查的非阻断声明：MAJOR 失败、阻断跳过、阻断警告都不阻断
  out.push({
    label: '非阻断声明',
    checks: [
      { ...integrity[0], severity: 'MAJOR', status: 'FAIL' },
      { ...integrity[0], severity: 'BLOCKER', status: 'SKIP' },
      { ...integrity[0], severity: 'BLOCKER', status: 'WARN' },
    ],
  });
  return out;
}

// ---------------------------------------------------------------------------
// cases
// ---------------------------------------------------------------------------

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: '扫描器自检：字面量 id、动态 id、无 status 的 issue、字面判断与取反形态',
    run: () => {
      const src = [
        "a.push({ id: 'lit_one', category: 'structure', severity: 'BLOCKER', status: 'FAIL', details: 'x' });",
        "a.push({ id: `dyn_${x}`, severity: 'BLOCKER' as const, status: 'FAIL' as const, details: 'x' });",
        "a.push({ id, severity: 'BLOCKER', status: ok ? 'PASS' : 'FAIL', details: 'x' });",
        "a.push({ id: CONST_ID, severity: 'BLOCKER', status: 'FAIL', details: `t ${'{'}` });",
        "issues.push({ id: 'issue_only', severity: 'BLOCKER', message: 'no status' });",
        "a.push({ id: 'lit_two', severity: 'MINOR', status: 'FAIL' });",
      ].join('\n');
      const scan = scanBlockingConstructions(src);
      assert.deepStrictEqual(scan.literal_ids, ['lit_one']);
      assert.strictEqual(scan.dynamic_count, 3);
      const judge = [
        "const b = checks.filter(c => c.status === 'FAIL' && c.severity === 'BLOCKER');",
        "if (r.severity !== 'BLOCKER' || r.status !== 'FAIL') continue;",
        "const v = c.status === 'FAIL' && (c.severity === 'BLOCKER' || c.severity === 'MAJOR');",
        "// c.status === 'FAIL' && c.severity === 'BLOCKER' 注释不计",
        "const any = c.status === 'FAIL' || (c.status === 'SKIP' && c.severity === 'BLOCKER');",
        "return severity === 'BLOCKER' || status === 'FAIL' ? 3 : 2;",
      ].join('\n');
      assert.strictEqual(countLiteralBlockingJudgements(judge), 3);
    },
  },
  {
    name: '守卫一、二：当前生产代码与基线一致（新增阻断检查须先登记保护对象）',
    run: () => {
      const sources = readProductionSources();
      const baseline = loadBaseline();
      const problems = [...guardNewLiteralIds(sources, baseline, DISPOSITION_TABLE), ...guardDynamicCounts(sources, baseline)];
      assert.deepStrictEqual(problems, [], problems.join('\n'));
    },
  },
  {
    name: '守卫三：谓词模块之外没有"失败且阻断"的字面判断（保留原生语义的位置显式豁免）',
    run: () => {
      const problems = guardLiteralJudgements(readProductionSources());
      assert.deepStrictEqual(problems, [], problems.join('\n'));
    },
  },
  {
    name: '去向表：条目形状与动态族约束对生产去向表成立；基线文件仍存在',
    run: () => {
      const sources = readProductionSources();
      const baseline = loadBaseline();
      assert.deepStrictEqual(validateDispositionTable(DISPOSITION_TABLE, baseline, sources), []);
      const gone = Object.keys(baseline.files).filter(f => !fs.existsSync(path.join(FRAMEWORK_ROOT, f)));
      assert.deepStrictEqual(gone, [], `基线里的文件已不存在，请重新生成基线：${gone.join(', ')}`);
      for (const [file, exemption] of Object.entries(JUDGEMENT_EXEMPTIONS)) {
        assert(fs.existsSync(path.join(FRAMEWORK_ROOT, file)), `豁免文件不存在：${file}（${exemption.reason}）`);
      }
    },
  },
  {
    name: 'A2 守卫一反例：新增未登记的字面量阻断 id 变红；登记后放行',
    run: () => {
      const root = mkTmp('g1');
      write(root, 'harness/scripts/check-old.ts', BLOCKER_FAIL_LITERAL('old_gate'));
      const baseline = buildBaseline(readProductionSources(root));
      write(root, 'harness/scripts/check-new.ts', BLOCKER_FAIL_LITERAL('brand_new_gate'));
      const sources = readProductionSources(root);
      const red = guardNewLiteralIds(sources, baseline, []);
      assert(red.length === 1 && red[0].includes('brand_new_gate'), red.join('\n'));
      const registered: DispositionEntry[] = [{ match: { id: 'brand_new_gate' }, protects: 'product_truth', basis: 'test', consequence: '坏产品' }];
      assert.deepStrictEqual(guardNewLiteralIds(sources, baseline, registered), []);
    },
  },
  {
    name: 'A2 守卫二反例：某文件非字面量阻断构造数超过基线变红',
    run: () => {
      const root = mkTmp('g2');
      const dyn = "export const f = (x: string) => ({ id: `fam_${x}`, category: 'structure', description: 'd', severity: 'BLOCKER', status: 'FAIL', details: 'x' });\n";
      write(root, 'profiles/demo/harness/gen.ts', dyn);
      const baseline = buildBaseline(readProductionSources(root));
      assert.deepStrictEqual(guardDynamicCounts(readProductionSources(root), baseline), []);
      write(root, 'profiles/demo/harness/gen.ts', dyn + dyn.replace('const f', 'const g'));
      const red = guardDynamicCounts(readProductionSources(root), baseline);
      assert(red.length === 1 && red[0].includes('profiles/demo/harness/gen.ts'), red.join('\n'));
    },
  },
  {
    name: 'A2 守卫三反例：谓词模块外新增字面判断变红；谓词模块与豁免位置不计',
    run: () => {
      const root = mkTmp('g3');
      const literal = "export const n = (cs: any[]) => cs.filter(c => c.status === 'FAIL' && c.severity === 'BLOCKER').length;\n";
      write(root, PREDICATE_MODULE, literal);
      write(root, 'harness/compat-loader.ts', literal);
      assert.deepStrictEqual(guardLiteralJudgements(readProductionSources(root)), []);
      write(root, 'harness/scripts/utils/some-consumer.ts', literal);
      const red = guardLiteralJudgements(readProductionSources(root));
      assert(red.length === 1 && red[0].startsWith('harness/scripts/utils/some-consumer.ts'), red.join('\n'));
      write(root, 'harness/compat-loader.ts', literal + literal);
      assert.strictEqual(guardLiteralJudgements(readProductionSources(root)).length, 2, '豁免按计数，不是整文件放行');
    },
  },
  {
    name: 'A3 动态族：前缀覆盖已有检查、覆盖多个生产点、与其它条目重叠时变红；单一生产点放行',
    run: () => {
      // 真实例：testing 失败路由的前缀会吞掉已有的 testing_failure_routing_protocol
      const sources = readProductionSources();
      const baseline = loadBaseline();
      const tooWide = validateDispositionTable(
        [{ match: { prefix: 'testing_failure_routing_', producer: 'harness/scripts/check-testing.ts' }, protects: 'ledger_shape', basis: 't', consequence: 'c' }],
        baseline,
        sources,
      );
      assert(tooWide.some(p => p.includes('前缀过宽') && p.includes('testing_failure_routing_protocol')), tooWide.join('\n'));

      const root = mkTmp('a3');
      const fam = (file: string) => write(root, file, "export const f = (x: string) => ({ id: `famx_${x}`, category: 'structure', description: 'd', severity: 'BLOCKER', status: 'FAIL', details: 'x' });\n");
      fam('harness/scripts/one.ts');
      const tmpSources = () => readProductionSources(root);
      const entry: DispositionEntry = { match: { prefix: 'famx_', producer: 'harness/scripts/one.ts' }, protects: 'ledger_shape', basis: 't', consequence: 'c' };
      assert.deepStrictEqual(validateDispositionTable([entry], buildBaseline(tmpSources()), tmpSources()), []);
      const wrongProducer = validateDispositionTable([{ ...entry, match: { prefix: 'famx_', producer: 'harness/scripts/two.ts' } }], buildBaseline(tmpSources()), tmpSources());
      assert(wrongProducer.some(p => p.includes('一个族只对应一个生产点')), wrongProducer.join('\n'));
      fam('harness/scripts/two.ts');
      const multi = validateDispositionTable([entry], buildBaseline(tmpSources()), tmpSources());
      assert(multi.some(p => p.includes('一个族只对应一个生产点') && p.includes('2 处')), multi.join('\n'));
      const overlap = validateDispositionTable(
        [entry, { match: { id: 'famx_special' }, protects: 'product_truth', basis: 't', consequence: 'c' }],
        buildBaseline(tmpSources()),
        tmpSources(),
      );
      assert(overlap.some(p => p.includes('重叠')), overlap.join('\n'));
      const noOwner = validateDispositionTable([{ match: { id: 'x_only' }, protects: 'result_basis', basis: 't', consequence: 'c' }], buildBaseline(tmpSources()), tmpSources());
      assert(noOwner.some(p => p.includes('责任方')), noOwner.join('\n'));
    },
  },
  {
    name: 'R2 动态族生产点只数产出检查 id 的表达式：去向表声明与普通引用不计',
    run: () => {
      const root = mkTmp('r2');
      const entry: DispositionEntry = { match: { prefix: 'famx_', producer: 'harness/scripts/one.ts' }, protects: 'ledger_shape', basis: 't', consequence: 'c' };
      // 真实的表声明落在谓词模块、一个生产点、一处普通引用
      write(root, PREDICATE_MODULE, "export const DISPOSITION_TABLE = [{ match: { prefix: 'famx_', producer: 'harness/scripts/one.ts' }, protects: 'ledger_shape', basis: 't', consequence: 'c' }];\n");
      write(root, 'harness/scripts/one.ts', "export const f = (x: string) => ({ id: `famx_${x}`, category: 'structure', description: 'd', severity: 'BLOCKER', status: 'FAIL', details: 'x' });\n");
      write(root, 'harness/scripts/consumer.ts', "export const isFam = (id: string): boolean => id.startsWith('famx_');\n");
      const sources = () => readProductionSources(root);
      assert.deepStrictEqual(validateDispositionTable([entry], buildBaseline(sources()), sources()), []);
      // 第二个生产点 → 红
      write(root, 'harness/scripts/two.ts', "export const g = (x: string) => ({ id: 'famx_' + x, category: 'structure', description: 'd', severity: 'BLOCKER', status: 'FAIL', details: 'x' });\n");
      const two = validateDispositionTable([entry], buildBaseline(sources()), sources());
      assert(two.some(p => p.includes('一个族只对应一个生产点') && p.includes('2 处')), two.join('\n'));
      fs.rmSync(path.join(root, 'harness/scripts/two.ts'));
      // 前缀覆盖既有 id → 红
      write(root, 'harness/scripts/lit.ts', BLOCKER_FAIL_LITERAL('famx_legacy'));
      const wide = validateDispositionTable([entry], buildBaseline(sources()), sources());
      assert(wide.some(p => p.includes('前缀过宽') && p.includes('famx_legacy')), wide.join('\n'));
    },
  },
  {
    name: 'A1 表里没有的检查（生产表与只含无关条目的表）：处置函数对生产函数产出的检查等于其声明（字面量、常量、runner 致命、testing 动态）',
    run: () => {
      for (const sample of productionSamples()) {
        for (const check of sample.checks) {
          // 样本 id 都不在生产去向表里：第 3 条（按声明）才是被验证的规则
          assert.strictEqual(findDispositionEntry(check.id, DISPOSITION_TABLE), null, `${sample.label}: ${check.id} 不应已登记`);
          assertDeclaredDisposition(check, DISPOSITION_TABLE, `${sample.label}/生产表`);
          assertDeclaredDisposition(check, UNRELATED_TABLE, `${sample.label}/只含无关条目的表`);
        }
      }
    },
  },
  {
    name: '处置规则：命中账本与形状披露、其余三类阻断；非失败或非阻断一律不阻断',
    run: () => {
      const check = { id: 'ledger_x', status: 'FAIL', severity: 'BLOCKER' };
      for (const protects of ['product_truth', 'result_basis', 'capability_gap'] as const) {
        const table: DispositionEntry[] = [{ match: { id: 'ledger_x' }, protects, owner: 'current_phase', basis: 't', consequence: 'c' }];
        assert.strictEqual(resolveCheckDisposition(check, table).action, 'block', protects);
      }
      const ledger: DispositionEntry[] = [{ match: { prefix: 'ledger_', producer: 'p.ts' }, protects: 'ledger_shape', basis: 't', consequence: 'c' }];
      assert.strictEqual(resolveCheckDisposition(check, ledger).action, 'disclose');
      assert.strictEqual(isBlockingCheck(check, ledger), false);
      assert.strictEqual(resolveCheckDisposition({ ...check, severity: 'MAJOR' }, ledger).action, 'none');
      assert.strictEqual(resolveCheckDisposition({ ...check, status: 'SKIP' }, ledger).action, 'none');
    },
  },
  {
    name: 'S0/S1 分离：软视觉残差披露不阻断普通完成，release 仍 BLOCKED；硬失败同时在场仍阻断',
    run: () => {
      const base = {
        phase: 'testing', summaryPresent: true, verdict: 'PASS', schemaCurrent: true,
        closureCommitted: true, lineage: 'fresh' as const,
      };
      const soft = resolveCurrentDisposition({
        endpoint: 'feature-completion',
        phases: [{
          ...base,
          axes: {
            functional: { applicable: true, required_for_release: true, verdict: 'PASS' },
            visual: { applicable: true, required_for_release: true, verdict: 'UNVERIFIED', resolution: { class: 'needs_fix', owner: 'agent' } },
          },
          openDebt: 2,
        }],
      });
      assert.strictEqual(soft.completionEligible, true, '披露项不得阻断普通完成');
      assert.strictEqual(soft.releaseReady, false, '披露项必须阻断发布');
      assert(soft.disclosed.some(p => p.id === 'quality_axis_verified' && p.affects === 'release'), '视觉轴披露缺失');
      assert(soft.disclosed.some(p => p.id === 'visual_debt_open'), '开放债务必须保留披露');

      const hard = resolveCurrentDisposition({
        endpoint: 'feature-completion',
        phases: [{
          ...base,
          failingChecks: [{ id: 'p0_semantic_coverage_integrity', status: 'FAIL', severity: 'BLOCKER' }],
          axes: { visual: { applicable: true, required_for_release: true, verdict: 'UNVERIFIED' } },
        }],
      });
      assert.strictEqual(hard.completionEligible, false, '真实硬失败不得被同场披露覆盖');
      assert(hard.completionBlocking.some(p => p.id === 'p0_semantic_coverage_integrity'));
    },
  },
  {
    name: '当前处置：框架执行缺口是等，过期证据是补验，已登记发现按责任归属阻断或披露',
    run: () => {
      const gap = resolveCurrentDisposition({
        endpoint: 'feature-completion',
        phases: [{
          phase: 'testing', summaryPresent: true, verdict: 'INCOMPLETE', schemaCurrent: true, closureCommitted: true,
          requiredGaps: [{ id: 'device_test_run', failure_kind: 'framework_bug' }],
        }],
      });
      const waits = gap.completionBlocking.filter(p => p.id === 'required_check_conclusion');
      assert(waits.length > 0 && waits.every(p => p.action === 'wait'), '框架缺口应等待而非产品失败');
      assert(waits.some(p => p.owner === 'framework'), '框架缺口应点名 framework 责任方');

      const stale = resolveCurrentDisposition({
        endpoint: 'feature-completion',
        phases: [{
          phase: 'coding', summaryPresent: true, verdict: 'PASS', schemaCurrent: true, closureCommitted: true,
          lineage: 'stale', lineageDetail: 'src/a.ets', lineagePropagatedFrom: 'plan',
        }],
      });
      const lineage = stale.completionBlocking.find(p => p.id === 'lineage_fresh');
      assert(lineage && lineage.action === 'verify' && lineage.propagated_from === 'plan', '过期证据应补验并保留传染来源');

      const finding = resolveCurrentDisposition({
        endpoint: 'feature-completion',
        phases: [{
          phase: 'plan', summaryPresent: true, verdict: 'PASS', schemaCurrent: true, closureCommitted: true,
          openFindings: [{ id: 'reference_crosscheck', detail: '设计矛盾' }],
        }],
      });
      assert.strictEqual(finding.completionEligible, false, '当前未处置发现必须阻断完成');
      const closed = resolveCurrentDisposition({
        endpoint: 'feature-completion',
        phases: [{
          phase: 'plan', summaryPresent: true, verdict: 'PASS', schemaCurrent: true, closureCommitted: true,
          openFindings: [{ id: 'reference_crosscheck', detail: '已由后续设计修订解决', affects: 'release' }],
        }],
      });
      assert.strictEqual(closed.completionEligible, true, '有据关闭只保留披露');
      assert.strictEqual(closed.releaseReady, false);
    },
  },
];

cases.push({ name: 'P2 registered native failure is one known repair, not another unknown quality axis', run() {
  const phase = { phase: 'testing', verdict: 'FAIL', schemaCurrent: true, closureCommitted: false,
    checks: [{ id: 'native_assertion', status: 'FAIL' as const, severity: 'BLOCKER' as const }],
    openFindings: [{ id: 'native_assertion', detail: 'the executed case still fails', owner: 'coding', evidence: ['case:TC-1#step:0'] }],
    axes: { functional: { applicable: true, required_for_release: true, verdict: 'FAIL', source_checks: ['native_assertion'] } } };
  const known = resolveCurrentDisposition({ endpoint: 'request', phases: [phase] });
  assert.strictEqual(known.completionBlocking.length, 1);
  assert.strictEqual(known.completionBlocking[0].action, 'repair');
  assert.strictEqual(known.completionBlocking[0].owner, 'coding');
  assert.deepStrictEqual(known.completionBlocking[0].evidence, ['case:TC-1#step:0']);
  const unknown = resolveCurrentDisposition({ endpoint: 'request', phases: [{ ...phase,
    axes: { functional: { ...phase.axes.functional, source_checks: ['another_check'] } } }] });
  assert(unknown.completionBlocking.some(problem => problem.id === 'quality_axis_verified' && problem.action === 'verify'));
  const unverified = resolveCurrentDisposition({ endpoint: 'request', phases: [{ ...phase,
    openFindings: [{ ...phase.openFindings[0], verificationRequired: true }] }] });
  assert(unverified.completionBlocking.some(problem => problem.action === 'verify'));
} });

cases.push({ name: 'refuted test preservation and disclosed ledger failures do not recreate a verdict repair', run() {
  const strength = { id: 'coding_existing_test_preserved', status: 'FAIL' as const, severity: 'BLOCKER' as const,
    details: 'current test changed', affected_files: ['src/example.test.ts'],
    verification: { issue: 'coding_existing_test_preserved', verdict: 'refuted' as const, evidence: 'actual preimage and current assertions checked' } };
  const ledger = { id: 'context_exploration_inputs_coverage', status: 'FAIL' as const, severity: 'BLOCKER' as const };
  assert.strictEqual(resolveCheckDisposition(ledger).action, 'disclose');
  const phase = { phase: 'coding', summaryPresent: true, verdict: 'FAIL', schemaCurrent: true,
    closureCommitted: true, lineage: 'fresh' as const, checks: [strength, ledger] };
  const result = resolveCurrentDisposition({ endpoint: 'request', phases: [phase] });
  assert.strictEqual(result.completionBlocking.length, 0, JSON.stringify(result));
  assert(result.disclosed.some(problem => problem.id === ledger.id));
  const unclear = { ...strength, verification: { ...strength.verification, verdict: 'unclear' as const } };
  assert(resolveCurrentDisposition({ endpoint: 'request', phases: [{ ...phase, checks: [unclear, ledger] }] }).completionBlocking.length > 0);
  assert(resolveCurrentDisposition({ endpoint: 'request', phases: [{ ...phase, checks: [] }] }).completionBlocking.some(problem => problem.id === 'verdict_pass'));
  assert(resolveCurrentDisposition({ endpoint: 'request', phases: [{ ...phase, checks: [strength, ledger,
    { id: 'native_assertion', status: 'FAIL', severity: 'BLOCKER' }] }] }).completionBlocking.length > 0);
} });

export function runAll(): UnitCaseResult[] {
  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      out.push({ name: c.name, ok: true });
    } catch (err) {
      out.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  }
  return out;
}
