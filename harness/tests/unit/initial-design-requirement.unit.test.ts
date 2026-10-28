import '../utils/transpile-only-env';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { clearFrameworkConfigCache } from '../../config';
import { prepareGoalModeRun, runGoalModeSessionStep } from '../../scripts/goal-mode-entry';
import { buildInitialDesignGoalManifest, isInitialDesignManifest } from '../../scripts/utils/goal-manifest';
import { createGoalRun } from '../../scripts/utils/goal-run-creation';
import { currentOriginalDelivery, readOriginalDeliveryBudget } from '../../scripts/utils/delivery-origin';
import { enumerateCanonicalChangeUnits } from '../../scripts/utils/change-unit-path';
import { BLUEPRINT_ID, withFreshCuHost } from './lifecycle-evolution.unit.test';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, type UnitExecutionTiming } from '../utils/unit-case-selection';
import type { UnitCaseResult } from '../run-unit';

type Json = Record<string, any>;
type Scenario = 'completed' | 'unfinished' | 'source';
const authorization = { mode: 'goal_mode' as const, autonomyAuthorized: true };
const originalRequirement = '交付账目刷新与恢复。';
const increment = '新增要求：本地账目金额格式必须保持两位小数，并有对应验收。';

async function scenario(mode: Scenario): Promise<void> {
  await withFreshCuHost(async host => {
    const configFile = path.join(host.root, 'framework.config.json');
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    config.project_profile.name = 'hmos-app';
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
    clearFrameworkConfigCache();
    const source = path.join(host.root, 'doc/requirement.md');
    fs.writeFileSync(source, originalRequirement);
    const old = buildInitialDesignGoalManifest({ feature: BLUEPRINT_ID, run_id: 'original-request', adapter: 'claude', requirement: originalRequirement,
      ...(mode === 'source' ? { requirement_source_files: ['doc/requirement.md'] } : {}),
      budget: { max_total_turns: 20, wall_clock_minutes: 120 }, unattended: { write_mode: 'full-access', approval_mode: 'never', timeout_seconds: 900 },
      initial_design: { completion_target: 'feature', requested_results: [originalRequirement], requested_phases: ['plan', 'coding', 'review', 'ut'] } }, { projectRoot: host.root });
    const created = createGoalRun({ projectRoot: host.root, manifest: old, chain: [] });
    // This fixture supplies prior control history, not a claimed product/P3 acceptance.
    // The assertion is that no previous completion can cover this new request.
    const at = new Date(Date.now() - 600_000).toISOString();
    for (const event of [{ type: 'run_start', session_started_at: at },
      { type: 'agent_invoke_start', phase: 'initial-design-author', invoke_id: 'prior-author' },
      { type: 'agent_invoke_end', phase: 'initial-design-author', invoke_id: 'prior-author', exit_code: 0 },
      { type: 'run_end', status: mode === 'completed' ? 'COMPLETED' : 'HALTED', halt_reason: 'execution_scope_unresolved' }]) {
      fs.appendFileSync(created.eventsPath, JSON.stringify({ ...event, ts: at, run_id: old.run_id }) + '\n');
    }
    const oldManifest = fs.readFileSync(created.manifestPath);
    const oldEvents = fs.readFileSync(created.eventsPath);
    const oldUnits = enumerateCanonicalChangeUnits(host.root, BLUEPRINT_ID).map(unit => ({ path: unit.canonicalPath, bytes: fs.readFileSync(unit.canonicalPath) }));
    if (mode === 'source') fs.writeFileSync(source, `${originalRequirement}\n${increment}`);
    const requirement = mode === 'source' ? fs.readFileSync(source, 'utf8') : increment;
    const prepared = prepareGoalModeRun({ projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature: BLUEPRINT_ID, runId: `request-${mode}`,
      adapter: 'claude', requirement, ...(mode === 'source' ? { requirementSourceFiles: ['doc/requirement.md'] } : {}),
      budget: { max_total_turns: 20, wall_clock_minutes: 120 } });
    assert(isInitialDesignManifest(prepared.manifest));
    assert.notEqual(prepared.manifest.run_id, old.run_id);
    assert.equal(prepared.manifest.successor_of, old.run_id);
    assert(prepared.manifest.requirement!.includes(originalRequirement));
    assert(prepared.manifest.requirement!.includes(increment));
    const rows: Json[] = fs.readFileSync(path.join(prepared.runDir, 'events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const audit = rows.find(row => row.type === 'supersede');
    assert(audit && audit.target_run_id === old.run_id);
    assert.equal(audit.delivery_cycle_boundary, mode === 'completed' ? old.run_id : undefined);
    assert.equal(readOriginalDeliveryBudget(host.root, prepared.manifest)!.totalTurns, mode === 'completed' ? 0 : 1);
    const next = await runGoalModeSessionStep({ projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature: BLUEPRINT_ID,
      runId: prepared.manifest.run_id, adapter: 'claude', runMode: 'attended', authorization }) as Json;
    assert.equal(next.type, 'phase_execute_request', JSON.stringify(next));
    assert.equal(next.phase, 'design-repair-author', 'the old blueprint/P3 must not complete the new substantive request');
    const request: Json = JSON.parse(fs.readFileSync(next.request.path, 'utf8'));
    assert(request.context.instruction.includes(increment));
    assert(request.context.instruction.includes('仅附加来源路径'));
    assert(!fs.existsSync(path.join(prepared.runDir, 'design-repair/change-unit.yaml')), 'a blueprint-level request must not invent a CU target');
    assert(!('execution_scope' in prepared.manifest));
    assert.equal(readOriginalDeliveryBudget(host.root, prepared.manifest)!.totalTurns, mode === 'completed' ? 1 : 2);
    assert.equal(currentOriginalDelivery(host.root, old).run_id, mode === 'completed' ? old.run_id : prepared.manifest.run_id);
    const repeated = prepareGoalModeRun({ projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature: BLUEPRINT_ID,
      adapter: 'claude', requirement, ...(mode === 'source' ? { requirementSourceFiles: ['doc/requirement.md'] } : {}) });
    assert.equal(repeated.manifest.run_id, prepared.manifest.run_id);
    if (mode === 'unfinished') {
      const pendingBytes = fs.readFileSync(next.request.path);
      const runEvents = fs.readFileSync(path.join(prepared.runDir, 'events.jsonl'));
      assert.throws(() => prepareGoalModeRun({ projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature: BLUEPRINT_ID,
        adapter: 'claude', requirement: '用户再次替换目标：先处理金额格式并保留原有恢复义务。' }), /尚未报告的签发窗口[\s\S]*--report-result/);
      assert.deepEqual(fs.readFileSync(next.request.path), pendingBytes);
      assert.deepEqual(fs.readFileSync(path.join(prepared.runDir, 'events.jsonl')), runEvents);
      assert.equal(readOriginalDeliveryBudget(host.root, prepared.manifest)!.totalTurns, 2);
    }
    assert.deepEqual(fs.readFileSync(created.manifestPath), oldManifest);
    assert.deepEqual(fs.readFileSync(created.eventsPath), oldEvents);
    for (const unit of oldUnits) assert.deepEqual(fs.readFileSync(unit.path), unit.bytes);
  });
}

const cases = [
  { name: 'f3b8e6a1 requirement: completed original starts a new cycle and dispatches real blueprint design for inline work', mode: 'completed' },
  { name: 'f3b8e6a1 requirement: unfinished original correction preserves its calls and uses the union request path', mode: 'unfinished' },
  { name: 'f3b8e6a1 requirement: same source path with changed bytes still dispatches design rather than borrowing old coverage', mode: 'source' },
] as const;
export function getCases() { return cases.map(test => ({ name: test.name, run: () => scenario(test.mode) })); }
export async function runSelectedCases(filter?: string) {
  const results: UnitCaseResult[] = [], timings: UnitExecutionTiming[] = [];
  for (const test of getCases()) {
    if (!matchesUnitCase(test.name, filter)) continue;
    const finish = startCaseTiming([test.name], timings);
    try { await test.run(); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: (error as Error).stack ?? String(error) }); }
    finally { finish(); }
  }
  return selectedUnitCases(results, filter, timings);
}
export const runAll = async () => (await runSelectedCases()).results;
