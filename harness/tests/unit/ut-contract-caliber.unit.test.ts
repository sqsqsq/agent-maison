// ============================================================================
// ut-contract-caliber.unit.test.ts — plan f4c8d2b7：UT 契约冲突收口回归钉
// ============================================================================
// t1：DAG boundary 双形态（对象唯一推荐；旧字符串/port 兼容），对象形式须同时通过
//     dag_boundary_matches_spec 与 dag_spy_preset_resolvable（命中生产判据，非解析夹具）。
// t2：「照模板生成的合法产物能过门禁」——从 hmos-app 模板提取 EXACT OUTPUT FORMAT
//     yaml、替换占位符、配套 contracts/mock-plan，证明 ut_mock_plan_present 与
//     ut_mock_plan_contracts_consistent 同时 PASS；类.方法 依赖名须触发口径提示。
// t4：invalid suggestion 按产物分别生成（audit≠mock-plan，互不污染）。
// t5：模板路径 SSOT（skill-assets.yaml）解析：两 profile 全键存在性（绝对路径断言，
//     不受 cwd 影响）；清单不可用回落 profile-skill-asset 占位符。
// t6：ut prompt 契约块含两产物契约与真实路径；goal-runner 仅 ut 阶段注入（源级钉）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  checkDagBoundaryMatchesSpec,
  checkDagSpyPresetResolvable,
  checkUtMachineArtifactParseable,
  checkUtMockPlanContractsConsistent,
  checkUtMockPlanPresent,
  type DagFile,
  type UtMachineArtifactObservation,
} from '../../scripts/check-ut';
import {
  parseTestabilityAuditFromText,
  type MockPlanSpec,
  type TestabilityAuditRecord,
} from '../../scripts/utils/ut-artifact-parse';
import {
  renderUtFormatContractLines,
  resolveUtTemplateRef,
  type UtTemplateKey,
} from '../../scripts/utils/ut-template-paths';
import type { CheckContext } from '../../scripts/utils/types';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function makeCtx(over: { useCases?: unknown; contracts?: unknown } = {}): CheckContext {
  return {
    projectRoot: REPO_ROOT,
    frameworkRoot: REPO_ROOT,
    feature: 'demo',
    phaseRule: {
      structure_checks: {
        dag_boundary_matches_spec: { description: 'boundary matches spec' },
        dag_spy_preset_resolvable: { description: 'spy preset resolvable' },
        ut_mock_plan_present: { description: 'mock plan present' },
        ut_mock_plan_contracts_consistent: { description: 'mock plan contracts consistent' },
        ut_testability_audit_parseable: { description: 'audit parseable' },
        ut_mock_plan_parseable: { description: 'mock parseable' },
      },
    } as unknown as CheckContext['phaseRule'],
    featureSpec: { useCases: over.useCases, contracts: over.contracts },
    resolvedProfile: {
      name: 'hmos-app',
      profileDir: path.join(REPO_ROOT, 'profiles', 'hmos-app'),
      personalPrerequisites: {},
    },
  } as unknown as CheckContext;
}

const USE_CASES = {
  use_cases: [
    {
      id: 'UC-1',
      data_boundaries: [{ name: 'cloudApi', type: 'RemoteGw', kind: 'cloud', methods: ['fetch'] }],
    },
  ],
};

function dagWith(node: Record<string, unknown>): Array<{ path: string; dag: DagFile }> {
  return [{ path: 'test/dag/demo.dag.yaml', dag: { use_case: 'UC-1', nodes: [node] } as unknown as DagFile }];
}

const OBJECT_NODE = {
  id: 'n1',
  type: 'port_call_cloud',
  boundary: { name: 'cloudApi', type: 'RemoteGw', method: 'fetch' },
  spy_preset: 'p1',
};

// ---------------------------------------------------------------------------
// t1
// ---------------------------------------------------------------------------

