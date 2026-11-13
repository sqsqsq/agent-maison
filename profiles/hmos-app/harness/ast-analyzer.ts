// ============================================================================
// ArkTS/ETS AST 分析器
// ============================================================================
// 对 .ets 文件做轻量级静态分析（导入复用 TS 语法解析，其余按 ArkTS 行扫描），提取：
//   - import 语句（模块路径、来源层级）
//   - class/interface/struct 声明与方法签名
//   - 装饰器使用 (@State, @Prop, @Link, @Entry, @Component 等)
//   - $r() 资源引用
//   - 硬编码字符串检测
//   - export 语句
//
// ArkUI DSL 不交给 TS 类型检查；导入目标复用现有 catalog/config 和模块出口解析。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import type * as TsModule from '../../../harness/node_modules/typescript';
import { createRequire, isBuiltin } from 'module';
import { loadCatalog } from '../../../harness/scripts/utils/catalog-parser';
import { projectImplementationModules } from '../../../harness/scripts/utils/diff-scope';
import { parseJson5, readOhPackageField, resolveHarExportEntryPath, SDK_RESERVED_SCOPE } from './har-export-resolve';
import {
  ArchitectureDsl,
  loadArchitectureDsl,
  buildOuterLayerIndex,
  buildInnerLayerIndex,
  getForbiddenInnerImports,
} from '../../../harness/config';

const ts: typeof TsModule = createRequire(path.resolve(__dirname, '../../../harness/package.json'))('typescript');

// --------------------------------------------------------------------------
// 数据结构
// --------------------------------------------------------------------------

export interface ImportInfo {
  raw: string;
  importedNames: string[];
  modulePath: string;
  isRelative: boolean;
  /** 按路径推断的来源层（模块内层：如 shared/data/domain/presentation 等，实际值来自 DSL） */
  sourceInternalLayer?: string;
  /** 按路径推断的来源架构层（outer layer id，实际值来自 DSL） */
  sourceArchLayer?: string;
  lineNumber: number;
  targetFile?: string;
  unresolved?: boolean;
}

export interface MethodSignature {
  name: string;
  params: Array<{ name: string; type: string }>;
  returnType: string;
  isAsync: boolean;
  lineNumber: number;
}

export interface ClassInfo {
  name: string;
  kind: 'class' | 'interface' | 'struct' | 'enum';
  decorators: string[];
  methods: MethodSignature[];
  properties: Array<{
    name: string;
    type: string;
    decorator?: string;
    lineNumber: number;
  }>;
  exportType: 'default' | 'named' | 'none';
  lineNumber: number;
}

export interface ResourceRef {
  raw: string;
  resourceType: string;
  key: string;
  lineNumber: number;
}

export interface HardcodedString {
  value: string;
  lineNumber: number;
  context: string;
}

export interface FileAnalysis {
  filePath: string;
  imports: ImportInfo[];
  classes: ClassInfo[];
  resourceRefs: ResourceRef[];
  hardcodedStrings: HardcodedString[];
  exports: string[];
}

export { extractExportSurface } from '../../../harness/scripts/utils/export-surface';

// --------------------------------------------------------------------------
// 分析器（层级信息来自 framework.config.json · architecture DSL）
// --------------------------------------------------------------------------

export class AstAnalyzer {
  private projectRoot: string;
  private arch: ArchitectureDsl;
  private innerLayers: string[];
  private innerLayerIndex: Map<string, number>;
  private outerLayerIndex: Map<string, number>;
  private modules: Array<{ name: string; package_path: string; entry_file?: string }>;
  private compilerOptions: TsModule.CompilerOptions;

