// ============================================================================
// Glossary 阶段脚本 Harness — check-glossary.ts
// ============================================================================
// 读取 doc/glossary.yaml + doc/module-catalog.yaml，交叉校验术语表。
//
// 检查项（与 glossary-rules.yaml 对应）：
//   Structure:     schema_version_present, terms_is_list, term_required_fields,
//                  term_unique, alias_unique_across_terms, owner_layer_value_valid,
//                  seed_no_technical_words
//   Traceability:  canonical_module_exists_in_catalog, owner_layer_matches_catalog,
//                  easily_confused_modules_exist_in_catalog,
//                  term_covered_by_catalog_typical_terms
// ============================================================================

import * as fs from 'fs';

import {
  PhaseChecker,
  CheckContext,
  CheckResult,
} from './utils/types';
import {
  loadGlossary,
  describeGlossaryError,
  Glossary,
  GlossaryTerm,
} from './utils/glossary-parser';
import {
  loadCatalog,
  describeCatalogError,
  ModuleCatalog,
  findModule,
} from './utils/catalog-parser';
import {
  loadArchitectureDsl,
  getOuterLayerIds,
  glossarySeedPath,
  relGlossary,
  relGlossarySeed,
  relCatalog,
} from '../config';

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * 合法 owner_layer 候选集来自 framework.config.json 的 architecture.outer_layers[].id。
 * 原本硬编码 5 层已迁到 DSL，framework 不再认识具体层名。
 */
function getAllowedLayers(projectRoot: string): string[] {
  return getOuterLayerIds(loadArchitectureDsl(projectRoot));
}

const REQUIRED_TERM_FIELDS: Array<keyof GlossaryTerm> = [
  'term',
  'canonical_module',
  'owner_layer',
  'aliases',
  'easily_confused_with',
];

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

function checkSchemaVersionPresent(ctx: CheckContext, glossary: Glossary): CheckResult[] {
  const ok = typeof glossary.schema_version === 'string' && glossary.schema_version.length > 0;
  if (ok) {
    return [{
      id: 'schema_version_present', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'schema_version_present'),
      severity: 'BLOCKER', status: 'PASS',
      details: `schema_version = "${glossary.schema_version}"`,
    }];
  }
  return [{
    id: 'schema_version_present', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'schema_version_present'),
    severity: 'BLOCKER', status: 'FAIL',
    details: '根对象缺少 schema_version 字符串字段。',
    suggestion: `在 ${relGlossary(ctx.projectRoot)} 顶部添加 \`schema_version: "1.0"\``,
    affected_files: [relGlossary(ctx.projectRoot)],
  }];
}

function checkTermsIsList(ctx: CheckContext, glossary: Glossary): CheckResult[] {
  // 空列表是合法的 bootstrap 中间状态（Skill 0 Phase B 刚建骨架、还没追加术语）
  // 只给 WARN，不 BLOCKER
  if (glossary.terms.length === 0) {
    return [{
      id: 'terms_is_list', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terms_is_list'),
      severity: 'MAJOR', status: 'WARN',
      details: 'terms 数组为空——glossary 骨架已建好，但尚未追加任何术语。',
      suggestion: '运行 `/glossary-bootstrap` 逐条追加；全部术语建完前该 WARN 属正常。',
      affected_files: [relGlossary(ctx.projectRoot)],
    }];
  }
  return [{
    id: 'terms_is_list', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'terms_is_list'),
    severity: 'BLOCKER', status: 'PASS',
    details: `terms 包含 ${glossary.terms.length} 条。`,
  }];
}

