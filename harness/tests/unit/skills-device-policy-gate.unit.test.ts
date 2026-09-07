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
    assert(/实际尝试输入后/.test(doc) && /才烧毁/.test(doc), '须说明仅实际尝试输入后才烧毁（零输入分支不烧毁，止损设计要让人看懂）');
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

  // -------------------------------------------------------------------------
  // 解锁 / 设备就绪的「正道」话术（plan c7d2a9e4 V5）
  // 缺口复盘：文档只写禁令（不碰 PIN / 不徒手处置锁屏），没有一句「用户要解锁且凭据
  // 可用时该怎么做」，且 SKILL 把 feature/receipt/acceptance 前置摆在模式分流之前 →
  // 宿主 agent 面对「解锁手机」既进不去流程也不敢动手，只会反复拒绝。
  // -------------------------------------------------------------------------

  run(results, 'device-testing SKILL 先分流后前置，且设备就绪请求可识别', () => {
    const skill = fs.readFileSync(path.join(SKILLS, PHASE_SKILL.testing), 'utf-8');
    const routeIdx = skill.indexOf('## 请求分流');
    const preIdx = skill.indexOf('## 前置');
    assert(routeIdx >= 0, 'SKILL 须有「## 请求分流」顶节（设备级请求先判后进）');
    assert(preIdx >= 0, 'SKILL 须保留「## 前置」段');
    assert(routeIdx < preIdx, '「## 请求分流」必须排在「## 前置」之前——否则设备级请求仍会先撞 feature/acceptance 前置');
    // 前置只对正式模式成立：即席与设备就绪不该被 feature/receipt/acceptance 挡住
    const preBlock = skill.slice(preIdx, skill.indexOf('\n## ', preIdx + 1));
    assert(/只适用于正式模式/.test(preBlock), '「前置」段首须限定「只适用于正式模式」');
    assert(/解锁手机/.test(skill), '触发条件须含「解锁手机」（自然语言直达设备就绪轨）');
    assert(/--ready --json/.test(skill), 'SKILL 分流表须给出 `--ready --json` 正道命令');
  });

  run(results, '设备策略门文档有「正道节」：怎么解锁、结果怎么说、不重复起门', () => {
    const doc = fs.readFileSync(path.join(SKILLS, GATE_DOC_REL), 'utf-8');
    assert(/##\s*用户要求解锁 \/ 操作设备时的正道/.test(doc), '须有解锁正道节标题');
    assert(/scripts\/device-policy\.ts --ready --json/.test(doc), '正道节须给出 `--ready --json` 命令');
    assert(/不碰 PIN ≠ 不能解锁/.test(doc), '须有「不碰 PIN ≠ 不能解锁」定性——只写禁令正是本次事故的根因');
    // `ok` 不等于「手机已解锁」：三态必须逐个说清，否则模拟器会被说成真机
    for (const kind of ['physical', 'emulator', 'unknown']) {
      assert(doc.includes(`\`${kind}\``), `须按 target_kind 三态说话，缺 \`${kind}\``);
    }
    assert(/已授权.{0,4}模拟器/.test(doc), 'emulator 态须说「手机未就绪、已授权模拟器可用」而不是「已解锁」');
    // 反向钉：不得教「先 --ready 再即席」（重复起门，managed 档会起停两趟）；
    // 允许**禁令**形态的同款字样（"不要先 `--ready` 再即席"），只拦正向指令。
    const bad = doc
      .split('\n')
      .filter(line => /先\s*`?--ready`?\s*再.{0,6}即席|先 ready 再即席/.test(line))
      .filter(line => !/不要|不得|禁止|勿/.test(line));
    assertEq(bad.length, 0, `不得把「先 --ready 再即席」写成正向指令：\n  ${bad.join('\n  ')}`);
  });

  run(results, '执行规则与命令模板：禁手写解锁脚本、「解锁手机」有入口映射', () => {
    const mdc = fs.readFileSync(
      path.join(REPO, 'agents/shared/agent-bundle/templates/rules/framework-agent-execution.mdc'),
      'utf-8',
    );
    assert(/ensureUnlocked/.test(mdc) && /不得为解锁/.test(mdc), '§1 须禁止手写脚本直调 `ensureUnlocked` 等 harness 内部函数');
    assert(/解锁手机/.test(mdc) && /--ready --json/.test(mdc), '§2 须把「解锁手机」映射到 agent 自跑 `--ready --json`');

    const cmdRels = ['claude', 'codeagent', 'cursor'].map(a => `agents/${a}/templates/commands/device-testing.md`);
    const hints = new Set<string>();
    for (const rel of cmdRels) {
      const text = fs.readFileSync(path.join(REPO, rel), 'utf-8');
      const m = /^argument-hint:\s*(.+)$/m.exec(text);
      assert(m !== null, `${rel} 缺 argument-hint`);
      hints.add((m as RegExpExecArray)[1].trim());
      assert(/请求分流/.test(text), `${rel} 须指向 SKILL 的「请求分流」节（无 feature 名也能进）`);
    }
    assertEq(hints.size, 1, `三个 adapter 的 argument-hint 必须一致，实际：${[...hints].join(' | ')}`);
    assertEq([...hints][0], '[feature-name]', 'feature 名对设备就绪/即席不是必填，argument-hint 须为可选形态');

    const registry = fs.readFileSync(path.join(SKILLS, 'reference/confirmation-registry.yaml'), 'utf-8');
    assert(/--ready/.test(registry), 'registry notes 须改为「落盘/登记后由 agent 跑 `--ready`」确认');
  });

  run(results, '不需设备的 phase **不强制**加前置（避免无谓噪声）', () => {
    // coding 只声明 coding.compile，不在任何 profile 的 device_capabilities 里 →
    // 不应被要求加设备策略前置。这条防的是"一刀切给所有 skill 加门"。
    const needing = phasesNeedingDevice();
    assertEq(needing.has('coding'), false, 'coding 不该被判为需设备');
  });

  return results;
}
