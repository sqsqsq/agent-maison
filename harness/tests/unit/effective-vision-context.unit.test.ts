// effective-vision-context.unit.test.ts — 当前调用视觉能力的最小回归

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  capabilityReceiptPath,
  readCapabilityReceipt,
  resolveEffectiveVisionContext,
  writeCapabilityReceipt,
} from '../../scripts/utils/effective-vision-context';
import type { UnitCaseResult } from '../run-unit';

const cases: Array<{ name: string; run: () => void }> = [];
const test = (name: string, run: () => void): void => { cases.push({ name, run }); };
const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

function withTmp(run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-vision-current-'));
  try {
    fs.writeFileSync(
      path.join(root, 'framework.local.json'),
      JSON.stringify({
        schema_version: '1.0',
        agent_adapter: 'cursor',
        vision: { image_input_override: 'none' },
      }),
      'utf-8',
    );
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('当前 invocation receipt 精确匹配时直接证明 tool_read', () => withTmp((root) => {
  const written = writeCapabilityReceipt(root, 'f', {
    adapter: 'cursor',
    run_id: 'r1',
    invoke_id: 'i1',
    binding_path: 'inline_canary',
    verdict: 'tool_read',
    model: 'gpt-current',
  });
  assert(fs.existsSync(capabilityReceiptPath(root, 'f')), 'receipt 应落盘');
  assert(readCapabilityReceipt(root, 'f')?.invoke_id === written.invoke_id, 'receipt 应可读回');

  const ctx = resolveEffectiveVisionContext({
    projectRoot: root,
    feature: 'f',
    runId: 'r1',
    invokeId: 'i1',
    adapter: 'cursor',
    modelPin: 'gpt-current',
  });
  assert(ctx.vision_capability.verdict === 'tool_read', JSON.stringify(ctx));
  assert(ctx.vision_capability.scope === 'invocation_bound', JSON.stringify(ctx));
}));

test('过期或身份不匹配的 receipt 不复用，回到当前本地能力声明', () => withTmp((root) => {
  writeCapabilityReceipt(root, 'f', {
    adapter: 'cursor',
    run_id: 'old-run',
    invoke_id: 'old-invoke',
    binding_path: 'route_equality',
    verdict: 'tool_read',
  });
  const ctx = resolveEffectiveVisionContext({
    projectRoot: root,
    feature: 'f',
    runId: 'new-run',
    invokeId: 'new-invoke',
    adapter: 'cursor',
  });
  assert(ctx.vision_capability.verdict === 'none', JSON.stringify(ctx));
  assert(ctx.vision_capability.scope === 'run_probed', JSON.stringify(ctx));
}));

test('遗留 attestation/policy 文件无论内容如何都不影响当前能力', () => withTmp((root) => {
  writeCapabilityReceipt(root, 'f', {
    adapter: 'cursor',
    run_id: 'r1',
    invoke_id: 'i1',
    binding_path: 'inline_canary',
    verdict: 'tool_read',
  });
  const before = resolveEffectiveVisionContext({
    projectRoot: root, feature: 'f', runId: 'r1', invokeId: 'i1', adapter: 'cursor',
  });
  const visionDir = path.dirname(capabilityReceiptPath(root, 'f'));
  fs.writeFileSync(path.join(visionDir, 'artifact-attestations.jsonl'), '{broken legacy data\n', 'utf-8');
  fs.writeFileSync(path.join(visionDir, 'policy-downgrades.jsonl'), '{"mode":"blind_safe"}\n', 'utf-8');
  const after = resolveEffectiveVisionContext({
    projectRoot: root, feature: 'f', runId: 'r1', invokeId: 'i1', adapter: 'cursor',
  });
  assert(before.vision_capability.verdict === 'tool_read', JSON.stringify(before));
  assert(after.vision_capability.verdict === 'tool_read', JSON.stringify(after));
  assert(after.vision_capability.scope === 'invocation_bound', JSON.stringify(after));
}));

export function runAll(): UnitCaseResult[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (error) {
      return { name: c.name, ok: false, error: (error as Error).stack ?? String(error) };
    }
  });
}
