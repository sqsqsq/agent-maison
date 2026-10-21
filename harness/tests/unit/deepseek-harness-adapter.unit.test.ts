import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import YAML from 'yaml';

import { clearFrameworkConfigCache } from '../../config';
import { __testing as checkInitTesting } from '../../scripts/check-init';
import { buildAdapterCatalogOrThrow } from '../../scripts/utils/adapter-catalog';
import {
  buildAgentSpawnEnv, defaultHeadlessInvokePlan, diagnoseAdapterForBinaryIssue,
  invokeAgentHeadless, resolveHeadlessInvokePlan, validateHeadlessBinaryForPlan,
} from '../../scripts/utils/agent-invoke';
import { loadGoalCapability, routeGoalCapability } from '../../scripts/utils/goal-adapter-capability';
import { decideModelAlternative, resolveFinalModelPin } from '../../scripts/utils/goal-manifest-cli';
import { validateAdapterModelPinValue } from '../../scripts/utils/goal-manifest';
import { resolveTerminalEventParser } from '../../scripts/utils/codex-terminal-events';
import { executeInitTask, type InitExecutionContext } from '../../scripts/utils/init-task-executor';
import { emitInstanceSkillBridge } from '../../scripts/utils/instance-skill-bridge';
import { ensurePersonalSetup } from '../../scripts/utils/personal-setup-gate';
import { resolveInvokeHardCliFailure } from '../../scripts/utils/vision-canary';
import { formatHeadlessBinaryIssue, type ResolvedHeadlessBinary } from '../../scripts/utils/headless-binary-resolve';
import type { UnitCaseResult } from '../run-unit';

const FRAMEWORK_ROOT = path.resolve(__dirname, '../../..');
const ADAPTER = 'deepseek-harness';
const unattended = { write_mode: 'full-access' as const, approval_mode: 'never' as const };
const capability = () => loadGoalCapability(FRAMEWORK_ROOT, ADAPTER).capability!;

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function config(root: string, adapters: string[]): void {
  write(path.join(root, 'framework.config.json'), JSON.stringify({
    schema_version: '1.1', project_name: 'dsh-test', materialized_adapters: adapters,
    project_profile: 'generic',
    architecture: {
      outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
      module_inner_layers: ['shared'], inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ets',
    },
    paths: { features_dir: 'doc/features' },
  }));
  clearFrameworkConfigCache();
}

function materialize(root: string, adapter: string, adapters: string[], mode: 'create' | 'update') {
  const ctx: InitExecutionContext = {
    projectRoot: root, harnessRoot: path.join(FRAMEWORK_ROOT, 'harness'),
    materializedAdapters: adapters,
    plan: { schema_version: '1.0', scope: 'project', mode, generated_at: '', tasks: [] },
  };
  return executeInitTask({
    id: `materialize-adapter:${adapter}`, title: adapter, category: 'adapter-bundle',
    scope: 'project', deps: ['ensure-config'], status: 'needed', default_action: 'run',
    skippable: false, allowed_actions: ['run'], params: { adapter },
  }, 'run', ctx);
}

async function withRoot(run: (root: string) => void | Promise<void>): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-dsh-中文 space-'));
  try { await run(root); } finally {
    fs.rmSync(root, { recursive: true, force: true });
    clearFrameworkConfigCache();
  }
}

function invocation(root: string, prompt: string, binary: ResolvedHeadlessBinary) {
  return resolveHeadlessInvokePlan(ADAPTER, capability(), unattended, prompt, {
    PROMPT_FILE: '', PROMPT: prompt, PROJECT_ROOT: root, FRAMEWORK_ROOT,
    SKILL_PATH: '', FEATURE: 'demo', PHASE: 'coding',
  }, undefined, binary);
}

