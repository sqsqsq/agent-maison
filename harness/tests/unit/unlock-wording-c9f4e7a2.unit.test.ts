// ============================================================================
// unlock-wording-c9f4e7a2.unit.test.ts — 解锁话术统一（事故修复四件套 plan c9f4e7a2 t3）
// ----------------------------------------------------------------------------
// 8 处运行时出口逐处断言"新语义锚点在、旧绝对句不在"；并保证 spec MUST 措辞
// 「请人解锁真机」（upstream-verdict-gate）仍在位。grep 清零口径限定发布/运行时路径
// （harness/ + profiles/ + skills/ + docs/），排除 .cursor/plans 与 openspec/changes/archive
// 中的历史引文（那些是事故记录，改了反而丢失现场）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import type { UnitCaseResult } from '../run-unit';

const REPO = path.join(__dirname, '..', '..', '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(REPO, rel), 'utf-8');
}

function contains(rel: string, needle: string): boolean {
  return read(rel).includes(needle);
}

/**
 * 归一化：去掉行首 `//` 注释前缀、markdown 加粗/代码标记、折叠全部空白（含换行）。
 * 用于让"跨行 + 跨注释 + 夹 markdown 标记"的旧述也能被逐字匹配抓到——否则旧 bug
 * 可在测试全绿时重新出现（codex review：原始"任何一次失败\n// 即机器级锁死"逐字 includes 命中 0）。
 */
