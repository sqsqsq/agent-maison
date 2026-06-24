// multimodal-probe.unit.test.ts — M3 image_input 探测与 goal footgun

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import YAML from 'yaml';

import {
  __resetMultimodalProbeWarningsForTest,
  probeAdapterImageInput,
  resolveContextAdapterImageInput,
  resolveGoalEffectiveImageInput,
} from '../../scripts/utils/multimodal-probe';
import {
  MAISON_GOAL_ALLOWED_TOOLS_ENV,
  MAISON_GOAL_RUNNER_ENV,
} from '../../scripts/utils/phase-state';
import { detectRepoLayout } from '../../repo-layout';
import type { UnitCaseResult } from '../run-unit';

const { projectRoot: REPO_ROOT, frameworkRoot: FRAMEWORK_ROOT } = detectRepoLayout(__dirname);

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function writeAdapter(root: string, name: string, extra: Record<string, unknown>): void {
  const dir = path.join(root, 'agents', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'adapter.yaml'),
    YAML.stringify({
      adapter_name: name,
      agent_entry_file: { target_path: 'AGENTS.md' },
      ...extra,
    }),
    'utf-8',
  );
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'cursor repo adapter → tool_read',
    run: () => {
      const r = probeAdapterImageInput(REPO_ROOT, FRAMEWORK_ROOT, 'cursor');
      assert(r.imageInput === 'tool_read', `expected tool_read got ${r.imageInput}`);
      assert(r.supported === true, 'supported');
    },
  },
  {
    name: 'chrys repo adapter → none',
    run: () => {
      const r = probeAdapterImageInput(REPO_ROOT, FRAMEWORK_ROOT, 'chrys');
      assert(r.imageInput === 'none', `expected none got ${r.imageInput}`);
    },
  },
  {
    name: 'deprecated multimodal:true → tool_read + stderr once',
    run: () => {
      __resetMultimodalProbeWarningsForTest();
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-probe-'));
      writeAdapter(tmp, 'legacy-mm', { multimodal: true });
      const r = probeAdapterImageInput(tmp, tmp, 'legacy-mm');
      assert(r.imageInput === 'tool_read', r.reason);
      assert(r.reason.includes('deprecated'), r.reason);
    },
  },
  {
    name: 'goal allowed_tools 缺 Read → 降级 none',
    run: () => {
      const r = resolveGoalEffectiveImageInput(REPO_ROOT, FRAMEWORK_ROOT, 'claude', {
        write_mode: 'accept-edits',
        approval_mode: 'never',
        allowed_tools: ['Bash', 'Edit'],
      });
      assert(r.imageInput === 'none', r.reason);
      assert(r.reason.includes('Read'), r.reason);
    },
  },
  {
    name: 'goal allowed_tools 含 Read → 保持 tool_read',
    run: () => {
      const r = resolveGoalEffectiveImageInput(REPO_ROOT, FRAMEWORK_ROOT, 'claude', {
        write_mode: 'accept-edits',
        approval_mode: 'never',
        allowed_tools: ['Bash', 'Read', 'Edit'],
      });
      assert(r.imageInput === 'tool_read', r.reason);
    },
  },
  {
    name: 'resolveContextAdapterImageInput goal env 缺 Read → none',
    run: () => {
      const prevRunner = process.env[MAISON_GOAL_RUNNER_ENV];
      const prevTools = process.env[MAISON_GOAL_ALLOWED_TOOLS_ENV];
      try {
        process.env[MAISON_GOAL_RUNNER_ENV] = '1';
        process.env[MAISON_GOAL_ALLOWED_TOOLS_ENV] = 'Bash,Edit';
        const r = resolveContextAdapterImageInput(REPO_ROOT, FRAMEWORK_ROOT, 'claude');
        assert(r.imageInput === 'none', r.reason);
      } finally {
        if (prevRunner === undefined) delete process.env[MAISON_GOAL_RUNNER_ENV];
        else process.env[MAISON_GOAL_RUNNER_ENV] = prevRunner;
        if (prevTools === undefined) delete process.env[MAISON_GOAL_ALLOWED_TOOLS_ENV];
        else process.env[MAISON_GOAL_ALLOWED_TOOLS_ENV] = prevTools;
      }
    },
  },
];

export function runAll(): Promise<UnitCaseResult[]> {
  return runMultimodalProbeUnitTests();
}

async function runMultimodalProbeUnitTests(): Promise<UnitCaseResult[]> {
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
  runMultimodalProbeUnitTests().then(r => {
    for (const x of r) console.log(x.ok ? 'PASS' : 'FAIL', x.name, x.error ?? '');
    process.exit(r.every(x => x.ok) ? 0 : 1);
  });
}
