import * as ts from 'typescript';
import { mask } from '../../../profiles/hmos-app/harness/component-extractor';

/** ArkUI method bodies are implementation DSL; retain declarations for the shared TS extractor. */
function arktsDeclarations(source: string): { source: string; structs: Set<string>; unknown: string[] } {
  const lexical = mask(source, true), chars = source.split(''), structs = new Set<string>(), unknown: string[] = [];
  const close = (open: number): number => {
    let depth = 1;
    for (let i = open + 1; i < lexical.length; i++) {
      if (lexical[i] === '{') depth++;
      else if (lexical[i] === '}' && --depth === 0) return i;
    }
    return -1;
  };
  for (const match of lexical.matchAll(/\bstruct\s+([A-Za-z_$][\w$]*)\s*\{/g)) {
    const open = lexical.indexOf('{', match.index), end = close(open);
    if (end < 0) { unknown.push(`struct ${match[1]} 的边界未解析，无法确认后续导出`); continue; }
    structs.add(match[1]);
    chars.splice(match.index, 6, ...'class ');
    for (let i = open + 1; i < end; i++) {
      if (lexical[i] !== '{') continue;
      const bodyEnd = close(i);
      if (/\)\s*(?::[^{};=]+)?\s*$/.test(lexical.slice(open + 1, i))) {
        for (let at = i + 1; at < bodyEnd; at++) if (!/[\r\n]/.test(chars[at])) chars[at] = ' ';
      }
      i = bodyEnd;
    }
  }
  return { source: chars.join(''), structs, unknown };
}

/** Export contracts, not component inventory or function bodies. Unsupported syntax stays unknown. */
export function extractExportSurface(source: string): { signatures: string[]; unknown: string[] } {
  const arkts = arktsDeclarations(source);
  const file = ts.createSourceFile('surface.ts', arkts.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const printer = ts.createPrinter({ removeComments: true });
  const print = (node: ts.Node): string => printer.printNode(ts.EmitHint.Unspecified, node, file).replace(/\s+/g, ' ').trim();
  const signatures: string[] = [];
  const unknown: string[] = [...arkts.unknown];
  const literalType = (node?: ts.Expression): string => !node ? 'unknown' : ts.isStringLiteralLike(node) ? 'string' : ts.isNumericLiteral(node) ? 'number' : node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword ? 'boolean' : 'unknown';
  const params = (items: ts.NodeArray<ts.ParameterDeclaration>): string => items.map(item => `${item.dotDotDotToken ? '...' : ''}${print(item.name)}${item.questionToken || item.initializer ? '?' : ''}:${item.type ? print(item.type) : literalType(item.initializer)}`).join(',');
  const exportedLocals = new Set(file.statements.flatMap(item => ts.isExportDeclaration(item) && !item.moduleSpecifier
    && item.exportClause && ts.isNamedExports(item.exportClause) ? item.exportClause.elements.map(element => (element.propertyName ?? element.name).text)
    : ts.isExportAssignment(item) && ts.isIdentifier(item.expression) ? [item.expression.text] : []));
  for (const item of file.statements) {
    if (ts.isExportDeclaration(item) || ts.isExportAssignment(item)) { signatures.push(print(item)); continue; }
    const modifiers = ts.canHaveModifiers(item) ? ts.getModifiers(item) : undefined;
    if (!modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword)
      && !(ts.isClassDeclaration(item) && item.name && arkts.structs.has(item.name.text) && exportedLocals.has(item.name.text))) continue;
    const prefix = modifiers?.some(mod => mod.kind === ts.SyntaxKind.DefaultKeyword) ? 'default ' : '';
    if (ts.isFunctionDeclaration(item)) {
      signatures.push(`${prefix}function ${item.name?.text ?? 'default'}<${item.typeParameters?.map(print).join(',') ?? ''}>(${params(item.parameters)}):${item.type ? print(item.type) : 'unknown'}`);
      if (!item.type) unknown.push(`导出函数${item.name?.text ?? 'default'}的推断返回类型未解析`);
    } else if (ts.isClassDeclaration(item)) {
      signatures.push(`${prefix}class ${item.name?.text ?? 'default'} ${item.heritageClauses?.map(print).join(' ') ?? ''}`);
      for (const member of item.members) {
        if (ts.canHaveModifiers(member) && ts.getModifiers(member)?.some(mod => mod.kind === ts.SyntaxKind.PrivateKeyword)) continue;
        if (ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member)) signatures.push(`${print(member.name ?? ts.factory.createIdentifier('constructor'))}(${params(member.parameters)}):${ts.isMethodDeclaration(member) && member.type ? print(member.type) : 'unknown'}`);
        else if (ts.isPropertyDeclaration(member)) {
          const decorators = ts.canHaveDecorators(member) ? ts.getDecorators(member)?.map(print).join(' ') : '';
          signatures.push(`${decorators ? decorators + ' ' : ''}${print(member.name)}${member.questionToken ? '?' : ''}:${member.type ? print(member.type) : literalType(member.initializer)}`);
          if (!member.type && literalType(member.initializer) === 'unknown') unknown.push(`导出属性${print(member.name)}的推断类型未解析`);
        }
        else signatures.push(print(member));
      }
    } else if (ts.isVariableStatement(item)) {
      for (const decl of item.declarationList.declarations) {
        signatures.push(`${prefix}${print(decl.name)}:${decl.type ? print(decl.type) : literalType(decl.initializer)}`);
        if (!decl.type && literalType(decl.initializer) === 'unknown') unknown.push(`导出值${print(decl.name)}的推断类型未解析`);
      }
    } else signatures.push(print(item));
  }
  if ((file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length && /\bexport\b/.test(mask(arkts.source, true))) unknown.push('当前语法不能由共享TS静态抽取器完整解析');
  if (/\b(?:module\.exports|exports\s*\[|Reflect\.|eval\s*\()/.test(source)) unknown.push('动态导出/反射需要作者依据和针对性验证');
  return { signatures: signatures.sort(), unknown: [...new Set(unknown)] };
}
