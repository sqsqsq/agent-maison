// single-writer-predicate.unit.test.ts — 无状态视觉反证回归

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildAgentSpawnEnv } from '../../scripts/utils/agent-invoke';
import { checkVisionOutputCounterevidence } from '../../scripts/check-spec';
import type { CheckContext } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';

const FEATURE = 'bc-openCard';
const cases: Array<{ name: string; run: () => void }> = [];
const test = (name: string, run: () => void): void => { cases.push({ name, run }); };
const assert = (condition: boolean, message: string): void => { if (!condition) throw new Error(message); };

function write(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

function withHost(run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-stateless-counterevidence-'));
  try {
    write(root, `doc/features/${FEATURE}/spec/ui-spec.yaml`, [
      'schema_version: "1.0"',
      'screens:',
      '  - id: add_card_home',
      '    priority: P0',
      '    ref_id: add_card_home',
      '    root:',
      '      id: root',
      '      type: navigation_frame',
      '      order: 0',
      '      children:',
      '        - id: hint_text',
      '          type: content_display',
      '          order: 0',
      '          text: "首页无映射文案"',
    ].join('\n'));
    write(root, `doc/features/${FEATURE}/spec/ref-elements.yaml`, [
      'schema_version: "1.0"',
      'elements:',
      '  - element_id: e1',
      '    screen_ref_id: add_card_home',
      '    text: "银行卡"',
    ].join('\n'));
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('反证检查只报告当前产物，不写 attestation/policy 状态', () => withHost((root) => {
  const result = checkVisionOutputCounterevidence({ projectRoot: root, feature: FEATURE } as CheckContext);
  assert(result.some((r) => r.details.includes('evidence_gap')), JSON.stringify(result));
  const visionDir = path.join(root, 'doc', 'features', FEATURE, 'vision');
  assert(!fs.existsSync(path.join(visionDir, 'artifact-attestations.jsonl')), '不得写 attestation ledger');
  assert(!fs.existsSync(path.join(visionDir, 'policy-downgrades.jsonl')), '不得写 policy ledger');
}));

test('遗留账本保持原样且不改变反证结论', () => withHost((root) => {
  const visionDir = path.join(root, 'doc', 'features', FEATURE, 'vision');
  fs.mkdirSync(visionDir, { recursive: true });
  const att = path.join(visionDir, 'artifact-attestations.jsonl');
  const down = path.join(visionDir, 'policy-downgrades.jsonl');
  fs.writeFileSync(att, 'legacy-att\n', 'utf-8');
  fs.writeFileSync(down, 'legacy-policy\n', 'utf-8');
  const before = checkVisionOutputCounterevidence({ projectRoot: root, feature: FEATURE } as CheckContext);
  const after = checkVisionOutputCounterevidence({ projectRoot: root, feature: FEATURE } as CheckContext);
  assert(JSON.stringify(before) === JSON.stringify(after), '同一产物的无状态判定应稳定');
  assert(fs.readFileSync(att, 'utf-8') === 'legacy-att\n', '遗留 attestation 不得改写');
  assert(fs.readFileSync(down, 'utf-8') === 'legacy-policy\n', '遗留 policy 不得改写');
}));

test('agent 子进程仍剥离 runner 权限与场外信任变量', () => {
  const env = buildAgentSpawnEnv({ PATH: process.env.PATH }, {
    MAISON_GOAL_GATE_HARNESS: '1',
    MAISON_HMAC_GOAL_CHECKPOINT: 'secret',
    MAISON_GOAL_CHECKPOINT_DIR: 'D:/outside',
  });
  assert(!Object.keys(env).some((key) => key.toUpperCase() === 'MAISON_GOAL_GATE_HARNESS'), '须剥离 gate 权限位');
  assert(!Object.keys(env).some((key) => key.toUpperCase().startsWith('MAISON_HMAC_')), '须剥离 HMAC');
  assert(!Object.keys(env).some((key) => key.toUpperCase() === 'MAISON_GOAL_CHECKPOINT_DIR'), '须剥离场外路径');
});

export function runAll(): UnitCaseResult[] {
  return cases.map((c) => {
    try { c.run(); return { name: c.name, ok: true }; }
    catch (error) { return { name: c.name, ok: false, error: (error as Error).stack ?? String(error) }; }
  });
}