function testBoundaryObjectFormPasses(): void {
  const r = checkDagBoundaryMatchesSpec(makeCtx({ useCases: USE_CASES }), dagWith(OBJECT_NODE))[0];
  assert(r.status === 'PASS', `对象形式应 PASS：${r.status} ${r.details}`);
}

function testBoundaryObjectMismatchWarns(): void {
  const node = { ...OBJECT_NODE, boundary: { name: 'wrongApi', type: 'RemoteGw', method: 'fetch' } };
  const r = checkDagBoundaryMatchesSpec(makeCtx({ useCases: USE_CASES }), dagWith(node))[0];
  assert(r.status === 'WARN', `不在 data_boundaries 应 WARN：${r.status}`);
  assert(r.details.includes('boundary.name="wrongApi"'), `details 须按 boundary.name 报告：${r.details}`);
}

function testBoundaryLegacyStringStillConsumed(): void {
  const node = { id: 'n1', type: 'port_call_local', boundary: 'cloudApi' };
  const r = checkDagBoundaryMatchesSpec(makeCtx({ useCases: USE_CASES }), dagWith(node))[0];
  assert(r.status === 'PASS', `旧字符串形态仍须兼容消费：${r.status} ${r.details}`);
}

function testBoundaryLegacyPortStillConsumed(): void {
  const node = { id: 'n1', type: 'port_call_cloud', port: 'cloudApi' };
  const r = checkDagBoundaryMatchesSpec(makeCtx({ useCases: USE_CASES }), dagWith(node))[0];
  assert(r.status === 'PASS', `旧 port 字段仍须兼容消费：${r.status} ${r.details}`);
}

function testBoundaryObjectWithoutNameFlagged(): void {
  const node = { id: 'n1', type: 'port_call_cloud', boundary: { type: 'RemoteGw', method: 'fetch' } };
  const r = checkDagBoundaryMatchesSpec(makeCtx({ useCases: USE_CASES }), dagWith(node))[0];
  assert(r.status === 'WARN', `缺 boundary.name 应报告：${r.status}`);
  assert(r.details.includes('缺 boundary.name'), r.details);
}

function testSuggestionTeachesObjectOnly(): void {
  const node = { id: 'n1', type: 'port_call_cloud' };
  const r = checkDagBoundaryMatchesSpec(makeCtx({ useCases: USE_CASES }), dagWith(node))[0];
  assert(r.suggestion?.includes('boundary 对象') === true, `suggestion 须教对象形式：${r.suggestion}`);
  assert(r.suggestion?.includes('boundary.name') === true, `suggestion 须教 boundary.name：${r.suggestion}`);
  assert(!(r.suggestion ?? '').includes('port 仍兼容'), `suggestion 不得再教字符串/port 写法：${r.suggestion}`);
}

function testObjectFormPassesBothGates(): void {
  const ctx = makeCtx({ useCases: USE_CASES });
  const dags = dagWith(OBJECT_NODE);
  const plan = {
    spies: [
      {
        target_class: 'RemoteGw',
        methods: [{ name: 'fetch', presets: [{ id: 'p1', returns: { ts_expr: 'null as FetchResult' } }] }],
      },
    ],
  } as unknown as MockPlanSpec;
  const rb = checkDagBoundaryMatchesSpec(ctx, dags)[0];
  const rs = checkDagSpyPresetResolvable(ctx, dags, plan)[0];
  assert(rb.status === 'PASS', `boundary 门应 PASS：${rb.status} ${rb.details}`);
  assert(rs.status === 'PASS', `spy_preset 门应同时 PASS：${rs.status} ${rs.details}`);
}

// ---------------------------------------------------------------------------
// t2
// ---------------------------------------------------------------------------

