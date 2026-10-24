/**
 * named-handler（profile 宿主实现入口）
 *
 * 根 harness 不写死宿主语言或外层目录命名；由各 `profiles/<profile>/harness/named-handler.ts`
 * 导出 `scanNamedBusinessHandler`。无实现时 SKIP（不产生 BLOCKER）。
 */

import type { CheckContext } from './types';
import { CHECK_NOT_APPLICABLE_MARKER } from './types';
import * as path from 'path';
import { getLastProfileHarnessLoadError, tryLoadProfileHarnessModule } from '../../profile-host-loader';

export interface NamedHandlerScanResult {
  /** true: use-cases.yaml 不存在或 profile 不提供该检查 */
  skip: boolean;
  issues: string[];
  structured?: { applicability: typeof CHECK_NOT_APPLICABLE_MARKER };
}

export function scanNamedBusinessHandler(ctx: CheckContext): NamedHandlerScanResult {
  const notApplicable = (): NamedHandlerScanResult => ({ skip: true, issues: [], structured: { applicability: CHECK_NOT_APPLICABLE_MARKER } });
  if (!ctx.featureSpec.useCases) return notApplicable();
  const modulePath = path.join(ctx.resolvedProfile.profileDir, 'harness', 'named-handler');
  try { require.resolve(modulePath); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') throw error;
    return notApplicable();
  }
  const mod = tryLoadProfileHarnessModule<{
    scanNamedBusinessHandler?: (c: CheckContext) => NamedHandlerScanResult;
  }>(ctx.resolvedProfile.profileDir, 'named-handler');
  const fn = mod?.scanNamedBusinessHandler;
  if (typeof fn === 'function') {
    return fn(ctx);
  }
  throw new Error(getLastProfileHarnessLoadError() ?? `profile named-handler 缺 scanNamedBusinessHandler 导出：${modulePath}`);
}
