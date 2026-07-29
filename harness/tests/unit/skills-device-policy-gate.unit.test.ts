// ============================================================================
// skills-device-policy-gate.unit.test.ts — 设备策略前置的**两模式覆盖**元门禁
//                                          （openspec device-readiness-and-completion t5）
// ----------------------------------------------------------------------------
// 缺口复盘：Todo 5 只按 plan 的字面（`outer_layers`，goal 的概念）给 goal-mode 接了
// 设备策略前置，`business-ut` 与 `device-testing` 两个**普通模式**入口一个都没接。
// 后果不是安全问题（就绪门照样挡住锁屏、不会去猜密码），而是用户在普通模式下只会
// 看到一句干巴巴的"设备锁屏"，**没人告诉他还有"启用自动解锁"这个选项**——违反框架
// 自己的"goal 与普通模式能力持续拉齐"原则。
//
// 这条门禁把"哪些 skill 必须有设备策略前置"变成**由 profile 声明推导**的机器判定，
// 而不是靠人记得改文档。新增需设备的 phase 时，缺登记会直接红。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { PHASE_CAPABILITY_MAP } from '../../scripts/utils/phase-personal-prerequisites';
import type { UnitCaseResult } from '../run-unit';

function run(results: UnitCaseResult[], name: string, fn: () => void): void {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: (err as Error).stack ?? (err as Error).message });
  }
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
function assertEq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const REPO = path.join(__dirname, '..', '..', '..');
const SKILLS = path.join(REPO, 'skills');
const GATE_DOC_REL = 'reference/device-policy-gate.md';

/**
 * phase → 承载该 phase 的 skill 文件（普通模式入口）。
 *
 * **必须覆盖 `PHASE_CAPABILITY_MAP` 的每一个 key**——下面有一条断言盯着，
 * 新增 phase 时漏登记会直接红，而不是静默假绿。
 */
const PHASE_SKILL: Record<string, string> = {
  coding: 'feature/coding/SKILL.md',
  ut: 'feature/business-ut/SKILL.md',
  testing: 'feature/device-testing/SKILL.md',
};

/** goal 模式入口（普通模式之外的另一条链，同样须有前置） */
const GOAL_SKILL = 'project/goal-mode/SKILL.md';

