// ============================================================================
// closure-attestation.ts — review 闭环源码快照与 testing 对账（goal-fakepass-hardening t2）
// ============================================================================
// 事故背景：bc-openCard testing 期（review 之后）agent 向产品源码写入
// DEVICE_TEST_FAST_PATH=true 短路核心流程，零确定性拦截——review 审过的代码与真机
// 跑的代码不是同一份，且无任何机器可核验的差异信号。
//
// 防线（openspec harness-gates delta）：
//   - review 四件套闭环点生成 review-closure-attestation.json（**不得**由单跑
//     check-review 产出——否则改完代码重跑一个脚本即可刷新指纹）；
//   - inventory 范围=全产品源码树（codex 四轮 P1：**不由 contracts/模块声明推导**，
//     漏报模块不再漏网）：discoverProductSourceRoots() 五源并集；
//   - 两条 fail-safe：①发现 src/main 形态的产品目录不属于任何 root → 报错
//     （root discovery 缺陷即 fail-closed）；②profile 预期有产品源码但 inventory
//     为空 → 报错（不对空集生成合法 aggregate）；
//   - testing 按 attestation **固化**的 roots/inventory 对账（不按可能已变的
//     contracts.yaml 重取）：新增/修改/删除任一非空 → BLOCKER，指引回跑 review 闭环；
//   - attestation 缺失一律 FAIL，无 grace window（fail-open 通道就是事故的形状）。
//
// 边界（design §1）：同宿主并行开发其他 feature 会使树变化 → testing FAIL 要求重审
// ——视为特性（集成现实应重审），不做绕过。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { loadFrameworkConfig, receiptDirPath, resolveFeatureArtifact } from '../../config';
import { loadCatalog, allModuleNames, findModule } from './catalog-parser';
import { sha256File, stableStringify } from './phase-evidence-manifest';

export const REVIEW_CLOSURE_ATTESTATION_FILENAME = 'review-closure-attestation.json';
export const CLOSURE_ATTESTATION_SCHEMA_VERSION = '1.0';

/** 目录级排除（discovery 扫描与 inventory 走树共用；命中即整棵剪枝） */
const EXCLUDED_DIR_NAMES = new Set([
  'node_modules', 'oh_modules', '.git', '.hvigor', '.idea', '.preview', '.claude',
  '.cursor', 'build', 'dist', 'out', 'framework', 'doc', 'hvigor', 'scratch',
  'reports', '.hylyre', '.agents',
]);

/** src 下的测试子树（产品 inventory 排除；t3 行为开关扫描同口径） */
const TEST_SUBDIR_NAMES = new Set(['ohosTest', 'test', 'tests', 'mock']);

