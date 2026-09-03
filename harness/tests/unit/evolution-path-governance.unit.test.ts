// ============================================================================
// evolution-path-governance.unit.test.ts — M5A t4 机械证明补套件（plan e2a7c4b9 §7）
// ============================================================================
// 覆盖（与 evolution-workspace-path.unit.test.ts 分工）：
//   proof 8  — legacy 平铺 Feature 全链路行为与改造前一致（枚举/receipt/spec/goal）
//   proof 9  — 判别 fail-closed 四种情形（混合/缺 yaml/孤儿/非法 cu- payload）
//   proof 10 — 旧根路径零残留（生产代码 grep 断言写成测试 + fixture 无旧布局）
//   hooks 黑盒 — 发布件 Stop/verifier hook 对 CU Feature 解析物理路径（默认/自定义
//               pattern、非法 cu-/SSOT 缺失 fail-closed，任何输出不含编码 id）
// proof 6 在 component-closure 套件（input_fingerprint stale 既有机制回归，见三列表）。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync, type SpawnSyncReturns } from 'child_process';

import {
  enumerateFeatures,
  featureFilePath,
  featureDir,
  receiptDirPath,
  resolveFeatureArtifact,
} from '../../config';
import { encodeCuFeatureId, featureRelativePath } from '../../scripts/utils/feature-identity';
import { detectRepoLayout, frameworkAbs } from '../../repo-layout';
import { loadCatalog } from '../../scripts/utils/catalog-parser';
import { scanReceiptPathReconcileCandidates } from '../../scripts/utils/receipt-path-reconcile';
import { resolveGoalReportDir } from '../../scripts/utils/goal-manifest';
import { loadCanonicalBlueprint } from '../../scripts/utils/component-blueprint-path';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { verifierReportJsonPath } from '../../scripts/utils/verifier-evidence';
// 3.0.0 verifier hook 协议（subject 绑定的 request/result 块）——H6/H7 走生产夹具，不手拼旧 payload
import { makeVerifierProject, reportsDirOf, runVerifierRound, seedPhase } from '../utils/verifier-identity-fixture';

interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const LAYOUT = detectRepoLayout(__dirname);
const CHECK_PHASE_HOOK = frameworkAbs(LAYOUT, 'agents/claude/templates/hooks/check-phase-completion.mjs');
const VERIFIER_HOOK = frameworkAbs(LAYOUT, 'agents/claude/templates/hooks/record-verifier-report.mjs');
const SCRIPTS_DIR = path.resolve(__dirname, '..', '..', 'scripts');
const HOOKS_DIR = frameworkAbs(LAYOUT, 'agents/claude/templates/hooks');

const FIXTURE_VALID = path.resolve(__dirname, '..', 'fixtures', 'component-blueprint', 'valid');
const BLUEPRINT_ID = 'ledger-app-blueprint';
const COMPONENT_ID = 'ledger';
const UNIT_IDS = ['ledger-consumer', 'ledger-recovery', 'ledger-refresh', 'ledger-summary'];

function test(name: string, body: () => void): UnitCaseResult {
  try {
    body();
    return { name, ok: true };
  } catch (error) {
    return { name, ok: false, error: (error as Error).stack ?? (error as Error).message };
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'maison-gov-'));
}

function rmDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

/** 纯平铺 legacy 工程：doc/features/demo/{spec,plan,coding,review,...}，无 blueprint/ */
function buildFlatProject(dir: string): string {
  const fd = path.join(dir, 'doc', 'features', 'demo');
  fs.mkdirSync(path.join(fd, 'spec'), { recursive: true });
  fs.mkdirSync(path.join(fd, 'plan'), { recursive: true });
  fs.writeFileSync(path.join(fd, 'spec', 'spec.md'), '# demo spec\n', 'utf8');
  fs.writeFileSync(path.join(fd, 'plan', 'plan.md'), '# demo plan\n', 'utf8');
  fs.writeFileSync(path.join(fd, 'contracts.yaml'), 'feature: demo\nversion: "1"\n', 'utf8');
  // 平铺族 receipt（receipt reconcile 枚举目标）+ module catalog（catalog 生产入口）
  fs.mkdirSync(path.join(fd, 'coding'), { recursive: true });
  fs.writeFileSync(
    path.join(fd, 'coding', 'phase-completion-receipt.md'),
    '---\nfeature: demo\nphase: coding\nstatus: passed\n---\n\n完成。\n',
    'utf8',
  );
  fs.mkdirSync(path.join(dir, 'doc'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'doc', 'module-catalog.yaml'), 'modules: []\n', 'utf8');
  return dir;
}