function checkTermRequiredFields(ctx: CheckContext, glossary: Glossary): CheckResult[] {
  const missing: string[] = [];
  for (const t of glossary.terms) {
    for (const field of REQUIRED_TERM_FIELDS) {
      const v = (t as unknown as Record<string, unknown>)[field];
      const isEmpty =
        v === undefined ||
        v === null ||
        (typeof v === 'string' && v.trim() === '');
      if (isEmpty) {
        missing.push(`${t.term || '(unnamed)'}.${String(field)}`);
      }
    }
  }

  if (missing.length === 0) {
    return [{
      id: 'term_required_fields', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'term_required_fields'),
      severity: 'BLOCKER', status: 'PASS',
      details: `全部 ${glossary.terms.length} 条术语必填字段完整。`,
    }];
  }
  return [{
    id: 'term_required_fields', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'term_required_fields'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `${missing.length} 处缺失：${missing.slice(0, 10).join('、')}${missing.length > 10 ? ' …' : ''}`,
    suggestion:
        `对照 framework/profiles/${ctx.resolvedProfile.name}/skills/0-catalog-bootstrap/templates/glossary-term-template.yaml 补齐。`,
    affected_files: [relGlossary(ctx.projectRoot)],
  }];
}

function checkTermUnique(ctx: CheckContext, glossary: Glossary): CheckResult[] {
  const seen = new Map<string, number>();
  for (const t of glossary.terms) {
    seen.set(t.term, (seen.get(t.term) ?? 0) + 1);
  }
  const dupes = Array.from(seen.entries()).filter(([, c]) => c > 1).map(([term]) => term);
  if (dupes.length === 0) {
    return [{
      id: 'term_unique', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'term_unique'),
      severity: 'BLOCKER', status: 'PASS',
      details: `全部 term 唯一。`,
    }];
  }
  return [{
    id: 'term_unique', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'term_unique'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `重复的 term：${dupes.join('、')}`,
    suggestion: '若确实是同义概念，合并为一条并把其余写入 aliases。',
    affected_files: [relGlossary(ctx.projectRoot)],
  }];
}

function checkAliasUniqueAcrossTerms(ctx: CheckContext, glossary: Glossary): CheckResult[] {
  const aliasToTerm = new Map<string, string[]>();
  for (const t of glossary.terms) {
    for (const a of t.aliases) {
      if (!aliasToTerm.has(a)) aliasToTerm.set(a, []);
      aliasToTerm.get(a)!.push(t.term);
    }
  }
  const shared = Array.from(aliasToTerm.entries()).filter(([, terms]) => terms.length > 1);

  if (shared.length === 0) {
    return [{
      id: 'alias_unique_across_terms', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'alias_unique_across_terms'),
      severity: 'BLOCKER', status: 'PASS',
      details: `alias 在全部 term 中互不重复。`,
    }];
  }
  return [{
    id: 'alias_unique_across_terms', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'alias_unique_across_terms'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `${shared.length} 个 alias 出现在多个 term 中：${shared.map(([a, ts]) => `"${a}" → {${ts.join(', ')}}`).join('；')}`,
    suggestion: '同一 alias 不能指向多个 term（否则 PRD 术语消歧会产生歧义）。',
    affected_files: [relGlossary(ctx.projectRoot)],
  }];
}

function checkOwnerLayerValueValid(ctx: CheckContext, glossary: Glossary): CheckResult[] {
  const allowed = getAllowedLayers(ctx.projectRoot);
  const invalid = glossary.terms
    .filter(t => !allowed.includes(t.owner_layer))
    .map(t => `${t.term}:"${t.owner_layer}"`);

  if (invalid.length === 0) {
    return [{
      id: 'owner_layer_value_valid', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'owner_layer_value_valid'),
      severity: 'BLOCKER', status: 'PASS',
      details: `全部 owner_layer 合法。`,
    }];
  }
  return [{
    id: 'owner_layer_value_valid', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'owner_layer_value_valid'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `非法 owner_layer ${invalid.length} 处：${invalid.join('、')}`,
    suggestion: `owner_layer 必须是（来自 framework.config.json 的 outer_layers 声明）：${allowed.join(' / ')}`,
    affected_files: [relGlossary(ctx.projectRoot)],
  }];
}

/**
 * Seed 文件解析：按行读取。
 * - # 开头整行 = 注释，丢弃
 * - 行内 # 后面视为尾注（典型于 allowlist: `SDK  # reason: xxx`），截断
 * - 余下 trim 后非空即为有效条目
 */
