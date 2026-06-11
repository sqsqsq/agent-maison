import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  isLegacyPhaseId,
  normalizeCheckId,
  normalizePhaseId,
  resetPhaseAliasWarnings,
} from '../../scripts/utils/phase-alias';
import { mergePhaseRuleSpec } from '../../profile-loader';
import { resolveReceiptFilePath } from '../../config';
import type { PhaseRuleSpec } from '../../scripts/utils/types';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'normalizePhaseId: prd → spec',
    run: () => {
      resetPhaseAliasWarnings();
      assert(normalizePhaseId('prd') === 'spec', 'prd alias');
      assert(isLegacyPhaseId('prd'), 'legacy');
    },
  },
  {
    name: 'normalizePhaseId: design → plan',
    run: () => {
      resetPhaseAliasWarnings();
      assert(normalizePhaseId('design') === 'plan', 'design alias');
    },
  },
  {
    name: 'normalizeCheckId: prd_file_exists → spec_file_exists',
    run: () => {
      assert(normalizeCheckId('prd_file_exists') === 'spec_file_exists', 'file exists alias');
    },
  },
  {
    name: 'normalizeCheckId: prd_p0_coverage → spec_p0_coverage',
    run: () => {
      resetPhaseAliasWarnings();
      assert(normalizeCheckId('prd_p0_coverage') === 'spec_p0_coverage', 'check alias');
      assert(normalizeCheckId('spec_p0_coverage') === 'spec_p0_coverage', 'canonical');
    },
  },
  {
    name: 'normalizeCheckId: plan 阶段 legacy check id → canonical',
    run: () => {
      resetPhaseAliasWarnings();
      assert(normalizeCheckId('design_file_exists') === 'plan_file_exists', 'plan file');
      assert(normalizeCheckId('prd_mapping_table') === 'spec_mapping_table', 'mapping table');
      assert(normalizeCheckId('design_to_architecture') === 'plan_to_architecture', 'architecture');
      assert(normalizeCheckId('design_to_code') === 'plan_to_code', 'coding trace');
      assert(normalizeCheckId('prd_acceptance_to_code') === 'spec_acceptance_to_code', 'acceptance');
    },
  },
  {
    name: 'mergePhaseRuleSpec: overlay 旧 check id 规范化为 canonical key',
    run: () => {
      const base: PhaseRuleSpec = {
        phase: 'spec',
        version: '1',
        applies_to: 'feature',
        structure_checks: {
          spec_p0_coverage: { description: 'base', severity: 'BLOCKER' },
        },
        semantic_checks: {},
        traceability_checks: {},
      };
      const merged = mergePhaseRuleSpec(base, {
        structure_checks: { prd_p0_coverage: { description: 'overlay', severity: 'MAJOR' } },
      });
      assert(merged.structure_checks?.spec_p0_coverage?.severity === 'MAJOR', 'overlay wins');
      assert(merged.structure_checks?.prd_p0_coverage === undefined, 'no legacy key');
    },
  },
  {
    name: 'mergePhaseRuleSpec: overlay phase prd 规范化为 spec',
    run: () => {
      const base = { phase: 'spec', version: '1.0' } as import('../../scripts/utils/types').PhaseRuleSpec;
      const merged = mergePhaseRuleSpec(base, { phase: 'prd' as unknown as 'spec' });
      assert(merged.phase === 'spec', 'overlay legacy phase normalized');
    },
  },
  {
    name: 'normalizePhaseId: 回执 frontmatter prd 与 CLI spec 等价',
    run: () => {
      resetPhaseAliasWarnings();
      const cliPhase = normalizePhaseId('spec');
      const fmPhase = normalizePhaseId('prd');
      assert(cliPhase === fmPhase, 'prd frontmatter matches spec CLI');
    },
  },
  {
    name: 'resolveReceiptFilePath: legacy prd 目录回退',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-legacy-'));
      const legacyDir = path.join(root, 'doc', 'features', 'f1', 'prd');
      fs.mkdirSync(legacyDir, { recursive: true });
      fs.writeFileSync(path.join(legacyDir, 'phase-completion-receipt.md'), '---\nfeature: f1\n---\n');
      const r = resolveReceiptFilePath(root, 'f1', 'spec');
      assert(r.usedLegacyDir, 'used legacy');
      assert(r.path.endsWith(`${path.sep}prd${path.sep}phase-completion-receipt.md`), 'legacy path');
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
