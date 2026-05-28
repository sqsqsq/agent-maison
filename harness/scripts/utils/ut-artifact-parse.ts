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

/** mock-plan 单条 test double 策略（Skill 5 Test Double Policy） */
export type MockPlanStrategy = 'spy' | 'mockkit' | 'fake' | 'prototype_patch';

export interface MockPlanEntry {
  target_class: string;
  target_file?: string;
  /** 优先于 legacy base_strategy；缺省 spy（subclass）或 prototype_patch（prototype_override） */
  strategy?: MockPlanStrategy;
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
}

export interface MockPlanSpec {
  schema_version?: string;
  feature?: string;
  imports?: Array<{ symbol?: string; from?: string }>;
  /** 推荐：与 spies 同结构，strategy 常为 mockkit */
  doubles?: MockPlanEntry[];
  spies?: MockPlanEntry[];
  fixtures?: Array<{ name?: string; type?: string; ts_expr?: string }>;
}

function resolveSpyEntryStrategy(entry: MockPlanEntry): MockPlanStrategy {
  if (entry.strategy) return entry.strategy;
  if (entry.base_strategy === 'prototype_override') return 'prototype_patch';
  return 'spy';
}

/** doubles[] 须显式 strategy；缺省不视为 mockkit */
function resolveDoubleEntryStrategy(entry: MockPlanEntry): MockPlanStrategy | undefined {
  if (entry.strategy) return entry.strategy;
  if (entry.base_strategy === 'prototype_override') return 'prototype_patch';
  return undefined;
}

/** doubles[] 缺 strategy 时返回问题描述（供 harness / validate CLI） */
export function collectDoublesMissingStrategy(plan: MockPlanSpec | null): string[] {
  const bad: string[] = [];
  for (const e of plan?.doubles ?? []) {
    if (!resolveDoubleEntryStrategy(e)) {
      bad.push(
        `doubles[].target_class=${e.target_class} 缺少 strategy（须显式声明 spy | mockkit | fake | prototype_patch）`,
      );
    }
  }
  return bad;
}

/** 合并 spies[] 与 doubles[]（解析后统一遍历；doubles 无 strategy 的条目仍纳入，strategy 字段缺省） */
export function getMockPlanEntries(plan: MockPlanSpec | null): MockPlanEntry[] {
  if (!plan) return [];
  const out: MockPlanEntry[] = [];
  for (const e of plan.spies ?? []) {
    out.push({ ...e, strategy: resolveSpyEntryStrategy(e) });
  }
  for (const e of plan.doubles ?? []) {
    const strategy = resolveDoubleEntryStrategy(e);
    out.push(strategy ? { ...e, strategy } : { ...e });
  }
  return out;
}

export function mockPlanHasEntries(plan: MockPlanSpec | null): boolean {
  return getMockPlanEntries(plan).length > 0;
}

