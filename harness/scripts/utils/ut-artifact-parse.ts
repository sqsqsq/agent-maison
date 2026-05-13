/**
 * UT 阶段产物解析：testability-audit.md / mock-plan.yaml
 * 供 check-ut.ts 与单元测试复用。
 */
import * as fs from 'fs';
import * as YAML from 'yaml';

export interface TestabilityAuditRecord {
  acceptance_id: string;
  entry_point?: { symbol?: string; file?: string };
  testability_level?: string;
  dependencies?: Array<{ name: string; kind?: string; seam?: string }>;
  verdict?: string;
  recommendation?: { option_a?: string; option_b?: string };
  selected?: string;
}

export interface MockPlanSpec {
  schema_version?: string;
  feature?: string;
  imports?: Array<{ symbol?: string; from?: string }>;
  spies?: Array<{
    target_class: string;
    target_file?: string;
    base_strategy?: string;
    spy_fields?: Array<{ name: string; type?: string; default?: string }>;
    methods?: Array<{
      name: string;
      params?: Array<{ name?: string; type_text?: string }>;
      return_type?: { text?: string };
      presets?: Array<{
        id?: string;
        returns?: { ts_expr?: string };
        throws?: { ts_expr?: string };
      }>;
    }>;
  }>;
  fixtures?: Array<{ name?: string; type?: string; ts_expr?: string }>;
}

/** 从 Markdown 中提取所有 ```yaml fenced 块内容 */
export function extractYamlFencedBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const re = /```ya?ml\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    const body = m[1]?.trim();
    if (body) blocks.push(body);
  }
  return blocks;
}

function mergeParsedYamlDocuments(docs: unknown[]): TestabilityAuditRecord[] {
  const out: TestabilityAuditRecord[] = [];
  for (const doc of docs) {
    if (!doc || typeof doc !== 'object') continue;
    const o = doc as Record<string, unknown>;
    if (Array.isArray(o.records)) {
      for (const r of o.records) {
        if (r && typeof r === 'object' && typeof (r as TestabilityAuditRecord).acceptance_id === 'string') {
          out.push(r as TestabilityAuditRecord);
        }
      }
    } else if (typeof o.acceptance_id === 'string') {
      out.push(o as unknown as TestabilityAuditRecord);
    }
  }
  return out;
}

/**
 * 解析 testability-audit.md：支持纯 YAML 或 Markdown + fenced yaml。
 */
export function parseTestabilityAuditFile(filePath: string): TestabilityAuditRecord[] {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
  const docs: unknown[] = [];

  const fenced = extractYamlFencedBlocks(text);
  if (fenced.length > 0) {
    for (const block of fenced) {
      try {
        docs.push(YAML.parse(block));
      } catch {
        /* skip corrupt block */
      }
    }
  } else {
    try {
      docs.push(YAML.parse(text));
    } catch {
      return [];
    }
  }

  return mergeParsedYamlDocuments(docs);
}

export function parseMockPlanFile(filePath: string): MockPlanSpec | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const doc = YAML.parse(fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, ''));
    if (!doc || typeof doc !== 'object') return null;
    return doc as MockPlanSpec;
  } catch {
    return null;
  }
}

/** spy key: `${target_class}::${method}` -> preset ids */
export function buildMockPlanPresetIndex(plan: MockPlanSpec): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const spy of plan.spies ?? []) {
    const cls = spy.target_class;
    for (const meth of spy.methods ?? []) {
      const key = `${cls}::${meth.name}`;
      const ids = new Set<string>();
      for (const p of meth.presets ?? []) {
        if (p.id) ids.add(p.id);
      }
      m.set(key, ids);
    }
  }
  return m;
}

export const TYPED_EXPR_RE = /\bas\s+[\w.<>,\s[\]]+|\bnew\s+\w+\s*\(/;

export function collectMockPlanTypedIssues(plan: MockPlanSpec): string[] {
  const bad: string[] = [];
  for (const spy of plan.spies ?? []) {
    for (const meth of spy.methods ?? []) {
      for (const pr of meth.presets ?? []) {
        const rid = pr.id ?? '?';
        const returnExpr = pr.returns?.ts_expr;
        const throwExpr = pr.throws?.ts_expr;

        if (returnExpr === undefined && throwExpr === undefined) {
          bad.push(`${spy.target_class}.${meth.name} preset=${rid} 必须声明 returns.ts_expr 或 throws.ts_expr`);
          continue;
        }

        if (returnExpr !== undefined && (!returnExpr || !TYPED_EXPR_RE.test(returnExpr))) {
          bad.push(`${spy.target_class}.${meth.name} preset=${rid} returns.ts_expr 须含 "as Type" 或 "new Name("`);
        }
        if (throwExpr !== undefined && (!throwExpr || !TYPED_EXPR_RE.test(throwExpr))) {
          bad.push(`${spy.target_class}.${meth.name} preset=${rid} throws.ts_expr 须含 "as Type" 或 "new Name("`);
        }
      }
    }
  }
  return bad;
}