function readSeedLikeFile(fullPath: string): string[] {
  if (!fs.existsSync(fullPath)) return [];
  const raw = fs.readFileSync(fullPath, 'utf-8');
  return raw
    .split(/\r?\n/)
    .map(line => {
      const hashIdx = line.indexOf('#');
      const head = hashIdx >= 0 ? line.slice(0, hashIdx) : line;
      return head.trim();
    })
    .filter(line => line.length > 0);
}

const CAMEL_CASE_REGEX = /^[A-Z][a-zA-Z0-9]+$/;

function checkSeedNoTechnicalWords(
  ctx: CheckContext,
  catalog: ModuleCatalog,
): CheckResult[] {
  const seedPath = glossarySeedPath(ctx.projectRoot);
  // allowlist 与 seed 并存同目录；沿用同名前缀 -allowlist.txt。
  const allowlistPath = seedPath.replace(/\.txt$/, '-allowlist.txt');

  const seedRel = relGlossarySeed(ctx.projectRoot);
  const allowlistRel = seedRel.replace(/\.txt$/, '-allowlist.txt');

  if (!fs.existsSync(seedPath)) {
    return [{
      id: 'seed_no_technical_words', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'seed_no_technical_words'),
      severity: 'BLOCKER', status: 'SKIP',
      details: `${seedRel} 不存在——bootstrap 流程尚未开启或已收尾。`,
      suggestion: '若准备开启 /glossary-bootstrap，Skill 0 Phase B Step 1 会自动创建带注释的模板。',
    }];
  }

  const seedTerms = readSeedLikeFile(seedPath);
  if (seedTerms.length === 0) {
    return [{
      id: 'seed_no_technical_words', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'seed_no_technical_words'),
      severity: 'BLOCKER', status: 'SKIP',
      details: '种子清单为空（仅注释或纯空白）——未达检查触发条件。',
    }];
  }

  const allowlist = new Set(readSeedLikeFile(allowlistPath));
  const moduleNames = new Set(catalog.modules.map(m => m.name));

  const offenders: Array<{ term: string; reason: string }> = [];
  for (const term of seedTerms) {
    if (allowlist.has(term)) continue;

    if (CAMEL_CASE_REGEX.test(term)) {
      offenders.push({ term, reason: '疑似技术词（英文驼峰符号 / 类名模式）' });
      continue;
    }
    if (moduleNames.has(term)) {
      offenders.push({ term, reason: `与 catalog.modules[].name 重名（"${term}" 是技术模块名而非业务术语）` });
      continue;
    }
  }

  if (offenders.length === 0) {
    return [{
      id: 'seed_no_technical_words', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'seed_no_technical_words'),
      severity: 'BLOCKER', status: 'PASS',
      details: `种子清单 ${seedTerms.length} 行全部是业务自然语言词（或在 allowlist 中豁免）。`,
    }];
  }

  const preview = offenders.slice(0, 8).map(o => `"${o.term}"（${o.reason}）`);

  return [{
    id: 'seed_no_technical_words', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'seed_no_technical_words'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `${offenders.length} 行疑似技术词污染：${preview.join('；')}`,
    suggestion:
      '三选一修复：\n' +
      `  (a) 把该行从 ${seedRel} 删掉（如果确实是误填的技术符号）\n` +
      '  (b) 把它替换成业务自然语言描述（例如 "AccountManager" → "账号"）\n' +
      '  (c) 若确认要保留（如行业通用缩写 HAP / SDK / NFC），把该行追加到\n' +
      `      ${allowlistRel}（一行一个，# 开头为注释）`,
    affected_files: [seedRel, allowlistRel],
  }];
}

// --------------------------------------------------------------------------
// Traceability Checks（需要 catalog）
// --------------------------------------------------------------------------

