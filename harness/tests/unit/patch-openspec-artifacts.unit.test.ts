// f4b2c8e6 t2 — patch-openspec-artifacts 全目标原子性与幂等
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import type { UnitCaseResult } from '../run-unit';

const TARGETS = [
  '.cursor/commands/opsx-propose.md', '.cursor/commands/opsx-apply.md',
  '.cursor/commands/opsx-archive.md', '.cursor/commands/opsx-explore.md',
  '.cursor/skills/openspec-propose/SKILL.md', '.cursor/skills/openspec-apply-change/SKILL.md',
  '.cursor/skills/openspec-archive-change/SKILL.md', '.cursor/skills/openspec-explore/SKILL.md',
  '.codex/skills/openspec-propose/SKILL.md', '.codex/skills/openspec-apply-change/SKILL.md',
  '.codex/skills/openspec-archive-change/SKILL.md', '.codex/skills/openspec-explore/SKILL.md',
];
const SCRIPT = path.resolve(__dirname, '..', '..', '..', 'scripts', 'patch-openspec-artifacts.mjs');

function run(results: UnitCaseResult[], name: string, fn: () => void): void {
  try { fn(); results.push({ name, ok: true }); }
  catch (err) { results.push({ name, ok: false, error: (err as Error).stack ?? String(err) }); }
}
function assert(cond: boolean, msg: string): void { if (!cond) throw new Error(msg); }
function anchor(rel: string): string {
  const base = rel.includes('propose') ? 'openspec-propose' : rel.includes('apply') ? 'openspec-apply'
    : rel.includes('archive') ? 'openspec-archive' : 'openspec-explore';
  return rel.includes('/commands/') ? `name: /${base.replace('openspec-', 'opsx-')}`
    : `name: ${base}${base === 'openspec-apply' || base === 'openspec-archive' ? '-change' : ''}`;
}
function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-openspec-patch-'));
  for (const rel of TARGETS) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `---\n${anchor(rel)}\n---\n\nRun openspec list now.\n`, 'utf8');
  }
  return root;
}
function execute(root: string) {
  return spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
}
function bytes(root: string): Map<string, Buffer> {
  return new Map(TARGETS.filter(rel => fs.existsSync(path.join(root, rel)) && fs.statSync(path.join(root, rel)).isFile())
    .map(rel => [rel, fs.readFileSync(path.join(root, rel))]));
}
function assertSame(actual: Map<string, Buffer>, expected: Map<string, Buffer>, label: string): void {
  for (const [rel, before] of expected) assert(actual.get(rel)?.equals(before) === true, `${label}: ${rel} 被部分改写`);
}

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];

  run(results, '12 targets 首跑转换；二次执行逐文件字节一致', () => {
    const root = makeRoot();
    try {
      const first = execute(root);
      assert(first.status === 0, `首跑失败：${first.stderr}`);
      for (const rel of TARGETS) assert(fs.readFileSync(path.join(root, rel), 'utf8').includes('npm run openspec -- list'), `${rel} 未转换`);
      const afterFirst = bytes(root);
      const second = execute(root);
      assert(second.status === 0, `二次运行失败：${second.stderr}`);
      assertSame(bytes(root), afterFirst, '二次运行应幂等');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  for (const scenario of ['corrupt', 'missing', 'unreadable', 'drift', 'unknown-command'] as const) {
    run(results, `${scenario} target → 非零退出且其他 targets 零写入`, () => {
      const root = makeRoot();
      const victim = TARGETS[3];
      try {
        const file = path.join(root, victim);
        if (scenario === 'corrupt') fs.writeFileSync(file, `---\n${anchor(victim)}\n---\n\nnpm run npm run openspec -- -- list\n`);
        if (scenario === 'missing') fs.unlinkSync(file);
        if (scenario === 'unreadable') { fs.unlinkSync(file); fs.mkdirSync(file); }
        if (scenario === 'drift') fs.writeFileSync(file, `---\n${anchor(victim)}\n---\n\nunknown upstream command\n`);
        if (scenario === 'unknown-command') {
          fs.writeFileSync(file, `---\n${anchor(victim)}\nauthor: openspec\nversion: 1\n---\n\nRun openspec diff now.\n`);
        }
        const before = bytes(root);
        const out = execute(root);
        assert(out.status !== 0, `${scenario} 应失败`);
        assertSame(bytes(root), before, `${scenario} 原子拒绝`);
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
  }

  return results;
}
