// ============================================================================
// forced-full-read-scan — 无条件强制全读句式黑名单（C3-task4 + codex review 补强）
// ============================================================================
// C3-task2 把 10 个 SKILL.md 的深层细则改写为「当 <场景> 时读 <文件>」条件加载形式；
// 本扫描防止未来新增退回旧的强制全读句式，覆盖两类形态：
//   1. 「完整阅读 <文件>（BLOCKER）」：动词+单一文件引用+紧跟 BLOCKER 括注、无条件触发语。
//      只匹配这一收紧形态，避免对"BLOCKER 门禁清单描述文字"之类无关共现误报。
//   2. 「被引用的 reference/template/checklist 也/皆/都(是)强制阅读」：C3 的核心是深层
//      细则移出主干、仅按场景条件加载；若入口文案又把"引用到的附属材料"整体打成强制阅读，
//      等于把移出去的内容用一句话原样拉回来，直接架空条件加载设计（曾在 AGENTS.md.template
//      入口执行规则里实际出现过，codex review 抓到）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import { frameworkAbs, frameworkPhysicalRelPath, type RepoLayout } from '../../repo-layout';

export interface ForcedFullReadAllowlistEntry {
  file: string;
  reason: string;
}

export interface ForcedFullReadRule {
  allowlist?: ForcedFullReadAllowlistEntry[];
}

export interface ForcedFullReadHit {
  file: string;
  line: number;
  match: string;
  allowlisted: boolean;
}

const SINGLE_FILE_REF = '(?:`[^`\\n]+`|\\[[^\\]\\n]+\\]\\([^)\\n]+\\)|\\S+\\.md)';
const FORCED_FULL_READ_RE = new RegExp(
  `完整(?:阅读|读)\\s*${SINGLE_FILE_REF}\\s*[（(]\\s*BLOCKER\\s*[）)]`,
);

/** 「引用到的 reference/template/checklist 也是/皆/都(是)强制阅读」——把条件加载的附属材料整体拉回强制全读。 */
const REFERENCE_MANDATORY_READ_RE = /(?:引用|reference|template|checklist)[^\n]{0,20}(?:也是|也|皆|都是|都)强制阅读/i;

const SCAN_EXTENSIONS = /\.(md|md\.template)$/i;

function collectMarkdownFiles(root: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(root)) return out;
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(abs);
        continue;
      }
      if (SCAN_EXTENSIONS.test(ent.name)) out.push(abs);
    }
  };
  walk(root);
  return out;
}

export function scanForcedFullRead(layout: RepoLayout, rule: ForcedFullReadRule): ForcedFullReadHit[] {
  const allowlist = new Set((rule.allowlist ?? []).map(e => e.file));
  const roots = [
    frameworkAbs(layout, 'skills'),
    frameworkAbs(layout, 'templates'),
  ];
  const hits: ForcedFullReadHit[] = [];
  for (const root of roots) {
    for (const abs of collectMarkdownFiles(root)) {
      const rel = frameworkPhysicalRelPath(layout, path.relative(layout.frameworkRoot, abs));
      const text = fs.readFileSync(abs, 'utf-8');
      const lines = text.replace(/\r\n?/g, '\n').split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        const m = FORCED_FULL_READ_RE.exec(lines[i]) ?? REFERENCE_MANDATORY_READ_RE.exec(lines[i]);
        if (m) {
          hits.push({ file: rel, line: i + 1, match: m[0], allowlisted: allowlist.has(rel) });
        }
      }
    }
  }
  return hits;
}
