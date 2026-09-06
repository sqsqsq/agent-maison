// effective-vision-context.unit.test.ts — 当前 run 视觉能力的最小回归
// plan 8d2b4f60 D1：invoke 级 capability receipt 全链已删除；能力真值只有两级
//（run 级 probe 金丝雀 / adapter 声明），override 是用户自我声明、**不是实测来源**。

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveEffectiveVisionContext } from '../../scripts/utils/effective-vision-context';
import { VISION_CANARY_PROBE_VERSION } from '../../scripts/utils/vision-canary';
import type { UnitCaseResult } from '../run-unit';

const cases: Array<{ name: string; run: () => void }> = [];
const test = (name: string, run: () => void): void => { cases.push({ name, run }); };
const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

function withTmp(vision: Record<string, unknown>, run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-vision-current-'));
  try {
    fs.writeFileSync(
      path.join(root, 'framework.local.json'),
      JSON.stringify({ schema_version: '1.0', agent_adapter: 'cursor', vision }),
      'utf-8',
    );
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const freshCanary = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  adapter: 'cursor',
  verdict: 'tool_read',
  probed_at: new Date().toISOString(),
  probe_version: VISION_CANARY_PROBE_VERSION,
  probed_via: 'goal',
  run_id: 'r1',
  ...over,
});

test('本 run probe 金丝雀 → run_probed 且 evidence.canary_probed_at 在场（来源=probe）', () =>
  withTmp({ canary: freshCanary() }, (root) => {
    const ctx = resolveEffectiveVisionContext({
      projectRoot: root, feature: 'f', runId: 'r1', adapter: 'cursor',
    });
    assert(ctx.vision_capability.verdict === 'tool_read', JSON.stringify(ctx));
    assert(ctx.vision_capability.scope === 'run_probed', JSON.stringify(ctx));
    assert(typeof ctx.vision_capability.evidence.canary_probed_at === 'string', JSON.stringify(ctx));
  }));

test('image_input_override 在场 → run_probed 但**无** canary_probed_at（用户声明不是实测）', () =>
  withTmp({ image_input_override: 'tool_read' }, (root) => {
    const ctx = resolveEffectiveVisionContext({
      projectRoot: root, feature: 'f', runId: 'r1', adapter: 'cursor',
    });
    assert(ctx.vision_capability.scope === 'run_probed', JSON.stringify(ctx));
    assert(ctx.vision_capability.evidence.canary_probed_at === undefined, JSON.stringify(ctx));
  }));

test('override 分支先于 canary 返回：即便盘上有本 run 有效金丝雀，来源判据仍非 probe', () =>
  withTmp({ image_input_override: 'tool_read', canary: freshCanary() }, (root) => {
    const ctx = resolveEffectiveVisionContext({
      projectRoot: root, feature: 'f', runId: 'r1', adapter: 'cursor',
    });
    assert(ctx.vision_capability.scope === 'run_probed', JSON.stringify(ctx));
    assert(ctx.vision_capability.evidence.canary_probed_at === undefined,
      `override 分支不读 canary，canary_probed_at 必缺席：${JSON.stringify(ctx)}`);
  }));

test('属旧 run 的金丝雀不可采信 → 回落 adapter 声明', () =>
  withTmp({ canary: freshCanary({ run_id: 'old-run' }) }, (root) => {
    const ctx = resolveEffectiveVisionContext({
      projectRoot: root, feature: 'f', runId: 'new-run', adapter: 'cursor',
    });
    assert(ctx.vision_capability.scope === 'adapter_declared', JSON.stringify(ctx));
    assert(ctx.vision_capability.evidence.canary_probed_at === undefined, JSON.stringify(ctx));
  }));

test('遗留 vision 目录文件无论内容如何都不影响当前能力', () =>
  withTmp({ canary: freshCanary() }, (root) => {
    const before = resolveEffectiveVisionContext({
      projectRoot: root, feature: 'f', runId: 'r1', adapter: 'cursor',
    });
    const visionDir = path.join(root, 'doc', 'features', 'f', 'vision');
    fs.mkdirSync(visionDir, { recursive: true });
    fs.writeFileSync(path.join(visionDir, 'artifact-attestations.jsonl'), '{broken legacy data\n', 'utf-8');
    fs.writeFileSync(path.join(visionDir, 'policy-downgrades.jsonl'), '{"mode":"blind_safe"}\n', 'utf-8');
    // plan 8d2b4f60 V8：旧 capability-receipt.json 残留已无任何消费者
    fs.writeFileSync(path.join(visionDir, 'capability-receipt.json'),
      JSON.stringify({ schema_version: '1.0', invoke_id: 'spec-1', binding_path: 'inline_canary', verdict: 'tool_read' }), 'utf-8');
    const after = resolveEffectiveVisionContext({
      projectRoot: root, feature: 'f', runId: 'r1', adapter: 'cursor',
    });
    assert(before.vision_capability.verdict === 'tool_read', JSON.stringify(before));
    assert(after.vision_capability.verdict === 'tool_read', JSON.stringify(after));
    assert(after.vision_capability.scope === 'run_probed', JSON.stringify(after));
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
