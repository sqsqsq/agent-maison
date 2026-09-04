#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import minimist from 'minimist';
import { componentIndexPath, relComponentIndex } from '../config';
import { mergeComponentCatalog, scanComponentIndex, serializeComponentIndex } from './utils/component-assets';

if (require.main === module) {
  try {
    const args = minimist(process.argv.slice(2), { string: ['project-root', 'merge-staging', 'confirmed-id'], boolean: ['dry-run'] });
    if (!args['project-root']) throw new Error('必须提供 --project-root <宿主根>');
    const root = path.resolve(args['project-root']);
    if (args['merge-staging']) {
      const ids = args['confirmed-id'] === undefined ? [] : ([] as string[]).concat(args['confirmed-id']);
      const merged = mergeComponentCatalog(root, YAML.parse(fs.readFileSync(path.resolve(args['merge-staging']), 'utf8')), ids);
      console.log(`已合并逐条确认的策展卡；现有 ${merged.components.length} 条。`);
    } else {
      const result = scanComponentIndex(root);
      const text = serializeComponentIndex(result.index);
      if (args['dry-run']) console.log(text);
      else {
        const file = componentIndexPath(root);
        fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text, 'utf8');
        console.log(`已写入 ${relComponentIndex(root)}：${result.index.components.length} 个组件。`);
      }
      for (const warning of result.warnings) console.warn(`WARN ${warning}`);
    }
  } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
}
