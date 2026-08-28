import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  buildGoalManifestFromInput,
} from '../../scripts/utils/goal-manifest';
import { createGoalRun } from '../../scripts/utils/goal-run-creation';
import {
  findUnauthorizedContractFileReferences,
  resolveContractFileReferences,
} from '../../scripts/utils/contract-reference-closure';
import { checkGoalReconcileBoundarySource } from '../../scripts/utils/goal-reconcile-boundary';
import type { ContractsSpec } from '../../scripts/utils/types';

export interface UnitCaseResult { name: string; ok: boolean; error?: string }
interface Case { name: string; run: () => void }

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPTS_ROOT = path.join(REPO_ROOT, 'harness', 'scripts');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function readScript(relativePath: string): string {
  return fs.readFileSync(path.join(SCRIPTS_ROOT, ...relativePath.split('/')), 'utf8');
}

function productionTypeScriptFiles(root = SCRIPTS_ROOT): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(absolute);
    }
  };
  walk(root);
  return files.sort();
}

function occurrences(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

function minimalContracts(files: string[], mediaPath?: string): ContractsSpec {
  return {
    feature: 'demo',
    source: 'unit',
    version: '1.0',
    modules: [],
    module_dependencies: {},
    data_models: [],
    interfaces: [],
    components: [],
    files,
    ...(mediaPath
      ? {
          resource_keys: {
            Demo: {
              media: [{ key: 'logo', value: 'app.media.logo', path: mediaPath }],
            },
          },
        }
      : {}),
  };
}

const cases: Case[] = [
  {
    name: 'structural 01/13: fresh creation transaction entry is unique',
    run: () => {
      const definitions = productionTypeScriptFiles().flatMap(file => {
        const count = occurrences(fs.readFileSync(file, 'utf8'), /export function createGoalRun\s*\(/g);
        return Array.from({ length: count }, () => path.relative(REPO_ROOT, file).replace(/\\/g, '/'));
      });
      assert(definitions.length === 1, `fresh create definitions=${JSON.stringify(definitions)}`);
      assert(definitions[0] === 'harness/scripts/utils/goal-run-creation.ts', `wrong create entry: ${definitions[0]}`);
    },
  },
  {
    name: 'structural 02/13: each fresh run can publish exactly one run_created event',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-structural-birth-'));
      try {
        const manifest = buildGoalManifestFromInput({
          feature: 'demo',
          run_id: 'structural-run',
          start_phase: 'spec',
          end_phase: 'plan',
          unattended: { write_mode: 'full-access', approval_mode: 'never' },
        }, { projectRoot: root });
        const created = createGoalRun({ projectRoot: root, manifest, chain: ['spec', 'plan'] });
        const createdEvents = fs.readFileSync(created.eventsPath, 'utf8')
          .trim()
          .split(/\r?\n/)
          .map(line => JSON.parse(line) as { type?: string })
          .filter(event => event.type === 'run_created');
        assert(createdEvents.length === 1, `run_created count=${createdEvents.length}`);
        let rejected = false;
        try { createGoalRun({ projectRoot: root, manifest, chain: ['spec', 'plan'] }); }
        catch { rejected = true; }
        assert(rejected, 'second fresh transaction was not rejected');
        assert(fs.readFileSync(created.eventsPath, 'utf8').trim().split(/\r?\n/).length === 1,
          'rejected transaction changed the birth ledger');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'structural 03/13: canonical lifecycle authority and gate call edges have one owner',
    run: () => {
      const files = productionTypeScriptFiles();
      const runtimeDefinitions = files.flatMap(file => {
        const source = fs.readFileSync(file, 'utf8');
        const count = occurrences(source, /export class GoalPhaseRuntime\b/g);
        return Array.from({ length: count }, () => path.relative(REPO_ROOT, file).replace(/\\/g, '/'));
      });
      assert(JSON.stringify(runtimeDefinitions) === JSON.stringify(['harness/scripts/goal-phase-runtime.ts']),
        `GoalPhaseRuntime definitions=${JSON.stringify(runtimeDefinitions)}`);

      const harnessGateCallers = files.flatMap(file => {
        const source = fs.readFileSync(file, 'utf8');
        const calls = occurrences(source, /\brunHarnessPhase\s*\(/g) -
          occurrences(source, /(?:async\s+)?function\s+runHarnessPhase\s*\(/g);
        return Array.from({ length: Math.max(0, calls) }, () =>
          path.relative(REPO_ROOT, file).replace(/\\/g, '/'));
      });
      assert(harnessGateCallers.length > 0 &&
        harnessGateCallers.every(file => file === 'harness/scripts/goal-phase-runtime.ts'),
      `runHarnessPhase callers=${JSON.stringify(harnessGateCallers)}`);

      const handoffTransitionCallers = files.flatMap(file => {
        const source = fs.readFileSync(file, 'utf8');
        const calls = occurrences(source, /\bconsumeHandoffAtBoundary\s*\(/g) -
          occurrences(source, /export function consumeHandoffAtBoundary\s*\(/g);
        return Array.from({ length: Math.max(0, calls) }, () =>
          path.relative(REPO_ROOT, file).replace(/\\/g, '/'));
      });
      assert(JSON.stringify(handoffTransitionCallers) === JSON.stringify(['harness/scripts/goal-phase-runtime.ts']),
        `handoff transition callers=${JSON.stringify(handoffTransitionCallers)}`);
    },
  },
  {
    name: 'structural 04/13: modern goal baseline is manifest-only, immutable and has no补锚 path',
    run: () => {
      const baseline = readScript('utils/goal-run-baseline.ts');
      const birth = readScript('utils/goal-run-creation.ts');
      const runtime = readScript('goal-phase-runtime.ts');
      assert(/creation\.state === 'complete'[\s\S]*manifest\.run_base_sha/.test(baseline),
        'modern baseline does not resolve from manifest.run_base_sha');
      assert(/if \(creation\.state !== 'legacy'\)[\s\S]*const legacy = readCodingBase/.test(baseline),
        'legacy reader is not guarded by the pre-run_created era boundary');
      assert(!/process\.env|HARNESS_DIFF_BASE_REF|trace\.start_commit|rev-parse|resolveGoalRunHeadSha/.test(baseline),
        'baseline resolver retained env/trace/bare-HEAD补锚');
      assert(/run_base_sha[^\n]*write-once|write-once[^\n]*run_base_sha/i.test(`${birth}\n${runtime}`),
        'write-once baseline defense is no longer explicit');
    },
  },
  {
    name: 'structural 05/13: lifecycle state transitions have events as their sole authority',
    run: () => {
      const runtime = readScript('goal-phase-runtime.ts');
      const executor = readScript('utils/goal-phase-executor.ts');
      assert(checkGoalReconcileBoundarySource(runtime).length === 0,
        checkGoalReconcileBoundarySource(runtime).join('; '));
      assert(runtime.includes('createGoalReconcileBoundary') && runtime.includes('loadEventsJsonl'),
        'runtime no longer writes and replays the authoritative event ledger');
      assert(!/phase_verdict|phase_backtrack_requested|phase_halt/.test(executor),
        'executor acquired lifecycle transition authority');
      assert(!/goal-state\.json|phase-lifecycle-state\.json/.test(runtime),
        'a second persisted lifecycle authority was introduced');
    },
  },
  {
    name: 'structural 06/13: contracts.files is the only file-authorization source',
    run: () => {
      const closure = readScript('utils/contract-reference-closure.ts');
      assert(occurrences(closure, /authorizedFiles\.push\(/g) === 1,
        'file authorization has more than one producer');
      assert(/\(contracts\.files \?\? \[\]\)\.forEach[\s\S]*authorizedFiles\.push/.test(closure),
        'authorized file producer is not rooted in contracts.files');
      assert(!/authorizedFiles\.(?:push|concat)[^\n]*(?:resource|media|asset|reference)/i.test(closure),
        'referenced assets can mutate the authorization set');
    },
  },
  {
    name: 'structural 07/13: off-repo coding-base production paths are zero',
    run: () => {
      const calls = productionTypeScriptFiles().flatMap(file => {
        const source = fs.readFileSync(file, 'utf8');
        const count = occurrences(source, /recordCodingBase\s*\(/g) -
          occurrences(source, /export function recordCodingBase\s*\(/g);
        return Array.from({ length: Math.max(0, count) }, () => path.relative(REPO_ROOT, file).replace(/\\/g, '/'));
      });
      assert(calls.length === 0, `recordCodingBase production calls=${JSON.stringify(calls)}`);
    },
  },
  {
    name: 'structural 08/13: old detached loop and attended independent progression are absent',
    run: () => {
      assert(!fs.existsSync(path.join(SCRIPTS_ROOT, 'goal-phase-runtime-process.ts')),
        'old detached runtime file regrew');
      const runner = readScript('goal-runner.ts');
      const driver = readScript('utils/goal-in-session-driver.ts');
      const host = readScript('goal-mode-entry.ts');
      assert(!/while\s*\(|for\s*\([^)]*phase|runHarnessPhase|assessFeature|phase_verdict/.test(runner),
        'goal-runner regained a private phase lifecycle');
      assert(!/while\s*\(|for\s*\(|runHarnessPhase|assessFeature|phase_verdict/.test(driver),
        'attended compatibility driver regained independent progression');
      assert(!/for\s*\(let round|runInSessionRound|assessFeature/.test(host),
        'attended host entry regained independent progression');
      const compatibility = readScript('utils/goal-phase-runtime.ts');
      assert(!/consumeHandoffAtBoundary|quiesceRunOwner|appendGoalEventFenced/.test(compatibility),
        'handoff compatibility API regained lifecycle transition authority');
    },
  },
  {
    name: 'structural 09/13: goal runtime has zero live HARNESS_DIFF_BASE_REF reads',
    run: () => {
      const baseline = readScript('utils/goal-run-baseline.ts');
      const executor = readScript('utils/goal-phase-executor.ts');
      const runtime = readScript('goal-phase-runtime.ts');
      assert(!/process\.env\s*\.\s*HARNESS_DIFF_BASE_REF|process\.env\s*\[\s*['\"]HARNESS_DIFF_BASE_REF/.test(
        `${baseline}\n${executor}\n${runtime}`,
      ), 'goal runtime reads the live diff-base env value');
      assert(executor.includes('HARNESS_DIFF_BASE_REF') && runtime.includes("deleteEnvKeyCaseInsensitive(childEnv, 'HARNESS_DIFF_BASE_REF')"),
        'goal env scrub boundary disappeared');
      const liveReaders = productionTypeScriptFiles().flatMap(file => {
        const source = fs.readFileSync(file, 'utf8');
        if (!/process\.env\s*\.\s*HARNESS_DIFF_BASE_REF|process\.env\s*\[\s*['"]HARNESS_DIFF_BASE_REF/.test(source)) {
          return [];
        }
        return [{ file: path.relative(REPO_ROOT, file).replace(/\\/g, '/'), source }];
      });
      assert(JSON.stringify(liveReaders.map(item => item.file)) === JSON.stringify([
        'harness/scripts/utils/phase-state.ts',
      ]), `unexpected live diff-base readers=${JSON.stringify(liveReaders.map(item => item.file))}`);
      for (const reader of liveReaders) {
        assert(/if \(hasGoalExecutionSignal\(\)\) return undefined;[\s\S]*process\.env\.HARNESS_DIFF_BASE_REF/.test(reader.source),
          `${reader.file} does not ignore HARNESS_DIFF_BASE_REF for every goal execution signal`);
      }
      for (const gate of ['check-coding.ts', 'check-exit.ts']) {
        assert(readScript(gate).includes('resolveHarnessDiffBaseRef()'),
          `${gate} bypasses the shared diff-base resolver`);
      }
    },
  },
  {
    name: 'structural 10/13: test-only facts and authorization-exemption registries are absent',
    run: () => {
      const surface = [
        readScript('goal-phase-runtime.ts'),
        readScript('utils/goal-phase-runtime.ts'),
        readScript('utils/contract-reference-closure.ts'),
        readScript('check-plan.ts'),
      ].join('\n');
      assert(!/(?:test|testing)[_-]?facts|facts[_-]?exemptions?|authorization[_-]?exemptions?|asset[_-]?exemptions?/i.test(surface),
        'test-only facts or authorization exemption registry was introduced');
    },
  },
  {
    name: 'structural 11/13: referenced assets receive no automatic authorization bypass',
    run: () => {
      const mediaPath = 'resources/base/media/logo.png';
      const closure = resolveContractFileReferences(REPO_ROOT, minimalContracts([], mediaPath));
      const missing = findUnauthorizedContractFileReferences(closure);
      assert(missing.length === 1 && missing[0]?.path === mediaPath,
        `undeclared asset was auto-authorized: ${JSON.stringify(missing)}`);
      const declared = resolveContractFileReferences(REPO_ROOT, minimalContracts([mediaPath], mediaPath));
      assert(findUnauthorizedContractFileReferences(declared).length === 0,
        'contracts.files declaration did not close the reference');
    },
  },
  {
    name: 'structural 12/13: executors cannot call phase gates or publish verdicts',
    run: () => {
      const executor = readScript('utils/goal-phase-executor.ts');
      assert(!/runHarnessPhase|assessFeature|tryValidateReceipt|writeReceiptScaffold|phase_verdict/.test(executor),
        'executor owns a phase gate or verdict transition');
    },
  },
  {
    name: 'structural 13/13: executor and supervisor cannot construct rebaseline management commands',
    run: () => {
      for (const relativePath of ['utils/goal-phase-executor.ts', 'goal-supervise.ts']) {
        assert(!readScript(relativePath).includes('--rebaseline-to'), `${relativePath} constructs --rebaseline-to`);
      }
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(test => {
    try {
      test.run();
      return { name: test.name, ok: true };
    } catch (error) {
      return { name: test.name, ok: false, error: (error as Error).stack ?? String(error) };
    }
  });
}
