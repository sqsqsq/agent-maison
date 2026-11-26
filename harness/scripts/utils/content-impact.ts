import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { execFileSync } from 'child_process';
import { diffChangedFilesWithStatus } from './git-diff';
import { extractExportSurface } from './ast-analyzer';
import { parseJson5 } from '../../../profiles/hmos-app/harness/har-export-resolve';
import { stableStringify } from './phase-evidence-manifest';
import type { RequestIntake } from './request-intake';

export interface ContentImpact {
  kind: 'interface' | 'route' | 'permission' | 'dependency' | 'persistence' | 'behavior';
  files: string[];
  detail: string;
  verification: string;
  state: 'required' | 'unknown';
  excluded_by_user: boolean;
  verification_family: 'ut' | 'testing' | 'architecture' | 'review';
}
export const IMPACT_VERIFICATION_FAMILY: Record<ContentImpact['kind'], ContentImpact['verification_family']> = {
  interface: 'ut', route: 'testing', permission: 'testing', dependency: 'architecture', persistence: 'ut', behavior: 'ut',
};
function codeTokens(source: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source);
  const tokens: string[] = [];
  while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) tokens.push(scanner.getTokenText());
  return tokens.join('\0');
}

const DEVICE_CALL = /\b(?:pushPath|pushUrl|replacePath|navigate|requestPermissionsFromUser|checkAccessToken)\s*\(/;

function literalWrite(statement: ts.Statement) {
  let name: string;
  let value: ts.Expression | undefined;
  let exported = false;
  if (ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Const) && statement.declarationList.declarations.length === 1) {
    const declaration = statement.declarationList.declarations[0];
    if (!ts.isIdentifier(declaration.name)) return;
    name = declaration.name.text;
    value = declaration.initializer;
    exported = statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  } else if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression)) {
    const { left, operatorToken, right } = statement.expression;
    if (operatorToken.kind !== ts.SyntaxKind.EqualsToken || !ts.isPropertyAccessExpression(left)
      || !ts.isIdentifier(left.expression) || left.expression.text !== 'exports') return;
    name = left.name.text;
    value = right;
    exported = true;
  } else return;
  if (!value || (!ts.isStringLiteral(value) && !ts.isNumericLiteral(value)
    && ![ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(value.kind))) return;
  const text = statement.getText();
  const start = statement.getStart();
  return { name, exported, shape: [codeTokens(text.slice(0, value.getStart() - start)), codeTokens(text.slice(value.end - start))].join('\0') };
}

/** Suppress the existing device candidate only for isolated scalar changes we can prove locally. */
function onlyUnreferencedScalarEdits(file: string, before: string, after: string): boolean {
  const previous = ts.createSourceFile(file, before, ts.ScriptTarget.Latest, true).statements;
  const current = ts.createSourceFile(file, after, ts.ScriptTarget.Latest, true).statements;
  if (previous.length !== current.length) return false;
  return previous.every((statement, index) => {
    const updated = current[index];
    if (codeTokens(statement.getText()) === codeTokens(updated.getText())) return true;
    const originalWrite = literalWrite(statement);
    const updatedWrite = literalWrite(updated);
    if (!originalWrite || !updatedWrite || originalWrite.shape !== updatedWrite.shape) return false;
    const { name, exported } = originalWrite;
    const names = new Set([name, 'eval', 'Function', ...(exported ? ['exports', 'module', 'require'] : [])]);
    function mayReferenceWrite(node: ts.Node): true | undefined {
      if (ts.isWithStatement(node)
        || exported && (node.kind === ts.SyntaxKind.ThisKeyword || node.kind === ts.SyntaxKind.ImportKeyword
          || ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || ts.isExportDeclaration(node))
        || (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && names.has(node.text)) return true;
      return ts.forEachChild(node, mayReferenceWrite);
    }
    return [previous, current].every(statements => statements.every((item, itemIndex) => itemIndex === index || !mayReferenceWrite(item)));
  });
}

function changedKeys(left: unknown, right: unknown, prefix = ''): string[] {
  if (stableStringify(left) === stableStringify(right)) return [];
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) || Array.isArray(right)) return [prefix];
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap(key => changedKeys((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], `${prefix}.${key}`));
}

