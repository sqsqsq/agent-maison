import { runUnitCases } from '../utils/unit-cases';
// ============================================================================
// hylyre-keyset-consistency.unit.test.ts — 键集实体三方比对元门禁（t7c，plan e6a3c9f4）
// ----------------------------------------------------------------------------
// 动机（07-16 事故 B 断点 4）：hylyre 语法知识分布在三处——vendor 发布件（真源）、
// harness 键表（lint SSOT 镜像）、教学文档（agent 消费）——此前只靠人工同步纪律，
// 0.3.0→0.3.1 换发布件后文档/键表标签滞留 0.3.0。三处都写同一版本号也不代表字段
// 集合一致（codex round2），故本门禁做**键集实体比对**：
//   1. vendor 发布件内 hylyre/api/planned_step_keys.py 的 PLANNED_STEP_ROOT_KEYS
//      （源码树 vendor 直读 src/…；legacy wheel 布局零依赖 mini-zip 解包 + inflateRaw）
//      ≡ hylyre-planned-step-keys.ts 的同名导出；
//   2. 教学文档「## 根键 SSOT」清单 ≡ 键表 −（显式豁免 'action' legacy envelope，
//      文档刻意不教历史包络形态）；
//   3. 版本标签辅助比对：release.manifest.json hylyre_version ↔ 键表头注 ↔ 文档版本节
//      （源码布局钉 src 路径引用；legacy 布局钉 whl 文件名——公司仓无 whl 形态可过）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { PLANNED_STEP_ROOT_KEYS } from '../../scripts/utils/hylyre-planned-step-keys';
import {
  buildStandardHylyreDeriveKnowledge,
  buildStandardHylyreDerivePayloadBase,
  STANDARD_DERIVE_HINT_SCHEMA,
  resolveHylyreResetIdentity,
} from '../../scripts/utils/hylyre-standard-derive-knowledge';
import { extractDerivedPlanCases, lintHylyrePlanStepRules, parsePlannedStepsFromCell } from '../../scripts/utils/derived-hylyre-plan';
import { injectP0IdentityAssertions } from '../../scripts/utils/p0-identity-injection';
import { loadAppInstallCandidateMeta } from '../../../profiles/hmos-app/harness/hdc-runner';
import { resolveMainAbilityForBundle } from '../../../profiles/hmos-app/harness/resolve-main-ability';
import { STEP_SHAPE_CATALOG } from '../../scripts/utils/adhoc-derive-helpers';
import { normalizePlannedStep } from '../../scripts/utils/planned-step-normalizer';
import * as os from 'os';

interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');
const VENDOR_DIR = path.join(FRAMEWORK_ROOT, 'profiles', 'hmos-app', 'vendor', 'hylyre');
const KEYS_TS = path.join(FRAMEWORK_ROOT, 'harness', 'scripts', 'utils', 'hylyre-planned-step-keys.ts');
const FIELDS_MD = path.join(
  FRAMEWORK_ROOT,
  'profiles', 'hmos-app', 'skills', 'device-testing', 'reference', 'hylyre-planned-step-fields.md',
);

/** 文档刻意不教的 legacy 键（wheel/lint 接受，教学清单豁免） */
const DOC_EXEMPT_KEYS = new Set(['action']);

// ---------------------------------------------------------------------------
// 零依赖 zip 单文件读取（EOCD → 中央目录 → local header → inflateRaw）
// ---------------------------------------------------------------------------
function readZipEntry(zipPath: string, wantSuffix: string): string | null {
  const buf = fs.readFileSync(zipPath);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`EOCD not found in ${zipPath}`);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const cdCount = buf.readUInt16LE(eocd + 10);
  let p = cdOffset;
  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory header');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name.endsWith(wantSuffix)) {
      if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error('bad local file header');
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(dataStart, dataStart + compSize);
      return (method === 0 ? data : zlib.inflateRawSync(data)).toString('utf8');
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function loadManifestVersion(): string {
  const raw = fs.readFileSync(path.join(VENDOR_DIR, 'release.manifest.json'), 'utf-8');
  const manifest = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw) as {
    hylyre_version?: string;
  };
  assert(
    typeof manifest.hylyre_version === 'string' && manifest.hylyre_version.length > 0,
    'release.manifest.json 缺 hylyre_version',
  );
  return manifest.hylyre_version!;
}