/** CU 工程：复制 fixture 的单工作区（proof 9 hooks 用）+ 发布件 SSOT 副本（hook 经
 * <projectRoot>/framework/harness/scripts/utils/feature-identity.js 加载，见
 * check-phase-completion.mjs resolveFeatureRel：SSOT 缺失 → null → fail-closed）。 */
function buildCuProject(dir: string): string {
  const fd = path.join(dir, 'doc', 'features');
  const ws = path.join(fd, BLUEPRINT_ID);
  fs.mkdirSync(path.join(ws, 'blueprint'), { recursive: true });
  fs.copyFileSync(
    path.join(FIXTURE_VALID, 'doc', 'features', BLUEPRINT_ID, 'blueprint', 'component-blueprint.yaml'),
    path.join(ws, 'blueprint', 'component-blueprint.yaml'),
  );
  for (const unitId of UNIT_IDS) {
    const src = path.join(FIXTURE_VALID, 'doc', 'features', BLUEPRINT_ID, unitId);
    const cu = path.join(ws, unitId);
    fs.mkdirSync(cu, { recursive: true });
    fs.copyFileSync(path.join(src, 'change-unit.yaml'), path.join(cu, 'change-unit.yaml'));
  }
  fs.mkdirSync(path.join(dir, 'framework', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'framework', 'workflows'), { recursive: true });
  // hook 的 projectRoot 判定标记（PROJECT_ROOT_MARKERS：framework/harness/scripts/check-receipt.ts）
  // ——缺失时 resolveProjectRoot 无法锚定 dir，会落到 hook 自锚/进程 cwd（H1-H6 假绿风险）
  fs.mkdirSync(path.join(dir, 'framework', 'harness', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'framework', 'harness', 'scripts', 'check-receipt.ts'), '// marker\n', 'utf8');
  // 发布件内唯一 SSOT 副本（Hook 依赖；缺失即 fail-closed——H4 专门删除它做负例）
  const ssotDir = path.join(dir, 'framework', 'harness', 'scripts', 'utils');
  fs.mkdirSync(ssotDir, { recursive: true });
  fs.copyFileSync(
    path.resolve(__dirname, '..', '..', 'scripts', 'utils', 'feature-identity.js'),
    path.join(ssotDir, 'feature-identity.js'),
  );
  return dir;
}

