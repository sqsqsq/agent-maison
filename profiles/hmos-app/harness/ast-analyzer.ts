// ============================================================================
// ArkTS/ETS AST 分析器
// ============================================================================
// 对 .ets 文件做轻量级静态分析（基于正则），提取：
//   - import 语句（模块路径、来源层级）
//   - class/interface/struct 声明与方法签名
//   - 装饰器使用 (@State, @Prop, @Link, @Entry, @Component 等)
//   - $r() 资源引用
//   - 硬编码字符串检测
//   - export 语句
//
// 不依赖完整 AST parser — ArkTS 尚无成熟的 TS 兼容 parser，
// 故采用正则 + 行扫描方案，在准确率和可移植性之间取得平衡。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  ArchitectureDsl,
  loadArchitectureDsl,
  buildOuterLayerIndex,
  buildInnerLayerIndex,
  getForbiddenInnerImports,
} from '../../../harness/config';

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

// --------------------------------------------------------------------------
// 分析器（层级信息来自 framework.config.json · architecture DSL）
// --------------------------------------------------------------------------

export class AstAnalyzer {
  private projectRoot: string;
  private arch: ArchitectureDsl;
  private innerLayers: string[];
  private innerLayerIndex: Map<string, number>;
  private outerLayerIndex: Map<string, number>;

  constructor(projectRoot: string, arch?: ArchitectureDsl) {
    this.projectRoot = projectRoot;
    this.arch = arch ?? loadArchitectureDsl(projectRoot);
    this.innerLayers = this.arch.module_inner_layers;
    this.innerLayerIndex = buildInnerLayerIndex(this.arch);
    this.outerLayerIndex = buildOuterLayerIndex(this.arch);
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
    const results: ImportInfo[] = [];
    const importRe = /^\s*import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/;
    const importDefaultRe = /^\s*import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match = importRe.exec(line);
      let importedNames: string[] = [];
      let modulePath = '';

      if (match) {
        importedNames = match[1].split(',').map(s => s.trim()).filter(Boolean);
        modulePath = match[2];
      } else {
        match = importDefaultRe.exec(line);
        if (match) {
          importedNames = [match[1]];
          modulePath = match[2];
        } else {
          continue;
        }
      }

      const isRelative = modulePath.startsWith('.');
      const info: ImportInfo = {
        raw: line.trim(),
        importedNames,
        modulePath,
        isRelative,
        lineNumber: i + 1,
      };

      if (isRelative) {
        const resolvedPath = path.posix.resolve(
          path.posix.dirname(currentFilePath),
          modulePath
        );
        info.sourceInternalLayer = this.inferInternalLayer(resolvedPath);
      }

      info.sourceArchLayer = this.inferArchLayer(modulePath, currentFilePath);

      results.push(info);
    }

    return results;
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

  /** 从 import 路径推断 outer architecture layer（候选值由 DSL outer_layers[].id 提供） */
  private inferArchLayer(modulePath: string, currentFile: string): string | undefined {
    const combined = modulePath.startsWith('.')
      ? path.posix.resolve(path.posix.dirname(currentFile), modulePath)
      : modulePath;

    for (const layer of this.outerLayerIndex.keys()) {
      if (combined.includes(layer)) return layer;
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
      if (normalized.includes(layer)) return layer;
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
      if (importArchLayer === fileArchLayer) continue;

      if (!allowed.has(importArchLayer)) {
        violations.push({
          file: analysis.filePath,
          import: imp,
          fileArchLayer,
          importArchLayer,
          message: `${fileArchLayer} 层不可依赖 ${importArchLayer} 层 (${analysis.filePath} line ${imp.lineNumber})`,
        });
      }
    }
    return violations;
  }
}
