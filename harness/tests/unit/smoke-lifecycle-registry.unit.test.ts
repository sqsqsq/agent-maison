// ============================================================================
// smoke-lifecycle-registry.unit.test.ts — 整机 smoke 的**注册表**与 stage 接线
//                                          （e5d8a2c4 T4 骨架）
// ----------------------------------------------------------------------------
// 为什么这几条要放在 CI 单测里，而不是只靠整机 smoke 自己：
// 整机 smoke 跑一次要 pack + npm install，分钟级，不适合每次改动都跑；但**注册表
// 缩水**是最廉价也最致命的假绿形态——悄悄把一个 pending 用例删掉，smoke 立刻
// "全覆盖 PASS"。所以把「注册表必须覆盖 plan 已知连续编号」「covered 必须指到真实
// stage」这类结构约束下放到秒级单测，整机链本身只管跑。
//
// 对照既有硬学习：CORE_SUITES 显式注册表——新套件不注册 = 假绿。这里是它的镜像：
// **少注册也是假绿**。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { deriveRepoLayout } from '../helpers/goal-run-driver';
import type { UnitCaseResult } from '../run-unit';

const SMOKE_MODULE = path.resolve(__dirname, '..', '..', '..', 'scripts', 'smoke-consumer-lifecycle.mjs');

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}
function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) throw new Error(`${msg}（期望 ${String(expected)}，实得 ${String(actual)}）`);
}

interface SmokeCase {
  id: number;
  name: string;
  status: string;
  coveredBy?: string;
}
interface SmokeModule {
  CASE_REGISTRY: SmokeCase[];
  STAGES: Array<{ id: string }>;
  HISTORICAL_GITIGNORE: string;
  assertCaseRegistryComplete(registry?: SmokeCase[], stages?: Array<{ id: string }>): SmokeCase[];
}

// ts-node(commonjs) 会把 `import()` 降级成 require()，加载不了 .mjs——用 Function 包一层
// 保住真正的动态 import（与 release-shipped-in-ignored-dirs / guard-framework-write 同款）。
// Windows 下路径必须经 pathToFileURL：手拼 `file://D:/…` 少一个斜杠即 MODULE_NOT_FOUND。
const dynamicImport = new Function('s', 'return import(s)') as (s: string) => Promise<unknown>;

async function load(): Promise<SmokeModule> {
  const { pathToFileURL } = await import('url');
  return (await dynamicImport(pathToFileURL(SMOKE_MODULE).href)) as SmokeModule;
}

