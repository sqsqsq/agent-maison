// read-image-evidence.unit.test.ts — M3 读图证据块契约

import {
  parseReadImageEvidenceBlock,
  READ_IMAGE_EVIDENCE_FENCE,
} from '../../scripts/utils/read-image-evidence';
import {
  evaluateMultimodalEvidenceGate,
} from '../../scripts/utils/multimodal-evidence-gate';
import type { UnitCaseResult } from '../run-unit';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const VALID_BLOCK = `
Some report text

\`\`\`${READ_IMAGE_EVIDENCE_FENCE}
- file: 00-home.png
  observation: 红色品牌条 + 整行卡片
- file: 01-modal.png
  observation: 半模态两列布局
\`\`\`

verdict: PASS
`;

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'parse valid read-image-evidence block',
    run: () => {
      const r = parseReadImageEvidenceBlock(VALID_BLOCK);
      assert(r.ok, r.reason);
      assert(r.entries.length === 2, `entries=${r.entries.length}`);
      assert(r.entries[0].file === '00-home.png', r.entries[0].file);
    },
  },
  {
    name: 'missing block → not ok',
    run: () => {
      const r = parseReadImageEvidenceBlock('no evidence here');
      assert(!r.ok, 'should fail');
    },
  },
  {
    name: 'claude forceParse with valid block → PASS',
    run: () => {
      const g = evaluateMultimodalEvidenceGate({
        adapter: 'claude',
        imageInput: 'tool_read',
        verifierReportText: VALID_BLOCK,
        forceParse: true,
      });
      assert(g?.status === 'PASS', g?.details ?? 'null');
    },
  },
  {
    name: 'claude forceParse without block → WARN',
    run: () => {
      const g = evaluateMultimodalEvidenceGate({
        adapter: 'claude',
        imageInput: 'tool_read',
        verifierReportText: 'verdict only',
        forceParse: true,
      });
      assert(g?.status === 'WARN', g?.details ?? 'null');
      assert(g!.details.includes('未取得读图证据'), g!.details);
    },
  },
  {
    name: 'chrys non-force → SKIP prompt self-discipline',
    run: () => {
      const g = evaluateMultimodalEvidenceGate({
        adapter: 'chrys',
        imageInput: 'tool_read',
        verifierReportText: VALID_BLOCK,
        forceParse: false,
      });
      assert(g?.status === 'SKIP', g?.details ?? 'null');
    },
  },
  {
    name: 'image_input none → SKIP adapter unsupported',
    run: () => {
      const g = evaluateMultimodalEvidenceGate({
        adapter: 'generic',
        imageInput: 'none',
        forceParse: false,
      });
      assert(g?.status === 'SKIP', g?.details ?? 'null');
      assert(g!.details.includes('adapter 不支持'), g!.details);
    },
  },
];

export function runAll(): Promise<UnitCaseResult[]> {
  return runReadImageEvidenceUnitTests();
}

async function runReadImageEvidenceUnitTests(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

if (require.main === module) {
  runReadImageEvidenceUnitTests().then(r => {
    for (const x of r) console.log(x.ok ? 'PASS' : 'FAIL', x.name, x.error ?? '');
    process.exit(r.every(x => x.ok) ? 0 : 1);
  });
}