function readProfileDeviceCapabilities(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const profilesRoot = path.join(REPO, 'profiles');
  for (const ent of fs.readdirSync(profilesRoot, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const yamlPath = path.join(profilesRoot, ent.name, 'profile.yaml');
    if (!fs.existsSync(yamlPath)) continue;
    const raw = fs.readFileSync(yamlPath, 'utf-8');
    // 只取 `device_capabilities:` 下的列表项（到下一个顶层键为止）
    const m = /^device_capabilities:\s*$([\s\S]*?)^\S/m.exec(raw);
    if (!m) {
      out.set(ent.name, []);
      continue;
    }
    const caps = [...m[1].matchAll(/^\s*-\s*([\w.]+)\s*$/gm)].map(x => x[1]);
    out.set(ent.name, caps);
  }
  return out;
}

/** 该 phase 是否会碰设备（由 profile 声明 × PHASE_CAPABILITY_MAP 推导，不硬编码） */
function phasesNeedingDevice(): Set<string> {
  const needed = new Set<string>();
  for (const caps of readProfileDeviceCapabilities().values()) {
    for (const [phase, phaseCaps] of Object.entries(PHASE_CAPABILITY_MAP)) {
      if ((phaseCaps ?? []).some(c => caps.includes(c))) needed.add(phase);
    }
  }
  return needed;
}

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];

  run(results, '设备策略门文档存在，且含四选一与"PIN 不进对话"红线', () => {
    const doc = fs.readFileSync(path.join(SKILLS, GATE_DOC_REL), 'utf-8');
    assert(/scripts\/device-policy\.ts --check --json/.test(doc), '须给出探测命令');
    assert(/device_policy_unset/.test(doc), '须说明未配置的 code');
    // `npm run` 会往 stdout 插 banner，JSON 就 parse 不了——门文档里**一处都不能残留**
    assert(
      !/npm run device:policy/.test(doc),
      '不得出现 `npm run device:policy`（banner 会污染 stdout，与"仅解析 JSON"自相矛盾）',
    );
    // 退出码契约必须是**两段**判定，不能写成"恒 0、不看退出码"那种绝对话——
    // 配置损坏等真实执行错误仍会非零，忽略它会让 agent 带着坏配置继续跑
    assert(/非零|执行失败/.test(doc), '须说明非零退出＝执行失败须停止');
    assert(/合法 JSON|JSON\.parse|非法 JSON/.test(doc), '须说明 stdout 非合法 JSON 也算失败');
    for (const opt of ['手工解锁', '启用自动解锁', '模拟器降级', '本次停止']) {
      assert(doc.includes(opt), `四选一须含「${opt}」`);
    }
    assert(/device:enroll/.test(doc), '须给出登记命令');
    assert(
      /绝不要让用户把 PIN 发到对话里/.test(doc) && /不得代跑|代为输入/.test(doc),
      '须保留"PIN 不进对话、agent 不代跑"红线',
    );
    assert(/任何一次解锁失败即机器级烧毁/.test(doc), '须说明失败即烧毁（止损设计要让人看懂）');
  });

  run(results, 'phase→skill 登记表**覆盖** PHASE_CAPABILITY_MAP（新增 phase 漏登记即红）', () => {
    for (const phase of Object.keys(PHASE_CAPABILITY_MAP)) {
      assert(
        PHASE_SKILL[phase] !== undefined,
        `phase「${phase}」未登记承载它的 skill——新增 phase 时必须同步本表，` +
          '否则设备策略前置的覆盖检查会静默漏掉它',
      );
      assert(
        fs.existsSync(path.join(SKILLS, PHASE_SKILL[phase])),
        `登记的 skill 文件不存在：${PHASE_SKILL[phase]}`,
      );
    }
  });

  run(results, '**每个需设备的 phase**，其 skill 必须引用设备策略门（普通模式不得漏）', () => {
    const needing = phasesNeedingDevice();
    assert(needing.size > 0, '应至少推导出一个需设备的 phase（hmos-app 声明了 ut/testing）');
    const missing: string[] = [];
    for (const phase of needing) {
      const rel = PHASE_SKILL[phase];
      const text = fs.readFileSync(path.join(SKILLS, rel), 'utf-8');
      if (!text.includes('device-policy-gate')) missing.push(`${phase} → ${rel}`);
    }
    assertEq(
      missing.length,
      0,
      `以下需设备的 phase 缺设备策略前置（goal 与普通模式必须能力拉齐）：\n  - ${missing.join('\n  - ')}`,
    );
  });

  run(results, 'goal 模式同样引用同一份门文档（两条链不得各写一套）', () => {
    const goal = fs.readFileSync(path.join(SKILLS, GOAL_SKILL), 'utf-8');
    assert(goal.includes('device-policy-gate'), 'goal-mode 须引用设备策略门');
    // 关键红线在 goal 侧也要能就地看到（detached runner 错过窗口就只能一路 BLOCKED）
    assert(/绝不要让用户把 PIN\s*\n?\s*发到对话里|绝不要让用户把 PIN 发到对话里/.test(goal), 'goal-mode 须就地保留 PIN 红线');
  });

  run(results, '**探测契约在所有承载处一致**（旧命令/绝对化表述一处都不许残留）', () => {
    // 这条是被"同类残留漏两次"逼出来的：第一次漏在门文档第 75 行，
    // 第二次漏在 registry 的 notes。只盯单个文件的断言必然重蹈覆辙——
    // 改为**枚举全部承载该契约的文件**逐一检查。
    const carriers = [
      GATE_DOC_REL,
      'reference/confirmation-registry.yaml',
      GOAL_SKILL,
      ...Object.values(PHASE_SKILL),
    ];
    const staleCmd: string[] = [];
    const absoluteWording: string[] = [];
    for (const rel of carriers) {
      const full = path.join(SKILLS, rel);
      if (!fs.existsSync(full)) continue;
      const text = fs.readFileSync(full, 'utf-8');
      // 只检查真正提到设备策略探测的文件（coding SKILL 等不涉及，跳过）
      if (!/device-policy/.test(text)) continue;
      // ① 旧命令：npm run 会往 stdout 插 banner，与"仅解析 JSON"直接冲突
      if (/npm run device:policy/.test(text)) staleCmd.push(rel);
      // ② 绝对化表述：真实执行错误（配置损坏等）仍会非零，
      //    "恒 0 / 不看退出码"会让 agent 带着坏配置继续跑
      if (/退出码恒 0|不看退出码|一切看 `code` 字段。/.test(text)) absoluteWording.push(rel);
    }
    assertEq(
      staleCmd.length,
      0,
      `以下文件仍用 \`npm run device:policy\`（banner 污染 stdout）：${staleCmd.join(', ')}`,
    );
    assertEq(
      absoluteWording.length,
      0,
      `以下文件把退出码契约写成绝对化表述（须为"0 且合法 JSON → 看 code；否则执行失败须停止"两段）：${absoluteWording.join(', ')}`,
    );
  });

  run(results, '不需设备的 phase **不强制**加前置（避免无谓噪声）', () => {
    // coding 只声明 coding.compile，不在任何 profile 的 device_capabilities 里 →
    // 不应被要求加设备策略前置。这条防的是"一刀切给所有 skill 加门"。
    const needing = phasesNeedingDevice();
    assertEq(needing.has('coding'), false, 'coding 不该被判为需设备');
  });

  return results;
}
