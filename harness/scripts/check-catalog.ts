// ============================================================================
// Catalog 阶段脚本 Harness — check-catalog.ts
// ============================================================================
// 读取 doc/module-catalog.yaml + framework/specs/phase-rules/catalog-rules.yaml，
// 执行确定性的结构 / 交叉引用检查。
//
// 检查项（与 catalog-rules.yaml 对应）：
//   Structure:     schema_version_present, modules_is_list, module_required_fields,
//                  layer_value_valid, format_value_valid, name_unique,
//                  not_responsible_for_min_count, one_liner_not_empty,
//                  typical_vs_not_responsible_conflict
//   Traceability:  easily_confused_references_exist, easily_confused_no_self_reference,
//                  easily_confused_symmetric, entry_file_on_disk, layer_matches_path,
//                  key_exports_fresh_vs_index
//
// 语义级检查此阶段暂不启用（catalog 本身就是 SSOT，没有语义歧义）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import {
  PhaseChecker,
  CheckContext,
  CheckResult,
} from './utils/types';
import {
  loadCatalog,
  describeCatalogError,
  ModuleCard,
  ModuleCatalog,
} from './utils/catalog-parser';
import { parseScope } from './utils/scope-parser';
import {
  loadArchitectureDsl,
  getOuterLayerIds,
  featuresDirPath,
  relFeaturesDir,
  relCatalog,
} from '../config';

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * 合法 layer 值列表来自 framework.config.json 的 architecture.outer_layers[].id。
 * 原本硬编码 5 层（01-Product … 05-SystemBase）已迁到实例工程的 DSL 声明；
 * framework 这里只根据 DSL 构造候选集，不再写死层名。
 */
function getAllowedLayers(projectRoot: string): string[] {
  return getOuterLayerIds(loadArchitectureDsl(projectRoot));
}

// AtomicService 为元服务扩展位（阶段 7 预留）：值合法、不触发任何差异化检查。
// 差异化规则（首包大小、分包策略、免安装入口等）推进路线见
// framework/docs/atomic-service-roadmap.md。
const ALLOWED_FORMATS = ['HAP', 'HAR', 'AtomicService'];

const REQUIRED_MODULE_FIELDS: Array<keyof ModuleCard> = [
  'name',
  'layer',
  'format',
  'one_liner',
  'responsibilities',
  'NOT_responsible_for',
  'typical_business_terms',
  'easily_confused_with',
  'key_exports',
  'entry_file',
];

const FORBIDDEN_ONE_LINER_SUFFIX = ['模块', '功能模块'];

function ruleDesc(
  ctx: CheckContext,
  section: 'structure_checks' | 'semantic_checks' | 'traceability_checks',
  id: string,
): string {
  const checks = ctx.phaseRule[section] as Record<string, { description?: string }>;
  return checks?.[id]?.description?.trim() ?? id;
}

// --------------------------------------------------------------------------
// Structure Checks
// --------------------------------------------------------------------------

function checkSchemaVersionPresent(ctx: CheckContext, catalog: ModuleCatalog): CheckResult[] {
  const ok = typeof catalog.schema_version === 'string' && catalog.schema_version.length > 0;
  if (ok) {
    return [{
      id: 'schema_version_present', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'schema_version_present'),
      severity: 'BLOCKER', status: 'PASS',
      details: `schema_version = "${catalog.schema_version}"`,
    }];
  }
  return [{
    id: 'schema_version_present', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'schema_version_present'),
    severity: 'BLOCKER', status: 'FAIL',
    details: '根对象缺少 schema_version 字符串字段。',
    suggestion: `在 ${relCatalog(ctx.projectRoot)} 顶部添加 \`schema_version: "1.0"\``,
    affected_files: [relCatalog(ctx.projectRoot)],
  }];
}

