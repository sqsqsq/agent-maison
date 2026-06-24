// ============================================================================
// no-numbered-skill-scan.unit.test.ts — consumer 布局 + 五 kind 门禁
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { inferRepoLayout } from '../../repo-layout';
import {
  NUMBERED_BARE_RE,
  NUMBERED_PROSE_RE,
  assertLiveAliasDocDrift,
  resolveNumberedSkillScanTarget,
  scanNoNumberedSkillPaths,
  scanNoNumberedSkillProse,
} from '../../scripts/utils/no-numbered-skill-scan';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function writeText(abs: string, content: string): void {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

const repoRoot = path.resolve(__dirname, '../../..');

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'resolveNumberedSkillScanTarget: consumer 扫 frameworkRoot',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nnss-consumer-'));
      const fw = path.join(tmp, 'framework');
      writeText(path.join(fw, 'workflows', '.gitkeep'), '');
      const layout = inferRepoLayout(tmp);
      assert(layout.kind === 'consumer', layout.kind);
      const t = resolveNumberedSkillScanTarget(layout, 'consumer');
      assert(t.scanRoot === fw, t.scanRoot);
      assert(t.reportRelPrefix === 'framework/', t.reportRelPrefix);
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  },
  {
    name: 'consumer: skills/1-spec 目录残留无正文引用也应命中',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nnss-c-rel-'));
      const fw = path.join(tmp, 'framework');
      writeText(path.join(fw, 'skills', '1-spec', 'SKILL.md'), 'plain body without path refs\n');
      writeText(path.join(fw, 'workflows', '.gitkeep'), '');
      const layout = inferRepoLayout(tmp);
      const hits = scanNoNumberedSkillPaths(layout, 'consumer');
      assert(hits.length >= 1, `hits=${hits.length}`);
      assert(
        hits.some(h => h.line === 0 && h.file.replace(/\\/g, '/').includes('skills/1-spec')),
        hits.map(h => `${h.file}:${h.line} ${h.match}`).join(';'),
      );
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  },
  {
    name: 'consumer: skills-bridge/3-coding 残留应命中',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nnss-bridge-'));
      const fw = path.join(tmp, 'framework');
      writeText(
        path.join(fw, 'agents', 'shared', 'agent-bundle', 'templates', 'skills-bridge', '3-coding', 'SKILL.md'),
        'link: agents/shared/agent-bundle/templates/skills-bridge/3-coding/SKILL.md\n',
      );
      writeText(path.join(fw, 'workflows', '.gitkeep'), '');
      const layout = inferRepoLayout(tmp);
      const hits = scanNoNumberedSkillPaths(layout, 'consumer');
      assert(hits.length >= 1, `hits=${hits.length}`);
      assert(
        hits.some(h => h.match.includes('skills-bridge/3-coding')),
        hits.map(h => h.match).join(';'),
      );
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  },
  {
    name: 'dev standalone: 无旧编号 skill 路径残留',
    run: () => {
      const layout = inferRepoLayout(repoRoot);
      const hits = scanNoNumberedSkillPaths(layout, 'dev');
      assert(hits.length === 0, hits.slice(0, 5).map(h => `${h.file}:${h.line} ${h.match}`).join('\n'));
    },
  },
  {
    name: 'prose regex: Skill 00 命中且与 Skill 007 区分',
    run: () => {
      const exec = (text: string) => {
        NUMBERED_PROSE_RE.lastIndex = 0;
        return NUMBERED_PROSE_RE.exec(text);
      };
      assert(exec('see Skill 00 framework-init')?.[0] === 'Skill 00', 'Skill 00');
      assert(exec('Skill 007') === null, 'Skill 007 must not match');
    },
  },
  {
    name: 'bare regex: 1-spec 命中；1-prd-design 与 prd-design 不命中',
    run: () => {
      const exec = (text: string) => {
        NUMBERED_BARE_RE.lastIndex = 0;
        return NUMBERED_BARE_RE.exec(text);
      };
      assert(exec('token 1-spec here')?.[0] === '1-spec', '1-spec');
      assert(exec('1-prd-design') === null, '1-prd-design');
      assert(exec('prd-design') === null, 'prd-design');
    },
  },
  {
    name: 'backtick: `4-code-review` 标题形应命中',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nnss-bt-'));
      const fw = path.join(tmp, 'framework');
      writeText(
        path.join(fw, 'skills', 'feature', 'code-review', 'SKILL.md'),
        '# Code Review Skill (`4-code-review`)\n',
      );
      writeText(path.join(fw, 'workflows', '.gitkeep'), '');
      const layout = inferRepoLayout(tmp);
      const hits = scanNoNumberedSkillProse(layout, 'consumer');
      assert(hits.some(h => h.kind === 'backtick' && h.match.includes('4-code-review')), hits.map(h => h.match).join(';'));
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  },
  {
    name: 'range: spec~6 含阶段上下文应命中',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nnss-range-'));
      const fw = path.join(tmp, 'framework');
      writeText(path.join(fw, 'docs', 'x.md'), 'feature skill spec~6 阶段闭环\n');
      writeText(path.join(fw, 'workflows', '.gitkeep'), '');
      const layout = inferRepoLayout(tmp);
      const hits = scanNoNumberedSkillProse(layout, 'consumer');
      assert(hits.some(h => h.kind === 'range' && h.match.includes('spec~6')), hits.map(h => `${h.kind}:${h.match}`).join(';'));
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  },
  {
    name: 'range: 议题 2.1～2.6 不误报',
    run: () => {
      const layout = inferRepoLayout(repoRoot);
      const hits = scanNoNumberedSkillProse(layout, 'dev').filter(h =>
        h.file.replace(/\\/g, '/').includes('atomic-service-roadmap.md'),
      );
      assert(hits.length === 0, hits.map(h => h.match).join(';'));
    },
  },
  {
    name: 'profile-skill-assets.ts 整文件 exclude（bare 1-spec 不报错）',
    run: () => {
      const layout = inferRepoLayout(repoRoot);
      const hits = scanNoNumberedSkillProse(layout, 'dev').filter(h =>
        h.file.replace(/\\/g, '/').includes('profile-skill-assets.ts'),
      );
      assert(hits.length === 0, hits.map(h => `${h.line} ${h.match}`).join(';'));
    },
  },
  {
    name: 'MIGRATION profile-skill-asset 活 alias 表 bare 不报错',
    run: () => {
      const layout = inferRepoLayout(repoRoot);
      const hits = scanNoNumberedSkillProse(layout, 'dev').filter(h =>
        h.file.replace(/\\/g, '/').endsWith('MIGRATION.md'),
      );
      assert(hits.length === 0, hits.map(h => `${h.line} [${h.kind}] ${h.match}`).join('\n'));
    },
  },
  {
    name: 'live alias 漂移断言：当前 MIGRATION 至少 2 行含 1-spec/2-plan',
    run: () => {
      const text = fs.readFileSync(path.join(repoRoot, 'MIGRATION.md'), 'utf8');
      assertLiveAliasDocDrift(text);
    },
  },
  {
    name: 'dev standalone: feature SKILL 无编号 skill 文案残留',
    run: () => {
      const layout = inferRepoLayout(repoRoot);
      const hits = scanNoNumberedSkillProse(layout, 'dev').filter(h =>
        h.file.replace(/\\/g, '/').includes('skills/feature/'),
      );
      assert(hits.length === 0, hits.slice(0, 5).map(h => `${h.file}:${h.line} [${h.kind}] ${h.match}`).join('\n'));
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