function extractExactOutputFormatRecords(): TestabilityAuditRecord[] {
  const ref = resolveUtTemplateRef(REPO_ROOT, 'hmos-app', 'testability_audit_template');
  assert(!!ref.abs && fs.existsSync(ref.abs), `模板须真实存在：${ref.rel}`);
  const md = fs.readFileSync(ref.abs!, 'utf-8');
  const section = /## EXACT OUTPUT FORMAT[^]*?```yaml\n([^]*?)```/.exec(md);
  assert(!!section, '模板须含 EXACT OUTPUT FORMAT 的 fenced yaml 块');
  const yamlText = section![1].replace(/<feature>/g, 'demo');
  const records = parseTestabilityAuditFromText('```yaml\n' + yamlText + '\n```');
  assert(records.length >= 3, `EXACT OUTPUT FORMAT 须可解析出记录（实得 ${records.length}）`);
  return records;
}

function testTemplateDepNamesArePureClassNames(): void {
  const records = extractExactOutputFormatRecords();
  for (const rec of records) {
    for (const d of rec.dependencies ?? []) {
      assert(
        typeof d.name === 'string' && !d.name.includes('.'),
        `模板依赖 name 必须为纯类名（发现「${d.name}」）——类.方法 形态与门禁精确相等判据构成无解局`,
      );
    }
  }
}

function testTemplateRecordsPassBothMockPlanGates(): void {
  const records = extractExactOutputFormatRecords();
  const classes = [...new Set(records.flatMap(r => (r.dependencies ?? []).map(d => d.name)))].filter(
    (n): n is string => typeof n === 'string' && n.length > 0,
  );
  assert(classes.length > 0, '模板记录须含依赖类名');
  const contracts = {
    interfaces: classes.map(c => ({ class: c, file: `src/${c}.ets`, methods: [{ name: 'stubMethod' }] })),
  };
  const plan = {
    spies: classes.map(c => ({
      target_class: c,
      methods: [{ name: 'stubMethod', presets: [{ id: 'p1', returns: { ts_expr: 'null as Stub' } }] }],
    })),
  } as unknown as MockPlanSpec;
  const ctx = makeCtx({ contracts });
  const observed: UtMachineArtifactObservation<MockPlanSpec> = {
    status: 'loaded',
    absPath: path.join(REPO_ROOT, 'ut', 'mock-plan.yaml'),
    relPath: 'ut/mock-plan.yaml',
    value: plan,
    warnings: [],
  };
  const present = checkUtMockPlanPresent(ctx, records, observed)[0];
  assert(present.status === 'PASS', `照模板生成的产物须过 ut_mock_plan_present：${present.status} ${present.details}`);
  const consistent = checkUtMockPlanContractsConsistent(ctx, plan)[0];
  assert(
    consistent.status === 'PASS',
    `照模板生成的产物须过 ut_mock_plan_contracts_consistent：${consistent.status} ${consistent.details}`,
  );
}

function testClassDotMethodDepGetsCaliberHint(): void {
  const records = [
    {
      acceptance_id: 'AC-1',
      testability_level: 'L1',
      verdict: 'testable',
      dependencies: [{ name: 'HAFullChainService.getData', kind: 'di_injectable' }],
    },
  ] as unknown as TestabilityAuditRecord[];
  const plan = {
    spies: [{ target_class: 'HAFullChainService', methods: [{ name: 'getData', presets: [{ id: 'p1', returns: { ts_expr: 'null as X' } }] }] }],
  } as unknown as MockPlanSpec;
  const observed: UtMachineArtifactObservation<MockPlanSpec> = {
    status: 'loaded',
    absPath: path.join(REPO_ROOT, 'ut', 'mock-plan.yaml'),
    relPath: 'ut/mock-plan.yaml',
    value: plan,
    warnings: [],
  };
  const r = checkUtMockPlanPresent(makeCtx(), records, observed)[0];
  assert(r.status === 'FAIL', `类.方法 依赖名对纯类名 target_class 应 FAIL：${r.status}`);
  assert(r.details.includes('纯类名'), `FAIL 详情须给出口径提示：${r.details}`);
  assert(r.suggestion?.includes('纯类名') === true, `suggestion 须明示口径：${r.suggestion}`);
}

// ---------------------------------------------------------------------------
// t4
// ---------------------------------------------------------------------------

