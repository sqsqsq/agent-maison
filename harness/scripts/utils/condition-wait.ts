// ============================================================================
// condition-wait.ts — 停机探针的同一份实现与进程内有界等待（plan 4e6fb3b6 §5.1）
// ----------------------------------------------------------------------------
// 带探针的停机（设备未就绪 / 能力预检缺口 / 候选写回不可用）在停放之前先在进程内等一会：
// 探针就绪只是"可以重试了"的提示，是否恢复仍由原来的检查（设备门、能力门、写回事务）确认。
// supervisor 唤醒停放 run 与 runtime 进程内等待调用同一个 runConditionProbe，不各写一份。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { loadFrameworkConfig } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
import { probeDeviceReadiness } from './device-readiness-deps';
import { probeCapabilityPreflight } from './capability-preflight';
import type { ReadinessProbeName } from './device-readiness-gate';

export interface ConditionProbeResult {
  ready: boolean;
  reason?: string;
}

/** 停机事件 `probe` 字段的只读实现（不唤醒、不解锁、不写盘）。 */
export function runConditionProbe(
  projectRoot: string,
  reportDir: string,
  probe: string,
  phase?: string,
): ConditionProbeResult {
  if (probe === 'storage_ready') {
    const reportDirAbs = path.join(projectRoot, reportDir);
    try {
      fs.accessSync(reportDirAbs, fs.constants.W_OK);
      return { ready: true, reason: 'run report directory is writable' };
    } catch (error) {
      return { ready: false, reason: 'run report directory is not writable: ' + String((error as Error).message) };
    }
  }
  if (
    probe === 'device_readiness' ||
    probe === 'credential_state_ready' ||
    probe === 'adapter_capability_ready'
  ) {
    const result = probeDeviceReadiness(projectRoot, probe as ReadinessProbeName);
    return { ready: result.ready, reason: result.reason };
  }
  if (probe === 'capability_preflight_ready') {
    if (!phase?.trim()) return { ready: false, reason: 'capability probe 缺少责任 phase' };
    const cfg = loadFrameworkConfig(projectRoot);
    const resolved = loadResolvedProfile(projectRoot, cfg);
    const result = probeCapabilityPreflight(projectRoot, phase.trim(), resolved);
    return {
      ready: result.ready,
      reason: result.reason ?? result.code ?? 'capability preflight not ready',
    };
  }
  if (probe === 'design_authority_projectable') {
    // plan 9c3d7e1a §5.1：只读重跑该阶段的设计权威门；停机时记录的每一条设计 owner 阻断都不再阻断才算就绪（混合阻断逐条查）。
    // 就绪只表示可以重试——绑定是否仍有效、门是否真过，由恢复判断与原检查确认。
    if (!phase?.trim()) return { ready: false, reason: 'design authority probe 缺少责任 phase' };
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { loadEventsJsonl } = require('./goal-runner-phase') as typeof import('./goal-runner-phase');
    /* eslint-enable @typescript-eslint/no-require-imports */
    const runDir = path.join(projectRoot, reportDir);
    const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8')) as { feature?: unknown; run_id?: unknown };
    const halt = [...loadEventsJsonl(path.join(runDir, 'events.jsonl'))].reverse()
      .find((event) => event.type === 'phase_halt' && (event as { probe?: unknown }).probe === probe) as { design_authority?: { items?: Array<{ check?: unknown }> } } | undefined;
    return probeDesignAuthorityRecovered(projectRoot, String(manifest.feature ?? ''), phase.trim(),
      (halt?.design_authority?.items ?? []).map((item) => String(item.check)), typeof manifest.run_id === 'string' ? manifest.run_id : undefined);
  }
  return { ready: false, reason: 'unsupported condition probe: ' + probe };
}

/**
 * 探针 design_authority_projectable 的判定本体（plan 9c3d7e1a §5.1 / §5.5 第 6 步）：`recorded` 里每一条设计 owner 阻断都不再阻断才就绪。
 * 停放后由探针从停机事件读出 `recorded`；运行中（无人值守修复发布之后）由运行时显式传入本次的真实阻断——同一判定，不另写诊断。
 */
