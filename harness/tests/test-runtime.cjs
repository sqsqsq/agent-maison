const started = process.hrtime.bigint();
const path = require('node:path');

process.env.MAISON_TEST_POLL_MS ??= '10';
require('ts-node/register/transpile-only');
process.env.MAISON_TEST_STARTED_NS = started.toString();
const runner = path.resolve(__dirname, 'run-unit.ts');
require(runner).main(process.argv.slice(2)).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