// --------------------------------------------------------------------------
// proof 8：legacy 平铺 Feature 全链路照常（与改造前一致）
// --------------------------------------------------------------------------
function proof8_flatFullChain(): void {
  const dir = makeTmp();
  try {
    buildFlatProject(dir);
    // 配置 reports_dir_pattern（receipt reconcile 的启用条件；与改造前一致的默认形态）
    writeConfig(dir, {
      features_dir: 'doc/features',
      receipt_dir_pattern: 'doc/features/<feature>/<phase>',
      reports_dir_pattern: 'doc/features/<feature>/<phase>/reports',
    });
    // 枚举：legacy feature 原样返回（无 cu- 污染、无 workspace 误判）
    const feats = enumerateFeatures(dir);
    assert(feats.length === 1, `纯平铺仓应恰好 1 个 feature：${JSON.stringify(feats.map(f => f.featureId))}`);
    assert(feats[0].featureId === 'demo' && feats[0].kind === 'legacy', 'legacy kind/featureId 错误');
    assert(feats[0].relativePath === 'demo', 'legacy 相对路径必须原样');
    // 路径：featureDir / featureFilePath 走旧形态（doc/features/demo/...）
    assert(featureDir(dir, 'demo').replace(/\\/g, '/').endsWith('/doc/features/demo'), 'legacy featureDir 错误');
    const specAbs = featureFilePath(dir, 'demo', 'spec/spec.md').replace(/\\/g, '/');
    assert(specAbs.endsWith('/doc/features/demo/spec/spec.md'), `legacy spec 路径错误：${specAbs}`);
    // receipt（默认形态 = <features_dir>/<feature>/<phase>，与改造前 doc/features/demo/<phase> 一致）
    const rec = receiptDirPath(dir, 'demo', 'coding').replace(/\\/g, '/');
    assert(rec.endsWith('/doc/features/demo/coding'), `legacy receipt 路径错误：${rec}`);
    // spec artifact 读取（resolveFeatureArtifact 生产入口）
    const art = resolveFeatureArtifact(dir, 'demo', 'spec/spec.md');
    assert(art.exists && art.canonicalPath.replace(/\\/g, '/').endsWith('/doc/features/demo/spec/spec.md'),
      'legacy spec artifact 解析失败');
    // spec-loader 生产入口（SpecLoader.loadFeatureSpec；frameworkRoot=仓库根提供 phase-rules）
    const loader = new SpecLoader(
      dir,
      undefined,
      path.join(dir, 'doc', 'features'),
      path.resolve(__dirname, '..', '..', '..'),
    );
    const loadedSpec = loader.loadFeatureSpec('demo');
    assert(loadedSpec.feature === 'demo', 'SpecLoader.loadFeatureSpec 解析失败');
    // catalog 生产入口（loadCatalog 读 doc/module-catalog.yaml）
    const catalog = loadCatalog(dir);
    assert(catalog.ok === true, 'legacy 平铺仓 catalog 加载失败');
    if (catalog.ok) {
      assert(Array.isArray(catalog.catalog.modules), 'catalog.modules 应为数组');
    }
    // receipt reconcile 生产入口（scanReceiptPathReconcileCandidates 枚举平铺 receipt）
    // 平铺 receipt 的 legacy rel 被扫描出 0 patch（正链：枚举不炸、不误报）
    const candidates = scanReceiptPathReconcileCandidates(dir);
    assert(Array.isArray(candidates), 'receipt reconcile 扫描应返回数组');
    // Goal Mode 路径语义对平铺仓照常：resolveGoalReportDir 落 doc/features/demo/goal-runs/<runId>
    const goalDir = resolveGoalReportDir({ featuresDir: path.join(dir, 'doc', 'features'), feature: 'demo', runId: 'r-flat' });
    assert(goalDir.replace(/\\/g, '/').endsWith('/doc/features/demo/goal-runs/r-flat'),
      `legacy Goal Mode 报告目录错误：${goalDir}`);
  } finally {
    rmDir(dir);
  }
}

// --------------------------------------------------------------------------
// proof 9：判别 fail-closed 四种情形
// --------------------------------------------------------------------------
function proof9_failClosedModes(): void {
  const dir = makeTmp();
  try {
    fs.mkdirSync(path.join(dir, 'doc', 'features'), { recursive: true });
    const fd = path.join(dir, 'doc', 'features');

    // 情形 (a)：平铺产物与 blueprint/ 并存 → fail-closed
    const mixed = path.join(fd, 'mixed');
    fs.mkdirSync(path.join(mixed, 'blueprint'), { recursive: true });
    fs.writeFileSync(path.join(mixed, 'blueprint', 'component-blueprint.yaml'), 'artifact: component-blueprint@1\n', 'utf8');
    fs.mkdirSync(path.join(mixed, 'spec'), { recursive: true });
    fs.writeFileSync(path.join(mixed, 'spec', 'spec.md'), '# mixed\n', 'utf8');
    let threw = false;
    try { enumerateFeatures(dir); } catch (error) {
      threw = true;
      assert(String((error as Error).message).includes('歧义') || String((error as Error).message).includes('fail-closed'),
        `(a) 混合情形应点名歧义：${(error as Error).message}`);
    }
    assert(threw, '(a) 平铺产物与 blueprint/ 并存必须 fail-closed');
    fs.rmSync(mixed, { recursive: true, force: true });

    // 情形 (b)：blueprint/ 缺 component-blueprint.yaml → fail-closed
    const missing = path.join(fd, 'missing-bp');
    fs.mkdirSync(path.join(missing, 'blueprint'), { recursive: true });
    threw = false;
    try { enumerateFeatures(dir); } catch (error) {
      threw = true;
      assert(String((error as Error).message).includes('不完整 workspace'), `(b) 应点名不完整 workspace：${(error as Error).message}`);
    }
    assert(threw, '(b) blueprint/ 缺 component-blueprint.yaml 必须 fail-closed');
    fs.rmSync(missing, { recursive: true, force: true });

    // 情形 (c)：工作区子目录孤儿 Feature（有 phase 产物但缺 change-unit.yaml）→ fail-closed
    const orphanWs = path.join(fd, 'orphan-ws');
    fs.mkdirSync(path.join(orphanWs, 'blueprint'), { recursive: true });
    fs.writeFileSync(path.join(orphanWs, 'blueprint', 'component-blueprint.yaml'), 'artifact: component-blueprint@1\n', 'utf8');
    fs.mkdirSync(path.join(orphanWs, 'cu-orphan', 'spec'), { recursive: true });
    fs.writeFileSync(path.join(orphanWs, 'cu-orphan', 'spec', 'spec.md'), '# orphan\n', 'utf8');
    threw = false;
    try { enumerateFeatures(dir); } catch (error) {
      threw = true;
      assert(String((error as Error).message).includes('孤儿'), `(c) 应点名孤儿 Feature：${(error as Error).message}`);
    }
    assert(threw, '(c) 工作区子目录孤儿 Feature 必须 fail-closed');
    fs.rmSync(orphanWs, { recursive: true, force: true });

    // 情形 (d)：非法 cu- payload → SSOT fail-closed（路径解析抛错，绝不落到 flat 目录）
    for (const bad of ['cu-', 'cu-invalid', 'cu-!!!', 'cu-abcd']) {
      let threwD = false;
      try {
        featureRelativePath(bad);
      } catch (error) {
        threwD = true;
        assert(String((error as Error).message).includes('cu-') || String((error as Error).message).includes('change_unit'),
          `(d) 非法 cu- payload 应报 cu- 相关错误：${(error as Error).message}`);
      }
      assert(threwD, `(d) 非法 cu- payload 必须 fail-closed：${bad}`);
    }
    // 顶层合法 cu- 编码目录名（影子目录）→ enumerateFeatures fail-closed（proof 14 探测点）
    //（真正的编码影子目录用例在 evolution-workspace-path proof 14）
  } finally {
    rmDir(dir);
  }
}

