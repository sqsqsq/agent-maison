// ============================================================================
// doc-freshness.unit.test.ts — v2.4 docs phase 纯函数单元回归
// ============================================================================
//
// 覆盖 utils/doc-freshness.ts 中两块容易"被误改而不被察觉"的逻辑：
//
//   1. parseInventory:
//      DOC_INVENTORY.yaml schema 校验。yaml 顺序、字段缺失、类型错误这类细节，
//      回归测试比手工逐条核对靠谱。
//
//   2. compareTimestamps:
//      doc/source 时间戳比较的判定矩阵。涉及多种"边界态"：
//        - sources 全空 → skip_no_sources
//        - doc 自己也没 git 历史 → skip_no_doc_history
//        - source 比 doc 新 → stale
//        - source 在仓库里但没 git 历史（未提交的改动）→ stale（视为无穷新）
//        - source 在 inventory 里但仓库不存在 → 不计入 staleness，列入 missing
//      这些边界一旦写错很难肉眼发现，所以全部圈住。
//
// 用法：cd framework/harness && npm run test:unit
// ============================================================================

import {
  parseInventory,
  compareTimestamps,
  SourceTimestamp,
} from '../../scripts/utils/doc-freshness';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

// ---- 微型断言 ----------------------------------------------------------------
function assertEq<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}\n    expected: ${e}\n    actual:   ${a}`);
  }
}
function assertTrue(cond: boolean, label: string): void {
  if (!cond) throw new Error(label);
}

// ---- 用例 --------------------------------------------------------------------

interface Case { name: string; run: () => void; }

const cases: Case[] = [
  // --------------------------------------------------------------------------
  // parseInventory
  // --------------------------------------------------------------------------
  {
    name: 'parseInventory: 合法 inventory → ok=true',
    run: () => {
      const r = parseInventory([
        'schema_version: "1.0"',
        'docs:',
        '  - path: framework/docs/overview.md',
        '    role: 全景',
        '    sources:',
        '      - framework/README.md',
        '      - framework/skills/feature/coding/SKILL.md',
        '  - path: framework/docs/skills/business-ut.md',
        '    role: UT 讲解',
        '    sources: []',
      ].join('\n'));
      assertTrue(r.ok, 'ok 应为 true');
      assertEq(r.errors.length, 0, '不应有错误');
      assertEq(r.inventory!.schema_version, '1.0', 'schema_version');
      assertEq(r.inventory!.docs.length, 2, 'docs 数量');
      assertEq(r.inventory!.docs[0].sources.length, 2, '第一份 sources');
      assertEq(r.inventory!.docs[1].sources.length, 0, '第二份 sources（空数组合法）');
    },
  },
  {
    name: 'parseInventory: YAML 解析失败 → yaml_parse_failed',
    run: () => {
      const r = parseInventory(': : :\n  invalid');
      assertTrue(!r.ok, 'ok 应为 false');
      assertTrue(r.errors.some(e => e.kind === 'yaml_parse_failed'), '应包含 yaml_parse_failed');
    },
  },
  {
    name: 'parseInventory: 缺 schema_version → missing_schema_version',
    run: () => {
      const r = parseInventory(['docs: []'].join('\n'));
      assertTrue(!r.ok, 'ok 应为 false');
      assertTrue(
        r.errors.some(e => e.kind === 'missing_schema_version'),
        '应包含 missing_schema_version',
      );
    },
  },
  {
    name: 'parseInventory: 缺 docs → missing_docs',
    run: () => {
      const r = parseInventory(['schema_version: "1.0"'].join('\n'));
      assertTrue(!r.ok, 'ok 应为 false');
      assertTrue(r.errors.some(e => e.kind === 'missing_docs'), '应包含 missing_docs');
    },
  },
  {
    name: 'parseInventory: docs 不是数组 → docs_not_array',
    run: () => {
      const r = parseInventory(['schema_version: "1.0"', 'docs: { not: array }'].join('\n'));
      assertTrue(!r.ok, 'ok 应为 false');
      assertTrue(r.errors.some(e => e.kind === 'docs_not_array'), '应包含 docs_not_array');
    },
  },
  {
    name: 'parseInventory: 单条 doc 缺 path → doc_missing_path',
    run: () => {
      const r = parseInventory([
        'schema_version: "1.0"',
        'docs:',
        '  - role: 没 path',
        '    sources: []',
      ].join('\n'));
      assertTrue(!r.ok, 'ok 应为 false');
      assertTrue(r.errors.some(e => e.kind === 'doc_missing_path'), '应包含 doc_missing_path');
    },
  },
  {
    name: 'parseInventory: 单条 doc 缺 sources → doc_missing_sources',
    run: () => {
      const r = parseInventory([
        'schema_version: "1.0"',
        'docs:',
        '  - path: framework/docs/x.md',
        '    role: x',
      ].join('\n'));
      assertTrue(!r.ok, 'ok 应为 false');
      assertTrue(
        r.errors.some(e => e.kind === 'doc_missing_sources'),
        '应包含 doc_missing_sources',
      );
    },
  },
  {
    name: 'parseInventory: sources 不是数组 → doc_sources_not_array',
    run: () => {
      const r = parseInventory([
        'schema_version: "1.0"',
        'docs:',
        '  - path: framework/docs/x.md',
        '    role: x',
        '    sources: not-an-array',
      ].join('\n'));
      assertTrue(!r.ok, 'ok 应为 false');
      assertTrue(
        r.errors.some(e => e.kind === 'doc_sources_not_array'),
        '应包含 doc_sources_not_array',
      );
    },
  },

  // --------------------------------------------------------------------------
  // compareTimestamps
  // --------------------------------------------------------------------------
  {
    name: 'compareTimestamps: sources 全空 → skip_no_sources',
    run: () => {
      const r = compareTimestamps('framework/docs/x.md', '2026-04-20T10:00:00+08:00', []);
      assertEq(r.verdict, 'skip_no_sources', 'verdict');
      assertEq(r.stale_sources.length, 0, 'stale_sources');
    },
  },
  {
    name: 'compareTimestamps: sources 都不存在 → skip_no_sources（present 为空）',
    run: () => {
      const sources: SourceTimestamp[] = [
        { path: 'a/missing.ts', ts: '2026-04-22T10:00:00+08:00', exists: false },
        { path: 'b/missing.ts', ts: null, exists: false },
      ];
      const r = compareTimestamps('framework/docs/x.md', '2026-04-20T10:00:00+08:00', sources);
      assertEq(r.verdict, 'skip_no_sources', 'verdict');
      assertEq(r.missing_sources.length, 2, 'missing_sources');
    },
  },
  {
    name: 'compareTimestamps: doc 没 git 历史（doc_ts=null） → skip_no_doc_history',
    run: () => {
      const sources: SourceTimestamp[] = [
        { path: 'a.ts', ts: '2026-04-20T10:00:00+08:00', exists: true },
      ];
      const r = compareTimestamps('framework/docs/x.md', null, sources);
      assertEq(r.verdict, 'skip_no_doc_history', 'verdict');
    },
  },
  {
    name: 'compareTimestamps: source 严格更新 → stale',
    run: () => {
      const sources: SourceTimestamp[] = [
        { path: 'a.ts', ts: '2026-04-22T10:00:00+08:00', exists: true },
      ];
      const r = compareTimestamps('framework/docs/x.md', '2026-04-20T10:00:00+08:00', sources);
      assertEq(r.verdict, 'stale', 'verdict');
      assertEq(r.stale_sources.length, 1, 'stale_sources count');
      assertEq(r.stale_sources[0].path, 'a.ts', 'stale source path');
    },
  },
  {
    name: 'compareTimestamps: source 时间戳等于 doc → fresh（边界）',
    run: () => {
      const ts = '2026-04-20T10:00:00+08:00';
      const sources: SourceTimestamp[] = [{ path: 'a.ts', ts, exists: true }];
      const r = compareTimestamps('framework/docs/x.md', ts, sources);
      assertEq(r.verdict, 'fresh', 'verdict');
    },
  },
  {
    name: 'compareTimestamps: source 比 doc 旧 → fresh',
    run: () => {
      const sources: SourceTimestamp[] = [
        { path: 'a.ts', ts: '2026-04-15T10:00:00+08:00', exists: true },
        { path: 'b.ts', ts: '2026-04-19T10:00:00+08:00', exists: true },
      ];
      const r = compareTimestamps('framework/docs/x.md', '2026-04-20T10:00:00+08:00', sources);
      assertEq(r.verdict, 'fresh', 'verdict');
      assertEq(r.stale_sources.length, 0, 'stale_sources count');
    },
  },
  {
    name: 'compareTimestamps: source 存在但无 git 历史（未提交） → stale + uncommitted',
    run: () => {
      const sources: SourceTimestamp[] = [
        { path: 'a.ts', ts: null, exists: true }, // 新增未提交
      ];
      const r = compareTimestamps('framework/docs/x.md', '2026-04-20T10:00:00+08:00', sources);
      assertEq(r.verdict, 'stale', 'verdict 应为 stale');
      assertEq(r.stale_sources.length, 0, 'stale_sources（无 ts 不进 stale_sources）');
      assertEq(r.uncommitted_sources.length, 1, 'uncommitted_sources');
      assertEq(r.uncommitted_sources[0].path, 'a.ts', 'uncommitted path');
    },
  },
  {
    name: 'compareTimestamps: 多源混合（部分新部分旧） → stale，仅返回更新的那条',
    run: () => {
      const sources: SourceTimestamp[] = [
        { path: 'old.ts',   ts: '2026-04-10T10:00:00+08:00', exists: true },
        { path: 'newer.ts', ts: '2026-04-22T10:00:00+08:00', exists: true },
        { path: 'gone.ts',  ts: null,                         exists: false },
      ];
      const r = compareTimestamps('framework/docs/x.md', '2026-04-20T10:00:00+08:00', sources);
      assertEq(r.verdict, 'stale', 'verdict');
      assertEq(r.stale_sources.length, 1, 'stale_sources 只该有 newer.ts');
      assertEq(r.stale_sources[0].path, 'newer.ts', '更新源路径');
      assertEq(r.missing_sources.length, 1, 'missing_sources 含 gone.ts');
      assertEq(r.missing_sources[0].path, 'gone.ts', 'missing path');
    },
  },
  {
    name: 'compareTimestamps: stale_sources 不会包含已被剔除的 missing 源',
    run: () => {
      const sources: SourceTimestamp[] = [
        { path: 'gone.ts', ts: '2099-01-01T00:00:00+08:00', exists: false },
      ];
      const r = compareTimestamps('framework/docs/x.md', '2026-04-20T10:00:00+08:00', sources);
      assertEq(r.verdict, 'skip_no_sources', 'verdict（present 为空 → skip）');
      assertEq(r.stale_sources.length, 0, 'stale_sources 不应包含 missing');
    },
  },
];

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
