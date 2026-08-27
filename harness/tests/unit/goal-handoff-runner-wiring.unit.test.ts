import * as fs from 'fs';
import * as path from 'path';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

export function runAll(): Array<{ name: string; ok: boolean; error?: string }> {
  try {
    const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'scripts', 'goal-phase-runtime-process.ts'), 'utf8');
    const verdict = source.indexOf('goalEvents.decideAndEmit({');
    const poll = source.indexOf('consumeHandoffAtBoundary', verdict);
    const quiesce = source.lastIndexOf('quiesceRunOwner(runControl.dir');
    assert(verdict >= 0 && poll > verdict && quiesce > poll, 'handoff must poll after phase verdict');
    assert(source.includes("type: 'handoff_requested'"), 'current owner authors requested event');
    assert(source.includes("type: 'handoff_accepted'"), 'new owner authors accepted event');
    assert(source.includes('runConcluded = true;'), 'quiescent transfer must suppress terminal run_end');
    assert(source.includes("acceptConsumedHandoff(runControl.dir, runControl.token, 'process')"), 'process accepts before work');
    return [{ name: 'detached runner polls and quiesces only at phase boundary', ok: true }];
  } catch (error) {
    return [{ name: 'detached runner polls and quiesces only at phase boundary', ok: false, error: (error as Error).message }];
  }
}
