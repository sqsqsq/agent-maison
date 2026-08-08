// ============================================================================
// ut-module-selection.unit.test.ts — selectUtModulesToCompile 回归
// ----------------------------------------------------------------------------
// 背景：findModulesWithUt 会把 contracts.modules 里每个带 src/ohosTest/ 的模块
// 都列为编译候选；entry/product 模块（如 Phone）常只含模板测试、且无法生成
// genOnDeviceTestHap。selectUtModulesToCompile 用本需求 scoped UT 文件把这类
// 与需求无关的模块筛掉，避免误判整轮 UT 失败。
// ============================================================================

import { orderUtModulesForCompile, selectUtModulesToCompile } from '../../../profiles/hmos-app/harness/ut-host-impl';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const WALLET = { name: 'WalletMain', package_path: '02-Feature/WalletMain' };
const PHONE = { name: 'Phone', package_path: '01-Product/Phone' };
const ACCOUNT = { name: 'AccountManager', package_path: '04-BusinessBase/AccountManager' };

function names(mods: Array<{ name: string }>): string[] {
  return mods.map(m => m.name).sort();
}

// 核心回归（本 bug）：scoped 全在 WalletMain → 排除只含模板测试的 Phone。
function testExcludesModuleWithoutScopedUt(): void {
  const scoped = [
    { path: '02-Feature/WalletMain/src/ohosTest/ets/test/bc_open_card_ut.test.ets' },
    { path: '02-Feature/WalletMain/src/ohosTest/ets/test/List.test.ets' },
  ];
  const out = selectUtModulesToCompile([WALLET, PHONE], scoped);
  assert(out.length === 1, `expected 1 module, got ${out.length}`);
  assert(out[0].name === 'WalletMain', `expected WalletMain, got ${out[0].name}`);
}

// 多模块：scoped 落在两个模块 → 两个都保留。
function testKeepsAllModulesThatOwnScopedUt(): void {
  const scoped = [
    { path: '02-Feature/WalletMain/src/ohosTest/ets/test/a.test.ets' },
    { path: '04-BusinessBase/AccountManager/src/ohosTest/ets/test/b.test.ets' },
  ];
  const out = selectUtModulesToCompile([WALLET, PHONE, ACCOUNT], scoped);
  assert(out.length === 2, `expected 2 modules, got ${out.length}`);
  assert(
    names(out).join(',') === 'AccountManager,WalletMain',
    `expected AccountManager,WalletMain, got ${names(out).join(',')}`,
  );
}

// 兜底：scoped 为空（无 scoped 信息）→ 原样返回，保持旧行为不回归。
function testFallbackWhenScopedEmpty(): void {
  const out = selectUtModulesToCompile([WALLET, PHONE], []);
  assert(out.length === 2, `expected passthrough of 2 modules, got ${out.length}`);
}

// 兜底：scoped 不匹配任何模块 package_path → 退回全集而非筛空。
function testFallbackWhenNoneMatch(): void {
  const scoped = [{ path: 'some/unrelated/path/x.test.ets' }];
  const out = selectUtModulesToCompile([WALLET, PHONE], scoped);
  assert(out.length === 2, `expected fallback to full set, got ${out.length}`);
}

// 已知边界（locked）：partitionUtFiles 无 scope 线索时返回 scoped=all（含 Phone 模板测试）。
// 此时本函数按设计「退回包含 Phone」——锁定该行为，提醒改动者 fallback:all 路径不做排除；
// goal 流程必产 context-exploration，真实场景 scoped 具体、Phone 仍被排除（见首个用例）。
function testFallbackAllScopeKeepsTemplateModule(): void {
  const scopedIsAll = [
    { path: '02-Feature/WalletMain/src/ohosTest/ets/test/bc_open_card_ut.test.ets' },
    { path: '01-Product/Phone/src/ohosTest/ets/test/Ability.test.ets' },
  ];
  const out = selectUtModulesToCompile([WALLET, PHONE], scopedIsAll);
  assert(out.length === 2, `fallback:all keeps both modules, got ${out.length}`);
  assert(
    names(out).join(',') === 'Phone,WalletMain',
    `expected Phone,WalletMain, got ${names(out).join(',')}`,
  );
}

// plan 423e5d0f P0：feature 新增 UT 归属的模块必须排最前——真实编译错误仍会短路循环，
// 顺带被触碰的存量模块（如 Phone 的 Main.test.ets 被加 AC 标签）不得把真目标模块挤出执行窗口。
function testOrdersFeatureNewModuleFirst(): void {
  const scoped = [
    { path: '01-Product/Phone/src/ohosTest/ets/test/Main.test.ets' },
    { path: '02-Feature/WalletMain/src/ohosTest/ets/test/not_login.test.ets' },
  ];
  const featureNew = [
    { path: '02-Feature/WalletMain/src/ohosTest/ets/test/not_login.test.ets' },
  ];
  const out = orderUtModulesForCompile([PHONE, WALLET], scoped, featureNew);
  assert(out[0].name === 'WalletMain', `feature-new module first, got ${out[0].name}`);
  assert(out[1].name === 'Phone', `touched-legacy module second, got ${out[1].name}`);
}

// 无 featureNew 信息 → 保持原顺序（稳定，不回归）。
function testOrderStableWithoutFeatureNew(): void {
  const scoped = [
    { path: '01-Product/Phone/src/ohosTest/ets/test/Main.test.ets' },
    { path: '02-Feature/WalletMain/src/ohosTest/ets/test/a.test.ets' },
  ];
  const out = orderUtModulesForCompile([PHONE, WALLET], scoped, []);
  assert(out[0].name === 'Phone' && out[1].name === 'WalletMain', `stable order, got ${names(out).join(',')}`);
}

export function runAll(): UnitCaseResult[] {
  const cases: Array<{ name: string; fn: () => void }> = [
    { name: 'excludes module without scoped UT (Phone)', fn: testExcludesModuleWithoutScopedUt },
    { name: 'keeps all modules that own scoped UT', fn: testKeepsAllModulesThatOwnScopedUt },
    { name: 'fallback to full set when scoped empty', fn: testFallbackWhenScopedEmpty },
    { name: 'fallback to full set when none match', fn: testFallbackWhenNoneMatch },
    { name: 'fallback:all scope keeps template-only module (locked)', fn: testFallbackAllScopeKeepsTemplateModule },
    { name: 'orders feature-new module first (423e5d0f)', fn: testOrdersFeatureNewModuleFirst },
    { name: 'order stable without feature-new info', fn: testOrderStableWithoutFeatureNew },
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
