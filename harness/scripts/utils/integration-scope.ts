// ============================================================================
// integration-scope.ts — 宿主集成契约一致性与可达性（visual-capability-truth S6 / P1-F·G）
// ----------------------------------------------------------------------------
// 20260718 事故：spec/plan 同时表达「WalletMain/Phone 禁改」与「功能必须经其接入」，
// 门禁未识别矛盾 → coding 做孤岛模块、testing 期补胶水 → review/ut 失效。
// 真源=contracts.integration_points 机器块（不从 plan 自由文本猜模块）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import type { ContractsSpec } from './types';

export type IntegrationPoint = NonNullable<ContractsSpec['integration_points']>[number];

export interface IntegrationScopeViolation {
  point: string;
  reason: string;
}

/**
 * 纯判定（bindingProbe 注入 I/O）：
 * - requires_modification=true 且 consumer ∉ in_scope → 矛盾（既要求改它又禁改它）；
 * - requires_modification=false → 须验证实际 consumer binding 已存在（不是只看
 *   export/route 名存在）；无 entry_symbol 则无从验证 → 同样违例。
 */
export function evaluateIntegrationScopeConsistency(args: {
  points: IntegrationPoint[];
  inScopeModules: string[];
  bindingProbe: (consumerModule: string, entrySymbol: string) => boolean;
}): IntegrationScopeViolation[] {
  const violations: IntegrationScopeViolation[] = [];
  const inScope = new Set(args.inScopeModules.map(m => m.trim()));
  for (const p of args.points) {
    const label = `${p.consumer_module}→${p.provider_module}`;
    if (p.requires_modification) {
      if (!inScope.has(p.consumer_module)) {
        violations.push({
          point: label,
          reason:
            `requires_modification=true 但 consumer「${p.consumer_module}」不在 in_scope——` +
            '计划自矛盾（既要求改它接入、又把它排除在允许修改范围外）。出路：把该模块拉入 ' +
            'in_scope，或改为已存在的零修改接入点（requires_modification=false + entry_symbol 实存验证）。' +
            'headless 下宁停不写矛盾计划（矛盾计划的下场=coding 孤岛 + testing 期补胶水 + review/ut 全失效）。',
        });
      }
      continue;
    }
    if (!p.entry_symbol) {
      violations.push({
        point: label,
        reason: 'requires_modification=false 但缺 entry_symbol——零修改接入点无从验证实存（须声明消费符号）',
      });
      continue;
    }
    if (!args.bindingProbe(p.consumer_module, p.entry_symbol)) {
      violations.push({
        point: label,
        reason:
          `requires_modification=false 但 consumer「${p.consumer_module}」源码中未发现对「${p.entry_symbol}」的实际消费` +
          '——"零修改接入点已存在"未被证实（只有 export/route 名存在不算 binding）',
      });
    }
  }
  return violations;
}

/** I/O：consumer 模块源码树中是否存在对 entry_symbol 的文本引用（.ets/.ts 递归） */
export function probeConsumerBinding(
  projectRoot: string,
  contracts: Pick<ContractsSpec, 'modules'>,
  consumerModule: string,
  entrySymbol: string,
): boolean {
  const mod = (contracts.modules ?? []).find(m => m.name === consumerModule);
  if (!mod?.package_path) return false;
  const root = path.join(projectRoot, mod.package_path);
  if (!fs.existsSync(root)) return false;
  let found = false;
  const walk = (dir: string): void => {
    if (found) return;
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      if (found) return;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === 'oh_modules' || ent.name.startsWith('.')) continue;
        walk(full);
      } else if (/\.(ets|ts)$/.test(ent.name)) {
        try {
          if (fs.readFileSync(full, 'utf-8').includes(entrySymbol)) found = true;
        } catch {
          /* 单文件失败跳过 */
        }
      }
    }
  };
  walk(root);
  return found;
}
