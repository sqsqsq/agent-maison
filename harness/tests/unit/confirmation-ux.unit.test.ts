// confirmation-ux.unit.test.ts — check-skills-confirmation-ux 单元测试

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { lintConfirmationUx, lintRegistryOptionsSchema, lintRegistrySkillPaths } from '../../scripts/check-skills-confirmation-ux';
import { detectRepoLayout } from '../../repo-layout';
import { externalStandaloneLayout } from '../utils/layout-test-helper';
import type { UnitCaseResult } from '../run-unit';

const { projectRoot: REPO_ROOT } = detectRepoLayout(__dirname);

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function registryEntryYaml(opts: {
  id: string;
  menu: string;
  portables: string[];
  matrixPortables?: string[];
}): string {
  const optionRows = opts.portables
    .map((p, i) => `      - value: v${i}\n        label: "L${i}"\n        portable: "${p}"`)
    .join('\n');
  const matrixRows = (opts.matrixPortables ?? [])
    .map((p, i) => `      - value: m${i}\n        label: "M${i}"\n        portable: "${p}"`)
    .join('\n');
  return (
    `schema_version: "2.0"\n\nentries:\n`
    + `  - id: ${opts.id}\n    skill: "_cross_phase"\n    class: enum\n`
    + `    portable_menu: "${opts.menu}"\n    options:\n${optionRows}\n`
    + (matrixRows ? `    matrix_options:\n${matrixRows}\n` : '')
  );
}

function ordinalMismatches(text: string) {
  return lintRegistryOptionsSchema(text, 'skills/reference/confirmation-registry.yaml')
    .filter(r => r.id === 'registry_portable_menu_ordinal_mismatch');
}

