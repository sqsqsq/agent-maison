/**
 * path-governance 单测（round7 先行批 · plan 7c4e9f2a）：
 *   病灶＝共享 helper 与散点历史硬编码 doc/features，自定义 paths.features_dir 宿主
 *   在多处先断（读不到 ui-spec/spec.md/acceptance/coverage 等 → 静默失效/误报缺失）。
 *   验收铁律：
 *   - 自定义 features_dir：全部 A 段 helper 解析到自定义目录（不回退 doc/features）；
 *   - 默认布局（无 framework.config.json）：回落 doc/features（零回归）；
 *   - 生产入口级（防"helper 修好、入口仍断"）：checkVisualFidelityReview 经 featureFilePath
 *     读 spec.md，自定义目录下须触达门禁而非提前 return []。
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  uiSpecAbsPath,
  uiSpecRelPath,
  visualParityAbsPath,
} from '../../scripts/utils/ui-spec-shared';
import {
  loadSpecMarkdown,
  refElementsAbsPath,
  assetManifestAbsPath,
} from '../../scripts/utils/fidelity-shared';
import {
  acceptanceYamlPath,
  acceptanceYamlRel,
} from '../../scripts/utils/acceptance-layering';
import {
  coverageEvidenceRel,
  resolveCoverageEvidencePath,
  ephemeralFlowDagDir,
} from '../../scripts/utils/coverage-evidence';
import { acCoverageReportPath } from '../../scripts/utils/ac-coverage-report';
import { checkVisualFidelityReview } from '../../scripts/check-review';
import { fillCompatMessage, SUGGESTION_COMPAT_EXPIRED } from '../../compat-messages';
import { assembleAIPrompt } from '../../scripts/utils/report-generator';
import { clearFrameworkConfigCache } from '../../config';
import type { CheckContext } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';

const FRAMEWORK_HARNESS_ROOT = path.resolve(__dirname, '../..');

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}

const toPosix = (p: string): string => p.replace(/\\/g, '/');

function writeCustomConfig(root: string): void {
  fs.writeFileSync(
    path.join(root, 'framework.config.json'),
    JSON.stringify({
      schema_version: '1.0',
      project_name: 'x',
      project_type: 'app',
      paths: { features_dir: 'requirements/features' },
    }),
    'utf-8',
  );
  clearFrameworkConfigCache();
}

test('helpers_resolve_custom_features_dir', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pathgov-cfg-'));
  try {
    writeCustomConfig(root);
    const f = 'homepage';
    const base = 'requirements/features/homepage';
    // ui-spec-shared（A①）
    assert.ok(toPosix(uiSpecAbsPath(root, f)).endsWith(`${base}/spec/ui-spec.yaml`), uiSpecAbsPath(root, f));
    assert.strictEqual(uiSpecRelPath(root, f), `${base}/spec/ui-spec.yaml`);
    assert.ok(toPosix(visualParityAbsPath(root, f)).endsWith(`${base}/plan/visual-parity.yaml`), visualParityAbsPath(root, f));
    // fidelity-shared（A②）
    assert.ok(toPosix(refElementsAbsPath(root, f)).endsWith(`${base}/spec/ref-elements.yaml`), refElementsAbsPath(root, f));
    assert.ok(toPosix(assetManifestAbsPath(root, f)).endsWith(`${base}/spec/asset-manifest.yaml`), assetManifestAbsPath(root, f));
    // loadSpecMarkdown 从自定义目录读内容
    const specDir = path.join(root, 'requirements', 'features', 'homepage', 'spec');
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(path.join(specDir, 'spec.md'), '# custom-dir spec\n', 'utf-8');
    assert.strictEqual(loadSpecMarkdown(root, f), '# custom-dir spec\n');
    // acceptance-layering（A④）
    assert.strictEqual(acceptanceYamlRel(root, f), `${base}/acceptance.yaml`);
    assert.ok(toPosix(acceptanceYamlPath(root, f)).endsWith(`${base}/acceptance.yaml`), acceptanceYamlPath(root, f));
    // coverage-evidence（A⑤）
    assert.strictEqual(coverageEvidenceRel(root, f), `${base}/ut/reports/coverage-evidence.json`);
    assert.ok(toPosix(resolveCoverageEvidencePath(root, f)).endsWith(`${base}/ut/reports/coverage-evidence.json`), resolveCoverageEvidencePath(root, f));
    assert.ok(toPosix(ephemeralFlowDagDir(root, f)).endsWith(`${base}/ut/reports/flow-dag`), ephemeralFlowDagDir(root, f));
    // ac-coverage-report（A⑤）
    assert.ok(toPosix(acCoverageReportPath(root, f)).endsWith(`${base}/ut/reports/ac-coverage.json`), acCoverageReportPath(root, f));
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('helpers_fallback_default_doc_features', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pathgov-def-'));
  try {
    clearFrameworkConfigCache(); // 无 framework.config.json → 默认 doc/features（零回归）
    const f = 'homepage';
    assert.strictEqual(uiSpecRelPath(root, f), 'doc/features/homepage/spec/ui-spec.yaml');
    assert.ok(toPosix(uiSpecAbsPath(root, f)).endsWith('doc/features/homepage/spec/ui-spec.yaml'), uiSpecAbsPath(root, f));
    assert.strictEqual(acceptanceYamlRel(root, f), 'doc/features/homepage/acceptance.yaml');
    assert.strictEqual(coverageEvidenceRel(root, f), 'doc/features/homepage/ut/reports/coverage-evidence.json');
    assert.ok(toPosix(acCoverageReportPath(root, f)).endsWith('doc/features/homepage/ut/reports/ac-coverage.json'), acCoverageReportPath(root, f));
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('production_entry_check_review_reads_spec_in_custom_features_dir', () => {
  // 生产入口级（防"helper 修好、入口仍断"）：checkVisualFidelityReview 经 featureFilePath
  // 读 spec.md（B 段修）；若仍硬编码 doc/features，自定义目录下 existsSync 失败 → 提前
  // return []，门禁静默失效。故断言"缺视觉维度 → 触发门禁"以证明它确实读到了自定义目录 spec.md。
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pathgov-prod-'));
  try {
    writeCustomConfig(root);
    const specDir = path.join(root, 'requirements', 'features', 'homepage', 'spec');
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(path.join(specDir, 'spec.md'), '# spec\n\n```yaml\nui_change: new_or_changed\n```\n', 'utf-8');
    const ctx = {
      phase: 'review',
      feature: 'homepage',
      projectRoot: root,
      fidelityTarget: 'pixel_1to1',
      phaseRule: { structure_checks: {} },
    } as unknown as CheckContext;
    // 报告不含任何"视觉保真/视觉维度/visual fidelity"触发词 → insufficient → 门禁 FAIL
    const results = checkVisualFidelityReview(ctx, '# Review\n常规审查结论。');
    assert.strictEqual(results.length, 1, `自定义目录下须触达门禁（读到 spec.md）：${JSON.stringify(results)}`);
    assert.strictEqual(results[0].id, 'visual_fidelity_review', JSON.stringify(results[0]));
    assert.strictEqual(results[0].status, 'FAIL', '缺视觉维度须 FAIL');
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('e1_fill_compat_message_injects_features_dir', () => {
  // round7 skills/文案批 E1④：compat 模板 {features_dir} 由 fillCompatMessage 注入
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pathgov-compat-'));
  try {
    // 默认布局：等价旧字面量
    clearFrameworkConfigCache();
    const def = fillCompatMessage(SUGGESTION_COMPAT_EXPIRED, root, 'homepage', 'ut');
    assert.ok(def.includes('doc/features/homepage/compat.yaml'), def);
    assert.ok(!def.includes('{features_dir}'), '不得残留裸占位符');
    // custom：注入配置目录
    fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
      schema_version: '1.0', project_name: 'x', project_type: 'app',
      paths: { features_dir: 'requirements/features' },
    }), 'utf-8');
    clearFrameworkConfigCache();
    const custom = fillCompatMessage(SUGGESTION_COMPAT_EXPIRED, root, 'homepage', 'ut');
    assert.ok(custom.includes('requirements/features/homepage/compat.yaml'), custom);
    assert.ok(!custom.includes('doc/features/homepage'), '不得残留默认路径');
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('e1_assemble_ai_prompt_resolves_features_dir', () => {
  // round7 skills/文案批 E1①②：verify 模板 {features_dir} 在组装时解析为实例配置值
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pathgov-prompt-'));
  try {
    fs.mkdirSync(path.join(root, 'skills'));
    fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
      schema_version: '1.0', project_name: 'x', project_type: 'app',
      paths: { features_dir: 'requirements/features' },
    }), 'utf-8');
    clearFrameworkConfigCache();
    const prompt = assembleAIPrompt(
      FRAMEWORK_HARNESS_ROOT, // 真实 harness root：读真 verify-spec.md 模板
      root,
      'spec',
      'homepage',
      [],
      '{}',
      '# spec',
    );
    assert.ok(!prompt.includes('{features_dir}'), '模板占位符须全部解析');
    assert.ok(prompt.includes('requirements/features/homepage'), '须含 custom 解析路径');
    assert.ok(!/doc\/features\/homepage/.test(prompt), 'custom 下不得出现默认 feature 路径');
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}
