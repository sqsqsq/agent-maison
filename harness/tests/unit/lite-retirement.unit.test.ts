import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import assert from 'assert';
import { loadWorkflowSpec, workflowForExistingRun } from '../../workflow-loader';
import { loadFeatureTrackDecl } from '../../scripts/utils/feature-track';
import { resolveFeatureTrack, resolvePhaseChain } from '../../scripts/utils/runtime-policy';
import { resolveExecutionScope } from '../../scripts/utils/execution-scope';
import { buildGoalManifestFromInput, writeGoalManifest, loadGoalManifestFromRun } from '../../scripts/utils/goal-manifest';
import { createGoalRun } from '../../scripts/utils/goal-run-creation';
import { resolveCapabilityResolutionEntryInput } from '../../scripts/utils/capability-resolution-entry-input';
import { resolveCapabilityInputs } from '../../scripts/utils/capability-resolution';
import { clearFrameworkConfigCache } from '../../config';
import { setupGoalRuntimeHost } from './goal-runner-testing-integrity.unit.test';

const FRAMEWORK_ROOT = path.resolve(__dirname, '../../..');
export interface UnitCaseResult { name: string; ok: boolean; error?: string }
const cases: Array<{ name: string; run(): void | Promise<void> }> = [
  { name: 'lite 专属发布文件和注册退出，非 lite spec-driven 与通用能力保留', run() {
    for (const retired of ['harness/scripts/check-change.ts', 'harness/scripts/check-exit.ts', 'specs/phase-rules/change-rules.yaml', 'specs/phase-rules/exit-rules.yaml', 'specs/artifact-schemas/change.schema.yaml', 'skills/legacy/change-lite/SKILL.md', 'skills/legacy/change-lite/contract.yaml']) assert(!fs.existsSync(path.join(FRAMEWORK_ROOT, retired)), retired);
    const legacy = loadWorkflowSpec(FRAMEWORK_ROOT, 'spec-driven');
    assert.deepStrictEqual(legacy.auto_chain, ['spec', 'plan', 'coding', 'review', 'ut', 'testing']);
    assert(!legacy.auto_chain_by_track && !legacy.artifacts.some(a => ['change', 'exit'].includes(a.id)));
    assert.deepStrictEqual(resolvePhaseChain(legacy).featureOrdered, legacy.auto_chain);
    for (const kept of ['harness/scripts/utils/lite-json-schema.ts', 'harness/scripts/check-change-unit.ts', 'harness/tests/unit/successor-exit-early.unit.test.ts', 'harness/tests/unit/successor-exit-late.unit.test.ts']) assert(fs.existsSync(path.join(FRAMEWORK_ROOT, kept)), kept);
  } },
  { name: '现代 review request 忽略残留 track:lite 并提示，真实 capability 仍按单职责范围解析', run() {
    const root = setupGoalRuntimeHost('codex').root;
    const originalWarn = console.warn; const warnings: string[] = [];
    try {
      const feature = 'bc-openCard';
      const configFile = path.join(root, 'framework.config.json');
      const config = JSON.parse(fs.readFileSync(configFile, 'utf8')); config.active_workflow = 'obligation-driven';
      fs.writeFileSync(configFile, JSON.stringify(config)); clearFrameworkConfigCache();
      fs.writeFileSync(path.join(root, 'doc/features', feature, 'feature.yaml'), 'track: lite\n');
      const workflow = loadWorkflowSpec(FRAMEWORK_ROOT, 'obligation-driven');
      const scope = resolveExecutionScope({ request: { completion_target: 'request', requested_results: ['review'], requested_phases: ['review'] }, contract_fingerprints: [], facts: [] }, workflow);
      assert.deepStrictEqual(scope.phase_chain, ['review']);
      const manifest = buildGoalManifestFromInput({ feature, run_id: 'modern-review', execution_scope: scope, chain_override: scope.phase_chain, unattended: { write_mode: 'full-access', approval_mode: 'never' } }, { projectRoot: root });
      createGoalRun({ projectRoot: root, manifest, chain: scope.phase_chain });
      console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')); };
      const track = resolveFeatureTrack(loadFeatureTrackDecl(root, feature, manifest.run_id));
      assert.strictEqual(track, 'full');
      const entry = resolveCapabilityResolutionEntryInput({ projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, feature, phase: 'review', featuresDir: 'doc/features', goalRunId: manifest.run_id });
      const { report } = resolveCapabilityInputs({ projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, feature, phase: 'review', track, ...entry });
      assert(report.capabilities.length > 0);
      assert(warnings.some(line => line.includes('track: lite') && line.includes('已忽略')));
      assert.deepStrictEqual(manifest.phase_chain, ['review']);
    } finally { console.warn = originalWarn; fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  } },
  { name: '旧 change/exit frozen run 在 workflow 阶段注册前退出并保留迁移提示，非 lite 旧定义仍可读', run() {
    const modern = loadWorkflowSpec(FRAMEWORK_ROOT, 'obligation-driven');
    for (const manifest of [{ phase_chain: ['change', 'coding', 'exit'] }, { start_phase: 'change', end_phase: 'exit' }, { chain_override: ['coding', 'exit'] }]) {
      assert.throws(() => workflowForExistingRun(modern, manifest, FRAMEWORK_ROOT), /\[lite-retired\].*不能续跑或映射为 full.*旧发布件/);
    }
    assert.strictEqual(workflowForExistingRun(modern, { phase_chain: ['coding', 'review'] }, FRAMEWORK_ROOT).name, 'spec-driven');
  } },
  { name: '真实 runtime resume 旧 lite run 零执行、零历史改写，错误先于未注册 phase 校验', async run() {
    for (const historyOnly of [false, true]) {
    const root = setupGoalRuntimeHost('codex').root;
    try {
      const feature = 'bc-openCard';
      const configFile = path.join(root, 'framework.config.json');
      const config = JSON.parse(fs.readFileSync(configFile, 'utf8')); config.active_workflow = 'obligation-driven';
      fs.writeFileSync(configFile, JSON.stringify(config)); clearFrameworkConfigCache();
      const manifest = buildGoalManifestFromInput({ feature, run_id: 'retired-lite-run', ...(historyOnly ? { start_phase: 'coding', end_phase: 'coding' } : { phase_chain: ['change', 'coding', 'exit'], start_phase: 'change', end_phase: 'exit' }), unattended: { write_mode: 'full-access', approval_mode: 'never' } }, { projectRoot: root });
      const runDir = path.join(root, manifest.report_dir); fs.mkdirSync(runDir, { recursive: true });
      writeGoalManifest(manifest, root);
      const events = path.join(runDir, 'events.jsonl'); const originalEvents = (historyOnly ? '{"type":"run_start","chain":["change","coding","exit"]}\n' : '') + '{"type":"run_end","status":"FAILED","total_turns":7}\n'; fs.writeFileSync(events, originalEvents);
      const manifestFile = path.join(runDir, 'manifest.json'); const originalManifest = fs.readFileSync(manifestFile, 'utf8');
      assert.strictEqual(loadGoalManifestFromRun(root, manifest.run_id, { feature }).run_id, manifest.run_id, '只读历史reader继续可用');
      const { main } = require('../../scripts/goal-phase-runtime') as typeof import('../../scripts/goal-phase-runtime');
      let executed = 0;
      await assert.rejects(() => main({ args: ['--project-root', root, '--framework-root', FRAMEWORK_ROOT, '--feature', feature, '--resume', manifest.run_id, '--force-resume', '--foreground-ok'], executor: { execute: async () => { executed++; throw new Error('retired executor must never run'); } } }), /\[lite-retired\]/);
      assert.strictEqual(executed, 0);
      assert.strictEqual(fs.readFileSync(events, 'utf8'), originalEvents);
      assert.strictEqual(fs.readFileSync(manifestFile, 'utf8'), originalManifest);
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
    }
  } },
];

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const test of cases) {
    try { await test.run(); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: error instanceof Error ? error.stack : String(error) }); }
  }
  return results;
}
