#!/usr/bin/env node
/**
 * Code Graph 试点 bootstrap：自动写 derived，可选从 catalog 生成 nodes 草稿。
 *
 * 用法（在宿主工程根，framework 已挂载为 framework/）：
 *   cd framework/harness
 *   npx ts-node scripts/bootstrap-code-graph.ts --project-root <宿主根> --module <模块名>
 *
 * 可选：
 *   --package-path <02-Feature/Foo>   覆盖 catalog 默认的 layer/name
 *   --seed-from-catalog               用 entry_file + key_exports 生成 nodes 草稿（core 默认 false）
 *   --dry-run                         只打印路径与摘要，不写文件
 */
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import minimist from 'minimist';
import { computeAnchorContentHash } from '../code-graph/anchor-hash';
import type { CodeGraphDerived, CodeGraphFile, CodeGraphNode } from '../code-graph/types';
import { loadFrameworkConfig, moduleGraphPath } from '../config';
import { findModule, loadCatalog } from './utils/catalog-parser';
import type { ModuleCard } from './utils/catalog-parser';
import type { GraphExtractResult, GraphSymbolSignature } from '../graph-extractor/types';
import { hmosGraphExtractor } from '../../profiles/hmos-app/harness/hmos-graph-extractor';

function usage(): void {
  console.error(`用法:
  bootstrap-code-graph.ts --project-root <dir> --module <name> [--package-path <path>]
    [--seed-from-catalog] [--dry-run]

说明:
  - derived（签名/import/模块内 call）由 GraphExtractor 自动生成，可随时重跑本命令刷新。
  - nodes（intent / core / anchor）为策展层：默认保留已有 YAML；首次可用 --seed-from-catalog 生成草稿。
  - 试点请把 3–5 个真正要守住的入口标为 core: true 并补 intent，勿整模块符号全标 core。`);
}

function resolvePackagePath(card: ModuleCard, override?: string): string {
  const trimmed = override?.trim();
  if (trimmed) return trimmed.replace(/\\/g, '/').replace(/\/+$/, '');
  return `${card.layer}/${card.name}`.replace(/\\/g, '/');
}

function toDerived(result: GraphExtractResult): CodeGraphDerived {
  return {
    signatures: result.signatures.map(s => ({
      file: s.file,
      symbol: s.symbol,
      signature: s.signature,
    })),
    import_edges: result.import_edges.map(e => ({
      from_file: e.from_file,
      to_module: e.to_module,
    })),
    call_edges: result.call_edges.map(e => ({
      caller_file: e.caller_file,
      caller_symbol: e.caller_symbol,
      callee_symbol: e.callee_symbol,
    })),
  };
}

function findSignatureForSymbol(
  signatures: GraphSymbolSignature[],
  symbol: string,
  preferFile?: string,
): GraphSymbolSignature | undefined {
  const norm = (p: string) => p.replace(/\\/g, '/');
  const pref = preferFile ? norm(preferFile) : undefined;
  const matches = signatures.filter(s => s.symbol === symbol);
  if (matches.length === 0) return undefined;
  if (pref) {
    const inEntry = matches.find(s => norm(s.file).endsWith(pref) || norm(s.file) === pref);
    if (inEntry) return inEntry;
  }
  return matches[0];
}

function seedNodesFromCatalog(
  projectRoot: string,
  card: ModuleCard,
  signatures: GraphSymbolSignature[],
): { nodes: CodeGraphNode[]; warnings: string[] } {
  const nodes: CodeGraphNode[] = [];
  const warnings: string[] = [];
  const symbols = new Set<string>();
  if (card.entry_file) symbols.add(path.basename(card.entry_file, path.extname(card.entry_file)));
  for (const k of card.key_exports ?? []) {
    const base = k.split('.').pop() ?? k;
    symbols.add(base.trim());
  }

  for (const symbol of symbols) {
    if (!symbol) continue;
    const sig = findSignatureForSymbol(signatures, symbol, card.entry_file);
    if (!sig) {
      warnings.push(`未在派生签名中找到符号 ${symbol}，跳过草稿节点`);
      continue;
    }
    const hash = computeAnchorContentHash(projectRoot, sig.file, sig.symbol);
    if (!hash) {
      warnings.push(`无法为 ${sig.file}#${sig.symbol} 计算 content_hash，跳过`);
      continue;
    }
    const id = `seed:${sig.symbol}`;
    if (nodes.some(n => n.id === id)) continue;
    nodes.push({
      id,
      core: false,
      intent: '（TODO）补一句业务意图；若为 Skill 5 core 闭环锚点则设 core: true',
      anchor: { file: sig.file, symbol: sig.symbol, content_hash: hash },
    });
  }
  return { nodes, warnings };
}