// 受控进程只回显传输事实；不是 DSH 输出协议或模型调用。
function fixtureBinary(root: string): ResolvedHeadlessBinary {
  const script = path.join(root, 'fixture.cjs');
  write(script, `
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', text => { input += text; });
process.stdin.on('end', () => {
  if (process.env.DSH_TEST_WAIT === '1') { setInterval(() => {}, 1000); return; }
  process.stdout.write(JSON.stringify({
    input, cwd: process.cwd(), args: process.argv.slice(2),
    permission: process.env.DSH_PERMISSION_MODE,
    permissionKeys: Object.keys(process.env).filter(k => k.toUpperCase() === 'DSH_PERMISSION_MODE'),
    headless: process.env.MAISON_GOAL_HEADLESS
  }));
  process.stderr.write(process.env.DSH_TEST_FAIL === '1'
    ? 'dsh: model_error: fixture unavailable\\n'
    : 'dsh: reasoning:\\nInspect the workspace before answering.\\n');
  process.exitCode = process.env.DSH_TEST_FAIL === '1' ? 1 : 0;
});
`);
  if (process.platform === 'win32') {
    const shim = path.join(root, 'dsh.cmd');
    write(shim, '@echo off\nSET "dp0=%~dp0"\nSET "_prog=node"\n"%_prog%" "%dp0%\\fixture.cjs" %*\n');
    return { path: shim, kind: 'cmd' };
  }
  const executable = path.join(root, 'dsh');
  write(executable, `#!${process.execPath}\nrequire(${JSON.stringify(script)});\n`);
  fs.chmodSync(executable, 0o755);
  return { path: executable, kind: 'bare' };
}