function testInvalidSuggestionSplitPerArtifact(): void {
  const ctx = makeCtx();
  const auditObs: UtMachineArtifactObservation<TestabilityAuditRecord[]> = {
    status: 'invalid',
    absPath: path.join(REPO_ROOT, 'ut', 'testability-audit.md'),
    relPath: 'ut/testability-audit.md',
    errors: ['document: 根须为对象'],
  };
  const audit = checkUtMachineArtifactParseable(ctx, 'ut_testability_audit_parseable', 'testability-audit.md', auditObs)[0];
  assert(audit.status === 'FAIL', audit.status);
  const auditSug = audit.suggestion ?? '';
  assert(auditSug.includes('records[]'), `audit suggestion 须含 records[]：${auditSug}`);
  assert(auditSug.includes('Markdown 表格'), `audit suggestion 须禁 Markdown 表格：${auditSug}`);
  assert(!auditSug.includes('spies[]'), `audit suggestion 不得混入 mock-plan 契约：${auditSug}`);
  const auditRef = resolveUtTemplateRef(REPO_ROOT, 'hmos-app', 'testability_audit_template');
  assert(auditSug.includes(auditRef.rel), `audit suggestion 须给模板真实路径：${auditSug}`);
  assert(!!auditRef.abs && fs.existsSync(auditRef.abs), '给出的模板路径必须真实存在（防幻影路径复发）');

  const mockObs: UtMachineArtifactObservation<MockPlanSpec> = {
    status: 'invalid',
    absPath: path.join(REPO_ROOT, 'ut', 'mock-plan.yaml'),
    relPath: 'ut/mock-plan.yaml',
    errors: ['root: 根须为对象'],
  };
  const mock = checkUtMachineArtifactParseable(ctx, 'ut_mock_plan_parseable', 'mock-plan.yaml', mockObs)[0];
  assert(mock.status === 'FAIL', mock.status);
  const mockSug = mock.suggestion ?? '';
  assert(mockSug.includes('纯 YAML'), `mock-plan suggestion 须要求纯 YAML：${mockSug}`);
  assert(mockSug.includes('spies[] 或 doubles[]'), `mock-plan suggestion 须给根字段：${mockSug}`);
  assert(mockSug.includes('fenced code block'), `mock-plan suggestion 须禁 fenced 块：${mockSug}`);
  assert(!mockSug.includes('records[]'), `mock-plan suggestion 不得混入 audit 契约：${mockSug}`);
  const mockRef = resolveUtTemplateRef(REPO_ROOT, 'hmos-app', 'mock_plan_schema');
  assert(mockSug.includes(mockRef.rel), `mock-plan suggestion 须给 schema 真实路径：${mockSug}`);
  assert(!!mockRef.abs && fs.existsSync(mockRef.abs), 'schema 路径必须真实存在');
}

// ---------------------------------------------------------------------------
// t5
// ---------------------------------------------------------------------------

const ALL_KEYS: UtTemplateKey[] = [
  'use_cases_schema',
  'dag_schema',
  'testability_audit_template',
  'mock_plan_schema',
  'sample_flow_dir',
];

function testSsotResolutionBothProfiles(): void {
  for (const profile of ['hmos-app', 'generic'] as const) {
    for (const key of ALL_KEYS) {
      const ref = resolveUtTemplateRef(REPO_ROOT, profile, key);
      assert(!!ref.abs, `${profile}/${key} 须解析出绝对路径（实得占位符 ${ref.rel}）`);
      assert(fs.existsSync(ref.abs!), `${profile}/${key} → ${ref.rel} 不存在`);
      assert(!ref.rel.startsWith('profile-skill-asset:'), `${profile}/${key} 不应回落占位符`);
      assert(!ref.rel.includes('skills/feature/business-ut'), `不得复发幻影路径形态：${ref.rel}`);
    }
  }
}

