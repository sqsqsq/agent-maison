const cp = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const fs = require('fs');
const fsOriginals = {};
const originals = {};
const attempts = [];
const models = new Set(['codex', 'claude', 'opencode', 'dsh']);
const devices = new Set(['hdc', 'adb', 'hvigor', 'hypium', 'hylyre', 'python', 'python3', 'py']);
const forbiddenHost = path.resolve('D:/1.code/SimulatedWalletForHmos').toLowerCase();
for (const name of ['readFileSync','existsSync','statSync','lstatSync','realpathSync','readdirSync','createReadStream',
  'writeFileSync','appendFileSync','renameSync','unlinkSync','rmSync','mkdirSync','cpSync','copyFileSync']) {
  fsOriginals[name] = fs[name];
  const wrapped = function(...args) {
    const locations = ['renameSync','cpSync','copyFileSync'].includes(name) ? args.slice(0,2) : args.slice(0,1);
    for (let value of locations) {
      if (value instanceof URL) value = require('url').fileURLToPath(value);
      if (typeof value !== 'string') continue;
      if (value.startsWith(String.fromCharCode(92,92,63,92))) value = value.slice(4);
      const resolved = path.resolve(value).toLowerCase();
      if (resolved === forbiddenHost || resolved.startsWith(forbiddenHost + path.sep)) {
        attempts.push('host-fs:' + name);
        throw Object.assign(new Error('Real host filesystem is outside the isolated replay'), { code: 'EACCES' });
      }
    }
    return fsOriginals[name].apply(this,args);
  };
  Object.assign(wrapped, fs[name]);
  fs[name] = wrapped;
}
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync']) {
  originals[name] = cp[name];
  cp[name] = function(file, ...args) {
    const command = String(file);
    const executable = name === 'exec' || name === 'execSync'
      ? (command.match(/^\s*(?:"([^"]+)"|'([^']+)'|([^\s]+))/)?.slice(1).find(Boolean) || command) : command;
    const base = path.basename(executable).toLowerCase().replace(/\.(exe|cmd|ps1)$/, '');
    const shellTool = ['cmd', 'powershell', 'pwsh'].includes(base)
      ? args.flat(Infinity).join(' ').match(/\b(codex|claude|dsh|hdc|adb|hvigor|hypium|hylyre|python|python3|py)\.(?:cmd|exe|ps1)\b/i)?.[1]?.toLowerCase() : undefined;
    const tool = shellTool || base;
    if (!models.has(tool) && !devices.has(tool)) return originals[name].call(this, file, ...args);
    attempts.push(tool);
    const error = Object.assign(new Error(`Native tool unavailable in isolated Node replay: ${tool}`), { code: 'ENOENT' });
    if (models.has(tool)) throw error;
    if (name === 'spawnSync') return { pid: 0, status: null, signal: null, error, stdout: '', stderr: '', output: [null, '', ''] };
    if (name.endsWith('Sync')) throw error;
    const child = new EventEmitter(); child.pid = 0; child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => false;
    const callback = args.at(-1);
    process.nextTick(() => {
      child.stdout.end(); child.stderr.end();
      if (typeof callback === 'function') callback(error, '', ''); else child.emit('error', error);
      child.emit('close', null, null);
    });
    return child;
  };
}
exports.attempts = attempts;
exports.restore = () => {
  for (const [name, fn] of Object.entries(originals)) cp[name] = fn;
  for (const [name, fn] of Object.entries(fsOriginals)) fs[name] = fn;
};