// --------------------------------------------------------------------------
// proof 10：旧根路径零残留（grep 断言写成测试）
// --------------------------------------------------------------------------
function proof10_oldRootGrep(): void {
  const ignoredSuffixes = ['.test.ts', '.d.ts', '.md'];
  const walk = (dir: string, acc: string[]): void => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'reports') continue;
        walk(p, acc);
      } else if (ent.isFile() && /\.(ts|mjs|js)$/.test(ent.name)) {
        acc.push(p);
      }
    }
  };
  const files: string[] = [];
  // 扫描范围：harness 根（config.ts 等）+ harness/scripts + 发布件 hooks
  // （codex t4 一轮：原先 walk(harness 根) 是 no-op，config.ts 从未被扫——已修）
  walk(path.resolve(__dirname, '..', '..'), files);
  walk(path.resolve(__dirname, '..', '..', '..', 'agents', 'claude', 'templates', 'hooks'), files);
  const uniqueFiles = [...new Set(files)].filter(p => !ignoredSuffixes.some(s => p.endsWith(s)));
  let hits: string[] = [];
  for (const file of uniqueFiles) {
    const text = fs.readFileSync(file, 'utf-8');
    // 全文检测（不受行分隔影响；多行 path.join 也能命中段组合）。先剥离注释。
    const stripped = text
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*#.*$/gm, '');
    const joinScan = /path\.join\([\s\S]{0,160}?['"`]blueprint['"`][\s\S]{0,160}?['"`]component['"`][\s\S]{0,80}?\)/;
    const joinScanRev = /path\.join\([\s\S]{0,160}?['"`]component['"`][\s\S]{0,160}?['"`]blueprint['"`][\s\S]{0,80}?\)/;
    const literalScan = /(['"`])blueprint\/component\//;
    const segmentScan = /['"`]blueprint['"`]\s*,\s*['"`]component['"`]/;
    // 合法标识符/文档说明（component_blueprint_ref / component-blueprint / component-closure）
    // 不作为旧根拼接证据；剥离这些标识符后仍有命中才算残留。
    const withoutRefs = stripped.replace(/component_blueprint_ref/g, '').replace(/component-blueprint/g, '').replace(/component-closure/g, '');
    if (joinScan.test(withoutRefs) || joinScanRev.test(withoutRefs)
      || literalScan.test(withoutRefs) || segmentScan.test(withoutRefs)) {
      hits.push(file);
    }
  }
  assert(hits.length === 0, `生产代码存在旧根路径拼接（文件级）：\n${hits.join('\\n')}`);

  // fixture 树无旧布局：component-blueprint fixture 下不得有 blueprint/component/ 子树
  const fixtureWalk = (dir: string): string[] => {
    const out: string[] = [];
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'blueprint') {
          // blueprint/ 下不得有 component/ 目录（旧根）
          const compDir = path.join(p, 'component');
          if (fs.existsSync(compDir)) out.push(compDir);
        }
        out.push(...fixtureWalk(p));
      }
    }
    return out;
  };
  const fixtureHits = fixtureWalk(FIXTURE_VALID);
  assert(fixtureHits.length === 0, `fixture 存在旧布局 blueprint/component/：${fixtureHits.join(', ')}`);

  // resolver 对旧路径无回退读取（行为级，非仅 grep）：构造「只有旧根」的工程，
  // loadCanonicalBlueprint 必须报 component_blueprint_missing（error code），而非从旧根回退读取。
  const oldRootDir = makeTmp();
  try {
    const oldRoot = path.join(oldRootDir, 'blueprint', 'component', 'ledger');
    fs.mkdirSync(oldRoot, { recursive: true });
    fs.writeFileSync(path.join(oldRoot, 'component-blueprint.yaml'), 'artifact: component-blueprint@1\ncomponent_id: ledger\n', 'utf8');
    fs.mkdirSync(path.join(oldRootDir, 'doc', 'features'), { recursive: true });
    let errCode = '';
    try {
      loadCanonicalBlueprint(oldRootDir, 'ledger-app-blueprint');
    } catch (error) {
      errCode = (error as { code?: string }).code ?? (error as Error).message;
    }
    assert(String(errCode).includes('component_blueprint_missing'),
      `旧根存在时 resolver 必须报 missing 不回退：${errCode}`);
  } finally {
    rmDir(oldRootDir);
  }
}

