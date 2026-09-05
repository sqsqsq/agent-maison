// ============================================================================
// codeagent-adapter.unit.test.ts — codeagent adapter（plan c7a9e2f4）
// ============================================================================
// 覆盖：adapter.yaml 结构/跨目录引用可解析；commands ×12 归一化等值（delta 白名单）；
// settings.json 结构等值（无 $schema）；goal_capability 与 claude 逐字段等值；
// defaultHeadlessInvokePlan 同构（binary=codeagentcli、adapterName 显式携带）；
// 诊断归属不再误猜 cursor；IMAGE_READ_PARSERS 入册（2026-07-29 实采脱敏 fixture）；
// registry option 注册。

import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';

import { __testing as checkInitTesting } from '../../scripts/check-init';
import {
  defaultHeadlessInvokePlan,
  diagnoseAdapterForBinaryIssue,
} from '../../scripts/utils/agent-invoke';
import { planUsesClaudeStreamJson } from '../../scripts/utils/claude-envelope';
import {
  hasImageReadParser,
  parseImageReadEventsFor,
} from '../../scripts/utils/critic-receipt-producer';
import {
  loadGoalCapability,
  validateGoalCapabilityForRunner,
} from '../../scripts/utils/goal-adapter-capability';
import { isClaudeKernelAdapter, CLAUDE_KERNEL_ADAPTERS } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const FRAMEWORK_ROOT = REPO_ROOT;
const CLAUDE_COMMANDS_DIR = path.join(FRAMEWORK_ROOT, 'agents/claude/templates/commands');
const CODEAGENT_COMMANDS_DIR = path.join(FRAMEWORK_ROOT, 'agents/codeagent/templates/commands');

const unattended = {
  write_mode: 'accept-edits' as const,
  approval_mode: 'never' as const,
};

// --------------------------------------------------------------------------
// commands delta 白名单（T5 归一化等值；禁止"删任意含 codeagent 整段"式宽松归一）
// --------------------------------------------------------------------------

/** 普通 11 份唯一允许的 delta：身份行（含前置空行，与生成器插入形态逐字对应） */
function identityLineFor(file: string): string {
  return `> 运行身份：codeagent（薄入口，逻辑以 framework SKILL 为准；勿被同名 \`.claude/commands/${file}\` 误导）`;
}

/** goal-mode.md 允许的第 2/3 处 delta（RESOLVED_ADAPTER 行替换 + 权威段插入，逐字） */
const GOAL_RESOLVED_CODEAGENT = '> **运行身份（RESOLVED_ADAPTER）**：codeagent';
const GOAL_RESOLVED_CLAUDE = '> **运行身份（RESOLVED_ADAPTER）**：claude';
const GOAL_AUTHORITY_PARA =
  '> **运行身份权威（防误选 adapter）**：以 `framework.local.json agent_adapter` 为 SSOT。本 Command 即声明 **codeagent**，**勿**被同名的 `.claude/commands/goal-mode.md`（写死 claude）误导；`goal-runner` 会以 local 对账——`--adapter` 与之冲突即 STOP（除非显式 `--override-adapter`）。';

/** 按白名单剥除 delta，返回归一化文本；白名单未命中（缺失/变形/多余 delta）直接抛错 */
function normalizeCodeagentCommand(file: string, text: string): string {
  const lines = text.split('\n');
  if (file === 'goal-mode.md') {
    const resolvedIdx = lines.indexOf(GOAL_RESOLVED_CODEAGENT);
    assert(resolvedIdx >= 0, `${file}: RESOLVED_ADAPTER codeagent 行缺失`);
    lines[resolvedIdx] = GOAL_RESOLVED_CLAUDE;
    const authIdx = lines.indexOf(GOAL_AUTHORITY_PARA);
    assert(authIdx >= 0, `${file}: 运行身份权威段缺失`);
    assert.strictEqual(lines[authIdx + 1], '', `${file}: 权威段后应跟空行`);
    lines.splice(authIdx, 2);
    return lines.join('\n');
  }
  const idLine = identityLineFor(file);
  const idIdx = lines.indexOf(idLine);
  assert(idIdx >= 1, `${file}: 身份行缺失或变形`);
  assert.strictEqual(lines[idIdx - 1], '', `${file}: 身份行前应有空行`);
  lines.splice(idIdx - 1, 2);
  return lines.join('\n');
}

