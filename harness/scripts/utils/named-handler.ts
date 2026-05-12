/**
 * named-handler（profile 宿主实现入口）
 *
 * 根 harness 不写死宿主语言或外层目录命名；由各 `profiles/<profile>/harness/named-handler.ts`
 * 导出 `scanNamedBusinessHandler`。无实现时 SKIP（不产生 BLOCKER）。
 */

import type { CheckContext } from './types';
import { tryLoadProfileHarnessModule } from '../../profile-host-loader';

export interface NamedHandlerScanResult {
  /** true: use-cases.yaml 不存在或 profile 不提供该检查 */
  skip: boolean;
  issues: string[];
}

export function scanNamedBusinessHandler(ctx: CheckContext): NamedHandlerScanResult {
  const mod = tryLoadProfileHarnessModule<{
    scanNamedBusinessHandler?: (c: CheckContext) => NamedHandlerScanResult;
  }>(ctx.resolvedProfile.profileDir, 'named-handler');
  const fn = mod?.scanNamedBusinessHandler;
  if (typeof fn === 'function') {
    return fn(ctx);
  }
  return { skip: true, issues: [] };
}
