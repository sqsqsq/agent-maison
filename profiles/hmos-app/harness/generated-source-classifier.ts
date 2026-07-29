// ============================================================================
// generated-source-classifier.ts — hvigor 构建生成物分类器（plan d9e4b7c1 T1）
// ----------------------------------------------------------------------------
// 背景（2026-07-28 bc-openCard 事故）：hvigor `CreateHarBuildProfile` 在 testing
// invoke 窗口内合法重写模块根的 BuildProfile.ets（agent 跑 harness 自检触发
// device_test.build，设计内工作流），被纯 fs 快照写保护误判为 agent 改产品源码，
// run 进终止态。结构性复发：缓存失效/切 buildMode/清构建都会重跑该任务。
//
// 安全性质（v10 定稿）：该文件的风险面只有两个——模板外的额外代码、错误的常量值
// （会编译进 HAP 改变行为）。两者都由**纯内容校验**直接拦住，"谁写的"不构成风险：
// 与 hvigor 输出逐值一致的文件没有行为差异。因此不需要任何构建痕迹/账本。
//
// 三判据（全中才算合法生成物）：
//   (a) 路径 === 根 build-profile.json5 某 modules[].srcPath + '/BuildProfile.ets'
//       （模块根；任意嵌套目录不得进例外——v11 P2 收窄，不用宽 glob）；
//   (b) 变化类型仅 added/modified（removed/type-changed 由调用方前置排除，此处
//       同样 fail-closed 复核）；
//   (c) 盘上现内容为合法 hvigor 模板结构（四常量 + 兼容类，模板外零多余语句），
//       且四常量值与 attempt 冻结配置推导结果逐值一致：
//         HAR_VERSION      = 该模块根 oh-package.json5 的 version
//         BUILD_MODE_NAME  = 冻结 buildMode（'debug' | 'release'）
//         DEBUG            = (buildMode === 'debug')
//         TARGET_NAME      = 该模块 targets × applyToProducts 匹配冻结 product
//                            推导；无显式 target 声明回落 'default'
//       不做字节等值（hvigor 版本间模板注释措辞可漂移），解析常量比对值。
//
// 任一环不满足/不可核实 → not_generated（fail-closed，调用方维持 violation）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { listBuildProfileModules, parseProductJson5 } from './hvigor-runner';

export interface FrozenDeviceTestConfig {
  product: string;
  buildMode: 'debug' | 'release';
}

export interface GeneratedSourceChange {
  /** POSIX 相对 projectRoot 路径（与 product-source-snapshot 的 entries.path 同口径） */
  path: string;
  how: 'added' | 'removed' | 'modified' | 'type-changed';
}

export type GeneratedClassification =
  | { kind: 'generated_legit'; moduleSrcPath: string }
  | { kind: 'not_generated'; reason: string };

/** hvigor 模板四常量（顺序无关，集合必须恰好相等） */
const TEMPLATE_CONST_NAMES = ['HAR_VERSION', 'BUILD_MODE_NAME', 'DEBUG', 'TARGET_NAME'] as const;
type TemplateConstName = (typeof TEMPLATE_CONST_NAMES)[number];

interface ParsedTemplate {
  consts: Record<TemplateConstName, string>;
}

/** 剥注释（与 parseProductJson5 同款容忍度；字符串值内不含 // 与 /*，宿主模板无此形态） */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');
}

/**
 * 严格模板解析：内容 = 恰好四条 `export const NAME = VALUE;` + 一个只含
 * `static readonly NAME = NAME;` 的 `export default class BuildProfile`，
 * 此外零非空白残留。任何解析歧义 → null（调用方 fail-closed）。
 */
export function parseBuildProfileTemplate(raw: string): ParsedTemplate | null {
  let s = stripComments(raw);

  // ① 提取兼容类块（必须恰好一个）
  const classRe = /export\s+default\s+class\s+BuildProfile\s*\{([\s\S]*?)\}/g;
  const classMatch = classRe.exec(s);
  if (!classMatch || classRe.exec(s)) return null;
  const classBody = classMatch[1];
  s = s.slice(0, classMatch.index) + s.slice(classMatch.index + classMatch[0].length);

  // ② 类体只允许 `static readonly NAME = NAME;` 且 NAME ∈ 四常量（可缺省不可越界）
  let body = classBody;
  const memberRe = /static\s+readonly\s+(\w+)\s*=\s*(\w+)\s*;/g;
  let mm: RegExpExecArray | null;
  const seenMembers = new Set<string>();
  while ((mm = memberRe.exec(classBody)) !== null) {
    if (mm[1] !== mm[2]) return null;
    if (!(TEMPLATE_CONST_NAMES as readonly string[]).includes(mm[1])) return null;
    if (seenMembers.has(mm[1])) return null;
    seenMembers.add(mm[1]);
    body = body.replace(mm[0], ' ');
  }
  if (body.trim().length > 0) return null;
  // 兼容类四成员必须**齐全**（review P1：只验"已出现成员合法"会放过空类/缺成员——
  // 删除 BuildProfile.HAR_VERSION 等兼容 API 可能改变编译/消费行为，不得绕过写保护）
  if (seenMembers.size !== TEMPLATE_CONST_NAMES.length) return null;

  // ③ 顶层只允许四条 export const；逐条收集后必须零残留
  const consts: Partial<Record<TemplateConstName, string>> = {};
  const constRe = /export\s+const\s+(\w+)\s*=\s*('[^'\n]*'|"[^"\n]*"|true|false)\s*;/g;
  let cm: RegExpExecArray | null;
  let rest = s;
  while ((cm = constRe.exec(s)) !== null) {
    const name = cm[1];
    if (!(TEMPLATE_CONST_NAMES as readonly string[]).includes(name)) return null;
    if (consts[name as TemplateConstName] !== undefined) return null;
    let value = cm[2];
    if (value.startsWith("'") || value.startsWith('"')) value = value.slice(1, -1);
    consts[name as TemplateConstName] = value;
    rest = rest.replace(cm[0], ' ');
  }
  if (rest.trim().length > 0) return null;
  for (const n of TEMPLATE_CONST_NAMES) {
    if (consts[n] === undefined) return null;
  }
  return { consts: consts as Record<TemplateConstName, string> };
}

