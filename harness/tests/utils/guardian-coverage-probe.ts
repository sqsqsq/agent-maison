import { spawn } from 'child_process';
import { buildGuardianInvocation, resolveAgentCommand } from '../../scripts/utils/agent-containment';
import type { UnitCaseResult } from '../run-unit';

export async function runAll(): Promise<UnitCaseResult[]> {
  const name = 'normal guardian preserves V8 coverage without inheriting the test loader';
  const argv = [process.execPath, '-e', "process.stdout.write(JSON.stringify({argv:process.execArgv,nodeOptions:process.env.NODE_OPTIONS??''}))"];
  const command = resolveAgentCommand(argv);
  if ('error' in command) throw new Error(command.error);
  const invocation = buildGuardianInvocation({ argv, cwd: process.cwd(), commandLine: command.commandLine, appName: command.appName }, process.pid, `test-coverage/${process.pid}`);
  if ('error' in invocation) throw new Error(invocation.error);
  const child = spawn(invocation.file, invocation.args, { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  const observed = JSON.parse(stdout) as { argv: string[]; nodeOptions: string };
  return [{ name, ok: code === 0 && !observed.argv.some(value => value.includes('compiled-register')) && !observed.nodeOptions.includes('compiled-register'),
    ...(code === 0 ? {} : { error: `${code}: ${stderr}` }) }];
}
