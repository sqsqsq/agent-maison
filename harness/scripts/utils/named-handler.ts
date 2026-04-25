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

/**
 * 剥离 `//` 单行注释与 `/* ... *\/` 块注释，避免在注释里**提到** `function foo`
 * 之类的伪声明被下游正则误判为真实实现（在真实业务代码中，TODO / 文档注释里
 * 写函数签名是常见做法）。
 *
 * 注意：为避免破坏字符串字面量里的 `//` / `/*`，先用占位符替换合法字符串，
 * 剥注释后再还原。这对 ArkTS / TS 覆盖度足够；不是完整词法分析，但已可
 * 剔除 99% 的注释误报。
 */
function stripCommentsPreservingStrings(src: string): string {
  const strs: string[] = [];
  // 匹配三种字符串：'...' / "..." / `...`（允许换行；`\.` 转义通过）
  // 不追求严格 ECMA 定义，仅为抑制注释扫描里的字符串内容。
  const strRe = /(["'`])(?:\\.|(?!\1)[^\\])*\1/gs;
  const placeholder = (i: number) => `\u0000STR_${i}\u0000`;
  const withPlaceholders = src.replace(strRe, m => {
    strs.push(m);
    return placeholder(strs.length - 1);
  });
  const noBlock = withPlaceholders.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLine = noBlock.replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // `:` 保留以免破坏 `http://`
  return noLine.replace(/\u0000STR_(\d+)\u0000/g, (_m, i) => strs[Number(i)] ?? '');
}

function readCode(file: string, cache: Map<string, string>): string {
  if (!cache.has(file)) {
    try { cache.set(file, stripCommentsPreservingStrings(fs.readFileSync(file, 'utf-8'))); }
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
        // 传统 `function xxx(...) { ... }`
        const reFunc = new RegExp(`\\bfunction\\s+${symbol}\\b`);
        // 类/对象方法：`xxx(...)[:{]` 形式（可能带泛型 `<T>`、可能带 async / 返回类型注解）
        const reMethod = new RegExp(
          `(?:^|[\\s;{}])` +                     // 左边界：行首/空白/分号/花括号
          `(?:async\\s+)?` +                     // 可选 async
          `${symbol}\\s*` +
          `(?:<[^>]*>\\s*)?` +                   // 可选泛型参数 `<T>`
          `\\([^)]*\\)\\s*` +                    // `(...)`
          `(?::\\s*[^={;\\n]+)?` +               // 可选返回类型注解 `: Type`
          `[:{]`                                 // 后面紧跟 `{`（方法体）或 `:`（接口签名）
        );
        // `export const|let|var|function|class xxx` 顶层导出
        const reExported = new RegExp(`\\bexport\\s+(?:function|const|let|var|class)\\s+${symbol}\\b`);
        // v2.2 放宽：ArkTS 类字段 / 顶层 const 赋值为箭头 / function 表达式
        // 覆盖形态：
        //   handleClick = async () => { ... }
        //   handleClick = function(x) { ... }
        //   handleClick: () => void = async () => { ... }     ← 含 `=>` 的类型注解
        //   handleClick: MyFuncType = () => { ... }
        //   const handleClick = () => { ... }
        //   let handleClick: Func = async () => { ... }
        // 要求必须是**命名符号**前缀 + `=` + 箭头函数/函数表达式，避免与任意 `x = 1` 混淆。
        // 难点：类型注解本身可能含 `=>`（如 `: () => void`），因此用"非贪婪 + 负向
        // 前瞻（=不得紧跟 >）"精确定位赋值等号。
        const reFieldFunc = new RegExp(
          `(?:^|[\\s;{}])` +                     // 左边界
          `(?:(?:public|private|protected|readonly|static|const|let|var)\\s+)*` +
          `${symbol}\\b` +
          `(?:\\s*:\\s*[^\\n{;]+?)?` +           // 可选类型注解（非贪婪，不跨行/花括号/分号）
          `\\s*=(?!>)\\s*` +                     // 赋值 `=`（不得是 `=>`）
          `(?:async\\s+)?` +                     // 可选 async
          `(?:function\\b|\\([^)]*\\)\\s*(?::\\s*[^\\n{=]+?)?\\s*=>|[A-Za-z_$][\\w$]*\\s*=>)`
          // 三选一：`function` 表达式 / `(...) => ...`（可带返回类型）/ `param => ...`
        );
        const found = candidates.some(f =>
          reFunc.test(f.content) ||
          reExported.test(f.content) ||
          reMethod.test(f.content) ||
          reFieldFunc.test(f.content)
        );
        if (!found) {
          issues.push(`${uc.id} > ui_bindings[${ub.ui}] > "${ua.trigger}": 找不到命名函数 "${symbol}"（来自 calls="${ua.calls}"）`);
        }
      }
    }
  }

  return { skip: false, issues };
}