async function run(results: UnitCaseResult[], name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, error: (e as Error).message });
  }
}

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];

  await run(results, '注册表连续无空洞，且覆盖 plan 已定义的全部用例（含升级事故 #9）', async () => {
    const m = await load();
    const ids = m.CASE_REGISTRY.map(c => c.id);
    assert(ids.every((id, i) => id === i + 1), `编号须从 1 起连续无空洞，实得 [${ids.join(',')}]`);

    // **这一条是本轮 codex 抓出的洞的定桩**：初版硬断言"恰好七条"，于是 plan 后补的
    // #8（总纲 A【P0】）不在册也照绿——守门函数把自己的漏洞钉死了。
    const eight = m.CASE_REGISTRY.find(c => c.id === 8);
    assert(eight !== undefined, 'plan A【P0】定义的 #8（fresh head 失配）必须在册');
    // T2 5a-1（2026-08-07）落地：#8 已由 goal stage 第四段整机覆盖——登记态随之转正。
    // 本断言从"须如实 pending"翻为"须 covered 且指向 goal"（登记态回退=行为丢失预警）。
    assertEq(eight!.status, 'covered', '#8 已实现（5a-1），登记态不得回退 pending');
    assertEq(eight!.coveredBy, 'goal', '#8 整机面由 goal stage 覆盖');
    const nine = m.CASE_REGISTRY.find(c => c.id === 9);
    assert(nine !== undefined, '2026-09-01 发布件升级事故 #9 必须在册');
    assertEq(nine!.status, 'covered', '#9 必须由真实 stage 覆盖');
    assertEq(nine!.coveredBy, 'upgradeOverlay', '#9 必须指向 upgradeOverlay stage');
    assert(m.STAGES.some(s => s.id === 'upgradeOverlay'), 'upgradeOverlay stage 必须真实存在');

    const four = m.CASE_REGISTRY.find(c => c.id === 4);
    assert(four !== undefined, 'T2 5b 的 #4 必须在注册表');
    assertEq(four!.status, 'covered', '#4 cache miss 行为已由整机 goal 覆盖');
    assertEq(four!.coveredBy, 'goal', '#4 必须由真实 goal stage 覆盖');
    const six = m.CASE_REGISTRY.find(c => c.id === 6);
    assert(six !== undefined, 'T2 5c 的 #6 必须在注册表');
    assertEq(six!.status, 'covered', '#6 原子失效 crash 窗已由整机 goal 覆盖');
    assertEq(six!.coveredBy, 'goal', '#6 必须由真实 goal stage 覆盖');

    // 守门函数本身必须真的会拒——否则它只是个摆设
    let gap = false;
    try { m.assertCaseRegistryComplete(m.CASE_REGISTRY.filter(c => c.id !== 4)); } catch { gap = true; }
    assert(gap, '中间缺一条（出现空洞）时守门函数必须抛');
    let short = false;
    try { m.assertCaseRegistryComplete(m.CASE_REGISTRY.filter(c => c.id <= 8)); } catch { short = true; }
    assert(short, '末尾少登记升级事故 #9 时守门函数必须抛');
  });

  await run(results, 'T4 covered 必须指向**真实存在**的 stage（不得指空）', async () => {
    const m = await load();
    const stageIds = new Set(m.STAGES.map(s => s.id));
    const covered = m.CASE_REGISTRY.filter(c => c.status === 'covered');
    assert(covered.length > 0, '骨架期也须至少有一条真跑覆盖，否则整机链只是空壳');
    for (const c of covered) {
      assert(
        c.coveredBy !== undefined && stageIds.has(c.coveredBy),
        `用例 #${c.id} 声称由 stage:${c.coveredBy} 覆盖，但该 stage 不存在（stages=${[...stageIds].join(',')}）`,
      );
    }
    // 声称 covered 却不指 stage → 守门函数须拒
    let threw = false;
    try {
      m.assertCaseRegistryComplete(
        m.CASE_REGISTRY.map(c => (c.id === 1 ? { ...c, coveredBy: undefined } : c)),
      );
    } catch { threw = true; }
    assert(threw, 'covered 而不指明 stage 必须抛');
    let missingStage = false;
    try {
      m.assertCaseRegistryComplete(m.CASE_REGISTRY, m.STAGES.filter(s => s.id !== 'upgradeOverlay'));
    } catch { missingStage = true; }
    assert(missingStage, '删除 upgradeOverlay stage 时 registry 本体必须失败');
  });

  await run(results, 'runtime integrity stage/export/reference 已清零', async () => {
    const source = fs.readFileSync(SMOKE_MODULE, 'utf-8');
    for (const forbidden of ['stageIntegrity', 'runIntegrityPreflight', "id: 'integrity'", 'framework_control_plane_dirty']) {
      assert(!source.includes(forbidden), `smoke 不得残留 ${forbidden}`);
    }
  });

  await run(results, 'T4 生命周期各段齐全且有序；**clone 之后**才装依赖并切执行根', async () => {
    const m = await load();
    const order = m.STAGES.map(s => s.id);
    assertEq(
      order.join('→'),
      'install→depsHost→commit→clone→depsClone→upgradeOverlay→checkGlobal→goal',
      'stage 顺序即宿主真实时间线，乱序＝测了个别的东西',
    );
    // 初版把执行根绑死在 clone **之前**的副本上，clone 后只把路径当参数传进去检查，
    // 被 CRLF 改写过的代码从未真正执行过（codex 第七批 P1）。这条钉住顺序前提。
    assert(
      order.indexOf('depsClone') > order.indexOf('clone'),
      'depsClone 必须在 clone 之后——它负责把执行根切到换机副本',
    );
    for (const after of ['upgradeOverlay', 'checkGlobal', 'goal']) {
      assert(
        order.indexOf(after) > order.indexOf('depsClone'),
        `${after} 必须在 depsClone 之后，否则跑的仍是 clone 前的旧副本`,
      );
    }
  });

  await run(results, 'T4 历史宽规则夹具必须含 2026-04-25 的目录式规则（事故①的真实起点）', async () => {
    const m = await load();
    // 少了它，commit stage 就退化成"在一个干净仓里 add 一遍"——事故①根本不会重现
    for (const rule of ['framework/harness/trace/', 'framework/harness/reports/', 'framework/harness/state/']) {
      assert(
        m.HISTORICAL_GITIGNORE.includes(`\n${rule}\n`),
        `夹具须含历史目录式宽规则 ${rule}（canonical-gitignore.ts:100 记录的宿主实况）`,
      );
    }
  });

  await run(results, 'T4 goal driver 的 layout 按两根关系派生：嵌套＝consumer，外置＝standalone', async () => {
    // codex 第十批 P1：driver 初版恒注入 `standalone` + `frameworkRel:''`。
    // 单测形态（framework 在开发仓、宿主在临时目录）下它碰巧是对的，**覆盖不到**
    // smoke 的真实组合；而伪装成 standalone 会跳过 consumer 专属的 RELEASE-MANIFEST
    // 校验、并把 harnessPrefixRel 生成成 `harness` 而非 `framework/harness`。
    // 这条纯结构断言就是补那个覆盖不到的洞——它不需要真跑 goal。
    const consumer = deriveRepoLayout(
      path.join(path.sep, 'tmp', 'clone'),
      path.join(path.sep, 'tmp', 'clone', 'framework'),
    );
    assertEq(consumer.kind, 'consumer', 'framework 嵌在 projectRoot 内＝consumer 形态');
    assertEq(consumer.frameworkRel, 'framework', 'frameworkRel 须是 posix 相对路径');

    const standalone = deriveRepoLayout(
      path.join(path.sep, 'tmp', 'host'),
      path.join(path.sep, 'repo', 'agent-maison'),
    );
    assertEq(standalone.kind, 'standalone', '两根无包含关系＝standalone（单测形态）');
    assertEq(standalone.frameworkRel, '', 'standalone 的 frameworkRel 恒空');

    // 同一路径（理论上不会出现）也不得被当成嵌套而生成空 rel 的 consumer
    const same = deriveRepoLayout(path.join(path.sep, 'x'), path.join(path.sep, 'x'));
    assertEq(same.kind, 'standalone', 'projectRoot === frameworkRoot 不构成 consumer');

    // **闭集边界**（codex 第十一批 P2）：`RepoLayout.frameworkRel` 契约只允许
    // '' 或 'framework'（repo-layout.ts:17，且 :126 靠它反推 kind）。任意子目录都判
    // consumer 会派生出 'cache/framework' 这种既有契约不支持的状态——悄悄扩大下游
    // 值空间，与刚删掉的 `precondition_unmet` 兜底类同款。故须 fail-fast。
    let threw = false;
    try {
      deriveRepoLayout(path.join(path.sep, 'host'), path.join(path.sep, 'host', 'cache', 'framework'));
    } catch { threw = true; }
    assert(threw, '非 `framework` 的内部嵌套必须抛，不得静默生成 frameworkRel="cache/framework"');
  });

  return results;
}
