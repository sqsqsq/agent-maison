// ============================================================================
// hooks-config-upsert.unit.test.ts — G1b cursor hooks_config 结构化 upsert +
// cursor 守卫壳协议 + enforcement tier 回归（plan e8f5a2c7）
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { spawnSync } from 'child_process';

import { detectRepoLayout, frameworkAbs } from '../../repo-layout';
import {
  computeHooksConfigUpsert,
  computeHooksConfigRemoval,
} from '../../scripts/utils/hooks-config-upsert';
import { resolveEnforcementTier } from '../../scripts/utils/runtime-policy';
import type { UnitCaseResult } from '../run-unit';

const LAYOUT = detectRepoLayout(__dirname);
const CURSOR_SHELL_ABS = frameworkAbs(LAYOUT, 'agents/cursor/hooks/guard-framework-write.mjs');
const CURSOR_TEMPLATE_ABS = frameworkAbs(LAYOUT, 'agents/cursor/templates/hooks.json');

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const GUARD_CMD = 'node framework/agents/cursor/hooks/guard-framework-write.mjs';
const DESIRED = JSON.stringify({
  version: 1,
  hooks: { preToolUse: [{ matcher: 'Write|Delete', command: GUARD_CMD }] },
});

const cases: Array<{ name: string; run: () => void | Promise<void> }> = [
  // ------------------------------------------------------------------------
  // 第四轮 P1 四件套
  // ------------------------------------------------------------------------
  {
    name: 'U1 第三方 hooks 保留：已有团队 hooks 的文件 upsert 后一切他方条目/顶层/未知字段原样',
    run: () => {
      const existing = JSON.stringify({
        version: 1,
        team_meta: { owner: 'platform' },
        hooks: {
          preToolUse: [{ matcher: 'Shell', command: './team/audit.sh', timeout: 5 }],
          afterFileEdit: [{ command: './team/format.sh' }],
        },
      });
      const r = computeHooksConfigUpsert(existing, DESIRED);
      assert(r.status === 'updated', r.status);
      const doc = JSON.parse(r.nextText!);
      assert(doc.team_meta?.owner === 'platform', '顶层未知字段应保留');
      assert(doc.hooks.afterFileEdit?.[0]?.command === './team/format.sh', '他方事件应保留');
      const pre = doc.hooks.preToolUse;
      assert(pre.length === 2, `第三方条目 + 自有条目应共存：${JSON.stringify(pre)}`);
      assert(pre[0].command === './team/audit.sh' && pre[0].timeout === 5, '第三方条目字段原样');
      assert(pre[1].command === GUARD_CMD, '自有条目 append 在后');
    },
  },
  {
    name: 'U2 自有条目升级：旧 matcher → 新 matcher 原位更新（第五轮 P2：数组长度不增）',
    run: () => {
      const existing = JSON.stringify({
        version: 1,
        hooks: {
          preToolUse: [
            { matcher: 'Shell', command: './team/audit.sh' },
            { matcher: 'Write', command: GUARD_CMD }, // 旧版 matcher
          ],
        },
      });
      const r = computeHooksConfigUpsert(existing, DESIRED);
      assert(r.status === 'updated', r.status);
      const pre = JSON.parse(r.nextText!).hooks.preToolUse;
      assert(pre.length === 2, `原位升级不得追加：${JSON.stringify(pre)}`);
      assert(pre[1].matcher === 'Write|Delete', 'matcher 应原位更新为新值');
      assert(pre[1].command === GUARD_CMD, 'command 不变（ownership key）');
      assert(pre[0].command === './team/audit.sh', '第三方位置不动');
    },
  },
  {
    name: 'U3 重复执行不重复（幂等）：updated 后再 upsert → unchanged',
    run: () => {
      const first = computeHooksConfigUpsert(null, DESIRED);
      assert(first.status === 'created', first.status);
      const second = computeHooksConfigUpsert(first.nextText!, DESIRED);
      assert(second.status === 'unchanged', `二次应 unchanged，实际 ${second.status}`);
    },
  },
  {
    name: 'U4 非法 JSON 不覆盖：invalid_json 且无 nextText',
    run: () => {
      const r = computeHooksConfigUpsert('{ not valid json', DESIRED);
      assert(r.status === 'invalid_json', r.status);
      assert(r.nextText === undefined, '非法 JSON 绝不产出覆盖内容');
    },
  },
  {
    name: 'U4b schema 不兼容不改写（第七轮 codex P1-2 复现修复）：hooks 为字符串 / 受管 event 为对象 → invalid_schema 无 nextText',
    run: () => {
      // codex 复现例 1：hooks 是字符串（宿主自有语义）——原实现静默替换为 framework hooks
      const r1 = computeHooksConfigUpsert(JSON.stringify({ version: 1, hooks: 'team-owned' }), DESIRED);
      assert(r1.status === 'invalid_schema', `hooks=字符串应 invalid_schema，实际 ${r1.status}`);
      assert(r1.nextText === undefined, 'schema 不兼容绝不产出覆盖内容');
      // codex 复现例 2：受管 event 是对象非数组——原实现丢弃宿主值
      const r2 = computeHooksConfigUpsert(
        JSON.stringify({ version: 1, hooks: { preToolUse: { command: './team/hook.js' } } }),
        DESIRED,
      );
      assert(r2.status === 'invalid_schema', `preToolUse=对象应 invalid_schema，实际 ${r2.status}`);
      assert(r2.nextText === undefined, 'schema 不兼容绝不产出覆盖内容');
      // 非受管 event 的怪形态不挡道（framework 不碰它）
      const r3 = computeHooksConfigUpsert(
        JSON.stringify({ version: 1, hooks: { afterFileEdit: 'weird-but-not-ours' } }),
        DESIRED,
      );
      assert(r3.status === 'created' || r3.status === 'updated', `非受管 event 怪形态不影响自有 upsert：${r3.status}`);
      assert((r3.nextText ?? '').includes('weird-but-not-ours'), '非受管字段原样保留');
    },
  },
  // ------------------------------------------------------------------------
  // 第五轮 P2 三件套（U2 已覆盖其一）
  // ------------------------------------------------------------------------
  {
    name: 'U4c framework 自有模板损坏不得静默接受（第八轮 codex P2：受管 event 为对象/空数组/缺 command → 拒绝物化）',
    run: () => {
      // codex 复现：模板 preToolUse 为对象 → 原实现产 {version:1,hooks:{}} 空壳 created
      const badObj = JSON.stringify({ version: 1, hooks: { preToolUse: { command: 'x' } } });
      const r1 = computeHooksConfigUpsert(null, badObj);
      assert(r1.status === 'invalid_json', `模板 event 为对象应拒绝，实际 ${r1.status}`);
      assert(r1.nextText === undefined, '模板损坏不得产出任何写盘内容（不产空壳）');
      const emptyArr = JSON.stringify({ version: 1, hooks: { preToolUse: [] } });
      assert(computeHooksConfigUpsert(null, emptyArr).status === 'invalid_json', '空数组模板应拒绝');
      const noCmd = JSON.stringify({ version: 1, hooks: { preToolUse: [{ matcher: 'Write' }] } });
      assert(computeHooksConfigUpsert(null, noCmd).status === 'invalid_json', '缺 command 条目应拒绝（ownership key 缺失）');
      const emptyHooks = JSON.stringify({ version: 1, hooks: {} });
      assert(computeHooksConfigUpsert(null, emptyHooks).status === 'invalid_json', '零 event 模板应拒绝');
    },
  },
  {
    name: 'U5 两个历史自有条目 → UPDATE 后去重为一',
    run: () => {
      const existing = JSON.stringify({
        version: 1,
        hooks: {
          preToolUse: [
            { matcher: 'Write', command: GUARD_CMD },
            { matcher: 'Shell', command: './team/audit.sh' },
            { matcher: 'Delete', command: GUARD_CMD }, // 历史残留第二条
          ],
        },
      });
      const r = computeHooksConfigUpsert(existing, DESIRED);
      assert(r.status === 'updated', r.status);
      const pre = JSON.parse(r.nextText!).hooks.preToolUse;
      const ownCount = pre.filter((e: { command?: string }) => e.command === GUARD_CMD).length;
      assert(ownCount === 1, `自有条目应去重为一，实际 ${ownCount}`);
      assert(pre.length === 2, `总数应为 第三方1+自有1：${JSON.stringify(pre)}`);
      assert(pre[0].command === GUARD_CMD && pre[0].matcher === 'Write|Delete', '保留首位并更新受管字段');
    },
  },
  {
    name: 'U6 卸载：删除全部自有条目，第三方条目与容器保留；空事件容器清理',
    run: () => {
      const existing = JSON.stringify({
        version: 1,
        team_meta: { owner: 'platform' },
        hooks: {
          preToolUse: [
            { matcher: 'Write|Delete', command: GUARD_CMD },
            { matcher: 'Shell', command: './team/audit.sh' },
          ],
          beforeSubmitPrompt: [{ command: GUARD_CMD }], // 假想历史残留（同 command 也删）
        },
      });
      const r = computeHooksConfigRemoval(existing, [GUARD_CMD]);
      assert(r.status === 'removed', r.status);
      const doc = JSON.parse(r.nextText!);
      assert(doc.team_meta?.owner === 'platform', '顶层字段保留');
      assert(doc.hooks.preToolUse.length === 1 && doc.hooks.preToolUse[0].command === './team/audit.sh', '第三方保留');
      assert(!('beforeSubmitPrompt' in doc.hooks), '删空的事件容器应清理');
      assert(r.emptyShell !== true, '仍有第三方条目不算空壳');
      // 纯自有文件卸载后 → 空壳标记
      const onlyOwn = computeHooksConfigUpsert(null, DESIRED).nextText!;
      const r2 = computeHooksConfigRemoval(onlyOwn, [GUARD_CMD]);
      assert(r2.status === 'removed' && r2.emptyShell === true, `纯自有清空应标 emptyShell：${JSON.stringify(r2)}`);
    },
  },
  {
    name: 'U7 创建：目标不存在 → {version:1, hooks:{preToolUse:[…]}} 最小结构',
    run: () => {
      const r = computeHooksConfigUpsert(null, DESIRED);
      assert(r.status === 'created', r.status);
      const doc = JSON.parse(r.nextText!);
      assert(doc.version === 1, 'version=1');
      assert(doc.hooks.preToolUse[0].command === GUARD_CMD, JSON.stringify(doc));
    },
  },
  // ------------------------------------------------------------------------
  // enforcement tier 回归（第三轮 P1）
  // ------------------------------------------------------------------------
  {
    name: 'T1 resolveEnforcementTier(cursor adapter.yaml) === soft_rule_only（hooks_config 不触发 hard_hook）',
    run: () => {
      const yamlText = fs.readFileSync(frameworkAbs(LAYOUT, 'agents/cursor/adapter.yaml'), 'utf-8');
      const doc = YAML.parse(yamlText) as Record<string, unknown>;
      assert(doc.hooks_config !== undefined, '前提：cursor 已声明 hooks_config');
      assert(doc.settings_file === undefined && doc.hooks === undefined, '前提：cursor 不声明 settings_file/hooks');
      const tier = resolveEnforcementTier(
        { settings_file: doc.settings_file, hooks: doc.hooks },
        { mode: 'interactive' },
      );
      assert(tier === 'soft_rule_only', `cursor tier 应保持 soft_rule_only，实际 ${tier}`);
    },
  },
  // ------------------------------------------------------------------------
  // cursor 守卫壳协议（deny = JSON + exit 0；第三轮 P2）
  // ------------------------------------------------------------------------
  {
    name: 'S1 cursor 壳：consumer fixture 写 framework/harness/scripts/tmp.mjs → {permission:deny} + exit 0（教育文案在 agent_message）',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-guard-'));
      try {
        // consumer fixture：framework/{manifest, specs/policy, agents/{shared,cursor/hooks}}
        const fw = path.join(root, 'framework');
        fs.mkdirSync(path.join(fw, 'agents', 'shared'), { recursive: true });
        fs.mkdirSync(path.join(fw, 'agents', 'cursor', 'hooks'), { recursive: true });
        fs.mkdirSync(path.join(fw, 'specs'), { recursive: true });
        fs.writeFileSync(path.join(fw, 'RELEASE-MANIFEST.json'), JSON.stringify({ schema_version: '1.0', files: [] }), 'utf-8');
        fs.copyFileSync(frameworkAbs(LAYOUT, 'specs/runtime-artifact-policy.json'), path.join(fw, 'specs', 'runtime-artifact-policy.json'));
        fs.copyFileSync(frameworkAbs(LAYOUT, 'agents/shared/guard-framework-write-core.mjs'), path.join(fw, 'agents', 'shared', 'guard-framework-write-core.mjs'));
        fs.copyFileSync(CURSOR_SHELL_ABS, path.join(fw, 'agents', 'cursor', 'hooks', 'guard-framework-write.mjs'));

        const run = (toolInput: Record<string, unknown>) =>
          spawnSync(process.execPath, [path.join(fw, 'agents', 'cursor', 'hooks', 'guard-framework-write.mjs')], {
            input: JSON.stringify({ hook_event_name: 'preToolUse', tool_name: 'Write', tool_input: toolInput, cwd: root }),
            encoding: 'utf-8',
            shell: false,
          });

        // deny：framework 内临时脚本
        const deny = run({ file_path: 'framework/harness/scripts/tmp-evil.mjs' });
        assert(deny.status === 0, `deny 协议 = JSON + exit 0（exit 2 不消费 JSON），实际 exit ${deny.status}`);
        const denyOut = JSON.parse(deny.stdout.trim());
        assert(denyOut.permission === 'deny', deny.stdout);
        assert(typeof denyOut.agent_message === 'string' && denyOut.agent_message.includes('scratch/'), '教育文案应经 agent_message 送达');
        assert(typeof denyOut.user_message === 'string' && denyOut.user_message.length > 0, 'user_message 应在');

        // allow：非 framework 路径
        const allow = run({ file_path: 'src/main.ets' });
        assert(allow.status === 0 && JSON.parse(allow.stdout.trim()).permission === 'allow', `${allow.stdout}`);

        // allow：运行时白名单
        const reports = run({ file_path: 'framework/harness/reports/x.json' });
        assert(JSON.parse(reports.stdout.trim()).permission === 'allow', reports.stdout);

        // 宽容字段解析：path 字段（cursor payload 字段以宿主实测为准，壳按候选宽容解析）
        const viaPath = run({ path: 'framework/skills/x.md' });
        assert(JSON.parse(viaPath.stdout.trim()).permission === 'deny', viaPath.stdout);

        // fail-open：非法 stdin
        const bad = spawnSync(process.execPath, [path.join(fw, 'agents', 'cursor', 'hooks', 'guard-framework-write.mjs')], {
          input: 'not-json',
          encoding: 'utf-8',
          shell: false,
        });
        assert(bad.status === 0 && JSON.parse(bad.stdout.trim()).permission === 'allow', `非法 payload 应 fail-open allow：${bad.stdout}`);

        // 第七轮 codex P1-3：cwd=子目录 + 绝对路径目标——仓库身份取脚本物理布局，不信 cwd
        const subdir = path.join(root, 'subdir');
        fs.mkdirSync(subdir, { recursive: true });
        const evilAbs = path.join(root, 'framework', 'harness', 'scripts', 'tmp-evil2.mjs');
        const subCwd = spawnSync(process.execPath, [path.join(fw, 'agents', 'cursor', 'hooks', 'guard-framework-write.mjs')], {
          input: JSON.stringify({ hook_event_name: 'preToolUse', tool_name: 'Write', tool_input: { file_path: evilAbs }, cwd: subdir }),
          encoding: 'utf-8',
          shell: false,
        });
        assert(
          JSON.parse(subCwd.stdout.trim()).permission === 'deny',
          `cwd=子目录不得让守卫 fail-open：${subCwd.stdout}`,
        );
        // 相对路径以 cwd 解析（agent 在子目录跑工具写上级 framework）
        const relFromSub = spawnSync(process.execPath, [path.join(fw, 'agents', 'cursor', 'hooks', 'guard-framework-write.mjs')], {
          input: JSON.stringify({ hook_event_name: 'preToolUse', tool_name: 'Write', tool_input: { file_path: '../framework/skills/x.md' }, cwd: subdir }),
          encoding: 'utf-8',
          shell: false,
        });
        assert(JSON.parse(relFromSub.stdout.trim()).permission === 'deny', `相对路径按 cwd 解析后仍应拦：${relFromSub.stdout}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'S2 模板与壳一致：templates/hooks.json 的 command 指向真实存在的壳脚本（ownership key 锚点）',
    run: () => {
      const tpl = JSON.parse(fs.readFileSync(CURSOR_TEMPLATE_ABS, 'utf-8'));
      const cmd: string = tpl.hooks.preToolUse[0].command;
      assert(cmd === GUARD_CMD, `模板 command 漂移：${cmd}`);
      const relScript = cmd.replace(/^node\s+/, '').replace(/^framework\//, '');
      assert(fs.existsSync(frameworkAbs(LAYOUT, relScript)), `command 指向的脚本不存在：${relScript}`);
    },
  },
];

export function runAll(): Promise<UnitCaseResult[]> {
  return run();
}

async function run(): Promise<UnitCaseResult[]> {
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
