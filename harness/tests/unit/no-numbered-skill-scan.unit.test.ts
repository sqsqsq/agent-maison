// ============================================================================
// no-numbered-skill-scan.unit.test.ts — consumer 布局 + skills-bridge 路径门禁
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { inferRepoLayout } from '../../repo-layout';
import {
  resolveNumberedSkillScanTarget,
  scanNoNumberedSkillPaths,
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
