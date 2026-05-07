// ============================================================================
// ut-artifact-parse.unit.test.ts — testability-audit / mock-plan 解析
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  buildMockPlanPresetIndex,
  collectMockPlanTypedIssues,
  extractYamlFencedBlocks,
  parseMockPlanFile,
  parseTestabilityAuditFile,
  TYPED_EXPR_RE,
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
