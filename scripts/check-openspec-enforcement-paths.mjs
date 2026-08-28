import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_PATH_PREFIX = /^(?:agents|docs|harness|openspec|profiles|scripts|skills|specs|templates|workflows)\//;
const EXACT_FILE_REFERENCE = /^(?:[A-Za-z0-9_.{}*-]+\/)*[A-Za-z0-9_.{}*-]+\.[A-Za-z0-9{}*-]+$/;

function walkFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  visit(root);
  return files;
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

export function enforcementGlobRegex(pattern) {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        source += '.*';
        index += 1;
      } else {
        source += '[^/]*';
      }
      continue;
    }
    if (char === '{') {
      const close = pattern.indexOf('}', index + 1);
      if (close >= 0) {
        const alternatives = pattern.slice(index + 1, close).split(',').map(escapeRegex);
        source += `(?:${alternatives.join('|')})`;
        index = close;
        continue;
      }
    }
    source += escapeRegex(char);
  }
  return new RegExp(`^${source}$`);
}

export function collectEnforcementReferences(specFile) {
  const source = fs.readFileSync(specFile, 'utf8');
  const references = [];
  source.split(/\r?\n/).forEach((line, index) => {
    if (!/^Enforcement:\s*/.test(line)) return;
    for (const match of line.matchAll(/`([^`]+)`/g)) {
      const reference = match[1].replace(/\\/g, '/').trim();
      if (REPO_PATH_PREFIX.test(reference) || EXACT_FILE_REFERENCE.test(reference)) {
        references.push({ reference, line: index + 1 });
      }
    }
  });
  return references;
}

export function validateEnforcementPaths({
  repoRoot,
  specRoot = path.join(repoRoot, 'openspec', 'specs'),
}) {
  const repoFiles = walkFiles(repoRoot)
    .map(file => path.relative(repoRoot, file).replace(/\\/g, '/'));
  const specFiles = walkFiles(specRoot).filter(file => path.basename(file) === 'spec.md');
  const diagnostics = [];
  for (const specFile of specFiles) {
    for (const item of collectEnforcementReferences(specFile)) {
      const isGlob = /[*{}]/.test(item.reference);
      const exists = isGlob
        ? repoFiles.some(file => enforcementGlobRegex(item.reference).test(file))
        : fs.existsSync(path.join(repoRoot, ...item.reference.split('/')));
      if (!exists) {
        diagnostics.push({
          spec: path.relative(repoRoot, specFile).replace(/\\/g, '/'),
          line: item.line,
          reference: item.reference,
          kind: isGlob ? 'glob_without_matches' : 'missing_path',
        });
      }
    }
  }
  return diagnostics;
}

function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, '..');
  const diagnostics = validateEnforcementPaths({ repoRoot });
  if (diagnostics.length > 0) {
    console.error('[openspec-enforcement] FAIL: canonical Enforcement 引用了不存在的实现路径：');
    for (const item of diagnostics) {
      console.error(`  - ${item.spec}:${item.line} ${item.reference} (${item.kind})`);
    }
    process.exitCode = 1;
    return;
  }
  console.log('[openspec-enforcement] PASS: canonical Enforcement 路径与 glob 均可解析。');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
