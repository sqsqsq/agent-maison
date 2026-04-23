// ============================================================================
// named-handler.ts
// ============================================================================
// 扫描 doc/features/{feature}/use-cases.yaml 里 ui_bindings.user_actions.calls
// 引用的业务函数，是否在工程源代码中以"命名方法 / 导出函数 / 类方法"形式存在。
// v2.1 硬约束：不允许只存在于 `onClick = () => { ... }` 这类 inline lambda。
//
// 供 check-coding.ts（Skill 3 阶段）与 check-ut.ts（Skill 5 阶段）共享调用。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { CheckContext, UseCasesSpec } from './types';

export interface NamedHandlerScanResult {
  /** true: use-cases.yaml 不存在，调用方应输出 SKIP */
  skip: boolean;
  /** 未通过的条目描述（空数组表示全部通过） */
  issues: string[];
}

const DEFAULT_SEARCH_ROOTS = [
  '02-Feature',
  '01-Business',
  '00-Common',
];

function readCode(file: string, cache: Map<string, string>): string {
  if (!cache.has(file)) {
    try { cache.set(file, fs.readFileSync(file, 'utf-8')); }
    catch { cache.set(file, ''); }
  }
  return cache.get(file)!;
}

export function scanNamedBusinessHandler(ctx: CheckContext): NamedHandlerScanResult {
  const spec: UseCasesSpec | null = ctx.featureSpec.useCases ?? null;
  if (!spec) {
    return { skip: true, issues: [] };
  }

  const cache = new Map<string, string>();
  const candidates: Array<{ file: string; content: string }> = [];

  for (const uc of spec.use_cases ?? []) {
    if (uc.coordinator_file) {
      const abs = path.join(ctx.projectRoot, uc.coordinator_file);
      if (fs.existsSync(abs)) {
        candidates.push({ file: abs, content: readCode(abs, cache) });
      }
    }
  }

  const roots = DEFAULT_SEARCH_ROOTS
    .map(r => path.join(ctx.projectRoot, r))
    .filter(p => fs.existsSync(p));

  try {
    for (const root of roots) {
      const stack: string[] = [root];
      while (stack.length && candidates.length < 800) {
        const cur = stack.pop()!;
        let stat;
        try { stat = fs.statSync(cur); } catch { continue; }
        if (stat.isDirectory()) {
          let names: string[] = [];
          try { names = fs.readdirSync(cur); } catch { continue; }
          for (const name of names) {
            if (name === 'node_modules' || name === 'build' || name === '.preview') continue;
            stack.push(path.join(cur, name));
          }
        } else if (cur.endsWith('.ets') || cur.endsWith('.ts')) {
          candidates.push({ file: cur, content: readCode(cur, cache) });
        }
      }
    }
  } catch {
    // 扫描失败静默降级
  }

  const issues: string[] = [];
  for (const uc of spec.use_cases ?? []) {
    for (const ub of uc.ui_bindings ?? []) {
      for (const ua of ub.user_actions ?? []) {
        if (!ua.calls) continue;
        const parts = ua.calls.split(/[.]/).filter(Boolean);
        const symbol = parts[parts.length - 1]?.replace(/\(.*$/, '').trim();
        if (!symbol) continue;
        if (!/^[A-Za-z_$][\w$]*$/.test(symbol)) {
          issues.push(`${uc.id} > ui_bindings[${ub.ui}] > "${ua.trigger}": calls="${ua.calls}" 不是合法命名函数符号`);
          continue;
        }
        const reFunc = new RegExp(`\\bfunction\\s+${symbol}\\b`);
        const reMethod = new RegExp(`\\b${symbol}\\s*\\(([^)]*)\\)\\s*[:{]`);
        const reExported = new RegExp(`\\bexport\\s+(?:function|const|let|var|class)\\s+${symbol}\\b`);
        const found = candidates.some(f =>
          reFunc.test(f.content) || reExported.test(f.content) || reMethod.test(f.content)
        );
        if (!found) {
          issues.push(`${uc.id} > ui_bindings[${ub.ui}] > "${ua.trigger}": 找不到命名函数 "${symbol}"（来自 calls="${ua.calls}"）`);
        }
      }
    }
  }

  return { skip: false, issues };
}
