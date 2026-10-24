import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  loadGoalCapability,
  routeGoalCapability,
} from '../../scripts/utils/goal-adapter-capability';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function fixture(source?: string): { root: string; adapter: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-adapter-routing-'));
  const adapter = 'fixture';
  if (source !== undefined) {
    const dir = path.join(root, 'agents', adapter);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'adapter.yaml'), source, 'utf8');
  }
  return { root, adapter };
}

interface TestCase { name: string; run: () => void }

const cases: TestCase[] = [
  {
    name: 'missing capability: both transports report a real configuration gap',
    run: () => {
      const env = fixture('name: fixture\n');
      const loaded = loadGoalCapability(env.root, env.adapter);
      assert(routeGoalCapability(loaded, 'attended').kind === 'halt', 'attended configuration gap');
      assert(routeGoalCapability(loaded, 'unattended').kind === 'halt', 'unattended fail closed');
    },
  },
  {
    name: 'handoff without resume is invalid',
    run: () => {
      const env = fixture([
        'goal_capability:',
        '  mode: external_runner',
        '  supports_resume: false',
        '  handoff: bidirectional',
        '  external_runner:',
        '    headless_invoke: tool run',
      ].join('\n'));
      const loaded = loadGoalCapability(env.root, env.adapter);
      assert(!loaded.valid, 'handoff without resume must fail');
      assert(loaded.issues.some((issue) => issue.includes('supports_resume')), 'actionable issue');
    },
  },
  {
    name: 'attended capability does not require phase isolation',
    run: () => {
      const env = fixture([
        'goal_capability:',
        '  mode: native_goal',
        '  in_session_reconcile: true',
        '  phase_context_isolation: false',
      ].join('\n'));
      assert(routeGoalCapability(loadGoalCapability(env.root, env.adapter), 'attended').kind === 'in_session', 'in-session route');
    },
  },
  {
    name: 'all eight command adapters share handoff without claiming isolation or native resume',
    run: () => {
      const frameworkRoot = path.resolve(__dirname, '../../..');
      for (const adapter of ['claude', 'codex', 'cursor', 'codeagent', 'opencode', 'chrys', 'generic', 'deepseek-harness']) {
        const loaded = loadGoalCapability(frameworkRoot, adapter);
        assert(loaded.valid, `${adapter}: ${loaded.issues.join(', ')}`);
        assert(routeGoalCapability(loaded, 'attended').kind === 'in_session', `${adapter}: shared handoff`);
        if (adapter !== 'claude' && adapter !== 'codex') {
          assert(loaded.capability?.phase_context_isolation === false, `${adapter}: isolation must remain truthful`);
        }
      }
    },
  },
  {
    name: 'unattended route requires existing preflight',
    run: () => {
      const env = fixture([
        'goal_capability:',
        '  mode: external_runner',
        '  external_runner:',
        '    headless_invoke: tool run',
      ].join('\n'));
      const loaded = loadGoalCapability(env.root, env.adapter);
      assert(routeGoalCapability(loaded, 'unattended').kind === 'halt', 'preflight false');
      assert(routeGoalCapability(loaded, 'unattended', { unattendedPreflightOk: true }).kind === 'external_runner', 'preflight true');
    },
  },
  {
    name: 'handoff route is fail-closed unless resume+handoff are declared',
    run: () => {
      const env = fixture([
        'goal_capability:',
        '  mode: native_goal',
        '  in_session_reconcile: true',
        '  phase_context_isolation: true',
        '  supports_resume: false',
        '  handoff: none',
      ].join('\n'));
      const route = routeGoalCapability(
        loadGoalCapability(env.root, env.adapter),
        'attended',
        { requireHandoff: true },
      );
      assert(route.kind === 'halt', 'handoff must halt');
    },
  },
];

export function runAll(): Array<{ name: string; ok: boolean; error?: string }> {
  return cases.map((testCase) => {
    try {
      testCase.run();
      return { name: testCase.name, ok: true };
    } catch (error) {
      return { name: testCase.name, ok: false, error: (error as Error).message };
    }
  });
}
