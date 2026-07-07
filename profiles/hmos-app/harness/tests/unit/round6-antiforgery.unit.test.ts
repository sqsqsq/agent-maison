/**
 * round6 子批A 反伪造单测（plan c9e2a7f4 · P0-7③ 伪签物证扫描）：
 *   夹具＝宿主 homepage 2026-07-05 伪签事故真实脚本（fixtures/round6/tamper-scripts/——
 *   visual-diff-auto-fill.mjs 为原件，fill-pass/reset 两 .cjs 为原件删除后的当日读取复刻）。
 *   验收铁律：三类实锤脚本全中（含 reset 类"销毁 must_fix"，codex 意见）；
 *   正常读取/统计脚本与不涉 visual-diff.json 的脚本不误伤（双条件同中才报）。
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { collectVisualDiffTamperArtifacts } from '../../evidence-tamper-scan';
import { featuresDirPath, clearFrameworkConfigCache } from '../../../../../harness/config';
import type { UnitCaseResult } from '../../../../../harness/tests/run-unit';

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}

const TAMPER_FIXTURES = path.join(__dirname, '..', 'fixtures', 'round6', 'tamper-scripts');

function mkFeatureRoot(): { root: string; testingDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tamper-scan-'));
  const testingDir = path.join(root, 'doc', 'features', 'homepage', 'testing');
  fs.mkdirSync(testingDir, { recursive: true });
  return { root, testingDir };
}

test('tamper_scan_hits_all_real_incident_scripts', () => {
  const { root, testingDir } = mkFeatureRoot();
  try {
    for (const f of fs.readdirSync(TAMPER_FIXTURES)) {
      fs.copyFileSync(path.join(TAMPER_FIXTURES, f), path.join(testingDir, f));
    }
    const artifacts = collectVisualDiffTamperArtifacts(root, 'homepage');
    assert.strictEqual(artifacts.length, 3, `三个实锤脚本必须全中：${JSON.stringify(artifacts.map(a => a.file))}`);
    const byFile = new Map(artifacts.map(a => [path.basename(a.file), a.signatures.join('|')]));
    // auto-fill（NODE_OPTIONS hook 原件）：填 pass + confirmed_by 伪签 + 伪造证据绑定
    const autoFill = byFile.get('visual-diff-auto-fill.mjs') ?? '';
    assert.ok(/confirmed_by/.test(autoFill) && /pass/.test(autoFill) && /evaluated_screenshot_hash/.test(autoFill), autoFill);
    // fill-pass：同特征直填
    assert.ok(/confirmed_by/.test(byFile.get('fill-visual-diff-pass.cjs') ?? ''));
    // reset：销毁回修指令类（codex 意见——不只抓填 pass）
    const reset = byFile.get('reset-visual-diff-pending.cjs') ?? '';
    assert.ok(/must_fix/.test(reset) && /pending/.test(reset), reset);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tamper_scan_no_fp_on_benign_scripts', () => {
  const { root, testingDir } = mkFeatureRoot();
  try {
    // 正样本①：只读统计脚本（引用 visual-diff.json 但无改判特征）
    fs.writeFileSync(path.join(testingDir, 'report-stats.cjs'), [
      "const fs = require('node:fs');",
      "const r = JSON.parse(fs.readFileSync('doc/features/homepage/device-testing/device-screenshots/visual-diff.json', 'utf-8'));",
      "console.log(r.screens.map(s => `${s.screen_id}: ${s.verdict}`).join('\\n'));",
    ].join('\n'), 'utf-8');
    // 正样本②：不涉 visual-diff.json 的工具脚本（含 verdict 字样也不报——双条件缺一不可）
    fs.writeFileSync(path.join(testingDir, 'unrelated-tool.mjs'), [
      "const verdict = 'pass';",
      "console.log('local tool', verdict);",
    ].join('\n'), 'utf-8');
    // 正样本③：markdown 文档提到特征词（非脚本扩展名，不扫）
    fs.writeFileSync(path.join(testingDir, 'notes.md'), 'confirmed_by= 与 visual-diff.json 的说明文档', 'utf-8');
    const artifacts = collectVisualDiffTamperArtifacts(root, 'homepage');
    assert.strictEqual(artifacts.length, 0, `正样本不得误伤：${JSON.stringify(artifacts)}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tamper_scan_covers_device_testing_dir_and_missing_dirs_safe', () => {
  const { root } = mkFeatureRoot();
  try {
    // device-testing 侧藏匿同样检出
    const dtDir = path.join(root, 'doc', 'features', 'homepage', 'device-testing', 'tools');
    fs.mkdirSync(dtDir, { recursive: true });
    fs.copyFileSync(
      path.join(TAMPER_FIXTURES, 'fill-visual-diff-pass.cjs'),
      path.join(dtDir, 'helper.cjs'),
    );
    const artifacts = collectVisualDiffTamperArtifacts(root, 'homepage');
    assert.strictEqual(artifacts.length, 1);
    assert.ok(/device-testing\/tools\/helper\.cjs/.test(artifacts[0].file));
    // 目录不存在 → 安静返回空（零回归）
    assert.strictEqual(collectVisualDiffTamperArtifacts(root, 'no-such-feature').length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tamper_scan_respects_custom_features_dir', () => {
  // codex 意见：宿主自定义 paths.features_dir 时脚本只在自定义目录下也必须命中——
  // 调用侧传 featuresDirPath(projectRoot)（吃配置），scanner 支持绝对路径。
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tamper-scan-cfg-'));
  try {
    fs.writeFileSync(
      path.join(root, 'framework.config.json'),
      JSON.stringify({ paths: { features_dir: 'requirements/features' } }),
      'utf-8',
    );
    clearFrameworkConfigCache();
    const testingDir = path.join(root, 'requirements', 'features', 'homepage', 'testing');
    fs.mkdirSync(testingDir, { recursive: true });
    fs.copyFileSync(
      path.join(TAMPER_FIXTURES, 'fill-visual-diff-pass.cjs'),
      path.join(testingDir, 'fill-visual-diff-pass.cjs'),
    );
    const featuresAbs = featuresDirPath(root);
    assert.ok(/requirements[\\/]features$/.test(featuresAbs), `features_dir 配置须生效：${featuresAbs}`);
    // 经配置目录（visual-diff-check 调用侧同款传参）→ 命中
    const hits = collectVisualDiffTamperArtifacts(root, 'homepage', featuresAbs);
    assert.strictEqual(hits.length, 1, JSON.stringify(hits));
    assert.ok(/requirements\/features\/homepage\/testing\/fill-visual-diff-pass\.cjs/.test(hits[0].file), hits[0].file);
    // round7 路径治理（evidence-tamper-scan⑧）：默认参数改为函数体内 featuresDirPath(projectRoot)
    // 解析（尊重 paths.features_dir），不再回退硬编码 doc/features——故省略第三参也吃配置、
    // 在自定义 features_dir 一样命中（"调用方漏传即漏拦"的火药桶已拆）。
    assert.strictEqual(collectVisualDiffTamperArtifacts(root, 'homepage').length, 1);
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
