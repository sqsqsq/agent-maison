// goal-runner-hardening.unit.test.ts — P0/P1/P2 guards, locks, budget, resume

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  checkTerminalResumeGuard,
  countAgentInvokeStarts,
  resolvePhaseHarnessVerdict,
  resolveResumedBudget,
  resolveWallClockStartMs,
} from '../../scripts/utils/goal-runner-phase';
import { isGoalHeadlessEnv, MAISON_GOAL_HEADLESS_ENV } from '../../scripts/utils/phase-state';
import {
  FEATURE_LOCK_NAME,
  formatLockBlocker,
  isLockStale,
  isPidAlive,
  readLockRecord,
  releaseLock,
  tryAcquireLock,
} from '../../scripts/utils/goal-run-lock';
import { DEFAULT_SILENT_WATCHDOG_MS } from '../../scripts/utils/agent-invoke';
import {
  applyManifestCliOverrides,
  validateManifestCliOverrides,
} from '../../scripts/utils/goal-manifest-cli';
import type { GoalManifest } from '../../scripts/utils/goal-manifest';
import { killProcessTree } from '../../scripts/utils/agent-invoke';
import type { UnitCaseResult } from '../run-unit';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const cases: Array<{ name: string; run: () => void | Promise<void> }> = [
  {
    name: 'isGoalHeadlessEnv: only MAISON_GOAL_HEADLESS',
    run: () => {
      const prev = process.env[MAISON_GOAL_HEADLESS_ENV];
      const prevRunner = process.env.MAISON_GOAL_RUNNER;
      try {
        delete process.env[MAISON_GOAL_HEADLESS_ENV];
        process.env.MAISON_GOAL_RUNNER = '1';
        assert(!isGoalHeadlessEnv(), 'runner alone not headless');
        process.env[MAISON_GOAL_HEADLESS_ENV] = '1';
        assert(isGoalHeadlessEnv(), 'headless set');
      } finally {
        if (prev === undefined) delete process.env[MAISON_GOAL_HEADLESS_ENV];
        else process.env[MAISON_GOAL_HEADLESS_ENV] = prev;
        if (prevRunner === undefined) delete process.env.MAISON_GOAL_RUNNER;
        else process.env.MAISON_GOAL_RUNNER = prevRunner;
      }
    },
  },
  {
    name: 'resolvePhaseHarnessVerdict: fresh PASS + agent exit non-zero → PASS (gate on summary)',
    run: () => {
      const r = resolvePhaseHarnessVerdict({
        dryRun: false,
        agentExitCode: 1,
        harnessExitCode: 0,
        summaryBeforeMtime: 1000,
        summaryAfterMtime: 2000,
        summaryVerdict: 'PASS',
      });
      assert(r.verdict === 'PASS', r.verdict);
      assert(!r.stale_summary, 'fresh');
      assert(r.agent_failed, 'agent_failed observability');
    },
  },
  {
    name: 'resolvePhaseHarnessVerdict: stale PASS + agent exit → FAIL',
    run: () => {
      const r = resolvePhaseHarnessVerdict({
        dryRun: false,
        agentExitCode: 1,
        harnessExitCode: 0,
        summaryBeforeMtime: 2000,
        summaryAfterMtime: 2000,
        summaryVerdict: 'PASS',
      });
      assert(r.verdict === 'FAIL', r.verdict);
      assert(r.stale_summary, 'stale');
    },
  },
  {
    name: 'countAgentInvokeStarts: legacy agent_invoke + new start/end',
    run: () => {
      const n = countAgentInvokeStarts([
        { type: 'agent_invoke', phase: 'prd' },
        { type: 'agent_invoke_start', phase: 'design' },
        { type: 'agent_invoke_end', phase: 'design' },
        { type: 'agent_invoke_start', phase: 'coding' },
      ]);
      assert(n === 3, String(n));
    },
  },
  {
    name: 'resolveResumedBudget: wall clock from first run_start',
    run: () => {
      const events = [
        { type: 'run_start', ts: '2026-06-09T13:12:25.820Z' },
        { type: 'agent_invoke', phase: 'prd' },
        { type: 'run_start', ts: '2026-06-09T15:27:45.736Z' },
      ];
      const b = resolveResumedBudget(events);
      assert(b.totalTurns === 1, String(b.totalTurns));
      assert(
        b.wallClockStartMs === new Date('2026-06-09T13:12:25.820Z').getTime(),
        String(b.wallClockStartMs),
      );
    },
  },
  {
    name: 'resolveWallClockStartMs: falls back to now when no run_start',
    run: () => {
      const before = Date.now();
      const ms = resolveWallClockStartMs([]);
      assert(ms >= before && ms <= Date.now() + 5, String(ms));
    },
  },
  {
    name: 'checkTerminalResumeGuard: recent COMPLETED allows resume',
    run: () => {
      const recent = Date.now() - 60 * 1000;
      const r = checkTerminalResumeGuard({
        priorStatus: 'COMPLETED',
        lastRunEndTs: new Date(recent).toISOString(),
        cooldownMinutes: 5,
      });
      assert(r.allowed, 'non-terminal not debounced');
    },
  },
  {
    name: 'checkTerminalResumeGuard: DEFERRED refuses without force',
    run: () => {
      const old = Date.now() - 10 * 60 * 1000;
      const r = checkTerminalResumeGuard({
        priorStatus: 'DEFERRED',
        lastRunEndTs: new Date(old).toISOString(),
        forceResume: false,
        cooldownMinutes: 5,
      });
      assert(!r.allowed, 'blocked');
      assert(Boolean(r.reason?.includes('DEFERRED')), r.reason ?? 'no reason');
    },
  },
  {
    name: 'checkTerminalResumeGuard: --force-resume allows after cooldown',
    run: () => {
      const old = Date.now() - 10 * 60 * 1000;
      const r = checkTerminalResumeGuard({
        priorStatus: 'HALTED',
        lastRunEndTs: new Date(old).toISOString(),
        forceResume: true,
        cooldownMinutes: 5,
      });
      assert(r.allowed, 'allowed');
    },
  },
  {
    name: 'checkTerminalResumeGuard: --force-resume still blocked during cooldown',
    run: () => {
      const recent = Date.now() - 60 * 1000;
      const r = checkTerminalResumeGuard({
        priorStatus: 'HALTED',
        lastRunEndTs: new Date(recent).toISOString(),
        forceResume: true,
        cooldownMinutes: 5,
      });
      assert(!r.allowed, 'cooldown blocks force');
      assert(Boolean(r.reason?.includes('cooldown')), r.reason ?? 'no reason');
    },
  },
  {
    name: 'feature lock: atomic acquire + owner release',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-lock-'));
      const lockPath = path.join(dir, FEATURE_LOCK_NAME);
      const a = tryAcquireLock(lockPath, { run_id: 'run-a' });
      assert(a !== null, 'acquire a');
      const b = tryAcquireLock(lockPath, { run_id: 'run-b' });
      assert(b === null, 'blocked b');
      releaseLock(lockPath, a!.ownerId);
      const c = tryAcquireLock(lockPath, { run_id: 'run-c' });
      assert(c !== null, 'acquire c after release');
      releaseLock(lockPath, c!.ownerId);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  },
  {
    name: 'isLockStale: dead pid + old heartbeat',
    run: () => {
      const record = {
        ownerId: 'x',
        pid: 999999999,
        hostname: 'test',
        started_at: '2020-01-01T00:00:00Z',
        updated_at: '2020-01-01T00:00:00Z',
      };
      assert(isLockStale(record, 1000), 'stale');
      assert(!isPidAlive(999999999), 'pid dead');
    },
  },
  {
    name: 'tryAcquireLock: corrupt JSON lock is removed and re-acquired',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-lock-'));
      const lockPath = path.join(dir, FEATURE_LOCK_NAME);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(lockPath, '{not-json', 'utf-8');
      const rec = tryAcquireLock(lockPath, { run_id: 'after-corrupt' });
      assert(rec !== null, 'acquired after corrupt');
      releaseLock(lockPath, rec!.ownerId);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  },
  {
    name: 'formatLockBlocker: null holder message',
    run: () => {
      const msg = formatLockBlocker('/tmp/.feature.lock', null);
      assert(msg.includes('holder unknown'), msg);
    },
  },
  {
    name: 'readLockRecord: round-trip JSON',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-lock-'));
      const lockPath = path.join(dir, FEATURE_LOCK_NAME);
      const rec = tryAcquireLock(lockPath, { run_id: 'r1' });
      assert(rec !== null, 'acquired');
      const read = readLockRecord(lockPath);
      assert(read?.ownerId === rec!.ownerId, 'owner');
      releaseLock(lockPath, rec!.ownerId);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  },
  {
    name: 'killProcessTree: invalid pid no-op',
    run: async () => {
      const r = await killProcessTree(0);
      assert(!r.kill_attempted, 'no kill');
    },
  },
  {
    name: 'DEFAULT_SILENT_WATCHDOG_MS: disabled by default',
    run: () => {
      assert(DEFAULT_SILENT_WATCHDOG_MS === 0, String(DEFAULT_SILENT_WATCHDOG_MS));
    },
  },
  {
    name: 'validateManifestCliOverrides: --start without --override-start BLOCKER',
    run: () => {
      const r = validateManifestCliOverrides({
        manifest: 'm.yaml',
        start: 'coding',
        'override-end': true,
        end: 'testing',
      });
      assert(!r.ok, 'must fail');
      assert(r.ok === false && r.message.includes('--override-start'), r.ok ? '' : r.message);
    },
  },
  {
    name: 'validateManifestCliOverrides: paired overrides ok',
    run: () => {
      const r = validateManifestCliOverrides({
        manifest: 'm.yaml',
        start: 'coding',
        'override-start': true,
        end: 'testing',
        'override-end': true,
      });
      assert(r.ok, !r.ok ? r.message : 'ok');
    },
  },
  {
    name: 'applyManifestCliOverrides: only applies when flag paired',
    run: () => {
      const manifest = {
        start_phase: 'prd',
        end_phase: 'testing',
      } as GoalManifest;
      applyManifestCliOverrides(manifest, {
        start: 'coding',
        'override-end': true,
        end: 'ut',
      });
      assert(manifest.start_phase === 'prd', 'start not overridden without flag');
      assert(manifest.end_phase === 'ut', 'end overridden with flag');
    },
  },
];

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      await c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

if (require.main === module) {
  void runAll().then((results) => {
    const failed = results.filter((r) => !r.ok);
    for (const r of results) {
      console.log(r.ok ? `PASS ${r.name}` : `FAIL ${r.name}: ${r.error}`);
    }
    process.exit(failed.length > 0 ? 1 : 0);
  });
}
