import {
  isLegacyCapabilityKey,
  normalizeCapabilityKey,
  normalizeCapabilitiesMap,
  resetCapabilityAliasWarnings,
} from '../../scripts/utils/capability-alias';

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
    name: 'normalizeCapabilityKey: prd.visual_handoff → spec.visual_handoff',
    run: () => {
      resetCapabilityAliasWarnings();
      assert(
        normalizeCapabilityKey('prd.visual_handoff') === 'spec.visual_handoff',
        'alias',
      );
      assert(isLegacyCapabilityKey('prd.visual_handoff'), 'legacy');
    },
  },
  {
    name: 'normalizeCapabilitiesMap: legacy key 迁入 canonical',
    run: () => {
      resetCapabilityAliasWarnings();
      const out = normalizeCapabilitiesMap({
        'prd.visual_handoff': { provider: 'script', severity: 'BLOCKER' },
      });
      assert(out['spec.visual_handoff']?.severity === 'BLOCKER', 'migrated');
      assert(out['prd.visual_handoff' as keyof typeof out] === undefined, 'no legacy key');
    },
  },
  {
    name: 'normalizeCapabilitiesMap: canonical 优先于 legacy',
    run: () => {
      resetCapabilityAliasWarnings();
      const out = normalizeCapabilitiesMap({
        'prd.visual_handoff': { provider: 'none', severity: 'SKIP' },
        'spec.visual_handoff': { provider: 'script', severity: 'BLOCKER' },
      });
      assert(out['spec.visual_handoff']?.severity === 'BLOCKER', 'canonical wins');
    },
  },
];

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
