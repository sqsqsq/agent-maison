// ============================================================================
// headless-full-permission.unit.test.ts — plan a8e5c3f9：统一 headless 全权限执行契约
// ============================================================================
// 契约：用户主动启动 Goal/headless 即授权 non-interactive + no approval prompt +
// full filesystem/tool execution；adapter 只翻译，不得降级；argv 不得随旧 manifest
// 权限字段摇摆；allowed_tools 退出一切执行/能力判断面；adapter.yaml 声明与运行时一致。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';
import {
  assertAdapterHeadlessFullPermission,
  defaultHeadlessInvokePlan,
} from '../../scripts/utils/agent-invoke';
import {
  effectiveHeadlessUnattended,
  type UnattendedContract,
} from '../../scripts/utils/goal-manifest';
import type { UnitCaseResult } from '../run-unit';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** 旧 manifest 可能出现的各种权限组合——最终 argv 必须全部相同。 */
const LEGACY_VARIANTS: UnattendedContract[] = [
  { write_mode: 'workspace-write', approval_mode: 'on-request' },
  { write_mode: 'accept-edits', approval_mode: 'never', allowed_tools: ['Bash', 'Edit'] },
  { write_mode: 'full-access', approval_mode: 'always', allowed_tools: [] },
  { write_mode: 'workspace-write', approval_mode: 'never', allowed_tools: ['Bash', 'Read', 'Write'] },
];

function testClaudeFamilyBypassArgv(): void {
  for (const adapter of ['claude', 'codeagent'] as const) {
    for (const u of LEGACY_VARIANTS) {
      const plan = defaultHeadlessInvokePlan(adapter, u, 'probe', 'structured_events');
      const argv = plan.argv.join(' ');
      assert(plan.argv.includes('--dangerously-skip-permissions'), `${adapter} 须带 bypass：${argv}`);
      assert(!argv.includes('--permission-mode'), `${adapter} 不得再有 --permission-mode：${argv}`);
      assert(!argv.includes('--allowedTools'), `${adapter} 不得再有 --allowedTools：${argv}`);
      assert(!argv.includes('dontAsk') && !argv.includes('acceptEdits'), `${adapter} 旧模式词残留：${argv}`);
    }
    const base = defaultHeadlessInvokePlan(adapter, LEGACY_VARIANTS[0], 'probe', 'structured_events').argv.join(' ');
    for (const u of LEGACY_VARIANTS.slice(1)) {
      const argv = defaultHeadlessInvokePlan(adapter, u, 'probe', 'structured_events').argv.join(' ');
      assert(argv === base, `${adapter} argv 不得随旧 unattended 摇摆：\n${base}\nvs\n${argv}`);
    }
  }
}

function testClaudeKeepsExistingFlags(): void {
  const plan = defaultHeadlessInvokePlan('claude', LEGACY_VARIANTS[0], 'probe', 'structured_events', 'model-x');
  const argv = plan.argv;
  assert(argv.includes('-p'), argv.join(' '));
  assert(argv.includes('--output-format') && argv.includes('stream-json') && argv.includes('--verbose'), argv.join(' '));
  assert(argv.includes('--model') && argv.includes('model-x'), 'model pin 行为须保留');
  assert(plan.useStdin === true && plan.stdin === 'probe', 'prompt 走 stdin 铁律须保留');
}

function testCodexFixedFullAccess(): void {
  const base = defaultHeadlessInvokePlan('codex', LEGACY_VARIANTS[0], 'probe').argv;
  assert(base[0] === 'codex' || base[0].includes('codex'), base.join(' '));
  const approvalIdx = base.indexOf('--ask-for-approval');
  const execIdx = base.indexOf('exec');
  assert(approvalIdx >= 0 && base[approvalIdx + 1] === 'never', `codex 恒 approval never：${base.join(' ')}`);
  assert(approvalIdx < execIdx, '--ask-for-approval 必须保持在 exec 之前（codex 顶层旗标）');
  const sandboxIdx = base.indexOf('--sandbox');
  assert(sandboxIdx > execIdx && base[sandboxIdx + 1] === 'danger-full-access', `codex 恒 danger-full-access：${base.join(' ')}`);
  assert(!base.includes('workspace-write'), `codex 不得再出现 workspace-write：${base.join(' ')}`);
  for (const u of LEGACY_VARIANTS.slice(1)) {
    const argv = defaultHeadlessInvokePlan('codex', u, 'probe').argv;
    assert(argv.join(' ') === base.join(' '), `codex argv 不得随旧 unattended 摇摆：${argv.join(' ')}`);
  }
  // model pin 位置保持已验证顺序：exec --model <v> --sandbox <m>
  const pinned = defaultHeadlessInvokePlan('codex', LEGACY_VARIANTS[0], 'probe', undefined, 'm1').argv;
  const e = pinned.indexOf('exec');
  assert(pinned[e + 1] === '--model' && pinned[e + 2] === 'm1' && pinned[e + 3] === '--sandbox', pinned.join(' '));
}

