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
type Variant = 'pass' | 'minor-warn' | 'legacy-minor-fail' | 'minor-without-instruction' | 'excluded-major-plus-minor';
const EXCLUSION_QUOTE = '推广横幅本次不做';

async function withGate(api: VisualModule, run: (probe: {
  root: string;
  write: (rel: string, value: unknown) => void;
  gate: (variant: Variant, missing: boolean) => ReturnType<VisualModule['checkVisualDiff']>[number];
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
      // 同屏：已核引文的 excluded major（授权过滤剔除）+ 授权 minor——原始处置为 null，有效处置为 minor。
      const excludedMajor = variant === 'excluded-major-plus-minor'
        ? { must_fix: ['remove promo banner', 'minor colour detail'], defects: [
          { class: 'other', severity: 'major', element: 'promo_banner', note: 'promo banner rendered', must_fix_refs: [0] },
          { class: 'other', severity: 'minor', element: 'anchor0', note: 'minor colour detail', must_fix_refs: [1] },
        ] }
        : null;
      write('doc/features/demo/device-testing/device-screenshots/visual-diff.json', { schema_version: '1.1', screens: [{
        screen_id: 'home', ref_id: 'home', verdict: variant === 'pass' ? 'pass' : variant === 'legacy-minor-fail' || excludedMajor ? 'fail' : 'warn',
        screenshot_path: shot, screenshot_hash: hash, evaluated_screenshot_hash: hash, fidelity_score: 0.99, reverse_missing: [],
        must_fix: minor && variant !== 'minor-without-instruction' ? ['minor colour detail'] : [],
        defects: minor ? [{ class: 'other', severity: 'minor', element: 'anchor0', note: 'minor colour detail', must_fix_refs: variant === 'minor-without-instruction' ? [] : [0] }] : [],
        ...excludedMajor,
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

export async function runAll(): Promise<UnitCaseResult[]> {
  const api = visual;
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
    { name: 'a2f7c9e4 §3.8: 受检屏按授权过滤后的有效处置取——同屏 excluded major + 授权 minor 的锚点整块缺失仍 BLOCKER', run: () => withGate(api, ({ root, write, gate }) => {
      write('doc/features/demo/spec/ref-elements.yaml', { schema_version: '1.0', elements: [
        { element_id: 'promo_banner', disposition: 'excluded', requirement_quote: EXCLUSION_QUOTE },
      ] });
      // 排除登记须引文逐字出现在当前目标文本才被采用（授权判定与 spec 门同源）——给一个冻结需求含该引文的权威 run。
      const { buildGoalManifestFromInput } = require('../../scripts/utils/goal-manifest') as typeof import('../../scripts/utils/goal-manifest');
      const { createGoalRun } = require('../../scripts/utils/goal-run-creation') as typeof import('../../scripts/utils/goal-run-creation');
      createGoalRun({ projectRoot: root, manifest: buildGoalManifestFromInput({ feature: 'demo', run_id: 'excl-minor', requirement: `首页展示余额。${EXCLUSION_QUOTE}。`,
        unattended: { write_mode: 'workspace-write', approval_mode: 'on-request' } }, { projectRoot: root }), chain: ['spec'] });
      const prevRunId = process.env.MAISON_GOAL_RUN_ID;
      process.env.MAISON_GOAL_RUN_ID = 'excl-minor';
      try {
        const result = gate('excluded-major-plus-minor', true);
        assert.ok(/锚点文本整块缺失/.test(result.details), `有效处置为 minor 的屏必须进 T1：${result.details}`);
        assert.strictEqual(result.status, 'FAIL', result.details); assert.strictEqual(result.severity, 'BLOCKER', result.details);
        const control = gate('excluded-major-plus-minor', false);
        assert.ok(!/锚点文本整块缺失/.test(control.details), control.details);
        assert.notStrictEqual(control.severity, 'BLOCKER', `锚点齐全时 excluded major 不得阻断：${control.details}`);
      } finally {
        if (prevRunId === undefined) delete process.env.MAISON_GOAL_RUN_ID; else process.env.MAISON_GOAL_RUN_ID = prevRunId;
      }
    }) },
  ];
  const results: UnitCaseResult[] = [];
  for (const test of cases) try { await test.run(); results.push({ name: test.name, ok: true }); }
  catch (error) { results.push({ name: test.name, ok: false, error: String((error as Error).message) }); }
  return results;
}
