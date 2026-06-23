// ============================================================================
// skills-index-init-steps.unit.test.ts — init_next_steps lint
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  lintSkillsIndexInitNextSteps,
  parseSkillsIndexRaw,
} from '../../scripts/utils/skills-index-init-steps';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const FRAMEWORK_DIR = path.resolve(__dirname, '../../..');

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: '正式 index lint PASS',
    run: () => {
      const hits = lintSkillsIndexInitNextSteps(FRAMEWORK_DIR);
      assert(hits.length === 0, hits.map(h => h.message).join('; '));
    },
  },
  {
    name: 'graph_gap 缺 workflow_artifact → FAIL',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-index-lint-'));
      copyTree(path.join(FRAMEWORK_DIR, 'skills'), path.join(dir, 'skills'));
      copyTree(path.join(FRAMEWORK_DIR, 'workflows'), path.join(dir, 'workflows'));
      const indexPath = path.join(dir, 'skills', 'skills.index.yaml');
      const text = fs.readFileSync(indexPath, 'utf-8');
      const parsed = parseSkillsIndexRaw(text);
      for (const entry of parsed.skills) {
        if (entry.id !== 'code-graph') continue;
        for (const step of entry.init_next_steps ?? []) {
          if (step.when === 'graph_gap') delete (step as { workflow_artifact?: string }).workflow_artifact;
        }
      }
      fs.writeFileSync(indexPath, stringifyIndex(parsed), 'utf-8');
      const hits = lintSkillsIndexInitNextSteps(dir);
      assert(hits.some(h => h.id === 'missing_workflow_artifact'), hits.map(h => h.id).join(','));
    },
  },
  {
    name: 'index 禁止 failure_recovery when',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-index-lint-'));
      copyTree(path.join(FRAMEWORK_DIR, 'skills'), path.join(dir, 'skills'));
      copyTree(path.join(FRAMEWORK_DIR, 'workflows'), path.join(dir, 'workflows'));
      const indexPath = path.join(dir, 'skills', 'skills.index.yaml');
      const text = fs.readFileSync(indexPath, 'utf-8');
      const parsed = parseSkillsIndexRaw(text);
      parsed.skills[0]!.init_next_steps = [
        {
          step_id: 'bad',
          when: 'failure_recovery',
          kind: 'required',
          priority: 1,
          invoke: { neutral: 'x', command_id: 'x' },
        },
      ];
      fs.writeFileSync(indexPath, stringifyIndex(parsed), 'utf-8');
      const hits = lintSkillsIndexInitNextSteps(dir);
      assert(hits.some(h => h.id === 'forbidden_when'), hits.map(h => h.id).join(','));
    },
  },
  {
    name: 'ambiguous workflow_artifact → FAIL',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-index-lint-'));
      copyTree(path.join(FRAMEWORK_DIR, 'skills'), path.join(dir, 'skills'));
      copyTree(path.join(FRAMEWORK_DIR, 'workflows'), path.join(dir, 'workflows'));
      const indexPath = path.join(dir, 'skills', 'skills.index.yaml');
      const text = fs.readFileSync(indexPath, 'utf-8');
      const parsed = parseSkillsIndexRaw(text);
      parsed.skills.push({
        id: 'dup-spec',
        scope: 'feature',
        source_rel: 'feature/spec-dup',
        order: 99,
        description: 'dup',
        init_next_steps: [
          {
            step_id: 'dup',
            when: 'feature_ready',
            kind: 'optional',
            priority: 99,
            workflow_artifact: 'spec',
            invoke: { neutral: 'dup', command_id: 'spec' },
          },
        ],
      });
      fs.writeFileSync(indexPath, stringifyIndex(parsed), 'utf-8');
      const hits = lintSkillsIndexInitNextSteps(dir);
      assert(hits.some(h => h.id === 'ambiguous_workflow_artifact'), hits.map(h => h.id).join(','));
    },
  },
  {
    name: 'skills.index.yaml 缺失 → missing_index（非 throw）',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-index-lint-'));
      copyTree(path.join(FRAMEWORK_DIR, 'workflows'), path.join(dir, 'workflows'));
      const hits = lintSkillsIndexInitNextSteps(dir);
      assert(hits.length === 1, hits.map(h => h.message).join('; '));
      assert(hits[0]!.id === 'missing_index', hits[0]!.id);
    },
  },
];

function copyTree(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}

function stringifyIndex(parsed: ReturnType<typeof parseSkillsIndexRaw>): string {
  const lines = ['schema_version: "1.0"', '', 'skills:'];
  for (const s of parsed.skills) {
    lines.push(`  - id: ${s.id}`);
    lines.push(`    scope: ${s.scope}`);
    lines.push(`    source_rel: ${s.source_rel}`);
    lines.push(`    order: ${s.order}`);
    lines.push(`    description: >`);
    lines.push(`      ${s.description.trim()}`);
    if (s.init_next_steps?.length) {
      lines.push('    init_next_steps:');
      for (const step of s.init_next_steps) {
        lines.push(`      - step_id: ${step.step_id}`);
        lines.push(`        when: ${step.when}`);
        lines.push(`        kind: ${step.kind}`);
        lines.push(`        priority: ${step.priority}`);
        if (step.workflow_artifact) {
          lines.push(`        workflow_artifact: ${step.workflow_artifact}`);
        }
        lines.push('        invoke:');
        lines.push(`          neutral: "${step.invoke.neutral}"`);
        lines.push(`          command_id: ${step.invoke.command_id}`);
        if (step.invoke.param_hint != null) {
          lines.push(`          param_hint: ${step.invoke.param_hint}`);
        }
        if (step.invoke.availability_note) {
          lines.push(`          availability_note: "${step.invoke.availability_note}"`);
        }
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

export function runAll(): UnitCaseResult[] {
  return cases.map(c => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (err) {
      return { name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message };
    }
  });
}