function testCursorAlwaysTrust(): void {
  for (const u of LEGACY_VARIANTS) {
    const argv = defaultHeadlessInvokePlan('cursor', u, 'probe').argv;
    assert(argv.includes('--force') && argv.includes('--trust'), `cursor 恒 --force --trust：${argv.join(' ')}`);
  }
}

function testOpencodePinnedBypass(): void {
  const argv = defaultHeadlessInvokePlan('opencode', LEGACY_VARIANTS[0], 'probe').argv;
  assert(
    argv.includes('--dangerously-skip-permissions'),
    `opencode 的 bypass 旗标是全场唯一正确样板，防「统一重构」误删：${argv.join(' ')}`,
  );
}

function testEffectiveHeadlessUnattended(): void {
  const eff = effectiveHeadlessUnattended({
    write_mode: 'workspace-write',
    approval_mode: 'on-request',
    max_turns: 30,
    timeout_seconds: 120,
    allowed_tools: ['Bash'],
  });
  assert(eff.write_mode === 'full-access', eff.write_mode);
  assert(eff.approval_mode === 'never', eff.approval_mode);
  assert(eff.max_turns === 30 && eff.timeout_seconds === 120, '非权限字段须原样透传');
  const effEmpty = effectiveHeadlessUnattended(undefined);
  assert(effEmpty.write_mode === 'full-access' && effEmpty.approval_mode === 'never', 'undefined 输入同样归一化');
}

function testChrysRefusedCodeagentReleased(): void {
  // plan c4e8a1f7 T1b（用户裁决）：CodeAgent 进入 supported 集合（复用既有全权限 argv/
  // stdin/stream-json/Read parser；真实 CLI flag 错误由统一 hard-CLI 早停承接）；
  // Chrys（bypass 旗标仍未经宿主核实）保持拒绝。
  const r = assertAdapterHeadlessFullPermission('chrys');
  assert(r.ok === false, 'chrys bypass 未经核实，须明确拒绝而非静默残权限/推定支持');
  assert(r.ok === false && r.reason.includes('adapter_headless_permission_unsupported'), (r as { reason?: string }).reason ?? '');
  assert(assertAdapterHeadlessFullPermission('codeagent').ok === true, 'codeagent 已放行（用户裁决）');
  for (const ok of ['claude', 'codex', 'cursor', 'opencode', 'my-custom-adapter']) {
    assert(assertAdapterHeadlessFullPermission(ok).ok === true, `${ok} 应通过（内建已固化 / custom 走提供方契约）`);
  }
}

function testPreflightWiresFullPermissionGate(): void {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'harness', 'scripts', 'utils', 'goal-preflight.ts'), 'utf-8');
  assert(
    src.includes('assertAdapterHeadlessFullPermission(adapter)'),
    'goal-preflight 必须接线全权限支持性判定（不支持的 adapter 明确失败，不静默降级）',
  );
}

