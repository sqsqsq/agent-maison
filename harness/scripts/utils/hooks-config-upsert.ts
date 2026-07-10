// ============================================================================
// hooks-config-upsert.ts — cursor .cursor/hooks.json 结构化 upsert（plan e8f5a2c7 G1b）
// ============================================================================
// 第四轮 P1 钉死：.cursor/hooks.json 是宿主原生共享配置（团队可能已有格式化/审计/安全
// hooks）——绝不 verbatim 整文件覆盖；只对 framework 自有条目做结构化 upsert。
// 第五轮 P2 钉死：**ownership key = 稳定的 command 路径**；matcher/timeout/failClosed
// 等均为 framework 受管可变字段，UPDATE 原位更新；同 command 多条去重保一；command
// 路径未来变更走 LEGACY_OWNED_COMMANDS 迁移清单；卸载删全部 owned/legacy 条目、保留
// 第三方条目与容器。

export interface HooksConfigEntry {
  command: string;
  [key: string]: unknown;
}

export type HooksConfigDoc = {
  version?: unknown;
  hooks?: Record<string, unknown>;
  [key: string]: unknown;
};

/**
 * framework 曾用过、现已弃用的 hook command 路径（迁移/卸载用）。当前为空；
 * 未来若 guard 脚本路径必须变更，把旧 command 追加到这里——UPDATE 时旧条目会被
 * 识别为自有并迁移到新 command，卸载时一并清除。
 */
export const LEGACY_OWNED_COMMANDS: readonly string[] = [];

export type UpsertStatus = 'created' | 'updated' | 'unchanged' | 'invalid_json' | 'invalid_schema';

export interface UpsertResult {
  status: UpsertStatus;
  /** status ∈ created|updated 时为写盘内容；unchanged 时为现有内容；invalid_json/invalid_schema 无 */
  nextText?: string;
  note?: string;
}

function parseDoc(text: string): HooksConfigDoc | null {
  try {
    const doc = JSON.parse(text) as unknown;
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
    return doc as HooksConfigDoc;
  } catch {
    return null;
  }
}

function entryCommand(e: unknown): string | null {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  const c = (e as Record<string, unknown>).command;
  return typeof c === 'string' && c.trim() ? c.trim() : null;
}

function stringifyDoc(doc: HooksConfigDoc): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/**
 * 对单个 event 数组做 owned upsert：
 *   - 命中 owned/legacy command 的条目：第一个原位替换为 desired（matcher 等受管字段随
 *     desired 走），其余（历史重复/legacy 迁移残留）删除——幂等且不累积；
 *   - 无命中：append desired；
 *   - 第三方条目一律保留、相对顺序不变。
 */
function upsertEventArray(
  existing: unknown,
  desired: HooksConfigEntry,
  ownedCommands: ReadonlySet<string>,
): { next: unknown[]; changed: boolean } {
  const arr = Array.isArray(existing) ? [...existing] : [];
  const next: unknown[] = [];
  let placed = false;
  let changed = false;
  for (const e of arr) {
    const cmd = entryCommand(e);
    if (cmd !== null && ownedCommands.has(cmd)) {
      if (!placed) {
        next.push(desired);
        placed = true;
        if (JSON.stringify(e) !== JSON.stringify(desired)) changed = true;
      } else {
        changed = true; // 去重：丢弃多余自有条目
      }
      continue;
    }
    next.push(e);
  }
  if (!placed) {
    next.push(desired);
    changed = true;
  }
  return { next, changed };
}

/**
 * 结构化 upsert 主入口。desiredText = adapter 模板（仅含 framework 自有条目的
 * hooks.json 形状）；existingText = 宿主现有文件内容（null=不存在）。
 * 语义：不存在 → 以 {version:1, hooks:{…desired}} 创建；存在且合法 → 仅 upsert
 * 自有条目、保留一切他方 hooks/顶层/未知字段；JSON 非法 → invalid_json（调用方
 * 阻断提示，**绝不整文件覆盖**）。
 */
