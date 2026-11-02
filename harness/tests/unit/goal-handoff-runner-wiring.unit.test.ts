import * as fs from 'fs';
import * as path from 'path';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

export function runAll(): Array<{ name: string; ok: boolean; error?: string }> {
  try {
    const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'scripts', 'goal-phase-runtime.ts'), 'utf8');
    const helperAt = source.indexOf('const consumeCompletedBoundaryHandoff =');
    const helperEnd = source.indexOf('const reviseCurrentScope =', helperAt);
    const helper = source.slice(helperAt, helperEnd);
    const consume = helper.indexOf('consumeHandoffAtBoundary(runControl.dir, runControl.token)');
    const quiesce = helper.indexOf('quiesceRunOwner(runControl.dir');
    assert(helperAt >= 0 && helperEnd > helperAt && consume >= 0 && quiesce > consume,
      'completed boundary helper must consume and quiesce through the existing handoff protocol');
    const verdict = source.indexOf('goalEvents.emitPhaseVerdict({ phase: family');
    const poll = source.indexOf('consumeCompletedBoundaryHandoff()', verdict);
    assert(verdict >= 0 && poll > verdict, 'handoff must poll after a real check-family result');
    const verifier = source.indexOf('if (bound && !affected && summary?.verifier_request');
    const verifierPoll = source.indexOf('consumeCompletedBoundaryHandoff()', verifier);
    const reusable = source.indexOf('if (bound && !affected && !producerContinued) continue;', verifier);
    assert(verifier >= 0 && verifierPoll > verifier && reusable > verifierPoll,
      'independent result recovery must poll before returning to reusable work');
    assert(helper.includes("type: 'handoff_requested'"), 'current owner authors requested event');
    assert(source.includes("type: 'handoff_accepted'"), 'new owner authors accepted event');
    assert(helper.includes('runConcluded = true;'), 'quiescent transfer must suppress terminal run_end');
    const accept = source.indexOf('acceptConsumedHandoff(runControl.dir, runControl.token, runtimeOwnerKind)');
    const unitLoop = source.indexOf('while (!halted && !dryRun)');
    assert(accept >= 0 && unitLoop > accept, 'target runtime owner must accept handoff before unit work');
    assert(source.includes('acceptedHandoff?.target_owner_kind === runtimeOwnerKind'),
      'accepted handoff must be bound to the selected runtime owner kind');
    return [{ name: 'shared runtime polls at actual check boundary and accepts target ownership before work', ok: true }];
  } catch (error) {
    return [{ name: 'shared runtime actual check handoff preserves quiescent owner transfer', ok: false, error: (error as Error).message }];
  }
}
