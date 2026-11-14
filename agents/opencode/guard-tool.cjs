'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const native = require('../shared/opencode-native-session.cjs');
const goalSignal = require('../shared/goal-execution-signal.cjs');

async function evaluate(input, env = process.env) {
  const core = await import(pathToFileURL(path.join(__dirname, '../shared/guard-framework-write-core.mjs')).href);
  const args = input.args ?? {}, paths = [];
  if (typeof args.filePath === 'string') paths.push(args.filePath);
  if (typeof args.file_path === 'string') paths.push(args.file_path);
  if (input.tool === 'apply_patch') for (const match of String(args.patchText ?? args.patch ?? '').matchAll(/^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm)) paths.push(match[1].trim());
  for (const filePath of paths) {
    const protection = core.evaluateFrameworkWrite({ projectRoot: input.projectRoot, filePath });
    if (protection.decision === 'deny') return protection;
  }
  if (!paths.length) return { decision: 'allow' };
  if (goalSignal.hasGoalExecutionSignal(env)) return { decision: 'allow' };
  const session = native.readOpenCodeSession(native.reference(native.openCodeDatabase(env), input.sessionID, input.callID), input.projectRoot, env);
  for (const filePath of paths) {
    const entry = core.evaluateNativeProjectEntry({ session, projectRoot: input.projectRoot, filePath });
    if (entry.decision === 'deny') return entry;
  }
  return { decision: 'allow', sessionRef: `${session.file}#${session.request.id}` };
}
module.exports = { evaluate };
if (require.main === module) {
  Promise.resolve().then(() => evaluate(JSON.parse(fs.readFileSync(0, 'utf8'))))
    .then(result => process.stdout.write(JSON.stringify(result)))
    .catch(() => process.stdout.write(JSON.stringify({ decision: 'allow', note: 'OpenCode 原生来源暂不可核；沿统一入口后验核对，不声称本次写前已核。' })));
}