function testSsotFallbackPlaceholder(): void {
  const bogusRoot = path.join(REPO_ROOT, 'harness', 'tests', 'unit', '__nonexistent_root__');
  assert(!fs.existsSync(bogusRoot), '前置：伪根不得存在');
  const ref = resolveUtTemplateRef(bogusRoot, 'hmos-app', 'testability_audit_template');
  assert(
    ref.rel === 'profile-skill-asset:business-ut/testability_audit_template',
    `清单不可用须回落占位符原文（实得 ${ref.rel}）`,
  );
  assert(ref.abs === undefined, '回落时不得拼接猜测的物理路径');
}

// ---------------------------------------------------------------------------
// t6
// ---------------------------------------------------------------------------

function testUtPromptContractLines(): void {
  const lines = renderUtFormatContractLines(REPO_ROOT, 'hmos-app');
  const joined = lines.join('\n');
  assert(joined.includes('testability-audit.md'), joined);
  assert(joined.includes('records[]'), 'audit 契约须在 prompt 中');
  assert(joined.includes('mock-plan.yaml'), joined);
  assert(joined.includes('spies[] or doubles[]'), 'mock-plan 契约须在 prompt 中');
  assert(joined.includes('pure YAML only'), 'mock-plan 纯 YAML 要求须在 prompt 中');
  for (const label of ['Template: ', 'Schema: ']) {
    for (const line of lines) {
      const idx = line.indexOf(label);
      if (idx < 0) continue;
      const rel = line.slice(idx + label.length).trim();
      assert(
        fs.existsSync(path.resolve(REPO_ROOT, rel)),
        `prompt 注入的路径必须真实存在（基于 project root 还原，不依赖 cwd）：${rel}`,
      );
    }
  }
}

function testGoalRunnerInjectsUtOnly(): void {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'harness', 'scripts', 'goal-phase-runtime-process.ts'), 'utf-8');
  assert(
    /phase === 'ut' \? \['', \.\.\.renderUtFormatContractLines\(projectRoot\)\] : \[\]/.test(src),
    'goal-runner 须仅在 ut 阶段注入格式契约块（他 phase prompt 不变）',
  );
}

// ---------------------------------------------------------------------------

export function runAll(): UnitCaseResult[] {
  const cases: Array<{ name: string; fn: () => void }> = [
    { name: 't1 boundary 对象形式 PASS', fn: testBoundaryObjectFormPasses },
    { name: 't1 boundary 对象不匹配 → WARN(按 boundary.name 报告)', fn: testBoundaryObjectMismatchWarns },
    { name: 't1 旧字符串 boundary 兼容消费', fn: testBoundaryLegacyStringStillConsumed },
    { name: 't1 旧 port 字段兼容消费', fn: testBoundaryLegacyPortStillConsumed },
    { name: 't1 对象缺 name → 报缺 boundary.name', fn: testBoundaryObjectWithoutNameFlagged },
    { name: 't1 suggestion 只教对象形式', fn: testSuggestionTeachesObjectOnly },
    { name: 't1 同一对象形式 DAG 两门同时 PASS', fn: testObjectFormPassesBothGates },
    { name: 't2 模板依赖名均为纯类名', fn: testTemplateDepNamesArePureClassNames },
    { name: 't2 照模板生成的产物两门同时 PASS(回归钉)', fn: testTemplateRecordsPassBothMockPlanGates },
    { name: 't2 类.方法 依赖名触发口径提示', fn: testClassDotMethodDepGetsCaliberHint },
    { name: 't4 invalid suggestion 按产物分别生成', fn: testInvalidSuggestionSplitPerArtifact },
    { name: 't5 SSOT 解析两 profile 全键存在', fn: testSsotResolutionBothProfiles },
    { name: 't5 清单不可用回落占位符', fn: testSsotFallbackPlaceholder },
    { name: 't6 ut prompt 契约块含真实路径', fn: testUtPromptContractLines },
    { name: 't6 goal-runner 仅 ut 阶段注入(源级钉)', fn: testGoalRunnerInjectsUtOnly },
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
