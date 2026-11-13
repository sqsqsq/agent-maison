// ============================================================================
// hooks-config-upsert.ts — Cursor/Codex 宿主 hooks.json 结构化 upsert
// ============================================================================
// 第四轮 P1 钉死：.cursor/hooks.json 是宿主原生共享配置（团队可能已有格式化/审计/安全
// hooks）——绝不 verbatim 整文件覆盖；只对 framework 自有条目做结构化 upsert。
// 第五轮 P2 钉死：**ownership key = 稳定的 command 路径**；matcher/timeout/failClosed
// 等均为 framework 受管可变字段，UPDATE 原位更新；同 command 多条去重保一；command
// Codex 项目绝对前缀可变，按已解析的完整脚本尾段归属；脚本本身改名仍走迁移清单。
// 卸载删全部 owned/legacy 条目、保留
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

function scriptOwnershipKey(script: string): string {
  const normalized = script.replace(/\\/g, '/');
  const value = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  const codexGuard = 'framework/agents/codex/hooks/guard-framework-write.mjs';
  // Only the exact relative script or a complete absolute-path suffix belongs to this adapter.
  return value === codexGuard || /^(?:[a-z]:\/|\/)/i.test(value) && value.endsWith('/' + codexGuard) ? codexGuard : value;
}

function commandOwnershipKey(command: string): string {
  const script = extractNodeScriptPath(command);
  return script !== null && scriptOwnershipKey(script) === 'framework/agents/codex/hooks/guard-framework-write.mjs'
    ? 'node framework/agents/codex/hooks/guard-framework-write.mjs' : command;
}

interface HooksConfigGroup { hooks: HooksConfigEntry[]; [key: string]: unknown }
function groupHandlers(e: unknown): unknown[] | null {
  return e && typeof e === 'object' && !Array.isArray(e) && Array.isArray((e as Record<string, unknown>).hooks)
    ? (e as { hooks: unknown[] }).hooks : null;
}

/** Codex groups can contain host handlers: split those out before updating our matcher. */
function upsertGroupArray(existing: unknown, desired: HooksConfigGroup, owned: ReadonlySet<string>): unknown[] {
  const next: unknown[] = [];
  let placed = false;
  for (const value of Array.isArray(existing) ? existing : []) {
    const handlers = groupHandlers(value)!;
    const ours = handlers.filter(handler => { const command = entryCommand(handler); return command !== null && owned.has(commandOwnershipKey(command)); });
    if (!ours.length) { next.push(value); continue; }
    const group = value as Record<string, unknown>;
    const others = handlers.filter(handler => !ours.includes(handler));
    if (others.length) next.push({ ...group, hooks: others });
    if (!placed) {
      next.push({ ...group, ...desired, hooks: desired.hooks.map(handler => ({
        ...(ours.find(old => commandOwnershipKey(entryCommand(old)!) === commandOwnershipKey(handler.command)) as Record<string, unknown> | undefined), ...handler,
      })) });
      placed = true;
    }
  }
  if (!placed) next.push(desired);
  return next;
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
    if (cmd !== null && ownedCommands.has(commandOwnershipKey(cmd))) {
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
  projectRoot?: string,
): UpsertResult {
  let desired = parseDoc(desiredText);
  if (desired && desiredText.includes('{{PROJECT_ROOT}}')) {
    if (!projectRoot) return { status: 'invalid_json', note: 'hooks_config 项目路径模板缺物化上下文，拒绝产出无法启动的命令' };
    // Substitute parsed JSON strings, so Windows paths/quotes are never interpolated into raw JSON.
    const fill = (value: unknown): unknown => typeof value === 'string' ? value.split('{{PROJECT_ROOT}}').join(projectRoot.replace(/\\/g, '/'))
      : Array.isArray(value) ? value.map(fill)
        : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fill(item)])) : value;
    desired = fill(desired) as HooksConfigDoc;
  }
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
      const handlers = groupHandlers(e);
      if (entryCommand(e) === null && (!handlers?.length || handlers.some(handler => entryCommand(handler) === null))) {
        return { status: 'invalid_json', note: `adapter hooks_config 模板的 hooks.${event} 存在缺 command 的条目——ownership key 缺失，拒绝物化` };
      }
    }
  }
  const desiredEvents = declaredEvents as Array<[string, Array<HooksConfigEntry | HooksConfigGroup>]>;
  const ownedCommands = new Set<string>(LEGACY_OWNED_COMMANDS.map(commandOwnershipKey));
  for (const [, entries] of desiredEvents) {
    for (const e of entries) {
      for (const handler of groupHandlers(e) ?? [e]) {
        const c = entryCommand(handler);
        if (c) ownedCommands.add(commandOwnershipKey(c));
      }
    }
  }

  if (existingText === null) {
    const created: HooksConfigDoc = { ...desired, hooks: {} };
    for (const [event, entries] of desiredEvents) {
      (created.hooks as Record<string, unknown>)[event] = entries;
    }
    return { status: 'created', nextText: stringifyDoc(created) };
  }

  const doc = parseDoc(existingText);
  if (!doc) {
    return {
      status: 'invalid_json',
      note: 'hooks.json 不是合法 JSON——不做整文件覆盖；请修复后重跑（宿主自有配置，framework 不越权重写）',
    };
  }

  // 第七轮 codex P1-2：schema 不兼容 ≠ 可静默改写——hooks 只能缺失或为 plain object；
  // 受管 event 只能缺失或为数组。其余形态是宿主自有语义（哪怕怪），framework 无权替换。
  if (doc.hooks !== undefined && (typeof doc.hooks !== 'object' || doc.hooks === null || Array.isArray(doc.hooks))) {
    return {
      status: 'invalid_schema',
      note: `hooks.json 的 hooks 字段不是对象（实际 ${Array.isArray(doc.hooks) ? 'array' : typeof doc.hooks}）——不做改写；请人工核对宿主配置`,
    };
  }
  const existingHooks = (doc.hooks ?? {}) as Record<string, unknown>;
  for (const [event, entries] of desiredEvents) {
    const cur = existingHooks[event];
    if (cur !== undefined && !Array.isArray(cur)) {
      return {
        status: 'invalid_schema',
        note: `hooks.json 的 hooks.${event} 不是数组（实际 ${typeof cur}）——不做改写；请人工核对宿主配置`,
      };
    }
    if (entries.some(entry => groupHandlers(entry)) && Array.isArray(cur) && cur.some(entry => groupHandlers(entry) === null)) {
      return { status: 'invalid_schema', note: `hooks.json 的 hooks.${event} matcher group 缺 handlers 数组——不做改写` };
    }
  }

  const hooks = { ...existingHooks };
  let changed = doc.hooks === undefined;

  for (const [event, entries] of desiredEvents) {
    let current = hooks[event];
    for (const desiredEntry of entries) {
      if (groupHandlers(desiredEntry)) {
        const next = upsertGroupArray(current, desiredEntry as HooksConfigGroup, ownedCommands);
        changed = changed || JSON.stringify(current) !== JSON.stringify(next);
        current = next;
        continue;
      }
      const r = upsertEventArray(current, desiredEntry as HooksConfigEntry, ownedCommands);
      current = r.next;
      changed = changed || r.changed;
    }
    hooks[event] = current;
  }

  if (!changed) return { status: 'unchanged', nextText: existingText };

  const nextDoc: HooksConfigDoc = { ...doc, hooks };
  if (nextDoc.version === undefined && desired.version !== undefined) nextDoc.version = desired.version;
  return { status: 'updated', nextText: stringifyDoc(nextDoc) };
}

