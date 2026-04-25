// ============================================================================
// ts-compile.ts
// ============================================================================
// 轻量级 TypeScript 静态编译检查工具：对 *.test.ets 文件调用 TypeScript Compiler API
// （ts.createProgram）做 noEmit 扫描，用于 check-ut.ts 的 `ut_tsc_compiles` BLOCKER
// 规则。
//
// 设计取舍：
//  - ArkTS 的 `.ets` 扩展与 `struct`/`@Component` 在 tsc 眼里是非法语法，因此：
//    (1) 我们用**自定义 CompilerHost** 把 `.ets` 虚拟映射为 `.ts` 源码；
//    (2) 默认 `noResolve: true`，**不跟随 import**：只检查测试文件本身的语法和
//        文件内类型错误（undefined symbol、字面量类型不匹配等）；
//    (3) 注入 `@ohos/hypium` 等常用符号的 ambient 声明，避免把 describe/it/expect
//        标为未定义。
//  - 跨文件类型错误（如"调用了签名不匹配的被测函数"）不在本规则覆盖范围，
//    由 Skill 3/5 的 `coding_hvigor_build` / `ut_hvigor_build` BLOCKER 兜底。
//  - 该工具只依赖 devDependencies.typescript，不写盘，性能足够（< 300 ms / 文件）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

/** 单条 TS 诊断（编译错误）条目 */
export interface TsDiagnostic {
  /** 相对项目根的文件路径（带 .ets 原始后缀） */
  file: string;
  /** 行号（1-based） */
  line: number;
  /** 列号（1-based） */
  column: number;
  /** TypeScript 错误码（TS2304 / TS2322 ...） */
  code: string;
  /** 诊断文本 */
  message: string;
  /** 严重级：TypeScript 的 Error/Warning（通常只看 Error） */
  category: 'Error' | 'Warning' | 'Suggestion' | 'Message';
}

/** tsc --noEmit 扫描结果 */
export interface TsCompileReport {
  /** 被扫描的文件数（绝对路径） */
  scannedFiles: string[];
  /** 诊断条目（仅 Error；Warning 可选保留） */
  diagnostics: TsDiagnostic[];
  /** 总耗时（ms） */
  durationMs: number;
}

/**
 * 最小 ambient 声明：
 *   (1) 声明 `@ohos/hypium` 所有成员为 any——避免 `.not.assertXxx()`、
 *       `.assertLarger(...)` 这类真实 hypium 存在、但我们声明漏掉的方法被误判；
 *   (2) 通配模块声明——使相对路径 import（如 '../../../main/ets/foo'）
 *       不会再抛 TS2307 'Cannot find module'。`noResolve: true` 下我们本来就
 *       不跟随这些 import，因此把它们统一判定为 any 是安全的；
 *       该规则的定位是**测试文件本体的类型错误护栏**，跨文件检查交给
 *       ut_hvigor_build BLOCKER。
 *
 * 历史教训：早期版本给 expect() 的返回对象写了具体签名，导致 home-page UT
 * 的 `.not.assertNull()` 被误判为 TS2339；上了 ambient 强类型就变相把测试
 * 写法绑死在我们对 hypium API 的不完整理解上，得不偿失。
 */
const HYPIUM_AMBIENT_DTS = `
declare module '@ohos/hypium' {
  export const describe: any;
  export const it: any;
  export const beforeAll: any;
  export const beforeEach: any;
  export const afterAll: any;
  export const afterEach: any;
  export const expect: any;
  export const Level: any;
  export const Size: any;
  export const TestType: any;
  export const DEFAULT: any;
  const _default: any;
  export default _default;
}
`.trim();

/**
 * `noResolve: true` 的设计就是**不跟随 import**——所以由此衍生的"模块解析类" TS 错误
 * 本质上都是我们自己关掉了解析造成的 false positive，必须过滤掉，否则本规则会误杀
 * 所有引用了业务源码的真实 UT 文件。
 *
 * 放行列表（模块 / 命名空间类）：
 *   - TS2305 Module X has no exported member Y
 *   - TS2306 File is not a module
 *   - TS2307 Cannot find module X
 *   - TS2318 Cannot find global type
 *   - TS2503 Cannot find namespace
 *   - TS2688 Cannot find type definition
 *   - TS2691 import path cannot end with .ets
 *   - TS2694 Namespace has no exported member
 *   - TS2702 Namespace used as type
 *   - TS2709 Cannot use namespace as a type
 *   - TS2724 has no exported member named X (did you mean Y?)
 *
 * 跨文件类型错误（形参/签名不匹配等）由 ut_hvigor_build BLOCKER 接力。
 */
const MODULE_RESOLUTION_ERROR_CODES = new Set<number>([
  2305, 2306, 2307, 2318, 2503, 2688, 2691, 2694, 2702, 2709, 2724,
]);

const VIRTUAL_HYPIUM_PATH = toForwardSlash(path.resolve('__hypium_ambient__.d.ts'));

/**
 * 把 `.ets` 路径映射为 tsc 可识别的 `.ts`（同路径、同目录）。
 * 之所以不直接读原路径，是因为 tsc 不承认 `.ets` 扩展，会跳过或报错。
 */
function toVirtualTsPath(etsPath: string): string {
  if (etsPath.endsWith('.test.ets')) return etsPath.replace(/\.test\.ets$/, '.test.ts');
  if (etsPath.endsWith('.ets')) return etsPath.replace(/\.ets$/, '.ts');
  return etsPath;
}

/**
 * Windows 修正：tsc 内部把路径分隔符统一成正斜杠后再 lookup。
 * 我们的 virtualToReal map 与 program 传入的路径都必须用正斜杠形式存键，
 * 否则在 Windows 上 `getSourceFile`/`fileExists` 永远 miss，
 * 测试文件根本没被加到 program 里，自然零 diagnostic（假 PASS）。
 */
