/**
 * hmos-app GraphExtractor provider：import/签名走 ast-analyzer；调用链走 graph-extractor-host。
 */
import * as fs from 'fs';
import * as path from 'path';
import type {
  GraphExtractResult,
  GraphExtractor,
  GraphImportEdge,
  GraphSymbolSignature,
} from '../../../harness/graph-extractor/types';
import { AstAnalyzer } from './ast-analyzer';
import { collectIntraFileCallEdges } from './graph-extractor-host';

function listEtsFiles(packagePath: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'ohosTest' || ent.name === 'test') continue;
        walk(p);
      } else if (ent.name.endsWith('.ets')) {
        out.push(p);
      }
    }
  };
  walk(packagePath);
  return out;
}

export const hmosGraphExtractor: GraphExtractor = {
  profileId: 'hmos-app',
  extractModule(projectRoot: string, packagePath: string, moduleName: string): GraphExtractResult {
    const absPkg = path.isAbsolute(packagePath)
      ? packagePath
      : path.join(projectRoot, packagePath);
    const signatures: GraphSymbolSignature[] = [];
    const import_edges: GraphImportEdge[] = [];
    const call_edges: GraphExtractResult['call_edges'] = [];

    const analyzer = new AstAnalyzer(projectRoot);
    for (const abs of listEtsFiles(absPkg)) {
      const rel = path.relative(projectRoot, abs).replace(/\\/g, '/');
      const analysis = analyzer.analyzeFile(abs);
      for (const imp of analysis.imports ?? []) {
        import_edges.push({
          from_file: rel,
          to_module: imp.modulePath,
          imported_names: imp.importedNames,
        });
      }
      for (const cls of analysis.classes ?? []) {
        for (const m of cls.methods ?? []) {
          const params = m.params.map(p => `${p.name}: ${p.type}`).join(', ');
          signatures.push({
            file: rel,
            symbol: `${cls.name}.${m.name}`,
            kind: 'method',
            signature: `${m.name}(${params}): ${m.returnType}`,
            line: m.lineNumber,
          });
        }
      }
      for (const edge of collectIntraFileCallEdges(abs, projectRoot)) {
        call_edges.push({
          caller_file: rel,
          caller_symbol: edge.caller_symbol,
          callee_symbol: edge.callee_symbol,
          line: edge.line,
        });
      }
    }

    return { module: moduleName, signatures, import_edges, call_edges };
  },
};

/** loader 约定导出名（与 `hmosGraphExtractor` 同实例） */
export const graphExtractor: GraphExtractor = hmosGraphExtractor;
