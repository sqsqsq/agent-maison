/**
 * Skill 6 device-testing：主应用 HAP 打包维度的默认值与环境变量（hmos-app）。
 */
import { detectProduct, listAvailableProducts } from './hvigor-runner';

export function resolveDeviceTestProduct(projectRoot: string, explicit?: string): string {
  const fromEnv = process.env.HARNESS_DEVICE_TEST_PRODUCT?.trim();
  if (explicit?.trim()) return explicit.trim();
  if (fromEnv) return fromEnv;
  return detectProduct(projectRoot);
}

export function resolveDeviceTestBuildMode(explicit?: 'debug' | 'release'): 'debug' | 'release' {
  if (explicit) return explicit;
  const env = process.env.HARNESS_DEVICE_TEST_BUILD_MODE?.trim().toLowerCase();
  return env === 'release' ? 'release' : 'debug';
}

/** 供 Skill / addendum 展示的 harness 环境变量说明（纯文本）。 */
export function describeDeviceTestHarnessEnvHints(): string {
  return [
    'HARNESS_DEVICE_TEST_PRODUCT：覆盖传给 hvigor 的 `-p product=`（默认与 detectProduct / toolchain.preferredProduct 一致）。',
    'HARNESS_DEVICE_TEST_BUILD_MODE：`debug`（默认）或 `release`。',
    'HARNESS_SKIP_DEVICE_TEST_BUILD / HARNESS_SKIP_DEVICE_TEST_INSTALL：设置后跳过对应步骤；testing harness 将其视为失败（与 coding 阶段跳过真实编译一致）。',
  ].join('\n');
}

export { listAvailableProducts };
