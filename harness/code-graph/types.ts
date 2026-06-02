/**
 * Code Graph YAML 最小 schema（模块级索引，非 SSOT）。
 */

export interface CodeGraphAnchor {
  file: string;
  symbol: string;
  content_hash: string;
}

export interface CodeGraphNode {
  id: string;
  intent?: string;
  invariant?: string;
  core?: boolean;
  anchor: CodeGraphAnchor;
}

export interface CodeGraphDerived {
  signatures?: Array<{ file: string; symbol: string; signature: string }>;
  import_edges?: Array<{ from_file: string; to_module: string }>;
  call_edges?: Array<{ caller_file: string; caller_symbol: string; callee_symbol: string }>;
}

export interface CodeGraphFile {
  schema_version: string;
  module: string;
  generated_at?: string;
  derived?: CodeGraphDerived;
  nodes: CodeGraphNode[];
}