// --------------------------------------------------------------------------
// hooks 黑盒（发布件 Stop hook 对 CU Feature 的物理路径解析）
// --------------------------------------------------------------------------
interface HookOutcome { status: number; stdout: string; stderr: string; }

function runHook(hookPath: string, payload: Record<string, unknown>, projectDir: string, extraEnv?: NodeJS.ProcessEnv): HookOutcome {
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: projectDir };
  if (extraEnv) Object.assign(env, extraEnv);
  const r: SpawnSyncReturns<string> = spawnSync('node', [hookPath], {
    input: JSON.stringify({ ...payload, cwd: projectDir }),
    env,
    encoding: 'utf-8',
    timeout: 20_000,
  });
  return {
    status: typeof r.status === 'number' ? r.status : -1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

function writeState(dir: string, feature: string, phase: string, sessionId: string): void {
  const p = path.join(dir, 'framework', 'harness', 'state', '.current-phase.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({
    schema_version: '1.1',
    feature,
    phase,
    status: 'running',
    session_id: sessionId,
    updated_at: new Date().toISOString(),
  }, null, 2) + '\n', 'utf-8');
}

function writeConfig(dir: string, paths: Record<string, string>): void {
  fs.writeFileSync(path.join(dir, 'framework.config.json'), JSON.stringify({
    schema_version: '1.0',
    project_name: 'gov-test',
    project_type: 'app',
    agent_adapter: 'claude',
    paths: { ...paths },
  }, null, 2), 'utf-8');
}

/** H1：默认 pattern 下 Stop hook 把 CU Feature 展开为物理路径（<blueprint_id>/<change_unit_id>/<phase>）
 * 口径：spec 禁止把编码 id 当物理路径、禁止 read/write 含编码 id 段；文案头部的
 * feature 标识（state.feature 原样回显）是状态标识而非路径，允许出现。 */