const VENDOR_SRC_KEYS_PY = path.join(VENDOR_DIR, 'src', 'hylyre', 'api', 'planned_step_keys.py');

function vendorSourcePresent(): boolean {
  return fs.existsSync(VENDOR_SRC_KEYS_PY);
}

/** 静态读取源码；不导入/执行 vendor Python。 */
function readVendorPython(relative: string, version: string): string {
  let py: string | null;
  if (vendorSourcePresent()) {
    py = fs.readFileSync(path.join(VENDOR_DIR, 'src', relative), 'utf-8');
  } else {
    const wheelPath = path.join(VENDOR_DIR, `hylyre-${version}-py3-none-any.whl`);
    assert(
      fs.existsSync(wheelPath),
      `vendor 发布件不存在：既无 src/hylyre/api/planned_step_keys.py 也无 ${wheelPath}（manifest 声明 ${version}）`,
    );
    py = readZipEntry(wheelPath, relative);
    assert(py, `wheel 内未找到 ${relative}`);
  }
  return py!;
}

/** 支持发布件已有的 literal tuple 和 0.6.0 tuple(literal policy dict)。 */
function declarationKeys(py: string, name: string): string[] {
  const tuple = py.match(new RegExp(`^${name}(?:\\s*:[^=\\n]+)?\\s*=\\s*\\(([\\s\\S]*?)\\)`, 'm'));
  if (tuple) return [...tuple[1]!.matchAll(/["']([a-z_]+)["']/g)].map(match => match[1]!);
  const derived = py.match(new RegExp(`^${name}\\s*=\\s*tuple\\((\\w+)\\)`, 'm'));
  assert(derived, `${name} 不是已支持的静态键声明`);
  const mapping = py.match(new RegExp(`^${derived[1]}(?:\\s*:[^=\\n]+)?\\s*=\\s*\\{([\\s\\S]*?)^\\}`, 'm'));
  assert(mapping, `${derived[1]} 缺 literal policy dict`);
  return [...mapping[1]!.matchAll(/^\s*["']([a-z_]+)["']\s*:/gm)].map(match => match[1]!);
}

function extractVendorKeys(version: string): string[] {
  const py = readVendorPython('hylyre/api/planned_step_keys.py', version);
  const keys = declarationKeys(py, 'PLANNED_STEP_ROOT_KEYS');
  for (const extension of py.matchAll(/^PLANNED_STEP_ROOT_KEYS\s*\+=\s*(\w+)\s*$/gm)) {
    const imported = py.match(new RegExp(`^from\\s+([\\w.]+)\\s+import\\s+${extension[1]}\\s*$`, 'm'));
    assert(imported, `${extension[1]} 缺可静态定位的 import`);
    const source = readVendorPython(`${imported[1]!.replace(/\./g, '/')}.py`, version);
    keys.push(...declarationKeys(source, extension[1]!));
  }
  assert(keys.length > 0, 'vendor 键集为空');
  return keys;
}

function extractDocKeys(): string[] {
  const md = fs.readFileSync(FIELDS_MD, 'utf-8');
  const section = md.split(/^## /m).find(s => s.startsWith('根键 SSOT'));
  assert(section, '教学文档缺「## 根键 SSOT」节');
  // 清单行 = 节内含 '·' 分隔符的第一行；从该行提取全部反引号键名
  const listLine = section!.split(/\r?\n/).find(l => l.includes('·'));
  assert(listLine, '「根键 SSOT」节内未找到 · 分隔的键清单行');
  return [...listLine!.matchAll(/`([a-z_]+)`/g)].map(mm => mm[1]);
}

function setDiff(a: Iterable<string>, b: Set<string>): string[] {
  return [...a].filter(x => !b.has(x));
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: '0.6.0 P0 run-copy注入保留Shell管道、JSON反斜杠及其它列，并保持幂等',
    run: () => {
      const command = String.raw`printf 'C:\tmp\|value;中文' | cat`;
      const text = String.raw`C:\tmp\|literal;；"quoted"\n`;
      const steps = [{ touch: { by_id: 'open_panel' } }, { shell: { command } }, { input: { by_id: 'field', text } }];
      const name = String.raw`name\|C:\keep`;
      const precondition = String.raw`pre\|C:\stage`;
      const expected = String.raw`expected\|C:\result`;
      const unchanged = '| TC-002 | keep | - | {"back":{}} | - | P1 | AC-2 |';
      const source = ['## 测试用例清单', '', '| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC |', '|---|---|---|---|---|---|---|', `| TC-001 | ${name} | ${precondition} | ${steps.map(step => JSON.stringify(step)).join(' ; ').replace(/\|/g, '\\|')} | ${expected} | P0 | AC-1 |`, unchanged].join('\n');
      const acceptance = { flows: { main: ['home', 'panel'] }, criteria: [{ id: 'AC-1', priority: 'P0', ut_layer: 'device', linked_flow: 'main', checkpoint: { pre_screen: 'home', action: { type: 'touch', target_element_id: 'open_panel' }, post_screen: 'panel', required_element_ids: ['panel'] } }] };
      const injected = injectP0IdentityAssertions({ derivedMd: source, topPlanMd: source, acceptance, canonical: null });
      assert(injected.changed && injected.injected.length === 1 && injected.gaps.length === 0, JSON.stringify(injected));
      const row = extractDerivedPlanCases(injected.content)[0]!;
      const parsed = parsePlannedStepsFromCell(row.steps_raw);
      assert(parsed.ok, JSON.stringify(parsed));
      assert(JSON.stringify(parsed.steps) === JSON.stringify([steps[0], { wait_for: { by_id: 'panel', timeout: 10 } }, ...steps.slice(1)]), 'injection must preserve exact command/text values');
      const line = injected.content.split('\n').find(item => item.startsWith('| TC-001 |'))!;
      assert(line.startsWith(`| TC-001 | ${name} | ${precondition} | `) && line.endsWith(` | ${expected} | P0 | AC-1 |`), 'non-step columns must stay verbatim');
      assert(injected.content.split('\n').includes(unchanged), 'unmodified row must remain byte-identical');
      const again = injectP0IdentityAssertions({ derivedMd: injected.content, topPlanMd: source, acceptance, canonical: null });
      assert(!again.changed && again.content === injected.content, 'injection must remain idempotent');
    },
  },
  {
    name: '静态键声明兼容旧literal tuple与0.6.0策略dict派生tuple',
    run: () => {
      assert(JSON.stringify(declarationKeys('ROOT: tuple[str, ...] = ("touch", "input")', 'ROOT')) === '["touch","input"]', 'legacy tuple');
      const source = 'POLICY: dict[str, bool] = {\n    "drag": False,\n    "shell": True,\n}\nKEYS = tuple(POLICY)\n';
      assert(JSON.stringify(declarationKeys(source, 'KEYS')) === '["drag","shell"]', 'derived ordered tuple');
    },
  },
  {
    name: '0.6.0 shape catalog覆盖18个新增根键，不提供生命周期占位示例；新增查询仍为action且可通过正式STEP-001',
    run: () => {
      const catalog = new Set(STEP_SHAPE_CATALOG.map(shape => shape.root));
      const old = new Set(['touch', 'input', 'swipe', 'scroll', 'scroll_to', 'back', 'home', 'stop_app', 'clear_app', 'wait', 'wait_for', 'wait_gone', 'wait_idle', 'assert_toast', 'start_app']);
      const added = PLANNED_STEP_ROOT_KEYS.filter(key => key !== 'action' && !old.has(key));
      assert(added.length === 18 && added.every(key => catalog.has(key)), 'catalog must cover all 18 added roots');
      assert(setDiff(catalog, new Set(PLANNED_STEP_ROOT_KEYS)).length === 0, 'catalog must use known roots');
      assert(['stop_app', 'clear_app', 'start_app'].every(key => !catalog.has(key)), 'lifecycle examples belong to reset_preamble, not the shared catalog');
      for (const shape of STEP_SHAPE_CATALOG.filter(item => !old.has(item.root))) {
        const step = normalizePlannedStep(shape.example);
        assert(step.kind === shape.root && step.role === 'action', `${shape.root} must remain action`);
        const md = ['## 测试用例清单', '', '| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC |', '|---|---|---|---|---|---|---|', `| TC-001 | new operation | - | ${JSON.stringify(shape.example)} | - | P0 | AC-1 |`].join('\n');
        const lint = lintHylyrePlanStepRules(md);
        assert(lint.ok, `${shape.root}: ${JSON.stringify(lint.violations)}`);
      }
    },
  },
  {
    name: '0.6.0 Shell/input内容分隔符、转义换行及Markdown管道逐字保留',
    run: () => {
      const command = 'printf "中文;；\\n" | cat; printf `date`';
      const steps = [{ shell: { command, timeout: 60 } }, { input: { text: '中文；;\\n"quoted"', by_id: 'field' } }, { back: {} }];
      const cell = steps.map(step => JSON.stringify(step)).join('；');
      const parsed = parsePlannedStepsFromCell(cell);
      assert(parsed.ok && JSON.stringify(parsed.steps) === JSON.stringify(steps), `cell drift: ${JSON.stringify(parsed)}`);
      const md = ['## 测试用例清单', '', '| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC |', '|---|---|---|---|---|---|---|', `| TC-001 | shell | - | ${cell.replace(/\|/g, '\\|')} | - | P0 | AC-1 |`].join('\n');
      const lint = lintHylyrePlanStepRules(md);
      assert(lint.ok, JSON.stringify(lint.violations));
      const wrapped = lintHylyrePlanStepRules(md.replace('{"shell"', '`{"shell"').replace('}| - |', '}`| - |'));
      assert(!wrapped.ok && wrapped.violations.some(v => v.rule_id === 'STEP-005'), 'Markdown wrappers must remain rejected');
    },
  },
  {
    name: '实体比对①：vendor planned_step_keys.py ≡ hylyre-planned-step-keys.ts（集合相等）',
    run: () => {
      const version = loadManifestVersion();
      const vendorKeys = new Set(extractVendorKeys(version));
      const tsKeys = new Set(PLANNED_STEP_ROOT_KEYS);
      const onlyVendor = setDiff(vendorKeys, tsKeys);
      const onlyTs = setDiff(tsKeys, vendorKeys);
      assert(
        onlyVendor.length === 0 && onlyTs.length === 0,
        `键集漂移：vendor(${version}) 独有=[${onlyVendor.join(',')}]，keys.ts 独有=[${onlyTs.join(',')}]——` +
          `请同步 hylyre-planned-step-keys.ts / 教学文档 / lint 规则（fields.md「版本」节的同步清单）`,
      );
    },
  },
  {
    name: '实体比对②：教学文档根键清单 ≡ 键表 −（legacy action 豁免）',
    run: () => {
      const docKeys = new Set(extractDocKeys());
      const expected = new Set(PLANNED_STEP_ROOT_KEYS.filter(k => !DOC_EXEMPT_KEYS.has(k)));
      const onlyDoc = setDiff(docKeys, expected);
      const onlyExpected = setDiff(expected, docKeys);
      assert(
        onlyDoc.length === 0 && onlyExpected.length === 0,
        `教学文档键清单漂移：文档独有=[${onlyDoc.join(',')}]，键表未入文档=[${onlyExpected.join(',')}]` +
          `（legacy 豁免集=${[...DOC_EXEMPT_KEYS].join(',')}）`,
      );
    },
  },
  {
    name: 't7a 知识块：schema=4、allowed 与键表同源（剔 action；start_app/stop_app 仅作首部复位前奏）、catalog 非空、reset_preamble',
    run: () => {
      assert(STANDARD_DERIVE_HINT_SCHEMA === 4, '标准派生提示 schema 应为 4');
      const k = buildStandardHylyreDeriveKnowledge();
      const tsKeys = new Set(PLANNED_STEP_ROOT_KEYS);
      assert(k.allowed_step_roots.length > 0, 'allowed_step_roots 不得为空');
      for (const key of k.allowed_step_roots) {
        assert(tsKeys.has(key), `allowed_step_roots 含键表外的键：${key}`);
      }
      assert(
        !k.allowed_step_roots.includes('action') && k.allowed_step_roots.includes('start_app') && k.allowed_step_roots.includes('stop_app'),
        '知识块 allowed 剔除 legacy action，保留 start_app/stop_app（仅限 case 首部复位前奏，plan b3d7e5a1 T4，与 STEP-003 同源）',
      );
      assert(!k.forbidden_in_steps.includes('start_app') && k.forbidden_in_steps.includes('dump_ui'), 'forbidden 只剩 CLI 名（含 dump_ui），不再含 start_app');
      assert(k.reset_preamble.available === false && /未注入|未解析/.test(k.reset_preamble.reason), '未注入身份时 reset_preamble 明示不可用');
      assert(/不得使用 clear_app/.test(k.canonical_format) && /reset_preamble/.test(k.canonical_format), 'canonical_format 须指向 reset_preamble 并排除 clear_app');
      const withId = buildStandardHylyreDeriveKnowledge({ identity: { bundle: 'com.demo', page_name: 'EntryAbility' } });
      assert(
        withId.reset_preamble.available === true &&
          withId.reset_preamble.bundle === 'com.demo' &&
          withId.reset_preamble.example.includes('"page_name":"EntryAbility"') &&
          /clear_app/.test(withId.reset_preamble.rule),
        '注入身份后 reset_preamble 给出同源 bundle/page_name、example 与禁 clear_app 规则',
      );
      assert(Array.isArray(k.step_shape_catalog) && k.step_shape_catalog.length > 0, 'step_shape_catalog 不得为空');
      assert(k.hylyre_planned_step_fields_ref.endsWith('hylyre-planned-step-fields.md'), 'fields 文档引用缺失');
    },
  },
  {
    name: 'b3d7e5a1 T4（codex P1）：reset_preamble.example 能被生产 cell 解析器解析并过正式 lint',
    run: () => {
      const k = buildStandardHylyreDeriveKnowledge({ identity: { bundle: 'com.demo', page_name: 'EntryAbility' } });
      assert(k.reset_preamble.available === true, 'fixture');
      const parsed = parsePlannedStepsFromCell(k.reset_preamble.example);
      assert(parsed.ok === true, `example 必须能被 parsePlannedStepsFromCell 解析：${JSON.stringify(parsed)}`);
      assert(parsed.ok && parsed.steps.length === 2 && 'stop_app' in parsed.steps[0]! && 'start_app' in parsed.steps[1]!, '恰好 stop_app; start_app 两步');
      const md = [
        '## 测试用例清单', '',
        '| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC |',
        '|---|---|---|---|---|---|---|',
        `| TC-001 | x | - | ${k.reset_preamble.example} ; {"touch":{"by_text":"卡包","match":"exact"}} | x | P0 | AC-1 |`,
      ].join('\n');
      const lint = lintHylyrePlanStepRules(md, { resetIdentity: { bundle: 'com.demo', page_name: 'EntryAbility' } });
      assert(lint.ok, `照抄 example 的计划必须过正式 lint：${JSON.stringify(lint.violations)}`);
      assert(/不是.*JSON 数组/.test(k.canonical_format), 'canonical_format 须纠正为 `;` 分隔对象序列而非 JSON 数组');
    },
  },
  {
    name: 'b3d7e5a1 T4（codex P1）：reset identity = 冻结两静态来源（安装候选 bundle + hypium_page_name||entry 扫描），零缓存读写；run 侧同源',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-identity-'));
      try {
        fs.mkdirSync(path.join(root, 'AppScope'), { recursive: true });
        fs.writeFileSync(path.join(root, 'AppScope', 'app.json5'), [
          '{',
          '  // "bundleName": "com.old.bundle"  ← 历史注释',
          '  "app": {',
          '    "bundleName": "com.demo.wallet", // trailing comment',
          '    "versionCode": 1000010,',
          '  },',
          '}',
        ].join('\n'));
        fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
          schema_version: '1.0', project_name: 'demo', project_type: 'app',
          project_profile: { name: 'hmos-app' }, agent_adapter: 'cursor',
          architecture: { outer_layers: [{ id: '01-Product', can_depend_on: [], intra_layer_deps: 'forbid' }], module_inner_layers: ['shared'], inner_dependency_direction: 'upward', cross_module_exports_file: 'index.ets' },
          paths: { features_dir: 'doc/features' },
          tools: { hylyre: { hypium_page_name: 'EntryAbility', bundle_abilities: { 'com.demo.wallet': 'MappedAbility' } } },
        }, null, 2));
        const cacheDir = path.join(root, 'doc', 'app-snapshot-cache', 'com.demo.wallet');
        fs.mkdirSync(cacheDir, { recursive: true });
        const metaPath = path.join(cacheDir, 'app-meta.json');
        const stalePath = path.join(cacheDir, 'app-meta.stale');
        fs.writeFileSync(metaPath, JSON.stringify({ bundleName: 'com.demo.wallet', mainAbility: 'CachedAbility' }));
        fs.writeFileSync(stalePath, 'stale\n');
        const metaBefore = fs.readFileSync(metaPath);
        const staleBefore = fs.readFileSync(stalePath);

        const identity = resolveHylyreResetIdentity(root);
        assert(identity.identity !== null, `身份应可解析：${identity.reason}`);
        assert(identity.identity!.bundle === loadAppInstallCandidateMeta(root).bundleName && identity.identity!.bundle === 'com.demo.wallet', 'bundle 须等于安装候选解析（非注释里的旧值）');
        assert(identity.identity!.page_name === 'EntryAbility', `page_name 须取冻结来源 hypium_page_name，不被 bundle_abilities/app-meta cache 覆盖：${identity.identity!.page_name}`);
        assert(fs.existsSync(metaPath) && fs.existsSync(stalePath), '静态解析不得删除缓存文件');
        assert(fs.readFileSync(metaPath).equals(metaBefore) && fs.readFileSync(stalePath).equals(staleBefore), '静态解析不得改写缓存文件');
        const k = buildStandardHylyreDeriveKnowledge(identity);
        assert(k.reset_preamble.available && k.reset_preamble.bundle === 'com.demo.wallet' && k.reset_preamble.page_name === 'EntryAbility', 'hint 与 lint 身份一致');
        const dispatch = resolveMainAbilityForBundle({ projectRoot: root, bundleName: 'com.demo.wallet', override: identity.identity!.page_name, writeCache: false });
        assert(dispatch.mainAbility === 'EntryAbility' && dispatch.source === 'override', `run 以同一 page 作 override：${JSON.stringify(dispatch)}`);
        assert(fs.readFileSync(metaPath).equals(metaBefore) && fs.existsSync(stalePath), 'override 路径同样不碰缓存');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
      const src = fs.readFileSync(path.join(FRAMEWORK_ROOT, 'harness/scripts/check-testing.ts'), 'utf-8');
      assert(!src.includes('readBundleNameFromAppScope'), 'check-testing 不得再用独立正则读 bundleName');
      assert(/hypiumPageName:\s*resetIdentity\.identity\?\.page_name/.test(src), 'run 须把同一 resolved page 作为 hypiumPageName 传下去');
      assert(/resetIdentity\.identity\?\.bundle \?\? loadAppInstallCandidateMeta\(ctx\.projectRoot\)\.bundleName/.test(src), 'run 的 bundleName 须来自安装候选');
      const knowledge = fs.readFileSync(path.join(FRAMEWORK_ROOT, 'harness/scripts/utils/hylyre-standard-derive-knowledge.ts'), 'utf-8');
      assert(!knowledge.includes('resolveMainAbilityForBundle('), '静态身份不得借道完整 resolver（含 cache 读删）');
      const resolver = fs.readFileSync(path.join(FRAMEWORK_ROOT, 'profiles/hmos-app/harness/resolve-main-ability.ts'), 'utf-8');
      assert(!resolver.includes('deviceProbe'), 'deviceProbe 分支已撤回');
    },
  },
  {
    name: 't7a v2：统一 payload 基座——schema 4 只增字段（schema3 消费者向后兼容）+ 两入口同源',
    run: () => {
      const base = buildStandardHylyreDerivePayloadBase();
      assert(base.schema === 4, '基座 schema 应为 4');
      assert(typeof base.generated_at === 'string', '基座应含 generated_at');
      // schema 4 = 3 + 知识块：基座**不占用** schema3 时代的入口特有键（feature/source/
      // source_relative/test_cases/navigation_discipline 由各入口追加）——只增不改，
      // 旧 schema3 消费者读既有键零影响。
      for (const legacyKey of ['feature', 'source', 'source_relative', 'test_cases', 'navigation_discipline']) {
        assert(!(legacyKey in base), `基座不得占用入口特有键：${legacyKey}`);
      }
      for (const knowledgeKey of ['allowed_step_roots', 'step_shape_catalog', 'canonical_format', 'hylyre_planned_step_fields_ref']) {
        assert(knowledgeKey in base, `基座应含知识键：${knowledgeKey}`);
      }
      // 两入口通过同一个 canonical builder 消费知识与复位身份。
      const fs2 = require('fs') as typeof import('fs');
      const path2 = require('path') as typeof import('path');
      for (const rel of ['harness/scripts/check-testing.ts', 'harness/scripts/derive-hylyre-plan-hint.ts']) {
        const src = fs2.readFileSync(path2.join(FRAMEWORK_ROOT, rel), 'utf-8');
        assert(src.includes('buildCanonicalDeriveHintPayload('), `${rel} 应消费统一 canonical builder`);
      }
      const shared = fs2.readFileSync(path2.join(FRAMEWORK_ROOT, 'harness/scripts/utils/test-plan-derive-hint.ts'), 'utf8');
      assert(shared.includes('buildStandardHylyreDerivePayloadBase(resolveHylyreResetIdentity(projectRoot))'), 'canonical builder 应消费统一知识与复位身份');
    },
  },
  {
    name: '版本标签辅助比对：manifest ↔ keys.ts 头注 ↔ fields.md 版本节',
    run: () => {
      const version = loadManifestVersion();
      const tsHeader = fs.readFileSync(KEYS_TS, 'utf-8');
      assert(
        tsHeader.includes(`(vendor ${version})`),
        `hylyre-planned-step-keys.ts 头注版本 ≠ manifest ${version}`,
      );
      const md = fs.readFileSync(FIELDS_MD, 'utf-8');
      if (vendorSourcePresent()) {
        // 源码树布局：文档必须指向 src 内真源文件（不再钉 whl 文件名——公司仓无 whl）
        assert(
          md.includes('src/hylyre/api/planned_step_keys.py'),
          'fields.md 应引用 vendor 源码路径 src/hylyre/api/planned_step_keys.py',
        );
      } else {
        assert(
          md.includes(`hylyre-${version}-py3-none-any.whl`),
          `fields.md wheel 链接版本 ≠ manifest ${version}`,
        );
      }
      assert(md.includes(`\`${version}\``), `fields.md「版本」节 ≠ manifest ${version}`);
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return runUnitCases(cases);
}