function checkModulesIsList(ctx: CheckContext, catalog: ModuleCatalog): CheckResult[] {
  // 空列表是合法的 bootstrap 中间状态（Skill 0 Phase A 刚建骨架、还没追加任何模块）
  // 所以只给 WARN 级别提示，不 BLOCKER 阻塞后续 check
  if (catalog.modules.length === 0) {
    return [{
      id: 'modules_is_list', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'modules_is_list'),
      severity: 'MAJOR', status: 'WARN',
      details: 'modules 数组为空——catalog 骨架已建好，但尚未追加任何模块卡片。',
      suggestion: '运行 `/catalog-bootstrap <ModuleName>` 逐个追加模块；全部模块建完前该 WARN 会一直在，属正常。',
      affected_files: [relCatalog(ctx.projectRoot)],
    }];
  }
  return [{
    id: 'modules_is_list', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'modules_is_list'),
    severity: 'BLOCKER', status: 'PASS',
    details: `modules 数组包含 ${catalog.modules.length} 个条目。`,
  }];
}

function checkModuleRequiredFields(ctx: CheckContext, catalog: ModuleCatalog): CheckResult[] {
  const missing: string[] = [];
  for (const m of catalog.modules) {
    for (const field of REQUIRED_MODULE_FIELDS) {
      const value = (m as unknown as Record<string, unknown>)[field];
      const isEmpty =
        value === undefined ||
        value === null ||
        (typeof value === 'string' && value.trim() === '') ||
        (Array.isArray(value) && field !== 'easily_confused_with' && field !== 'key_exports' && field !== 'typical_business_terms' && field !== 'NOT_responsible_for' && value.length === 0);
      if (isEmpty) {
        missing.push(`${m.name || '(unnamed)'}.${String(field)}`);
      }
    }
  }

  if (missing.length === 0) {
    return [{
      id: 'module_required_fields', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'module_required_fields'),
      severity: 'BLOCKER', status: 'PASS',
      details: `全部 ${catalog.modules.length} 个模块必填字段均存在。`,
    }];
  }

  return [{
    id: 'module_required_fields', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'module_required_fields'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `缺失必填字段 ${missing.length} 处：${missing.slice(0, 10).join('、')}${missing.length > 10 ? ' …' : ''}`,
    suggestion: '对照模板 framework/skills/0-catalog-bootstrap/templates/module-card-template.yaml 补齐字段。',
    affected_files: [relCatalog(ctx.projectRoot)],
  }];
}

function checkLayerValueValid(ctx: CheckContext, catalog: ModuleCatalog): CheckResult[] {
  const allowed = getAllowedLayers(ctx.projectRoot);
  const invalid = catalog.modules
    .filter(m => !allowed.includes(m.layer))
    .map(m => `${m.name}:"${m.layer}"`);

  if (invalid.length === 0) {
    return [{
      id: 'layer_value_valid', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'layer_value_valid'),
      severity: 'BLOCKER', status: 'PASS',
      details: `全部模块 layer 值合法。`,
    }];
  }
  return [{
    id: 'layer_value_valid', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'layer_value_valid'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `非法 layer 值 ${invalid.length} 处：${invalid.join('、')}`,
    suggestion: `layer 必须是以下之一（来自 framework.config.json 的 outer_layers 声明）：${allowed.join(' / ')}`,
    affected_files: [relCatalog(ctx.projectRoot)],
  }];
}

function checkFormatValueValid(ctx: CheckContext, catalog: ModuleCatalog): CheckResult[] {
  const invalid = catalog.modules
    .filter(m => !m.format || !ALLOWED_FORMATS.includes(m.format))
    .map(m => `${m.name}:"${m.format ?? '(missing)'}"`);

  if (invalid.length === 0) {
    return [{
      id: 'format_value_valid', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'format_value_valid'),
      severity: 'BLOCKER', status: 'PASS',
      details: `全部模块 format 值合法。`,
    }];
  }
  return [{
    id: 'format_value_valid', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'format_value_valid'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `非法 format 值 ${invalid.length} 处：${invalid.join('、')}`,
    suggestion: `format 必须是 ${ALLOWED_FORMATS.join(' / ')} 之一。`,
    affected_files: [relCatalog(ctx.projectRoot)],
  }];
}