const NEXT_STEP_PORTABLES = ['1=进入下一 Skill', '2=暂停', '3=其它（说明）'];

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'lintRegistryOptionsSchema: portable_menu 缺编号段（phase.next_step 回归）→ BLOCKER',
    run: () => {
      const text = registryEntryYaml({
        id: 'phase.next_step',
        menu: '1=进入下一plan=暂停 3=其它',
        portables: NEXT_STEP_PORTABLES,
      });
      const hits = ordinalMismatches(text);
      assert(hits.length === 1, `expected 1 ordinal mismatch blocker, got ${hits.length}`);
      assert(hits[0]!.details!.includes('phase.next_step'), 'blocker must name the entry id');
    },
  },
  {
    name: 'lintRegistryOptionsSchema: portable_menu 序号与 options 一致 → 无 BLOCKER',
    run: () => {
      const text = registryEntryYaml({
        id: 'phase.next_step',
        menu: '1=进入下一 Skill 2=暂停 3=其它',
        portables: NEXT_STEP_PORTABLES,
      });
      assert(ordinalMismatches(text).length === 0, 'consistent menu must not blocker');
    },
  },
  {
    name: 'lintRegistryOptionsSchema: portable_menu 序号重复（1=A 1=B 2=C）→ BLOCKER',
    run: () => {
      const text = registryEntryYaml({
        id: 'phase.next_step',
        menu: '1=进入下一 Skill 1=暂停 2=其它',
        portables: NEXT_STEP_PORTABLES,
      });
      assert(ordinalMismatches(text).length === 1, 'duplicate menu ordinal must blocker');
    },
  },
  {
    name: 'lintRegistryOptionsSchema: portable_menu 序号乱序（2=B 1=A）→ BLOCKER',
    run: () => {
      const text = registryEntryYaml({
        id: 'phase.next_step',
        menu: '2=暂停 1=进入下一 Skill 3=其它',
        portables: NEXT_STEP_PORTABLES,
      });
      assert(ordinalMismatches(text).length === 1, 'out-of-order menu ordinals must blocker');
    },
  },
  {
    name: 'lintRegistryOptionsSchema: 散文/动态 portable_menu 不参与序号对照',
    run: () => {
      const text = registryEntryYaml({
        id: 'setup.adapter',
        menu: '从 materialized_adapters 已物化列表编号选择',
        portables: ['1=从已物化列表选'],
      });
      assert(ordinalMismatches(text).length === 0, 'prose menu must not blocker');
    },
  },
  {
    name: 'lintRegistryOptionsSchema: matrix_options 序号不计入 portable_menu 对照',
    run: () => {
      const text = registryEntryYaml({
        id: 'spec.terminology',
        menu: '1=全部确认high行 2=逐行确认 3=逐行修改',
        portables: ['1=全部确认 high 行', '2=逐行确认', '3=逐行修改'],
        matrixPortables: ['1=确认该行', '2=改映射'],
      });
      assert(ordinalMismatches(text).length === 0, 'matrix_options must not join the comparison');
    },
  },
  {
    name: 'lintConfirmationUx: SSOT + registry exist → no BLOCKER',
    run: () => {
      const out = lintConfirmationUx({ projectRoot: REPO_ROOT });
      const blockers = out.filter(r => r.status === 'FAIL');
      assert(blockers.length === 0, `unexpected blockers: ${blockers.map(b => b.details).join('; ')}`);
    },
  },
  {
    name: 'lintConfirmationUx: registry has ≥20 entries',
    run: () => {
      const out = lintConfirmationUx({ projectRoot: REPO_ROOT });
      const sizeWarn = out.find(r => r.id === 'registry_size');
      assert(!sizeWarn, 'registry too small');
    },
  },
  {
    name: 'lintConfirmationUx: Claude templates widget BLOCKER',
    run: () => {
      const out = lintConfirmationUx({ projectRoot: REPO_ROOT });
      const fails = out.filter(r => r.status === 'FAIL' && r.id.startsWith('claude_'));
      assert(fails.length === 0, `claude template blockers: ${fails.map(f => f.details).join('; ')}`);
    },
  },
  {
    name: 'lintConfirmationUx: external frameworkRoot 不 infer projectRoot',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cux-ext-'));
      const layout = externalStandaloneLayout(tmp);
      const out = lintConfirmationUx({ projectRoot: tmp, layout });
      const ssotFail = out.find(r => r.status === 'FAIL' && r.id === 'ssot_exists');
      assert(!ssotFail, `should resolve SSOT via layout: ${ssotFail?.details ?? ''}`);
    },
  },
  {
    name: 'lintConfirmationUx: allowlisted _cross_phase has no registry_skill_path WARN',
    run: () => {
      const out = lintConfirmationUx({ projectRoot: REPO_ROOT });
      const crossWarn = out.filter(
        r => r.id === 'registry_skill_path' && r.details?.includes('_cross_phase'),
      );
      assert(crossWarn.length === 0, 'allowlisted _cross_phase must not warn');
    },
  },
  {
    name: 'lintRegistrySkillPaths: non-allowlist _typo still WARN',
    run: () => {
      const layout = detectRepoLayout(__dirname);
      const snippet = '- id: x\n  skill: "_typo"\n  class: enum\n';
      const pathWarns = lintRegistrySkillPaths(
        snippet,
        layout,
        'skills/reference/confirmation-registry.yaml',
      );
      assert(
        pathWarns.some(r => r.id === 'registry_skill_path' && r.details?.includes('_typo')),
        'non-allowlist _typo must still warn',
      );
    },
  },
  {
    // e5d8a2c4 T4 整机链首跑抓到的真 bug（2026-08-06）：本文件的解析全是手写正则、
    // 锚死在 `\n` 上（`/\n    options:\n/`）。宿主 `core.autocrlf=true` 时 clone 出来
    // 的 YAML 是 CRLF，`options:` 后面是 `\r\n`，模式恒不匹配 → registry 每个条目都报
    // "缺少 options 数组"。实测：**同一份发布件**，LF 副本 check:global 18/18 PASS，
    // autocrlf clone 出来的副本 **44 个 BLOCKER**。
    //
    // 断言直接喂 CRLF 文本，不经文件——`readTextNormalized` 是读入口的归一，
    // 而这里钉的是"解析器在 CRLF 上不得误报"这条更强的性质：即便将来有人绕过读入口
    // 直接把 CRLF 串传进来，也不该崩。
    name: 'CRLF 回归：registry 文本为 CRLF 时不得误报 options 缺失（整机链实测事故）',
    run: () => {
      const lf = registryEntryYaml({
        id: 'phase.next_step',
        menu: '1=进入下一 Skill 2=暂停 3=其它（说明）',
        portables: NEXT_STEP_PORTABLES,
      });
      const crlf = lf.replace(/\n/g, '\r\n');
      assert(crlf.includes('\r\n'), '夹具必须真的是 CRLF（否则这条用例空转）');

      const lfBlockers = lintRegistryOptionsSchema(lf, 'r.yaml').filter(r => r.severity === 'BLOCKER');
      assert(lfBlockers.length === 0, `LF 基线本应无 BLOCKER，实得 ${lfBlockers.map(b => b.id).join(',')}`);

      const crlfBlockers = lintRegistryOptionsSchema(crlf, 'r.yaml').filter(r => r.severity === 'BLOCKER');
      assert(
        crlfBlockers.length === 0,
        `CRLF 下不得产生 BLOCKER，实得 [${crlfBlockers.map(b => b.id).join(',')}]`
          + '——手写正则锚在 `\\n` 上时会把整份 registry 判成"缺 options"',
      );
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

if (require.main === module) {
  const r = runAll();
  for (const x of r) {
    console.log(x.ok ? `PASS ${x.name}` : `FAIL ${x.name}: ${x.error}`);
  }
  process.exit(r.every(x => x.ok) ? 0 : 1);
}
