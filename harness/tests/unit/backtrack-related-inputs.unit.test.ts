import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { compareBacktrackRelatedInputs, resolveBacktrackRelatedInputs, snapshotBacktrackRelatedInputs } from '../../scripts/goal-phase-runtime';
import { resolveFeatureArtifact, clearFrameworkConfigCache, featurePhaseReportsDir, receiptDirPath, featureDir } from '../../config';
import { snapshotArtifacts, type ArtifactSnapshot } from '../../scripts/utils/goal-failure-classifier';
import { collectSupersededAncestorEvents, loadAuthoritativeEvents, type GoalRunEvent } from '../../scripts/utils/goal-runner-phase';
import type { UnitCaseResult } from '../run-unit';

export function runAll(): UnitCaseResult[] {
  const cases: UnitCaseResult[] = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'related-round-'));
  const run = (name: string, body: () => void) => {
    try { body(); cases.push({ name, ok: true }); }
    catch (error) { cases.push({ name, ok: false, error: String(error) }); }
  };
  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/A.ets'), 'A');
    fs.writeFileSync(path.join(root, 'src/B.ets'), 'B');
    const A = 'src/A.ets', B = 'src/B.ets';
    const first = snapshotArtifacts(root, [A]);
    const both = snapshotArtifacts(root, [A, B]);
    const start: GoalRunEvent = { type: 'phase_start', phase: 'coding', ts: '2026-10-01T00:00:00.000Z' };
    const write: GoalRunEvent = { type: 'phase_write_observed', phase: 'coding', ts: '2026-10-01T00:01:00.000Z',
      owned: Object.entries(both).map(([path, value]) => ({ path, post_sha256: value.contentHash })) } as GoalRunEvent;
    const event = (snapshot?: unknown): GoalRunEvent => ({ type: 'phase_backtrack_requested', phase: 'testing',
      from_phase: 'testing', to_phase: 'coding', round_fingerprint: 'same-round', ts: '2026-10-01T00:02:00.000Z',
      ...(snapshot !== undefined ? { related_input_snapshot: snapshot } : {}), candidates: [{ files: [A] }], files: [A] } as GoalRunEvent);
    const compare = (previous: GoalRunEvent, current: ArtifactSnapshot, events: GoalRunEvent[] = [start, write]) =>
      compareBacktrackRelatedInputs({ projectRoot: root, feature: 'demo', runId: 'source', previous, current, events });
    run('新coding source-only owned不覆盖旧窗口修复基线，真实外部修复仍changed', () => {
      fs.writeFileSync(path.join(root, A), 'coding repair before review');
      const current = snapshotArtifacts(root, [A]);
      const added = { ...write, owned: [{ path: A, pre_sha256: first[A].contentHash, post_sha256: current[A].contentHash,
        roles: [{ kind: 'source', source: 'existing coding contract' }] }] } as GoalRunEvent;
      const previous = event();
      assert.strictEqual(compare(previous, current, [start, write, added]), compare(previous, current, [start, write]));
      assert.strictEqual(compare(previous, current, [start, write, added]), 'changed');
      fs.writeFileSync(path.join(root, A), 'external repair after stop');
      assert.strictEqual(compare(previous, snapshotArtifacts(root, [A]), [start, write, added]), 'changed');
      fs.writeFileSync(path.join(root, A), 'A');
    });

    run('同事件完整快照：未变unchanged，真实内容变更changed，mtime/notes无进展', () => {
      const previous = event(first);
      assert.strictEqual(compare(previous, snapshotArtifacts(root, [A])), 'unchanged');
      fs.utimesSync(path.join(root, A), new Date(), new Date());
      fs.writeFileSync(path.join(root, 'notes.md'), 'note change');
      assert.strictEqual(compare(previous, snapshotArtifacts(root, [A])), 'unchanged');
      fs.writeFileSync(path.join(root, A), 'fixed attempt');
      assert.strictEqual(compare(previous, snapshotArtifacts(root, [A])), 'changed');
      fs.writeFileSync(path.join(root, A), 'A');
    });
    run('当前新增/删减相关key均unknown，旧窗口恰有B也不能洗成零改动', () => {
      assert.strictEqual(compare(event(first), both), 'unknown');
      assert.strictEqual(compare(event(both), first), 'unknown');
    });
    run('混合明确A与native空files分别解析，owner/contracts的B不能漏看；未解析完整不能只用A', () => {
      const contract = resolveFeatureArtifact(root, 'demo', 'contracts.yaml').actualPath;
      fs.mkdirSync(path.dirname(contract), { recursive: true });
      fs.writeFileSync(contract, 'feature: demo\nmodules: []\nfiles:\n  - src/A.ets\n  - src/B.ets\n');
      const boundary = { projectRoot: root, feature: 'demo', phaseOrder: ['coding', 'testing'], domains: [
        { owner: 'coding', kind: 'source', match: 'prefix', path: 'src', source: 'existing owner scope' },
      ], diagnostics: [], unresolvedSourcePhases: [], protectedRoots: [] } as never;
      const candidates = [{ category: 'coding', files: [A] }, { category: 'coding', files: [] }] as never;
      const paths = resolveBacktrackRelatedInputs({ projectRoot: root, frameworkRoot: path.resolve(__dirname, '../../..'),
        feature: 'demo', candidates, targetPhase: 'coding', boundary });
      assert.deepStrictEqual(paths, [A, B]);
      const old = event(snapshotArtifacts(root, paths));
      fs.writeFileSync(path.join(root, B), 'B attempt');
      assert.strictEqual(compare(old, snapshotArtifacts(root, paths)), 'changed');
      fs.writeFileSync(path.join(root, B), 'B');
      assert.deepStrictEqual(resolveBacktrackRelatedInputs({ projectRoot: root, frameworkRoot: path.resolve(__dirname, '../../..'),
        feature: 'demo', candidates, targetPhase: 'coding', boundary: null }), []);
      assert.deepStrictEqual((candidates as unknown as Array<{ files: string[] }>)[1].files, [], 'fallback不改原身份原料');
      const legacyRef = 'doc/features/demo/device-testing/device-screenshots/visual-diff.json#screen';
      const legacy = [{ category: 'coding', files: [legacyRef] }] as never;
      assert.deepStrictEqual(resolveBacktrackRelatedInputs({ projectRoot: root, frameworkRoot: path.resolve(__dirname, '../../..'),
        feature: 'demo', candidates: legacy, targetPhase: 'coding', boundary }), [A, B]);
      assert.deepStrictEqual((legacy as unknown as Array<{ files: string[] }>)[0].files, [legacyRef], '历史证据files只读排除，不改身份');
      assert.deepStrictEqual(resolveBacktrackRelatedInputs({ projectRoot: root, frameworkRoot: path.resolve(__dirname, '../../..'),
        feature: 'demo', candidates: [{ category: 'coding', files: [A, '../escape'] }] as never, targetPhase: 'coding', boundary }), [], '真正不可解析目标不能丢弃');
      clearFrameworkConfigCache();
    });
    run('空/坏快照与无效读取hash不叫零改动；无原窗口证据时unknown', () => {
      for (const old of [{}, { [A]: { exists: true, contentHash: '' } }, { [A]: { exists: false, contentHash: 'bad' } }, 'bad', []]) {
        assert.strictEqual(compare(event(old), first, []), 'unknown');
      }
      assert.strictEqual(compare(event(first), {}), 'unknown');
    });
    run('旧事件仅原集合与旧窗口完整postSHA可补足；当前写后SHA及缺窗口不能冒充', () => {
      assert.strictEqual(compare(event(), first), 'unchanged');
      assert.strictEqual(compare(event(), first, [write]), 'unknown');
      assert.strictEqual(compare(event(), first, [start, { ...write, ts: '2026-10-01T00:03:00.000Z' }]), 'unknown');
      assert.strictEqual(compare({ ...event(), files: [], candidates: [] } as GoalRunEvent, first), 'unknown');
      assert.strictEqual(compare({ ...event(), candidates: [{ files: [A] }, { files: [] }] } as GoalRunEvent, first), 'unknown', '旧组含未解析native目标，不能靠另一候选A证明完整');
    });
    run('真实产品reports/X.ets、summary/notes/trace/log同名文件均计进展；明确files和目录摘要同判据', () => {
      fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({ paths: { features_dir: 'doc/features',
        reports_dir_pattern: 'src/runtime-output/<feature>/<phase>', receipt_dir_pattern: 'src/phase-work/<feature>/<phase>' } }));
      clearFrameworkConfigCache();
      const locations = { feature: 'demo', frameworkRoot: path.resolve(__dirname, '../../..'), targetPhase: 'coding' };
      for (const rel of ['src/pages/reports/X.ets', 'src/resources/rawfile/summary.json', 'src/resources/rawfile/notes.md',
        'src/resources/rawfile/trace.json', 'src/resources/rawfile/debug.log']) {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), 'product before');
        assert.deepStrictEqual(resolveBacktrackRelatedInputs({ projectRoot: root, ...locations,
          candidates: [{ category: 'coding', files: [rel] }] as never, boundary: null }), [rel]);
        const previous = event(snapshotBacktrackRelatedInputs(root, ['src'], locations));
        fs.writeFileSync(path.join(root, rel), 'actual product change');
        assert.strictEqual(compare(previous, snapshotBacktrackRelatedInputs(root, ['src'], locations)), 'changed', rel);
      }
    });
    run('仅配置/解析的实际过程位置排除：自定义报告、phase notes、run和截图输出变化unchanged；通用摘要不变', () => {
      const locations = { feature: 'demo', frameworkRoot: path.resolve(__dirname, '../../..'), targetPhase: 'coding' };
      const paths = resolveBacktrackRelatedInputs({ projectRoot: root, frameworkRoot: path.resolve(__dirname, '../../..'),
        feature: 'demo', candidates: [{ category: 'coding', files: ['src', 'doc/features/demo'] }] as never, targetPhase: 'coding', boundary: null });
      const previous = event(snapshotBacktrackRelatedInputs(root, paths, locations));
      const generic = snapshotArtifacts(root, paths);
      assert.strictEqual(compare(previous, snapshotBacktrackRelatedInputs(root, paths, locations)), 'unchanged');
      const report = featurePhaseReportsDir(root, 'demo', 'coding', locations.frameworkRoot);
      const processFiles = ['trace.json', 'debug.log', 'summary.json', 'script-report.json', 'diagnosis.json'].map(file => path.join(report, file));
      processFiles.push(path.join(receiptDirPath(root, 'demo', 'coding'), 'notes.md'),
        path.join(featureDir(root, 'demo'), 'goal-runs/r/events.jsonl'),
        path.join(featureDir(root, 'demo'), 'device-testing/device-screenshots/visual-diff.json'));
      for (const file of processFiles) {
        fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'known process update');
        assert.deepStrictEqual(resolveBacktrackRelatedInputs({ projectRoot: root, ...locations,
          candidates: [{ category: 'coding', files: [file] }] as never, boundary: null }), [], file);
      }
      assert.strictEqual(compare(previous, snapshotBacktrackRelatedInputs(root, paths, locations)), 'unchanged');
      assert.notDeepStrictEqual(snapshotArtifacts(root, paths), generic, '其它消费者默认摘要仍包含这些文件');
      fs.writeFileSync(path.join(root, B), 'B changed');
      assert.strictEqual(compare(previous, snapshotBacktrackRelatedInputs(root, paths, locations)), 'changed');
      fs.writeFileSync(path.join(root, B), 'B');
      const plan = path.join(featurePhaseReportsDir(root, 'demo', 'testing', locations.frameworkRoot), 'hylyre/test-plan.hylyre.md');
      assert.deepStrictEqual(resolveBacktrackRelatedInputs({ projectRoot: root, ...locations, targetPhase: 'testing',
        candidates: [{ category: 'verification', files: [plan] }] as never, boundary: null }), [path.relative(root, plan).replace(/\\/g, '/')]);
    });
    run('事件落盘→resume与ancestor/successor读取保持同一旧快照和结论', () => {
      const sourceDir = path.join(root, 'doc/features/demo/goal-runs/source');
      fs.mkdirSync(sourceDir, { recursive: true });
      fs.writeFileSync(path.join(sourceDir, 'events.jsonl'), [start, write, event(first)].map(e => JSON.stringify(e)).join('\n') + '\n');
      const resumed = loadAuthoritativeEvents(path.join(sourceDir, 'events.jsonl'));
      const inherited = collectSupersededAncestorEvents({ projectRoot: root, featuresDir: 'doc/features', feature: 'demo', seedTargets: ['source'] });
      const old = (events: GoalRunEvent[]) => events.find(e => e.type === 'phase_backtrack_requested')!;
      assert.deepStrictEqual(old(resumed).related_input_snapshot, first);
      assert.deepStrictEqual(old(inherited).related_input_snapshot, first);
      assert.strictEqual(compare(old(resumed), first, resumed), 'unchanged');
      assert.strictEqual(compare(old(inherited), first, inherited), 'unchanged');
      fs.writeFileSync(path.join(root, A), 'later attempted');
      assert.strictEqual(compare(old(resumed), snapshotArtifacts(root, [A]), resumed), 'changed');
      assert.strictEqual(compare(old(inherited), snapshotArtifacts(root, [A]), inherited), 'changed');
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  return cases;
}
