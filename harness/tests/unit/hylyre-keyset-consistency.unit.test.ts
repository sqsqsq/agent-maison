// ============================================================================
// hylyre-keyset-consistency.unit.test.ts — 键集实体三方比对元门禁（t7c，plan e6a3c9f4）
// ----------------------------------------------------------------------------
// 动机（07-16 事故 B 断点 4）：hylyre 语法知识分布在三处——vendor wheel（真源）、
// harness 键表（lint SSOT 镜像）、教学文档（agent 消费）——此前只靠人工同步纪律，
// 0.3.0→0.3.1 换 wheel 后文档/键表标签滞留 0.3.0。三处都写同一版本号也不代表字段
// 集合一致（codex round2），故本门禁做**键集实体比对**：
//   1. wheel 内 hylyre/api/planned_step_keys.py 的 PLANNED_STEP_ROOT_KEYS（零依赖
//      mini-zip 解包 + inflateRaw）≡ hylyre-planned-step-keys.ts 的同名导出；
//   2. 教学文档「## 根键 SSOT」清单 ≡ 键表 −（显式豁免 'action' legacy envelope，
//      文档刻意不教历史包络形态）；
//   3. 版本标签辅助比对：release.manifest.json hylyre_version ↔ 键表头注 ↔ 文档版本节。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { PLANNED_STEP_ROOT_KEYS } from '../../scripts/utils/hylyre-planned-step-keys';
import {
  buildStandardHylyreDeriveKnowledge,
  buildStandardHylyreDerivePayloadBase,
  STANDARD_DERIVE_HINT_SCHEMA,
} from '../../scripts/utils/hylyre-standard-derive-knowledge';

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
  const manifest = JSON.parse(
    fs.readFileSync(path.join(VENDOR_DIR, 'release.manifest.json'), 'utf-8'),
  ) as { hylyre_version?: string };
  assert(
    typeof manifest.hylyre_version === 'string' && manifest.hylyre_version.length > 0,
    'release.manifest.json 缺 hylyre_version',
  );
  return manifest.hylyre_version!;
}

function extractWheelKeys(version: string): string[] {
  const wheelPath = path.join(VENDOR_DIR, `hylyre-${version}-py3-none-any.whl`);
  assert(fs.existsSync(wheelPath), `vendor wheel 不存在：${wheelPath}（manifest 声明 ${version}）`);
  const py = readZipEntry(wheelPath, 'hylyre/api/planned_step_keys.py');
  assert(py, 'wheel 内未找到 hylyre/api/planned_step_keys.py');
  const block = py!.match(/PLANNED_STEP_ROOT_KEYS[^=]*=\s*\(([\s\S]*?)\)/);
  assert(block, 'planned_step_keys.py 内未匹配到 PLANNED_STEP_ROOT_KEYS 元组');
  const keys = [...block![1].matchAll(/"([^"]+)"/g)].map(mm => mm[1]);
  assert(keys.length > 0, 'wheel 键集为空');
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
    name: '实体比对①：wheel planned_step_keys.py ≡ hylyre-planned-step-keys.ts（集合相等）',
    run: () => {
      const version = loadManifestVersion();
      const wheelKeys = new Set(extractWheelKeys(version));
      const tsKeys = new Set(PLANNED_STEP_ROOT_KEYS);
      const onlyWheel = setDiff(wheelKeys, tsKeys);
      const onlyTs = setDiff(tsKeys, wheelKeys);
      assert(
        onlyWheel.length === 0 && onlyTs.length === 0,
        `键集漂移：wheel(${version}) 独有=[${onlyWheel.join(',')}]，keys.ts 独有=[${onlyTs.join(',')}]——` +
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
    name: 't7a 知识块：schema=4、allowed 与键表同源（剔 action/start_app）、catalog 非空',
    run: () => {
      assert(STANDARD_DERIVE_HINT_SCHEMA === 4, '标准派生提示 schema 应为 4');
      const k = buildStandardHylyreDeriveKnowledge();
      const tsKeys = new Set(PLANNED_STEP_ROOT_KEYS);
      assert(k.allowed_step_roots.length > 0, 'allowed_step_roots 不得为空');
      for (const key of k.allowed_step_roots) {
        assert(tsKeys.has(key), `allowed_step_roots 含键表外的键：${key}`);
      }
      assert(
        !k.allowed_step_roots.includes('action') && !k.allowed_step_roots.includes('start_app'),
        '知识块 allowed 应剔除 legacy action 与 start_app（派生计划禁用，与 STEP lint 同源）',
      );
      assert(k.forbidden_in_steps.includes('start_app') && k.forbidden_in_steps.includes('dump_ui'), 'forbidden 应含 start_app 与 dump_ui');
      assert(Array.isArray(k.step_shape_catalog) && k.step_shape_catalog.length > 0, 'step_shape_catalog 不得为空');
      assert(k.hylyre_planned_step_fields_ref.endsWith('hylyre-planned-step-fields.md'), 'fields 文档引用缺失');
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
      // 两入口同源：check-testing 与 CLI 都必须经 buildStandardHylyreDerivePayloadBase 组装。
      const fs2 = require('fs') as typeof import('fs');
      const path2 = require('path') as typeof import('path');
      for (const rel of ['harness/scripts/check-testing.ts', 'harness/scripts/derive-hylyre-plan-hint.ts']) {
        const src = fs2.readFileSync(path2.join(FRAMEWORK_ROOT, rel), 'utf-8');
        assert(src.includes('buildStandardHylyreDerivePayloadBase()'), `${rel} 应消费统一基座`);
      }
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
      assert(
        md.includes(`hylyre-${version}-py3-none-any.whl`),
        `fields.md wheel 链接版本 ≠ manifest ${version}`,
      );
      assert(md.includes(`\`${version}\``), `fields.md「版本」节 ≠ manifest ${version}`);
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      out.push({ name: c.name, ok: true });
    } catch (err) {
      out.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  }
  return out;
}
