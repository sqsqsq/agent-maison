// ============================================================================
// no-numbered-skill-scan.unit.test.ts — consumer 布局 + skills-bridge 路径门禁
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { inferRepoLayout } from '../../repo-layout';
import {
  NUMBERED_PROSE_RE,
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
    name: 'consumer: framework/skills/1-spec 残留应命中',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nnss-c-hit-'));
      const fw = path.join(tmp, 'framework');
      writeText(
        path.join(fw, 'skills', '1-spec', 'SKILL.md'),
        'see framework/skills/1-spec/SKILL.md\n',
      );
      writeText(path.join(fw, 'workflows', '.gitkeep'), '');
      const layout = inferRepoLayout(tmp);
      const hits = scanNoNumberedSkillPaths(layout, 'consumer');
      assert(hits.length >= 1, `hits=${hits.length}`);
      assert(
        hits.some(h => h.file.replace(/\\/g, '/').includes('framework/skills/1-spec')),
        hits.map(h => h.file).join(';'),
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
    name: 'dev standalone: 扁平 catalog-bootstrap 路径不误报',
    run: () => {
      const layout = inferRepoLayout(path.resolve(__dirname, '../../..'));
      const hits = scanNoNumberedSkillPaths(layout, 'dev');
      const falsePos = hits.filter(h => h.match.includes('catalog-bootstrap') && !h.match.includes('0-catalog'));
      assert(falsePos.length === 0, falsePos.map(h => h.match).join(';'));
    },
  },
  {
    name: 'dev standalone: 无旧编号 skill 路径残留',
    run: () => {
      const layout = inferRepoLayout(path.resolve(__dirname, '../../..'));
      const hits = scanNoNumberedSkillPaths(layout, 'dev');
      assert(hits.length === 0, hits.slice(0, 3).map(h => `${h.file}:${h.line}`).join('\n'));
    },
  },
  {
    name: 'prose regex: Skill 00 命中且与 Skill 0 / Skill 007 区分',
    run: () => {
      const exec = (text: string) => {
        NUMBERED_PROSE_RE.lastIndex = 0;
        return NUMBERED_PROSE_RE.exec(text);
      };
      assert(exec('see Skill 00 framework-init')?.[0] === 'Skill 00', 'Skill 00');
      assert(exec('see Skill 0 catalog-bootstrap')?.[0] === 'Skill 0', 'Skill 0');
      assert(exec('Skill 007') === null, 'Skill 007 must not match');
      assert(exec('经 framework-init Stop hook') === null, 'no Skill prefix');
    },
  },
  {
    name: 'prose scan: Skill 00 正文命中',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nnss-prose-00-'));
      const fw = path.join(tmp, 'framework');
      writeText(path.join(fw, 'skills', 'feature', 'spec', 'SKILL.md'), '旧称 Skill 00 已废弃\n');
      writeText(path.join(fw, 'workflows', '.gitkeep'), '');
      const layout = inferRepoLayout(tmp);
      const hits = scanNoNumberedSkillProse(layout, 'consumer');
      assert(hits.some(h => h.match === 'Skill 00'), hits.map(h => h.match).join(';'));
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  },
  {
    name: 'dev standalone: feature SKILL 无 Skill N 人读编号',
    run: () => {
      const layout = inferRepoLayout(path.resolve(__dirname, '../../..'));
      const hits = scanNoNumberedSkillProse(layout, 'dev').filter(h =>
        h.file.replace(/\\/g, '/').includes('skills/feature/'),
      );
      assert(hits.length === 0, hits.slice(0, 5).map(h => `${h.file}:${h.line} ${h.match}`).join('\n'));
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
