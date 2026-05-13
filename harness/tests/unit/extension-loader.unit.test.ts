// ============================================================================
// extension-loader.unit.test.ts
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  loadInstanceExtensions,
  applyInstanceExtensions,
} from '../../extension-loader';
import type { HarnessResolvedProfile } from '../../scripts/utils/types';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ext-load-'));
}

function write(p: string, content: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

function baseResolved(): HarnessResolvedProfile {
  return {
    name: 'unit-profile',
    profileDir: '/tmp/no-such-profile',
    yaml: { name: 'unit-profile' },
    phasesDisabled: new Set(),
    capabilities: {
      'coding.compile': { provider: 'hvigor', severity: 'BLOCKER' },
    },
  };
}

interface Case {
  name: string;
  run: () => void;
}

const cases: Case[] = [
  {
    name: '无 doc/extensions 目录 → rootDir=null',
    run: () => {
      const dir = mkTmp();
      const b = loadInstanceExtensions(dir);
      assert(b.rootDir === null, 'rootDir');
      assert(b.errors.length === 0, 'errors');
      assert(b.skills.length === 0, 'skills');
    },
  },
  {
    name: '有扩展目录但无 manifest.yaml → 空 provides',
    run: () => {
      const dir = mkTmp();
      fs.mkdirSync(path.join(dir, 'doc', 'extensions'), { recursive: true });
      const b = loadInstanceExtensions(dir);
      assert(b.rootDir !== null, 'rootDir set');
      assert(b.manifestPath === null, 'manifest');
      assert(b.skills.length === 0 && b.errors.length === 0, 'clean');
    },
  },
  {
    name: 'manifest name 非法类型 → errors + provides 清空',
    run: () => {
      const dir = mkTmp();
      const root = path.join(dir, 'doc', 'extensions');
      fs.mkdirSync(root, { recursive: true });
      write(path.join(root, 'manifest.yaml'), 'schema_version: "1.0"\nname: 123\n');
      const b = loadInstanceExtensions(dir);
      assert(b.errors.some(e => e.code === 'manifest_name'), 'manifest_name');
      assert(b.skills.length === 0, 'wiped skills');
    },
  },
  {
    name: '合法 manifest → skills / knowledge / hooks / capability / overlay 路径生效',
    run: () => {
      const dir = mkTmp();
      const root = path.join(dir, 'doc', 'extensions');
      fs.mkdirSync(path.join(root, 'knowledge'), { recursive: true });
      write(path.join(root, 'knowledge', 'x.md'), '# x');
      fs.mkdirSync(path.join(root, 'hooks', 'catalog'), { recursive: true });
      write(path.join(root, 'hooks', 'catalog', 'pre_phase.mjs'), 'export default async () => ({})');
      write(path.join(root, 'caps', 'p.ts'), 'export const x = 1;\n');
      write(
        path.join(root, 'overlay', 'coding-rules.overlay.yaml'),
        [
          'phase: coding',
          'version: "9"',
          'applies_to: test',
          'structure_checks: {}',
          'semantic_checks: {}',
          'traceability_checks: {}',
        ].join('\n'),
      );
      write(
        path.join(root, 'manifest.yaml'),
        [
          'schema_version: "1.0"',
          'name: demo-ext',
          'provides:',
          '  skills: [ my-skill ]',
          '  knowledge: [ knowledge/x.md ]',
          '  hooks:',
          '    catalog:',
          '      pre_phase: [ hooks/catalog/pre_phase.mjs ]',
          '  capabilities:',
          '    business.x:',
          '      provider: caps/p.ts',
          '      severity: MAJOR',
          '  phase_rules_overlays:',
          '    coding: overlay/coding-rules.overlay.yaml',
        ].join('\n'),
      );
      const b = loadInstanceExtensions(dir);
      assert(b.errors.length === 0, JSON.stringify(b.errors));
      assert(b.skills.includes('my-skill'), 'skills');
      assert(b.knowledgePaths.some(p => p.endsWith(`${path.sep}x.md`)), 'knowledge');
      assert(b.hooks.catalog?.pre_phase?.length === 1, 'hooks');
      const pr = b.extensionCapabilities['business.x']?.provider;
      assert(pr !== undefined && pr.endsWith(`${path.sep}p.ts`), 'cap');
      assert(b.phaseRuleOverlayPaths.coding?.includes('coding-rules.overlay.yaml'), 'overlay');
    },
  },
  {
    name: 'phase_rules_overlay 指向缺失文件 → errors + provides 清空',
    run: () => {
      const dir = mkTmp();
      const root = path.join(dir, 'doc', 'extensions');
      fs.mkdirSync(root, { recursive: true });
      write(
        path.join(root, 'manifest.yaml'),
        [
          'schema_version: "1.0"',
          'name: bad-overlay',
          'provides:',
          '  phase_rules_overlays:',
          '    coding: missing.yaml',
        ].join('\n'),
      );
      const b = loadInstanceExtensions(dir);
      assert(b.errors.some(e => e.code === 'overlay_missing'), 'overlay_missing');
      assert(b.phaseRuleOverlayPaths.coding === undefined, 'wiped');
    },
  },
  {
    name: 'applyInstanceExtensions：extension capability 覆盖 profile 同名 key',
    run: () => {
      const dir = mkTmp();
      const root = path.join(dir, 'doc', 'extensions');
      fs.mkdirSync(path.join(root, 'caps'), { recursive: true });
      write(path.join(root, 'caps', 'override.ts'), 'export const z = 1;\n');
      write(
        path.join(root, 'manifest.yaml'),
        [
          'schema_version: "1.0"',
          'name: cap-override',
          'provides:',
          '  capabilities:',
          '    coding.compile:',
          '      provider: caps/override.ts',
          '      severity: SKIP',
        ].join('\n'),
      );
      const resolved = applyInstanceExtensions(baseResolved(), dir);
      assert(resolved.capabilities['coding.compile']?.severity === 'SKIP', 'override severity');
      const prov = resolved.capabilities['coding.compile']?.provider;
      assert(prov !== undefined && prov.includes('override.ts'), 'override path');
    },
  },
  {
    name: 'manifest 校验失败时不合并 capability（保留 profile 原值）',
    run: () => {
      const dir = mkTmp();
      const root = path.join(dir, 'doc', 'extensions');
      fs.mkdirSync(root, { recursive: true });
      write(
        path.join(root, 'manifest.yaml'),
        [
          'schema_version: "1.0"',
          'name: bad',
          'provides:',
          '  capabilities:',
          '    coding.compile:',
          '      provider: missing.ts',
          '      severity: MAJOR',
        ].join('\n'),
      );
      const resolved = applyInstanceExtensions(baseResolved(), dir);
      assert(resolved.extensionBundle!.errors.length > 0, 'errors');
      assert(resolved.capabilities['coding.compile']?.provider === 'hvigor', 'profile kept');
    },
  },
  {
    name: '自定义 paths.extension_dir：相对实例根解析',
    run: () => {
      const dir = mkTmp();
      const alt = path.join(dir, 'my-ext');
      fs.mkdirSync(alt, { recursive: true });
      write(path.join(alt, 'manifest.yaml'), 'schema_version: "1.0"\nname: alt-root\n');
      const b = loadInstanceExtensions(dir, 'my-ext');
      assert(b.manifestPath !== null && b.manifestPath.includes('my-ext'), 'manifest path');
      assert(b.errors.length === 0, 'valid');
    },
  },
];

export function runAll(): UnitCaseResult[] {
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
