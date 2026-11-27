import { beginUnitCase, discoveryResult } from '../utils/unit-cases';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import assert from 'assert';
import * as YAML from 'yaml';
import { putPlugin } from './extension-test-fixture';

import { loadInstanceExtensions } from '../../extension-loader';
import { checkExtensionBindingProduces, phaseExtensionMaterialFiles } from '../../scripts/utils/extension-runtime';
import { assembleKnowledge, FEATURE_AUTHOR_AT, FEATURE_CLOSE_AT, FEATURE_VERIFY_AT, renderExtensionPhaseInputs } from '../../scripts/utils/knowledge-context';
import { inspectInstanceExtensions } from '../../scripts/utils/extension-inspect';
import { checkMaterializationOnly } from '../../scripts/check-component-blueprint';

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');
const BLUEPRINT_FIXTURE = path.join(__dirname, '..', 'fixtures', 'component-blueprint', 'valid');
const SAMPLES = path.join(FRAMEWORK_ROOT, 'docs', 'operations', 'samples');

function write(target: string, body: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, 'utf8');
}

function manifest(root: string, actionBlock: string, specs: Array<[string, string, string]>): void {
  const mcp_actions = YAML.parse('actions:\n' + actionBlock).actions;
  const bindings = Object.fromEntries(specs.map(([phase, at, ref], index) => ['action-' + index, {phase, at, ref, kind: 'action'}]));
  putPlugin(root, 'runtime', { declaration: { provides: { mcp_actions }, bindings } });
}

