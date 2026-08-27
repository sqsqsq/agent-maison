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
    name: 'external_tool provenance 与 legacy 人签不能代替本 invocation 机器验真 → FAIL',
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
      assertEq(ok.status, 'FAIL', `只有 external_tool 与人签不得放行（${ok.details}）`);
      assertTrue(ok.details.includes('c3'), '应指明缺当前 invocation 机器验真');
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
    name: 'verified_artifact 通道：当前 provider 执行 + hash/path 绑定 → PASS，legacy 人签字段无权威',
    run: async () => withTmpProject(async root => {
      const rel = 'doc/features/demo/spec/assets/k2.png';
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, 'x', 'utf-8');
      const vPath = featureFilePath(root, 'demo', path.join('spec', 'reports', 'asset-crop-validation.json'));
      fs.mkdirSync(path.dirname(vPath), { recursive: true });
      // post-impl5 P1-1 契约更新：c2 的 verified 通道同样要求绑定复验——verdict-only
      // 报告（旧形态）不再构成 provenance（伪造/陈旧报告曾借此过 c2）。
      const k2Sha = require('crypto').createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
      fs.writeFileSync(vPath, JSON.stringify({
        entries: { k2: { verdict: 'verified', sha256: k2Sha, resolved_path: rel } },
      }), 'utf-8');
      writeUiSpec(root, [
        '  - key: k2',
        '    acquisition: crop',
        `    resolved_path: ${rel}`,
        '    human_crop_confirmed: true',
        '    crop_confirmed_by: 李工',
      ].join('\n'));
      const c = ctx(root, 'none');
      (c as { assetAcquisitionProviderRan?: boolean }).assetAcquisitionProviderRan = true;
      const [r] = checkBlindCropProhibition(c);
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
  {
    name: 'post-impl3 P0-1：逐项 fallback（crop+placeholder:true）不进盲档禁令 → PASS（防循环卡死）',
    run: async () => withTmpProject(async root => {
      writeUiSpec(root, [
        '  - key: fb1',
        '    acquisition: crop',
        '    placeholder: true', // 验真失败后的逐项 fallback 形态（prompt 指引产物）
      ].join('\n'));
      const [r] = checkBlindCropProhibition(ctx(root, 'none'));
      assertEq(r.status, 'PASS', `fallback 不得再被当 crop 打回（${r.details}）`);
    }),
  },
  // ---- plan f6b2d9a4 T4：机器验真免 c3（本 invocation provider 执行 + 绑定复验）----
  {
    name: 'f6b2d9a4: provider 本 invocation 执行 + verified + 绑定复验有效 → 免 c3 不求人',
    run: async () => withTmpProject(async root => {
      const rel = 'doc/features/demo/spec/assets/k3.png';
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
      const sha = require('crypto').createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
      const vPath = featureFilePath(root, 'demo', path.join('spec', 'reports', 'asset-crop-validation.json'));
      fs.mkdirSync(path.dirname(vPath), { recursive: true });
      fs.writeFileSync(vPath, JSON.stringify({
        entries: { k3: { verdict: 'verified', sha256: sha, resolved_path: rel } },
      }), 'utf-8');
      writeUiSpec(root, [
        '  - key: k3',
        '    acquisition: crop',
        `    resolved_path: ${rel}`,
        // 注意：无 human_crop_confirmed——机器验真路径免 c3
      ].join('\n'));
      const c = ctx(root, 'none');
      (c as { assetAcquisitionProviderRan?: boolean }).assetAcquisitionProviderRan = true;
      const [r] = checkBlindCropProhibition(c);
      assertEq(r.status, 'PASS', `免 c3 放行（${r.details}）`);
    }),
  },
  {
    name: 'f6b2d9a4: agent 预写 verified 报告 + provider skipped → 不获豁免仍 FAIL（伪造 fixture）',
    run: async () => withTmpProject(async root => {
      const rel = 'doc/features/demo/spec/assets/k4.png';
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, Buffer.from([0x89, 0x50, 0x4e, 0x47, 9]));
      const sha = require('crypto').createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
      const vPath = featureFilePath(root, 'demo', path.join('spec', 'reports', 'asset-crop-validation.json'));
      fs.mkdirSync(path.dirname(vPath), { recursive: true });
      // 字段齐全的「假 verified」——磁盘报告自称不构成豁免（v7 P1-2 可执行判据）
      fs.writeFileSync(vPath, JSON.stringify({
        entries: { k4: { verdict: 'verified', sha256: sha, resolved_path: rel } },
      }), 'utf-8');
      writeUiSpec(root, ['  - key: k4', '    acquisition: crop', `    resolved_path: ${rel}`].join('\n'));
      const c = ctx(root, 'none'); // assetAcquisitionProviderRan 未置位 = provider skip/throw
      const [r] = checkBlindCropProhibition(c);
      assertEq(r.status, 'FAIL', '预写报告不豁免——回落占位+债务/问人路线');
      assertTrue(/c3/.test(r.details), '点名 c3 缺失');
    }),
  },
  {
    name: 'f6b2d9a4: provider 执行但绑定失配（产物被换）→ 不豁免 FAIL',
    run: async () => withTmpProject(async root => {
      const rel = 'doc/features/demo/spec/assets/k5.png';
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, Buffer.from([0x89, 0x50, 0x4e, 0x47, 7]));
      const vPath = featureFilePath(root, 'demo', path.join('spec', 'reports', 'asset-crop-validation.json'));
      fs.mkdirSync(path.dirname(vPath), { recursive: true });
      fs.writeFileSync(vPath, JSON.stringify({
        entries: { k5: { verdict: 'verified', sha256: 'f'.repeat(64), resolved_path: rel } },
      }), 'utf-8');
      writeUiSpec(root, ['  - key: k5', '    acquisition: crop', `    resolved_path: ${rel}`].join('\n'));
      const c = ctx(root, 'none');
      (c as { assetAcquisitionProviderRan?: boolean }).assetAcquisitionProviderRan = true;
      const [r] = checkBlindCropProhibition(c);
      assertEq(r.status, 'FAIL', '绑定失配不豁免');
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