export function probeDesignAuthorityRecovered(projectRoot: string, feature: string, phase: string, recorded: readonly string[], runId?: string): ConditionProbeResult {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { diagnoseDesignAuthority } = require('./blueprint-skill-projection') as typeof import('./blueprint-skill-projection');
  const { resolveProbeFrameworkRoot } = require('../../repo-layout') as typeof import('../../repo-layout');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const checks = new Set(recorded);
  if (!checks.size) return { ready: false, reason: '停机事件没有记录设计 owner 阻断' };
  const diagnosis = diagnoseDesignAuthority(projectRoot, resolveProbeFrameworkRoot(projectRoot), feature, phase, runId);
  // 门重评不了 ≠ 阻断已消除：不就绪（提前就绪会白白消耗 supervisor 不可重置的重启次数）。
  if (diagnosis.unevaluable) return { ready: false, reason: '设计权威门无法重评：' + diagnosis.unevaluable };
  const open = diagnosis.findings.filter((finding) => checks.has(finding.check));
  return open.length
    ? { ready: false, reason: '设计 owner 阻断仍在：' + open.map((finding) => finding.check + '[' + finding.codes.join(',') + ']').join('；') }
    : { ready: true, reason: '停机时记录的设计 owner 阻断（' + [...checks].join('、') + '）均已不再阻断' };
}

/** 进程内等待的固定上限；实际上限另取剩余墙钟预算的较小者。 */
export const CONDITION_WAIT_MAX_MS = 15 * 60_000;
export const CONDITION_WAIT_POLL_MS = 30_000;

/**
 * 有界等待：先探一次，之后每 pollMs 探一次；探针就绪就调 recheck 让原检查确认，
 * 原检查通过即返回 true（已恢复）。上限到了仍未恢复返回 false，调用方按现状停放。
 * 上限 = min(maxWaitMs, availableMs)；≤0 时不等、不写事件。异步 sleep，进程的 heartbeat
 * 定时器照常运行，等待时长落在当前执行会话里，由既有会话分段计入活跃时长。
 * 事件恰好三种：开始一条；恢复或超时各一条收尾（探针就绪但原检查仍失败只计数，不单独落事件）。
 * 事件不带 halt_reason（写盘层会给带 halt_reason 的事件补处置投影），停机原因记在 blocked_by。
 */
export async function waitForConditionRecovery(opts: {
  phase: string;
  probe: string;
  blockedBy: string;
  availableMs: number;
  runProbe: () => ConditionProbeResult;
  /**
   * 原检查重做一次；入参是本次等待剩余的额度（有耗时操作的重查据此收紧自己的时限）。
   * 返回 'park' = 条件已就绪但不该在本进程里继续（plan 9c3d7e1a §5.3：冻结绑定已 stale，要由恢复入口起后继）——立即按超时收尾停放。
   */
  recheck: (remainingMs: number) => Promise<boolean | 'park'>;
  emit: (event: Record<string, unknown>) => void;
  maxWaitMs?: number;
  pollMs?: number;
}): Promise<boolean> {
  const maxWaitMs = opts.maxWaitMs ?? CONDITION_WAIT_MAX_MS;
  const pollMs = opts.pollMs ?? CONDITION_WAIT_POLL_MS;
  const limitMs = Math.min(maxWaitMs, opts.availableMs);
  if (!(limitMs > 0)) return false;
  const base = { phase: opts.phase, probe: opts.probe, blocked_by: opts.blockedBy };
  const startMs = Date.now();
  opts.emit({ type: 'condition_wait_started', ...base, limit_ms: limitMs, poll_ms: pollMs });
  let probeReadyCount = 0;
  let lastReason: string | undefined;
  for (;;) {
    let result: ConditionProbeResult;
    try {
      result = opts.runProbe();
    } catch (error) {
      result = { ready: false, reason: 'probe failed: ' + String((error as Error).message) };
    }
    lastReason = result.reason;
    if (result.ready) probeReadyCount += 1;
    // 同步探针本身可能把余额耗尽：余额已尽就不再重查（不把非正余额交给原检查），按超时收尾。
    if (limitMs - (Date.now() - startMs) <= 0) break;
    const rechecked = result.ready ? await opts.recheck(limitMs - (Date.now() - startMs)) : false;
    if (rechecked === true) {
      opts.emit({ type: 'condition_wait_ready', ...base, waited_ms: Date.now() - startMs });
      return true;
    }
    if (rechecked === 'park') break;
    const remainingMs = limitMs - (Date.now() - startMs);
    if (remainingMs <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, remainingMs)));
    // 批二 review R2：睡醒已到上限就不再探测、不再重查（原先会在上限时刻多探一次并重查）。
    if (Date.now() - startMs >= limitMs) break;
  }
  opts.emit({
    type: 'condition_wait_timeout',
    ...base,
    waited_ms: Date.now() - startMs,
    probe_ready_count: probeReadyCount,
    ...(lastReason ? { last_probe_reason: lastReason.slice(0, 500) } : {}),
  });
  return false;
}