function checkNameUnique(ctx: CheckContext, catalog: ModuleCatalog): CheckResult[] {
  const seen = new Map<string, number>();
  for (const m of catalog.modules) {
    seen.set(m.name, (seen.get(m.name) ?? 0) + 1);
  }
  const dupes = Array.from(seen.entries()).filter(([, count]) => count > 1).map(([name]) => name);

  if (dupes.length === 0) {
    return [{
      id: 'name_unique', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'name_unique'),
      severity: 'BLOCKER', status: 'PASS',
      details: `全部 ${catalog.modules.length} 个模块 name 唯一。`,
    }];
  }
  return [{
    id: 'name_unique', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'name_unique'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `重复的 name：${dupes.join('、')}`,
    suggestion: '每个模块 name 必须全局唯一；合并/删除重复条目。',
    affected_files: [relCatalog(ctx.projectRoot)],
  }];
}

function checkNotResponsibleForMinCount(ctx: CheckContext, catalog: ModuleCatalog): CheckResult[] {
  const offenders = catalog.modules
    .filter(m => m.NOT_responsible_for.length < 1)
    .map(m => m.name);

  if (offenders.length === 0) {
    return [{
      id: 'not_responsible_for_min_count', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'not_responsible_for_min_count'),
      severity: 'MAJOR', status: 'PASS',
      details: `全部模块 NOT_responsible_for 至少 1 条。`,
    }];
  }
  return [{
    id: 'not_responsible_for_min_count', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'not_responsible_for_min_count'),
    severity: 'MAJOR', status: 'FAIL',
    details: `${offenders.length} 个模块 NOT_responsible_for 为空：${offenders.join('、')}`,
    suggestion: '对照兄弟模块 / easily_confused_with 补充反模式；实在没有反例也请显式写一条占位说明。',
    affected_files: [relCatalog(ctx.projectRoot)],
  }];
}

function checkOneLinerNotEmpty(ctx: CheckContext, catalog: ModuleCatalog): CheckResult[] {
  const empty: string[] = [];
  const suffixHit: string[] = [];
  for (const m of catalog.modules) {
    const v = (m.one_liner ?? '').trim();
    if (!v) {
      empty.push(m.name);
      continue;
    }
    for (const suf of FORBIDDEN_ONE_LINER_SUFFIX) {
      if (v.endsWith(suf)) {
        suffixHit.push(`${m.name}:"${v}"`);
        break;
      }
    }
  }

  if (empty.length === 0 && suffixHit.length === 0) {
    return [{
      id: 'one_liner_not_empty', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'one_liner_not_empty'),
      severity: 'MAJOR', status: 'PASS',
      details: `全部模块 one_liner 非空且非空话。`,
    }];
  }

  const details: string[] = [];
  if (empty.length) details.push(`空值：${empty.join('、')}`);
  if (suffixHit.length) details.push(`空话后缀：${suffixHit.join('、')}`);

  return [{
    id: 'one_liner_not_empty', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'one_liner_not_empty'),
    severity: 'MAJOR', status: 'FAIL',
    details: details.join('；'),
    suggestion: '把 "xxx 模块" 这类空话改成真正描述"对外价值"的一句话。',
    affected_files: [relCatalog(ctx.projectRoot)],
  }];
}

/**
 * 归一化用于比较：去空格、全角空格、常见口语标点，保留词本身字符。
 * 保留"等"字（因为要识别"<term>等业务"这类枚举结尾模式）。
 */
function normalizeForConflictScan(s: string): string {
  return s.replace(/[\u3000\s]/g, '').toLowerCase();
}

/**
 * 判定某 NOT_responsible_for 条目是否显式把 term 列为"被排除"。
 *
 * 思路：只有当 term 作为"列表项"或"带等字的枚举项"出现时才算真阳性。
 * 单纯子串命中（如 term="账号" 出现在"华为账号登录态"这种**积极场景描述**中）
 * 视为假阳性，不报。
 *
 * 具体算法：
 *  1. 把圆括号内容 (...) / （...）剥掉——那是补充说明，不做精确判定
 *  2. 按中文枚举分隔符（/ 、 , ，）切成 items
 *  3. 每个 item trim 后，跟 term 做精确匹配：
 *     a) item === term
 *     b) item === term + "等"
 *     c) item 以 term + "等" 开头（如"XX 账户等业务数据"）
 */