export interface DiscoveredRoots {
  /** 项目根相对 POSIX 路径的模块根（含 src/main 的目录） */
  roots: string[];
  /** root → 发现来源（outer_layer/build_profile/module_catalog/profile_default/residual_scan） */
  provenance: Record<string, string[]>;
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

function addRoot(acc: Map<string, Set<string>>, projectRoot: string, absModuleDir: string, source: string): void {
  if (!fs.existsSync(path.join(absModuleDir, 'src', 'main'))) return;
  const rel = toPosix(path.relative(projectRoot, absModuleDir));
  if (!rel || rel.startsWith('..')) return;
  const set = acc.get(rel) ?? new Set<string>();
  set.add(source);
  acc.set(rel, set);
}

/** 宽容解析 build-profile.json5 的 modules[].srcPath（剥注释后正则；解析失败返回空） */
export function parseBuildProfileSrcPaths(raw: string): string[] {
  const noComments = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const out: string[] = [];
  const re = /["']srcPath["']\s*:\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(noComments)) !== null) out.push(m[1]);
  return out;
}

/**
 * 五源并集发现产品源码根（openspec：inventory 范围不受 contracts 漏报限制）：
 * ①framework.config architecture.outer_layers 下实际存在的模块；
 * ②build-profile.json5 声明模块；③module-catalog（layer/name 拼路径）；
 * ④profile 标准根（hmos: entry/）；⑤残余扫描（深度受限走树找 src/main）。
 * 残余扫描本身就是"孤儿产品目录"fail-safe 的实现——凡含 src/main 的未排除目录
 * 必入 roots，不存在"发现了但不属于任何 root"的状态；单测以构造性目录验证。
 */
export function discoverProductSourceRoots(projectRoot: string): DiscoveredRoots {
  const acc = new Map<string, Set<string>>();

  // ① architecture outer layers
  try {
    const cfg = loadFrameworkConfig(projectRoot) as {
      architecture?: { outer_layers?: Array<{ id?: string }> };
    };
    for (const layer of cfg.architecture?.outer_layers ?? []) {
      if (!layer.id) continue;
      const layerAbs = path.join(projectRoot, layer.id);
      if (!fs.existsSync(layerAbs) || !fs.statSync(layerAbs).isDirectory()) continue;
      for (const ent of fs.readdirSync(layerAbs, { withFileTypes: true })) {
        if (!ent.isDirectory() || EXCLUDED_DIR_NAMES.has(ent.name)) continue;
        addRoot(acc, projectRoot, path.join(layerAbs, ent.name), 'outer_layer');
      }
      // 层目录本身即模块（罕见但合法）
      addRoot(acc, projectRoot, layerAbs, 'outer_layer');
    }
  } catch { /* config 缺失走其余来源 */ }

  // ② build-profile.json5
  const bp = path.join(projectRoot, 'build-profile.json5');
  if (fs.existsSync(bp)) {
    try {
      for (const src of parseBuildProfileSrcPaths(fs.readFileSync(bp, 'utf-8'))) {
        addRoot(acc, projectRoot, path.resolve(projectRoot, src), 'build_profile');
      }
    } catch { /* 宽容 */ }
  }

  // ③ module catalog
  try {
    const cat = loadCatalog(projectRoot);
    if (cat.ok) {
      for (const name of allModuleNames(cat.catalog)) {
        const card = findModule(cat.catalog, name);
        if (!card?.layer) continue;
        addRoot(acc, projectRoot, path.join(projectRoot, card.layer, card.name), 'module_catalog');
      }
    }
  } catch { /* 宽容 */ }

  // ④ profile 标准根（hmos 惯例 entry/；存在才计）
  addRoot(acc, projectRoot, path.join(projectRoot, 'entry'), 'profile_default');

  // ⑤ 残余扫描：**无深度上限**（codex 六轮 P0-6：深度 ≤3 时 a/b/c/d/src/main 深层
  //    新模块可绕过对账——与 newmod/src/main 同类，只是多嵌几层）。剪枝：排除目录、
  //    隐藏目录、以及已命中模块根的 src/ 子树（模块内不再有嵌套模块根语义）。
  const scan = (dirAbs: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (!ent.isDirectory() || EXCLUDED_DIR_NAMES.has(ent.name) || ent.name.startsWith('.')) continue;
      const childAbs = path.join(dirAbs, ent.name);
      addRoot(acc, projectRoot, childAbs, 'residual_scan');
      if (ent.name === 'src' && fs.existsSync(path.join(dirAbs, 'src', 'main'))) continue; // 模块根已计，src 内不再下钻
      scan(childAbs);
    }
  };
  scan(projectRoot);

  const roots = [...acc.keys()].sort();
  const provenance: Record<string, string[]> = {};
  for (const r of roots) provenance[r] = [...acc.get(r)!].sort();
  return { roots, provenance };
}

export interface InventoryFile {
  path: string;
  sha256: string;
}

export interface SourceInventory {
  roots: string[];
  files: InventoryFile[];
  file_count: number;
  aggregate_sha256: string;
}

function isTestPath(relFromSrc: string): boolean {
  const first = relFromSrc.split('/')[0];
  return TEST_SUBDIR_NAMES.has(first);
}

/** 走单个模块根的 src/**（排除测试子树），返回项目根相对文件清单 */
export function collectProductSourceFiles(projectRoot: string, rootRel: string): string[] {
  const srcAbs = path.join(projectRoot, rootRel, 'src');
  const out: string[] = [];
  const walk = (dirAbs: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const childAbs = path.join(dirAbs, ent.name);
      const relFromSrc = toPosix(path.relative(srcAbs, childAbs));
      if (ent.isDirectory()) {
        if (EXCLUDED_DIR_NAMES.has(ent.name)) continue;
        if (isTestPath(relFromSrc)) continue;
        walk(childAbs);
      } else if (ent.isFile()) {
        if (isTestPath(relFromSrc)) continue;
        out.push(toPosix(path.relative(projectRoot, childAbs)));
      }
    }
  };
  walk(srcAbs);
  return out.sort();
}

