import { extractUtItBlocks } from '../../scripts/utils/ut-it-blocks';
import type { UnitCaseResult } from './ut-artifact-validate.unit.test';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function testExtractsNamesAndBodies(): void {
  const blocks = extractUtItBlocks(`
    it('[AC-01] single', 0, () => {
      const nested = { ok: true };
      expect(nested.ok).assertTrue();
    });
    it(\`[BRANCH-error] template\`, 0, async () => {
      expect(false).assertFalse();
    });
  `);
  assert(blocks.length === 2, `expected 2 blocks, got ${blocks.length}`);
  assert(blocks[0].name === '[AC-01] single', blocks[0]?.name ?? 'missing first');
  assert(blocks[0].body.includes('nested = { ok: true }'), blocks[0].body);
  assert(blocks[1].name === '[BRANCH-error] template', blocks[1]?.name ?? 'missing second');
}

function testIgnoresIncompleteBlock(): void {
  const blocks = extractUtItBlocks("it('[AC-01] incomplete', 0, () => { expect(true)");
  assert(blocks.length === 0, `incomplete block must be ignored, got ${blocks.length}`);
}

export function runAll(): UnitCaseResult[] {
  const cases = [
    { name: 'extract names and balanced bodies', fn: testExtractsNamesAndBodies },
    { name: 'ignore incomplete it block', fn: testIgnoresIncompleteBlock },
  ];
  return cases.map(({ name, fn }) => {
    try {
      fn();
      return { name, ok: true };
    } catch (e) {
      return { name, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