function nrfExplicitlyExcludesTerm(nrfText: string, term: string): boolean {
  const stripped = nrfText
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .trim();

  const items = stripped
    .split(/[/、,，]/)
    .map(s => s.trim())
    .filter(Boolean);

  const termN = normalizeForConflictScan(term);
  if (!termN) return false;

  for (const raw of items) {
    const itemN = normalizeForConflictScan(raw);
    if (itemN === termN) return true;
    if (itemN === termN + '等') return true;
    if (itemN.startsWith(termN + '等')) return true;
  }
  return false;
}

function checkTypicalVsNotResponsibleConflict(
  ctx: CheckContext,
  catalog: ModuleCatalog,
): CheckResult[] {
  const offenders: Array<{ module: string; term: string; nrf_original: string }> = [];

  for (const m of catalog.modules) {
    const nrfList = m.NOT_responsible_for || [];
    const termList = m.typical_business_terms || [];

    for (const term of termList) {
      if (!term.trim()) continue;

      for (const nrf of nrfList) {
        if (nrfExplicitlyExcludesTerm(nrf, term)) {
          offenders.push({
            module: m.name,
            term,
            nrf_original: nrf.length > 60 ? nrf.slice(0, 60) + '…' : nrf,
          });
          break;
        }
      }
    }
  }

  if (offenders.length === 0) {
    return [{
      id: 'typical_vs_not_responsible_conflict', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'typical_vs_not_responsible_conflict'),
      severity: 'MAJOR', status: 'PASS',
      details: '全部模块的 typical_business_terms 与 NOT_responsible_for 无字面冲突。',
    }];
  }

  const preview = offenders.slice(0, 5).map(o =>
    `${o.module}: "${o.term}" ∈ NOT_responsible_for "${o.nrf_original}"`,
  );

  return [{
    id: 'typical_vs_not_responsible_conflict', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'typical_vs_not_responsible_conflict'),
    severity: 'MAJOR', status: 'WARN',
    details: `${offenders.length} 处自相矛盾（前 ${preview.length} 例）：${preview.join('； ')}`,
    suggestion:
      '修复二选一：\n' +
      '  (a) 若该词确不属于本模块 → 从 typical_business_terms 剔除\n' +
      '  (b) 若语义分歧（同词多义） → 在 NOT_responsible_for 文本里加消歧规则：\n' +
      '      "X 指 A 时属本模块；指 B 时不属"，把分界写清楚',
    affected_files: [relCatalog(ctx.projectRoot)],
  }];
}

// --------------------------------------------------------------------------
// Traceability Checks
// --------------------------------------------------------------------------

function checkEasilyConfusedReferencesExist(ctx: CheckContext, catalog: ModuleCatalog): CheckResult[] {
  const known = new Set(catalog.modules.map(m => m.name));
  const broken: string[] = [];

  for (const m of catalog.modules) {
    for (const ec of m.easily_confused_with) {
      const target = (ec.module ?? '').trim();
      if (!target) continue;
      if (!known.has(target)) {
        broken.push(`${m.name} → "${target}"`);
      }
    }
  }

  if (broken.length === 0) {
    return [{
      id: 'easily_confused_references_exist', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'easily_confused_references_exist'),
      severity: 'BLOCKER', status: 'PASS',
      details: `全部 easily_confused_with 引用均指向已注册模块。`,
    }];
  }
  return [{
    id: 'easily_confused_references_exist', category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'easily_confused_references_exist'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `${broken.length} 条 easily_confused_with 指向不存在的模块：${broken.join('、')}`,
    suggestion: '修正拼写；若引用模块确实尚未建档，请先 /catalog-bootstrap 该模块再回来加易混项。',
    affected_files: [relCatalog(ctx.projectRoot)],
  }];
}

