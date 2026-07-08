// ============================================================================
// correction-state.ts — .current-correction.json 持久化（C5-min correction-routing，
// plan d4a7c1e8）
// ============================================================================
// 跨回合 / soft 档下 `--correction-check` 的稳定输入。落盘位置与
// .current-phase.json 同目录（paths.state_file 的兄弟文件）。
// 防串会话：session_id 不符或 expires_at 过期 → stale，--correction-check 拒绝
// 并要求重建 correction（字段对齐 .current-phase.json 既有 session 治理）。

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { statefilePath } from '../../config';
import type { EnforcementTier } from './runtime-policy';
import type { RevalidateEntry } from './correction-routing';

export const CORRECTION_STATE_SCHEMA_VERSION = '1.0';

/** correction state TTL（对齐 state_machine 会话粒度：默认 24h） */
export const CORRECTION_STATE_TTL_MS = 24 * 60 * 60 * 1000;

export interface CurrentCorrectionState {
  schema_version: string;
  /** no-feature 修正为 null（--adhoc-correction 载体） */
  feature: string | null;
  root_layer: string;
  touched_layers: string[];
  revalidate: RevalidateEntry[];
  status: 'pending' | 'closed';
  created_at: string;
  /** 对齐 .current-phase.json session 治理 */
  session_id: string | null;
  /** 修正起点；changed-files 推导基准 */
  base_commit: string;
  /** 原始修正请求摘要 hash，防换题复用 */
  request_fingerprint: string;
  enforcement_tier: EnforcementTier;
  expires_at: string;
  /** --adhoc-correction 经 catalog 反查记录的触及模块（no-feature 越界防护替代证据） */
  touched_modules?: string[];
}

export function correctionStatePath(projectRoot: string): string {
  return path.join(path.dirname(statefilePath(projectRoot)), '.current-correction.json');
}

export function requestFingerprint(requestText: string): string {
  return crypto.createHash('sha256').update(requestText.trim()).digest('hex').slice(0, 16);
}

/** 当前 HEAD sha（修正起点）；非 git 仓库 → null（调用方 fail-closed）。 */
export function resolveBaseCommit(projectRoot: string): string | null {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf-8',
    shell: false,
  });
  if (r.status !== 0 || !r.stdout) return null;
  const sha = r.stdout.trim();
  return /^[0-9a-f]{7,40}$/i.test(sha) ? sha : null;
}

export function buildCorrectionState(input: {
  feature: string | null;
  root_layer: string;
  touched_layers: string[];
  revalidate: RevalidateEntry[];
  session_id?: string | null;
  base_commit: string;
  request_text: string;
  enforcement_tier: EnforcementTier;
  now?: Date;
}): CurrentCorrectionState {
  const now = input.now ?? new Date();
  return {
    schema_version: CORRECTION_STATE_SCHEMA_VERSION,
    feature: input.feature,
    root_layer: input.root_layer,
    touched_layers: [...input.touched_layers],
    revalidate: input.revalidate.map((r) => ({ ...r })),
    status: 'pending',
    created_at: now.toISOString(),
    session_id: input.session_id ?? null,
    base_commit: input.base_commit,
    request_fingerprint: requestFingerprint(input.request_text),
    enforcement_tier: input.enforcement_tier,
    expires_at: new Date(now.getTime() + CORRECTION_STATE_TTL_MS).toISOString(),
  };
}

export function writeCorrectionState(projectRoot: string, state: CurrentCorrectionState): string {
  const abs = correctionStatePath(projectRoot);
  const dir = path.dirname(abs);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  return abs;
}

/** 读取并做形状校验；缺失/损坏/版本不符 → null（消费方要求先重建 correction）。 */
export function readCorrectionState(projectRoot: string): CurrentCorrectionState | null {
  const abs = correctionStatePath(projectRoot);
  if (!fs.existsSync(abs)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(abs, 'utf-8')) as Partial<CurrentCorrectionState>;
    if (raw.schema_version !== CORRECTION_STATE_SCHEMA_VERSION) return null;
    if (typeof raw.root_layer !== 'string' || !raw.root_layer) return null;
    if (!Array.isArray(raw.touched_layers) || !Array.isArray(raw.revalidate)) return null;
    if (typeof raw.created_at !== 'string' || typeof raw.expires_at !== 'string') return null;
    if (typeof raw.base_commit !== 'string' || !raw.base_commit) return null;
    if (raw.status !== 'pending' && raw.status !== 'closed') return null;
    return raw as CurrentCorrectionState;
  } catch {
    return null;
  }
}

export interface CorrectionStaleness {
  stale: boolean;
  reason?: 'expired' | 'session_mismatch';
}

/**
 * stale 判定：过期或 session 不符（双方都有 session_id 且不同——state 无 session
 * 或当前无 session 时不判串会话，交给 TTL 兜底）。
 */
export function assessCorrectionStaleness(
  state: CurrentCorrectionState,
  opts?: { now?: Date; currentSessionId?: string | null },
): CorrectionStaleness {
  const now = opts?.now ?? new Date();
  const expires = Date.parse(state.expires_at);
  if (Number.isFinite(expires) && now.getTime() > expires) {
    return { stale: true, reason: 'expired' };
  }
  const cur = opts?.currentSessionId?.trim();
  if (cur && state.session_id && state.session_id !== cur) {
    return { stale: true, reason: 'session_mismatch' };
  }
  return { stale: false };
}

export function clearCorrectionState(projectRoot: string): boolean {
  const abs = correctionStatePath(projectRoot);
  if (!fs.existsSync(abs)) return false;
  fs.unlinkSync(abs);
  return true;
}

/**
 * 当前会话信号：复用 .current-phase.json 既有 session 治理（hook 每轮刷新
 * last_seen_session_id，代表"现在是谁在会话"；session_id 为任务绑定会话，作次选）。
 * 无 state / 无信号 → null（staleness 退回 TTL 兜底——codex 批次 2 review P1：
 * correction-init/check 须真实接线 session，否则 session_mismatch 永不触发）。
 */
export function resolveCurrentSessionSignal(projectRoot: string): string | null {
  try {
    const abs = statefilePath(projectRoot);
    if (!fs.existsSync(abs)) return null;
    const raw = JSON.parse(fs.readFileSync(abs, 'utf-8')) as {
      session_id?: unknown;
      last_seen_session_id?: unknown;
    };
    const cand = [raw.last_seen_session_id, raw.session_id].find(
      (v) => typeof v === 'string' && (v as string).trim() !== '',
    );
    return (cand as string | undefined) ?? null;
  } catch {
    return null;
  }
}