function hookH1_defaultPatternCuPhysicalDir(): void {
  const dir = makeTmp();
  try {
    buildCuProject(dir);
    const featureId = `cu-${Buffer.from(`${BLUEPRINT_ID}\u0000ledger-consumer`).toString('base64url')}`;
    writeConfig(dir, {
      features_dir: 'doc/features',
      receipt_dir_pattern: 'doc/features/<feature>/<phase>',
    });
    writeState(dir, featureId, 'coding', 'sid-h1');
    const out = runHook(CHECK_PHASE_HOOK, { session_id: 'sid-h1', stop_hook_active: false }, dir);
    assert(out.status === 2, `H1 未闭环应 exit 2：${out.status}`);
    const reason = out.stderr;
    // 回执目标 = CU 物理路径（不许把编码 id 当路径）
    assert(reason.includes(`doc/features/${BLUEPRINT_ID}/ledger-consumer/coding/phase-completion-receipt.md`),
      `H1 默认 pattern 应展开为 CU 物理目录：${reason.slice(0, 300)}`);
    // 路径类输出不得含编码 id 段（“目标：”行必须展开为物理路径）
    const targetLine = reason.split('\n').find(l => l.includes('目标：'));
    assert(targetLine !== undefined && !targetLine.includes(featureId),
      `H1 回执目标行不得含编码 id：${targetLine ?? '(无目标行)'}`);
  } finally {
    rmDir(dir);
  }
}

/** H2：自定义 pattern 保留前缀层级、只展开 <feature> 为物理路径 */
function hookH2_customPatternKeepsStructure(): void {
  const dir = makeTmp();
  try {
    buildCuProject(dir);
    const featureId = `cu-${Buffer.from(`${BLUEPRINT_ID}\u0000ledger-consumer`).toString('base64url')}`;
    writeConfig(dir, {
      features_dir: 'doc/features',
      receipt_dir_pattern: 'requirements/features/<feature>/phases/<phase>',
    });
    writeState(dir, featureId, 'coding', 'sid-h2');
    const out = runHook(CHECK_PHASE_HOOK, { session_id: 'sid-h2', stop_hook_active: false }, dir);
    assert(out.status === 2, `H2 未闭环应 exit 2：${out.status}`);
    const reason = out.stderr;
    assert(reason.includes(`requirements/features/${BLUEPRINT_ID}/ledger-consumer/phases/coding/phase-completion-receipt.md`),
      `H2 自定义 pattern 应保留前缀层级并展开物理路径：${reason.slice(0, 300)}`);
    const targetLine = reason.split('\n').find(l => l.includes('目标：'));
    assert(targetLine !== undefined && !targetLine.includes(featureId),
      `H2 回执目标行不得含编码 id：${targetLine ?? '(无目标行)'}`);
  } finally {
    rmDir(dir);
  }
}

/** H3：非法 cu- payload → Stop hook fail-closed（阻断理由点名，不落编码路径） */
function hookH3_invalidCuFailsClosed(): void {
  const dir = makeTmp();
  try {
    buildCuProject(dir);
    writeConfig(dir, {
      features_dir: 'doc/features',
      receipt_dir_pattern: 'doc/features/<feature>/<phase>',
    });
    // SSOT 存在但身份非法：cu- + 非 base64url 载荷
    writeState(dir, 'cu-invalid', 'coding', 'sid-h3');
    const out = runHook(CHECK_PHASE_HOOK, { session_id: 'sid-h3', stop_hook_active: false }, dir);
    assert(out.status === 2, `H3 应 exit 2（fail-closed）：${out.status}`);
    const reason = out.stderr;
    assert(reason.includes('无法解析') || reason.includes('identity 非法') || reason.includes('SSOT'),
      `H3 阻断应点名 CU 解析失败：${reason.slice(0, 200)}`);
    // 不得创建 doc/features/cu-invalid 影子目录
    assert(!fs.existsSync(path.join(dir, 'doc', 'features', 'cu-invalid')), 'H3 不得创建编码影子目录');
  } finally {
    rmDir(dir);
  }
}

/** H4：SSOT 缺失 → Stop hook fail-closed（阻断理由，不把编码 id 当路径） */
function hookH4_ssotMissingFailsClosed(): void {
  const dir = makeTmp();
  try {
    buildCuProject(dir);
    writeConfig(dir, {
      features_dir: 'doc/features',
      receipt_dir_pattern: 'doc/features/<feature>/<phase>',
    });
    const featureId = `cu-${Buffer.from(`${BLUEPRINT_ID}\u0000ledger-consumer`).toString('base64url')}`;
    writeState(dir, featureId, 'coding', 'sid-h4');
    // 移除 framework/harness/scripts/utils/feature-identity.js（SSOT 缺失）
    const ssot = path.join(dir, 'framework', 'harness', 'scripts', 'utils', 'feature-identity.js');
    fs.rmSync(ssot, { force: true });
    const out = runHook(CHECK_PHASE_HOOK, { session_id: 'sid-h4', stop_hook_active: false }, dir);
    assert(out.status === 2, `H4 应 exit 2（SSOT 缺失 fail-closed）：${out.status}`);
    const reason = out.stderr;
    assert(reason.includes('无法解析') || reason.includes('SSOT'),
      `H4 阻断应点名 SSOT 不可用：${reason.slice(0, 200)}`);
    assert(!reason.includes(`doc/features/${featureId}`), 'H4 不得把编码 id 当物理路径');
  } finally {
    rmDir(dir);
  }
}

