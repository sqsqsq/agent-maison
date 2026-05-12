// ============================================================================
// hooks-dispatcher.unit.test.ts
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  collectHookSlots,
  dispatchLifecycleHooks,
} from '../../hooks-dispatcher';
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hook-disp-'));
}

function write(p: string, content: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

function resolved(profileDir: string, bundle?: HarnessResolvedProfile['extensionBundle']): HarnessResolvedProfile {
  return {
    name: 't-profile',
    profileDir,
    yaml: { name: 't-profile' },
    phasesDisabled: new Set(),
    capabilities: {},
    extensionBundle: bundle,
  };
}

interface Case {
  name: string;
  run: () => void | Promise<void>;
}

const cases: Case[] = [
  {
    name: 'hooks disabled → 空结果',
    async run() {
      const dir = mkTmp();
      const harnessRoot = path.join(dir, 'harness');
      write(path.join(harnessRoot, 'hooks', 'catalog', 'pre_phase.md'), 'x');
      const r = await dispatchLifecycleHooks(
        harnessRoot,
        'pre_phase',
        {
          projectRoot: dir,
          phase: 'catalog',
          feature: '_global',
          resolvedProfileName: 't-profile',
          hookEvent: 'pre_phase',
        },
        resolved(dir),
        { enabled: false },
      );
      assert(r.promptFragments.length === 0 && r.hookCheckResults.length === 0, 'empty');
    },
  },
  {
    name: '.md hook → promptFragments',
    async run() {
      const dir = mkTmp();
      const harnessRoot = path.join(dir, 'harness');
      write(path.join(harnessRoot, 'hooks', 'catalog', 'pre_phase.md'), '# Hello MD');
      const r = await dispatchLifecycleHooks(
        harnessRoot,
        'pre_phase',
        {
          projectRoot: dir,
          phase: 'catalog',
          feature: '_global',
          resolvedProfileName: 't-profile',
          hookEvent: 'pre_phase',
        },
        resolved(dir),
        {},
      );
      assert(r.promptFragments.some(f => f.includes('Hello MD')), 'fragment');
      assert(r.hookCheckResults.length === 0, 'no fails');
    },
  },
  {
    name: '.mjs hook stdout JSON promptFragments',
    async run() {
      const dir = mkTmp();
      const harnessRoot = path.join(dir, 'harness');
      write(
        path.join(harnessRoot, 'hooks', 'catalog', 'pre_phase.mjs'),
        'export default async () => ({ promptFragments: ["from-mjs"] });',
      );
      const r = await dispatchLifecycleHooks(
        harnessRoot,
        'pre_phase',
        {
          projectRoot: dir,
          phase: 'catalog',
          feature: '_global',
          resolvedProfileName: 't-profile',
          hookEvent: 'pre_phase',
        },
        resolved(dir),
        {},
      );
      assert(r.promptFragments.some(f => f.includes('from-mjs')), JSON.stringify(r));
    },
  },
  {
    name: 'collectHookSlots：framework → profile → extension 顺序',
    async run() {
      const dir = mkTmp();
      const harnessRoot = path.join(dir, 'harness');
      const profDir = path.join(dir, 'profile');
      write(path.join(harnessRoot, 'hooks', 'catalog', 'pre_phase.md'), 'fw');
      write(path.join(profDir, 'hooks', 'catalog', 'pre_phase.md'), 'prof');
      const absExt = path.join(dir, 'ext-hook.md');
      write(absExt, 'ext');
      const bundle: HarnessResolvedProfile['extensionBundle'] = {
        rootDir: dir,
        manifestPath: null,
        skills: [],
        knowledgePaths: [],
        hooks: { catalog: { pre_phase: [absExt] } },
        extensionCapabilities: {},
        phaseRuleOverlayPaths: {},
        errors: [],
      };
      const slots = collectHookSlots(harnessRoot, 'catalog', 'pre_phase', resolved(profDir, bundle));
      assert(slots.length === 3, String(slots.length));
      assert(slots[0]!.source === 'framework', 'fw first');
      assert(slots[1]!.source === 'profile', 'prof second');
      assert(slots[2]!.source === 'extension', 'ext third');
    },
  },
  {
    name: 'framework .mjs 抛错 → BLOCKER FAIL',
    async run() {
      const dir = mkTmp();
      const harnessRoot = path.join(dir, 'harness');
      write(
        path.join(harnessRoot, 'hooks', 'catalog', 'pre_phase.mjs'),
        'export default async () => { throw new Error("boom-fw"); };',
      );
      const r = await dispatchLifecycleHooks(
        harnessRoot,
        'pre_phase',
        {
          projectRoot: dir,
          phase: 'catalog',
          feature: '_global',
          resolvedProfileName: 't-profile',
          hookEvent: 'pre_phase',
        },
        resolved(dir),
        {},
      );
      assert(r.hookCheckResults.some(c => c.severity === 'BLOCKER' && c.status === 'FAIL'), 'blocker');
    },
  },
  {
    name: 'extension .mjs 抛错 → MAJOR FAIL',
    async run() {
      const dir = mkTmp();
      const harnessRoot = path.join(dir, 'harness');
      const hookPath = path.join(dir, 'bad.mjs');
      write(hookPath, 'export default async () => { throw new Error("boom-ext"); };');
      const bundle: HarnessResolvedProfile['extensionBundle'] = {
        rootDir: dir,
        manifestPath: null,
        skills: [],
        knowledgePaths: [],
        hooks: { catalog: { pre_phase: [hookPath] } },
        extensionCapabilities: {},
        phaseRuleOverlayPaths: {},
        errors: [],
      };
      const r = await dispatchLifecycleHooks(
        harnessRoot,
        'pre_phase',
        {
          projectRoot: dir,
          phase: 'catalog',
          feature: '_global',
          resolvedProfileName: 't-profile',
          hookEvent: 'pre_phase',
        },
        resolved(dir, bundle),
        {},
      );
      assert(r.hookCheckResults.some(c => c.severity === 'MAJOR' && c.status === 'FAIL'), 'major');
    },
  },
  {
    name: '无 hook 文件 → 空',
    async run() {
      const dir = mkTmp();
      const harnessRoot = path.join(dir, 'harness');
      fs.mkdirSync(harnessRoot, { recursive: true });
      const r = await dispatchLifecycleHooks(
        harnessRoot,
        'pre_phase',
        {
          projectRoot: dir,
          phase: 'catalog',
          feature: '_global',
          resolvedProfileName: 't-profile',
          hookEvent: 'pre_phase',
        },
        resolved(dir),
        {},
      );
      assert(r.promptFragments.length === 0 && r.hookCheckResults.length === 0, 'none');
    },
  },
  {
    name: 'slot 不含未知 phase 目录',
    async run() {
      const dir = mkTmp();
      const harnessRoot = path.join(dir, 'harness');
      fs.mkdirSync(harnessRoot, { recursive: true });
      const slots = collectHookSlots(harnessRoot, 'nosuchphase', 'pre_phase', resolved(dir));
      assert(slots.length === 0, 'slots');
    },
  },
  {
    name: '.md 仅空白 → 不产生 fragment',
    async run() {
      const dir = mkTmp();
      const harnessRoot = path.join(dir, 'harness');
      write(path.join(harnessRoot, 'hooks', 'catalog', 'pre_phase.md'), '   \n  ');
      const r = await dispatchLifecycleHooks(
        harnessRoot,
        'pre_phase',
        {
          projectRoot: dir,
          phase: 'catalog',
          feature: '_global',
          resolvedProfileName: 't-profile',
          hookEvent: 'pre_phase',
        },
        resolved(dir),
        {},
      );
      assert(r.promptFragments.length === 0, 'no frag');
    },
  },
  {
    name: 'mjs 返回 ok:false → 合成 FAIL（extension=MAJOR）',
    async run() {
      const dir = mkTmp();
      const harnessRoot = path.join(dir, 'harness');
      const hookPath = path.join(dir, 'x.mjs');
      write(hookPath, 'export default async () => ({ ok: false, message: "no-go" });');
      const bundle: HarnessResolvedProfile['extensionBundle'] = {
        rootDir: dir,
        manifestPath: null,
        skills: [],
        knowledgePaths: [],
        hooks: { catalog: { pre_phase: [hookPath] } },
        extensionCapabilities: {},
        phaseRuleOverlayPaths: {},
        errors: [],
      };
      const r = await dispatchLifecycleHooks(
        harnessRoot,
        'pre_phase',
        {
          projectRoot: dir,
          phase: 'catalog',
          feature: '_global',
          resolvedProfileName: 't-profile',
          hookEvent: 'pre_phase',
        },
        resolved(dir, bundle),
        {},
      );
      assert(r.hookCheckResults.some(c => c.status === 'FAIL' && c.details.includes('no-go')), 'fail chk');
    },
  },
];

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      await c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}
