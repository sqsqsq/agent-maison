import * as fs from 'fs';
import * as path from 'path';
import type { AgentInvokeOptions, HeadlessInvokePlan } from '../../scripts/utils/agent-invoke';

export interface ReplayInput { root: string; frameworkRoot: string; runId: string; stateDir: string; mode: 'stalled' | 'improved' }

/** Importing this transport-only preload must not import the CLI under test before Node runs its main entry. */
export function installReplayTransport(configFile: string): () => void {
  const invoke = require('../../scripts/utils/agent-invoke') as typeof import('../../scripts/utils/agent-invoke');
  const original = invoke.invokeAgentHeadless;
  const input = JSON.parse(fs.readFileSync(configFile, 'utf8')) as ReplayInput;
  const harness = path.resolve(__dirname, '../..');
  const actor = path.resolve(__dirname, '../unit/completion-running.unit.test.ts');
  invoke.invokeAgentHeadless = (plan: HeadlessInvokePlan, cwd: string, options: AgentInvokeOptions = {}) => {
    const argv = [process.execPath, '-r', require.resolve('ts-node/register/transpile-only'), '-e',
      `require(${JSON.stringify(actor)}).replayAuthor(${JSON.stringify(configFile)}).catch(e=>{console.error(e.stack);process.exitCode=1;});`];
    fs.appendFileSync(path.join(input.stateDir, 'transport-plans.jsonl'), JSON.stringify({ adapter: plan.adapterName, argv: plan.argv, executed_argv: argv }) + '\n');
    return original({ argv, label: 'controlled Node tool replay; no model CLI', adapterName: undefined }, cwd,
      { ...options, terminalEventParser: 'codex_turn_jsonl', toolEventCapture: 'structured_events',
        extraEnv: { ...options.extraEnv, TS_NODE_PROJECT: path.join(harness, 'tsconfig.json') },
        onObservation: observation => {
          options.onObservation?.(observation);
          if (observation.type !== 'tool_result') return;
          const file = path.join(input.stateDir, 'actual-checks.jsonl');
          const rows = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').length : 0;
          fs.writeFileSync(path.join(input.stateDir, `round-${rows}-observed`), 'native parser notified the real runtime');
        } });
  };
  return () => { invoke.invokeAgentHeadless = original; };
}