export type RemovalStatus = 'removed' | 'unchanged' | 'invalid_json' | 'invalid_schema' | 'missing';

export interface RemovalResult {
  status: RemovalStatus;
  nextText?: string;
  /** 清理后整份文件只剩空壳（无任何 hooks 条目）时为 true——调用方可选择删除文件 */
  emptyShell?: boolean;
}

/**
 * 从 hook command 抽出「node 单脚本调用」的脚本路径：斜杠归一，去掉 `./` 与
 * `${…PROJECT_DIR}/` 前缀。复合/拼接命令（`&&`、带参数等）返回 null——不猜归属。
 * 归属判定（本文件）与退役清理的引用去向判定（check-init）共用同一份解析，勿另抄正则。
 */
export function extractNodeScriptPath(command: string): string | null {
  const match = command.match(/^node(?:\.exe)?\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|<>]+))\s*$/i);
  if (!match) return null;
  return (match[1] ?? match[2] ?? match[3]!).replace(/\\/g, '/')
    .replace(/^(?:\.\/|\$(?:\{[A-Z0-9_]*PROJECT_(?:DIR|ROOT)\}|[A-Z0-9_]*PROJECT_(?:DIR|ROOT))\/)/, '');
}

/**
 * 卸载/adapter 切换：删除全部 owned/legacy command 条目，保留第三方条目与容器结构；
 * 事件数组删空后移除该事件键（空容器清理），其余顶层字段原样保留。
 */
export function computeHooksConfigRemoval(
  existingText: string | null,
  ownedCommands: readonly string[],
  ownedScriptPaths: readonly string[] = [],
): RemovalResult {
  if (existingText === null) return { status: 'missing' };
  const doc = parseDoc(existingText);
  if (!doc) return { status: 'invalid_json' };
  if (doc.hooks === undefined) {
    return { status: 'unchanged', nextText: existingText };
  }
  if (!doc.hooks || typeof doc.hooks !== 'object' || Array.isArray(doc.hooks)
    || Object.values(doc.hooks).some(arr => !Array.isArray(arr))) {
    return { status: 'invalid_schema' };
  }
  const owned = new Set([...ownedCommands, ...LEGACY_OWNED_COMMANDS].map(commandOwnershipKey));
  const scripts = new Set(ownedScriptPaths.map(scriptOwnershipKey));
  const isOwned = (command: string): boolean => {
    if (owned.has(commandOwnershipKey(command))) return true;
    const script = extractNodeScriptPath(command);
    return script !== null && scripts.has(scriptOwnershipKey(script));
  };
  const hooks = { ...(doc.hooks as Record<string, unknown>) };
  let changed = false;
  const removeEntries = (arr: unknown[]): unknown[] => arr.flatMap(e => {
    const command = entryCommand(e);
    if (command !== null && isOwned(command)) {
      changed = true;
      return [];
    }
    if (e && typeof e === 'object' && !Array.isArray(e)) {
      const group = e as Record<string, unknown>;
      if (Array.isArray(group.hooks)) {
        const kept = removeEntries(group.hooks);
        if (JSON.stringify(kept) !== JSON.stringify(group.hooks)) {
          return kept.length ? [{ ...group, hooks: kept }] : [];
        }
      }
    }
    return [e];
  });
  for (const [event, arr] of Object.entries(hooks)) {
    if (!Array.isArray(arr)) continue;
    const kept = removeEntries(arr);
    if (JSON.stringify(kept) !== JSON.stringify(arr)) {
      if (kept.length === 0) delete hooks[event];
      else hooks[event] = kept;
    }
  }
  if (!changed) return { status: 'unchanged', nextText: existingText };
  const nextDoc: HooksConfigDoc = { ...doc, hooks };
  const emptyShell = Object.keys(hooks).length === 0;
  return { status: 'removed', nextText: stringifyDoc(nextDoc), emptyShell };
}