// --------------------------------------------------------------------------
// 2026-07-29 宿主实采 Read tool_use 事件（脱敏：路径归一/ids 归零/模型名遮蔽；
// 结构与字段类型逐字保留——含 fork 的 call_ 前缀 id 与 claude 同构的 content 形状）
// --------------------------------------------------------------------------
const CODEAGENT_READ_EVENT_FIXTURE = [
  JSON.stringify({
    type: 'assistant',
    message: {
      id: 'msg_0000000000000',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'redacted', signature: '0000000000000' }],
      model: '<redacted-model>',
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
      context_management: null,
    },
    parent_tool_use_id: null,
    session_id: '00000000-0000-0000-0000-000000000000',
    uuid: '00000000-0000-0000-0000-000000000000',
  }),
  JSON.stringify({
    type: 'assistant',
    message: {
      id: 'msg_0000000000000',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'call_00000000000000000000000000000000',
          name: 'Read',
          input: { file_path: 'D:\\proj\\probe-test.png' },
        },
      ],
      model: '<redacted-model>',
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
      context_management: null,
    },
    parent_tool_use_id: null,
    session_id: '00000000-0000-0000-0000-000000000000',
    uuid: '00000000-0000-0000-0000-000000000000',
  }),
  // fork 扩展：tool_result 带 vlDescription/modelID 等 claude 没有的字段——不得影响解析
  JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          tool_use_id: 'call_00000000000000000000000000000000',
          type: 'tool_result',
          content: [{ type: 'text', text: 'redacted' }],
        },
      ],
    },
    tool_use_result: {
      type: 'image',
      file: { base64: 'AAAA', type: 'image/png', originalSize: 70 },
      vlDescription: 'redacted',
    },
    modelID: '',
    providerID: '',
    agent: '',
    session_id: '00000000-0000-0000-0000-000000000000',
    uuid: '00000000-0000-0000-0000-000000000000',
  }),
].join('\n');

