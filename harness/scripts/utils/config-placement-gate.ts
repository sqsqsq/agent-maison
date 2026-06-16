// ============================================================================
// config-placement-gate.ts — project config personal 字段错位门控
// ============================================================================

import { loadFrameworkConfigWithSources } from '../../config';
import { projectHasMisplacedPersonalFields } from './config-field-ownership';

export type ConfigPlacementGateCode = 'ok' | 'misconfigured_personal_fields';

export type ConfigPlacementGateResult =
  | { ok: true; code: 'ok'; message: string }
  | { ok: false; code: 'misconfigured_personal_fields'; message: string };

export interface ConfigPlacementGateOptions {
  /** init / migrate-config / personal orchestrate 豁免 */
  exempt?: boolean;
}

export function evaluateConfigPlacementGate(
  projectRoot: string,
  options: ConfigPlacementGateOptions = {},
): ConfigPlacementGateResult {
  if (options.exempt) {
    return { ok: true, code: 'ok', message: 'config placement gate exempt' };
  }
  const { projectRaw } = loadFrameworkConfigWithSources(projectRoot);
  if (!projectRaw || !projectHasMisplacedPersonalFields(projectRaw)) {
    return { ok: true, code: 'ok', message: 'project config 无错位 personal 字段' };
  }
  return {
    ok: false,
    code: 'misconfigured_personal_fields',
    message:
      'framework.config.json 含 personal 字段（agent_adapter 或 toolchain.devEcoStudio）。' +
      '须先执行 init UPDATE / migrate-config 清场并外迁到 framework.local.json，' +
      '再运行 check-personal-setup --ensure 补齐 local。',
  };
}

export function formatConfigPlacementGateStderr(
  result: Extract<ConfigPlacementGateResult, { ok: false }>,
): string {
  return `[config-placement] ${result.message}\n`;
}
