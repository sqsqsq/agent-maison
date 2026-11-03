import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

export interface TestModuleInfo { imports: string[]; dynamic: boolean; processCalls: boolean; goalEntry: boolean; declaredLayer?: 'function' | 'capability' }
export type TestDependencyGraph = Record<string, TestModuleInfo>;
export const REPO_ROOT = path.resolve(__dirname, '../../..');
export const repoPath = (file: string): string => path.relative(REPO_ROOT, path.resolve(file)).replace(/\\/g, '/');

export function buildTestDependencyGraph(files: string[], root = REPO_ROOT): TestDependencyGraph {
  const graph: TestDependencyGraph = {};
  const pending = files.map(file => path.resolve(root, file));
  while (pending.length) {
    const file = pending.pop()!;
    const key = path.relative(root, file).replace(/\\/g, '/');
    if (graph[key] || !/\.[cm]?tsx?$/.test(file) || !fs.existsSync(file)) continue;
    const info: TestModuleInfo = { imports: [], dynamic: false, processCalls: false, goalEntry: false };
    graph[key] = info;
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const processNames = new Set<string>(), processNamespaces = new Set<string>();
    for (const statement of source.statements) {
      if (ts.isVariableStatement(statement) && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'layer') continue;
          let value = declaration.initializer;
          while (value && (ts.isAsExpression(value) || ts.isParenthesizedExpression(value))) value = value.expression;
          if (value && ts.isStringLiteralLike(value) && (value.text === 'function' || value.text === 'capability')) info.declaredLayer = value.text;
        }
      }
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)
        || !/^(?:node:)?child_process$/.test(statement.moduleSpecifier.text) || statement.importClause?.isTypeOnly) continue;
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) processNamespaces.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) {
        if (!element.isTypeOnly) processNames.add(element.name.text);
      }
    }
    const resolve = (specifier: string): void => {
      if (!specifier.startsWith('.')) return;
      const target = ts.resolveModuleName(specifier, file, { moduleResolution: ts.ModuleResolutionKind.Node10, resolveJsonModule: true }, ts.sys).resolvedModule?.resolvedFileName;
      if (!target || target.includes('/node_modules/') || target.includes('\\node_modules\\')) return;
      const relative = path.relative(root, target).replace(/\\/g, '/');
      if (relative.startsWith('../')) return;
      info.imports.push(relative); pending.push(target);
    };
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) return;
        if (ts.isExportDeclaration(node) && node.isTypeOnly) return;
        if (node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) resolve(node.moduleSpecifier.text);
      }
      if (ts.isCallExpression(node)) {
        const expression = node.expression.getText(source);
        if (/^(?:require|import)$/.test(expression)) {
          const arg = node.arguments[0];
          if (arg && ts.isStringLiteralLike(arg)) resolve(arg.text);
          else info.dynamic = true;
        }
        if (processNames.has(expression) || [...processNamespaces].some(namespace => expression.startsWith(namespace + '.'))
          || /^require\(['"](?:node:)?child_process['"]\)\.(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)$/.test(expression)
          || /(?:^|\.)(?:runSuiteProcesses|runFixture)$/.test(expression)) info.processCalls = true;
        if (/(?:^|\.)(?:goalMain|goalEntry|runGoal|runGoalRuntimeChain|runGoalLoop|runGoalPhaseChain)$/.test(expression)) info.goalEntry = true;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    info.imports = [...new Set(info.imports)].sort();
  }
  return graph;
}

export function dependencyClosure(graph: TestDependencyGraph, entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file); for (const next of graph[file]?.imports ?? []) visit(next);
  };
  visit(entry); return seen;
}

// Mixed suites stay capability. Runtime interception catches calls missed by static analysis.
export function inferTestLayer(graph: TestDependencyGraph, entry: string): 'function' | 'capability' {
  if (graph[entry]?.declaredLayer) return graph[entry].declaredLayer!;
  return [...dependencyClosure(graph, entry)].some(file => (file.includes('/tests/') && !/\/tests\/utils\/(?:unit-suite-processes|unit-case-groups|test-impact|test-dependency-graph)\.ts$/.test(file) && graph[file]?.processCalls) || graph[file]?.goalEntry
    || /(?:^|\/)goal-(?:runner|phase-runtime|loop)\.ts$/.test(file)) ? 'capability' : 'function';
}

export function assertFunctionDependencies(graph: TestDependencyGraph, entry: string): void {
  const goal = [...dependencyClosure(graph, entry)].find(file => graph[file]?.goalEntry
    || /(?:^|\/)goal-(?:runner|phase-runtime|loop)\.ts$/.test(file));
  if (goal) throw new Error(`function suite depends on goal entry: ${entry} -> ${goal}`);
}