export function mockPlanAllowsHypiumMockkit(plan: MockPlanSpec | null): boolean {
  return getMockPlanEntries(plan).some(e => e.strategy === 'mockkit');
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

/** 从文本解析 testability-audit（不落盘）。 */
export function parseTestabilityAuditFromText(text: string): TestabilityAuditRecord[] {
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

/** `${target_class}::${method}` -> preset ids（spy / mockkit 共用） */
export function buildMockPlanPresetIndex(plan: MockPlanSpec): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const entry of getMockPlanEntries(plan)) {
    const cls = entry.target_class;
    for (const meth of entry.methods ?? []) {
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
  for (const entry of getMockPlanEntries(plan)) {
    for (const meth of entry.methods ?? []) {
      for (const pr of meth.presets ?? []) {
        const rid = pr.id ?? '?';
        const returnExpr = pr.returns?.ts_expr;
        const throwExpr = pr.throws?.ts_expr;

        if (returnExpr === undefined && throwExpr === undefined) {
          bad.push(`${entry.target_class}.${meth.name} preset=${rid} 必须声明 returns.ts_expr 或 throws.ts_expr`);
          continue;
        }

        if (returnExpr !== undefined && (!returnExpr || !TYPED_EXPR_RE.test(returnExpr))) {
          bad.push(`${entry.target_class}.${meth.name} preset=${rid} returns.ts_expr 须含 "as Type" 或 "new Name("`);
        }
        if (throwExpr !== undefined && (!throwExpr || !TYPED_EXPR_RE.test(throwExpr))) {
          bad.push(`${entry.target_class}.${meth.name} preset=${rid} throws.ts_expr 须含 "as Type" 或 "new Name("`);
        }
      }
    }
  }
  return bad;
}

const HYPIUM_IMPORT_RE = /import\s*\{[^}]*\}\s*from\s*['"]@ohos\/hypium['"]/g;

function hypiumImportClauseUsesMockkit(clause: string): boolean {
  if (/\bMockKit\b/.test(clause)) return true;
  if (/\bwhen\b/.test(clause) && !/\bwhen[A-Z]\w*/.test(clause)) return true;
  return false;
}

/** UT 是否从 @ohos/hypium 导入 Hypium MockKit / 全局 when（非 Spy.whenXxx 属性）；扫描全部 import 子句 */
export function utFileImportsHypiumMockkit(content: string): boolean {
  const re = new RegExp(HYPIUM_IMPORT_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (hypiumImportClauseUsesMockkit(m[0])) return true;
  }
  return false;
}

export interface UtMockkitTargetUsage {
  targetClass: string;
  method?: string;
}

/** ArkTS/TS 可选类型注解：const id: Type = */
const TS_TYPE_ANNOT = '(?:\\s*:\\s*[^=;\\n]+)?\\s*';

/** 从 openParenIndex 的 '(' 读取平衡括号内文本 */
function readBalancedParenContent(content: string, openParenIndex: number): string | null {
  if (content[openParenIndex] !== '(') return null;
  let depth = 0;
  const start = openParenIndex + 1;
  for (let i = openParenIndex; i < content.length; i++) {
    const ch = content[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return content.slice(start, i);
    }
  }
  return null;
}

function isWholeParenExpr(s: string): boolean {
  if (!s.startsWith('(')) return false;
  const inner = readBalancedParenContent(s, 0);
  return inner !== null && s === `(${inner})`;
}

function collectHypiumWhenInners(content: string): string[] {
  const inners: string[] = [];
  const re = /\bwhen\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const openIdx = m.index + m[0].length - 1;
    const inner = readBalancedParenContent(content, openIdx);
    if (inner !== null) inners.push(inner.trim());
  }
  return inners;
}

function parseWhenInnerUsage(
  inner: string,
  varToClass: Map<string, string>,
): UtMockkitTargetUsage | null {
  const staticHead = /^([A-Z][A-Za-z0-9_]*)\.([A-Za-z_]\w*)([\s\S]*)$/.exec(inner);
  if (staticHead) {
    const rest = staticHead[3].trim();
    if (rest !== '' && !isWholeParenExpr(rest)) return null;
    return { targetClass: staticHead[1], method: staticHead[2] };
  }
  const varHead = /^([a-z][A-Za-z0-9_]*)\.([A-Za-z_]\w*)([\s\S]*)$/.exec(inner);
  if (varHead) {
    const cls = varToClass.get(varHead[1]);
    if (!cls) return null;
    const rest = varHead[3].trim();
    if (rest !== '' && !isWholeParenExpr(rest)) return null;
    return { targetClass: cls, method: varHead[2] };
  }
  return null;
}

function collectMockkitKitVars(content: string): Set<string> {
  const kitVars = new Set<string>();
  const newKitRe = new RegExp(`(\\w+)${TS_TYPE_ANNOT}=\\s*new\\s+MockKit\\s*\\(\\s*\\)`, 'g');
  let m: RegExpExecArray | null;
  while ((m = newKitRe.exec(content)) !== null) {
    kitVars.add(m[1]);
  }
  return kitVars;
}

/** MockKit 实例变量（new MockKit()）与 mock 结果变量 → 边界类名 */
export function buildMockkitVarClassMap(content: string): Map<string, string> {
  const varToClass = new Map<string, string>();
  const kitVars = collectMockkitKitVars(content);

  let m: RegExpExecArray | null;
  const mockAssignRe = new RegExp(
    `(\\w+)${TS_TYPE_ANNOT}=\\s*MockKit\\.mock\\s*\\(\\s*([A-Z][A-Za-z0-9_]*)\\s*\\)`,
    'g',
  );
  while ((m = mockAssignRe.exec(content)) !== null) {
    varToClass.set(m[1], m[2]);
  }

  const instanceAssignRe = new RegExp(
    `(\\w+)${TS_TYPE_ANNOT}=\\s*(\\w+)\\.mock\\s*\\(\\s*([A-Z][A-Za-z0-9_]*)\\s*\\)`,
    'g',
  );
  while ((m = instanceAssignRe.exec(content)) !== null) {
    if (m[2] === 'MockKit' || kitVars.has(m[2])) {
      varToClass.set(m[1], m[3]);
    }
  }

  return varToClass;
}

function pushUsage(usages: UtMockkitTargetUsage[], u: UtMockkitTargetUsage): void {
  const key = `${u.targetClass}::${u.method ?? ''}`;
  if (!usages.some(x => `${x.targetClass}::${x.method ?? ''}` === key)) {
    usages.push(u);
  }
}

/** 从 UT 源码粗解析 MockKit.mock / when(...) 目标（不依赖 AST） */
export function extractUtMockkitTargets(content: string): UtMockkitTargetUsage[] {
  const usages: UtMockkitTargetUsage[] = [];
  const varToClass = buildMockkitVarClassMap(content);
  const kitVars = collectMockkitKitVars(content);
  let m: RegExpExecArray | null;

  for (const [, cls] of varToClass) {
    pushUsage(usages, { targetClass: cls });
  }

  const mockRe = /MockKit\.mock\s*\(\s*([A-Z][A-Za-z0-9_]*)\s*\)/g;
  while ((m = mockRe.exec(content)) !== null) {
    pushUsage(usages, { targetClass: m[1] });
  }

  const instanceMockRe = /(\w+)\.mock\s*\(\s*([A-Z][A-Za-z0-9_]*)\s*\)/g;
  while ((m = instanceMockRe.exec(content)) !== null) {
    if (m[1] !== 'MockKit' && kitVars.has(m[1])) {
      pushUsage(usages, { targetClass: m[2] });
    }
  }

  for (const inner of collectHypiumWhenInners(content)) {
    const u = parseWhenInnerUsage(inner, varToClass);
    if (u) pushUsage(usages, u);
  }

  return usages;
}

/** 无法解析为受支持模式的 hypium when(...) 调用 */
export function collectUnparsedHypiumWhenIssues(
  content: string,
  varToClass: Map<string, string>,
): string[] {
  const issues: string[] = [];
  for (const inner of collectHypiumWhenInners(content)) {
    if (parseWhenInnerUsage(inner, varToClass)) continue;
    issues.push(
      `when(${inner}) 无法解析为受支持的 MockKit 模式（须 MockKit.mock(Class)、kit.mock(Class) 或 when(repo.method)）`,
    );
  }
  return issues;
}

function utContentUsesHypiumWhenCall(content: string): boolean {
  return /\bwhen\s*\(\s*/.test(content);
}

function collectMockkitPresetIds(plan: MockPlanSpec): Set<string> {
  const ids = new Set<string>();
  for (const e of getMockPlanEntries(plan)) {
    if (e.strategy !== 'mockkit') continue;
    for (const meth of e.methods ?? []) {
      for (const p of meth.presets ?? []) {
        if (p.id) ids.add(p.id);
      }
    }
  }
  return ids;
}

/**
 * UT 中 MockKit/when 用法须与 mock-plan mockkit 条目及禁止 mock 的入口类对齐。
 * @param forbiddenEntryClasses 被测 entry_point 类名（来自 testability-audit）
 */
export function collectUtMockkitGovernanceIssues(
  content: string,
  plan: MockPlanSpec,
  forbiddenEntryClasses: Set<string>,
): string[] {
  const issues: string[] = [];
  const varToClass = buildMockkitVarClassMap(content);
  const usages = extractUtMockkitTargets(content);
  const hasWhenCall = utContentUsesHypiumWhenCall(content);
  if (usages.length === 0 && !hasWhenCall) return issues;

  if (hasWhenCall) {
    for (const msg of collectUnparsedHypiumWhenIssues(content, varToClass)) {
      issues.push(msg);
    }
  }

  const mockkitEntries = getMockPlanEntries(plan).filter(e => e.strategy === 'mockkit');
  const mockkitClasses = new Set(mockkitEntries.map(e => e.target_class));
  const methodIndex = buildMockPlanPresetIndex(plan);

  for (const u of usages) {
    if (forbiddenEntryClasses.has(u.targetClass)) {
      const sym = u.method ? `${u.targetClass}.${u.method}` : u.targetClass;
      issues.push(`禁止 mock 被测入口 ${sym}（testability-audit entry_point）`);
      continue;
    }
    if (!mockkitClasses.has(u.targetClass)) {
      const sym = u.method ? `${u.targetClass}.${u.method}` : u.targetClass;
      issues.push(`MockKit/when 目标 ${sym} 未在 mock-plan 声明 strategy=mockkit`);
      continue;
    }
    if (u.method) {
      const key = `${u.targetClass}::${u.method}`;
      if (!methodIndex.has(key)) {
        issues.push(`MockKit/when 方法 ${u.targetClass}.${u.method} 未在 mock-plan mockkit 条目中声明`);
      }
    }
  }

  const parsedWhenCount = usages.filter(u => u.method).length;
  if (hasWhenCall && parsedWhenCount > 0) {
    const presetIds = collectMockkitPresetIds(plan);
    if (presetIds.size > 0) {
      const cited = [...presetIds].filter(id =>
        new RegExp(`['"]${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).test(content),
      );
      if (cited.length === 0) {
        issues.push(
          'UT 使用 when(...) 但未引用 mock-plan mockkit presets[].id（须在源码中以字符串标注 preset id）',
        );
      }
    }
  }

  return issues;
}
