import * as path from 'path';
import * as YAML from 'yaml';

const parsedFiles = new Map<string, { text: string; value: unknown }>();
const MAX_FILES = 128;

/** Callers still read current bytes; only parsing is reused, never validation or a mutable result. */
export function parseYamlCached<T = unknown>(file: string, text: string): T {
  const key = path.resolve(file);
  let entry = parsedFiles.get(key);
  if (!entry || entry.text !== text) {
    entry = { text, value: YAML.parse(text) };
    parsedFiles.set(key, entry);
    if (parsedFiles.size > MAX_FILES) parsedFiles.delete(parsedFiles.keys().next().value!);
  }
  return structuredClone(entry.value) as T;
}