function checkEasilyConfusedNoSelfReference(
  ctx: CheckContext,
  catalog: ModuleCatalog,
): CheckResult[] {
  const offenders: string[] = [];

  for (const m of catalog.modules) {
    for (const ec of m.easily_confused_with || []) {
      const target = (ec.module ?? '').trim();
      if (!target) {
        offenders.push(`${m.name}.easily_confused_with[].module 为空`);
        continue;
      }
      if (target === m.name) {
        offenders.push(`${m.name} → 自己`);
      }
    }
  }

  if (offenders.length === 0) {
    return [{
      id: 'easily_confused_no_self_reference', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'easily_confused_no_self_reference'),
      severity: 'BLOCKER', status: 'PASS',
      details: '无自引用、无空 module。',
    }];
  }
  return [{
    id: 'easily_confused_no_self_reference', category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'easily_confused_no_self_reference'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `${offenders.length} 处非法引用：${offenders.join('；')}`,
    suggestion: '删除自引用条目；空 module 字段补齐或整条删除。',
    affected_files: [relCatalog(ctx.projectRoot)],
  }];
}

function checkEasilyConfusedSymmetric(
  ctx: CheckContext,
  catalog: ModuleCatalog,
): CheckResult[] {
  const byName = new Map<string, ModuleCard>(catalog.modules.map(m => [m.name, m]));
  const unidirectionalMarker = 'unidirectional';
  const asymmetric: string[] = [];

  for (const m of catalog.modules) {
    for (const ec of m.easily_confused_with || []) {
      const target = (ec.module ?? '').trim();
      if (!target || target === m.name) continue;
      const targetModule = byName.get(target);
      if (!targetModule) continue;

      const reverse = (targetModule.easily_confused_with || []).find(e => (e.module ?? '').trim() === m.name);
      if (reverse) continue;

      const exempt = typeof ec.disambiguation === 'string' &&
        ec.disambiguation.toLowerCase().includes(unidirectionalMarker);
      if (exempt) continue;

      asymmetric.push(`${m.name} → ${target}（${target} 未反向声明与 ${m.name} 混淆）`);
    }
  }

  if (asymmetric.length === 0) {
    return [{
      id: 'easily_confused_symmetric', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'easily_confused_symmetric'),
      severity: 'MAJOR', status: 'PASS',
      details: '全部 easily_confused_with 关系对称。',
    }];
  }
  return [{
    id: 'easily_confused_symmetric', category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'easily_confused_symmetric'),
    severity: 'MAJOR', status: 'WARN',
    details: `${asymmetric.length} 处不对称：${asymmetric.join('；')}`,
    suggestion:
      '修复二选一：\n' +
      '  (a) 在反向模块的 easily_confused_with 里补一条对应条目（推荐，消歧能力双向完整）\n' +
      '  (b) 若确属单向易混，在正向的 disambiguation 文本里加关键字 "unidirectional" 显式豁免',
    affected_files: [relCatalog(ctx.projectRoot)],
  }];
}

function checkEntryFileOnDisk(ctx: CheckContext, catalog: ModuleCatalog): CheckResult[] {
  const missing: string[] = [];

  for (const m of catalog.modules) {
    if (!m.entry_file) continue;
    const full = path.join(ctx.projectRoot, m.entry_file);
    if (!fs.existsSync(full)) {
      missing.push(`${m.name} → ${m.entry_file}`);
    }
  }

  if (missing.length === 0) {
    return [{
      id: 'entry_file_on_disk', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'entry_file_on_disk'),
      severity: 'MAJOR', status: 'PASS',
      details: `全部 entry_file 路径在磁盘上真实存在。`,
    }];
  }
  return [{
    id: 'entry_file_on_disk', category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'entry_file_on_disk'),
    severity: 'MAJOR', status: 'WARN',
    details: `${missing.length} 个 entry_file 在磁盘上未找到：${missing.join('、')}`,
    suggestion: '确认路径拼写；或若该模块仍在规划中，可暂时保留（但需在后续真实创建前留意）。',
    affected_files: [relCatalog(ctx.projectRoot), ...missing.map(s => s.split(' → ')[1])],
  }];
}