function normalize(text: string): string {
  return text
    .replace(/^\s*\/\/\s*/gm, '')
    .replace(/[*`]/g, '')
    .replace(/\s+/g, '');
}

/** 返回文本中含有的无条件 burn 断言（归一化后匹配） */
function unconditionalBurnMatches(text: string): string[] {
  const t = normalize(text);
  return ABSOLUTE_BURN.filter((b) => t.includes(normalize(b)));
}

/** 返回文本中含有的旧绝对句（归一化后匹配） */
function absoluteOldPhraseMatches(text: string): string[] {
  const t = normalize(text);
  return ABSOLUTE_OLD_PHRASES.filter((o) => t.includes(normalize(o)));
}

/** 8 处生产出口：文件 + 新语义锚点（旧绝对句"框架不会尝试任何口令/框架不会替你解锁设备"须不在） */
const EXITS: Array<{ rel: string; anchor: string; count?: number }> = [
  // ① goal-runner 笼统尾句：**删除**——旧句不在即达标（anchor 置空，仅做缺席校验）
  { rel: 'harness/scripts/goal-runner.ts', anchor: '' },
  // ② upstream-verdict-gate：保留「请人解锁真机」短语、前提改为不排他
  { rel: 'harness/scripts/utils/upstream-verdict-gate.ts', anchor: '请人解锁真机并保持前台' },
  // ③ check-testing L1655
  { rel: 'harness/scripts/check-testing.ts', anchor: '框架不会猜测或枚举未登记的口令' },
  // ④ check-testing L2510 条件式：自动恢复未完成 + 稍后重试或重新登记
  { rel: 'harness/scripts/check-testing.ts', anchor: '自动恢复未完成' },
  // ⑤ device-runtime-recovery L90
  { rel: 'harness/scripts/utils/device-runtime-recovery.ts', anchor: '框架不会猜测或枚举未登记的口令' },
  // ⑥⑦ hdc-runner L1333 / L1347（preReady.blocked：前面 note 已给具体原因，尾句用通用式）
  { rel: 'profiles/hmos-app/harness/hdc-runner.ts', anchor: '按前述具体原因稍后重试或重新登记', count: 2 },
  // ⑧ device-test-install L366（同上）
  { rel: 'profiles/hmos-app/harness/providers/device-test-install.ts', anchor: '按前述具体原因稍后重试或重新登记' },
];

const ABSOLUTE_OLD_PHRASES = ['框架不会尝试任何口令', '框架不会替你解锁设备'];

/**
 * 无条件 burn 断言正则（归一化后匹配）。
 * 用单条正则而非字面量枚举——措辞变体（含/不含「机器级」、跨行、markdown 标记）都能覆盖，
 * 枚举字面量天然补不全变体（claude review：device-unlock-helper 原文「任何一次失败即烧毁」
 * 无「机器级」，四条字面量均漏）。对 4 个文件改前原文 4/4 命中、改后现文 0 误伤。
 */
const ABSOLUTE_BURN_RE = /任何一次(解锁)?失败即(机器级)?(烧毁|disabled|锁死)/;

/** 返回文本中含有的无条件 burn 断言（归一化后正则匹配） */
function unconditionalBurnMatches(text: string): string[] {
  const t = normalize(text);
  const m = ABSOLUTE_BURN_RE.exec(t);
  return m ? [m[0]] : [];
}

/** 运行时/发布路径（不含 .cursor/plans 与 openspec/changes/archive 的历史引文） */
const SCAN_DIRS = ['harness', 'profiles', 'skills', 'docs'];

function scanDirs(): string[] {
  const out: string[] = [];
  for (const dir of SCAN_DIRS) {
    const root = path.join(REPO, dir);
    if (!fs.existsSync(root)) continue;
    const stack = [root];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
        const full = path.join(cur, ent.name);
        if (ent.isDirectory()) {
          if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name === 'fixtures' || ent.name === 'tests') continue;
          stack.push(full);
          continue;
        }
        if (/\.(ts|md|yaml|yml)$/.test(ent.name)) out.push(full);
      }
    }
  }
  return out;
}

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  const run = (name: string, fn: () => void): void => {
    try {
      fn();
      results.push({ name, ok: true });
    } catch (err) {
      results.push({ name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  };

  run('t3 8 处出口：新语义锚点在位、旧绝对句不在', () => {
    for (const e of EXITS) {
      const text = read(e.rel);
      if (e.anchor) {
        const occ = text.split(e.anchor).length - 1;
        if (occ === 0) throw new Error(`${e.rel} 缺新语义锚点「${e.anchor}」`);
        if (e.count !== undefined && occ !== e.count) {
          throw new Error(
            `${e.rel} 锚点「${e.anchor}」应恰出现 ${e.count} 次，实得 ${occ} 次` +
              '（hdc-runner 两出口须逐处断言，任一处单独回退即红）',
          );
        }
      }
      const old = absoluteOldPhraseMatches(text);
      if (old.length > 0) throw new Error(`${e.rel} 仍含旧绝对句：${old.join('、')}`);
    }
    // ④ 条件式出口：既不能断言 burn、也不能断言「框架不会尝试任何口令」
    const ct = read('harness/scripts/check-testing.ts');
    if (!/稍后重试或重新登记/.test(ct)) throw new Error('check-testing 条件式出口缺「稍后重试或重新登记」出路');
  });

  run('spec MUST 措辞：upstream-verdict-gate 保留「请人解锁真机」与「不要尝试自行解锁设备」红线', () => {
    const text = read('harness/scripts/utils/upstream-verdict-gate.ts');
    if (!text.includes('请人解锁真机')) throw new Error('upstream-verdict-gate 须保留「请人解锁真机」（spec MUST 要求）');
    if (!text.includes('不要尝试自行解锁设备')) throw new Error('upstream-verdict-gate 须保留「不要尝试自行解锁设备」红线');
  });

  run('发布/运行时路径 grep 清零：无「框架不会尝试任何口令」「框架不会替你解锁设备」及无条件 burn 断言', () => {
    const offenders: string[] = [];
    for (const full of scanDirs()) {
      const rel = path.relative(REPO, full).replace(/\\/g, '/');
      const text = fs.readFileSync(full, 'utf-8');
      for (const old of absoluteOldPhraseMatches(text)) offenders.push(`${rel} 含「${old}」`);
      for (const burn of unconditionalBurnMatches(text)) offenders.push(`${rel} 含无条件 burn 断言「${burn}」`);
    }
    if (offenders.length > 0) {
      throw new Error(`发布/运行时路径残留绝对话术：\n  - ${offenders.join('\n  - ')}`);
    }
  });

  run('自测：跨行 + 跨注释 + 带 markdown 标记 + 无「机器级」的旧 burn 述可被归一化+正则抓到（防测试假绿）', () => {
    // codex review：逐字 includes 对旧源码命中 0——旧述跨行且夹 `//`；
    // claude review：goal-mode 原句夹 `**机器级**` 与反引号，逐字匹配不到；
    // claude review：device-unlock-helper 原文「任何一次失败即烧毁」无「机器级」，字面量枚举漏。
    const oldStore =
      '// 尝试次数——且任何一次失败\n' +
      '// 即机器级锁死**。';
    const oldOps = '任何一次失败即**机器级** `disabled`';
    const oldHelper =
      '//   - 只用登记凭据，且任何一次失败即\n' +
      '//     烧毁该凭据版本';
    const gotStore = unconditionalBurnMatches(oldStore);
    const gotOps = unconditionalBurnMatches(oldOps);
    const gotHelper = unconditionalBurnMatches(oldHelper);
    if (!gotStore.includes('任何一次失败即机器级锁死')) {
      throw new Error(`跨行旧述应命中「任何一次失败即机器级锁死」，实得：[${gotStore.join(', ')}]`);
    }
    if (!gotOps.includes('任何一次失败即机器级disabled')) {
      throw new Error(`markdown 标记旧述应命中「任何一次失败即机器级disabled」，实得：[${gotOps.join(', ')}]`);
    }
    if (!gotHelper.includes('任何一次失败即烧毁')) {
      throw new Error(`无「机器级」旧述应命中「任何一次失败即烧毁」，实得：[${gotHelper.join(', ')}]`);
    }
  });

  run('文档三处正向锚点在位（device-policy 指南 / device-policy-gate / goal-mode-operations）', () => {
    if (!read('harness/scripts/device-policy.ts').includes('登记后设备阶段由框架自动解锁'))
      throw new Error('device-policy.ts guidance 缺「登记后设备阶段由框架自动解锁」');
    const gate = read('skills/reference/device-policy-gate.md');
    if (!gate.includes('实际尝试输入后')) throw new Error('device-policy-gate.md 缺「实际尝试输入后」限定');
    if (!gate.includes('不得绕开框架徒手处置锁屏')) throw new Error('device-policy-gate.md 缺「不得绕开框架徒手处置锁屏」');
    const ops = read('skills/reference/goal-mode-operations.md');
    if (!ops.includes('允许（正道）')) throw new Error('goal-mode-operations.md 缺「允许（正道）」行');
    if (!ops.includes('实际尝试输入后')) throw new Error('goal-mode-operations.md 缺「实际尝试输入后」限定');
  });

  run('t4 rebind 可发现性：device-policy-gate.md 与 unset 指引均含 rebind 恢复分支、version 来源与禁止枚举/回退', () => {
    const gate = read('skills/reference/device-policy-gate.md');
    if (!gate.includes('device:rebind')) throw new Error('device-policy-gate.md 缺 device:rebind 命令');
    if (!gate.includes('不枚举版本、不选最高版本、不回退旧版本'))
      throw new Error('device-policy-gate.md 缺「不枚举版本、不选最高版本、不回退旧版本」');
    if (!gate.includes('`#burned`')) throw new Error('device-policy-gate.md 缺 `#burned` 墓碑提示');
    const dp = read('harness/scripts/device-policy.ts');
    if (!dp.includes('--rebind')) throw new Error('device-policy.ts unset 指引缺 --rebind 恢复分支');
    if (!dp.includes('不枚举版本、不选最高、不回退旧版本'))
      throw new Error('device-policy.ts unset 指引缺禁止枚举/回退说明');
  });

  return results;
}