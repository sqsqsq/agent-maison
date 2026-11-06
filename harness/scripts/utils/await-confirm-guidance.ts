/**
 * plan a7c3f9e2 t4/t5 编译形态未确定的说明（原在 goal-phase-runtime 内联），plan 4e6fb3b6 §3.3
 * 补齐四件事。缺的输入是"选哪个 product"——这是产品决定，框架不替宿主猜。
 */
export function buildProductSelectionUnresolvedGuidance(opts: {
  feature: string;
  phase: string;
  candidates: string[];
  projectRoot: string;
}): string[] {
  const { feature, phase, candidates, projectRoot } = opts;
  const list = candidates.join(', ');
  return [
    candidates.length > 0
      ? `编译形态无法确定：工程声明了多个 product（${list}），` +
        '且 toolchain.preferredProduct 未经本机确认（framework.local.json 无匹配确认记录）。'
      : '编译形态无法确定：build-profile.json5 未声明任何真实 product（缺失/为空/不可解析）。',
    `影响：${feature} 当前需要该编译形态的 ${phase} 工作尚无可信结果；选错 product 会让错误产物也能编译通过，所以必须先确认。`,
    '谁能修：你——选哪个 product 是产品决定，framework 不替宿主猜测编译形态。',
    '怎么恢复：先确认一次（任选其一）：',
    `  1. 机器写入：npx ts-node framework/harness/scripts/record-product-selection.ts --project-root ${projectRoot} --product <候选值>；`,
    '  2. 交互式：framework-init 的 registry `init.product_selection`；',
    '  3. testing 无人值守：HARNESS_DEVICE_TEST_PRODUCT=<候选值>（仅 testing 起点链路生效，env 属显式确认）。',
    candidates.length > 0
      ? `本次可用候选：${list}。`
      : '请先修复构建配置（build-profile.json5 声明 app.products）或使用显式来源指定 product。',
    // plan 4e6fb3b6 返修 2(a) + §7.2 + 二轮评审：该检查在新开与恢复时都会执行。从未正式开始过的 run 没有 run_start，
    // 显式恢复会被拒、重发走附着；曾正式开始过的 run 恢复时停在这里，修好后显式恢复也可以——所以统一写"由框架选择恢复方式"。
    '确认后重新发起同一请求，由框架选择恢复方式（本 run 从未正式开始过时走附着，曾正式开始过时走恢复），不需要自己拼旗标。',
    '确认已恢复：本 run 不再出现 product_selection_unresolved，链路继续执行。',
  ];
}
