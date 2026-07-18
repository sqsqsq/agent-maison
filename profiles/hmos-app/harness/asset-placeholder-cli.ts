// ============================================================================
// asset-placeholder-cli.ts — 分角色占位生成 CLI（blind-visual-hardening / codex 三轮 P1-5，
// 四轮 P0-1/P1-6 收口重写）
// ----------------------------------------------------------------------------
// 判定收口在 planPlaceholderGeneration（可测纯函数）：
//   - **只为 `placeholder: true` / `acquisition: placeholder` 声明的资产生成**——
//     非 placeholder 的真实素材缺失（crop/repo_assets/未声明）列入 blocked 并**非零退出**，
//     CLI 绝不代生成（洗白路径：真素材缺失→可见 SVG→sanity PASS→缺失被洗白）；
//   - 生成物内嵌 provenance marker（placeholderMarkerOf）——asset_placeholder_present
//     检查据此逐素材入视觉债务，brand-critical 占位 release 保持 BLOCKED；
//   - 多模块工程须显式 --module <package_path>（P1-6：不选第一个——写错模块 $r 解析不到
//     且 findModuleMediaFile 误判已物化）；单模块自动。
// 用法（在 framework/harness 目录）：
//   npm run ui-kit:placeholders -- --project-root <宿主根> --feature <feature> [--module <pkg>] [--apply]
// 退出码：0=计划干净；1=存在 blocked（真实素材缺失）；2=参数/环境错误。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { loadFrameworkConfig, featureFilePath } from '../../../harness/config';
import {
  loadUiSpecFile,
  uiSpecAbsPath,
} from '../../../harness/scripts/utils/ui-spec-shared';
import { ASSET_KEY_RE, generateRolePlaceholder, planPlaceholderGeneration } from './asset-integrity';
import { canonicalPkgPath, findModuleMediaFile } from './visual-parity-backstop';
import { validateProjectRelativePath } from '../../../harness/scripts/utils/project-relative-path';

const requireHarness = (p: string): unknown => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(p);
};

interface ContractsDoc {
  files?: string[];
  modules?: Array<{ name?: string; package_path: string }>;
}

function loadContracts(projectRoot: string, feature: string): ContractsDoc | null {
  const p = featureFilePath(projectRoot, feature, 'contracts.yaml');
  if (!fs.existsSync(p)) return null;
  try {
    const YAML = requireHarness('yaml') as { parse: (s: string) => unknown };
    return YAML.parse(fs.readFileSync(p, 'utf-8')) as ContractsDoc;
  } catch {
    return null;
  }
}

function labelFromKey(key: string): string {
  return key.replace(/^(bank_)?(logo|icon|ill|illustration|guide|promo|banner)_?/i, '').replace(/_/g, ' ').trim() || key;
}

export interface PlaceholderCliResult {
  exitCode: number;
  generated: number;
  blocked: string[];
}