export function computeHooksConfigUpsert(
  existingText: string | null,
  desiredText: string,
): UpsertResult {
  const desired = parseDoc(desiredText);
  // 第八轮 codex P2：framework 自有模板损坏不得静默接受（原实现只按"数组事件"过滤，
  // preToolUse 写成对象会滑成"零自有条目"→ created 空壳）。模板完整 schema 硬校验：
  // hooks 须为 plain object；每个声明的 event 值须是**非空数组**且每项含合法 command。
  if (!desired || desired.hooks === undefined || desired.hooks === null
    || typeof desired.hooks !== 'object' || Array.isArray(desired.hooks)) {
    return { status: 'invalid_json', note: 'adapter hooks_config 模板自身不是合法 hooks.json 形状（hooks 须为对象）' };
  }
  const declaredEvents = Object.entries(desired.hooks as Record<string, unknown>);
  if (declaredEvents.length === 0) {
    return { status: 'invalid_json', note: 'adapter hooks_config 模板未声明任何 event（空 hooks 无意义）' };
  }
  for (const [event, v] of declaredEvents) {
    if (!Array.isArray(v) || v.length === 0) {
      return { status: 'invalid_json', note: `adapter hooks_config 模板的 hooks.${event} 须为非空数组（实际 ${Array.isArray(v) ? '空数组' : typeof v}）——模板损坏，拒绝物化` };
    }
    for (const e of v) {
      if (entryCommand(e) === null) {
        return { status: 'invalid_json', note: `adapter hooks_config 模板的 hooks.${event} 存在缺 command 的条目——ownership key 缺失，拒绝物化` };
      }
    }
  }
  const desiredEvents = declaredEvents as Array<[string, HooksConfigEntry[]]>;
  const ownedCommands = new Set<string>(LEGACY_OWNED_COMMANDS);
  for (const [, entries] of desiredEvents) {
    for (const e of entries) {
      const c = entryCommand(e);
      if (c) ownedCommands.add(c);
    }
  }

  if (existingText === null) {
    const created: HooksConfigDoc = { version: desired.version ?? 1, hooks: {} };
    for (const [event, entries] of desiredEvents) {
      (created.hooks as Record<string, unknown>)[event] = entries;
    }
    return { status: 'created', nextText: stringifyDoc(created) };
  }

  const doc = parseDoc(existingText);
  if (!doc) {
    return {
      status: 'invalid_json',
      note: '.cursor/hooks.json 不是合法 JSON——不做整文件覆盖；请修复后重跑（宿主自有配置，framework 不越权重写）',
    };
  }

  // 第七轮 codex P1-2：schema 不兼容 ≠ 可静默改写——hooks 只能缺失或为 plain object；
  // 受管 event 只能缺失或为数组。其余形态是宿主自有语义（哪怕怪），framework 无权替换。
  if (doc.hooks !== undefined && (typeof doc.hooks !== 'object' || doc.hooks === null || Array.isArray(doc.hooks))) {
    return {
      status: 'invalid_schema',
      note: `.cursor/hooks.json 的 hooks 字段不是对象（实际 ${Array.isArray(doc.hooks) ? 'array' : typeof doc.hooks}）——不做改写；请人工核对宿主配置`,
    };
  }
  const existingHooks = (doc.hooks ?? {}) as Record<string, unknown>;
  for (const [event] of desiredEvents) {
    const cur = existingHooks[event];
    if (cur !== undefined && !Array.isArray(cur)) {
      return {
        status: 'invalid_schema',
        note: `.cursor/hooks.json 的 hooks.${event} 不是数组（实际 ${typeof cur}）——不做改写；请人工核对宿主配置`,
      };
    }
  }

  const hooks = { ...existingHooks };
  let changed = doc.hooks === undefined;

  for (const [event, entries] of desiredEvents) {
    let current = hooks[event];
    for (const desiredEntry of entries) {
      const r = upsertEventArray(current, desiredEntry, ownedCommands);
      current = r.next;
      changed = changed || r.changed;
    }
    hooks[event] = current;
  }

  if (!changed) return { status: 'unchanged', nextText: existingText };

  const nextDoc: HooksConfigDoc = { ...doc, hooks };
  if (nextDoc.version === undefined) nextDoc.version = desired.version ?? 1;
  return { status: 'updated', nextText: stringifyDoc(nextDoc) };
}

export type RemovalStatus = 'removed' | 'unchanged' | 'invalid_json' | 'missing';

export interface RemovalResult {
  status: RemovalStatus;
  nextText?: string;
  /** 清理后整份文件只剩空壳（无任何 hooks 条目）时为 true——调用方可选择删除文件 */
  emptyShell?: boolean;
}

/**
 * 卸载/adapter 切换：删除全部 owned/legacy command 条目，保留第三方条目与容器结构；
 * 事件数组删空后移除该事件键（空容器清理），其余顶层字段原样保留。
 */
export function computeHooksConfigRemoval(
  existingText: string | null,
  ownedCommands: readonly string[],
): RemovalResult {
  if (existingText === null) return { status: 'missing' };
  const doc = parseDoc(existingText);
  if (!doc) return { status: 'invalid_json' };
  if (!doc.hooks || typeof doc.hooks !== 'object' || Array.isArray(doc.hooks)) {
    return { status: 'unchanged', nextText: existingText };
  }
  const owned = new Set([...ownedCommands, ...LEGACY_OWNED_COMMANDS]);
  const hooks = { ...(doc.hooks as Record<string, unknown>) };
  let changed = false;
  for (const [event, arr] of Object.entries(hooks)) {
    if (!Array.isArray(arr)) continue;
    const kept = arr.filter((e) => {
      const c = entryCommand(e);
      return c === null || !owned.has(c);
    });
    if (kept.length !== arr.length) {
      changed = true;
      if (kept.length === 0) delete hooks[event];
      else hooks[event] = kept;
    }
  }
  if (!changed) return { status: 'unchanged', nextText: existingText };
  const nextDoc: HooksConfigDoc = { ...doc, hooks };
  const emptyShell = Object.keys(hooks).length === 0;
  return { status: 'removed', nextText: stringifyDoc(nextDoc), emptyShell };
}
