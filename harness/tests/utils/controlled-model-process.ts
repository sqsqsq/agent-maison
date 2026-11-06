import * as os from 'os';
import * as path from 'path';
import { adapterModelBinding } from '../../scripts/utils/adapter-model';
import type { invokeAgentHeadless } from '../../scripts/utils/agent-invoke';
import { resolveTerminalEventParser } from '../../scripts/utils/codex-terminal-events';

/** Explicit model input for owned Node protocol replays; never used by a real CLI smoke. */
export function controlledModelBinding(adapter: string, root = os.tmpdir()): string {
  return adapterModelBinding({ adapter, value: ['claude', 'codeagent'].includes(adapter) ? 'claude-opus-5-5' : adapter === 'opencode' ? 'fixture/model' : 'gpt-6.1-sol',
    provider: ['claude', 'codeagent'].includes(adapter) ? 'anthropic' : adapter === 'opencode' ? 'fixture' : adapter === 'cursor' ? 'cursor' : 'openai',
    ...(['codex', 'claude', 'codeagent'].includes(adapter) ? { config_source: path.join(root, 'controlled-model-home', adapter === 'codex' ? 'config.toml' : 'settings.json') } : {}) })!;
}

export function bindControlledProcess(invoke: typeof invokeAgentHeadless): typeof invokeAgentHeadless {
  return (plan, cwd, options) => {
    const adapter = plan.adapterName;
    const modelProtocol = adapter && ['codex', 'claude', 'codeagent', 'cursor', 'opencode'].includes(adapter);
    return invoke({ ...plan, adapterName: modelProtocol ? adapter : undefined,
      ...(modelProtocol ? { modelBinding: controlledModelBinding(adapter, cwd) } : {}) }, cwd,
    { ...options, terminalEventParser: options?.terminalEventParser ?? resolveTerminalEventParser(adapter),
      extraEnv: { ...options?.extraEnv, ...(['claude', 'codeagent'].includes(adapter ?? '') ? {
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com', CLAUDE_CODE_USE_BEDROCK: '0', CLAUDE_CODE_USE_VERTEX: '0', CLAUDE_CODE_USE_FOUNDRY: '0',
      } : {}) } });
  };
}