function checkLayerMatchesPath(ctx: CheckContext, catalog: ModuleCatalog): CheckResult[] {
  const allowed = getAllowedLayers(ctx.projectRoot);
  const mismatches: string[] = [];
  for (const m of catalog.modules) {
    if (!m.entry_file) continue;
    const norm = m.entry_file.replace(/\\/g, '/');
    const firstSeg = norm.split('/')[0];
    if (allowed.includes(firstSeg) && firstSeg !== m.layer) {
      mismatches.push(`${m.name} (layer=${m.layer}, path 前缀=${firstSeg})`);
    }
  }

  if (mismatches.length === 0) {
    return [{
      id: 'layer_matches_path', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'layer_matches_path'),
      severity: 'MAJOR', status: 'PASS',
      details: `全部 entry_file 路径前缀与 layer 一致。`,
    }];
  }
  return [{
    id: 'layer_matches_path', category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'layer_matches_path'),
    severity: 'MAJOR', status: 'FAIL',
    details: `${mismatches.length} 个模块 layer 与 entry_file 路径前缀不一致：${mismatches.join('、')}`,
    suggestion: '核对该模块实际所处的目录层级，保证 layer 与物理路径一致。',
    affected_files: [relCatalog(ctx.projectRoot)],
  }];
}

/**
 * 从 HAR 模块 entry_file（导出入口，如 index.ets）源码里抽取 top-level export 符号集合。
 *
 * 覆盖两种声明形态：
 *   A) `export class/function/const/let/var/interface/type/enum <Name>`
 *      （含 `export default class <Name>`）
 *   B) `export { A, B as C, D } from '...'` / `export { A, B as C };`
 *      `as` 别名时取别名那一侧（对外暴露的实际名字）。
 *
 * 忽略：
 *   - `export * from 'xxx'`：通配再导出，想拿到具体名字需递归读文件，
 *     成本高且信号弱，本 check 不处理。若某模块导出入口主要靠通配再导出，
 *     key_exports 自然会全部 stale_added，用户看到 WARN 可自行决定是否手填。
 */
function extractTopLevelExports(source: string): Set<string> {
  const out = new Set<string>();

  const declRegex = /^[\t ]*export[\t ]+(?:default[\t ]+)?(?:class|function|const|let|var|interface|type|enum)[\t ]+([A-Za-z_][A-Za-z0-9_]*)/gm;
  let m: RegExpExecArray | null;
  while ((m = declRegex.exec(source)) !== null) {
    out.add(m[1]);
  }

  const braceRegex = /^[\t ]*export[\t ]*\{([^}]+)\}/gm;
  while ((m = braceRegex.exec(source)) !== null) {
    const raw = m[1];
    for (const item of raw.split(',')) {
      const trimmed = item.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+as\s+/);
      const exposedName = parts[parts.length - 1].trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(exposedName)) {
        out.add(exposedName);
      }
    }
  }

  return out;
}

function checkKeyExportsFreshVsIndex(
  ctx: CheckContext,
  catalog: ModuleCatalog,
): CheckResult[] {
  const MAX_CAP = 10;
  const stale: string[] = [];
  const affected = new Set<string>([relCatalog(ctx.projectRoot)]);

  for (const m of catalog.modules) {
    if (m.format !== 'HAR') continue;
    if (!m.entry_file) continue;

    const entryPath = path.join(ctx.projectRoot, m.entry_file);
    if (!fs.existsSync(entryPath)) continue;

    const source = fs.readFileSync(entryPath, 'utf-8');
    const actual = extractTopLevelExports(source);
    const documented = new Set(m.key_exports || []);

    const removed: string[] = [];
    for (const name of documented) {
      if (!actual.has(name)) removed.push(name);
    }

    let added: string[] = [];
    if (documented.size < MAX_CAP) {
      for (const name of actual) {
        if (!documented.has(name)) added.push(name);
      }
    }

    if (removed.length === 0 && added.length === 0) continue;

    affected.add(m.entry_file);

    const parts: string[] = [];
    if (removed.length > 0) {
      parts.push(`已记录但导出入口中找不到：[${removed.join(', ')}]`);
    }
    if (added.length > 0) {
      const preview = added.slice(0, 5).join(', ');
      const more = added.length > 5 ? ` …共 ${added.length} 个` : '';
      parts.push(`导出入口新增但未记录：[${preview}${more}]（当前 key_exports ${documented.size} 条，未达 ${MAX_CAP} 条上限）`);
    }
    stale.push(`${m.name}：${parts.join('；')}`);
  }

  if (stale.length === 0) {
    return [{
      id: 'key_exports_fresh_vs_index', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'key_exports_fresh_vs_index'),
      severity: 'MAJOR', status: 'PASS',
      details: '所有 HAR 模块的 key_exports 与导出入口声明的 top-level export 一致。',
    }];
  }

  return [{
    id: 'key_exports_fresh_vs_index', category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'key_exports_fresh_vs_index'),
    severity: 'MAJOR', status: 'WARN',
    details: `${stale.length} 个模块的 key_exports 与导出入口漂移：\n  - ${stale.join('\n  - ')}`,
    suggestion:
      '对每个漂移模块 <M> 跑 `/catalog-bootstrap <M>` 进入 UPDATE 模式刷新画像；\n' +
      'Skill 0 Step 5.1.B 会给出字段级 diff，确认后 `y` 替换旧画像。',
    affected_files: Array.from(affected),
  }];
}