/**
 * 构建产品源码 inventory。fail-safe②：expectProductSources 且清单为空 → throw
 * （不对空集生成合法 aggregate——空集 hash 会让"根本没扫到东西"看起来像"零文件合法快照"）。
 */
export function buildSourceInventory(
  projectRoot: string,
  opts: { expectProductSources: boolean; roots?: string[] },
): SourceInventory {
  const roots = opts.roots ?? discoverProductSourceRoots(projectRoot).roots;
  const files: InventoryFile[] = [];
  for (const root of roots) {
    for (const rel of collectProductSourceFiles(projectRoot, root)) {
      const hash = sha256File(path.join(projectRoot, rel));
      if (hash) files.push({ path: rel, sha256: hash });
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  if (opts.expectProductSources && files.length === 0) {
    throw new Error(
      '[closure-attestation] 产品源码 inventory 为空但项目类型预期有产品源码——root discovery 失败即 fail-closed，不生成空集快照。',
    );
  }
  const aggregate = crypto
    .createHash('sha256')
    .update(stableStringify(files), 'utf-8')
    .digest('hex');
  return { roots, files, file_count: files.length, aggregate_sha256: aggregate };
}

export interface ReviewClosureAttestation {
  schema_version: string;
  feature: string;
  generated_at: string;
  /** contracts.yaml 自身哈希 + 规范化 files 清单（对照用途；scope 不由它推导） */
  contracts_sha256: string | null;
  contracts_files: string[];
  inventory: SourceInventory;
  review_report_sha256: string | null;
  verifier_report_sha256: string | null;
  gate_fingerprint: string | null;
  run_identity: { run_id?: string; attempt?: string } | null;
}

export function reviewClosureAttestationPath(projectRoot: string, feature: string): string {
  return path.join(receiptDirPath(projectRoot, feature, 'review'), 'reports', REVIEW_CLOSURE_ATTESTATION_FILENAME);
}

function parseContractsFiles(contractsRaw: string): string[] {
  // contracts.yaml files: 列表——宽容提取（仅对照展示用途，不决定 scope）
  const files: string[] = [];
  const lines = contractsRaw.split('\n');
  let inFiles = false;
  for (const line of lines) {
    if (/^files\s*:/.test(line)) { inFiles = true; continue; }
    if (inFiles) {
      const m = /^\s*-\s*(.+?)\s*$/.exec(line);
      if (m) files.push(m[1].replace(/^["']|["']$/g, ''));
      else if (/^\S/.test(line)) break;
    }
  }
  return files;
}

export interface WriteAttestationOptions {
  projectRoot: string;
  feature: string;
  expectProductSources: boolean;
  gateFingerprint?: string | null;
  runIdentity?: { run_id?: string; attempt?: string } | null;
  now?: () => Date;
}

/**
 * review 闭环点生成 attestation（调用点=check-receipt --phase review 通过路径，
 * **不在** check-review 内——单跑 check-review 不产出，见模块头）。
 */
export function writeReviewClosureAttestation(opts: WriteAttestationOptions): {
  absPath: string;
  attestation: ReviewClosureAttestation;
} {
  const { projectRoot, feature } = opts;
  const contractsRes = resolveFeatureArtifact(projectRoot, feature, 'contracts.yaml');
  const contractsSha = contractsRes.exists ? sha256File(contractsRes.actualPath) : null;
  const contractsFiles = contractsRes.exists
    ? parseContractsFiles(fs.readFileSync(contractsRes.actualPath, 'utf-8'))
    : [];
  const reviewReport = resolveFeatureArtifact(projectRoot, feature, 'review-report.md');
  const verifierReport = path.join(receiptDirPath(projectRoot, feature, 'review'), 'reports', 'verifier.report.md');

  const attestation: ReviewClosureAttestation = {
    schema_version: CLOSURE_ATTESTATION_SCHEMA_VERSION,
    feature,
    generated_at: (opts.now ? opts.now() : new Date()).toISOString(),
    contracts_sha256: contractsSha,
    contracts_files: contractsFiles,
    inventory: buildSourceInventory(projectRoot, { expectProductSources: opts.expectProductSources }),
    review_report_sha256: reviewReport.exists ? sha256File(reviewReport.actualPath) : null,
    verifier_report_sha256: sha256File(verifierReport),
    gate_fingerprint: opts.gateFingerprint ?? null,
    run_identity: opts.runIdentity ?? null,
  };

  const absPath = reviewClosureAttestationPath(projectRoot, feature);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(attestation, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, absPath);
  return { absPath, attestation };
}

export function loadReviewClosureAttestation(
  projectRoot: string,
  feature: string,
): ReviewClosureAttestation | null {
  const absPath = reviewClosureAttestationPath(projectRoot, feature);
  if (!fs.existsSync(absPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(absPath, 'utf-8')) as ReviewClosureAttestation;
    if (parsed.schema_version !== CLOSURE_ATTESTATION_SCHEMA_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface SourceReconcileResult {
  ok: boolean;
  added: string[];
  modified: string[];
  deleted: string[];
  /** review 后新出现的产品源码根（codex 五轮 P0：新增整模块必须可见） */
  new_roots: string[];
}

/**
 * testing 对账：基线=attestation **固化**的 inventory（不看当前 contracts.yaml——防
 * "改完声明再对账"）；但走树范围=冻结 roots ∪ **当前重新 discovery 的 roots**——
 * codex 五轮 P0 实证：只走冻结 roots 时，review 后新增 newmod/src/main（含
 * DEVICE_TEST_FAST_PATH=true）完全不可见。新 root 下的所有文件计为 added。
 */
export function reconcileSourceTreeAgainstAttestation(
  projectRoot: string,
  attestation: ReviewClosureAttestation,
): SourceReconcileResult {
  const frozen = new Map(attestation.inventory.files.map((f) => [f.path, f.sha256]));
  const frozenRoots = new Set(attestation.inventory.roots);
  const currentRoots = discoverProductSourceRoots(projectRoot).roots;
  const newRoots = currentRoots.filter((r) => !frozenRoots.has(r)).sort();
  const unionRoots = [...new Set([...attestation.inventory.roots, ...currentRoots])].sort();

  const current = new Map<string, string>();
  for (const root of unionRoots) {
    for (const rel of collectProductSourceFiles(projectRoot, root)) {
      const hash = sha256File(path.join(projectRoot, rel));
      if (hash) current.set(rel, hash);
    }
  }
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  for (const [p, h] of current) {
    const was = frozen.get(p);
    if (was === undefined) added.push(p);
    else if (was !== h) modified.push(p);
  }
  for (const p of frozen.keys()) {
    if (!current.has(p)) deleted.push(p);
  }
  added.sort(); modified.sort(); deleted.sort();
  return {
    ok: added.length === 0 && modified.length === 0 && deleted.length === 0 && newRoots.length === 0,
    added, modified, deleted, new_roots: newRoots,
  };
}