interface ModuleTargetEntry {
  name?: string;
  applyToProducts?: unknown;
}

/**
 * TARGET_NAME 推导（判据 c）：根 build-profile.json5 该模块条目的 targets[] 中
 * applyToProducts 含冻结 product 的目标；恰好一个 → 其名；零个且存在名为
 * 'default' 的目标 → 'default'；模块无 targets 声明 → 'default'；
 * 多个匹配（无法唯一推导）→ null（fail-closed）。
 */
export function deriveExpectedTargetName(
  projectRoot: string,
  moduleSrcPath: string,
  product: string,
): string | null {
  try {
    const bp = path.join(projectRoot, 'build-profile.json5');
    if (!fs.existsSync(bp)) return null;
    const obj = parseProductJson5(fs.readFileSync(bp, 'utf-8')) as {
      modules?: Array<{ srcPath?: string; targets?: ModuleTargetEntry[] }>;
    };
    const entry = (obj?.modules ?? []).find(
      m => typeof m?.srcPath === 'string' && m.srcPath.replace(/^\.\//, '').trim() === moduleSrcPath,
    );
    if (!entry) return null;
    const targets = Array.isArray(entry.targets) ? entry.targets : [];
    if (targets.length === 0) return 'default';
    const matched = targets.filter(
      t => Array.isArray(t?.applyToProducts) && (t.applyToProducts as unknown[]).includes(product),
    );
    if (matched.length === 1 && typeof matched[0].name === 'string') return matched[0].name;
    if (matched.length > 1) return null;
    return targets.some(t => t?.name === 'default') ? 'default' : null;
  } catch {
    return null;
  }
}

/** 该模块根 oh-package.json5 的 version（不可读/缺失 → null，fail-closed） */
export function readModuleOhPackageVersion(projectRoot: string, moduleSrcPath: string): string | null {
  try {
    const p = path.join(projectRoot, ...moduleSrcPath.split('/'), 'oh-package.json5');
    if (!fs.existsSync(p)) return null;
    const obj = parseProductJson5(fs.readFileSync(p, 'utf-8')) as { version?: unknown };
    return typeof obj?.version === 'string' && obj.version.trim() ? obj.version.trim() : null;
  } catch {
    return null;
  }
}

/**
 * 单条变更分类入口。goal-runner 在 violation 裁决处逐项调用；任何异常由调用方
 * 捕获并按 violation 处理（fail-closed）。
 */
export function classifyGeneratedSourceChange(
  projectRoot: string,
  change: GeneratedSourceChange,
  frozen: FrozenDeviceTestConfig,
): GeneratedClassification {
  // (b) removed/type-changed 永远不是合法生成物副作用
  if (change.how !== 'added' && change.how !== 'modified') {
    return { kind: 'not_generated', reason: `变化类型 ${change.how} 不可降级` };
  }
  // (a) 路径限定到声明模块根
  const modules = listBuildProfileModules(projectRoot);
  const mod = modules.find(m => `${m.srcPath.replace(/\\/g, '/')}/BuildProfile.ets` === change.path);
  if (!mod) {
    return { kind: 'not_generated', reason: '路径不是声明模块根的 BuildProfile.ets' };
  }
  // (c) 模板结构 + 冻结配置逐值等值
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(projectRoot, ...change.path.split('/')), 'utf-8');
  } catch {
    return { kind: 'not_generated', reason: '文件不可读（无法核实内容）' };
  }
  const parsed = parseBuildProfileTemplate(raw);
  if (!parsed) {
    return { kind: 'not_generated', reason: '内容不是纯 hvigor 模板（存在模板外语句或结构异常）' };
  }
  const expectVersion = readModuleOhPackageVersion(projectRoot, mod.srcPath);
  if (expectVersion === null) {
    return { kind: 'not_generated', reason: '模块 oh-package.json5 version 不可核实' };
  }
  if (parsed.consts.HAR_VERSION !== expectVersion) {
    return { kind: 'not_generated', reason: `HAR_VERSION=${parsed.consts.HAR_VERSION} 与模块版本 ${expectVersion} 不符` };
  }
  if (parsed.consts.BUILD_MODE_NAME !== frozen.buildMode) {
    return { kind: 'not_generated', reason: `BUILD_MODE_NAME=${parsed.consts.BUILD_MODE_NAME} 与冻结 buildMode ${frozen.buildMode} 不符` };
  }
  const expectDebug = frozen.buildMode === 'debug' ? 'true' : 'false';
  if (parsed.consts.DEBUG !== expectDebug) {
    return { kind: 'not_generated', reason: `DEBUG=${parsed.consts.DEBUG} 与冻结 buildMode 推导 ${expectDebug} 不符` };
  }
  const expectTarget = deriveExpectedTargetName(projectRoot, mod.srcPath, frozen.product);
  if (expectTarget === null) {
    return { kind: 'not_generated', reason: 'TARGET_NAME 期望值无法唯一推导' };
  }
  if (parsed.consts.TARGET_NAME !== expectTarget) {
    return { kind: 'not_generated', reason: `TARGET_NAME=${parsed.consts.TARGET_NAME} 与推导 ${expectTarget} 不符` };
  }
  return { kind: 'generated_legit', moduleSrcPath: mod.srcPath };
}
