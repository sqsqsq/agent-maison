import { beginUnitCase } from '../utils/unit-cases';
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
  retiredReason?: string;
}
interface SmokeModule {
  CASE_REGISTRY: SmokeCase[];
  STAGES: Array<{ id: string }>;
  TEST_ONLY_GITIGNORE: string;
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
  const endUnitCase = beginUnitCase(name);
  if (!endUnitCase) return;
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, error: (e as Error).message });
  } finally { endUnitCase(); }
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
    assertEq(eight!.status, 'retired', '#8旧视觉head控制面退役，不能把普通fresh误称失配回放');
    assert(Boolean(eight!.retiredReason?.includes('已无相应故障注入')), '#8须明确当前驱动不再制造旧故障');
    assert(eight!.coveredBy === undefined, '#8保留编号但不得虚报某stage已经覆盖');
    const nine = m.CASE_REGISTRY.find(c => c.id === 9);
    assert(nine !== undefined, '2026-09-01 发布件升级事故 #9 必须在册');
    assertEq(nine!.status, 'covered', '#9 必须由真实 stage 覆盖');
    assertEq(nine!.coveredBy, 'upgradeOverlay', '#9 必须指向 upgradeOverlay stage');
    assert(m.STAGES.some(s => s.id === 'upgradeOverlay'), 'upgradeOverlay stage 必须真实存在');

    for (const id of [3, 4, 5, 6, 7]) {
      const item = m.CASE_REGISTRY.find(c => c.id === id);
      assertEq(item?.status, 'retired', `#${id} 的旧剧本已退役`);
      assert(item?.retiredReason?.includes('真实宿主任务'), `#${id} 须指明剩余验证来源`);
      assert(item?.coveredBy === undefined, `#${id} 的冒烟覆盖声明须清除`);
    }

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
        m.CASE_REGISTRY.map(c => (c.id === 9 ? { ...c, coveredBy: undefined } : c)),
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
      'install→depsHost→commit→clone→depsClone→upgradeOverlay→checkGlobal',
      'stage 顺序即宿主真实时间线，乱序＝测了个别的东西',
    );
    // 初版把执行根绑死在 clone **之前**的副本上，clone 后只把路径当参数传进去检查，
    // 被 CRLF 改写过的代码从未真正执行过（codex 第七批 P1）。这条钉住顺序前提。
    assert(
      order.indexOf('depsClone') > order.indexOf('clone'),
      'depsClone 必须在 clone 之后——它负责把执行根切到换机副本',
    );
    for (const after of ['upgradeOverlay', 'checkGlobal']) {
      assert(
        order.indexOf(after) > order.indexOf('depsClone'),
        `${after} 必须在 depsClone 之后，否则跑的仍是 clone 前的旧副本`,
      );
    }
  });

  await run(results, 'plan 33714d0c：用例 #1（宿主 Git 收编）已退役，夹具只保留 test-only 忽略规则', async () => {
    const m = await load();
    const one = m.CASE_REGISTRY.find(c => c.id === 1);
    assert(one !== undefined, '编号必须保留，避免注册表出现空洞');
    assertEq(one!.status, 'retired', '#1 已随宿主 SCM 权责一并退役');
    assert(
      typeof one!.retiredReason === 'string' && one!.retiredReason!.includes('33714d0c'),
      '#1 必须写明退役理由并指向 plan 33714d0c',
    );
    assert(one!.coveredBy === undefined, 'retired 用例不得再声称由某个 stage 覆盖');

    // retired 但不写理由 → 守门函数须拒（防"悄悄退役"变成假绿）
    let noReason = false;
    try {
      m.assertCaseRegistryComplete(
        m.CASE_REGISTRY.map(c => (c.id === 1 ? { ...c, retiredReason: undefined } : c)),
      );
    } catch { noReason = true; }
    assert(noReason, 'retired 而不写 retiredReason 必须抛');

    // 夹具只允许 test-only 基础设施规则；不得恢复 Maison canonical host patterns
    const fixture = m.TEST_ONLY_GITIGNORE;
    assert(fixture.includes('framework/harness/node_modules/'), '夹具须忽略自身安装的 node_modules');
    for (const forbidden of [
      'framework/harness/reports/',
      'framework/harness/state/',
      'framework/harness/trace/',
      'framework.local.json',
      'doc/catalog-staging/',
    ]) {
      assert(!fixture.includes(forbidden), `夹具不得恢复 Maison canonical pattern ${forbidden}`);
    }
    const source = fs.readFileSync(SMOKE_MODULE, 'utf-8');
    for (const forbidden of [
      'ensureCanonicalGitignore',
      'applyCanonicalGitignore',
      'canonical-gitignore',
      'HISTORICAL_GITIGNORE',
    ]) {
      assert(!source.includes(forbidden), `smoke 不得残留 ${forbidden}`);
    }
  });

  return results;
}
