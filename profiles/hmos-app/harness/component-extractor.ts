import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type { ComponentAsset, ComponentExtractor, StaticCheck } from '../../../harness/scripts/utils/component-assets';
import { validateProjectRelativePath } from '../../../harness/scripts/utils/project-relative-path';
import { resolveHarExportEntryPath } from './har-export-resolve';

// ponytail: 正则级 ArkTS 发现，不解析完整类型；复杂表达式保留 unknown，扩展语法时补探针。
const lexical = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g;
function mask(source: string, strings: boolean): string {
  return source.replace(lexical, token => strings || token.startsWith('/') ? token.replace(/[^\r\n]/g, ' ') : token);
}
function closeGroup(masked: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < masked.length; i++) {
    if (masked[i] === open) depth++;
    if (masked[i] === close && --depth === 0) return i;
  }
  return -1;
}
function combine(values: StaticCheck[]): StaticCheck {
  return values.includes('fail') ? 'fail' : values.includes('unknown') ? 'unknown' : values.includes('pass') ? 'pass' : 'not_applicable';
}
function unit(value: string | undefined, expected: 'fp' | 'vp', minimum = 0): StaticCheck {
  if (value === undefined) return 'unknown';
  const literal = value.trim().match(/^(?:['"](\d+(?:\.\d+)?)(fp|vp|px|lpx|%)['"]|(\d+(?:\.\d+)?))$/);
  if (!literal) return 'unknown';
  // ArkUI 数值长度默认 vp；字号必须显式 fp，避免宣称默认值证明了缩放单位。
  return (literal[2] ?? 'vp') === expected && Number(literal[1] ?? literal[3]) >= minimum ? 'pass' : 'fail';
}

export function componentStaticChecks(source: string): ComponentAsset['static_checks'] {
  const clean = mask(source, false);
  const masked = mask(source, true);
  const fonts: StaticCheck[] = [];
  const touches: StaticCheck[] = [];
  const controls = /\b([A-Z][A-Za-z0-9_]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = controls.exec(masked))) {
    const name = match[1];
    const start = masked.indexOf('(', match.index);
    let end = closeGroup(masked, start, '(', ')');
    if (end < 0) { fonts.push('unknown'); touches.push('unknown'); continue; }
    const args = clean.slice(start + 1, end);
    let cursor = end + 1;
    while (/\s/.test(masked[cursor] ?? '') && cursor < masked.length) cursor++;
    if (masked[cursor] === '{') {
      end = closeGroup(masked, cursor, '{', '}');
      if (end < 0) { fonts.push('unknown'); touches.push('unknown'); continue; }
      cursor = end + 1;
    }
    const attrs = new Map<string, string>();
    while (cursor < masked.length) {
      const attr = /^\s*\.([A-Za-z_]\w*)\s*\(/.exec(masked.slice(cursor));
      if (!attr) break;
      const open = cursor + attr[0].lastIndexOf('(');
      const close = closeGroup(masked, open, '(', ')');
      if (close < 0) break;
      attrs.set(attr[1], clean.slice(open + 1, close)); cursor = close + 1;
    }
    const textual = ['Text', 'Span', 'TextInput', 'TextArea', 'Search'].includes(name) || (name === 'Button' && args.trim().length > 0);
    if (textual || attrs.has('fontSize')) fonts.push(unit(attrs.get('fontSize'), 'fp'));
    const interactive = ['Button', 'Toggle', 'Checkbox', 'CheckboxGroup', 'Radio', 'Slider', 'TextInput', 'TextArea', 'Select', 'Rating', 'Search', 'DatePicker', 'TimePicker'].includes(name)
      || ['onClick', 'onTouch', 'gesture', 'onKeyEvent'].some(key => attrs.has(key));
    if (interactive) {
      const width = unit(attrs.get('width'), 'vp', 44);
      const height = unit(attrs.get('height'), 'vp', 44);
      touches.push(combine([width, height]));
    }
    const known = ['Text', 'Span', 'Row', 'Column', 'Stack', 'Flex', 'Grid', 'GridItem', 'List', 'ListItem', 'Scroll', 'Image', 'Blank', 'Divider', 'ForEach', 'LazyForEach', 'If', 'Button', 'Toggle', 'Checkbox', 'CheckboxGroup', 'Radio', 'Slider', 'TextInput', 'TextArea', 'Select', 'Rating', 'Search', 'DatePicker', 'TimePicker', 'NavDestination', 'Navigation', 'RelativeContainer'];
    if (!known.includes(name)) { fonts.push('unknown'); touches.push('unknown'); }
  }
  // 动态 builder/样式封装隐藏的表面不能当作不存在。
  if (/\bthis\s*\.[A-Za-z_]\w*\s*\(/.test(masked)) { fonts.push('unknown'); touches.push('unknown'); }
  // 全局 Builder 可为小写；不展开未知函数，不能用未命中大写控件证明无 UI。
  for (const call of masked.matchAll(/(?<![\w$])([a-z_$][\w$]*)\s*\(/g)) {
    if (['if', 'for', 'while', 'switch', 'catch', '$r', '$rawfile'].includes(call[1])
      || masked.slice(0, call.index).trimEnd().endsWith('.')) continue;
    const end = closeGroup(masked, masked.indexOf('(', call.index), '(', ')');
    // 参数后接方法体（可带返回类型）是声明；方法体内的实际调用仍继续扫描。
    if (end >= 0 && /^\s*(?::[^{};=]+)?\{/.test(masked.slice(end + 1))) continue;
    fonts.push('unknown'); touches.push('unknown');
  }
  return {
    scalable_font_unit: combine(fonts),
    no_hardcoded_hex_color: /#[a-f\d]{3,8}\b/i.test(clean) ? 'fail' : 'pass',
    declared_touch_target: combine(touches),
  };
}

/** 返回被注解的定义，不把 import/re-export 别名当成源码符号身份。 */
function definitions(source: string): Array<{ symbol: string; kind: ComponentAsset['kind']; props: string[]; body: string; deprecated: boolean; exported: boolean }> {
  const out: ReturnType<typeof definitions> = [];
  const masked = mask(source, true);
  const namedExports = [...masked.matchAll(/\bexport\s*\{([^}]+)\}(?!\s*from)/g)]
    .flatMap(m => m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]));
  const declarations = /@(ComponentV2|Component|Builder)\b(?:\s*\([^)]*\))?\s*(export\s+)?(?:default\s+)?(?:struct|function)\s+([A-Za-z_$][\w$]*)/g;
  let match: RegExpExecArray | null;
  while ((match = declarations.exec(masked))) {
    const open = masked.indexOf('{', declarations.lastIndex);
    const close = open < 0 ? -1 : closeGroup(masked, open, '{', '}');
    if (close < 0) throw new Error(`组件 ${match[3]} 缺完整定义体`);
    const body = source.slice(open + 1, close);
    const kind = match[1] === 'Builder' ? 'builder' : 'component';
    const props = kind === 'component'
      ? [...mask(body, true).matchAll(/@(?:Prop|Link|ObjectLink|Param|Event|BuilderParam|Require)\b\s*(?:\([^)]*\)\s*)?(?:@\w+\s+)*([A-Za-z_$][\w$]*)\s*[?:]/g)].map(m => m[1])
      : [...masked.slice(declarations.lastIndex, open).matchAll(/(?:\(|,)\s*([A-Za-z_$][\w$]*)\s*[?:]/g)].map(m => m[1]);
    const prefix = source.slice(0, match.index).trimEnd();
    const doc = prefix.endsWith('*/') ? prefix.slice(prefix.lastIndexOf('/**')) : '';
    out.push({ symbol: match[3], kind, props: [...new Set(props)].sort(), body, deprecated: /@deprecated\b/.test(doc), exported: Boolean(match[2]) || namedExports.includes(match[3]) });
    declarations.lastIndex = close + 1;
  }
  return out;
}

export const extractComponents: ComponentExtractor = (root, card, arch, readSource) => {
  const packagePath = validateProjectRelativePath(root, `${card.layer}/${card.name}`, 'module-catalog module');
  const read = readSource ?? ((file: string) => {
    const abs = path.join(root, validateProjectRelativePath(root, file, 'component source'));
    return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  });
  const resolved = resolveHarExportEntryPath(root, { name: card.name, package_path: packagePath }, arch.cross_module_exports_file, readSource);
  if (resolved.error) throw new Error(resolved.error);
  const entry = validateProjectRelativePath(root, resolved.relPath, 'component export');
  if (!entry.startsWith(`${packagePath}/`)) throw new Error('组件出口必须位于所属模块内');
  const source = read(entry);
  if (source === null) {
    if (readSource) return { components: [], warnings: [], exportFile: entry };
    throw new Error(`组件库出口不存在：${entry}`);
  }
  const warnings = resolved.warning ? [resolved.warning] : [];
  const selected = new Map<string, ComponentAsset>();
  const add = (file: string, text: string, symbols?: string[]) => {
    for (const def of definitions(text)) {
      if (!def.exported || (symbols && !symbols.includes(def.symbol))) continue;
      const id = `${card.name}/${file.slice(packagePath.length + 1)}#${def.symbol}`;
      selected.set(id, { id, module: card.name, file, symbol: def.symbol, kind: def.kind, props: def.props, deprecated: def.deprecated,
        source_fingerprint: `sha256:${createHash('sha256').update(text).digest('hex')}`, static_checks: componentStaticChecks(def.body) });
    }
  };
  add(entry, source);
  const clean = mask(source, false);
  if (/\bexport\s*\*/.test(clean)) warnings.push(`${entry}: export * v1 不展开，请人工确认并使用具名出口`);
  for (const match of clean.matchAll(/\bexport\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    if (!match[2].startsWith('.')) { warnings.push(`${entry}: 非相对 re-export 未展开：${match[2]}`); continue; }
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(entry), match[2]));
    const file = /\.(ets|ts)$/.test(base) ? base : `${base}.ets`;
    validateProjectRelativePath(root, file, 'component re-export');
    if (!file.startsWith(`${packagePath}/`)) throw new Error(`re-export 越出模块：${file}`);
    const text = read(file);
    if (text === null) { if (!readSource) warnings.push(`${entry}: re-export 源不存在：${file}`); continue; }
    const symbols = match[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean);
    add(file, text, symbols);
    if (/\bexport\s*(?:\*|\{)/.test(mask(text, false))) warnings.push(`${file}: 仅解析一跳具名 re-export，后续出口请人工确认`);
  }
  return { components: [...selected.values()], warnings, exportFile: entry };
};