/** Paths select candidates; only parsed before/after content produces specialized duties. */
export function deriveContentImpact(root: string, intake: RequestIntake): ContentImpact[] {
  const impacts: ContentImpact[] = [];
  const add = (kind: ContentImpact['kind'], file: string, detail: string, verification: string, state: ContentImpact['state'] = 'required'): void => {
    const verification_family = IMPACT_VERIFICATION_FAMILY[kind];
    impacts.push({ kind, files: [file], detail, verification, state, verification_family, excluded_by_user: intake.control.excluded.includes(verification_family) });
  };
  const diff = intake.baseline.base ? diffChangedFilesWithStatus({ projectRoot: root, baseRef: intake.baseline.base }) : undefined;
  for (const file of intake.targets) {
    const entry = diff?.entries.find(item => item.path === file);
    if (intake.baseline.dirty_digests && Object.prototype.hasOwnProperty.call(intake.baseline.dirty_digests, file) && intake.attribution_unknown.includes(file)) {
      const detail = intake.baseline.dirty_digests_at === 'prepare' ? '初始脏文件仅有首次准备摘要，开工时原件待核' : '初始脏文件的字节或存在性再次变化，写前原件待核';
      add('behavior', file, detail, '原作者核对本次新增影响并完成适用验证', 'unknown');
      continue;
    }
    let before = '';
    let after = '';
    try { if (intake.baseline.preimages?.[file]) before = intake.baseline.preimages[file].content;
      else if (intake.baseline.base && !intake.baseline.initially_absent?.includes(file)) before = execFileSync('git', ['show', `${intake.baseline.base}:${entry?.oldPath ?? file}`], { windowsHide: true, cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch { /* Added files have no old content. */ }
    if (fs.existsSync(path.resolve(root, file))) after = fs.readFileSync(path.resolve(root, file), 'utf8');
    if (before === after || codeTokens(before) === codeTokens(after)) continue;
    if (/\.json5?$/i.test(file)) {
      try {
        const keys = changedKeys(before.trim() ? parseJson5(before) : {}, after.trim() ? parseJson5(after) : {});
        for (const [kind, pattern, verification] of [
          ['route', /(?:route|router|pages|pageSourceFile|target|destination)/i, 'testing：实际跳转/参数回归'],
          ['permission', /permission|privilege|grant/i, 'testing：实际授权/拒绝分支'],
          ['dependency', /dependencies|devDependencies|peerDependencies/i, 'architecture：依赖方向、出口及真实构建'],
          ['persistence', /schema|column|table|migration|database/i, 'ut：旧数据升级、默认值及读写语义'],
        ] as const) if (keys.some(key => pattern.test(key))) add(kind, file, `实际配置键值改变：${keys.filter(key => pattern.test(key)).join(', ')}`, verification, kind === 'persistence' ? 'unknown' : 'required');
      } catch (error) { add('behavior', file, `配置无法按原解析器比较：${String(error)}`, '原作者核对内容并执行适用验证', 'unknown'); }
    } else if (/\.(?:[cm]?[jt]sx?|ets)$/.test(file)) {
      const previous = extractExportSurface(before), current = extractExportSurface(after);
      if (stableStringify(previous.signatures) !== stableStringify(current.signatures)) add('interface', file, '真实导出名、参数/返回、成员或重导出关系改变', 'compile + ut：调用方同步及兼容验证');
      if (previous.unknown.length || current.unknown.length) add('interface', file, [...new Set([...previous.unknown, ...current.unknown])].join('；'), '作者核对动态/推断接口与仓外消费者', 'unknown');
      if (/\b(?:CREATE\s+TABLE|ALTER\s+TABLE|migration|migrate|RdbStore|RelationalStore)\b/i.test(before + after)) add('persistence', file, '持久化源码实际改变，字段含义/既有值变化需要原作者核对', 'ut：存量样本、升级与默认值', 'unknown');
      if ((DEVICE_CALL.test(before) || DEVICE_CALL.test(after)) && !onlyUnreferencedScalarEdits(file, before, after)) {
        add('route', file, '源码变化可能影响同文件的跳转/权限调用', 'testing：相关跳转/权限分支', 'unknown');
      }
      add('behavior', file, '实际实现内容改变；按原用户预期核验金额、幂等及数据正确性等本次目标', 'review/ut：本请求针对性预期验证');
    }
  }
  return impacts;
}
