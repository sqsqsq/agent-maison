// ============================================================================
// check-spec-small-scale.unit.test.ts — C4 exploration-scale：spec 阶段
// project_scale=small 术语映射表一次性确认分支直接单测
// ============================================================================
// 覆盖 checkTerminologyMappingTable 的 small 档分支：逐行 [x] 缺失时，
// standard 档仍 FAIL；small 档下有/无「一次性确认」行分别 PASS/FAIL。
// 不构造完整 10 章节 spec.md fixture（那是 required_chapters 等其它一堆无关
// BLOCKER 的组合测试，成本与本测试目标不成比例）——直接调用被导出的检查函数，
// 只喂它需要的最小上下文（术语映射表章节 + module-catalog.yaml + 真实
// spec-rules.yaml 规则文本），更精确地锁定这一个分支。

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkTerminologyMappingTable } from '../../scripts/check-spec';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { loadResolvedProfile } from '../../profile-loader';
import { loadFrameworkConfig } from '../../config';
import type { CheckContext } from '../../scripts/utils/types';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function includesId(results: Array<{ id: string; status: string }>, id: string, status?: string): boolean {
  return results.some((r) => r.id === id && (status === undefined || r.status === status));
}

function mkProject(projectScale: 'small' | 'standard' | undefined): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-small-scale-'));
  fs.mkdirSync(path.join(dir, 'workflows'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'doc'), { recursive: true });
  const cfg: Record<string, unknown> = {
    schema_version: '1.0',
    project_name: 'spec-small-scale-fixture',
    project_profile: { name: 'generic' },
    paths: { features_dir: 'doc/features', module_catalog: 'doc/module-catalog.yaml' },
  };
  if (projectScale) cfg.project_scale = projectScale;
  fs.writeFileSync(path.join(dir, 'framework.config.json'), JSON.stringify(cfg, null, 2), 'utf-8');
  fs.writeFileSync(path.join(dir, 'doc', 'module-catalog.yaml'), YAML_CATALOG, 'utf-8');
  return dir;
}

const YAML_CATALOG = `schema_version: "1.0"
modules:
  - name: "ModA"
    layer: "02-Feature"
    format: "library"
    one_liner: "fixture module"
    responsibilities: ["biz"]
    NOT_responsible_for: []
    typical_business_terms: ["ModA"]
    easily_confused_with: []
    key_exports: ["Entry"]
    entry_file: "02-Feature/ModA/index.ets"
`;

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');

function buildCtx(projectRoot: string): CheckContext {
  const cfg = loadFrameworkConfig(projectRoot);
  const specLoader = new SpecLoader(projectRoot, undefined, undefined, FRAMEWORK_ROOT);
  const phaseRule = specLoader.loadPhaseRule('spec');
  const resolvedProfile = loadResolvedProfile(projectRoot, cfg);
  return {
    phase: 'spec',
    feature: 'demo',
    projectRoot,
    phaseRule,
    featureSpec: { feature: 'demo' },
    resolvedProfile,
  } as CheckContext;
}

const TABLE_HEADER = '| 原始术语 | 权威模块 | 所属层 | 置信度 | 易混项 | 用户确认 |\n|---|---|---|---|---|---|';

function specWithTerminologyTable(rowConfirmCell: string, extraLine?: string): string {
  return [
    '## 0. 术语映射表',
    '',
    TABLE_HEADER,
    `| ModA术语 | ModA | 02-Feature | high | — | ${rowConfirmCell} |`,
    ...(extraLine ? ['', extraLine] : []),
    '',
    '## 1. 功能概述',
    '占位',
  ].join('\n');
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'standard 档：逐行未确认（[ ]）→ FAIL，即便节末有一次性确认行也不放行',
    run: () => {
      const dir = mkProject('standard');
      try {
        const ctx = buildCtx(dir);
        const prd = specWithTerminologyTable('[ ]', '- [x] 已对照 architecture.md 模块清单一次性确认全部术语映射');
        const results = checkTerminologyMappingTable(ctx, prd);
        eq(includesId(results, 'terminology_mapping_table', 'FAIL'), true, 'standard 档逐行未确认应 FAIL（一次性确认对 standard 档不生效）');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'small 档：逐行未确认（[ ]）+ 无一次性确认行 → 仍 FAIL',
    run: () => {
      const dir = mkProject('small');
      try {
        const ctx = buildCtx(dir);
        const prd = specWithTerminologyTable('[ ]');
        const results = checkTerminologyMappingTable(ctx, prd);
        eq(includesId(results, 'terminology_mapping_table', 'FAIL'), true, 'small 档缺一次性确认行仍应 FAIL');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'small 档：逐行未确认（[ ]）+ 有一次性确认行 → PASS（整体放行）',
    run: () => {
      const dir = mkProject('small');
      try {
        const ctx = buildCtx(dir);
        const prd = specWithTerminologyTable('[ ]', '- [x] 已对照 architecture.md 模块清单一次性确认全部术语映射');
        const results = checkTerminologyMappingTable(ctx, prd);
        eq(includesId(results, 'terminology_mapping_table', 'FAIL'), false, 'small 档有一次性确认行不应 FAIL');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'small 档：一次性确认行未勾选（- [ ]）→ 仍 FAIL（不是"存在该行"就放行，须真的勾选）',
    run: () => {
      const dir = mkProject('small');
      try {
        const ctx = buildCtx(dir);
        const prd = specWithTerminologyTable('[ ]', '- [ ] 已对照 architecture.md 模块清单一次性确认全部术语映射');
        const results = checkTerminologyMappingTable(ctx, prd);
        eq(includesId(results, 'terminology_mapping_table', 'FAIL'), true, '一次性确认行未勾选应仍 FAIL');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'standard 档：逐行已确认（[x]）→ 正常 PASS（既有行为零回归）',
    run: () => {
      const dir = mkProject('standard');
      try {
        const ctx = buildCtx(dir);
        const prd = specWithTerminologyTable('[x]');
        const results = checkTerminologyMappingTable(ctx, prd);
        eq(includesId(results, 'terminology_mapping_table', 'FAIL'), false, 'standard 档逐行确认应 PASS');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (err) {
      return { name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message };
    }
  });
}
