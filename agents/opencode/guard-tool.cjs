'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function evaluate(input) {
  const core = await import(pathToFileURL(path.join(__dirname, '../shared/guard-framework-write-core.mjs')).href);
  const args = input.args ?? {}, paths = [];
  if (typeof args.filePath === 'string') paths.push(args.filePath);
  if (typeof args.file_path === 'string') paths.push(args.file_path);
  if (input.tool === 'apply_patch') for (const match of String(args.patchText ?? args.patch ?? '').matchAll(/^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm)) paths.push(match[1].trim());
  for (const filePath of paths) {
    const protection = core.evaluateFrameworkWrite({ projectRoot: input.projectRoot, filePath });
    if (protection.decision === 'deny') return protection;
  }
  return { decision: 'allow' };
}
module.exports = { evaluate };
if (require.main === module) {
  Promise.resolve().then(() => evaluate(JSON.parse(fs.readFileSync(0, 'utf8'))))
    .then(result => process.stdout.write(JSON.stringify(result)))
    .catch(() => process.stdout.write(JSON.stringify({ decision: 'allow' })));
}
