// ============================================================================
// blind-crop-prohibition.unit.test.ts — blind-visual-hardening d2 / P0-B①
// ============================================================================
// 事故回放：bc-openCard 二轮 22 项 acquisition:crop 全部 human_crop_confirmed:false
// 且零验真——盲模型"声明了自己永远做不了的动作"，coding 期物化空白占位。
// 锁定：禁令收窄语义（codex 三轮③）——禁执行/自证，不禁消费可信产物（c1-c3 放行）。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache, featureFilePath } from '../../config';
import { checkBlindCropProhibition } from '../../scripts/check-spec';
import type { CheckContext } from '../../scripts/utils/types';
import { ensureConsumerFrameworkTree } from '../utils/layout-test-helper';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assertTrue(cond: boolean, label: string): void {
  if (!cond) throw new Error(label);
}

function assertEq(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
  }
}

async function withTmpProject<T>(fn: (root: string) => T | Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blind-crop-'));
  ensureConsumerFrameworkTree(dir);
  clearFrameworkConfigCache();
  try {
    return await fn(dir);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function ctx(root: string, imageInput: 'none' | 'tool_read'): CheckContext {
  return {
    phase: 'spec',
    feature: 'demo',
    projectRoot: root,
    adapterImageInput: imageInput,
  } as unknown as CheckContext;
}

function writeUiSpec(root: string, assetsYaml: string): void {
  const p = featureFilePath(root, 'demo', path.join('spec', 'ui-spec.yaml'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, ['schema_version: "1.0"', 'screens: []', 'tokens: {}', 'assets:', assetsYaml, ''].join('\n'), 'utf-8');
}

const cases: Array<{ name: string; run: () => void | Promise<void> }> = [
  {
    name: '非盲（tool_read）→ 门禁不适用 PASS',
    run: async () => withTmpProject(async root => {
      writeUiSpec(root, '  - key: bank_logo_icbc\n    acquisition: crop');
      const [r] = checkBlindCropProhibition(ctx(root, 'tool_read'));
      assertEq(r.status, 'PASS', 'status');
    }),
  },
  {
    name: '事故回放：盲档 + crop 无任何验真/授权 → BLOCKER FAIL 点名 key 与缺失条件',
    run: async () => withTmpProject(async root => {
      writeUiSpec(root, [
        '  - key: bank_logo_icbc',
        '    acquisition: crop',
        '    human_crop_confirmed: false',
        '  - key: bank_logo_cmb',
        '    acquisition: crop',
      ].join('\n'));
      const [r] = checkBlindCropProhibition(ctx(root, 'none'));
      assertEq(r.status, 'FAIL', 'status');
      assertEq(r.severity, 'BLOCKER', 'severity');
      assertTrue(r.details.includes('bank_logo_icbc') && r.details.includes('bank_logo_cmb'), '点名全部违例 key');
      assertEq(r.failure_kind, 'blind_crop_prohibited', 'failure_kind');
    }),
  },
  {
    name: '可信消费态放行：resolved_path + external_tool provenance（source_sha256 命中真实参考图）+ 真人确认 → PASS；自填假 sha → FAIL（cursor P2 收紧）',
    run: async () => withTmpProject(async root => {
      const rel = 'doc/features/demo/spec/assets/bank_logo_icbc.png';
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, 'png-bytes', 'utf-8');
      // 真实参考图（ux-reference）——external_tool 的 source_sha256 必须命中其字节哈希
      const refAbs = path.join(root, 'doc/features/demo/ux-reference/ref-shot.png');
      fs.mkdirSync(path.dirname(refAbs), { recursive: true });
      fs.writeFileSync(refAbs, 'ref-image-bytes', 'utf-8');
      const crypto = await import('crypto');
      const refSha = crypto.createHash('sha256').update(fs.readFileSync(refAbs)).digest('hex');
      const spec = (sha: string): string => [
        '  - key: bank_logo_icbc',
        '    acquisition: crop',
        `    resolved_path: ${rel}`,
        '    human_crop_confirmed: true',
        '    crop_confirmed_by: 张工',
        '    crop_provenance:',
        '      kind: external_tool',
        '      tool: figma-export',
        `      source_sha256: ${sha}`,
      ].join('\n');
      writeUiSpec(root, spec(refSha));
      const [ok] = checkBlindCropProhibition(ctx(root, 'none'));
      assertEq(ok.status, 'PASS', `命中真实参考图应放行（${ok.details}）`);
      writeUiSpec(root, spec('a'.repeat(64)));
      const [bad] = checkBlindCropProhibition(ctx(root, 'none'));
      assertEq(bad.status, 'FAIL', '自填假 sha 不得构成 provenance');
    }),
  },
  {
    name: 'user_requirement 哨兵不算条目级验真：其余条件齐备仍 FAIL（c3）',
    run: async () => withTmpProject(async root => {
      const rel = 'doc/features/demo/spec/assets/k.png';
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, 'x', 'utf-8');
      writeUiSpec(root, [
        '  - key: k',
        '    acquisition: crop',
        `    resolved_path: ${rel}`,
        '    human_crop_confirmed: true',
        '    crop_confirmed_by: user_requirement',
        '    crop_provenance:',
        '      kind: external_tool',
        '      tool: t',
        `      source_sha256: ${'b'.repeat(64)}`,
      ].join('\n'));
      const [r] = checkBlindCropProhibition(ctx(root, 'none'));
      assertEq(r.status, 'FAIL', 'status');
      assertTrue(r.details.includes('c3'), '应命中 c3');
    }),
  },
  {
    name: 'verified_artifact 通道：asset-crop-validation.json verdict=verified + 真人确认 + resolved_path → PASS',
    run: async () => withTmpProject(async root => {
      const rel = 'doc/features/demo/spec/assets/k2.png';
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, 'x', 'utf-8');
      const vPath = featureFilePath(root, 'demo', path.join('spec', 'reports', 'asset-crop-validation.json'));
      fs.mkdirSync(path.dirname(vPath), { recursive: true });
      fs.writeFileSync(vPath, JSON.stringify({ entries: { k2: { verdict: 'verified' } } }), 'utf-8');
      writeUiSpec(root, [
        '  - key: k2',
        '    acquisition: crop',
        `    resolved_path: ${rel}`,
        '    human_crop_confirmed: true',
        '    crop_confirmed_by: 李工',
      ].join('\n'));
      const [r] = checkBlindCropProhibition(ctx(root, 'none'));
      assertEq(r.status, 'PASS', `status（${r.details}）`);
    }),
  },
  {
    name: '无 crop 资产（placeholder/repo_assets）→ PASS 不受约束',
    run: async () => withTmpProject(async root => {
      writeUiSpec(root, '  - key: p1\n    acquisition: placeholder\n    placeholder: true');
      const [r] = checkBlindCropProhibition(ctx(root, 'none'));
      assertEq(r.status, 'PASS', 'status');
    }),
  },
];

export function runAll(): Promise<UnitCaseResult[]> {
  return (async () => {
    const out: UnitCaseResult[] = [];
    for (const c of cases) {
      try {
        await c.run();
        out.push({ name: c.name, ok: true });
      } catch (err) {
        out.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
      }
    }
    return out;
  })();
}