// --------------------------------------------------------------------------
// C3: feature 反向扫描 — catalog 变更对已有 feature 的完整性影响
// --------------------------------------------------------------------------

function checkFeatureScopeIntegrity(
  ctx: CheckContext,
  catalog: ModuleCatalog,
): CheckResult[] {
  const featuresDir = featuresDirPath(ctx.projectRoot);
  const featuresRel = relFeaturesDir(ctx.projectRoot);
  if (!fs.existsSync(featuresDir)) {
    return [{
      id: 'feature_scope_integrity', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'feature_scope_integrity'),
      severity: 'MAJOR', status: 'SKIP',
      details: `${featuresRel} 目录不存在，本 check 跳过。`,
    }];
  }

  const known = new Set<string>(catalog.modules.map(m => m.name));
  const broken: Array<{ file: string; missing: string[]; in_or_out: string[] }> = [];
  const affected = new Set<string>([relCatalog(ctx.projectRoot)]);
  let scannedCount = 0;

  const dirents = fs.readdirSync(featuresDir, { withFileTypes: true });
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    for (const fileName of ['PRD.md', 'design.md']) {
      const fullPath = path.join(featuresDir, dirent.name, fileName);
      if (!fs.existsSync(fullPath)) continue;
      const content = fs.readFileSync(fullPath, 'utf-8');
      const { scope } = parseScope(content);
      if (!scope) continue;
      scannedCount++;

      const inMissing = scope.in_scope_modules.filter(m => !known.has(m));
      const outMissing = scope.out_of_scope_modules.filter(m => !known.has(m));
      const allMissing = [...inMissing, ...outMissing];
      if (allMissing.length === 0) continue;

      const where: string[] = [];
      if (inMissing.length > 0) where.push(`in_scope_modules:[${inMissing.join(', ')}]`);
      if (outMissing.length > 0) where.push(`out_of_scope_modules:[${outMissing.join(', ')}]`);

      const rel = `${featuresRel}/${dirent.name}/${fileName}`;
      broken.push({ file: rel, missing: allMissing, in_or_out: where });
      affected.add(rel);
    }
  }

  if (scannedCount === 0) {
    return [{
      id: 'feature_scope_integrity', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'feature_scope_integrity'),
      severity: 'MAJOR', status: 'SKIP',
      details: `${featuresRel}/*/PRD.md 与 design.md 中均未检测到 Scope 声明，本 check 跳过。`,
    }];
  }

  if (broken.length === 0) {
    return [{
      id: 'feature_scope_integrity', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'feature_scope_integrity'),
      severity: 'MAJOR', status: 'PASS',
      details: `扫描了 ${scannedCount} 份 feature 文档，全部 Scope 引用均已在 catalog 建档。`,
    }];
  }

  const lines = broken.map(b => `${b.file}：${b.in_or_out.join('；')}`);

  return [{
    id: 'feature_scope_integrity', category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'feature_scope_integrity'),
    severity: 'MAJOR', status: 'WARN',
    details:
      `${broken.length} 份 feature 文档引用了 catalog 未建档的模块` +
      `（已扫描 ${scannedCount} 份含 Scope 声明的文档）：\n  - ` +
      lines.join('\n  - '),
    suggestion:
      '每条漂移可任选 3 种修法之一：\n' +
      '  (1) 补档：对缺失模块跑 `/catalog-bootstrap <M>` 进入 CREATE 模式建档；\n' +
      '  (2) 修 feature：改对应 PRD.md / design.md 的 scope，删除或改名过期模块；\n' +
      '  (3) 改名追溯：若本次 catalog 是把旧模块改了名，请在新模块 profile 里\n' +
      '     添加 `merged_from: <旧名>` 备注，方便后续回查。\n' +
      '不处理的话 → 对该 feature 跑 `--phase prd/design` 会 BLOCKER on scope_matches_catalog。',
    affected_files: Array.from(affected),
  }];
}

