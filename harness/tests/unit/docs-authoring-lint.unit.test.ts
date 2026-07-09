// ============================================================================
// docs-authoring-lint.unit.test.ts — C3-task4 三项防再膨胀 lint 自测
//   skill_body_max_lines / forced_full_read_blacklist / entry_template_budget
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { inferRepoLayout } from '../../repo-layout';
import { scanSkillBodyBudget, resolveSkillIdFromSkillMdRel, resolveSkillBudget } from '../../scripts/utils/skill-body-budget';
import { scanForcedFullRead, scanUnconditionalCorrectionConfirm } from '../../scripts/utils/forced-full-read-scan';
import { checkEntryTemplateBudget } from '../../scripts/utils/entry-template-budget';

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

function mkConsumerProject(prefix: string): { tmp: string; fw: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const fw = path.join(tmp, 'framework');
  writeText(path.join(fw, 'workflows', '.gitkeep'), '');
  return { tmp, fw };
}

const repoRoot = path.resolve(__dirname, '../../..');

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'resolveSkillIdFromSkillMdRel: 提取 skill id',
    run: () => {
      assert(
        resolveSkillIdFromSkillMdRel('skills/feature/business-ut/SKILL.md') === 'business-ut',
        resolveSkillIdFromSkillMdRel('skills/feature/business-ut/SKILL.md'),
      );
      assert(
        resolveSkillIdFromSkillMdRel('framework/skills/project/framework-init/SKILL.md') === 'framework-init',
        resolveSkillIdFromSkillMdRel('framework/skills/project/framework-init/SKILL.md'),
      );
    },
  },
  {
    name: 'resolveSkillBudget: 有 override 用 override，无则用 default',
    run: () => {
      const rule = {
        default_budget: 150,
        overrides: [{ skill: 'business-ut', budget: 250, reason: 'x' }],
      };
      assert(resolveSkillBudget('business-ut', rule).budget === 250, 'override 未生效');
      assert(resolveSkillBudget('spec', rule).budget === 150, 'default 未生效');
    },
  },
  {
    name: 'scanSkillBodyBudget: 超预算 SKILL.md 被 FAIL 命中',
    run: () => {
      const { tmp, fw } = mkConsumerProject('sbb-over-');
      const longBody = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
      writeText(path.join(fw, 'skills', 'feature', 'demo', 'SKILL.md'), longBody);
      const layout = inferRepoLayout(tmp);
      const violations = scanSkillBodyBudget(layout, { default_budget: 150 });
      assert(violations.length === 1, `violations=${violations.length}`);
      assert(violations[0].skillId === 'demo', violations[0].skillId);
      assert(violations[0].lines === 200, String(violations[0].lines));
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  },
  {
    name: 'scanSkillBodyBudget: override 放行原本超默认预算的 skill',
    run: () => {
      const { tmp, fw } = mkConsumerProject('sbb-ok-');
      const body = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
      writeText(path.join(fw, 'skills', 'feature', 'business-ut', 'SKILL.md'), body);
      const layout = inferRepoLayout(tmp);
      const rule = { default_budget: 150, overrides: [{ skill: 'business-ut', budget: 250, reason: 'x' }] };
      const violations = scanSkillBodyBudget(layout, rule);
      assert(violations.length === 0, `violations=${violations.length}`);
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  },
  {
    name: 'scanSkillBodyBudget: 本仓真实 10+1 个 SKILL.md 全部在批准预算内',
    run: () => {
      const layout = inferRepoLayout(repoRoot);
      const rule = {
        default_budget: 150,
        overrides: [
          { skill: 'framework-init', budget: 250, reason: 'x' },
          { skill: 'business-ut', budget: 250, reason: 'x' },
          { skill: 'catalog-bootstrap', budget: 250, reason: 'x' },
        ],
      };
      const violations = scanSkillBodyBudget(layout, rule);
      assert(
        violations.length === 0,
        violations.map(v => `${v.file}: ${v.lines}>${v.budget}`).join('; '),
      );
    },
  },
  {
    name: 'scanForcedFullRead: 命中「完整阅读 X（BLOCKER）」旧句式',
    run: () => {
      const { tmp, fw } = mkConsumerProject('ffr-hit-');
      writeText(
        path.join(fw, 'skills', 'feature', 'demo', 'SKILL.md'),
        '# demo\n\n完整阅读 [foo.md](../../reference/foo.md)（BLOCKER）\n',
      );
      const layout = inferRepoLayout(tmp);
      const hits = scanForcedFullRead(layout, {});
      assert(hits.length === 1, `hits=${hits.length}`);
      assert(hits[0].allowlisted === false, 'should not be allowlisted');
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  },
  {
    name: 'scanForcedFullRead: allowlist 命中项标记 allowlisted 不算违规',
    run: () => {
      const { tmp, fw } = mkConsumerProject('ffr-allow-');
      const relInFramework = 'skills/feature/demo/SKILL.md';
      writeText(
        path.join(fw, relInFramework),
        '# demo\n\n完整阅读 [foo.md](../../reference/foo.md)（BLOCKER）\n',
      );
      const layout = inferRepoLayout(tmp);
      // consumer layout 下报告路径带 framework/ 前缀（与 frameworkPhysicalRelPath 输出一致）。
      const rel = `framework/${relInFramework}`;
      const hits = scanForcedFullRead(layout, { allowlist: [{ file: rel, reason: 'x' }] });
      assert(hits.length === 1, `hits=${hits.length}`);
      assert(hits[0].allowlisted === true, 'should be allowlisted');
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  },
  {
    name: 'scanForcedFullRead: 新条件加载句式不误报',
    run: () => {
      const { tmp, fw } = mkConsumerProject('ffr-safe-');
      writeText(
        path.join(fw, 'skills', 'feature', 'demo', 'SKILL.md'),
        '# demo\n\n执行 Step 3 前：完整读 [foo.md](../../reference/foo.md)——细则在那里，含 8 项 BLOCKER 门禁。\n',
      );
      const layout = inferRepoLayout(tmp);
      const hits = scanForcedFullRead(layout, {});
      assert(hits.length === 0, hits.map(h => h.match).join(';'));
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  },
  {
    name: 'scanForcedFullRead: 本仓真实 skills/+templates/ 树零命中（C3-task2 已根治）',
    run: () => {
      const layout = inferRepoLayout(repoRoot);
      const hits = scanForcedFullRead(layout, {}).filter(h => !h.allowlisted);
      assert(hits.length === 0, hits.map(h => `${h.file}:${h.line} ${h.match}`).join('\n'));
    },
  },
  {
    name: 'scanForcedFullRead: 命中「引用的 reference 也是强制阅读」回退句式（codex review 补强）',
    run: () => {
      const { tmp, fw } = mkConsumerProject('ffr-refmandatory-');
      writeText(
        path.join(fw, 'skills', 'feature', 'demo', 'SKILL.md'),
        '# demo\n\n进入阶段前完整读 SKILL.md；引用到的 template/reference/checklist 也是强制阅读。\n',
      );
      const layout = inferRepoLayout(tmp);
      const hits = scanForcedFullRead(layout, {});
      assert(hits.length === 1, `hits=${hits.length}`);
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  },
  {
    name: 'scanForcedFullRead: 「僅在触发时才读 reference」表述不误报',
    run: () => {
      const { tmp, fw } = mkConsumerProject('ffr-refsafe-');
      writeText(
        path.join(fw, 'skills', 'feature', 'demo', 'SKILL.md'),
        '# demo\n\nSKILL.md 内条件加载索引指向的 reference/template/checklist 仅在对应场景触发时才读，不是入口即全读。\n',
      );
      const layout = inferRepoLayout(tmp);
      const hits = scanForcedFullRead(layout, {});
      assert(hits.length === 0, hits.map(h => h.match).join(';'));
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  },
  {
    name: 'scanUnconditionalCorrectionConfirm: 无条件「经 correction.layer 确认」且全文未提 auto_confirm_eligible → 命中',
    run: () => {
      const { tmp, fw } = mkConsumerProject('cc-hit-');
      writeText(
        path.join(fw, 'skills', 'feature', 'demo', 'SKILL.md'),
        '# demo\n\n中途修正按三问分层，经 `correction.layer` 确认后只改根因层。\n',
      );
      const layout = inferRepoLayout(tmp);
      const hits = scanUnconditionalCorrectionConfirm(layout, {});
      assert(hits.length === 1, `hits=${hits.length}`);
      assert(hits[0].allowlisted === false, 'should not be allowlisted');
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  },
  {
    name: 'scanUnconditionalCorrectionConfirm: 同文件已提及 auto_confirm_eligible → 不误报',
    run: () => {
      const { tmp, fw } = mkConsumerProject('cc-safe-');
      writeText(
        path.join(fw, 'skills', 'feature', 'demo', 'SKILL.md'),
        '# demo\n\n先跑 --correction-init；auto_confirm_eligible=true 可直接实施，否则须经 `correction.layer` 1/2 确认。\n',
      );
      const layout = inferRepoLayout(tmp);
      const hits = scanUnconditionalCorrectionConfirm(layout, {});
      assert(hits.length === 0, hits.map(h => h.match).join(';'));
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  },
  {
    name: 'scanUnconditionalCorrectionConfirm: allowlist 命中项标记 allowlisted 不算违规',
    run: () => {
      const { tmp, fw } = mkConsumerProject('cc-allow-');
      const relInFramework = 'skills/feature/demo/SKILL.md';
      writeText(
        path.join(fw, relInFramework),
        '# demo\n\n经 `correction.layer` 确认后只改根因层。\n',
      );
      const layout = inferRepoLayout(tmp);
      const rel = `framework/${relInFramework}`;
      const hits = scanUnconditionalCorrectionConfirm(layout, { allowlist: [{ file: rel, reason: 'x' }] });
      assert(hits.length === 1, `hits=${hits.length}`);
      assert(hits[0].allowlisted === true, 'should be allowlisted');
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  },
  {
    name: 'scanUnconditionalCorrectionConfirm: 不提 correction.layer 的普通确认句式不误报',
    run: () => {
      const { tmp, fw } = mkConsumerProject('cc-unrelated-');
      writeText(
        path.join(fw, 'skills', 'feature', 'demo', 'SKILL.md'),
        '# demo\n\nplan.ok_to_code 编号确认（1=OK 可编码 2=继续改 plan）才能进 coding。\n',
      );
      const layout = inferRepoLayout(tmp);
      const hits = scanUnconditionalCorrectionConfirm(layout, {});
      assert(hits.length === 0, hits.map(h => h.match).join(';'));
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  },
  {
    name: 'scanUnconditionalCorrectionConfirm: 本仓真实 skills/+templates/ 树零命中（codex review 修复后回归）',
    run: () => {
      const layout = inferRepoLayout(repoRoot);
      const hits = scanUnconditionalCorrectionConfirm(layout, {}).filter(h => !h.allowlisted);
      assert(hits.length === 0, hits.map(h => `${h.file}:${h.line} ${h.match}`).join('\n'));
    },
  },
  {
    name: 'checkEntryTemplateBudget: 超行数与缺骨架标记均报告',
    run: () => {
      const { tmp, fw } = mkConsumerProject('etb-over-');
      const longBody = Array.from({ length: 130 }, (_, i) => `line ${i}`).join('\n');
      writeText(path.join(fw, 'templates', 'AGENTS.md.template'), longBody);
      const layout = inferRepoLayout(tmp);
      const report = checkEntryTemplateBudget(layout, {
        max_lines: 120,
        required_markers: ['L0', '修正三问', '红线清单'],
      });
      assert(report.exists, 'should exist');
      assert(report.lines === 130, String(report.lines));
      assert(report.lines > report.maxLines, 'should exceed budget');
      assert(report.missingMarkers.length === 3, report.missingMarkers.join(','));
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  },
  {
    name: 'checkEntryTemplateBudget: 本仓真实模板在预算内且骨架齐全',
    run: () => {
      const layout = inferRepoLayout(repoRoot);
      const report = checkEntryTemplateBudget(layout, {
        max_lines: 120,
        required_markers: ['L0', 'L1', 'L2', '修正三问', '红线清单'],
      });
      assert(report.exists, 'AGENTS.md.template should exist');
      assert(report.lines <= report.maxLines, `lines=${report.lines} > max=${report.maxLines}`);
      assert(report.missingMarkers.length === 0, report.missingMarkers.join(','));
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