function loadExistingGraph(outPath: string, moduleName: string): CodeGraphFile | null {
  if (!fs.existsSync(outPath)) return null;
  try {
    const parsed = YAML.parse(fs.readFileSync(outPath, 'utf-8')) as CodeGraphFile;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function main(): void {
  const argv = minimist(process.argv.slice(2), {
    string: ['project-root', 'projectRoot', 'module', 'package-path', 'packagePath'],
    boolean: ['seed-from-catalog', 'seedFromCatalog', 'dry-run', 'dryRun'],
    alias: { 'project-root': 'projectRoot', 'package-path': 'packagePath', 'dry-run': 'dryRun' },
  });

  const projectRoot = path.resolve((argv['project-root'] ?? argv.projectRoot ?? '').trim());
  const moduleName = (argv.module ?? '').trim();
  const packagePathOverride = (argv['package-path'] ?? argv.packagePath ?? '').trim() || undefined;
  const seedFromCatalog = Boolean(argv['seed-from-catalog'] ?? argv.seedFromCatalog);
  const dryRun = Boolean(argv['dry-run'] ?? argv.dryRun);

  if (!projectRoot || !moduleName) {
    usage();
    process.exit(2);
  }

  const cfg = loadFrameworkConfig(projectRoot);
  const profileName = cfg.project_profile?.name ?? 'hmos-app';
  if (profileName !== 'hmos-app') {
    console.error(`[bootstrap-code-graph] 当前仅实现 hmos-app GraphExtractor；project_profile=${profileName}`);
    process.exit(1);
  }

  const catalogResult = loadCatalog(projectRoot);
  if (!catalogResult.ok) {
    console.error(`[bootstrap-code-graph] 无法加载 module catalog: ${catalogResult.error.kind}`);
    process.exit(1);
  }

  const card = findModule(catalogResult.catalog, moduleName);
  if (!card) {
    console.error(`[bootstrap-code-graph] catalog 中无模块 ${moduleName}`);
    process.exit(1);
  }

  const packagePath = resolvePackagePath(card, packagePathOverride);
  const absPkg = path.join(projectRoot, packagePath);
  if (!fs.existsSync(absPkg)) {
    console.error(`[bootstrap-code-graph] 包目录不存在: ${absPkg}`);
    process.exit(1);
  }

  const extracted = hmosGraphExtractor.extractModule(projectRoot, packagePath, moduleName);
  const outPath = moduleGraphPath(projectRoot, moduleName);
  const existing = loadExistingGraph(outPath, moduleName);

  let nodes = existing?.nodes ?? [];
  const warnings: string[] = [];

  if (seedFromCatalog && nodes.length === 0) {
    const seeded = seedNodesFromCatalog(projectRoot, card, extracted.signatures);
    nodes = seeded.nodes;
    warnings.push(...seeded.warnings);
  } else if (seedFromCatalog && nodes.length > 0) {
    warnings.push('已有 nodes[]，--seed-from-catalog 被跳过（避免覆盖策展层）');
  }

  const graph: CodeGraphFile = {
    schema_version: existing?.schema_version ?? '1.0',
    module: moduleName,
    generated_at: new Date().toISOString(),
    derived: toDerived(extracted),
    nodes,
  };

  if (dryRun) {
    console.log(JSON.stringify({
      outPath,
      packagePath,
      signatures: extracted.signatures.length,
      import_edges: extracted.import_edges.length,
      call_edges: extracted.call_edges.length,
      nodes: nodes.length,
      core_nodes: nodes.filter(n => n.core).length,
      warnings,
    }, null, 2));
    process.exit(0);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const doc = new YAML.Document(graph);
  fs.writeFileSync(outPath, String(doc), 'utf-8');

  console.log(`[bootstrap-code-graph] 已写入 ${path.relative(projectRoot, outPath)}`);
  console.log(`  derived: ${extracted.signatures.length} 签名, ${extracted.import_edges.length} import, ${extracted.call_edges.length} call`);
  console.log(`  nodes: ${nodes.length}（core: ${nodes.filter(n => n.core).length}）`);
  if (warnings.length) {
    console.log('  提示:');
    for (const w of warnings) console.log(`    - ${w}`);
  }
  if (nodes.filter(n => n.core).length === 0) {
    console.log('  下一步: 在 nodes 里为 3–5 个入口设 core: true 并写清 intent，再跑 Skill 5 Step 8.0 练闭环。');
  }
}

main();
