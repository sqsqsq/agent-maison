// ============================================================================
// visual-diff-nav-migrate.ts — nav 配置 2.0 迁移 + identity 候选生成 CLI
// （visual-capability-truth S2 / P0-C，tasks 2.7）
// ----------------------------------------------------------------------------
// - 旧数组格式 → schema 2.0（steps 原样）；
// - 缺 identity 的屏生成候选：候选文本取自 ui-spec 该屏组件树文本，按「独特」机器判据
//   过滤（目标屏 corpus 存在 且 其他全部 P0 屏 corpus document_frequency=0），跨屏判别
//   度排序（df=0 长文本优先）；取前 2 条组成 all_of；
// - 候选恒 `proposed: true`——**不自动当已验证 identity**（pixel_1to1 P0 屏在人工确认
//   前按缺 identity FAIL，宁停不猜）；确认=人工把 proposed 改 false（或删除该字段）。
// 用法（harness 目录）：
//   npm run visual-diff-nav:migrate -- --project-root <宿主根> --feature <feature> [--apply]
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  loadVisualDiffNavConfigV2,
  visualDiffNavConfigPath,
  navKeyMatchesTarget,
  canonicalOverlayBase,
  type NavConfigV2,
  type NavIdentityMember,
} from './visual-diff-nav';
import { collectP0VisualTargetIds } from './visual-diff-targets';
import {
  loadUiSpecFile,
  uiSpecAbsPath,
  type UiSpecDoc,
  type UiSpecComponentNode,
} from '../../../harness/scripts/utils/ui-spec-shared';

/** 单屏组件树文本 corpus（componentNode.text 全收集） */
export function collectScreenTextCorpus(doc: UiSpecDoc, screenId: string): string[] {
  const base = canonicalOverlayBase(screenId);
  const screen = (doc.screens ?? []).find(s => s.id === screenId || s.id === base);
  if (!screen?.root) return [];
  const texts: string[] = [];
  const walk = (n: UiSpecComponentNode): void => {
    const t = (n as { text?: unknown }).text;
    if (typeof t === 'string' && t.trim()) texts.push(t.trim());
    for (const c of n.children ?? []) walk(c);
  };
  walk(screen.root);
  return texts;
}

/** 候选生成：目标屏独特文本（其他 P0 屏 df=0），df=0 内按长度降序（判别度近似） */
export function generateIdentityCandidates(
  doc: UiSpecDoc,
  targetId: string,
  allP0TargetIds: string[],
): NavIdentityMember[] {
  const own = collectScreenTextCorpus(doc, targetId);
  const otherCorpora = allP0TargetIds
    .filter(t => canonicalOverlayBase(t) !== canonicalOverlayBase(targetId))
    .map(t => new Set(collectScreenTextCorpus(doc, t)));
  const unique = [...new Set(own)].filter(t => !otherCorpora.some(c => c.has(t)));
  unique.sort((a, b) => b.length - a.length || a.localeCompare(b));
  return unique.slice(0, 2).map(text => ({ text }));
}

export interface NavMigrateResult {
  exitCode: number;
  migrated: boolean;
  candidatesFor: string[];
}

export function navMigrateCliMain(argv: string[], cwd: string): NavMigrateResult {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const apply = argv.includes('--apply');
  const projectRoot = path.resolve(cwd, get('--project-root') ?? '.');
  const feature = get('--feature');
  if (!feature) {
    console.error('[nav-migrate] 缺 --feature <feature>');
    return { exitCode: 2, migrated: false, candidatesFor: [] };
  }
  const navPath = visualDiffNavConfigPath(projectRoot, feature);
  const v2 = loadVisualDiffNavConfigV2(projectRoot, feature);
  if (!v2) {
    console.error(`[nav-migrate] nav 配置不存在/不可解析：${navPath}`);
    return { exitCode: 2, migrated: false, candidatesFor: [] };
  }
  const doc = loadUiSpecFile(uiSpecAbsPath(projectRoot, feature));
  if (!doc) {
    console.error('[nav-migrate] ui-spec.yaml 不存在/不可解析——候选生成需要屏文本 corpus');
    return { exitCode: 2, migrated: false, candidatesFor: [] };
  }
  const p0Targets = collectP0VisualTargetIds(doc);
  const candidatesFor: string[] = [];
  const out: NavConfigV2 = { schema_version: '2.0', screens: { ...v2.screens } };
  for (const [key, entry] of Object.entries(out.screens)) {
    if (entry.identity) continue;
    const target = p0Targets.find(t => t === key) ?? p0Targets.find(t => navKeyMatchesTarget(key, t));
    if (!target) continue;
    const members = generateIdentityCandidates(doc, target, p0Targets);
    if (members.length === 0) {
      console.log(`  no-candidate      ${key}（无跨屏独特文本——须人工写 id/route 锚点或文本组联合）`);
      continue;
    }
    out.screens[key] = { ...entry, identity: { all_of: members, proposed: true } };
    candidatesFor.push(key);
    console.log(
      `  candidate         ${key} ← ${members.map(m => `「${m.text}」`).join(' + ')}（proposed，须人工确认后参与 gate）`,
    );
  }
  if (apply) {
    fs.writeFileSync(navPath, `${JSON.stringify(out, null, 2)}\n`, 'utf-8');
    console.log(`[nav-migrate] 已写回 2.0：${navPath}`);
  } else {
    console.log('[nav-migrate] dry-run（加 --apply 落盘）');
  }
  console.log(
    `[nav-migrate] 屏 ${Object.keys(out.screens).length} 个；新生成候选 ${candidatesFor.length} 个（proposed）；` +
    '确认方式=人工核对候选文本确为该屏独有后将 proposed 置 false。',
  );
  return { exitCode: 0, migrated: apply, candidatesFor };
}

if (require.main === module) {
  process.exit(navMigrateCliMain(process.argv.slice(2), process.cwd()).exitCode);
}
