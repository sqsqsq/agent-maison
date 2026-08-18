/**
 * device-testing device-testing：主应用 HAP 打包维度的默认值与环境变量（hmos-app）。
 */
import { listAvailableProducts } from './hvigor-runner';
import { resolveProductSelection, buildProductSelectionUnresolvedGuidance } from './product-selection';

/**
 * device-test 构建 product（plan a7c3f9e2 t2b/t5）：env 覆盖与显式参数走
 * `resolveProductSelection`（source=explicit_run / confirmed_env），未覆盖时回落
 * explicit_config / sole_candidate；`unresolved`（**构建形态无法确定**：多候选未确认 /
 * build-profile 缺失 / products 为空 / build-profile 不可解析）**抛错**——
 * 调用方须先处置（goal-runner 走 try/catch；device-test-build provider 先行阻断）。
 */
export function resolveDeviceTestProduct(projectRoot: string, explicit?: string): string {
  const sel = resolveProductSelection({
    projectRoot,
    purpose: 'device_test',
    explicitProduct: explicit,
  });
  if (sel.source === 'unresolved') {
    throw new Error(`[product-selection] 编译形态无法确定——${buildProductSelectionUnresolvedGuidance(sel)}`);
  }
  return sel.product!;
}

export function resolveDeviceTestBuildMode(explicit?: 'debug' | 'release'): 'debug' | 'release' {
  if (explicit) return explicit;
  const env = process.env.HARNESS_DEVICE_TEST_BUILD_MODE?.trim().toLowerCase();
  return env === 'release' ? 'release' : 'debug';
}

/** 供 Skill / addendum 展示的 harness 环境变量说明（纯文本）。 */
export function describeDeviceTestHarnessEnvHints(): string {
  return [
    'HARNESS_DEVICE_TEST_PRODUCT：覆盖传给 hvigor 的 `-p product=`（source=confirmed_env，属显式确认；多候选工程可在无人值守时用它确认形态）。',
    'HARNESS_DEVICE_TEST_BUILD_MODE：`debug`（默认）或 `release`。',
    'HARNESS_SKIP_DEVICE_TEST_BUILD / HARNESS_SKIP_DEVICE_TEST_INSTALL：设置后跳过对应步骤；testing harness 将其视为失败（与 coding 阶段跳过真实编译一致）。',
    'HARNESS_HDC_TARGET：多设备时指定 hdc 序列号（写入后形如 `hdc -t <serial> …`，与 bm dump / install / uninstall 同源）。',
    'HARNESS_DEVICE_TEST_UNINSTALL_BEFORE_INSTALL：`1`/`true`/`yes` 时允许在降级预检或首次 install 失败后执行一次 `bm uninstall` 并重试至多一次 install（慎用）。',
    'HARNESS_DEVICE_TEST_UNINSTALL_KEEP_DATA：与上一变量同时启用时，`bm uninstall` 追加 `-k` 保留用户数据。',
    'HARNESS_DEVICE_TEST_FORCE_BUILD：设为 1/true/yes 时禁止构建复用，强制执行 hvigor。',
    'HARNESS_DEVICE_TEST_FORCE_INSTALL：设为 1/true/yes 时禁止装机复用，强制执行 hdc install。',
    'HARNESS_HYLYRE_PAGE_SAVE_NAME：hylyre app page save 的 PAGE_NAME 位置参数（默认 home）。',
  ].join('\n');
}

export { listAvailableProducts };
