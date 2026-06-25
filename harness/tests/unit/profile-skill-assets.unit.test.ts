// ============================================================================
// profile-skill-assets.unit.test.ts — skill-assets 清单与根 SKILL 资产引用校验
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache } from '../../config';
import {
  extractMarkdownAnchors,
  extractProfileSkillAssetRefs,
  loadSkillAssetsManifest,
  resolveManifestEntryPath,
  resolveSkillAssetPath,
  scanAddendumAssetRefs,
  scanCrossProfileHardcodedPaths,
  scanMarkdownRelativeLinks,
  scanReadmeAnchorLinks,
  scanSameProfileAssetHardcodes,
  slugifyHeading,
  validateProfileSkillAssetsForProject,
  type SkillAssetsManifest,
} from '../../scripts/utils/profile-skill-assets';
import { detectRepoLayout } from '../../repo-layout';
import { DEFAULT_LAYOUT, externalStandaloneLayout } from '../utils/layout-test-helper';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function repoRoot(): string {
  return detectRepoLayout(__dirname).projectRoot;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'extractProfileSkillAssetRefs: 解析多次出现与多种 skill id',
    run: () => {
      const s =
        'x `profile-skill-asset:plan/design_template` y profile-skill-asset:business-ut/use_cases_schema end';
      const refs = extractProfileSkillAssetRefs(s);
      assert(refs.length === 2, `len=${refs.length}`);
      assert(refs[0].skill === 'plan' && refs[0].key === 'design_template', 'first');
      assert(refs[1].skill === 'business-ut' && refs[1].key === 'use_cases_schema', 'second');
    },
  },
  {
    name: 'loadSkillAssetsManifest: hmos-app 清单可解析且 profile 字段一致',
    run: () => {
      const root = repoRoot();
      const r = loadSkillAssetsManifest(root, 'hmos-app');
      assert(r.ok && r.manifest !== undefined, r.errors.join('; '));
      assert(r.manifest!.assets['spec']?.prd_template === 'templates/spec-template.md', 'prd_template');
    },
  },
  {
    name: 'resolveSkillAssetPath: 相对 skill 目录拼接',
    run: () => {
      const root = repoRoot();
      const m = loadSkillAssetsManifest(root, 'hmos-app').manifest!;
      const res = resolveSkillAssetPath(root, 'hmos-app', m, 'spec', 'prd_template');
      assert(res.ok && res.absPath !== undefined, res.error ?? 'fail');
      assert(fs.existsSync(res.absPath!), res.absPath!);
    },
  },
  {
    name: 'resolveSkillAssetPath: legacy prd-design/prd_template alias',
    run: () => {
      const root = repoRoot();
      const m = loadSkillAssetsManifest(root, 'hmos-app').manifest!;
      const canon = resolveSkillAssetPath(root, 'hmos-app', m, 'spec', 'spec_template');
      const legacy = resolveSkillAssetPath(root, 'hmos-app', m, 'prd-design', 'prd_template');
      assert(canon.ok && legacy.ok, 'both resolve');
      assert(canon.absPath === legacy.absPath, 'same file');
    },
  },
  {
    name: 'resolveSkillAssetPath: generic 清单指向本 profile 树下文件',
    run: () => {
      const root = repoRoot();
      const m = loadSkillAssetsManifest(root, 'generic').manifest!;
      const res = resolveSkillAssetPath(root, 'generic', m, 'spec', 'prd_template');
      assert(
        Boolean(res.ok && res.relRepo?.includes('profiles/generic/')),
        res.relRepo ?? 'relRepo',
      );
      assert(fs.existsSync(res.absPath!), res.absPath!);
    },
  },
  {
    name: 'resolveSkillAssetPath: manifest 未声明 skill 分桶',
    run: () => {
      const root = repoRoot();
      const m = loadSkillAssetsManifest(root, 'hmos-app').manifest!;
      const res = resolveSkillAssetPath(root, 'hmos-app', m, 'nonexistent-skill-id', 'prd_template');
      assert(res.ok === false, 'expected fail');
      assert(Boolean(res.error?.includes('未声明 skill')), res.error ?? '');
    },
  },
  {
    name: 'resolveSkillAssetPath: manifest 未声明 asset_key',
    run: () => {
      const root = repoRoot();
      const m = loadSkillAssetsManifest(root, 'hmos-app').manifest!;
      const res = resolveSkillAssetPath(root, 'hmos-app', m, 'spec', 'not_a_declared_asset_key');
      assert(res.ok === false, 'expected fail');
      assert(Boolean(res.error?.includes('未声明资产')), res.error ?? '');
    },
  },
  {
    name: 'scanMarkdownRelativeLinks: 检出缺失的 templates 相对链接',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'psa-'));
      const skillDir = path.join(tmp, 'framework', 'skills', 'z-test');
      fs.mkdirSync(skillDir, { recursive: true });
      const md = path.join(skillDir, 'SKILL.md');
      fs.writeFileSync(md, 'bad [x](templates/nope.md)\n', 'utf-8');
      const issues = scanMarkdownRelativeLinks(tmp, md, fs.readFileSync(md, 'utf-8'));
      assert(issues.length === 1, issues.join(';'));
      assert(issues[0].includes('templates/nope.md'), issues[0]);
    },
  },
  {
    name: 'validateProfileSkillAssetsForProject: 本仓库实例应通过',
    run: () => {
      clearFrameworkConfigCache();
      const root = repoRoot();
      const v = validateProfileSkillAssetsForProject(root);
      if (!v.ok) {
        throw new Error(v.errors.join('\n'));
      }
    },
  },
  {
    name: 'validateProfileSkillAssetsForProject: SKILL 引用清单未声明的 asset_key 应失败',
    run: () => {
      clearFrameworkConfigCache();
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'psa-missing-key-'));
      const profile = 'psa-missing-key-profile';
      fs.writeFileSync(
        path.join(tmp, 'framework.config.json'),
        JSON.stringify({
          schema_version: '1.0',
          project_name: 'psa-missing-key',
          project_profile: { name: profile },
        }),
        'utf-8',
      );
      const profSkills = path.join(tmp, 'framework', 'profiles', profile, 'skills');
      const skill1 = path.join(profSkills, 'spec');
      fs.mkdirSync(path.join(skill1, 'templates'), { recursive: true });
      fs.writeFileSync(path.join(skill1, 'templates', 'ok.md'), '# ok\n', 'utf-8');
      fs.writeFileSync(
        path.join(profSkills, 'skill-assets.yaml'),
        [
          'schema_version: "1.0"',
          `profile: ${profile}`,
          'assets:',
          '  spec:',
          '    prd_template: templates/ok.md',
          '',
        ].join('\n'),
        'utf-8',
      );
      const rootSkillDir = path.join(tmp, 'framework', 'skills', 'feature', 'spec');
      fs.mkdirSync(rootSkillDir, { recursive: true });
      fs.writeFileSync(
        path.join(rootSkillDir, 'SKILL.md'),
        'See `profile-skill-asset:spec/not_in_manifest`.\n',
        'utf-8',
      );
      const v = validateProfileSkillAssetsForProject(tmp);
      assert(v.ok === false, 'expected fail');
      const msg = v.errors.join('\n');
      assert(msg.includes('not_in_manifest'), msg);
      assert(msg.includes('未声明资产') || msg.includes('无法解析'), msg);
    },
  },
  {
    name: 'validateProfileSkillAssetsForProject: 清单条目指向缺失文件应失败',
    run: () => {
      clearFrameworkConfigCache();
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'psa-missing-file-'));
      const profile = 'psa-missing-file-profile';
      fs.writeFileSync(
        path.join(tmp, 'framework.config.json'),
        JSON.stringify({
          schema_version: '1.0',
          project_name: 'psa-missing-file',
          project_profile: { name: profile },
        }),
        'utf-8',
      );
      const profSkills = path.join(tmp, 'framework', 'profiles', profile, 'skills');
      const skill1 = path.join(profSkills, 'spec');
      fs.mkdirSync(path.join(skill1, 'templates'), { recursive: true });
      fs.writeFileSync(path.join(skill1, 'templates', 'ok.md'), '# ok\n', 'utf-8');
      fs.writeFileSync(
        path.join(profSkills, 'skill-assets.yaml'),
        [
          'schema_version: "1.0"',
          `profile: ${profile}`,
          'assets:',
          '  spec:',
          '    prd_template: templates/ok.md',
          '    ghost_asset: templates/this-file-is-missing.md',
          '',
        ].join('\n'),
        'utf-8',
      );
      const rootSkillDir = path.join(tmp, 'framework', 'skills', 'feature', 'spec');
      fs.mkdirSync(rootSkillDir, { recursive: true });
      fs.writeFileSync(path.join(rootSkillDir, 'SKILL.md'), '# no refs\n', 'utf-8');
      const v = validateProfileSkillAssetsForProject(tmp);
      assert(v.ok === false, 'expected fail');
      const msg = v.errors.join('\n');
      assert(msg.includes('ghost_asset') || msg.includes('声明缺失'), msg);
      assert(msg.includes('this-file-is-missing.md') || msg.includes('psa-missing-file'), msg);
    },
  },
  {
    name: 'loadSkillAssetsManifest: 外部 frameworkRoot 从仓根读 manifest 而非 tmp projectRoot',
    run: () => {
      clearFrameworkConfigCache();
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'psa-ext-fw-'));
      fs.writeFileSync(
        path.join(tmp, 'framework.config.json'),
        JSON.stringify({
          schema_version: '1.0',
          project_name: 'psa-ext-fw',
          project_profile: { name: 'hmos-app' },
        }),
        'utf-8',
      );
      const loaded = loadSkillAssetsManifest(tmp, 'hmos-app', DEFAULT_LAYOUT);
      assert(loaded.ok, loaded.errors.join('\n'));
      assert(loaded.manifest?.profile === 'hmos-app', 'profile');
    },
  },
  {
    name: 'resolveSkillAssetPath: code-graph 资产 hmos-app 与 generic 均可解析',
    run: () => {
      const root = repoRoot();
      for (const profile of ['hmos-app', 'generic'] as const) {
        const m = loadSkillAssetsManifest(root, profile).manifest!;
        for (const key of ['code_graph_template', 'curate_core_prompt'] as const) {
          const res = resolveSkillAssetPath(root, profile, m, 'code-graph', key);
          assert(res.ok && res.absPath !== undefined, `${profile}/${key}: ${res.error ?? 'fail'}`);
          assert(fs.existsSync(res.absPath!), res.absPath!);
        }
      }
    },
  },
  {
    name: 'extractProfileSkillAssetRefs: code-graph SKILL 引用键可被清单覆盖',
    run: () => {
      const root = repoRoot();
      const skillPath = path.join(root, 'skills', 'project', 'code-graph', 'SKILL.md');
      const text = fs.readFileSync(skillPath, 'utf-8');
      const refs = extractProfileSkillAssetRefs(text).filter(r => r.skill === 'code-graph');
      assert(refs.length >= 2, `refs=${refs.length}`);
      for (const profile of ['hmos-app', 'generic'] as const) {
        const m = loadSkillAssetsManifest(root, profile).manifest!;
        for (const ref of refs) {
          const res = resolveSkillAssetPath(root, profile, m, ref.skill, ref.key);
          assert(res.ok, `${profile} missing ${ref.skill}/${ref.key}: ${res.error}`);
        }
      }
    },
  },
  {
    name: 'resolveManifestEntryPath: framework/ 前缀 + 外部 frameworkRoot',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'psa-fw-prefix-'));
      const layout = externalStandaloneLayout(tmp);
      const abs = resolveManifestEntryPath(
        tmp,
        'hmos-app',
        'spec',
        'framework/skills/reference/user-confirmation-ux.md',
        layout,
      );
      assert(
        abs === path.join(DEFAULT_LAYOUT.frameworkRoot, 'skills', 'reference', 'user-confirmation-ux.md'),
        abs,
      );
    },
  },
  // ---- G1：README anchor 链接完整性 ----
  {
    name: 'slugifyHeading: 协议标题 slug 与链接锚点一致',
    run: () => {
      assert(slugifyHeading('Profile skill asset protocol') === 'profile-skill-asset-protocol', 'slug');
      const anchors = extractMarkdownAnchors('# T\n\n## Profile skill asset protocol\n\nbody\n');
      assert(anchors.has('profile-skill-asset-protocol'), [...anchors].join(','));
    },
  },
  {
    name: 'scanReadmeAnchorLinks: 锚点缺失报错、存在则放行',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'psa-anchor-'));
      fs.mkdirSync(path.join(tmp, 'sub'), { recursive: true });
      const md = path.join(tmp, 'sub', 'SKILL.md');
      fs.writeFileSync(md, '见 [协议](../README.md#profile-skill-asset-protocol)。\n', 'utf-8');
      // README 缺该小节 → 报错
      fs.writeFileSync(path.join(tmp, 'README.md'), '# 标题\n\n没有协议小节\n', 'utf-8');
      const bad = scanReadmeAnchorLinks(tmp, md, fs.readFileSync(md, 'utf-8'));
      assert(bad.length === 1 && bad[0].includes('profile-skill-asset-protocol'), bad.join(';'));
      // README 含该小节 → 放行
      fs.writeFileSync(path.join(tmp, 'README.md'), '## Profile skill asset protocol\n\nok\n', 'utf-8');
      const good = scanReadmeAnchorLinks(tmp, md, fs.readFileSync(md, 'utf-8'));
      assert(good.length === 0, good.join(';'));
    },
  },
  {
    name: 'scanReadmeAnchorLinks: 链接目标 README 不存在（深度写错）报错',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'psa-anchor2-'));
      fs.mkdirSync(path.join(tmp, 'a', 'b'), { recursive: true });
      const md = path.join(tmp, 'a', 'b', 'SKILL.md');
      // 写成多上一层 → 指到不存在的 README
      fs.writeFileSync(md, '见 [协议](../../../README.md#profile-skill-asset-protocol)。\n', 'utf-8');
      const issues = scanReadmeAnchorLinks(tmp, md, fs.readFileSync(md, 'utf-8'));
      assert(issues.length === 1 && issues[0].includes('不存在'), issues.join(';'));
    },
  },
  // ---- G2：addendum 字面 framework 路径落盘 ----
  {
    name: 'scanAddendumAssetRefs: addendum 字面 framework 资产路径不落盘应报错',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'psa-addendum-'));
      fs.mkdirSync(path.join(tmp, 'framework', 'skills'), { recursive: true });
      const addDir = path.join(tmp, 'framework', 'profiles', 'pa', 'skills', 'spec');
      fs.mkdirSync(addDir, { recursive: true });
      const add = path.join(addDir, 'profile-addendum.md');
      fs.writeFileSync(add, '模板见 `framework/skills/feature/spec/templates/ghost-template.md`。\n', 'utf-8');
      const manifest: SkillAssetsManifest = { schema_version: '1.0', profile: 'pa', assets: {} };
      const issues = scanAddendumAssetRefs(tmp, 'pa', manifest, add);
      assert(issues.length === 1 && issues[0].includes('ghost-template.md'), issues.join(';'));
    },
  },
  {
    name: 'scanAddendumAssetRefs: 原始误导形态（相对 `skills/feature/<x>/` 表头）应报错、相对链接放行',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'psa-addendum-bare-'));
      fs.mkdirSync(path.join(tmp, 'framework', 'skills'), { recursive: true });
      const addDir = path.join(tmp, 'framework', 'profiles', 'pa', 'skills', 'spec');
      fs.mkdirSync(addDir, { recursive: true });
      const add = path.join(addDir, 'profile-addendum.md');
      const manifest: SkillAssetsManifest = { schema_version: '1.0', profile: 'pa', assets: {} };
      // 还原历史 bug 表头：表头声明"相对 skills/feature/spec/"+ 表格 templates/spec-template.md
      fs.writeFileSync(
        add,
        ['### skill-assets.yaml 键', '', '| 键 | 相对 `skills/feature/spec/` |', '|----|----|', '| `spec_template` | `templates/spec-template.md` |', ''].join('\n'),
        'utf-8',
      );
      const bad = scanAddendumAssetRefs(tmp, 'pa', manifest, add);
      assert(bad.some((e) => e.includes('skills/feature/spec')), 'expected bare-skills flag: ' + bad.join(';'));
      // 相对链接 ../../../../skills/feature/spec/... 不应误报
      fs.writeFileSync(add, '诊断见 [x](../../../../skills/feature/spec/reference/ui-spec.md)。\n', 'utf-8');
      const good = scanAddendumAssetRefs(tmp, 'pa', manifest, add);
      assert(good.length === 0, 'relative link must not be flagged: ' + good.join(';'));
    },
  },
  // ---- G3：命令式产物跨 profile 硬编码 ----
  {
    name: 'scanCrossProfileHardcodedPaths: prompt 硬编码他 profile 报错、addendum 豁免',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'psa-xprofile-'));
      fs.mkdirSync(path.join(tmp, 'framework', 'skills'), { recursive: true });
      const paPrompts = path.join(tmp, 'framework', 'profiles', 'pa', 'skills', 'coding', 'prompts');
      const paSpec = path.join(tmp, 'framework', 'profiles', 'pa', 'skills', 'coding');
      fs.mkdirSync(paPrompts, { recursive: true });
      // pb 也要作为真实 profile 存在
      fs.mkdirSync(path.join(tmp, 'framework', 'profiles', 'pb', 'skills', 'coding'), { recursive: true });
      // 命令式 prompt 硬编码 pb → 报错
      fs.writeFileSync(
        path.join(paPrompts, 'do.md'),
        '严格遵守 `framework/profiles/pb/skills/coding/templates/x.yaml`。\n',
        'utf-8',
      );
      // addendum 解释性引用 pb → 豁免（不报）
      fs.writeFileSync(
        path.join(paSpec, 'profile-addendum.md'),
        '需要时切到 `profiles/pb/skills/coding/` 读其资产。\n',
        'utf-8',
      );
      const issues = scanCrossProfileHardcodedPaths(tmp);
      assert(issues.length === 1, 'expected exactly 1: ' + issues.join(';'));
      assert(issues[0].includes('do.md') && issues[0].includes('pb'), issues[0]);
    },
  },
  {
    name: 'scanSameProfileAssetHardcodes: 本 profile 资产物理硬编码报错、占位符放行',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'psa-same-'));
      fs.mkdirSync(path.join(tmp, 'framework', 'skills'), { recursive: true });
      const prompts = path.join(tmp, 'framework', 'profiles', 'pa', 'skills', 'catalog-bootstrap', 'prompts');
      fs.mkdirSync(prompts, { recursive: true });
      const md = path.join(prompts, 'p.md');
      // 本 profile 资产物理路径 → 报错
      fs.writeFileSync(md, '严格遵守 `framework/profiles/pa/skills/catalog-bootstrap/templates/x.yaml`。\n', 'utf-8');
      const bad = scanSameProfileAssetHardcodes(tmp);
      assert(bad.length === 1 && bad[0].includes('p.md'), bad.join(';'));
      // 占位符 → 放行；harness/ 等非资产路径不在扫描面
      fs.writeFileSync(md, '严格遵守 `profile-skill-asset:catalog-bootstrap/module_card_template`。\n', 'utf-8');
      const good = scanSameProfileAssetHardcodes(tmp);
      assert(good.length === 0, good.join(';'));
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
