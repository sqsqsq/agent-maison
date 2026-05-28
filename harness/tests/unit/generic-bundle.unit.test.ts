// ============================================================================
// generic-bundle — agent bundle 路径解析与 inline 物化
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import assert from 'assert';
import { __testing as checkInitTesting } from '../../scripts/check-init';
import { validateAgentBundleRoot, readAgentBundlePathsFromConfig } from '../../scripts/utils/agent-bundle-paths';
import {
  materializeInlineSkillMarkdown,
  materializeAgentBundleSkills,
  posixRelativeFromSkillStubTo,
  renderBridgeSkillStubMarkdown,
} from '../../scripts/utils/materialize-agent-bundle-skills';
import { loadReservedBridgeIds } from '../../scripts/utils/instance-skill-bridge';
import { detectRepoLayout } from '../../repo-layout';

const FRAMEWORK_DIR = detectRepoLayout(__dirname).frameworkRoot;

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'validateAgentBundleRoot：拒绝 .. 与绝对路径',
    run: () => {
      assert.throws(() => validateAgentBundleRoot('../evil'));
      assert.throws(() => validateAgentBundleRoot('C:/abs'));
    },
  },
  {
    name: 'readAgentBundlePathsFromConfig：generic 必填 root',
    run: () => {
      assert.throws(() =>
        readAgentBundlePathsFromConfig({
          agent_adapter: 'generic',
          paths: { features_dir: 'doc/features' } as never,
        }),
      );
      const b = readAgentBundlePathsFromConfig({
        agent_adapter: 'generic',
        paths: {
          features_dir: 'doc/features',
          agent_bundle_root: '.codex',
          agent_bundle_skill_mode: 'inline',
        } as never,
      });
      assert.strictEqual(b?.skillsDir, '.codex/skills');
      assert.strictEqual(b?.skillMode, 'inline');
    },
  },
  {
    name: 'loadAdapter(generic)+applyGeneric：inline 物化条目',
    run: () => {
      const adapter = checkInitTesting.loadAdapter('generic');
      checkInitTesting.applyGenericAdapterBundle(adapter, {
        root: '.agents',
        skillsDir: '.agents/skills',
        rulesDir: '.agents/rules',
        skillMode: 'inline',
      });
      const inline = adapter.templateFiles.filter(f => f.kind === 'materialized');
      assert(inline.length >= 8);
      assert(inline.some(f => f.targetRel === '.agents/skills/00-framework-init/SKILL.md'));
    },
  },
  {
    name: 'loadAdapter(generic)+applyGeneric：bridge 拷贝 skills-bridge',
    run: () => {
      const adapter = checkInitTesting.loadAdapter('generic');
      checkInitTesting.applyGenericAdapterBundle(adapter, {
        root: '.codex',
        skillsDir: '.codex/skills',
        rulesDir: '.codex/rules',
        skillMode: 'bridge',
      });
      assert(
        adapter.templateFiles.some(
          f => f.targetRel === '.codex/skills/00-framework-init/SKILL.md' && f.kind === 'verbatim',
        ),
      );
    },
  },
  {
    name: 'loadAdapter(generic)+applyGeneric：interaction-renderer 随 bundle root 重定位',
    run: () => {
      const adapter = checkInitTesting.loadAdapter('generic');
      checkInitTesting.applyGenericAdapterBundle(adapter, {
        root: '.codex',
        skillsDir: '.codex/skills',
        rulesDir: '.codex/rules',
        skillMode: 'inline',
      });
      assert(
        adapter.templateFiles.some(
          f =>
            f.origin === 'user_confirmation.interaction_renderer_rule'
            && f.targetRel === '.codex/rules/interaction-renderer.md',
        ),
      );
      assert(
        !adapter.templateFiles.some(
          f =>
            f.origin === 'user_confirmation.interaction_renderer_rule'
            && f.targetRel.startsWith('.agents/'),
        ),
      );
    },
  },
  {
    name: 'materializeInlineSkillMarkdown：name 与目录一致',
    run: () => {
      const md = materializeInlineSkillMarkdown(FRAMEWORK_DIR, '00-framework-init');
      assert(md.includes('name: 00-framework-init'));
      assert(md.includes('Framework 工程初始化'));
    },
  },
  {
    name: 'posixRelativeFromSkillStubTo：多段 bundle 根',
    run: () => {
      const rel = posixRelativeFromSkillStubTo(
        'tools/my-agent/skills/3-coding/SKILL.md',
        'framework/skills/3-coding/SKILL.md',
      );
      assert.strictEqual(rel, '../../../../framework/skills/3-coding/SKILL.md');
    },
  },
  {
    name: 'renderBridgeSkillStubMarkdown：name 等于 bridgeId',
    run: () => {
      const md = renderBridgeSkillStubMarkdown(
        '0-catalog-bootstrap',
        '.agents/skills/0-catalog-bootstrap/SKILL.md',
        'framework/skills/0-catalog-bootstrap/SKILL.md',
      );
      assert(md.includes('name: 0-catalog-bootstrap'));
      assert(!md.includes('name: catalog-bootstrap'));
    },
  },
  {
    name: 'materializeAgentBundleSkills：写入临时目录',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-bundle-'));
      const outcome = materializeAgentBundleSkills({
        projectRoot: dir,
        frameworkDir: FRAMEWORK_DIR,
        bundle: {
          root: '.agents',
          skillsDir: '.agents/skills',
          rulesDir: '.agents/rules',
          skillMode: 'inline',
        },
      });
      assert(outcome.filesWritten.length >= 8);
      const p = path.join(dir, '.agents/skills/00-framework-init/SKILL.md');
      assert(fs.existsSync(p));
      const txt = fs.readFileSync(p, 'utf8');
      assert(txt.includes('name: 00-framework-init'));
    },
  },
  {
    name: 'loadReservedBridgeIds：扫描 shared/skills-bridge',
    run: () => {
      const ids = loadReservedBridgeIds(FRAMEWORK_DIR);
      assert(ids.has('00-framework-init'));
      assert(ids.has('6-device-testing'));
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(c => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (err) {
      return { name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message };
    }
  });
}