function testManifestDefaultsSourcePins(): void {
  const entry = fs.readFileSync(path.join(REPO_ROOT, 'harness', 'scripts', 'goal-mode-entry.ts'), 'utf-8');
  assert(
    /unattended: \{ write_mode: 'full-access', approval_mode: 'never', max_turns: 30 \}/.test(entry),
    'goal-mode-entry 新 manifest 默认须为 full-access + never',
  );
  const runner = fs.readFileSync(path.join(REPO_ROOT, 'harness', 'scripts', 'goal-phase-runtime-process.ts'), 'utf-8');
  assert(
    /write_mode: 'full-access',\s*\n\s*approval_mode: 'never',\s*\n\s*max_turns: 20,/.test(runner),
    'goal-runner fresh CLI 入口新 manifest 默认须为 full-access + never',
  );
  assert(
    runner.includes('effective_write_mode: eff.write_mode') &&
      runner.includes('effective_approval_mode: eff.approval_mode'),
    'adapter_probe 事件须带 effective 权限审计字段',
  );
  assert(
    !runner.includes('MAISON_GOAL_ALLOWED_TOOLS_ENV]'),
    'goal-runner 不得再注入 MAISON_GOAL_ALLOWED_TOOLS',
  );
}

function testAdapterYamlDeclarationsAligned(): void {
  const adapters = ['claude', 'codeagent', 'codex', 'cursor', 'opencode', 'chrys', 'generic'];
  for (const name of adapters) {
    const abs = path.join(REPO_ROOT, 'agents', name, 'adapter.yaml');
    const raw = fs.readFileSync(abs, 'utf-8');
    const doc = YAML.parse(raw) as {
      goal_capability?: { external_runner?: { headless_invoke?: string; unattended?: { write_mode?: string; approval_mode?: string } } };
    };
    const er = doc.goal_capability?.external_runner;
    assert(!!er?.headless_invoke, `${name} 缺 headless_invoke 声明`);
    const cmd = er!.headless_invoke!;
    assert(!cmd.includes('dontAsk') && !cmd.includes('--permission-mode'), `${name} 声明仍教 permission-mode：${cmd}`);
    assert(!cmd.includes('--allowedTools'), `${name} 声明仍教 allowedTools：${cmd}`);
    assert(!cmd.includes('workspace-write'), `${name} 声明仍教 workspace-write sandbox：${cmd}`);
    assert(er!.unattended?.write_mode === 'full-access', `${name} unattended.write_mode 须为 full-access（实得 ${er!.unattended?.write_mode}）`);
    assert(er!.unattended?.approval_mode === 'never', `${name} unattended.approval_mode 须为 never（实得 ${er!.unattended?.approval_mode}）`);
  }
  // chrys 必须在声明面明确「当前不支持 + 核实路径」，不得只在代码里拒绝（防声明/运行时双口径）
  const chrysRaw = fs.readFileSync(path.join(REPO_ROOT, 'agents', 'chrys', 'adapter.yaml'), 'utf-8');
  assert(chrysRaw.includes('adapter_headless_permission_unsupported'), 'chrys adapter.yaml 须声明当前不支持 headless 全权限');
}

export function runAll(): UnitCaseResult[] {
  const cases: Array<{ name: string; fn: () => void }> = [
    { name: 't1 claude/codeagent bypass + 无 permission-mode/allowedTools + argv 恒定', fn: testClaudeFamilyBypassArgv },
    { name: 't1 claude 既有 flags（-p/stream-json/model pin/stdin）保留', fn: testClaudeKeepsExistingFlags },
    { name: 't2 codex 恒 approval never + danger-full-access（顶层旗标位置不变）', fn: testCodexFixedFullAccess },
    { name: 't3 cursor 恒 --force --trust', fn: testCursorAlwaysTrust },
    { name: 't4 opencode bypass 旗标回归钉', fn: testOpencodePinnedBypass },
    { name: 't6 effectiveHeadlessUnattended 薄解析点', fn: testEffectiveHeadlessUnattended },
    { name: 't5 chrys 未核实即拒绝；codeagent 已放行（用户裁决）；内建/custom 通过', fn: testChrysRefusedCodeagentReleased },
    { name: 't5 preflight 接线全权限判定(源级钉)', fn: testPreflightWiresFullPermissionGate },
    { name: 't6 manifest 默认值与审计字段(源级钉)', fn: testManifestDefaultsSourcePins },
    { name: 't7 七份 adapter.yaml 声明与运行时一致', fn: testAdapterYamlDeclarationsAligned },
  ];
  return cases.map(({ name, fn }) => {
    try {
      fn();
      return { name, ok: true };
    } catch (e) {
      return { name, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