/** H5：verifier hook 对非法 cu- 落 state 兜底（不创建影子目录；非 headless 路径保留
 * state 元数据是既有交互行为，headless 匿名化由 record-verifier-report-hook A 用例覆盖） */
function hookH5_verifierInvalidCuFallback(): void {
  const dir = makeTmp();
  try {
    buildCuProject(dir);
    writeConfig(dir, {
      features_dir: 'doc/features',
      receipt_dir_pattern: 'doc/features/<feature>/<phase>',
      reports_dir_pattern: 'doc/features/<feature>/<phase>/reports',
    });
    writeState(dir, 'cu-invalid', 'coding', 'sid-h5');
    const transcriptPath = path.join(dir, 'transcripts', 'verifier.jsonl');
    fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
    fs.writeFileSync(transcriptPath, JSON.stringify({ role: 'assistant', content: 'verdict: PASS' }) + '\n', 'utf-8');
    const out = runHook(VERIFIER_HOOK, { session_id: 'sid-h5', transcript_path: transcriptPath }, dir);
    assert(out.status === 0, `H5 verifier hook 应 exit 0（兜底）：${out.status}`);
    const fallbackMd = path.join(dir, 'framework', 'harness', 'state', 'last-verifier-report.md');
    const fallbackJson = path.join(dir, 'framework', 'harness', 'state', 'last-verifier-report.json');
    assert(fs.existsSync(fallbackMd) && fs.existsSync(fallbackJson), 'H5 应写 last-verifier-report 兜底');
    // 不得创建影子目录（核心 fail-closed 断言）
    assert(!fs.existsSync(path.join(dir, 'doc', 'features', 'cu-invalid')), 'H5 不得创建编码影子目录');
  } finally {
    rmDir(dir);
  }
}

/** verifier hook 解析 CU 物理路径所需的发布件内 SSOT 副本 + 工程根标记（同 buildCuProject 口径）。 */
function installCuHookSsot(root: string): void {
  fs.mkdirSync(path.join(root, 'framework', 'harness', 'scripts', 'utils'), { recursive: true });
  fs.writeFileSync(path.join(root, 'framework', 'harness', 'scripts', 'check-receipt.ts'), '// marker\n', 'utf8');
  fs.copyFileSync(
    path.resolve(__dirname, '..', '..', 'scripts', 'utils', 'feature-identity.js'),
    path.join(root, 'framework', 'harness', 'scripts', 'utils', 'feature-identity.js'),
  );
}

/** H6：无 reports_dir_pattern 时 verifier hook 默认报告落 <features_dir>/<blueprint>/<unit>/<phase>/reports
 *（BLOCKER2 正面用例：hooks 无 pattern 时不得回退 framework/harness/reports；3.0.0 起 hook 按
 * 调用侧 request 块归属、按 subject 分区落盘——路径口径与 TS 生产解析器 reportsDirOf 逐字对齐） */
function hookH6_verifierDefaultReportsUnderFeaturesDir(): void {
  const { root } = makeVerifierProject({ featuresDir: 'requirements/features', omitReportsDirPattern: true });
  try {
    installCuHookSsot(root);
    const featureId = encodeCuFeatureId(BLUEPRINT_ID, 'ledger-consumer');
    const coding = seedPhase(root, featureId, 'coding');
    const out = runVerifierRound({
      root, feature: featureId, phase: 'coding', requestPath: coding.requestPath, subjectId: coding.subjectId,
    });
    assert(out.status === 0, `H6 verifier hook 应 exit 0：${out.output}`);
    const reportJson = verifierReportJsonPath(reportsDirOf(root, featureId, 'coding'), coding.subjectId);
    const expectedDir = path.join(root, 'requirements', 'features', BLUEPRINT_ID, 'ledger-consumer', 'coding', 'reports');
    assert(path.dirname(reportJson) === expectedDir, `H6 生产解析器默认目录错误：${reportJson}`);
    assert(fs.existsSync(reportJson), `H6 默认报告未落 CU 物理目录（features_dir 派生）：${reportJson}`);
    const reportPosix = reportJson.replace(/\\/g, '/');
    assert(!reportPosix.includes(featureId) && !reportPosix.includes('/cu-'), `H6 报告路径不得含编码 id：${reportPosix}`);
    assert(!fs.existsSync(path.join(root, 'framework', 'harness', 'reports')), 'H6 不得写旧 framework/harness/reports 路径');
  } finally {
    rmDir(root);
  }
}