function checkCanonicalModuleExistsInCatalog(
  ctx: CheckContext,
  glossary: Glossary,
  catalog: ModuleCatalog,
): CheckResult[] {
  const known = new Set(catalog.modules.map(m => m.name));
  const broken = glossary.terms
    .filter(t => !known.has(t.canonical_module))
    .map(t => `${t.term} → "${t.canonical_module}"`);

  if (broken.length === 0) {
    return [{
      id: 'canonical_module_exists_in_catalog', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'canonical_module_exists_in_catalog'),
      severity: 'BLOCKER', status: 'PASS',
      details: `全部 canonical_module 均在 catalog 中存在。`,
    }];
  }
  return [{
    id: 'canonical_module_exists_in_catalog', category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'canonical_module_exists_in_catalog'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `${broken.length} 条 term 指向不存在的 canonical_module：${broken.join('、')}`,
    suggestion: '修正拼写；或若引用模块确实未建档，先 /catalog-bootstrap 该模块再回来。',
    affected_files: [relGlossary(ctx.projectRoot), relCatalog(ctx.projectRoot)],
  }];
}

function checkOwnerLayerMatchesCatalog(
  ctx: CheckContext,
  glossary: Glossary,
  catalog: ModuleCatalog,
): CheckResult[] {
  const mismatches: string[] = [];
  for (const t of glossary.terms) {
    const m = findModule(catalog, t.canonical_module);
    if (!m) continue; // 已由上一个检查覆盖
    if (m.layer !== t.owner_layer) {
      mismatches.push(`${t.term} (owner_layer=${t.owner_layer}, catalog.layer=${m.layer})`);
    }
  }
  if (mismatches.length === 0) {
    return [{
      id: 'owner_layer_matches_catalog', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'owner_layer_matches_catalog'),
      severity: 'BLOCKER', status: 'PASS',
      details: `全部 owner_layer 与 catalog 中对应 module.layer 一致。`,
    }];
  }
  return [{
    id: 'owner_layer_matches_catalog', category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'owner_layer_matches_catalog'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `${mismatches.length} 条 owner_layer 与 catalog 不一致：${mismatches.join('、')}`,
    suggestion: '以 catalog 为准修正 owner_layer；若 catalog 的 layer 本身错了，则回到 /catalog-bootstrap 修正。',
    affected_files: [relGlossary(ctx.projectRoot)],
  }];
}

function checkEasilyConfusedModulesExistInCatalog(
  ctx: CheckContext,
  glossary: Glossary,
  catalog: ModuleCatalog,
): CheckResult[] {
  const known = new Set(catalog.modules.map(m => m.name));
  const broken: string[] = [];

  for (const t of glossary.terms) {
    for (const ec of t.easily_confused_with) {
      if (ec.module && !known.has(ec.module)) {
        broken.push(`${t.term}.easily_confused_with → "${ec.module}"`);
      }
    }
  }

  if (broken.length === 0) {
    return [{
      id: 'easily_confused_modules_exist_in_catalog', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'easily_confused_modules_exist_in_catalog'),
      severity: 'BLOCKER', status: 'PASS',
      details: `全部 easily_confused_with.module 均在 catalog 中存在。`,
    }];
  }
  return [{
    id: 'easily_confused_modules_exist_in_catalog', category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'easily_confused_modules_exist_in_catalog'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `${broken.length} 处 easily_confused_with 指向不存在的模块：${broken.join('、')}`,
    suggestion: '修正拼写；或先 /catalog-bootstrap 对应模块。',
    affected_files: [relGlossary(ctx.projectRoot)],
  }];
}

