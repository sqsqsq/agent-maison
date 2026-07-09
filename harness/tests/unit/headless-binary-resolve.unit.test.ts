// headless-binary-resolve.unit.test.ts

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  cursorHeadlessPlan,
  defaultHeadlessInvokePlan,
  CURSOR_HEADLESS_BINARY_CANDIDATES,
  injectPromptIntoArgv,
  PROMPT_ARGV_SENTINEL,
} from '../../scripts/utils/agent-invoke';
import {
  crossSpawnAvailable,
  formatHeadlessBinaryIssue,
  headlessBinarySpawnable,
  resolveHeadlessBinary,
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
    name: 'cursorHeadlessPlan: stdin prompt + --force --trust',
    run: () => {
      const prompt = 'hello\nworld "quoted"';
      const plan = cursorHeadlessPlan(unattended, prompt, {
        path: 'C:\\bin\\cursor-agent.exe',
        kind: 'exe',
      });
      assert.strictEqual(plan.useStdin, true);
      assert.strictEqual(plan.stdin, prompt);
      assert.deepStrictEqual(plan.argv, [
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
      assert.deepStrictEqual(plan.argv, ['/usr/bin/agent', '-p']);
      assert.strictEqual(plan.stdin, 'x');
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
    name: 'defaultHeadlessInvokePlan: cursor stdin prompt not --print',
    run: () => {
      const plan = defaultHeadlessInvokePlan('cursor', unattended, 'prompt body');
      assert.ok(plan.useStdin, 'stdin');
      assert.strictEqual(plan.stdin, 'prompt body');
      assert.ok(!plan.argv.includes('prompt body'), plan.argv.join(' '));
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
    name: 'resolveHeadlessBinary: known-dir fallback finds cursor-agent on Windows',
    run: () => {
      if (process.platform !== 'win32') return;
      const tmpLocal = fs.mkdtempSync(path.join(os.tmpdir(), 'knowndir-'));
      const agentDir = path.join(tmpLocal, 'cursor-agent');
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(path.join(agentDir, 'cursor-agent.cmd'), '@echo off\n');
      const origLocal = process.env.LOCALAPPDATA;
      const origPath = process.env.PATH;
      try {
        process.env.LOCALAPPDATA = tmpLocal;
        process.env.PATH = 'C:\\nonexistent';
        const result = resolveHeadlessBinary(['cursor-agent']);
        assert.ok(result, 'should resolve via known-dir');
        assert.strictEqual(result!.kind, 'cmd');
        assert.ok(result!.path.includes('cursor-agent.cmd'), result!.path);
        assert.ok(!result!.inaccessible, 'should be accessible');
      } finally {
        if (origLocal === undefined) delete process.env.LOCALAPPDATA;
        else process.env.LOCALAPPDATA = origLocal;
        process.env.PATH = origPath;
        fs.rmSync(tmpLocal, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'formatHeadlessBinaryIssue: inaccessible binary gives permission message',
    run: () => {
      const msg = formatHeadlessBinaryIssue('cursor', ['cursor-agent'], {
        path: 'C:\\Users\\x\\AppData\\Local\\cursor-agent\\cursor-agent.cmd',
        kind: 'cmd',
        inaccessible: true,
      });
      assert.ok(msg.includes('无权访问'), msg);
      assert.ok(msg.includes('EPERM'), msg);
      assert.ok(msg.includes('非沙箱'), msg);
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