/** H7：verifier hook 对显式 custom pattern 保留前缀层级、只展开 <feature> 为物理路径
 *（OpenSpec task 8.7 b：record-verifier-report.mjs 同需覆盖 custom pattern） */
function hookH7_verifierCustomPatternKeepsStructure(): void {
  const { root } = makeVerifierProject({ reportsDirPattern: 'requirements/features/<feature>/phases/<phase>/reports' });
  try {
    installCuHookSsot(root);
    const featureId = encodeCuFeatureId(BLUEPRINT_ID, 'ledger-consumer');
    const coding = seedPhase(root, featureId, 'coding');
    const out = runVerifierRound({
      root, feature: featureId, phase: 'coding', requestPath: coding.requestPath, subjectId: coding.subjectId,
    });
    assert(out.status === 0, `H7 verifier hook 应 exit 0：${out.output}`);
    const reportJson = verifierReportJsonPath(reportsDirOf(root, featureId, 'coding'), coding.subjectId);
    const expectedDir = path.join(root, 'requirements', 'features', BLUEPRINT_ID, 'ledger-consumer', 'phases', 'coding', 'reports');
    assert(path.dirname(reportJson) === expectedDir, `H7 生产解析器 custom pattern 目录错误：${reportJson}`);
    assert(fs.existsSync(reportJson), `H7 报告未按 custom pattern 落盘：${reportJson}`);
    const reportPosix = reportJson.replace(/\\/g, '/');
    assert(!reportPosix.includes(featureId) && !reportPosix.includes('/cu-'), `H7 报告路径不得含编码 id：${reportPosix}`);
  } finally {
    rmDir(root);
  }
}

// --------------------------------------------------------------------------
// 注册
// --------------------------------------------------------------------------

const CASES: Array<{ name: string; fn: () => void }> = [
  { name: 'proof 8：legacy 平铺 Feature 全链路（枚举/路径/artifact/receipt）与改造前一致', fn: proof8_flatFullChain },
  { name: 'proof 9：判别 fail-closed 四种情形（混合/缺 yaml/孤儿/非法 payload）', fn: proof9_failClosedModes },
  { name: 'proof 10：旧根路径零残留（生产 grep 断言 + fixture 无旧布局）', fn: proof10_oldRootGrep },
  { name: 'hook H1：默认 pattern 下 CU Feature 展开为物理目录', fn: hookH1_defaultPatternCuPhysicalDir },
  { name: 'hook H2：自定义 pattern 保留前缀层级、只展开 <feature>', fn: hookH2_customPatternKeepsStructure },
  { name: 'hook H3：非法 cu- payload → Stop hook fail-closed', fn: hookH3_invalidCuFailsClosed },
  { name: 'hook H4：SSOT 缺失 → Stop hook fail-closed', fn: hookH4_ssotMissingFailsClosed },
  { name: 'hook H5：verifier hook 对非法 cu- 落 state 兜底、无编码 id', fn: hookH5_verifierInvalidCuFallback },
  { name: 'hook H6：无 reports pattern 时 verifier 默认报告落 features_dir（CU 物理目录、无编码 id）', fn: hookH6_verifierDefaultReportsUnderFeaturesDir },
  { name: 'hook H7：verifier hook 显式 custom pattern 保留前缀层级、只展开 <feature>', fn: hookH7_verifierCustomPatternKeepsStructure },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of CASES) {
    try {
      c.fn();
      results.push({ name: c.name, ok: true });
    } catch (error) {
      results.push({ name: c.name, ok: false, error: (error as Error).message });
    }
  }
  return results;
}
