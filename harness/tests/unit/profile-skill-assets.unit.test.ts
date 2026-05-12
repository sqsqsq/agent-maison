// ============================================================================
// profile-skill-assets.unit.test.ts — skill-assets 清单与根 SKILL 资产引用校验
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache } from '../../config';
import {
  extractProfileSkillAssetRefs,
  loadSkillAssetsManifest,
  resolveSkillAssetPath,
  scanMarkdownRelativeLinks,
  validateProfileSkillAssetsForProject,
} from '../../scripts/utils/profile-skill-assets';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function repoRoot(): string {
  return path.resolve(__dirname, '../../../..');
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'extractProfileSkillAssetRefs: 解析多次出现与多种 skill id',
    run: () => {
      const s =
        'x `profile-skill-asset:2-requirement-design/design_template` y profile-skill-asset:5-business-ut/use_cases_schema end';
      const refs = extractProfileSkillAssetRefs(s);
      assert(refs.length === 2, `len=${refs.length}`);
      assert(refs[0].skill === '2-requirement-design' && refs[0].key === 'design_template', 'first');
      assert(refs[1].skill === '5-business-ut' && refs[1].key === 'use_cases_schema', 'second');
    },
  },
  {
    name: 'loadSkillAssetsManifest: hmos-app 清单可解析且 profile 字段一致',
    run: () => {
      const root = repoRoot();
      const r = loadSkillAssetsManifest(root, 'hmos-app');
      assert(r.ok && r.manifest !== undefined, r.errors.join('; '));
      assert(r.manifest!.assets['1-prd-design']?.prd_template === 'templates/prd-template.md', 'prd_template');
    },
  },
  {
    name: 'resolveSkillAssetPath: 相对 skill 目录拼接',
    run: () => {
      const root = repoRoot();
      const m = loadSkillAssetsManifest(root, 'hmos-app').manifest!;
      const res = resolveSkillAssetPath(root, 'hmos-app', m, '1-prd-design', 'prd_template');
      assert(res.ok && res.absPath !== undefined, res.error ?? 'fail');
      assert(fs.existsSync(res.absPath!), res.absPath!);
    },
  },
  {
    name: 'resolveSkillAssetPath: generic 清单指向本 profile 树下文件',
    run: () => {
      const root = repoRoot();
      const m = loadSkillAssetsManifest(root, 'generic').manifest!;
      const res = resolveSkillAssetPath(root, 'generic', m, '1-prd-design', 'prd_template');
      assert(
        Boolean(res.ok && res.relRepo?.includes('framework/profiles/generic/')),
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
      const res = resolveSkillAssetPath(root, 'hmos-app', m, '1-prd-design', 'not_a_declared_asset_key');
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
      const skill1 = path.join(profSkills, '1-prd-design');
      fs.mkdirSync(path.join(skill1, 'templates'), { recursive: true });
      fs.writeFileSync(path.join(skill1, 'templates', 'ok.md'), '# ok\n', 'utf-8');
      fs.writeFileSync(
        path.join(profSkills, 'skill-assets.yaml'),
        [
          'schema_version: "1.0"',
          `profile: ${profile}`,
          'assets:',
          '  1-prd-design:',
          '    prd_template: templates/ok.md',
          '',
        ].join('\n'),
        'utf-8',
      );
      const rootSkillDir = path.join(tmp, 'framework', 'skills', '1-prd-design');
      fs.mkdirSync(rootSkillDir, { recursive: true });
      fs.writeFileSync(
        path.join(rootSkillDir, 'SKILL.md'),
        'See `profile-skill-asset:1-prd-design/not_in_manifest`.\n',
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
      const skill1 = path.join(profSkills, '1-prd-design');
      fs.mkdirSync(path.join(skill1, 'templates'), { recursive: true });
      fs.writeFileSync(path.join(skill1, 'templates', 'ok.md'), '# ok\n', 'utf-8');
      fs.writeFileSync(
        path.join(profSkills, 'skill-assets.yaml'),
        [
          'schema_version: "1.0"',
          `profile: ${profile}`,
          'assets:',
          '  1-prd-design:',
          '    prd_template: templates/ok.md',
          '    ghost_asset: templates/this-file-is-missing.md',
          '',
        ].join('\n'),
        'utf-8',
      );
      const rootSkillDir = path.join(tmp, 'framework', 'skills', '1-prd-design');
      fs.mkdirSync(rootSkillDir, { recursive: true });
      fs.writeFileSync(path.join(rootSkillDir, 'SKILL.md'), '# no refs\n', 'utf-8');
      const v = validateProfileSkillAssetsForProject(tmp);
      assert(v.ok === false, 'expected fail');
      const msg = v.errors.join('\n');
      assert(msg.includes('ghost_asset') || msg.includes('声明缺失'), msg);
      assert(msg.includes('this-file-is-missing.md') || msg.includes('psa-missing-file'), msg);
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
