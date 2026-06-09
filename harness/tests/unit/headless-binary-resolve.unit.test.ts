// headless-binary-resolve.unit.test.ts

import assert from 'assert';
import {
  cursorHeadlessPlan,
  defaultHeadlessInvokePlan,
  CURSOR_HEADLESS_BINARY_CANDIDATES,
  injectPromptIntoArgv,
  PROMPT_ARGV_SENTINEL,
} from '../../scripts/utils/agent-invoke';
import {
  crossSpawnAvailable,
  headlessBinarySpawnable,
  shouldUseCrossSpawn,
} from '../../scripts/utils/headless-binary-resolve';
import type { UnitCaseResult } from '../run-unit';

const unattended = {
  write_mode: 'workspace-write' as const,
  approval_mode: 'never' as const,
  max_turns: 20,
  timeout_seconds: 3600,
};

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'cursorHeadlessPlan: positional prompt + --force --trust',
    run: () => {
      const prompt = 'hello\nworld "quoted"';
      const plan = cursorHeadlessPlan(unattended, prompt, {
        path: 'C:\\bin\\cursor-agent.exe',
        kind: 'exe',
      });
      assert.strictEqual(plan.useStdin, undefined);
      assert.strictEqual(plan.argv[plan.argv.length - 1], prompt);
      assert.deepStrictEqual(plan.argv.slice(0, -1), [
        'C:\\bin\\cursor-agent.exe',
        '-p',
        '--force',
        '--trust',
      ]);
    },
  },
  {
    name: 'cursorHeadlessPlan: on-request approval omits --force --trust',
    run: () => {
      const plan = cursorHeadlessPlan(
        { ...unattended, approval_mode: 'on-request' },
        'x',
        { path: '/usr/bin/agent', kind: 'bare' },
      );
      assert.deepStrictEqual(plan.argv, ['/usr/bin/agent', '-p', 'x']);
    },
  },
  {
    name: 'cursorHeadlessPlan: win32 .cmd uses cross-spawn when available',
    run: () => {
      const plan = cursorHeadlessPlan(unattended, 'p', {
        path: 'C:\\x\\agent.cmd',
        kind: 'cmd',
      });
      if (process.platform === 'win32' && crossSpawnAvailable()) {
        assert.strictEqual(plan.useCrossSpawn, true);
      }
    },
  },
  {
    name: 'defaultHeadlessInvokePlan: cursor positional not cursor agent --print',
    run: () => {
      const plan = defaultHeadlessInvokePlan('cursor', unattended, 'prompt body');
      assert.ok(!plan.useStdin, 'no stdin');
      assert.strictEqual(plan.argv[plan.argv.length - 1], 'prompt body');
      assert.ok(!plan.argv.includes('--print'), plan.argv.join(' '));
      assert.ok(
        plan.argv[0] === 'cursor-agent' || plan.argv.includes('-p'),
        plan.argv.join(' '),
      );
    },
  },
  {
    name: 'CURSOR_HEADLESS_BINARY_CANDIDATES: cursor-agent before agent',
    run: () => {
      assert.deepStrictEqual(CURSOR_HEADLESS_BINARY_CANDIDATES, ['cursor-agent', 'agent']);
    },
  },
  {
    name: 'injectPromptIntoArgv: multiline prompt stays single argv element',
    run: () => {
      const prompt = 'line1\nline2 `code` & |';
      const argv = injectPromptIntoArgv(['agent', '-p', PROMPT_ARGV_SENTINEL], prompt);
      assert.strictEqual(argv[2], prompt);
    },
  },
  {
    name: 'headlessBinarySpawnable: win32 .cmd spawnable when cross-spawn installed',
    run: () => {
      if (process.platform !== 'win32') return;
      const cmd = { path: 'C:\\x\\agent.cmd', kind: 'cmd' as const };
      if (crossSpawnAvailable()) {
        assert.strictEqual(headlessBinarySpawnable(cmd), true);
        assert.strictEqual(shouldUseCrossSpawn(cmd), true);
      }
      assert.strictEqual(
        headlessBinarySpawnable({ path: 'C:\\x\\cursor-agent.exe', kind: 'exe' }),
        true,
      );
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

if (require.main === module) {
  const results = runAll();
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(r.ok ? `PASS ${r.name}` : `FAIL ${r.name}: ${r.error}`);
  }
  process.exit(failed.length > 0 ? 1 : 0);
}
