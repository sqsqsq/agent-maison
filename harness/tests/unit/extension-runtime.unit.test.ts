import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import assert from 'assert';

import { loadInstanceExtensions } from '../../extension-loader';
import { checkExtensionBindingProduces, formatExtensionPhasePrompt } from '../../scripts/utils/extension-runtime';
import { inspectInstanceExtensions } from '../../scripts/utils/extension-inspect';
import { checkMaterializationOnly } from '../../scripts/check-component-blueprint';

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');
const BLUEPRINT_FIXTURE = path.join(__dirname, '..', 'fixtures', 'component-blueprint', 'valid');
const SAMPLES = path.join(FRAMEWORK_ROOT, 'docs', 'operations', 'samples');

function write(target: string, body: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, 'utf8');
}

function manifest(root: string, actionBlock: string, bindingBlock: string, knowledgeBlock = ''): void {
  write(path.join(root, 'doc/extensions/manifest.yaml'), [
    'schema_version: "1.1"', 'name: runtime', 'provides:', '  skills: []',
    knowledgeBlock || '  knowledge: []', '  mcp_actions:', actionBlock,
    'phase_bindings:', bindingBlock, '',
  ].join('\n'));
}

export interface UnitCaseResult { name: string; ok: boolean; error?: string }

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'knowledge audience 精确过滤；legacy 字符串进入全部 Feature phase',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-knowledge-'));
      write(path.join(root, 'doc/extensions/knowledge/spec.md'), '# spec\n');
      write(path.join(root, 'doc/extensions/knowledge/plan.md'), '# plan\n');
      write(path.join(root, 'doc/extensions/knowledge/legacy.md'), '# legacy\n');
      manifest(root, '    none:\n      tool: host.none\n      required: false\n      produces: [doc/none.txt]\n      usage: none',
        '  spec:\n    before_phase_work:\n      - { kind: knowledge, ref: knowledge/spec.md }', [
          '  knowledge:', '    - { path: knowledge/spec.md, summary: spec-only, audience: [spec] }',
          '    - { path: knowledge/plan.md, summary: plan-only, audience: [plan] }', '    - knowledge/legacy.md',
        ].join('\n'));
      const bundle = loadInstanceExtensions(root);
      assert.strictEqual(bundle.errors.length, 0, JSON.stringify(bundle.errors));
      const spec = formatExtensionPhasePrompt(bundle, 'spec', root);
      const plan = formatExtensionPhasePrompt(bundle, 'plan', root);
      assert(spec.includes('spec.md') && !spec.includes('plan.md') && spec.includes('legacy.md'));
      assert(plan.includes('plan.md') && !plan.includes('spec.md') && plan.includes('legacy.md'));
      assert.strictEqual(formatExtensionPhasePrompt(bundle, 'catalog', root), '', 'global phase must not receive extension prompt');
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'M7 usage 仅人读：未知 artifact 按普通 produces，不冒充 seam consumer/validator',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-m7-honesty-'));
      const output = path.join(root, 'doc/requirements/not-a-seam.json');
      write(output, '{}\n');
      manifest(root, [
        '    claimed-m7:', '      tool: story.fetch', '      required: true',
        '      produces: [doc/requirements/not-a-seam.json]',
        '      usage: produces requirement-source-materialization@1 before /component-design',
      ].join('\n'), '  spec:\n    before_phase_verify:\n      - { kind: mcp, ref: claimed-m7 }');
      const bundle = loadInstanceExtensions(root);
      const checks = checkExtensionBindingProduces({ bundle, projectRoot: root, phase: 'spec', slot: 'before_phase_verify' });
      assert(checks.length === 1 && checks[0].status === 'PASS' && !checks[0].description.includes('requirement-source-materialization'));
      const inspection = inspectInstanceExtensions(root, FRAMEWORK_ROOT);
      const row = inspection.rows.find(item => item.type === 'mcp_action');
      assert(row && !row.consumer.includes('/component-design') && row.consumer === 'manifest 声明的下游', JSON.stringify(row));
      const explicit = checkMaterializationOnly(root, 'ledger-app-blueprint', output);
      assert(explicit.issues.some(item => item.id === 'materialization_schema_invalid' || item.id === 'materialization_artifact_invalid'));
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: '随包 extension M7 manifest 过 loader，并由真实 artifact 派生两条 seam consumer',
    run: () => {
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-m7-sample-'));
      const root = path.join(temp, 'project');
      fs.cpSync(BLUEPRINT_FIXTURE, root, { recursive: true });
      write(path.join(root, 'doc/extensions/skills/story-input/SKILL.md'), '# Story input\n');
      fs.copyFileSync(path.join(SAMPLES, 'extension-m7-manifest.yaml'), path.join(root, 'doc/extensions/manifest.yaml'));
      fs.mkdirSync(path.join(root, 'doc/requirements'), { recursive: true });
      fs.mkdirSync(path.join(root, 'doc/reviews'), { recursive: true });
      fs.copyFileSync(path.join(SAMPLES, 'requirement-source-materialization.valid.json'), path.join(root, 'doc/requirements/ledger.materialization.json'));
      fs.copyFileSync(path.join(SAMPLES, 'blueprint-review-feedback.valid.json'), path.join(root, 'doc/reviews/ledger.feedback.json'));
      const bundle = loadInstanceExtensions(root);
      assert(bundle.errors.length === 0, JSON.stringify(bundle.errors));
      assert(Object.keys(bundle.mcpActions).length === 2, JSON.stringify(bundle.mcpActions));
      const inspection = inspectInstanceExtensions(root, FRAMEWORK_ROOT);
      assert(inspection.rows.some(row => row.consumer.includes('requirement-source-materialization seam')), 'materialization consumer');
      assert(inspection.rows.some(row => row.consumer.includes('blueprint-review-feedback seam')), 'feedback consumer');
      fs.rmSync(temp, { recursive: true, force: true });
    },
  },
  {
    name: 'required/optional produces 缺失按既有 CheckResult 分级，after slot 同源',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-produces-'));
      manifest(root, [
        '    required-action:', '      tool: host.required', '      required: true', '      severity: BLOCKER',
        '      produces: [doc/required.json]', '      usage: required', '    optional-action:',
        '      tool: host.optional', '      required: false', '      produces: [doc/optional.json]', '      usage: optional',
      ].join('\n'), [
        '  spec:', '    before_phase_verify:', '      - { kind: mcp, ref: required-action }',
        '      - { kind: mcp, ref: optional-action }', '    after_phase_verify_before_close:',
        '      - { kind: mcp, ref: required-action }',
      ].join('\n'));
      const bundle = loadInstanceExtensions(root);
      const before = checkExtensionBindingProduces({ bundle, projectRoot: root, phase: 'spec', slot: 'before_phase_verify' });
      assert(before.some(item => item.status === 'FAIL' && item.severity === 'BLOCKER'));
      assert(before.some(item => item.status === 'SKIP' && item.severity === 'MINOR'));
      const close = checkExtensionBindingProduces({ bundle, projectRoot: root, phase: 'spec', slot: 'after_phase_verify_before_close' });
      assert(close.length === 1 && close[0].status === 'FAIL' && close[0].severity === 'BLOCKER');
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'M7 materialization produces 复用既有校验：PASS 后改坏 source_sha256 即 FAIL',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-materialization-'));
      fs.mkdirSync(path.join(root, 'requirements'), { recursive: true });
      fs.copyFileSync(path.join(BLUEPRINT_FIXTURE, 'requirements', 'ledger.md'), path.join(root, 'requirements', 'ledger.md'));
      const output = path.join(root, 'doc/requirements/ledger.materialization.json');
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.copyFileSync(path.join(SAMPLES, 'requirement-source-materialization.valid.json'), output);
      manifest(root, [
        '    materialize-story:', '      tool: story.fetch', '      required: true',
        '      produces: [doc/requirements/ledger.materialization.json]', '      usage: component design 前拉料',
      ].join('\n'), '  spec:\n    before_phase_verify:\n      - { kind: mcp, ref: materialize-story }');
      const bundle = loadInstanceExtensions(root);
      const pass = checkExtensionBindingProduces({ bundle, projectRoot: root, phase: 'spec', slot: 'before_phase_verify' });
      assert(pass.length === 1 && pass[0].status === 'PASS', pass[0]?.details);
      const inspection = inspectInstanceExtensions(root, FRAMEWORK_ROOT);
      assert(inspection.rows.some(row => row.consumer.includes('/component-design') && row.consumer.includes('requirement-source-materialization')));
      const bad = JSON.parse(fs.readFileSync(output, 'utf8'));
      bad.items[0].source_sha256 = `sha256:${'0'.repeat(64)}`;
      write(output, JSON.stringify(bad, null, 2));
      const fail = checkExtensionBindingProduces({ bundle, projectRoot: root, phase: 'spec', slot: 'before_phase_verify' });
      assert(fail[0].status === 'FAIL' && fail[0].details?.includes('materialization_source_hash_mismatch'));
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'M7 feedback produces 复用既有校验：PASS 后移除 authority 即 FAIL',
    run: () => {
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-feedback-'));
      const root = path.join(temp, 'project');
      fs.cpSync(BLUEPRINT_FIXTURE, root, { recursive: true });
      const output = path.join(root, 'doc/reviews/ledger.feedback.json');
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.copyFileSync(path.join(SAMPLES, 'blueprint-review-feedback.valid.json'), output);
      manifest(root, [
        '    submit-feedback:', '      tool: story.feedback', '      required: true',
        '      produces: [doc/reviews/ledger.feedback.json]', '      usage: 评审反馈回灌',
      ].join('\n'), '  review:\n    after_phase_verify_before_close:\n      - { kind: mcp, ref: submit-feedback }');
      const bundle = loadInstanceExtensions(root);
      const pass = checkExtensionBindingProduces({ bundle, projectRoot: root, phase: 'review', slot: 'after_phase_verify_before_close' });
      assert(pass.length === 1 && pass[0].status === 'PASS', pass[0]?.details);
      const bad = JSON.parse(fs.readFileSync(output, 'utf8'));
      delete bad.items.find((item: { kind: string }) => item.kind === 'authoritative_ruling').authority;
      write(output, JSON.stringify(bad, null, 2));
      const fail = checkExtensionBindingProduces({ bundle, projectRoot: root, phase: 'review', slot: 'after_phase_verify_before_close' });
      assert(fail[0].status === 'FAIL' && fail[0].details?.includes('review_feedback_authority_insufficient'));
      fs.rmSync(temp, { recursive: true, force: true });
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(item => {
    try { item.run(); return { name: item.name, ok: true }; }
    catch (error) { return { name: item.name, ok: false, error: (error as Error).stack }; }
  });
}
