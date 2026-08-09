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

/** mock-plan 单条 test double 策略（business-ut Test Double Policy） */
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

export interface TestabilityAuditParseResult {
  records: TestabilityAuditRecord[];
  errors: string[];
}

function validateAuditDocumentShape(doc: unknown, label: string, errors: string[]): void {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    errors.push(`${label}: 根节点必须是 YAML mapping/object`);
    return;
  }
  const value = doc as Record<string, unknown>;
  if ('records' in value && !Array.isArray(value.records)) {
    errors.push(`${label}: records 必须是数组`);
    return;
  }
  if (!('records' in value) && typeof value.acceptance_id !== 'string') {
    errors.push(`${label}: 须包含 records[] 或单条 acceptance_id`);
  }
}

export function parseTestabilityAuditFromTextDetailed(text: string): TestabilityAuditParseResult {
  const docs: unknown[] = [];
  const errors: string[] = [];
  const fenced = extractYamlFencedBlocks(text);
  if (fenced.length > 0) {
    fenced.forEach((block, index) => {
      const label = `fenced yaml #${index + 1}`;
      try {
        const doc = YAML.parse(block);
        validateAuditDocumentShape(doc, label, errors);
        docs.push(doc);
      } catch (e) {
        errors.push(`${label}: YAML 解析失败：${e instanceof Error ? e.message : String(e)}`);
      }
    });
  } else {
    try {
      const doc = YAML.parse(text);
      validateAuditDocumentShape(doc, 'document', errors);
      docs.push(doc);
    } catch (e) {
      errors.push(`document: YAML 解析失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { records: mergeParsedYamlDocuments(docs), errors };
}

/**
 * 解析 testability-audit.md：支持纯 YAML 或 Markdown + fenced yaml。
 */
export function parseTestabilityAuditFile(filePath: string): TestabilityAuditRecord[] {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
  return parseTestabilityAuditFromTextDetailed(text).records;
}

/** 从文本解析 testability-audit（不落盘）。 */
export function parseTestabilityAuditFromText(text: string): TestabilityAuditRecord[] {
  return parseTestabilityAuditFromTextDetailed(text).records;
}

export function parseMockPlanFile(filePath: string): MockPlanSpec | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const doc = YAML.parse(fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, ''));
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
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
  /** 静态可判定的目标类；mockFunc 打桩对象来自工厂/builder（返回未导出内部类）时无法判定 → undefined */
  targetClass?: string;
  method?: string;
}

/** `kit.mockFunc(obj, obj.method)` 赋值出的 mock 函数变量信息（hypium 真实 API 形态） */
export interface MockFuncVarInfo {
  /** mockFunc 第一参（被打桩对象变量名） */
  objVar: string;
  /** 被打桩方法名（mockFunc 第二参的成员名） */
  method: string;
  /** 尽力解析出的目标类；解析不出时 undefined（解析不出 ≠ 违规） */
  targetClass?: string;
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
  mockFuncVars?: Map<string, MockFuncVarInfo>,
): UtMockkitTargetUsage | null {
  // hypium 真实 API：when(mockedFn)(args).afterReturn/afterAction —— when(...) 括号内是
  // kit.mockFunc(obj, obj.method) 赋值出的**裸变量**（宿主 hypium@1.0.24 d.ts 实证形态）。
  const bare = /^([A-Za-z_$][\w$]*)$/.exec(inner);
  if (bare && mockFuncVars?.has(bare[1])) {
    const info = mockFuncVars.get(bare[1])!;
    return { targetClass: info.targetClass, method: info.method };
  }
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

/**
 * 尽力解析对象变量的静态类型：
 *   ① `objVar: ClassName` 显式类型注解；② `objVar = new ClassName(...)`。
 * `objVar = ClassName.factory(...)` 不猜——工厂/builder 常返回未导出内部类，
 * 按类名归因会造成错误的治理判定（宿主实证：`ServiceModel.builderForDuringStartUp()`
 * 返回的是 builder 内部类而非 ServiceModel）。
 */
function resolveObjVarClass(content: string, objVar: string): string | undefined {
  const annot = new RegExp(`\\b${objVar}\\s*:\\s*([A-Z][A-Za-z0-9_]*)\\b`).exec(content);
  if (annot) return annot[1];
  const ctor = new RegExp(
    `\\b${objVar}${TS_TYPE_ANNOT}=\\s*new\\s+([A-Z][A-Za-z0-9_]*)\\s*\\(`,
  ).exec(content);
  if (ctor) return ctor[1];
  return undefined;
}

/**
 * 收集 hypium 真实 mock API 的赋值：`mockVar = kit.mockFunc(obj, obj.method | Class.method)`
 * （kit 为 `new MockKit()` 实例）。返回 mockVar → { objVar, method, targetClass? }。
 */
export function collectMockFuncVarInfo(content: string): Map<string, MockFuncVarInfo> {
  const kitVars = collectMockkitKitVars(content);
  const out = new Map<string, MockFuncVarInfo>();
  const re = new RegExp(
    `(\\w+)${TS_TYPE_ANNOT}=\\s*(\\w+)\\.mockFunc\\s*\\(\\s*(\\w+)\\s*,\\s*([\\w$]+(?:\\.[\\w$]+)?)\\s*\\)`,
    'g',
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const [, mockVar, kitVar, objVar, funcExpr] = m;
    if (kitVar !== 'MockKit' && !kitVars.has(kitVar)) continue;
    const dot = funcExpr.lastIndexOf('.');
    const method = dot >= 0 ? funcExpr.slice(dot + 1) : funcExpr;
    const head = dot >= 0 ? funcExpr.slice(0, dot) : '';
    const targetClass = /^[A-Z]/.test(head) ? head : resolveObjVarClass(content, objVar);
    out.set(mockVar, { objVar, method, targetClass });
  }
  return out;
}

function pushUsage(usages: UtMockkitTargetUsage[], u: UtMockkitTargetUsage): void {
  const key = `${u.targetClass ?? ''}::${u.method ?? ''}`;
  if (!usages.some(x => `${x.targetClass ?? ''}::${x.method ?? ''}` === key)) {
    usages.push(u);
  }
}

/** 非去重收集（multiset）：每处 mock 声明/when 用法各计一次，供增量差集防"同 key 折叠吞新增" */
export function extractUtMockkitTargetsRaw(content: string): UtMockkitTargetUsage[] {
  const usages: UtMockkitTargetUsage[] = [];
  const varToClass = buildMockkitVarClassMap(content);
  const kitVars = collectMockkitKitVars(content);
  const mockFuncVars = collectMockFuncVarInfo(content);
  let m: RegExpExecArray | null;

  for (const [, cls] of varToClass) {
    usages.push({ targetClass: cls });
  }

  const mockRe = /MockKit\.mock\s*\(\s*([A-Z][A-Za-z0-9_]*)\s*\)/g;
  while ((m = mockRe.exec(content)) !== null) {
    usages.push({ targetClass: m[1] });
  }

  const instanceMockRe = /(\w+)\.mock\s*\(\s*([A-Z][A-Za-z0-9_]*)\s*\)/g;
  while ((m = instanceMockRe.exec(content)) !== null) {
    if (m[1] !== 'MockKit' && kitVars.has(m[1])) {
      usages.push({ targetClass: m[2] });
    }
  }

  // hypium 真实 API：mockFunc 赋值本身即打桩声明（无论是否再出现 when）
  for (const [, info] of mockFuncVars) {
    usages.push({ targetClass: info.targetClass, method: info.method });
  }

  for (const inner of collectHypiumWhenInners(content)) {
    const u = parseWhenInnerUsage(inner, varToClass, mockFuncVars);
    if (u) usages.push(u);
  }

  return usages;
}

/** 从 UT 源码粗解析 MockKit.mock / mockFunc / when(...) 目标（去重视图，不依赖 AST） */
export function extractUtMockkitTargets(content: string): UtMockkitTargetUsage[] {
  const usages: UtMockkitTargetUsage[] = [];
  for (const u of extractUtMockkitTargetsRaw(content)) {
    pushUsage(usages, u);
  }
  return usages;
}

/** 无法解析为受支持模式的 hypium when(...) 调用（解析不出 ≠ 违规：调用方应输出 WARN 级 unresolved，不作 BLOCKER） */
export function collectUnparsedHypiumWhenIssues(
  content: string,
  varToClass: Map<string, string>,
  mockFuncVars?: Map<string, MockFuncVarInfo>,
): string[] {
  const issues: string[] = [];
  const funcVars = mockFuncVars ?? collectMockFuncVarInfo(content);
  for (const inner of collectHypiumWhenInners(content)) {
    if (parseWhenInnerUsage(inner, varToClass, funcVars)) continue;
    issues.push(
      `when(${inner}) 未能静态解析（支持形态：when(Class.method) / when(var.method)（var=MockKit.mock(Class) 或 kit.mock(Class)）/ when(mockedFn)（mockedFn=kit.mockFunc(obj, obj.method)））`,
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

function usageKey(u: UtMockkitTargetUsage): string {
  return `${u.targetClass ?? ''}::${u.method ?? ''}`;
}

function countByKey<T>(items: T[], keyOf: (t: T) => string): Map<string, { count: number; sample: T }> {
  const m = new Map<string, { count: number; sample: T }>();
  for (const it of items) {
    const k = keyOf(it);
    const cur = m.get(k);
    if (cur) cur.count++;
    else m.set(k, { count: 1, sample: it });
  }
  return m;
}

/**
 * 相对基线内容的**新增** mock 面（plan 423e5d0f P1-1 用例级归属 · multiset 差）：
 * legacy 文件中基线已有的 MockKit 用法不受本 feature 问责，只有新增的进入治理。
 * 按出现次数做差（非集合去重差）——基线已 mock 过 Gateway.call 时，新用例再次 mock
 * 同一方法（新 preset/参数/行为）仍计为新增，不得被 key 折叠吞掉。
 */
export function collectNewMockkitSurface(
  content: string,
  baselineContent: string,
): { newUsages: UtMockkitTargetUsage[]; newUnparsed: string[] } {
  const curCounts = countByKey(extractUtMockkitTargetsRaw(content), usageKey);
  const baseCounts = countByKey(extractUtMockkitTargetsRaw(baselineContent), usageKey);
  const newUsages: UtMockkitTargetUsage[] = [];
  for (const [k, cur] of curCounts) {
    if (cur.count > (baseCounts.get(k)?.count ?? 0)) newUsages.push(cur.sample);
  }
  const curUnparsed = countByKey(
    collectUnparsedHypiumWhenIssues(content, buildMockkitVarClassMap(content)),
    s => s,
  );
  const baseUnparsed = countByKey(
    collectUnparsedHypiumWhenIssues(baselineContent, buildMockkitVarClassMap(baselineContent)),
    s => s,
  );
  const newUnparsed: string[] = [];
  for (const [k, cur] of curUnparsed) {
    if (cur.count > (baseUnparsed.get(k)?.count ?? 0)) newUnparsed.push(k);
  }
  return { newUsages, newUnparsed };
}

/** MockKit/when 治理结论分层：已证明违规（BLOCKER 材料）与静态解析不出（WARN 材料） */
export interface UtMockkitGovernanceReport {
  /** 已证明的违规：mock 被测入口 / 可判定类未在 mock-plan 声明 / 方法未声明 / preset 未引用 */
  violations: string[];
  /** 静态解析不出、无法证明违规的用法——解析不出 ≠ 违规，只配 WARN 与补声明建议 */
  unresolved: string[];
}

/**
 * UT 中 MockKit/when 用法须与 mock-plan mockkit 条目及禁止 mock 的入口类对齐。
 * @param forbiddenEntryClasses 被测 entry_point 类名（来自 testability-audit）
 */
export function collectUtMockkitGovernanceReport(
  content: string,
  plan: MockPlanSpec,
  forbiddenEntryClasses: Set<string>,
  opts?: {
    /** legacy 文件增量治理（P1-1）：提供基线内容时只治理相对基线**新增**的用法 */
    baselineContent?: string;
  },
): UtMockkitGovernanceReport {
  const violations: string[] = [];
  const unresolved: string[] = [];
  const varToClass = buildMockkitVarClassMap(content);
  const mockFuncVars = collectMockFuncVarInfo(content);
  let usages = extractUtMockkitTargets(content);
  const hasWhenCall = utContentUsesHypiumWhenCall(content);
  if (usages.length === 0 && !hasWhenCall) return { violations, unresolved };

  if (opts?.baselineContent !== undefined) {
    const surface = collectNewMockkitSurface(content, opts.baselineContent);
    usages = surface.newUsages;
    unresolved.push(...surface.newUnparsed);
    if (usages.length === 0 && surface.newUnparsed.length === 0) return { violations, unresolved };
  } else if (hasWhenCall) {
    unresolved.push(...collectUnparsedHypiumWhenIssues(content, varToClass, mockFuncVars));
  }

  const mockkitEntries = getMockPlanEntries(plan).filter(e => e.strategy === 'mockkit');
  const mockkitClasses = new Set(mockkitEntries.map(e => e.target_class));
  const declaredMethods = new Set(
    mockkitEntries.flatMap(e => (e.methods ?? []).map(meth => meth.name)),
  );
  const methodIndex = buildMockPlanPresetIndex(plan);

  for (const u of usages) {
    if (u.targetClass) {
      if (forbiddenEntryClasses.has(u.targetClass)) {
        const sym = u.method ? `${u.targetClass}.${u.method}` : u.targetClass;
        violations.push(`禁止 mock 被测入口 ${sym}（testability-audit entry_point）`);
        continue;
      }
      if (!mockkitClasses.has(u.targetClass)) {
        const sym = u.method ? `${u.targetClass}.${u.method}` : u.targetClass;
        violations.push(`MockKit/when 目标 ${sym} 未在 mock-plan 声明 strategy=mockkit`);
        continue;
      }
      if (u.method) {
        const key = `${u.targetClass}::${u.method}`;
        if (!methodIndex.has(key)) {
          violations.push(`MockKit/when 方法 ${u.targetClass}.${u.method} 未在 mock-plan mockkit 条目中声明`);
        }
      }
    } else if (u.method) {
      // 目标类静态不可判定（mockFunc 对象来自工厂/builder）：一律 unresolved——方法名与
      // mockkit 条目同名只是弱对齐，不能证明打的是声明的那个类，不得据此显示全绿；
      // 同样也不能证明违规，不给 BLOCKER。语义对齐交 AI verifier 复核。
      unresolved.push(
        declaredMethods.has(u.method)
          ? `mockFunc 打桩方法 ${u.method} 的目标类无法静态判定（方法名与 mockkit 条目弱对齐，是否同类由 verifier 语义复核）`
          : `mockFunc 打桩方法 ${u.method} 的目标类无法静态判定，且方法名未出现在任何 mockkit 条目 methods[]（建议在 mock-plan 补充声明以便追溯）`,
      );
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
        violations.push(
          'UT 使用 when(...) 但未引用 mock-plan mockkit presets[].id（须在源码中以字符串标注 preset id）',
        );
      }
    }
  }

  return { violations, unresolved };
}

/** 兼容包装：仅返回已证明违规（历史调用方语义 = BLOCKER 材料） */
export function collectUtMockkitGovernanceIssues(
  content: string,
  plan: MockPlanSpec,
  forbiddenEntryClasses: Set<string>,
): string[] {
  return collectUtMockkitGovernanceReport(content, plan, forbiddenEntryClasses).violations;
}
