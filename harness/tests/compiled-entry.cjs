const path = require('path');
require('./compiled-register.cjs');
const [requestedEntry, ...args] = process.argv.slice(2);
if (!requestedEntry) throw new Error('compiled test entry is required');
const entry = path.resolve(requestedEntry);
process.argv = [process.execPath, entry, ...args];
require('module')._load(entry, null, true);
