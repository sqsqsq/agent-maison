import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  enforcementGlobRegex,
  validateEnforcementPaths,
} from '../check-openspec-enforcement-paths.mjs';

function write(root, relative, content = '') {
  const target = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

test('Enforcement validator accepts exact paths and supported brace/star globs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-enforcement-valid-'));
  try {
    write(root, 'harness/scripts/goal-runner.ts');
    write(root, 'agents/codex/adapter.yaml');
    write(root, 'README.md');
    write(root, 'workflows/spec-driven.workflow.yaml');
    write(root, 'openspec/specs/demo/spec.md', [
      '# demo',
      'Enforcement: `harness/scripts/goal-runner.ts`, `agents/{codex,claude}/adapter.yaml`',
      'Enforcement: `README.md`, `workflows/spec-driven.workflow.yaml`',
      'Enforcement: `README.md` `scanForeignFiles`',
    ].join('\n'));
    assert.deepEqual(validateEnforcementPaths({ repoRoot: root }), []);
    assert.equal(enforcementGlobRegex('agents/*/adapter.yaml').test('agents/codex/adapter.yaml'), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Enforcement validator reports missing exact paths and empty globs with source lines', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-enforcement-invalid-'));
  try {
    write(root, 'openspec/specs/demo/spec.md', [
      '# demo',
      'Enforcement: `harness/scripts/missing.ts`',
      'Enforcement: `profiles/*/harness/missing-*.ts`',
      'Enforcement: `removed.ts` `removedSymbol`',
    ].join('\n'));
    assert.deepEqual(validateEnforcementPaths({ repoRoot: root }), [
      {
        spec: 'openspec/specs/demo/spec.md',
        line: 2,
        reference: 'harness/scripts/missing.ts',
        kind: 'missing_path',
      },
      {
        spec: 'openspec/specs/demo/spec.md',
        line: 3,
        reference: 'profiles/*/harness/missing-*.ts',
        kind: 'glob_without_matches',
      },
      {
        spec: 'openspec/specs/demo/spec.md',
        line: 4,
        reference: 'removed.ts',
        kind: 'missing_path',
      },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