function checkTermCoveredByCatalogTypicalTerms(
  ctx: CheckContext,
  glossary: Glossary,
  catalog: ModuleCatalog,
): CheckResult[] {
  const notCovered: string[] = [];
  for (const t of glossary.terms) {
    const m = findModule(catalog, t.canonical_module);
    if (!m) continue;

    const needles = [t.term, ...t.aliases].filter(Boolean);
    const haystack = [
      ...m.typical_business_terms,
      m.one_liner,
      ...m.responsibilities,
    ].join('\n');

    const hit = needles.some(n => haystack.includes(n));
    if (!hit) {
      notCovered.push(`${t.term} (canonical=${t.canonical_module})`);
    }
  }

  if (notCovered.length === 0) {
    return [{
      id: 'term_covered_by_catalog_typical_terms', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'term_covered_by_catalog_typical_terms'),
      severity: 'MAJOR', status: 'PASS',
      details: `全部 term/alias 均可在 catalog 对应模块的 typical_business_terms/one_liner/responsibilities 中找到。`,
    }];
  }
  return [{
    id: 'term_covered_by_catalog_typical_terms', category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'term_covered_by_catalog_typical_terms'),
    severity: 'MAJOR', status: 'WARN',
    details: `${notCovered.length} 条 term 未能在对应模块 catalog 条目中找到匹配：${notCovered.join('、')}`,
    suggestion: '考虑把 term 或 alias 追加到对应模块的 typical_business_terms，提升未来 term 消歧的召回率。',
    affected_files: [relCatalog(ctx.projectRoot)],
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
  phase: 'glossary',

  async check(ctx: CheckContext): Promise<CheckResult[]> {
    // 先加载 glossary 本身
    const gResult = loadGlossary(ctx.projectRoot);
    const glossaryRel = relGlossary(ctx.projectRoot);
    const catalogRel = relCatalog(ctx.projectRoot);
    if (!gResult.ok) {
      return [{
        id: 'glossary_file_exists', category: 'structure',
        description: `${glossaryRel} 加载失败`,
        severity: 'BLOCKER', status: 'FAIL',
        details: describeGlossaryError(gResult.error),
        affected_files: [glossaryRel],
        suggestion: '最小骨架：\n```yaml\nschema_version: "1.0"\nterms: []\n```\n之后 /glossary-bootstrap 逐条落入。',
      }];
    }
    const glossary = gResult.glossary;

    // 再加载 catalog（交叉校验依赖）
    const cResult = loadCatalog(ctx.projectRoot);
    if (!cResult.ok) {
      return [{
        id: 'catalog_for_glossary_crosscheck', category: 'traceability',
        description: `${catalogRel} 加载失败，无法完成交叉校验`,
        severity: 'BLOCKER', status: 'FAIL',
        details: describeCatalogError(cResult.error),
        affected_files: [catalogRel, glossaryRel],
        suggestion: 'glossary 的交叉校验强依赖 catalog。先让 catalog 加载成功再回来。',
      }];
    }
    const catalog = cResult.catalog;

    const results: CheckResult[] = [];

    // Structure
    results.push(...safeRun(() => checkSchemaVersionPresent(ctx, glossary), 'schema_version_present'));
    results.push(...safeRun(() => checkTermsIsList(ctx, glossary), 'terms_is_list'));
    results.push(...safeRun(() => checkTermRequiredFields(ctx, glossary), 'term_required_fields'));
    results.push(...safeRun(() => checkTermUnique(ctx, glossary), 'term_unique'));
    results.push(...safeRun(() => checkAliasUniqueAcrossTerms(ctx, glossary), 'alias_unique_across_terms'));
    results.push(...safeRun(() => checkOwnerLayerValueValid(ctx, glossary), 'owner_layer_value_valid'));
    results.push(...safeRun(() => checkSeedNoTechnicalWords(ctx, catalog), 'seed_no_technical_words'));

    // Traceability
    results.push(...safeRun(() => checkCanonicalModuleExistsInCatalog(ctx, glossary, catalog), 'canonical_module_exists_in_catalog'));
    results.push(...safeRun(() => checkOwnerLayerMatchesCatalog(ctx, glossary, catalog), 'owner_layer_matches_catalog'));
    results.push(...safeRun(() => checkEasilyConfusedModulesExistInCatalog(ctx, glossary, catalog), 'easily_confused_modules_exist_in_catalog'));
    results.push(...safeRun(() => checkTermCoveredByCatalogTypicalTerms(ctx, glossary, catalog), 'term_covered_by_catalog_typical_terms'));

    return results;
  },
};

export default checker;