export interface UnitCaseResult { name: string; ok: boolean; error?: string }

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'Feature 阶段仅接收自己时点的知识，项目入口独立',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-knowledge-'));
      try {
        putPlugin(root, 'runtime', { declaration: { bindings: {
          spec: { at: FEATURE_AUTHOR_AT, phase: 'spec', kind: 'knowledge', ref: 'knowledge/spec.md' },
          plan: { at: FEATURE_AUTHOR_AT, phase: 'plan', kind: 'knowledge', ref: 'knowledge/plan.md' },
          project: { at: 'project.entry@1', kind: 'knowledge', ref: 'knowledge/project.md' },
        } }, files: { 'knowledge/spec.md': '# spec', 'knowledge/plan.md': '# plan', 'knowledge/project.md': '# project' } });
        const bundle = loadInstanceExtensions(root);
        assert.deepStrictEqual(bundle.errors, []);
        const spec = renderExtensionPhaseInputs(bundle, 'spec', root);
        const plan = renderExtensionPhaseInputs(bundle, 'plan', root);
        assert(spec.includes('spec.md') && !spec.includes('plan.md') && !spec.includes('project.md'));
        assert(plan.includes('plan.md') && !plan.includes('spec.md') && !plan.includes('project.md'));
        assert.strictEqual(renderExtensionPhaseInputs(bundle, 'catalog', root), '');
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
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
      ].join('\n'), [['spec', FEATURE_VERIFY_AT, 'claimed-m7']]);
      const bundle = loadInstanceExtensions(root);
      const checks = checkExtensionBindingProduces({ bundle, projectRoot: root, phase: 'spec', at: FEATURE_VERIFY_AT });
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
      const sample = YAML.parse(fs.readFileSync(path.join(SAMPLES, 'extension-m7-manifest.yaml'), 'utf8'));
      putPlugin(root, sample.name, { declaration: sample, files: { 'skills/story-input/SKILL.md': '# Story input' } });
      fs.mkdirSync(path.join(root, 'doc/requirements'), { recursive: true });
      fs.mkdirSync(path.join(root, 'doc/reviews'), { recursive: true });
      fs.copyFileSync(path.join(SAMPLES, 'requirement-source-materialization.valid.json'), path.join(root, 'doc/requirements/ledger.materialization.json'));
      fs.copyFileSync(path.join(SAMPLES, 'blueprint-review-feedback.valid.json'), path.join(root, 'doc/reviews/ledger.feedback.json'));
      const bundle = loadInstanceExtensions(root);
      assert(bundle.errors.length === 0, JSON.stringify(bundle.errors));
      assert(Object.keys(bundle.plugins[sample.name].mcpActions).length === 2, JSON.stringify(bundle.errors));
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
      ].join('\n'), [['spec', FEATURE_VERIFY_AT, 'required-action'], ['spec', FEATURE_VERIFY_AT, 'optional-action'],
        ['spec', FEATURE_CLOSE_AT, 'required-action']]);
      const bundle = loadInstanceExtensions(root);
      const before = checkExtensionBindingProduces({ bundle, projectRoot: root, phase: 'spec', at: FEATURE_VERIFY_AT });
      assert(before.some(item => item.status === 'FAIL' && item.severity === 'BLOCKER'));
      assert(before.some(item => item.status === 'SKIP' && item.severity === 'MINOR'));
      const close = checkExtensionBindingProduces({ bundle, projectRoot: root, phase: 'spec', at: FEATURE_CLOSE_AT });
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
      ].join('\n'), [['spec', FEATURE_VERIFY_AT, 'materialize-story']]);
      const bundle = loadInstanceExtensions(root);
      const pass = checkExtensionBindingProduces({ bundle, projectRoot: root, phase: 'spec', at: FEATURE_VERIFY_AT });
      assert(pass.length === 1 && pass[0].status === 'PASS', pass[0]?.details);
      const inspection = inspectInstanceExtensions(root, FRAMEWORK_ROOT);
      assert(inspection.rows.some(row => row.consumer.includes('/component-design') && row.consumer.includes('requirement-source-materialization')));
      const bad = JSON.parse(fs.readFileSync(output, 'utf8'));
      bad.items[0].source_sha256 = `sha256:${'0'.repeat(64)}`;
      write(output, JSON.stringify(bad, null, 2));
      const fail = checkExtensionBindingProduces({ bundle, projectRoot: root, phase: 'spec', at: FEATURE_VERIFY_AT });
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
      ].join('\n'), [['review', FEATURE_CLOSE_AT, 'submit-feedback']]);
      const bundle = loadInstanceExtensions(root);
      const pass = checkExtensionBindingProduces({ bundle, projectRoot: root, phase: 'review', at: FEATURE_CLOSE_AT });
      assert(pass.length === 1 && pass[0].status === 'PASS', pass[0]?.details);
      const bad = JSON.parse(fs.readFileSync(output, 'utf8'));
      delete bad.items.find((item: { kind: string }) => item.kind === 'authoritative_ruling').authority;
      write(output, JSON.stringify(bad, null, 2));
      const fail = checkExtensionBindingProduces({ bundle, projectRoot: root, phase: 'review', at: FEATURE_CLOSE_AT });
      assert(fail[0].status === 'FAIL' && fail[0].details?.includes('review_feedback_authority_insufficient'));
      fs.rmSync(temp, { recursive: true, force: true });
    },
  },
  {
    name: '同一文件的多条绑定合并为单个知识输入，同时保留 verifier 原文与清单指纹',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-phase-knowledge-'));
      try {
        const binding = { at: FEATURE_AUTHOR_AT, phase: 'spec', kind: 'knowledge', ref: 'knowledge/spec.md' };
        putPlugin(root, 'runtime', { declaration: { bindings: { one: binding, two: binding } }, files: { 'knowledge/spec.md': '# spec' } });
        const bundle = loadInstanceExtensions(root);
        assert.deepStrictEqual(bundle.errors, []);
        const knowledge = assembleKnowledge({ projectRoot: root, frameworkRoot: FRAMEWORK_ROOT,
          subject: 'feature', role: 'author', phase: 'spec', extensionBundle: bundle });
        const entry = knowledge.entries.filter(item => item.kind === 'extension');
        assert.strictEqual(entry.length, 1);
        assert.strictEqual(entry[0].content, '# spec');
        assert.deepStrictEqual(phaseExtensionMaterialFiles(bundle, root, 'spec'), [
          'doc/extensions/manifest.yaml', 'doc/extensions/runtime/knowledge/spec.md', 'doc/extensions/runtime/manifest.yaml',
        ]);
        assert.deepStrictEqual(phaseExtensionMaterialFiles(bundle, root, 'catalog'), []);
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(item => {
    const endUnitCase = beginUnitCase(item.name);
    if (!endUnitCase) return discoveryResult(item.name);
    try { item.run(); return { name: item.name, ok: true }; }
    catch (error) { return { name: item.name, ok: false, error: (error as Error).stack }; } finally { endUnitCase(); }
  });
}
