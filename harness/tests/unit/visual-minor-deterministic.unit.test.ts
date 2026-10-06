import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as assert from 'assert';
import { clearFrameworkConfigCache, loadFrameworkConfig } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
import * as visual from '../../../profiles/hmos-app/harness/visual-diff-check';
import { loadVisualScreenVerdicts } from '../../scripts/utils/execution-channel-evidence';
import type { UnitCaseResult } from '../run-unit';

type VisualModule = typeof visual;

/** Reverse only the screen filter in memory; the production file/cache stays unchanged. */
function previousFilter(): VisualModule {
  const filename = require.resolve('../../../profiles/hmos-app/harness/visual-diff-check');
  const source = fs.readFileSync(filename, 'utf8');
  const line = "const deterministicScreens = rep.screens.filter(s => s.verdict === 'pass' || visualResidualDisposition(s) === 'minor');";
  assert.ok(source.includes(line), 'mutation must reverse the actual deterministic-screen filter');
  const ts = require('typescript') as typeof import('typescript');
  const Module = require('module');
  const overlay = new Module(filename, module);
  overlay.filename = filename;
  overlay.paths = Module._nodeModulePaths(path.dirname(filename));
  overlay._compile(ts.transpileModule(source.replace(line, 'const deterministicScreens = passScreens;'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, filename);
  return overlay.exports as VisualModule;
}

async function withGate(api: VisualModule, run: (probe: {
  root: string;
  write: (rel: string, value: unknown) => void;
  gate: (variant: 'pass' | 'minor-warn' | 'legacy-minor-fail' | 'minor-without-instruction', missing: boolean) => ReturnType<VisualModule['checkVisualDiff']>[number];
}) => void): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minor-deterministic-'));
  const write = (rel: string, value: unknown) => {
    const file = path.join(root, rel); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  };
  try {
    write('framework.config.json', { schema_version: '1.1', project_name: 'test', project_profile: { name: 'hmos-app', sub_variant: 'app' }, paths: { features_dir: 'doc/features' } });
    write('doc/features/demo/spec/spec.md', '```yaml\nui_change: new_or_changed\nvisual_handoff:\n  authoritative_refs:\n    - id: home\n      path: doc/features/demo/ux-reference/ref.png\n```\n');
    write('doc/features/demo/spec/ui-spec.yaml', { schema_version: '1.0', screens: [{ id: 'home', priority: 'P0', root: {
      id: 'home_root', type: 'navigation_frame', order: 0,
      children: ['余额', '添卡', '最近交易'].map((text, order) => ({ id: 'anchor' + order, type: 'content_display', text, order })),
    } }], tokens: {}, assets: [] });
    write('doc/features/demo/device-testing/visual-diff.md', '# Visual diff\n');
    const shot = 'doc/features/demo/device-testing/device-screenshots/shot-home.png';
    fs.mkdirSync(path.dirname(path.join(root, shot)), { recursive: true });
    const Jimp = require('jimp');
    await new Jimp(12, 12, 0xff0000ff).writeAsync(path.join(root, shot));
    fs.mkdirSync(path.join(root, 'doc/features/demo/ux-reference'), { recursive: true });
    fs.copyFileSync(path.join(root, shot), path.join(root, 'doc/features/demo/ux-reference/ref.png'));
    const hash = api.hashScreenshotFile(path.join(root, shot));
    run({ root, write, gate: (variant, missing) => {
      const minor = variant !== 'pass';
      write('doc/features/demo/device-testing/device-screenshots/visual-diff.json', { schema_version: '1.1', screens: [{
        screen_id: 'home', ref_id: 'home', verdict: variant === 'pass' ? 'pass' : variant === 'legacy-minor-fail' ? 'fail' : 'warn',
        screenshot_path: shot, screenshot_hash: hash, evaluated_screenshot_hash: hash, fidelity_score: 0.99, reverse_missing: [],
        must_fix: minor && variant !== 'minor-without-instruction' ? ['minor colour detail'] : [],
        defects: minor ? [{ class: 'other', severity: 'minor', element: 'anchor0', note: 'minor colour detail', must_fix_refs: variant === 'minor-without-instruction' ? [] : [0] }] : [],
        region_attest: [{ region: 'root', verdict: 'no_diff', method: 'vl_screening' }],
      }] });
      api.__testing_setVisualDiffOcrFn(() => ({ ok: true, width: 12, height: 12, text: '', words: missing ? [] :
        ['余额', '添卡', '最近交易'].map((text, index) => ({ text, conf: 90, bbox: [0.1, 0.1 + index * 0.2, 0.3, 0.05] })) } as never));
      clearFrameworkConfigCache();
      return api.checkVisualDiff({ phase: 'testing', projectRoot: root, feature: 'demo', frameworkRoot: path.resolve(__dirname, '../../..'),
        phaseRule: { phase: 'testing', structure_checks: { visual_diff: { description: 'visual' } } }, featureSpec: { feature: 'demo' },
        resolvedProfile: loadResolvedProfile(root, loadFrameworkConfig(root)), fidelityTarget: 'pixel_1to1', acceptanceStrictness: 'hard' } as never)
        .find(check => (check.structured as { kind?: string })?.kind === 'visual_diff')!;
    } });
  } finally { api.__testing_setVisualDiffOcrFn(null); clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
}

export async function runAll(reverseFilter = false): Promise<UnitCaseResult[]> {
  const api = reverseFilter ? previousFilter() : visual;
  const cases = [
    { name: 'M1: hard minor and clean-pass screens all retain gross missing-anchor checks and consumer refusal', run: () => withGate(api, ({ root, gate }) => {
      for (const variant of ['pass', 'minor-warn', 'legacy-minor-fail', 'minor-without-instruction'] as const) {
        const result = gate(variant, true);
        assert.ok(/锚点文本整块缺失/.test(result.details), `${variant}: real T1 must still run`);
        assert.strictEqual(result.status, 'FAIL', variant); assert.strictEqual(result.severity, 'BLOCKER', variant);
        assert.strictEqual(loadVisualScreenVerdicts({ projectRoot: root, feature: 'demo', visualGate: result }).available, false, 'consumer must refuse the failed gate, not require a prettier evidence bool');
      }
      const control = gate('minor-without-instruction', false);
      assert.strictEqual(control.status, 'WARN', control.details);
      assert.strictEqual(loadVisualScreenVerdicts({ projectRoot: root, feature: 'demo', visualGate: control }).byScreen.get('home')?.usable, true);
      assert.ok(/pass=0；warn=1/.test(control.details), 'raw pass/warn statistics remain unchanged');
    }) },
    { name: 'M1: minor disclosure retains bidirectional residual checking', run: () => withGate(api, ({ root, write, gate }) => {
      write('doc/features/demo/spec/ref-elements.yaml', { schema_version: '1.0', elements: [{ element_id: 'missing_declared_reference', disposition: 'implement' }] });
      const result = gate('minor-warn', false);
      assert.ok(/ref-elements implement 未进 ui-spec/.test(result.details), 'bidirectional residual must still run for a minor-disclosure screen');
      assert.strictEqual(result.status, 'FAIL'); assert.strictEqual(result.severity, 'BLOCKER');
      assert.strictEqual(loadVisualScreenVerdicts({ projectRoot: root, feature: 'demo', visualGate: result }).available, false);
      write('doc/features/demo/spec/ref-elements.yaml', { schema_version: '1.0', elements: [{ element_id: 'anchor0', disposition: 'implement' }] });
      const control = gate('minor-warn', false);
      assert.strictEqual(control.status, 'WARN', control.details);
    }) },
  ];
  const results: UnitCaseResult[] = [];
  for (const test of cases) try { await test.run(); results.push({ name: test.name, ok: true }); }
  catch (error) { results.push({ name: test.name, ok: false, error: String((error as Error).message) }); }
  return results;
}
