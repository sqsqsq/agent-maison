/**
 * GraphExtractor contract — profile 实现从源码投影 Code Graph 派生段。
 * 实现方示例：profiles/hmos-app/harness/hmos-graph-extractor.ts
 */

export interface GraphCallEdge {
  caller_file: string;
  caller_symbol: string;
  callee_symbol: string;
  line: number;
}

export interface GraphImportEdge {
  from_file: string;
  to_module: string;
  imported_names: string[];
}

export interface GraphSymbolSignature {
  file: string;
  symbol: string;
  kind: 'class' | 'interface' | 'struct' | 'method' | 'function';
  signature: string;
  line: number;
}

export interface GraphExtractResult {
  module: string;
  signatures: GraphSymbolSignature[];
  import_edges: GraphImportEdge[];
  /** 模块内调用边（module_inner_layers 范围内；跨模块用 import 边表达） */
  call_edges: GraphCallEdge[];
}

export interface GraphExtractor {
  readonly profileId: string;
  extractModule(projectRoot: string, packagePath: string, moduleName: string): GraphExtractResult;
}
