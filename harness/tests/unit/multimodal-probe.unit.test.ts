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
  readCanaryOcrCapableSignal,
  isVisionCanaryFresh,
  isFreshInteractiveCanary,
  VISION_CANARY_INTERACTIVE_TTL_MS,
} from '../../scripts/utils/multimodal-probe';
import { writeLocalConfig } from '../../scripts/utils/framework-local-config';
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
  // ==========================================================================
  // E1（多模态降级阶梯 plan d4a8f3c6）：本地 override / 金丝雀缓存解析链最前
  // ==========================================================================
  {
    name: 'E1 resolveContextAdapterImageInput: local image_input_override 优先于 adapter 声明',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-probe-override-'));
      try {
        // chrys 真实声明是 none，override 应压过它判 tool_read。
        writeLocalConfig(tmp, { schema_version: '1.0', vision: { image_input_override: 'tool_read' } });
        const r = resolveContextAdapterImageInput(tmp, FRAMEWORK_ROOT, 'chrys');
        assert(r.imageInput === 'tool_read', r.reason);
        assert(r.reason.includes('image_input_override'), r.reason);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'E1 resolveContextAdapterImageInput: 金丝雀缓存（adapter 匹配）优先于 adapter 声明',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-probe-canary-'));
      try {
        writeLocalConfig(tmp, {
          schema_version: '1.0',
          vision: { canary: { adapter: 'chrys', verdict: 'tool_read', probed_at: '2026-07-08T00:00:00.000Z' } },
        });
        const r = resolveContextAdapterImageInput(tmp, FRAMEWORK_ROOT, 'chrys');
        assert(r.imageInput === 'tool_read', r.reason);
        assert(r.reason.includes('金丝雀实测缓存'), r.reason);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'E1 resolveContextAdapterImageInput: 缓存 adapter≠当前查询 adapter → 视为过期，回退真实声明',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-probe-stale-'));
      try {
        // 缓存记的是 claude 的探测结果，但当前查询的是 chrys —— adapter 变更即失效。
        writeLocalConfig(tmp, {
          schema_version: '1.0',
          vision: { canary: { adapter: 'claude', verdict: 'tool_read', probed_at: '2026-07-08T00:00:00.000Z' } },
        });
        const r = resolveContextAdapterImageInput(tmp, FRAMEWORK_ROOT, 'chrys');
        assert(r.imageInput === 'none', `应回退 chrys 真实声明 none，实得 ${r.imageInput}：${r.reason}`);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'E1 resolveContextAdapterImageInput: 无 local.json → 行为不变（回归保护）',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-probe-none-'));
      try {
        const r = resolveContextAdapterImageInput(tmp, FRAMEWORK_ROOT, 'chrys');
        assert(r.imageInput === 'none', r.reason);
        assert(!r.reason.includes('override') && !r.reason.includes('金丝雀'), r.reason);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'E1 readCanaryOcrCapableSignal: verdict=ocr_capable 且 adapter 匹配 → true；其余 → false',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-probe-ocrcap-'));
      try {
        writeLocalConfig(tmp, {
          schema_version: '1.0',
          vision: { canary: { adapter: 'chrys', verdict: 'ocr_capable', probed_at: '2026-07-08T00:00:00.000Z' } },
        });
        assert(readCanaryOcrCapableSignal(tmp, 'chrys') === true, '匹配 adapter + ocr_capable 应为 true');
        assert(readCanaryOcrCapableSignal(tmp, 'claude') === false, 'adapter 不匹配应为 false');
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
      const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-probe-ocrcap2-'));
      try {
        writeLocalConfig(tmp2, {
          schema_version: '1.0',
          vision: { canary: { adapter: 'chrys', verdict: 'tool_read', probed_at: '2026-07-08T00:00:00.000Z' } },
        });
        assert(readCanaryOcrCapableSignal(tmp2, 'chrys') === false, 'verdict=tool_read 不应报 ocr_capable');
      } finally {
        fs.rmSync(tmp2, { recursive: true, force: true });
      }
      assert(readCanaryOcrCapableSignal(fs.mkdtempSync(path.join(os.tmpdir(), 'mm-probe-nolocal-')), 'chrys') === false, '无 local.json 应为 false');
    },
  },
  // ==========================================================================
  // I2（交互式缓存新鲜度单点收口 plan b7e42d19）：isVisionCanaryFresh + 四条硬语义
  // ==========================================================================
  {
    name: 'I2 isVisionCanaryFresh: goal 来源（含缺省 probed_via）不受 TTL；interactive 超 24h → 不新鲜；adapter 不符/坏时间戳 → 不新鲜',
    run: () => {
      const now = 1_700_000_000_000;
      const old = new Date(now - VISION_CANARY_INTERACTIVE_TTL_MS - 1).toISOString();
      const recent = new Date(now - 60_000).toISOString();
      // goal 来源：即便很旧也新鲜（headless 模型稳定假设）
      assert(isVisionCanaryFresh({ adapter: 'chrys', verdict: 'tool_read', probed_at: old, probed_via: 'goal' }, 'chrys', now), 'goal 超龄仍新鲜');
      // 缺省 probed_via 视作 goal（向后兼容 E1 旧缓存）
      assert(isVisionCanaryFresh({ adapter: 'chrys', verdict: 'tool_read', probed_at: old }, 'chrys', now), '缺省 probed_via 视作 goal 不受 TTL');
      // interactive 新鲜/超龄
      assert(isVisionCanaryFresh({ adapter: 'chrys', verdict: 'tool_read', probed_at: recent, probed_via: 'interactive' }, 'chrys', now), 'interactive 未超龄应新鲜');
      assert(!isVisionCanaryFresh({ adapter: 'chrys', verdict: 'tool_read', probed_at: old, probed_via: 'interactive' }, 'chrys', now), 'interactive 超龄应不新鲜');
      // adapter 不符 / 坏时间戳 / 空
      assert(!isVisionCanaryFresh({ adapter: 'claude', verdict: 'tool_read', probed_at: recent, probed_via: 'interactive' }, 'chrys', now), 'adapter 不符不新鲜');
      assert(!isVisionCanaryFresh({ adapter: 'chrys', verdict: 'tool_read', probed_at: 'not-a-date', probed_via: 'interactive' }, 'chrys', now), '坏时间戳保守不新鲜');
      assert(!isVisionCanaryFresh(undefined, 'chrys', now), '无缓存不新鲜');
    },
  },
  {
    name: 'codex P1 isFreshInteractiveCanary: 仅新鲜 interactive → true；goal/缺省/超龄 interactive → false',
    run: () => {
      const now = 1_700_000_000_000;
      const recent = new Date(now - 60_000).toISOString();
      const old = new Date(now - VISION_CANARY_INTERACTIVE_TTL_MS - 1).toISOString();
      // 新鲜 interactive → true（唯一 SKIP 条件）
      assert(isFreshInteractiveCanary({ adapter: 'chrys', verdict: 'tool_read', probed_at: recent, probed_via: 'interactive' }, 'chrys', now), '新鲜 interactive 应 true');
      // goal 来源即便很新 → false（不得阻交互式当前会话实测——本条是 codex P1 核心）
      assert(!isFreshInteractiveCanary({ adapter: 'chrys', verdict: 'tool_read', probed_at: recent, probed_via: 'goal' }, 'chrys', now), 'goal 来源不得当交互式新鲜');
      // 缺省 probed_via（旧 E1 缓存，视作 goal）→ false
      assert(!isFreshInteractiveCanary({ adapter: 'chrys', verdict: 'tool_read', probed_at: recent }, 'chrys', now), '缺省 probed_via 不得当交互式新鲜');
      // 超龄 interactive → false
      assert(!isFreshInteractiveCanary({ adapter: 'chrys', verdict: 'tool_read', probed_at: old, probed_via: 'interactive' }, 'chrys', now), '超龄 interactive false');
      assert(!isFreshInteractiveCanary(undefined, 'chrys', now), '无缓存 false');
    },
  },
  {
    name: 'I2 ①②③ resolveContextAdapterImageInput: 超龄 interactive 缓存 → 回退声明式（chrys=none）+ staleInteractiveCanary + reason 标记',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-probe-i2stale-'));
      try {
        // interactive tool_read 缓存但超 24h：不得再贡献 tool_read，回退 chrys 真实声明 none
        writeLocalConfig(tmp, {
          schema_version: '1.0',
          vision: {
            canary: {
              adapter: 'chrys',
              verdict: 'tool_read',
              probed_at: new Date(Date.now() - VISION_CANARY_INTERACTIVE_TTL_MS - 3_600_000).toISOString(),
              probed_via: 'interactive',
            },
          },
        });
        const r = resolveContextAdapterImageInput(tmp, FRAMEWORK_ROOT, 'chrys');
        assert(r.imageInput === 'none', `超龄 interactive tool_read 应回退 none，实得 ${r.imageInput}`);
        assert(r.staleInteractiveCanary === true, 'staleInteractiveCanary 标记应为 true');
        assert(r.reason.includes('interactive_canary_stale'), r.reason);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'I2 resolveContextAdapterImageInput: 新鲜 interactive 缓存仍采信（tool_read）',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-probe-i2fresh-'));
      try {
        writeLocalConfig(tmp, {
          schema_version: '1.0',
          vision: {
            canary: {
              adapter: 'chrys',
              verdict: 'tool_read',
              probed_at: new Date(Date.now() - 60_000).toISOString(),
              probed_via: 'interactive',
            },
          },
        });
        const r = resolveContextAdapterImageInput(tmp, FRAMEWORK_ROOT, 'chrys');
        assert(r.imageInput === 'tool_read', `新鲜 interactive 缓存应采信 tool_read，实得 ${r.imageInput}`);
        assert(!r.staleInteractiveCanary, '新鲜不应标 stale');
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'I2 ④ readCanaryOcrCapableSignal: 超龄 interactive ocr_capable → false；新鲜 → true',
    run: () => {
      const stale = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-probe-i2ocr-stale-'));
      try {
        writeLocalConfig(stale, {
          schema_version: '1.0',
          vision: {
            canary: {
              adapter: 'chrys',
              verdict: 'ocr_capable',
              probed_at: new Date(Date.now() - VISION_CANARY_INTERACTIVE_TTL_MS - 3_600_000).toISOString(),
              probed_via: 'interactive',
            },
          },
        });
        assert(readCanaryOcrCapableSignal(stale, 'chrys') === false, '超龄 interactive ocr_capable 不得贡献');
      } finally {
        fs.rmSync(stale, { recursive: true, force: true });
      }
      const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-probe-i2ocr-fresh-'));
      try {
        writeLocalConfig(fresh, {
          schema_version: '1.0',
          vision: {
            canary: {
              adapter: 'chrys',
              verdict: 'ocr_capable',
              probed_at: new Date(Date.now() - 60_000).toISOString(),
              probed_via: 'interactive',
            },
          },
        });
        assert(readCanaryOcrCapableSignal(fresh, 'chrys') === true, '新鲜 interactive ocr_capable 应为 true');
      } finally {
        fs.rmSync(fresh, { recursive: true, force: true });
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
