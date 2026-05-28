// ============================================================================
// ut-artifact-parse.unit.test.ts — testability-audit / mock-plan 解析
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  buildMockPlanPresetIndex,
  collectDoublesMissingStrategy,
  collectMockPlanTypedIssues,
  buildMockkitVarClassMap,
  collectUnparsedHypiumWhenIssues,
  collectUtMockkitGovernanceIssues,
  extractUtMockkitTargets,
  extractYamlFencedBlocks,
  getMockPlanEntries,
  mockPlanAllowsHypiumMockkit,
  parseMockPlanFile,
  parseTestabilityAuditFile,
  TYPED_EXPR_RE,
  utFileImportsHypiumMockkit,
} from '../../scripts/utils/ut-artifact-parse';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function withTmp(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ut-artifact-'));
  try {
    fn(dir);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];

  results.push(run('extractYamlFencedBlocks 解析两个 yaml 块', () => {
    const md = 'intro\n```yaml\na: 1\n```\n\n```yaml\nb: 2\n```';
    const blocks = extractYamlFencedBlocks(md);
    assert(blocks.length === 2, `expected 2 blocks, got ${blocks.length}`);
    assert(blocks[0].includes('a: 1'), 'block0');
    assert(blocks[1].includes('b: 2'), 'block1');
  }));

  results.push(run('parseTestabilityAuditFile 支持 records 根', () => {
    withTmp(dir => {
      const p = path.join(dir, 'audit.md');
      fs.writeFileSync(
        p,
        '```yaml\nrecords:\n  - acceptance_id: AC-1\n    testability_level: L1\n    verdict: testable\n```\n',
        'utf-8',
      );
      const recs = parseTestabilityAuditFile(p);
      assert(recs.length === 1 && recs[0].acceptance_id === 'AC-1', JSON.stringify(recs));
    });
  }));

  results.push(run('parseMockPlanFile 纯 YAML', () => {
    withTmp(dir => {
      const p = path.join(dir, 'mock-plan.yaml');
      fs.writeFileSync(
        p,
        [
          'spies:',
          '  - target_class: HomeRepository',
          '    methods:',
          '      - name: getServiceEntries',
          '        presets:',
          '          - id: default_entries',
          '            returns: { ts_expr: "[] as ServiceEntry[]" }',
        ].join('\n'),
        'utf-8',
      );
      const plan = parseMockPlanFile(p);
      assert(!!plan?.spies?.[0], 'spies');
      const idx = buildMockPlanPresetIndex(plan!);
      const set = idx.get('HomeRepository::getServiceEntries');
      assert(!!set && set.has('default_entries'), 'preset index');
    });
  }));

  results.push(run('TYPED_EXPR_RE 匹配 as 与 new', () => {
    assert(TYPED_EXPR_RE.test('{ ok: true } as VerifyResult'), 'as');
    assert(TYPED_EXPR_RE.test('new BizError(\'x\')'), 'new');
    assert(!TYPED_EXPR_RE.test('{ ok: true }'), 'raw literal should fail');
  }));

  results.push(run('mockPlanAllowsHypiumMockkit doubles[]', () => {
    const plan = {
      doubles: [{
        target_class: 'DemoRepository',
        strategy: 'mockkit' as const,
        methods: [{ name: 'fetchData', presets: [{ id: 'ok', returns: { ts_expr: "'x' as string" } }] }],
      }],
    };
    assert(mockPlanAllowsHypiumMockkit(plan), 'mockkit');
    assert(getMockPlanEntries(plan).length === 1, 'entries');
  }));

  results.push(run('utFileImportsHypiumMockkit 检测 MockKit import', () => {
    const yes = "import { describe, it, MockKit, when } from '@ohos/hypium'";
    const no = "import { describe, it } from '@ohos/hypium'\n  gateway.whenValidateRequest.returns({})";
    assert(utFileImportsHypiumMockkit(yes), 'mockkit import');
    assert(!utFileImportsHypiumMockkit(no), 'spy whenXxx');
  }));

  results.push(run('utFileImportsHypiumMockkit 扫描全部 hypium import 子句', () => {
    const split = [
      "import { describe, it, expect } from '@ohos/hypium'",
      "import { MockKit, when } from '@ohos/hypium'",
    ].join('\n');
    assert(utFileImportsHypiumMockkit(split), 'second clause MockKit');
  }));

  results.push(run('doubles[] 缺 strategy 不视为 mockkit', () => {
    const plan = {
      doubles: [{ target_class: 'DemoRepository', methods: [{ name: 'fetchData', presets: [] }] }],
    };
    assert(collectDoublesMissingStrategy(plan).length === 1, 'missing strategy');
    assert(!mockPlanAllowsHypiumMockkit(plan), 'no implicit mockkit');
    assert(getMockPlanEntries(plan)[0].strategy === undefined, 'unset strategy');
  }));

  results.push(run('extractUtMockkitTargets 解析 mock/when', () => {
    const src = [
      'const repo = MockKit.mock(DemoRepository);',
      'when(DemoRepository.fetchData).returns();',
      "when(repo.save).returns('ok_data');",
    ].join('\n');
    const targets = extractUtMockkitTargets(src);
    assert(targets.some(t => t.targetClass === 'DemoRepository' && t.method === 'fetchData'), JSON.stringify(targets));
    assert(targets.some(t => t.targetClass === 'DemoRepository' && t.method === 'save'), JSON.stringify(targets));
  }));

  results.push(run('collectUtMockkitGovernanceIssues 拦截未登记边界', () => {
    const plan = {
      doubles: [{
        target_class: 'DemoRepository',
        strategy: 'mockkit' as const,
        methods: [{ name: 'fetchData', presets: [{ id: 'ok_data', returns: { ts_expr: "'x' as string" } }] }],
      }],
    };
    const ut = 'MockKit.mock(OrphanGateway); when(OrphanGateway.call).returns();';
    const issues = collectUtMockkitGovernanceIssues(ut, plan, new Set());
    assert(issues.some(i => i.includes('OrphanGateway')), JSON.stringify(issues));
  }));

  results.push(run('buildMockkitVarClassMap 支持 new MockKit + kit.mock', () => {
    const src = [
      'const kit = new MockKit();',
      'const repo = kit.mock(DemoRepository);',
      'when(repo.fetchData(arg)).returns();',
    ].join('\n');
    const map = buildMockkitVarClassMap(src);
    assert(map.get('repo') === 'DemoRepository', JSON.stringify([...map.entries()]));
    const targets = extractUtMockkitTargets(src);
    assert(targets.some(t => t.targetClass === 'DemoRepository' && t.method === 'fetchData'), JSON.stringify(targets));
  }));

  results.push(run('buildMockkitVarClassMap 支持显式类型注解', () => {
    const src = [
      'const kit: MockKit = new MockKit();',
      'const repo: DemoRepository = kit.mock(DemoRepository);',
      "when(repo.fetchData(arg)).returns('ok_data');",
    ].join('\n');
    const map = buildMockkitVarClassMap(src);
    assert(map.get('repo') === 'DemoRepository', JSON.stringify([...map.entries()]));
    assert(collectUnparsedHypiumWhenIssues(src, map).length === 0, 'typed when with args');
  }));

  results.push(run('collectUtMockkitGovernanceIssues 接受 when(method(args))', () => {
    const plan = {
      doubles: [{
        target_class: 'DemoRepository',
        strategy: 'mockkit' as const,
        methods: [{ name: 'fetchData', presets: [{ id: 'ok_data', returns: { ts_expr: "'x' as string" } }] }],
      }],
    };
    const ut = [
      'const kit: MockKit = new MockKit();',
      'const repo: DemoRepository = kit.mock(DemoRepository);',
      "when(repo.fetchData(arg)).returns('ok_data');",
    ].join('\n');
    const issues = collectUtMockkitGovernanceIssues(ut, plan, new Set());
    assert(issues.length === 0, JSON.stringify(issues));
  }));

  results.push(run('collectUnparsedHypiumWhenIssues 拦截无法解析的 when', () => {
    const ut = "when(unknownExpr).returns('ok_data');";
    const issues = collectUnparsedHypiumWhenIssues(ut, new Map());
    assert(issues.length === 1, JSON.stringify(issues));
  }));

  results.push(run('collectUtMockkitGovernanceIssues 禁止 mock entry_point', () => {
    const plan = {
      doubles: [{
        target_class: 'TaskFlow',
        strategy: 'mockkit' as const,
        methods: [{ name: 'run', presets: [{ id: 'ok', returns: { ts_expr: 'true as boolean' } }] }],
      }],
    };
    const ut = 'MockKit.mock(TaskFlow);';
    const issues = collectUtMockkitGovernanceIssues(ut, plan, new Set(['TaskFlow']));
    assert(issues.some(i => i.includes('entry_point')), JSON.stringify(issues));
  }));

  results.push(run('collectMockPlanTypedIssues 拦截缺失 ts_expr 的 preset', () => {
    const issues = collectMockPlanTypedIssues({
      spies: [{
        target_class: 'HomeRepository',
        methods: [{ name: 'getServiceEntries', presets: [{ id: 'missing_expr' }] }],
      }],
    });
    assert(issues.length === 1, JSON.stringify(issues));
    assert(issues[0].includes('returns.ts_expr 或 throws.ts_expr'), issues[0]);
  }));

  results.push(run('collectMockPlanTypedIssues 接受 returns 与 throws 类型化表达式', () => {
    const issues = collectMockPlanTypedIssues({
      spies: [{
        target_class: 'CardCloudApi',
        methods: [{
          name: 'verifyCard',
          presets: [
            { id: 'success', returns: { ts_expr: "{ ok: true } as VerifyResult" } },
            { id: 'error_sms', throws: { ts_expr: "new BizError('SMS_ERR')" } },
          ],
        }],
      }],
    });
    assert(issues.length === 0, JSON.stringify(issues));
  }));

  return results;
}

function run(name: string, fn: () => void): UnitCaseResult {
  try {
    fn();
    return { name, ok: true };
  } catch (e) {
    return { name, ok: false, error: (e as Error).message };
  }
}

if (require.main === module) {
  const all = runAll();
  for (const r of all) console.log(r.ok ? `PASS ${r.name}` : `FAIL ${r.name}\n${r.error}`);
  process.exit(all.some(x => !x.ok) ? 1 : 0);
}
