// ============================================================================
// hylyre-contract-schema.ts — 冻结 output-schema.json 的生产期定位与加载
//                              （plan a6c4e9f2 T4 返修）
// ----------------------------------------------------------------------------
// 为什么不能读 `harness/tests/fixtures/hylyre-contracts-0.4-p0/`：那条路径命中发布
// 排除规则（实测 `classifyPath` → `excludeGlobs:harness/tests/**`，include=false），
// 宿主拿到的发布件里根本没有它。生产 required gate 若指向它，本仓能过、宿主必崩。
//
// 唯一合法来源是**随发布件一起下发的 vendored contracts**
// `profiles/<profile>/vendor/hylyre/src/hylyre/contracts/`（实测 include=true），
// 且与冻结包 fixture 逐字节相同（同 sha256），因此不构成第二事实源。
//
// 全链 fail-closed：定位不到、读不了、审计出本仓校验器未覆盖的关键字——都返回错误，
// 由调用方转成 BLOCKER。绝不允许"找不到 schema 就跳过校验"。
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { auditSchemaSupport } from './lite-json-schema';

/** vendored contracts 相对 profile 根的固定位置（由 Hylyre 发布件结构决定）。 */
const CONTRACTS_SUBPATH = path.join('vendor', 'hylyre', 'src', 'hylyre', 'contracts');
const SCHEMA_FILENAME = 'output-schema.json';

export type HylyreSchemaLoad =
  | { ok: true; schema: Record<string, unknown>; schemaPath: string }
  | { ok: false; detail: string; suggestion: string };

interface CacheEntry {
  mtimeMs: number;
  size: number;
  load: HylyreSchemaLoad;
}
const cache = new Map<string, CacheEntry>();

/** 从模块位置向上找到含 `profiles/` 的仓库/发布件根。 */
function inferRoot(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'profiles'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * 列出所有 profile 下的 vendored `output-schema.json`。
 *
 * 多 profile 时要求它们**逐字节相同**：不同 profile 装了不同版本的 Hylyre 契约，
 * 意味着"哪份是真"没有答案，只能拒绝，而不是随便挑一份。
 */
function scanProfiles(root: string): string[] {
  const profilesDir = path.join(root, 'profiles');
  if (!fs.existsSync(profilesDir)) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(profilesDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(profilesDir, entry.name, CONTRACTS_SUBPATH, SCHEMA_FILENAME);
    if (fs.existsSync(candidate)) found.push(candidate);
  }
  return found.sort();
}

export function locateHylyreOutputSchemas(frameworkRoot?: string | null): string[] {
  // 先按调用方给的 frameworkRoot 找；找不到再从**本模块自身位置**向上推断。
  // 后者不是兜底猜测：本文件就躺在 framework 树内（宿主里是 `<host>/framework/harness/...`），
  // 向上第一个含 `profiles/` 的目录必然是当前正在执行的这份 framework，
  // 也就是与之配套下发的那份 vendored contracts。调用方传错/传窄不应让门禁失去判据。
  const explicit = frameworkRoot && frameworkRoot.trim() ? scanProfiles(frameworkRoot.trim()) : [];
  if (explicit.length > 0) return explicit;
  const inferred = inferRoot(__dirname);
  return inferred ? scanProfiles(inferred) : [];
}

const MISSING_SUGGESTION =
  '按 `profiles/<profile>/vendor/hylyre/README.md` 从 Hylyre dist/release-src 同步 vendor 发布件' +
  '（contracts/ 必须随源码一起下发），再重跑 testing。';

/**
 * 加载冻结 schema。任何一步不成立都返回 `ok:false`，调用方必须据此产 BLOCKER。
 */
export function loadHylyreOutputSchema(frameworkRoot?: string | null): HylyreSchemaLoad {
  const paths = locateHylyreOutputSchemas(frameworkRoot);
  if (paths.length === 0) {
    return {
      ok: false,
      detail:
        `未找到 vendored Hylyre 契约 schema（期望 profiles/<profile>/${CONTRACTS_SUBPATH.replace(/\\/g, '/')}/${SCHEMA_FILENAME}）。` +
        'required gate 无法在没有冻结 schema 的情况下校验 trace。',
      suggestion: MISSING_SUGGESTION,
    };
  }
  if (paths.length > 1) {
    const digests = new Set(paths.map(p => {
      try { return fs.readFileSync(p, 'utf8'); } catch { return `__unreadable__:${p}`; }
    }));
    if (digests.size > 1) {
      return {
        ok: false,
        detail:
          `多个 profile 下的 vendored output-schema.json 内容不一致（${paths.length} 份）：` +
          `${paths.join('、')}。哪份是权威契约没有答案，拒绝消费。`,
        suggestion: '把所有 profile 的 vendor/hylyre 同步到同一个 Hylyre 发布件版本后重跑。',
      };
    }
  }

  const schemaPath = paths[0];
  let stat: fs.Stats;
  try {
    stat = fs.statSync(schemaPath);
  } catch (err) {
    return {
      ok: false,
      detail: `无法读取 ${schemaPath}：${(err as Error).message}`,
      suggestion: MISSING_SUGGESTION,
    };
  }
  const cached = cache.get(schemaPath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.load;

  let load: HylyreSchemaLoad;
  try {
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8')) as Record<string, unknown>;
    // 加载期静态审计：本仓校验器没实现的关键字 = 该约束会被静默跳过 = 假校验。
    // 冻结包演进引入新关键字时，这里显式失败，而不是悄悄放宽门禁。
    const unsupported = auditSchemaSupport(schema);
    if (unsupported.length > 0) {
      const sample = unsupported.slice(0, 5).map(u => `${u.keyword}@${u.pointer}`).join('、');
      load = {
        ok: false,
        detail:
          `冻结 schema 用到了本仓校验器未实现的关键字（${unsupported.length} 处：${sample}）。` +
          '继续校验会静默跳过这些约束，等同于没有校验，因此 fail-closed。',
        suggestion:
          '在 `harness/scripts/utils/lite-json-schema.ts` 补齐这些关键字的判定后再重跑；' +
          '不得通过放宽 required gate 绕过。',
      };
    } else {
      load = { ok: true, schema, schemaPath };
    }
  } catch (err) {
    load = {
      ok: false,
      detail: `冻结 schema 解析失败（${schemaPath}）：${(err as Error).message}`,
      suggestion: MISSING_SUGGESTION,
    };
  }
  cache.set(schemaPath, { mtimeMs: stat.mtimeMs, size: stat.size, load });
  return load;
}

/** 测试用：清空缓存。 */
export function __resetHylyreSchemaCache(): void {
  cache.clear();
}
