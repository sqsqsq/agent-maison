// ============================================================================
// ts-compile.ts（hmos-app 工具链 · 由 scripts/utils/ts-compile shim 转发）
// ============================================================================
// 轻量级 TypeScript 静态编译检查工具：对 *.test.ets 文件调用 TypeScript Compiler API
// （ts.createProgram）做 noEmit 扫描，用于 check-ut.ts 的 `ut_tsc_compiles` BLOCKER
// 规则。
//
// 设计取舍：
//  - ArkTS 的 `.ets` 扩展与 `struct`/`@Component` 在 tsc 眼里是非法语法，因此：
//    (1) 我们用**自定义 CompilerHost**把 `.ets` 虚拟映射为 `.ts` 源码；
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
import { createRequire } from 'module';

const harnessRequire = createRequire(path.resolve(__dirname, '..', '..', '..', 'harness', 'package.json'));
const ts = harnessRequire('typescript');

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
 *   (1) 声明 `@ohos/hypium` 所有成员为 any，避免 hypium API 漏声明误杀；
 *   (2) 通配模块声明，使相对路径 import 不会抛 TS2307。
 *
 * 该规则的定位是**测试文件本体的类型错误护栏**，跨文件检查交给
 * `ut_hvigor_build` BLOCKER。
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
 * `noResolve: true` 的设计就是**不跟随 import**，所以由此衍生的"模块解析类" TS 错误
 * 本质上都是我们自己关掉了解析造成的 false positive，必须过滤。
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
 */
function toForwardSlash(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * 创建带 ets→ts 虚拟映射的 CompilerHost。
 */
function createEtsAwareHost(
  virtualToReal: Map<string, string>,
  options: any,
): any {
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

  const host: any = {
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
    getSourceFile: (
      fileName: string,
      languageVersion: any,
      onError?: (message: string) => void,
      shouldCreateNewSourceFile?: boolean,
    ) => {
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
    const virt = toForwardSlash(toVirtualTsPath(abs));
    virtualToReal.set(virt, abs);
    rootNames.push(virt);
  }

  if (rootNames.length <= 1) {
    return { scannedFiles: [], diagnostics: [], durationMs: Date.now() - t0 };
  }

  const options: any = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    noEmit: true,
    skipLibCheck: true,
    allowJs: true,
    checkJs: false,
    experimentalDecorators: true,
    emitDecoratorMetadata: false,
    noResolve: true,
    noImplicitAny: false,
    strict: false,
    types: [],
    lib: ['lib.es2020.d.ts'],
  };

  const host = createEtsAwareHost(virtualToReal, options);
  const program = ts.createProgram(rootNames, options, host);

  const allDiags = [
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
    ...program.getGlobalDiagnostics(),
  ];

  const diagnostics: TsDiagnostic[] = [];
  for (const d of allDiags) {
    if (d.category !== ts.DiagnosticCategory.Error) continue;
    if (MODULE_RESOLUTION_ERROR_CODES.has(d.code)) continue;
    const sf = d.file;
    if (!sf) continue;
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