  constructor(projectRoot: string, arch?: ArchitectureDsl) {
    this.projectRoot = projectRoot;
    this.arch = arch ?? loadArchitectureDsl(projectRoot);
    this.innerLayers = this.arch.module_inner_layers;
    this.innerLayerIndex = buildInnerLayerIndex(this.arch);
    this.outerLayerIndex = buildOuterLayerIndex(this.arch);
    const loaded = loadCatalog(projectRoot);
    const cards = loaded.ok ? loaded.catalog.modules : [];
    this.modules = projectImplementationModules(projectRoot, cards.map(card => ({ name: card.name, package_path: `${card.layer}/${card.name}` })))
      .map(mod => ({ ...mod, entry_file: cards.find(card => `${card.layer}/${card.name}` === mod.package_path)?.entry_file }))
      .sort((a, b) => b.package_path.length - a.package_path.length);
    const configFile = ts.findConfigFile(projectRoot, ts.sys.fileExists);
    const config = configFile ? ts.readConfigFile(configFile, ts.sys.readFile) : undefined;
    this.compilerOptions = configFile && config && !config.error
      ? ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configFile)).options : {};

  }

  /** 分析单个 .ets 文件 */
  analyzeFile(filePath: string): FileAnalysis {
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.projectRoot, filePath);

    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    const relativePath = path.relative(this.projectRoot, fullPath).replace(/\\/g, '/');

    return {
      filePath: relativePath,
      imports: this.extractImports(lines, relativePath),
      classes: this.extractClasses(lines),
      resourceRefs: this.extractResourceRefs(lines),
      hardcodedStrings: this.extractHardcodedStrings(lines, relativePath),
      exports: this.extractExports(lines),
    };
  }

  /** 批量分析多个文件 */
  analyzeFiles(filePaths: string[]): FileAnalysis[] {
    return filePaths
      .filter(p => {
        const full = path.isAbsolute(p) ? p : path.join(this.projectRoot, p);
        return fs.existsSync(full);
      })
      .map(p => this.analyzeFile(p));
  }

  // --------------------------------------------------------------------------
  // Import 提取
  // --------------------------------------------------------------------------

  private extractImports(lines: string[], currentFilePath: string): ImportInfo[] {
    const source = lines.join('\n');
    const file = ts.createSourceFile(currentFilePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const results: ImportInfo[] = [];
    const add = (modulePath: string, node: TsModule.Node, importedNames: string[] = [], dynamic = false): void => {
      const targetFile = dynamic ? undefined : this.resolveImport(modulePath, currentFilePath);
      const info: ImportInfo = { raw: node.getText(file), modulePath, importedNames,
        isRelative: modulePath.startsWith('.'), lineNumber: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
        targetFile: targetFile && targetFile !== 'external' ? targetFile : undefined,
        unresolved: !targetFile };
      // A missing target does not erase a relative path's already known layer direction.
      if (info.isRelative) {
        const relativeTarget = path.posix.normalize(path.posix.join(path.posix.dirname(currentFilePath), modulePath));
        info.sourceInternalLayer = this.inferInternalLayer(relativeTarget);
        info.sourceArchLayer = this.getFileArchLayer(relativeTarget);
      }
      if (info.targetFile) {
        info.sourceInternalLayer = this.inferInternalLayer(info.targetFile);
        info.sourceArchLayer = this.getFileArchLayer(info.targetFile);
      }
      results.push(info);
    };
    for (const node of file.statements) {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause;
        const names = clause?.namedBindings;
        add(node.moduleSpecifier.text, node, [...(clause?.name ? [clause.name.text] : []),
          ...(names ? ts.isNamedImports(names) ? names.elements.map(item => item.getText(file)) : [names.name.text] : [])]);
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        add(node.moduleSpecifier.text, node);
      }
    }
    const visit = (node: TsModule.Node): void => {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = node.arguments[0];
        add(arg && ts.isStringLiteral(arg) ? arg.text : '<dynamic import>', node, [], !arg || !ts.isStringLiteral(arg));
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    return results;
  }

  private moduleAt(file: string) {
    return this.modules.find(mod => file === mod.package_path || file.startsWith(mod.package_path + '/'));
  }

  private exportFile(mod: { name: string; package_path: string; entry_file?: string }): string {
    return mod.entry_file || resolveHarExportEntryPath(this.projectRoot, mod, this.arch.cross_module_exports_file).relPath;
  }

  private resolveImport(specifier: string, currentFile: string): string | undefined {
    if (SDK_RESERVED_SCOPE.test(specifier) || isBuiltin(specifier)) return 'external';
    const localFile = (base: string): string | undefined => {
      const rel = path.relative(this.projectRoot, base).replace(/\\/g, '/');
      const mod = this.modules.find(item => item.package_path === rel);
      const candidates = mod ? [path.join(this.projectRoot, this.exportFile(mod))]
        : [base, ...['.ets', '.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'].map(ext => base + ext),
          ...['index.ets', 'index.ts', 'index.js'].map(name => path.join(base, name))];
      const found = candidates.find(file => fs.existsSync(file) && fs.statSync(file).isFile());
      if (!found) return;
      const resolved = path.relative(this.projectRoot, fs.realpathSync(found)).replace(/\\/g, '/');
      return resolved.startsWith('../') || path.isAbsolute(resolved) ? undefined : resolved;
    };
    if (specifier.startsWith('.')) return localFile(path.resolve(this.projectRoot, path.dirname(currentFile), specifier));
    const named = this.modules.find(mod => [mod.name, readOhPackageField(this.projectRoot, mod.package_path, 'name')]
      .some(name => name && (specifier === name || specifier.startsWith(name + '/'))));
    if (named) {
      const name = [named.name, readOhPackageField(this.projectRoot, named.package_path, 'name')]
        .find(value => value && (specifier === value || specifier.startsWith(value + '/')))!;
      return localFile(path.join(this.projectRoot, named.package_path, specifier.slice(name.length)));
    }
    if ([...this.outerLayerIndex.keys()].some(layer => specifier.startsWith(layer + '/'))) return localFile(path.resolve(this.projectRoot, specifier));
    const resolved = ts.resolveModuleName(specifier, path.resolve(this.projectRoot, currentFile), this.compilerOptions, ts.sys).resolvedModule;
    if (resolved) return resolved.isExternalLibraryImport ? 'external' : localFile(resolved.resolvedFileName);
    const own = this.moduleAt(currentFile);
    for (const dir of [own?.package_path, ''].filter((value): value is string => value !== undefined)) {
      for (const name of ['oh-package.json5', 'package.json']) {
        try {
          const data = parseJson5(fs.readFileSync(path.join(this.projectRoot, dir, name), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
          for (const [dep, version] of Object.entries({ ...data.dependencies, ...data.devDependencies })) {
            if (specifier !== dep && !specifier.startsWith(dep + '/')) continue;
            if (/^file:/.test(version)) return localFile(path.resolve(this.projectRoot, dir, version.slice(5), specifier.slice(dep.length + 1)));
            if (!/^(?:link:|workspace:)/.test(version)) return 'external';
          }
        } catch { /* Missing or unsupported package metadata leaves the import unresolved. */ }
      }
    }
    return undefined;
  }

  // --------------------------------------------------------------------------
  // Class / Interface / Struct 提取
  // --------------------------------------------------------------------------

  private extractClasses(lines: string[]): ClassInfo[] {
    const results: ClassInfo[] = [];
    const classRe = /^\s*(export\s+(default\s+)?)?(abstract\s+)?(class|interface|struct|enum)\s+(\w+)/;
    const decoratorRe = /^\s*@(\w+)(\([^)]*\))?/;

    let pendingDecorators: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const decMatch = decoratorRe.exec(line);
      if (decMatch) {
        pendingDecorators.push(decMatch[1]);
        continue;
      }

      const classMatch = classRe.exec(line);
      if (classMatch) {
        const exportKeyword = classMatch[1]?.trim();
        const kind = classMatch[4] as ClassInfo['kind'];
        const name = classMatch[5];

        let exportType: ClassInfo['exportType'] = 'none';
        if (exportKeyword?.includes('default')) {
          exportType = 'default';
        } else if (exportKeyword?.startsWith('export')) {
          exportType = 'named';
        }

        const classInfo: ClassInfo = {
          name,
          kind,
          decorators: [...pendingDecorators],
          methods: [],
          properties: [],
          exportType,
          lineNumber: i + 1,
        };

        if (kind !== 'enum') {
          this.extractMembers(lines, i, classInfo);
        }

        results.push(classInfo);
        pendingDecorators = [];
      } else if (line.trim() && !line.trim().startsWith('//') && !line.trim().startsWith('/*')) {
        pendingDecorators = [];
      }
    }

    return results;
  }

  private extractMembers(lines: string[], classLineIndex: number, classInfo: ClassInfo): void {
    let braceCount = 0;
    let started = false;
    let pendingDecorator: string | undefined;
    const methodRe = /^\s*(async\s+)?(\w+)\s*\(([^)]*)\)\s*(?::\s*([^\s{]+(?:<[^>]+>)?))?/;
    const propertyRe = /^\s*(?:readonly\s+)?(\w+)\s*(?:\??\s*:\s*(.+?))\s*(?:=|;|$)/;
    const decoratorRe = /^\s*@(\w+)(\([^)]*\))?/;

    for (let i = classLineIndex; i < lines.length; i++) {
      const line = lines[i];

      if (line.includes('{')) {
        braceCount += (line.match(/\{/g) || []).length;
        started = true;
      }
      if (line.includes('}')) {
        braceCount -= (line.match(/\}/g) || []).length;
      }
      if (started && braceCount <= 0) break;
      if (i === classLineIndex) continue;

      const decMatch = decoratorRe.exec(line);
      if (decMatch) {
        pendingDecorator = decMatch[0].trim();
        continue;
      }

      const mMatch = methodRe.exec(line);
      if (mMatch && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
        const methodName = mMatch[2];
        if (['if', 'for', 'while', 'switch', 'return', 'catch', 'new', 'this', 'super'].includes(methodName)) {
          pendingDecorator = undefined;
          continue;
        }

        classInfo.methods.push({
          name: methodName,
          params: this.parseParams(mMatch[3]),
          returnType: mMatch[4] || 'void',
          isAsync: !!mMatch[1],
          lineNumber: i + 1,
        });
        pendingDecorator = undefined;
        continue;
      }

      const pMatch = propertyRe.exec(line);
      if (pMatch && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
        classInfo.properties.push({
          name: pMatch[1],
          type: pMatch[2]?.trim() || 'unknown',
          decorator: pendingDecorator,
          lineNumber: i + 1,
        });
        pendingDecorator = undefined;
      }
    }
  }

  private parseParams(raw: string): Array<{ name: string; type: string }> {
    if (!raw.trim()) return [];
    return raw.split(',').map(segment => {
      const parts = segment.trim().split(/\s*:\s*/);
      return {
        name: parts[0]?.replace(/\?$/, '').trim() || '',
        type: parts.slice(1).join(':').trim() || 'unknown',
      };
    }).filter(p => p.name);
  }

  // --------------------------------------------------------------------------
  // $r() 资源引用提取
  // --------------------------------------------------------------------------

  private extractResourceRefs(lines: string[]): ResourceRef[] {
    const results: ResourceRef[] = [];
    const rRe = /\$r\(\s*'app\.(\w+)\.([^']+)'\s*\)/g;

    for (let i = 0; i < lines.length; i++) {
      let match: RegExpExecArray | null;
      rRe.lastIndex = 0;
      while ((match = rRe.exec(lines[i])) !== null) {
        results.push({
          raw: match[0],
          resourceType: match[1],
          key: match[2],
          lineNumber: i + 1,
        });
      }
    }
    return results;
  }

  // --------------------------------------------------------------------------
  // 硬编码字符串检测
  // --------------------------------------------------------------------------

  private extractHardcodedStrings(lines: string[], filePath: string): HardcodedString[] {
    const isPresentationFile = filePath.includes('/presentation/');
    if (!isPresentationFile) return [];

    const results: HardcodedString[] = [];
    const chineseRe = /(['"])([^'"]*[\u4e00-\u9fa5][^'"]*)\1/g;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('//') || line.startsWith('*') || line.startsWith('import')) continue;
      if (line.includes('console.') || line.includes('Logger.') || line.includes('hilog.')) continue;

      chineseRe.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = chineseRe.exec(line)) !== null) {
        if (line.includes('$r(')) continue;
        results.push({
          value: match[2],
          lineNumber: i + 1,
          context: line.substring(0, 80),
        });
      }
    }
    return results;
  }

  // --------------------------------------------------------------------------
  // Export 提取
  // --------------------------------------------------------------------------

  private extractExports(lines: string[]): string[] {
    const results: string[] = [];
    const exportRe = /^\s*export\s+\{([^}]+)\}/;
    const exportDeclRe = /^\s*export\s+(default\s+)?(class|interface|struct|enum|function|const|let)\s+(\w+)/;

    for (const line of lines) {
      const match1 = exportRe.exec(line);
      if (match1) {
        results.push(...match1[1].split(',').map(s => s.trim()).filter(Boolean));
        continue;
      }
      const match2 = exportDeclRe.exec(line);
      if (match2) {
        results.push(match2[3]);
      }
    }
    return results;
  }

  // --------------------------------------------------------------------------
  // 层级推断工具
  // --------------------------------------------------------------------------

  /** 从文件路径推断模块内部层（层名由架构 DSL module_inner_layers 提供） */
  inferInternalLayer(filePath: string): string | undefined {
    const normalized = filePath.replace(/\\/g, '/');
    for (const layer of this.innerLayers) {
      if (normalized.includes(`/ets/${layer}/`) || normalized.includes(`/${layer}/`)) {
        return layer;
      }
    }
    return undefined;
  }

  /** 获取文件所属的内部层 */
  getFileInternalLayer(filePath: string): string | undefined {
    return this.inferInternalLayer(filePath);
  }

  /** 获取文件所属的 outer architecture layer */
  getFileArchLayer(filePath: string): string | undefined {
    const normalized = filePath.replace(/\\/g, '/');
    for (const layer of this.outerLayerIndex.keys()) {
      if (normalized === layer || normalized.startsWith(layer + '/')) return layer;
    }
    return undefined;
  }

  // --------------------------------------------------------------------------
  // 合规检查工具方法
  // --------------------------------------------------------------------------

  /**
   * 检查模块内分层合规：返回所有违反分层规则的 import。
   * 依据 architecture DSL 的 module_inner_layers（upward：索引小的层可被
   * 索引大的层 import；反向禁止）。
   */
  checkInternalLayerCompliance(analysis: FileAnalysis): Array<{
    file: string;
    import: ImportInfo;
    fileLayer: string;
    importLayer: string;
    message: string;
  }> {
    const violations: Array<{
      file: string;
      import: ImportInfo;
      fileLayer: string;
      importLayer: string;
      message: string;
    }> = [];

    const fileLayer = this.inferInternalLayer(analysis.filePath);
    if (!fileLayer) return violations;

    const forbidden = new Set(getForbiddenInnerImports(this.arch, fileLayer));

    for (const imp of analysis.imports) {
      if (!imp.isRelative || !imp.sourceInternalLayer) continue;
      const importLayer = imp.sourceInternalLayer;

      if (forbidden.has(importLayer)) {
        violations.push({
          file: analysis.filePath,
          import: imp,
          fileLayer,
          importLayer,
          message: `${fileLayer} 层文件 ${analysis.filePath} 不允许 import ${importLayer} 层 (line ${imp.lineNumber})`,
        });
      }
    }
    return violations;
  }

  /**
   * 检查跨模块 outer architecture layer 合规：依据 architecture DSL
   * 的 outer_layers[].can_depend_on 判定允许的依赖方向。
   *
   * 元规则在 config.ts 的 validateArchitectureDsl 启动时已经强制：
   *   - 整张层图必须是 DAG；
   *   - can_depend_on 不得自指、不得指向未声明层。
   * 所以这里只需要读许可矩阵，不用担心环路风险。
   */
  checkArchLayerCompliance(analysis: FileAnalysis): Array<{
    file: string;
    import: ImportInfo;
    fileArchLayer: string;
    importArchLayer: string;
    message: string;
  }> {
    const violations: Array<{
      file: string;
      import: ImportInfo;
      fileArchLayer: string;
      importArchLayer: string;
      message: string;
    }> = [];

    const fileArchLayer = this.getFileArchLayer(analysis.filePath);
    if (!fileArchLayer) return violations;

    const ownLayerSpec = this.arch.outer_layers.find((l) => l.id === fileArchLayer);
    if (!ownLayerSpec) return violations;

    const allowed = new Set(ownLayerSpec.can_depend_on);

    for (const imp of analysis.imports) {
      const importArchLayer = imp.sourceArchLayer;
      if (!importArchLayer || !this.outerLayerIndex.has(importArchLayer)) continue;
      if (importArchLayer !== fileArchLayer && !allowed.has(importArchLayer)) {
        violations.push({
          file: analysis.filePath,
          import: imp,
          fileArchLayer,
          importArchLayer,
          message: `${fileArchLayer} 层不可依赖 ${importArchLayer} 层 (${analysis.filePath} line ${imp.lineNumber})`,
        });
      }
      const own = this.moduleAt(analysis.filePath), target = imp.targetFile ? this.moduleAt(imp.targetFile) : undefined;
      if (own && target && own.package_path !== target.package_path && imp.targetFile !== this.exportFile(target)) {
        violations.push({ file: analysis.filePath, import: imp, fileArchLayer, importArchLayer,
          message: `${own.name} 跨模块访问 ${target.name} 必须经出口 ${this.exportFile(target)}，不能直达 ${imp.targetFile} (${analysis.filePath} line ${imp.lineNumber})` });
      }
    }
    return violations;
  }
}