function toForwardSlash(p: string): string {
  return p.replace(/\\/g, '/');
}

function fromVirtualTsPath(virtualPath: string): string {
  if (virtualPath.endsWith('.test.ts')) return virtualPath.replace(/\.test\.ts$/, '.test.ets');
  // 注意：我们仅虚拟化 test 文件；其他 .ts 不还原为 .ets
  return virtualPath;
}

/**
 * 创建带 ets→ts 虚拟映射的 CompilerHost。
 * - 对 root 中的 `.test.ets` 路径：透明改名为 `.test.ts` 读入内容；
 * - 对 `__hypium_ambient__.d.ts`：提供内置声明；
 * - 其余文件走默认 host（由于 noResolve: true，实际不会发起太多读。）
 */
function createEtsAwareHost(
  virtualToReal: Map<string, string>,
  options: ts.CompilerOptions,
): ts.CompilerHost {
  const base = ts.createCompilerHost(options, /* setParentNodes */ true);

  const readVirtual = (virtualName: string): string | undefined => {
    const norm = toForwardSlash(virtualName);
    if (norm === VIRTUAL_HYPIUM_PATH) return HYPIUM_AMBIENT_DTS;
    const real = virtualToReal.get(norm);
    if (real && fs.existsSync(real)) {
      return fs.readFileSync(real, 'utf-8');
    }
    return undefined;
  };

  const host: ts.CompilerHost = {
    ...base,
    fileExists: (fileName: string): boolean => {
      const norm = toForwardSlash(fileName);
      if (norm === VIRTUAL_HYPIUM_PATH) return true;
      if (virtualToReal.has(norm)) return true;
      return base.fileExists(fileName);
    },
    readFile: (fileName: string): string | undefined => {
      const virt = readVirtual(fileName);
      if (virt !== undefined) return virt;
      return base.readFile(fileName);
    },
    getSourceFile: (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
      const virt = readVirtual(fileName);
      if (virt !== undefined) {
        return ts.createSourceFile(fileName, virt, languageVersion, /* setParentNodes */ true);
      }
      return base.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
    },
  };

  return host;
}

/**
 * 对一组 `.test.ets` 文件跑 tsc --noEmit，返回所有 Error 级诊断。
 *
 * @param testFiles 绝对路径数组（.test.ets）
 * @param projectRoot 项目根目录，用于把诊断路径转为相对路径
 */
export function compileTestFiles(
  testFiles: string[],
  projectRoot: string,
): TsCompileReport {
  const t0 = Date.now();

  if (testFiles.length === 0) {
    return { scannedFiles: [], diagnostics: [], durationMs: 0 };
  }

  const virtualToReal = new Map<string, string>();
  const rootNames: string[] = [VIRTUAL_HYPIUM_PATH];

  for (const etsPath of testFiles) {
    const abs = path.isAbsolute(etsPath) ? etsPath : path.resolve(projectRoot, etsPath);
    if (!fs.existsSync(abs)) continue;
    // 关键：用正斜杠形式存 key（与 tsc 内部保持一致，否则 Windows 下 lookup 全 miss）
    const virt = toForwardSlash(toVirtualTsPath(abs));
    virtualToReal.set(virt, abs);
    rootNames.push(virt);
  }

  if (rootNames.length <= 1) {
    return { scannedFiles: [], diagnostics: [], durationMs: Date.now() - t0 };
  }

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    noEmit: true,
    skipLibCheck: true,
    allowJs: true,
    checkJs: false,
    experimentalDecorators: true,
    emitDecoratorMetadata: false,
    // 关键：不跟随 import，避免被 ArkTS struct/@Component 源码绊倒
    noResolve: true,
    // 保留兼容：允许未使用 var；允许隐式 any（弱模型生成 UT 时常缺 type）
    noImplicitAny: false,
    strict: false,
    // 让 `import { describe } from '@ohos/hypium'` 走虚拟 ambient
    types: [],
    lib: ['lib.es2020.d.ts'],
  };

  const host = createEtsAwareHost(virtualToReal, options);
  const program = ts.createProgram(rootNames, options, host);

  // 聚合诊断：仅收集来自我们虚拟化的测试文件 + Error 级
  const allDiags = [
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
    ...program.getGlobalDiagnostics(),
  ];

  const diagnostics: TsDiagnostic[] = [];
  for (const d of allDiags) {
    if (d.category !== ts.DiagnosticCategory.Error) continue;
    // noResolve: true 下的模块解析类错误一律视作我们自己的设计副作用，
    // 不算 UT 作者的 bug——必须过滤，避免误报（详见上方 MODULE_RESOLUTION_ERROR_CODES 注释）
    if (MODULE_RESOLUTION_ERROR_CODES.has(d.code)) continue;
    const sf = d.file;
    if (!sf) continue;
    // 仅保留我们虚拟化进来的测试文件
    const sfNorm = toForwardSlash(sf.fileName);
    if (!virtualToReal.has(sfNorm)) continue;
    const realPath = virtualToReal.get(sfNorm)!;
    const relPath = path.relative(projectRoot, realPath).replace(/\\/g, '/');
    const { line, character } = sf.getLineAndCharacterOfPosition(d.start ?? 0);
    const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
    diagnostics.push({
      file: relPath,
      line: line + 1,
      column: character + 1,
      code: `TS${d.code}`,
      message,
      category: 'Error',
    });
  }

  return {
    scannedFiles: Array.from(virtualToReal.values()),
    diagnostics,
    durationMs: Date.now() - t0,
  };
}