/** 可测入口（codex 四轮：判定与执行分离；main 只做 argv 装配） */
export function placeholderCliMain(argv: string[], cwd: string): PlaceholderCliResult {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const apply = argv.includes('--apply');
  const projectRoot = path.resolve(cwd, get('--project-root') ?? '.');
  const feature = get('--feature');
  const moduleArg = get('--module');
  if (!feature) {
    console.error('[placeholders] 缺 --feature <feature>');
    return { exitCode: 2, generated: 0, blocked: [] };
  }
  loadFrameworkConfig(projectRoot);
  const uiDoc = loadUiSpecFile(uiSpecAbsPath(projectRoot, feature));
  if (!uiDoc) {
    console.error(`[placeholders] ui-spec.yaml 不存在/不可解析（feature=${feature}，projectRoot=${projectRoot}）`);
    return { exitCode: 2, generated: 0, blocked: [] };
  }
  const contracts = loadContracts(projectRoot, feature);
  const modules = (contracts?.modules ?? []).filter(m => typeof m?.package_path === 'string');
  if (modules.length === 0) {
    console.error('[placeholders] contracts.modules 为空——media 目标不可推导');
    return { exitCode: 2, generated: 0, blocked: [] };
  }
  // P1-6：多模块必须显式指定；单模块自动；--module 校验存在性（六轮 P0：canonical 比较——
  // contracts 里 Windows 反斜杠 `app\feature` 与归一化输入须同侧规范化）。
  let targetModule = modules[0].package_path;
  if (moduleArg) {
    const hit = modules.find(m => canonicalPkgPath(m.package_path) === canonicalPkgPath(moduleArg));
    if (!hit) {
      console.error(`[placeholders] --module "${moduleArg}" 不在 contracts.modules（候选：${modules.map(m => m.package_path).join(', ')}）`);
      return { exitCode: 2, generated: 0, blocked: [] };
    }
    targetModule = hit.package_path;
  } else if (modules.length > 1) {
    console.error(
      `[placeholders] 多模块工程须显式 --module <package_path>（候选：${modules.map(m => m.package_path).join(', ')}）` +
      '——写错模块 $r 解析不到且完整性检查会误判已物化，不代选第一个。',
    );
    return { exitCode: 2, generated: 0, blocked: [] };
  }
  let safeModuleRel: string;
  try {
    safeModuleRel = validateProjectRelativePath(projectRoot, targetModule, 'contracts.modules[].package_path');
  } catch (e) {
    console.error(`[placeholders] ${(e as Error).message}`);
    return { exitCode: 2, generated: 0, blocked: [] };
  }
  const targetMediaDir = path.join(projectRoot, safeModuleRel, 'src', 'main', 'resources', 'base', 'media');

  // 六轮 P1-1：**任何 fs 访问前**先全量校验 asset key（非法 key 曾先越界探测再"假跳过"退出 0）；
  // 非法 key 直接 blocked，且从 planner 输入中剔除（不参与 lookup）。
  // 七轮 P2：缺失/空白/非字符串 key 不再静默过滤（曾致 `{acquisition: placeholder}` 无 key
  // 条目被滤掉后 exit 0"计划干净"）——同列 blocked 非零退出。
  const preBlocked: Array<{ key: string; reason: string }> = [];
  const validAssets = ((uiDoc.assets ?? []) as Array<{ key?: unknown }>).filter((a, i) => {
    const k = a?.key;
    if (typeof k !== 'string' || !k.trim()) {
      preBlocked.push({ key: `assets[${i}]`, reason: `key 缺失/空白/非字符串（实际 ${JSON.stringify(k)}）——修正 ui-spec 后重跑` });
      return false;
    }
    if (ASSET_KEY_RE.test(k)) return true;
    preBlocked.push({ key: k, reason: `非法资源名（须匹配 ${ASSET_KEY_RE}）——拒绝任何探测/落盘` });
    return false;
  }) as Array<{ key?: string }>;
  const filteredDoc = { ...uiDoc, assets: validAssets } as typeof uiDoc;

  // 五轮 P1-3：已物化判定限定到**所选模块**（跨模块 first-match 会把 A 模块同名资源
  // 误判成 B 模块已物化）；六轮 P0：findModuleMediaFile 内部 canonical 双侧匹配。
  const restrict = new Set([safeModuleRel]);
  const plan = planPlaceholderGeneration(filteredDoc, key =>
    contracts ? findModuleMediaFile(projectRoot, contracts as never, key, restrict) : null,
  );
  plan.blocked.push(...preBlocked);

  for (const s of plan.skipped) console.log(`  skip(${s.reason})  ${s.key}`);
  let emitted = 0;
  for (const g of plan.generate) {
    const destAbs = path.resolve(targetMediaDir, `${g.key}.svg`);
    const rel = path.relative(path.resolve(projectRoot), destAbs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      plan.blocked.push({ key: g.key, reason: '目标路径越出宿主根——拒绝落盘' });
      continue;
    }
    if (apply) {
      const r = generateRolePlaceholder({ role: g.role, key: g.key, label: labelFromKey(g.key), destAbs });
      if (r.conflict) {
        // 六轮 P0：no-clobber——目标已存在异内容（真素材/他源），拒覆盖并计为阻塞
        plan.blocked.push({ key: g.key, reason: r.guidance ?? '目标已存在异内容，拒绝覆盖' });
        continue;
      }
      emitted++;
      console.log(`  ${String(r.kind).padEnd(18)} ${g.key}（${g.criticality}）→ ${path.relative(projectRoot, destAbs)}`);
    } else {
      emitted++;
      console.log(`  would-generate    ${g.key}（role=${g.role}/${g.criticality}）→ ${path.relative(projectRoot, destAbs)}`);
    }
  }
  for (const b of plan.blocked) console.error(`  BLOCKED           ${b.key}：${b.reason}`);
  console.log(
    `[placeholders] ${apply ? '生成' : 'dry-run'}：${emitted} 项占位，${plan.skipped.length} 项跳过，` +
    `${plan.blocked.length} 项阻塞${apply ? '' : '（加 --apply 落盘）'}`,
  );
  if (plan.blocked.length > 0) {
    console.error('[placeholders] 存在阻塞项（真实素材缺失/非法名/越界）——不代生成（走 spec/asset-request.md 问人或修正后重跑）');
    return { exitCode: 1, generated: emitted, blocked: plan.blocked.map(b => b.key) };
  }
  return { exitCode: 0, generated: emitted, blocked: [] };
}

if (require.main === module) {
  const r = placeholderCliMain(process.argv.slice(2), process.cwd());
  process.exit(r.exitCode);
}