// --------------------------------------------------------------------------
// Main Checker
// --------------------------------------------------------------------------

function safeRun(fn: () => CheckResult[], checkId: string): CheckResult[] {
  try {
    return fn();
  } catch (err) {
    return [{
      id: checkId, category: 'structure',
      description: `${checkId} 执行异常`,
      severity: 'MINOR', status: 'SKIP',
      details: `检查执行时发生错误：${(err as Error).message}`,
    }];
  }
}

const checker: PhaseChecker = {
  phase: 'catalog',

  async check(ctx: CheckContext): Promise<CheckResult[]> {
    const result = loadCatalog(ctx.projectRoot);
    if (!result.ok) {
      const catalogRel = relCatalog(ctx.projectRoot);
      return [{
        id: 'catalog_file_exists', category: 'structure',
        description: `${catalogRel} 加载失败`,
        severity: 'BLOCKER', status: 'FAIL',
        details: describeCatalogError(result.error),
        affected_files: [catalogRel],
        suggestion: `先创建 ${catalogRel}，最简形态：\n\`\`\`yaml\nschema_version: "1.0"\nmodules: []\n\`\`\``,
      }];
    }

    const catalog = result.catalog;
    const results: CheckResult[] = [];

    // Structure
    results.push(...safeRun(() => checkSchemaVersionPresent(ctx, catalog), 'schema_version_present'));
    results.push(...safeRun(() => checkModulesIsList(ctx, catalog), 'modules_is_list'));
    results.push(...safeRun(() => checkModuleRequiredFields(ctx, catalog), 'module_required_fields'));
    results.push(...safeRun(() => checkLayerValueValid(ctx, catalog), 'layer_value_valid'));
    results.push(...safeRun(() => checkFormatValueValid(ctx, catalog), 'format_value_valid'));
    results.push(...safeRun(() => checkNameUnique(ctx, catalog), 'name_unique'));
    results.push(...safeRun(() => checkNotResponsibleForMinCount(ctx, catalog), 'not_responsible_for_min_count'));
    results.push(...safeRun(() => checkOneLinerNotEmpty(ctx, catalog), 'one_liner_not_empty'));
    results.push(...safeRun(
      () => checkTypicalVsNotResponsibleConflict(ctx, catalog),
      'typical_vs_not_responsible_conflict',
    ));

    // Traceability
    results.push(...safeRun(() => checkEasilyConfusedReferencesExist(ctx, catalog), 'easily_confused_references_exist'));
    results.push(...safeRun(() => checkEasilyConfusedNoSelfReference(ctx, catalog), 'easily_confused_no_self_reference'));
    results.push(...safeRun(() => checkEasilyConfusedSymmetric(ctx, catalog), 'easily_confused_symmetric'));
    results.push(...safeRun(() => checkEntryFileOnDisk(ctx, catalog), 'entry_file_on_disk'));
    results.push(...safeRun(() => checkLayerMatchesPath(ctx, catalog), 'layer_matches_path'));
    results.push(...safeRun(() => checkKeyExportsFreshVsIndex(ctx, catalog), 'key_exports_fresh_vs_index'));
    results.push(...safeRun(() => checkFeatureScopeIntegrity(ctx, catalog), 'feature_scope_integrity'));

    return results;
  },
};

export default checker;