const cases: Array<{ name: string; run: () => void | Promise<void> }> = [
  {
    name: '桌面 DSH 命令缺失时提示菜单注册及新终端，不猜安装路径',
    run: () => {
      const issue = formatHeadlessBinaryIssue(ADAPTER, ['dsh'], null);
      assert(issue.includes('管理 dsh 命令… → 安装'));
      assert(issue.includes('新终端'));
      assert(!formatHeadlessBinaryIssue('opencode', ['opencode'], null).includes('DeepSeek'));
    },
  },
  {
    name: 'catalog、共享模板、固定权限与存储认证 patch 可被生产解析器消费',
    run: () => {
      assert(buildAdapterCatalogOrThrow(FRAMEWORK_ROOT).some(row => row.value === ADAPTER));
      const adapter = checkInitTesting.loadAdapter(ADAPTER);
      assert(adapter.yamlParseable);
      assert(adapter.declaredTemplatePaths.every(item => item.exists));
      assert.strictEqual(adapter.entryFile?.targetRel, 'AGENTS.md');
      assert(adapter.templateFiles.some(item => item.targetRel === '.dsh/rules/interaction-renderer.md'));
      const skills = adapter.templateFiles.filter(item => item.targetRel.startsWith('.dsh/skills/'));
      assert(skills.length > 0);
      for (const skill of skills) {
        const text = fs.readFileSync(path.join(FRAMEWORK_ROOT, skill.templateRel), 'utf8');
        const name = YAML.parse(text.split('---')[1]).name;
        assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name), name);
      }
      const loaded = loadGoalCapability(FRAMEWORK_ROOT, ADAPTER);
      assert(loaded.valid);
      assert.strictEqual(loaded.capability?.usage_capture, 'none');
      assert.strictEqual(loaded.capability?.tool_event_provenance, 'none');
      assert.strictEqual(routeGoalCapability(loaded, 'unattended', { unattendedPreflightOk: true }).kind, 'external_runner');
      assert.strictEqual(routeGoalCapability(loaded, 'attended').kind, 'manual');
      assert.strictEqual(resolveTerminalEventParser(ADAPTER), 'none');
      const patch = path.join(FRAMEWORK_ROOT, 'agents/deepseek-harness/headless-patch.yaml');
      assert.deepStrictEqual(YAML.parse(fs.readFileSync(patch, 'utf8')), [
        { id: 'permission', config: { defaultPreset: 'danger-full-access' } },
        { id: 'credentials', disabled: false },
        { id: 'authorization', disabled: false },
        { id: 'deepseek-account', disabled: false },
      ]);
    },
  },
  {
    name: 'CREATE/UPDATE、多 adapter 共存、实例跳板清理与用户文件保护复用生产链',
    run: () => withRoot(root => {
      const adapters = ['generic', 'claude', 'opencode', ADAPTER];
      config(root, adapters);
      write(path.join(root, '.dsh/skills/user-owned/SKILL.md'), '# User skill\n');
      for (const adapter of adapters) materialize(root, adapter, adapters, 'create');
      const entry = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
      const skillPath = path.join(root, '.dsh/skills/goal-mode/SKILL.md');
      const before = fs.readFileSync(skillPath, 'utf8');
      assert(before.includes('framework/skills/project/goal-mode/SKILL.md'));
      assert(!before.includes('RESOLVED_ADAPTER'));
      assert.strictEqual(before, fs.readFileSync(path.join(root, '.opencode/skill/goal-mode/SKILL.md'), 'utf8'));
      assert(fs.existsSync(path.join(root, '.agents/skills/coding/SKILL.md')));
      assert(fs.existsSync(path.join(root, '.claude/commands/framework-init.md')));
      materialize(root, ADAPTER, adapters, 'update');
      assert.strictEqual(fs.readFileSync(skillPath, 'utf8'), before);
      assert.strictEqual(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), entry);
      assert.strictEqual(fs.readFileSync(path.join(root, '.dsh/skills/user-owned/SKILL.md'), 'utf8'), '# User skill\n');

      const source = path.join(root, 'doc/extensions/skills/customer-context/SKILL.md');
      write(source, '# Customer context\n');
      const options = { repoRoot: root, frameworkDir: FRAMEWORK_ROOT, agentAdapter: ADAPTER };
      assert.strictEqual(emitInstanceSkillBridge(options).filesWritten.length, 1);
      const bridge = path.join(root, '.dsh/skills/customer-context/SKILL.md');
      assert(fs.readFileSync(bridge, 'utf8').includes('doc/extensions/skills/customer-context/SKILL.md'));
      assert.strictEqual(emitInstanceSkillBridge(options).filesWritten.length, 0);
      fs.unlinkSync(source);
      assert.strictEqual(emitInstanceSkillBridge(options).filesRemoved.length, 1);
      assert(!fs.existsSync(bridge));
      assert(fs.existsSync(path.join(root, '.dsh/skills/user-owned/SKILL.md')));
    }),
  },
  {
    name: '个人设置：单 DSH 自动选择，多 adapter 保留选择权',
    run: () => withRoot(root => {
      config(root, [ADAPTER]);
      write(path.join(root, 'AGENTS.md'), '# project\n');
      const single = ensurePersonalSetup(root, { requiredPrerequisites: new Set(['agent_adapter']) });
      assert(single.ok, JSON.stringify(single));
      assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, 'framework.local.json'), 'utf8')).agent_adapter, ADAPTER);
      fs.unlinkSync(path.join(root, 'framework.local.json'));
      config(root, [ADAPTER, 'opencode']);
      const multiple = ensurePersonalSetup(root, { requiredPrerequisites: new Set(['agent_adapter']) });
      assert(!multiple.ok);
      assert.strictEqual(multiple.code, 'needs_adapter_choice');
      assert(multiple.candidates.includes(ADAPTER));
    }),
  },
  {
    name: '环境注入覆盖父值及大小写变体、调用方残值；其它 adapter 不受影响',
    run: () => {
      const base = { DSH_PERMISSION_MODE: 'workspace-write', Dsh_Permission_Mode: 'read-only', SAFE: 'keep' };
      const env = buildAgentSpawnEnv(base, { dsh_permission_mode: 'workspace-write' }, ADAPTER);
      assert.strictEqual(env.DSH_PERMISSION_MODE, 'danger-full-access');
      assert.deepStrictEqual(Object.keys(env).filter(k => k.toUpperCase() === 'DSH_PERMISSION_MODE'), ['DSH_PERMISSION_MODE']);
      assert.strictEqual(env.SAFE, 'keep');
      assert.strictEqual(base.DSH_PERMISSION_MODE, 'workspace-write');
      assert.strictEqual(buildAgentSpawnEnv(base, undefined, 'opencode').DSH_PERMISSION_MODE, 'workspace-write');
    },
  },
  {
    name: '模型 pin 和获准替代均沿现有出口拒绝，普通无 pin 可用',
    run: () => {
      validateAdapterModelPinValue(ADAPTER, 'fixture-model');
      const base = { effectiveAdapter: ADAPTER, isResume: false, hasManifestFlag: false,
        isSuccessor: false, overrideManifest: false, overrideAdapter: false };
      assert.deepStrictEqual(resolveFinalModelPin(base), { ok: true, pin: undefined });
      for (const input of [
        { cliValue: 'fixture-model' },
        { manifestPin: { adapter: ADAPTER, value: 'fixture-model' }, hasManifestFlag: true },
        { manifestPin: { adapter: ADAPTER, value: 'fixture-model' }, isResume: true },
        { manifestPin: { adapter: 'codex', value: 'fixture-model' }, isSuccessor: true },
      ]) {
        const result = resolveFinalModelPin({ ...base, ...input });
        assert(!result.ok);
        assert(result.message.includes('不支持 --adapter-model'), result.message);
      }
      assert.deepStrictEqual(decideModelAlternative({
        adapter: ADAPTER, pin: undefined, approvedModels: ['another-model'], tried: [], remainingMs: 5000,
      }), { kind: 'refuse', reason: 'adapter_unsupported', tried: [] });
    },
  },
  {
    name: '生产 plan → invoke：stdin/cwd/父权限覆盖/文本退出码，包含 Windows guardian',
    run: () => withRoot(async root => {
      const binary = fixtureBinary(root);
      const prompt = '中文 "quoted" `literal` %PATH%\n' + 'long input\n'.repeat(1000);
      const plan = invocation(root, prompt, binary);
      const patch = path.join(FRAMEWORK_ROOT, 'agents/deepseek-harness/headless-patch.yaml');
      assert.deepStrictEqual(plan.argv, [binary.path, '--profile', 'headless', '--patch', patch]);
      assert.strictEqual(plan.stdin, prompt);
      assert.strictEqual(plan.adapterName, ADAPTER);
      assert.strictEqual(diagnoseAdapterForBinaryIssue(plan), ADAPTER);
      assert(validateHeadlessBinaryForPlan(ADAPTER, plan).ok);
      assert.deepStrictEqual(defaultHeadlessInvokePlan(
        ADAPTER, unattended, prompt, undefined, undefined, binary,
      ).argv, plan.argv);
      const modes = process.platform === 'win32' ? [false, true] : [false];
      for (const guardian of modes) {
        const result = await invokeAgentHeadless(plan, root, {
          timeoutMs: 15000, usageCapture: 'none',
          extraEnv: { DSH_PERMISSION_MODE: 'workspace-write', Dsh_Permission_Mode: 'read-only' },
          ...(guardian ? { containment: { runId: 'dsh-unit', invokeId: 'success' } } : {}),
        });
        assert.strictEqual(result.exitCode, 0, JSON.stringify({
          guardian, stderr: result.stderr, spawn_error: result.spawn_error,
          timed_out: result.timed_out, signal: result.signal,
        }));
        const received = JSON.parse(result.stdout);
        assert.strictEqual(received.input, prompt);
        assert.strictEqual(received.cwd.toLowerCase(), root.toLowerCase());
        assert.deepStrictEqual(received.args, ['--profile', 'headless', '--patch', patch]);
        assert.strictEqual(received.permission, 'danger-full-access');
        assert.deepStrictEqual(received.permissionKeys, ['DSH_PERMISSION_MODE']);
        assert.strictEqual(received.headless, '1');
        assert.strictEqual(result.usage?.confidence, 'proxy');
        assert.strictEqual(result.usage?.input_tokens, null);
        assert.strictEqual(resolveInvokeHardCliFailure(result), null);
      }
      const failed = await invokeAgentHeadless(plan, root, {
        timeoutMs: 10000, extraEnv: { DSH_TEST_FAIL: '1' },
      });
      assert.strictEqual(failed.exitCode, 1);
      assert(failed.stderr.includes('dsh: model_error: fixture unavailable'));
      assert(!failed.completion_observed);
      assert(!failed.timed_out);
    }),
  },
  {
    name: '生产 invoke：spawn 失败和超时回收不被文本终稿掩盖',
    run: () => withRoot(async root => {
      const missing = invocation(root, 'test', { path: path.join(root, 'missing-dsh.exe'), kind: 'exe' });
      assert(!validateHeadlessBinaryForPlan(ADAPTER, {
        ...missing, resolvedBinary: { ...missing.resolvedBinary!, inaccessible: true },
      }).ok);
      const failed = await invokeAgentHeadless(missing, root, { timeoutMs: 1000 });
      assert.notStrictEqual(failed.exitCode, 0);
      assert(failed.spawn_error);
      const plan = invocation(root, 'test', fixtureBinary(root));
      const timed = await invokeAgentHeadless(plan, root, {
        timeoutMs: 800, extraEnv: { DSH_TEST_WAIT: '1' },
      });
      assert(timed.timed_out);
      assert.notStrictEqual(timed.exitCode, 0);
      assert(!timed.completion_observed);
      if (timed.pid) assert.throws(() => process.kill(timed.pid!, 0));
    }),
  },
];

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const item of cases) {
    try { await item.run(); results.push({ name: item.name, ok: true }); }
    catch (error) { results.push({ name: item.name, ok: false, error: (error as Error).stack }); }
  }
  return results;
}
