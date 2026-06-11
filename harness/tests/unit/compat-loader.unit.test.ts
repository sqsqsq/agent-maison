// ============================================================================
// compat-loader.unit.test.ts — Feature compat.yaml 降级协议
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  applyCompatDowngrade,
  compatDowngradeMatchesExempt,
  isScheduledBackfillExpired,
  loadFeatureCompat,
} from '../../compat-loader';
import type { CheckResult } from '../../scripts/utils/types';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assertTrue(cond: boolean, label: string): void {
  if (!cond) throw new Error(label);
}
function assertEq<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}\n    expected: ${e}\n    actual:   ${a}`);
}

function mkdirp(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function writeCompat(projectRoot: string, feature: string, body: string): void {
  const dir = path.join(projectRoot, 'doc', 'features', feature);
  mkdirp(dir);
  fs.writeFileSync(path.join(dir, 'compat.yaml'), body, 'utf-8');
}

interface Case {
  name: string;
  run: () => void;
}

function blockerFail(id: string): CheckResult {
  return {
    id,
    category: 'structure',
    description: 'x',
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `fail:${id}`,
  };
}

function verdictFail(checks: CheckResult[]): boolean {
  return checks.some(c => c.severity === 'BLOCKER' && c.status === 'FAIL');
}

const cases: Case[] = [
  {
    name: 'isScheduledBackfillExpired：UTC 日历日以后过期（边界不含当日末）',
    run: () => {
      assertTrue(
        !isScheduledBackfillExpired('2020-01-01', Date.UTC(2020, 0, 1, 23, 59, 59)),
        '当日未过',
      );
      assertTrue(isScheduledBackfillExpired('2020-01-01', Date.UTC(2020, 0, 2, 0, 0, 0)), 'UTC 跨入次日即过期');
    },
  },
  {
    name: 'compatDowngradeMatchesExempt：仅末尾 * 前缀通配；中缀 * 不匹配',
    run: () => {
      assertTrue(
        compatDowngradeMatchesExempt('context_exploration_*', 'context_exploration_present'),
        'context_exploration_* 命中',
      );
      assertTrue(!compatDowngradeMatchesExempt('foo*bar', 'foobar'), '中缀星号不匹配 foobar');
      assertTrue(!compatDowngradeMatchesExempt('foo*bar', 'foobarbaz'), '中缀星号不匹配 foobarbaz');
    },
  },
  {
    name: 'loadFeatureCompat：无 compat.yaml → enabled false',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-'));
      mkdirp(path.join(root, 'doc', 'features', 'f1'));
      const r = loadFeatureCompat(root, 'f1', Date.now());
      assertTrue(!r.enabled && !r.parseAdvisory && !r.data, '无 compat 文件');
    },
  },
  {
    name: 'loadFeatureCompat：YAML 不可用 → advisory + disabled',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-'));
      writeCompat(root, 'fx', 'this is not yaml: ::: [[[[[');
      const r = loadFeatureCompat(root, 'fx', Date.now());
      assertTrue(!r.enabled && r.parseAdvisory?.id === 'compat_yaml_parse', 'yaml 失败 id');
      assertEq(r.parseAdvisory?.severity, 'MINOR', 'severity');
      assertEq(r.parseAdvisory?.status, 'WARN', 'status');
    },
  },
  {
    name: 'loadFeatureCompat：feature 字段与目录不一致 → compat_feature_mismatch',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-'));
      writeCompat(
        root,
        'good',
        [
          'schema_version: "1.0"',
          'feature: wrong-name',
          'exempt_checks: ["ctx_*"]',
          'reason: "x"',
          'scheduled_backfill_by: "2099-01-01"',
        ].join('\n'),
      );
      const r = loadFeatureCompat(root, 'good', Date.now());
      assertTrue(!r.enabled && r.parseAdvisory?.id === 'compat_feature_mismatch', '目录名≠feature');
    },
  },
  {
    name: 'loadFeatureCompat：中缀星号 exempt → compat_invalid_exempt_pattern',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-'));
      writeCompat(
        root,
        'mid',
        [
          'schema_version: "1.0"',
          'feature: mid',
          'exempt_checks: ["foo*bar"]',
          'reason: "x"',
          'scheduled_backfill_by: "2099-01-01"',
        ].join('\n'),
      );
      const r = loadFeatureCompat(root, 'mid', Date.now());
      assertTrue(!r.enabled && r.parseAdvisory?.id === 'compat_invalid_exempt_pattern', '无效通配');
    },
  },
  {
    name: 'applyCompatDowngrade：合法 compat → BLOCKER FAIL 降为 MINOR WARN',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-'));
      writeCompat(
        root,
        'f',
        [
          'schema_version: "1.0"',
          'feature: f',
          'exempt_checks: ["ctx_*"]',
          'reason: "legacy"',
          'scheduled_backfill_by: "2099-06-01"',
        ].join('\n'),
      );
      const base = [blockerFail('ctx_gate')];
      const { results, stats } = applyCompatDowngrade(base, { feature: 'f', phase: 'spec', projectRoot: root }, Date.UTC(2098, 0, 1));
      assertEq(stats.appliedIds, ['ctx_gate'], 'appliedIds');
      const row = results.find(x => x.id === 'ctx_gate');
      assertTrue(!!row, 'row exists');
      assertEq(row!.severity, 'MINOR', 'severity');
      assertEq(row!.status, 'WARN', 'status');
      assertTrue(
        (row!.details ?? '').includes('[compat_downgraded by doc/features/f/compat.yaml]'),
        'details marker',
      );
      assertTrue(!verdictFail(results), 'verdict PASS');
    },
  },
  {
    name: 'applyCompatDowngrade：通配 context_exploration_* 命中多条',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-'));
      writeCompat(
        root,
        'g',
        [
          'schema_version: "1.0"',
          'feature: g',
          'exempt_checks: ["context_exploration_*"]',
          'reason: "legacy"',
          'scheduled_backfill_by: "2099-06-01"',
        ].join('\n'),
      );
      const base = [blockerFail('context_exploration_a'), blockerFail('context_exploration_b')];
      const { stats } = applyCompatDowngrade(base, { feature: 'g', phase: 'spec', projectRoot: root });
      assertEq(stats.appliedIds.length, 2, 'len');
      assertTrue(!stats.expiredFired, '未过期');
    },
  },
  {
    name: 'applyCompatDowngrade：过期 → 注入 compat_expired + 不降级',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-'));
      writeCompat(
        root,
        'exp',
        [
          'schema_version: "1.0"',
          'feature: exp',
          'exempt_checks: ["z_*"]',
          'reason: "legacy"',
          'scheduled_backfill_by: "2020-01-01"',
        ].join('\n'),
      );
      const base = [blockerFail('z_miss')];
      const now = Date.UTC(2030, 0, 1);
      const { results, stats } = applyCompatDowngrade(base, { feature: 'exp', phase: 'spec', projectRoot: root }, now);
      assertTrue(stats.expiredFired, '应触发 expired');
      assertEq(stats.appliedIds.length, 0, 'no downgrade');
      const z = results.find(x => x.id === 'z_miss');
      assertTrue(!!z && z.status === 'FAIL' && z.severity === 'BLOCKER', 'still FAIL');
      const ex = results.find(x => x.id === 'compat_expired');
      assertTrue(!!ex && ex.status === 'FAIL', 'compat_expired row');
      assertTrue(verdictFail(results), '过期应 FAIL verdict');
    },
  },
  {
    name: 'applyCompatDowngrade：phases 限定不匹配 → 不降',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-'));
      writeCompat(
        root,
        'ph',
        [
          'schema_version: "1.0"',
          'feature: ph',
          'exempt_checks: ["a_*"]',
          'reason: "x"',
          'scheduled_backfill_by: "2099-06-01"',
          'phases:',
          '  - design',
        ].join('\n'),
      );
      const base = [blockerFail('a_x')];
      const { stats, results } = applyCompatDowngrade(base, { feature: 'ph', phase: 'spec', projectRoot: root });
      assertEq(stats.appliedIds.length, 0, 'prd 不应命中');
      const row = results.find(x => x.id === 'a_x');
      assertTrue(!!row && row.status === 'FAIL', '仍为 FAIL');
    },
  },
  {
    name: 'applyCompatDowngrade：phase=catalog（全局）短路，不读 compat',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-'));
      writeCompat(
        root,
        'real',
        [
          'schema_version: "1.0"',
          'feature: real',
          'exempt_checks: ["q_*"]',
          'reason: "x"',
          'scheduled_backfill_by: "2099-06-01"',
        ].join('\n'),
      );
      const base = [blockerFail('q_x')];
      const { stats, results } = applyCompatDowngrade(base, {
        feature: 'real',
        phase: 'catalog',
        projectRoot: root,
      });
      assertEq(stats.appliedIds.length, 0, 'global shortcircuit: appliedIds');
      assertEq(results.length, base.length, 'global shortcircuit: length');
      const row = results.find(x => x.id === 'q_x');
      assertTrue(!!row && row.status === 'FAIL' && row.severity === 'BLOCKER', '短路后仍存在 BLOCKER FAIL');
    },
  },
  {
    name: 'applyCompatDowngrade：解析失败 → 追加 advisory，原样保留输入',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-'));
      writeCompat(root, 'bad', '[ : x');
      const base = [blockerFail('keep_me')];
      const { results, stats } = applyCompatDowngrade(base, { feature: 'bad', phase: 'spec', projectRoot: root });
      assertEq(stats.appliedIds.length, 0, 'yaml fail: stats');
      assertTrue(results.some(r => r.id === 'compat_yaml_parse'), '应有 compat_yaml_parse');
      const k = results.find(r => r.id === 'keep_me');
      assertTrue(!!k && k.status === 'FAIL' && k.severity === 'BLOCKER', '原 BLOCKER 保留');
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      out.push({ name: c.name, ok: true });
    } catch (e) {
      out.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return out;
}
