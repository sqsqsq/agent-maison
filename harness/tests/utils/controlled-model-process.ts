import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
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

/** Owned Node program behind the public Codex launcher and its read-only model catalogue. */
export function installControlledCodex(root: string, program: string): () => void {
  const directory = path.join(root, 'controlled-cli');
  fs.mkdirSync(directory, { recursive: true });
  const driver = path.join(directory, 'codex-fixture.cjs');
  fs.writeFileSync(driver, `if(process.argv.includes('app-server')) {
const lines=require('readline').createInterface({input:process.stdin});
lines.on('line',line=>{const row=JSON.parse(line);if(row.id===0)process.stdout.write(JSON.stringify({id:0,result:{}})+'\\n');
if(row.id===1)process.stdout.write(JSON.stringify({id:1,result:{data:[{model:'gpt-6.1-sol'}]}})+'\\n');});
} else require(${JSON.stringify(program)});\n`);
  if (process.platform === 'win32') fs.writeFileSync(path.join(directory, 'codex.cmd'), '@echo off\nset "_prog=node"\n"%_prog%" "%~dp0codex-fixture.cjs" %*\n');
  else {
    const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
    fs.writeFileSync(path.join(directory, 'codex'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(driver)} "$@"\n`, { mode: 0o755 });
  }
  const prior = process.env.PATH;
  process.env.PATH = directory + path.delimiter + (prior ?? '');
  return () => { if (prior === undefined) delete process.env.PATH; else process.env.PATH = prior; };
}
