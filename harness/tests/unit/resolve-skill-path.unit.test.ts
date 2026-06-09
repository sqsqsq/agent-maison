// ============================================================================
// resolve-skill-path.unit.test.ts — skills.index.yaml SSOT 与路径解析一致性
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import { BUILTIN_SKILL_BRIDGE_DESCRIPTIONS } from '../../scripts/utils/agent-bundle-paths';
import {
  listBuiltinSkillIds,
  loadSkillsIndex,
  resolveSkillPath,
  skillMdAbs,
} from '../../scripts/utils/resolve-skill-path';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const FRAMEWORK_DIR = path.resolve(__dirname, '../../..');

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function readWorkflowSkillDocs(): string[] {
  const wf = path.join(FRAMEWORK_DIR, 'workflows', 'spec-driven.workflow.yaml');
  const text = fs.readFileSync(wf, 'utf8');
  return [...text.matchAll(/skill_doc:\s+(\S+)/g)].map(m => m[1]!.replace(/^\.\.\//, ''));
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'loadSkillsIndex: 9 个 builtin skill 且路径可解析',
    run: () => {
      const index = loadSkillsIndex(FRAMEWORK_DIR, true);
      assert(index.skills.length === 9, `skills.length=${index.skills.length}`);
      const ids = listBuiltinSkillIds(FRAMEWORK_DIR);
      assert(ids.length === 9, `ids.length=${ids.length}`);
      for (const id of ids) {
        const r = resolveSkillPath(FRAMEWORK_DIR, id);
        assert(fs.existsSync(skillMdAbs(FRAMEWORK_DIR, id)), `missing ${r.skillMdFrameworkRel}`);
        assert(r.skillMdRepoRel.startsWith('framework/skills/'), r.skillMdRepoRel);
      }
    },
  },
  {
    name: 'index ↔ workflow skill_doc ↔ BUILTIN descriptions 一致',
    run: () => {
      const ids = new Set(listBuiltinSkillIds(FRAMEWORK_DIR));
      for (const doc of readWorkflowSkillDocs()) {
        const m = doc.match(/skills\/(?:project|feature)\/([^/]+)\/SKILL\.md$/);
        if (!m) continue;
        const idFromPath = m[1]!;
        const entry = loadSkillsIndex(FRAMEWORK_DIR, true).skills.find(s => s.source_rel.endsWith(idFromPath));
        assert(Boolean(entry), `workflow skill_doc ${doc} 无 index 条目`);
        assert(ids.has(entry!.id), entry!.id);
      }
      for (const id of Object.keys(BUILTIN_SKILL_BRIDGE_DESCRIPTIONS)) {
        assert(ids.has(id), `BUILTIN 描述键 ${id} 不在 index`);
      }
      for (const id of ids) {
        assert(
          id in BUILTIN_SKILL_BRIDGE_DESCRIPTIONS,
          `index skill ${id} 缺少 BUILTIN_SKILL_BRIDGE_DESCRIPTIONS`,
        );
      }
    },
  },
  {
    name: 'skills-bridge goal-mode 跳板链接含 framework 前缀',
    run: () => {
      const bridge = path.join(
        FRAMEWORK_DIR,
        'agents/shared/agent-bundle/templates/skills-bridge/goal-mode/SKILL.md',
      );
      const text = fs.readFileSync(bridge, 'utf8');
      assert(
        text.includes('../../../framework/skills/project/goal-mode/SKILL.md'),
        'bridge rel path',
      );
      assert(!text.includes('../../../../skills/'), 'must not escape repo without framework/');
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
