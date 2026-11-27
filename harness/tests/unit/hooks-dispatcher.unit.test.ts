import { putPlugin } from './extension-test-fixture';
import { FEATURE_AUTHOR_AT } from '../../scripts/utils/knowledge-context';
import { runUnitCasesAsync } from '../utils/unit-cases';
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
import { loadInstanceExtensions } from '../../extension-loader';
import { inspectInstanceExtensions } from '../../scripts/utils/extension-inspect';
import { checkExtensionBindingProduces, checkExtensionManifest } from '../../scripts/utils/extension-runtime';

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
    personalPrerequisites: {},
    extensionBundle: bundle,
  };
}

interface Case {
  name: string;
  run: () => void | Promise<void>;
}

const cases: Case[] = [
  {
    name: '两个插件经真实 dispatcher 依序消费；坏时点独立诊断且已启用 required 报缺口',
    async run() {
      const project = mkTmp();
      const framework = path.resolve(__dirname, '../../..');
      const harness = path.join(project, 'harness');
      const profile = path.join(project, 'profile');
      const event = 'post_verifier';
      write(path.join(harness, 'hooks', 'spec', `${event}.md`), 'framework fragment');
      write(path.join(profile, 'hooks', 'spec', `${event}.md`), 'profile fragment');
      const textHook = { at: 'harness.post_verifier@1', phase: 'spec', kind: 'knowledge', ref: 'hooks/guide.md' };
      putPlugin(project, 'layer-one', { declaration: { bindings: { text: textHook } }, files: { [textHook.ref]: 'first plugin fragment' } });
      putPlugin(project, 'hook-source', { declaration: { bindings: {
        native: { at: 'harness.post_verifier@1', phase: 'spec', kind: 'action', ref: 'hooks/check.mjs' },
        broken: { ...textHook, at: 'harness.on_context_loda@1', required: true },
        optional: { ...textHook, at: 'harness.on_context_loda@1' },
      } }, files: { 'hooks/check.mjs': `
        import { basename } from 'node:path';
        export default ctx => ({promptFragments: [ctx.extensionName + ':' + basename(process.cwd()) + ':' + basename(process.env.MAISON_EXTENSION_ROOT)]});
      ` } });

      try {
        const bundle = loadInstanceExtensions(project);
        const result = await dispatchLifecycleHooks(harness, event, {
          projectRoot: project, phase: 'spec', feature: 'fixture',
          resolvedProfileName: 't-profile', hookEvent: event,
        }, resolved(profile, bundle));
        const delivered = result.promptFragments.map(value => value.slice(value.lastIndexOf('\n') + 1)).join('|');
        assert(delivered === 'framework fragment|profile fragment|first plugin fragment|hook-source:hook-source:hook-source', delivered);
        const inspect = inspectInstanceExtensions(project, framework);
        const native = inspect.rows.find(row => row.bindingId === 'native');
        const broken = inspect.rows.find(row => row.bindingId === 'broken');
        assert(native?.state === 'scheduled' && native.timing.includes('尚未判断') && native.consumer.includes('verifier'), JSON.stringify(native));
        assert(broken?.state !== 'scheduled' && !!broken?.status.includes('未知时点'), JSON.stringify(broken));
        assert(inspect.manifestErrors.some(error => error.source === 'hook-source' && error.bindingId === 'broken'
          && error.at === 'harness.on_context_loda@1'), JSON.stringify(inspect.manifestErrors));
        assert(checkExtensionManifest(bundle).length === 0, 'health stays scoped to individual contributions');
        const checks = checkExtensionBindingProduces({ bundle, projectRoot: project, phase: 'spec', at: FEATURE_AUTHOR_AT });
        assert(checks.length === 1 && checks[0].status === 'FAIL' && !!checks[0].details?.includes('harness.on_context_loda@1'),
          JSON.stringify(checks));
      } finally {
        fs.rmSync(project, { recursive: true, force: true });
      }
    },
  },
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
      putPlugin(dir, 'fixture', { declaration: { bindings: { hook: {
        at: 'harness.pre_phase@1', phase: 'catalog', kind: 'knowledge', ref: 'ext-hook.md',
      } } }, files: { 'ext-hook.md': 'ext' } });
      const bundle = loadInstanceExtensions(dir);
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
      putPlugin(dir, 'fixture', { declaration: { bindings: { hook: {
        at: 'harness.pre_phase@1', phase: 'catalog', kind: 'action', ref: 'bad.mjs',
      } } }, files: { 'bad.mjs': 'export default async () => { throw new Error("boom-ext"); };' } });
      const bundle = loadInstanceExtensions(dir);
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
      putPlugin(dir, 'fixture', { declaration: { bindings: { hook: {
        at: 'harness.pre_phase@1', phase: 'catalog', kind: 'action', ref: 'x.mjs',
      } } }, files: { 'x.mjs': 'export default async () => ({ ok: false, message: "no-go" });' } });
      const bundle = loadInstanceExtensions(dir);
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
  return runUnitCasesAsync(cases);
}