function stripCommentKeys(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !k.startsWith('_comment') && k !== '$schema'));
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'loadAdapter: codeagent yaml 可解析，AGENTS.md 入口，.cac 产物全集（含跨目录共享模板）',
    run: () => {
      const adapter = checkInitTesting.loadAdapter('codeagent');
      assert(adapter.yamlParseable, 'codeagent yaml');
      assert.strictEqual(adapter.entryFile?.targetRel, 'AGENTS.md', 'codeagent entry');
      const targets = adapter.templateFiles.map(f => f.targetRel);
      // commands ×12 自有副本
      const commandFiles = fs.readdirSync(CODEAGENT_COMMANDS_DIR).filter(f => f.endsWith('.md'));
      assert.strictEqual(commandFiles.length, 12, `commands 应 12 份，实际 ${commandFiles.length}`);
      for (const f of commandFiles) {
        assert(targets.includes(`.cac/commands/${f}`), `.cac/commands/${f} 未进物化清单`);
      }
      // 跨目录共享：verifier / hooks / rules
      assert(targets.includes('.cac/agents/verifier.md'), 'verifier 共享模板未进清单');
      for (const hook of ['guard-framework-write.mjs', 'check-phase-completion.mjs']) {
        assert(targets.includes(`.cac/hooks/${hook}`), `.cac/hooks/${hook} 未进清单`);
      }
      assert(targets.includes('.cac/rules/interaction-renderer.md'), 'rules 共享模板未进清单');
      // settings_file
      assert(targets.includes('.cac/settings.json'), `.cac/settings.json 未进物化清单：${JSON.stringify(targets)}`);
      // 绝不写 .claude/*（防交叉）
      assert(!targets.some(t => t.startsWith('.claude/')), 'codeagent 不得物化 .claude/*');
    },
  },
  {
    name: 'commands 归一化等值：普通 11 份仅身份行 delta；goal-mode 三处 delta；其余逐字节同 claude',
    run: () => {
      const claudeFiles = fs.readdirSync(CLAUDE_COMMANDS_DIR).filter(f => f.endsWith('.md')).sort();
      const codeagentFiles = fs.readdirSync(CODEAGENT_COMMANDS_DIR).filter(f => f.endsWith('.md')).sort();
      assert.deepStrictEqual(codeagentFiles, claudeFiles, 'commands 文件清单须一致');
      for (const f of claudeFiles) {
        const claudeText = fs.readFileSync(path.join(CLAUDE_COMMANDS_DIR, f), 'utf-8');
        const codeagentText = fs.readFileSync(path.join(CODEAGENT_COMMANDS_DIR, f), 'utf-8');
        const normalized = normalizeCodeagentCommand(f, codeagentText);
        assert.strictEqual(normalized, claudeText, `${f}: 白名单外内容漂移`);
      }
    },
  },
  {
    name: 'settings.json 结构等值：事件/matcher 同构，command 仅差目录+变量，codeagent 无 $schema',
    run: () => {
      const claudeRaw = JSON.parse(
        fs.readFileSync(path.join(FRAMEWORK_ROOT, 'agents/claude/templates/settings.json'), 'utf-8'),
      ) as Record<string, unknown>;
      const codeagentRaw = JSON.parse(
        fs.readFileSync(path.join(FRAMEWORK_ROOT, 'agents/codeagent/templates/settings.json'), 'utf-8'),
      ) as Record<string, unknown>;
      assert('$schema' in claudeRaw, 'claude 应保留 $schema（编辑器福利）');
      assert(!('$schema' in codeagentRaw), 'codeagent 不得携带 claude schema URL');
      type HooksShape = Record<string, Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>>;
      const claudeHooks = (stripCommentKeys(claudeRaw) as { hooks: HooksShape }).hooks;
      const codeagentHooks = (stripCommentKeys(codeagentRaw) as { hooks: HooksShape }).hooks;
      assert.deepStrictEqual(Object.keys(codeagentHooks).sort(), Object.keys(claudeHooks).sort(), 'hook 事件集须一致');
      for (const event of Object.keys(claudeHooks)) {
        const ca = claudeHooks[event]!;
        const cc = codeagentHooks[event]!;
        assert.strictEqual(cc.length, ca.length, `${event} 条目数`);
        for (let i = 0; i < ca.length; i++) {
          assert.strictEqual(cc[i]!.matcher, ca[i]!.matcher, `${event}[${i}] matcher`);
          assert.strictEqual(cc[i]!.hooks.length, ca[i]!.hooks.length, `${event}[${i}] hooks 数`);
          for (let j = 0; j < ca[i]!.hooks.length; j++) {
            const mapped = ca[i]!.hooks[j]!.command
              .split('.claude/').join('.cac/')
              .split('CLAUDE_PROJECT_DIR').join('CODEAGENT3_PROJECT_DIR');
            assert.strictEqual(cc[i]!.hooks[j]!.command, mapped, `${event}[${i}].hooks[${j}] command 仅允许目录+变量差异`);
            assert.strictEqual(cc[i]!.hooks[j]!.type, ca[i]!.hooks[j]!.type, `${event}[${i}].hooks[${j}] type`);
          }
        }
      }
    },
  },
  {
    name: 'goal_capability 与 claude 逐字段等值（headless_invoke 仅差二进制名）；runner 校验通过',
    run: () => {
      const claude = loadGoalCapability(FRAMEWORK_ROOT, 'claude');
      const codeagent = loadGoalCapability(FRAMEWORK_ROOT, 'codeagent');
      assert(codeagent.present && codeagent.valid, `codeagent goal_capability: ${codeagent.issues.join(';')}`);
      assert.strictEqual(codeagent.capability!.mode, claude.capability!.mode);
      assert.strictEqual(
        codeagent.capability!.tool_event_provenance,
        claude.capability!.tool_event_provenance,
      );
      assert.strictEqual(
        codeagent.capability!.native_goal?.supports_resume,
        claude.capability!.native_goal?.supports_resume,
      );
      assert.deepStrictEqual(
        codeagent.capability!.external_runner?.unattended,
        claude.capability!.external_runner?.unattended,
      );
      const claudeInvoke = claude.capability!.external_runner?.headless_invoke ?? '';
      const codeagentInvoke = codeagent.capability!.external_runner?.headless_invoke ?? '';
      assert.strictEqual(
        codeagentInvoke,
        claudeInvoke.replace(/^claude /, 'codeagentcli '),
        'headless_invoke 仅允许二进制名差异',
      );
      const v = validateGoalCapabilityForRunner(FRAMEWORK_ROOT, 'codeagent', unattended);
      assert(v.ok, `runner 校验: ${v.issues.join(';')}`);
    },
  },
  {
    name: 'goal_condition_template 与 interaction_renderer_rule 的 ../ 跨目录路径真实存在',
    run: () => {
      const adapterDir = path.join(FRAMEWORK_ROOT, 'agents', 'codeagent');
      const doc = YAML.parse(fs.readFileSync(path.join(adapterDir, 'adapter.yaml'), 'utf-8')) as {
        goal_capability?: { native_goal?: { goal_condition_template?: string } };
        user_confirmation?: { interaction_renderer_rule?: string };
      };
      const gct = doc.goal_capability?.native_goal?.goal_condition_template;
      assert(typeof gct === 'string' && gct.length > 0, 'goal_condition_template 声明缺失');
      assert(fs.existsSync(path.join(adapterDir, gct!)), `goal_condition_template 路径不存在: ${gct}`);
      const irr = doc.user_confirmation?.interaction_renderer_rule;
      assert(typeof irr === 'string' && irr.length > 0, 'interaction_renderer_rule 声明缺失');
      assert(fs.existsSync(path.join(adapterDir, irr!)), `interaction_renderer_rule 路径不存在: ${irr}`);
    },
  },
  {
    name: 'defaultHeadlessInvokePlan: codeagent 与 claude argv 同构（仅二进制名差异），stdin 喂 prompt，adapterName 显式',
    run: () => {
      const codeagentPlan = defaultHeadlessInvokePlan('codeagent', unattended, 'probe', 'structured_events');
      const claudePlan = defaultHeadlessInvokePlan('claude', unattended, 'probe', 'structured_events');
      assert.deepStrictEqual(codeagentPlan.argv.slice(1), claudePlan.argv.slice(1), 'flags 须逐项同构');
      // plan a8e5c3f9 t1：headless 全权限——bypass 取代 --permission-mode dontAsk/allowedTools。
      for (const flag of ['-p', '--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose']) {
        assert(codeagentPlan.argv.includes(flag), `缺 flag ${flag}: ${codeagentPlan.argv.join(' ')}`);
      }
      assert.strictEqual(codeagentPlan.useStdin, true, 'prompt 必须走 stdin（Windows cmd shim 截断铁律）');
      assert.strictEqual(codeagentPlan.stdin, 'probe');
      assert.strictEqual(codeagentPlan.adapterName, 'codeagent');
      assert.strictEqual(claudePlan.adapterName, 'claude');
      assert.strictEqual(codeagentPlan.label, 'codeagentcli -p …');
      // provenance 未声明时不得注入 stream-json（与 claude 同构）
      const bare = defaultHeadlessInvokePlan('codeagent', unattended, 'probe');
      assert(!bare.argv.includes('stream-json'), bare.argv.join(' '));
    },
  },
  {
    name: '诊断归属（#5b）：adapterName 显式携带 → codeagent；纯 argv 猜测也不再误报 cursor',
    run: () => {
      assert.strictEqual(
        diagnoseAdapterForBinaryIssue({ argv: ['codeagentcli', '-p'], adapterName: 'codeagent' }),
        'codeagent',
      );
      // 兜底子串路径（custom invoke 无 adapterName）——codeagentcli 不含 claude 子串，
      // 修复前会落到 cursor 兜底
      assert.strictEqual(
        diagnoseAdapterForBinaryIssue({ argv: ['codeagentcli', '-p'] }),
        'codeagent',
      );
      assert.strictEqual(diagnoseAdapterForBinaryIssue({ argv: ['claude', '-p'] }), 'claude');
      assert.strictEqual(diagnoseAdapterForBinaryIssue({ argv: ['unknown-cli'] }), 'cursor');
    },
  },
  {
    name: '家族谓词：信封语义门/内核集合覆盖 codeagent；非家族不受影响',
    run: () => {
      assert(isClaudeKernelAdapter('codeagent'));
      assert(isClaudeKernelAdapter('claude'));
      assert(!isClaudeKernelAdapter('cursor'));
      assert(!isClaudeKernelAdapter(undefined));
      assert.deepStrictEqual([...CLAUDE_KERNEL_ADAPTERS].sort(), ['claude', 'codeagent']);
      assert(planUsesClaudeStreamJson('codeagent', 'structured_events'));
      assert(!planUsesClaudeStreamJson('codeagent', 'none'));
      assert(!planUsesClaudeStreamJson('codex', 'structured_events'));
    },
  },
  {
    name: 'IMAGE_READ_PARSERS 入册：codeagent 实采脱敏 fixture 解析出 Read 图片路径；fork 扩展字段无害',
    run: () => {
      assert(hasImageReadParser('codeagent'), 'codeagent 解析器未入册');
      const paths2 = parseImageReadEventsFor('codeagent', CODEAGENT_READ_EVENT_FIXTURE);
      assert(paths2 !== null, '解析器应存在');
      assert.deepStrictEqual(paths2, ['D:\\proj\\probe-test.png'], JSON.stringify(paths2));
      // 未入册 adapter 仍返回 null（不承诺）
      assert.strictEqual(parseImageReadEventsFor('cursor', CODEAGENT_READ_EVENT_FIXTURE), null);
    },
  },
  {
    name: 'registry: init.materialized_adapters 含 codeagent 选项（value/label/portable 全）',
    run: () => {
      const registryPath = path.join(FRAMEWORK_ROOT, 'skills/reference/confirmation-registry.yaml');
      const registry = YAML.parse(fs.readFileSync(registryPath, 'utf-8')) as {
        entries?: Array<{ id?: string; options?: Array<{ value?: string; label?: string; portable?: string }> }>;
      };
      const entry = registry.entries?.find(e => e.id === 'init.materialized_adapters');
      assert(entry, 'init.materialized_adapters entry missing');
      const opt = entry!.options?.find(o => o.value === 'codeagent');
      assert(opt, 'codeagent option missing from registry');
      assert(opt!.label && opt!.label.includes('.cac'), 'label 应说明 .cac 产物');
      assert.strictEqual(opt!.portable, 'codeagent');
    },
  },
  {
    name: '共享 rules 已中性化：不再自称 Claude adapter 专属；反例路径兼列 .cac',
    run: () => {
      const rulePath = path.join(FRAMEWORK_ROOT, 'agents/claude/templates/rules/interaction-renderer.md');
      const text = fs.readFileSync(rulePath, 'utf-8');
      assert(text.includes('Claude-kernel adapter'), '标题/声明应为 Claude-kernel 口径');
      assert(!text.includes('Claude adapter 会话级'), '不得残留 claude 专属会话级声明');
      assert(text.includes('.cac/commands/skills/'), '反例路径应兼列 .cac');
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(c => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (e) {
      return { name: c.name, ok: false, error: (e as Error).stack ?? (e as Error).message };
    }
  });
}
