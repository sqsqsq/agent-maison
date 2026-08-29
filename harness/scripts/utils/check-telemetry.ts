// ============================================================================
// check-telemetry.ts — check 自由文本里的**易变遥测**显式分域
// ============================================================================
// 背景（plan e5b8c3f7 review 三轮 P1-2）：verifier subject 需要"无物质变化不换代、
// 有物质变化必换代"。`CheckResult.details` 同时承载两类内容：
//   · 语义内容——verifier 真的会读并据此判断（错误清单、归因说明、命令、路径…）；
//   · runner 遥测——耗时、墙钟这类**每次跑都不同**的量。
// 两类混在一段自由文本里，就只剩两个都错的选择：整段入 subject（零改动重跑也换代 →
// 自锁），或整段不入 subject（details 真变了却不换代 → 复用过期结论）。
//
// 出路是在**生产端**把遥测标出来，而不是在消费端对最终文本猜正则：details 照常给人看
// （耗时仍在），另给一份 `details_material`——同一模板、遥测位替换为固定占位符。
// subject 派生只看 details_material，于是遥测变化不换代、语义变化必换代。
//
// **生产端纪律**：任何在 details / suggestion 里内嵌"每次跑都不同"的值（耗时、墙钟、
// 临时目录、PID…）的 check，都必须经本模块产出这对文本。漏用不会崩，但会让该 check 所在
// 阶段的 subject 每跑必换代，把"跑完 verifier 再跑一次 harness 关环"这条路重新锁死。
// ============================================================================

/** 遥测位在 material 投影里的固定占位符（不参与人读输出）。 */
export const CHECK_TELEMETRY_PLACEHOLDER = '<telemetry>';

export interface DetailsWithTelemetry {
  /** 人读用：遥测原样在内。 */
  details: string;
  /** subject 派生用：同一模板、遥测位为占位符。 */
  details_material: string;
}

/**
 * 用**同一个模板函数**渲染两遍，杜绝两份文本漂移——这正是"手写两份"最容易出的错。
 *
 * @param render    以遥测文本为唯一变量的模板函数
 * @param telemetry 本次的真实遥测文本（如 `1234 ms`）
 */
export function renderDetailsWithTelemetry(
  render: (telemetry: string) => string,
  telemetry: string,
): DetailsWithTelemetry {
  return {
    details: render(telemetry),
    details_material: render(CHECK_TELEMETRY_PLACEHOLDER),
  };
}
