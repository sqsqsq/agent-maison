/**
 * GraphExtractor 专用 CompilerHost：.ets→.ts 虚拟映射 + 按需 import resolution。
 * 与 ts-compile.ts（noResolve UT 检查）分离，避免跨文件调用图误用 noResolve 路径。
 */
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';

const harnessRequire = createRequire(
  path.resolve(__dirname, '..', '..', '..', 'harness', 'package.json'),
);
const ts = harnessRequire('typescript');

const AMBIENT_DTS = `
declare module '*';
`.trim();

const VIRTUAL_AMBIENT = '__graph_ambient__.d.ts';

function toForwardSlash(p: string): string {
  return p.replace(/\\/g, '/');
}

function toVirtualTsPath(etsPath: string): string {
  if (etsPath.endsWith('.ets')) return etsPath.replace(/\.ets$/, '.ts');
  return etsPath;
}

export function createGraphExtractorHost(
  virtualToReal: Map<string, string>,
  options: ts.CompilerOptions,
): ts.CompilerHost {
  const base = ts.createCompilerHost(options, true);
  const ambientPath = toForwardSlash(path.resolve(VIRTUAL_AMBIENT));

  const readVirtual = (virtualName: string): string | undefined => {
    const norm = toForwardSlash(virtualName);
    if (norm === ambientPath) return AMBIENT_DTS;
    const real = virtualToReal.get(norm);
    if (real && fs.existsSync(real)) return fs.readFileSync(real, 'utf-8');
    return undefined;
  };

  return {
    ...base,
    fileExists: (fileName: string): boolean => {
      const norm = toForwardSlash(fileName);
      if (norm === ambientPath) return true;
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
      languageVersion: ts.ScriptTarget,
      onError?: (message: string) => void,
      shouldCreateNewSourceFile?: boolean,
    ) => {
      const virt = readVirtual(fileName);
      if (virt !== undefined) {
        return ts.createSourceFile(fileName, virt, languageVersion, true);
      }
      return base.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
    },
  };
}

export function collectIntraFileCallEdges(
  absEtsPath: string,
  projectRoot: string,
): Array<{ caller_symbol: string; callee_symbol: string; line: number }> {
  if (!fs.existsSync(absEtsPath)) return [];
  const virtualToReal = new Map<string, string>();
  const virt = toForwardSlash(toVirtualTsPath(absEtsPath));
  virtualToReal.set(virt, absEtsPath);

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    noEmit: true,
    skipLibCheck: true,
    allowJs: true,
    noResolve: false,
    strict: false,
  };

  const host = createGraphExtractorHost(virtualToReal, options);
  const ambientPath = toForwardSlash(path.resolve(VIRTUAL_AMBIENT));
  const rootNames = [ambientPath, virt];
  const program = ts.createProgram(rootNames, options, host);
  const sf = program.getSourceFile(virt);
  if (!sf) return [];

  const edges: Array<{ caller_symbol: string; callee_symbol: string; line: number }> = [];
  let currentFn = '<module>';

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      currentFn = node.name.getText(sf);
    } else if (ts.isMethodDeclaration(node) && node.name) {
      currentFn = node.name.getText(sf);
    } else if (ts.isCallExpression(node)) {
      const expr = node.expression;
      let callee = '';
      if (ts.isIdentifier(expr)) callee = expr.text;
      else if (ts.isPropertyAccessExpression(expr)) callee = expr.name.text;
      if (callee) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
        edges.push({ caller_symbol: currentFn, callee_symbol: callee, line: line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return edges;
}
