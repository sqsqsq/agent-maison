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

function withDshInstall(run: (root: string, record: string, shim: string) => void, prefix = 'dsh-install space-'): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const shim = path.join(root, 'resources/runtime/cli/bin/dsh.cmd');
  fs.mkdirSync(path.dirname(shim), { recursive: true });
  fs.writeFileSync(shim, '@echo off\n');
  const record = JSON.stringify([{ DisplayName: 'DeepSeek Harness 0.2.1-rc.2', InstallLocation: root }]);
  const saved = { PATH: process.env.PATH, LOCALAPPDATA: process.env.LOCALAPPDATA };
  try {
    process.env.PATH = path.join(root, 'empty');
    process.env.LOCALAPPDATA = root;
    run(root, record, shim);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'DSH 安装记录：中文 InstallLocation 指向存在的中文目录和 dsh.cmd',
    run: () => {
      if (process.platform !== 'win32') return;
      withDshInstall((_root, record, shim) => {
        assert(record.includes('中文用户'));
        const found = resolveHeadlessBinary(['dsh'], { readUninstallRegistry: () => record });
        assert.strictEqual(found?.path, shim);
        assert.strictEqual(found?.kind, 'cmd');
      }, 'dsh-中文用户 安装目录-');
    },
  },
  {
    name: 'DSH 安装记录：PATH 命中优先，不读取注册表',
    run: () => {
      if (process.platform !== 'win32') return;
      withDshInstall((_root, _record, shim) => {
        process.env.PATH = path.dirname(shim);
        let reads = 0;
        const found = resolveHeadlessBinary(['dsh'], { readUninstallRegistry: () => {
          reads++; return null;
        } });
        assert.strictEqual(found?.path, shim);
        assert.strictEqual(reads, 0);
      });
    },
  },
  {
    name: 'DSH 安装记录：PATH 未命中，HKCU 优先；HKCU 失败可回落 HKLM',
    run: () => {
      if (process.platform !== 'win32') return;
      withDshInstall((_root, record, shim) => {
        const calls: string[] = [];
        const found = resolveHeadlessBinary(['dsh'], { readUninstallRegistry: hive => {
          calls.push(hive); return record;
        } });
        assert.strictEqual(found?.path, shim);
        assert.strictEqual(found?.kind, 'cmd');
        assert.deepStrictEqual(calls, ['HKCU']);
        const machine = resolveHeadlessBinary(['dsh'], { readUninstallRegistry: hive => {
          if (hive === 'HKCU') throw new Error('unavailable');
          return record;
        } });
        assert.strictEqual(machine?.path, shim);
        let reads = 0;
        assert.strictEqual(resolveHeadlessBinary(['another-cli'], { readUninstallRegistry: () => {
          reads++; return null;
        } }), null);
        assert.strictEqual(reads, 0);
      });
    },
  },
  {
    name: 'DSH 安装记录：DisplayName 必须匹配同一记录，文件不存在回到菜单提示',
    run: () => {
      if (process.platform !== 'win32') return;
      withDshInstall((_root, record, shim) => {
        const unrelated = JSON.parse(record).map((row: Record<string, string>) => ({ ...row, DisplayName: 'Other App' }));
        const split = JSON.stringify([{ DisplayName: 'DeepSeek Harness' }, ...unrelated]);
        assert.strictEqual(resolveHeadlessBinary(['dsh'], { readUninstallRegistry: () => split }), null);
        assert.strictEqual(resolveHeadlessBinary(['dsh'], { readUninstallRegistry: () => '{invalid-json' }), null);
        fs.unlinkSync(shim);
        const missing = resolveHeadlessBinary(['dsh'], { readUninstallRegistry: () => record });
        assert.strictEqual(missing, null);
        assert(formatHeadlessBinaryIssue('deepseek-harness', ['dsh'], missing).includes('管理 dsh 命令'));
      });
    },
  },
  {
    name: 'DSH 安装记录：非 Windows 不查注册表',
    run: () => {
      const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
      try {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        withDshInstall(() => {
          let reads = 0;
          assert.strictEqual(resolveHeadlessBinary(['dsh'], { readUninstallRegistry: () => {
            reads++; return null;
          } }), null);
          assert.strictEqual(reads, 0);
        });
      } finally { Object.defineProperty(process, 'platform', descriptor); }
    },
  },
  {
    name: 'cursorHeadlessPlan: stdin prompt + --force --trust',
    run: () => {
      const prompt = 'hello\nworld "quoted"';
      const plan = cursorHeadlessPlan(prompt, {
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
        '--output-format',
        'stream-json',
      ]);
    },
  },
  {
    // plan a8e5c3f9 t3：headless 恒 --force --trust——不再接受 unattended 权限旋钮，
    // 函数签名已不含 unattended（结构上不可能随 manifest 摇摆）。
    name: 'cursorHeadlessPlan: 恒 --force --trust（无 approval_mode 旋钮）',
    run: () => {
      const plan = cursorHeadlessPlan('x', { path: '/usr/bin/agent', kind: 'bare' });
      assert.deepStrictEqual(plan.argv, ['/usr/bin/agent', '-p', '--force', '--trust', '--output-format', 'stream-json']);
      assert.strictEqual(plan.stdin, 'x');
    },
  },
  {
    name: 'cursorHeadlessPlan: win32 .cmd uses cross-spawn when available',
    run: () => {
      const plan = cursorHeadlessPlan('p', {
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
