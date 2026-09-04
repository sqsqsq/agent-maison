import * as fs from 'fs';
import * as path from 'path';
import { componentIndexPath } from '../../config';
import { CheckResult } from './types';
import { readComponentIndex, readComponentCatalog, scanComponentIndex, serializeComponentIndex } from './component-assets';

export function componentResult(id: string, status: CheckResult['status'], details: string): CheckResult {
  const blocking = status === 'FAIL' && ['component_asset_selection', 'component_export_registered', 'component_new_static_checks'].includes(id);
  return { id, status, details, category: 'traceability', severity: blocking ? 'BLOCKER' : 'MAJOR', description: '组件资产一致性',
    ...(status === 'FAIL' ? { suggestion: '修正组件资产声明；源码变化后重跑 bootstrap:component-index，策展变更经 /component-catalog-bootstrap 逐条确认。' } : {}) };
}
export function checkComponentCatalog(root: string): CheckResult[] {
  if (!fs.existsSync(componentIndexPath(root))) return [componentResult('component_index_fresh', 'SKIP', '未启用组件索引')];
  try {
    const index = readComponentIndex(root)!;
    const fresh = scanComponentIndex(root);
    const result = [componentResult('component_index_fresh', serializeComponentIndex(index) === serializeComponentIndex(fresh.index) ? 'PASS' : 'FAIL', '索引与源码重扫比较；不一致请重跑 bootstrap:component-index')];
    for (const warning of fresh.warnings) result.push(componentResult('component_export_warning', 'WARN', warning));
    const catalog = readComponentCatalog(root);
    const ids = new Set(fresh.index.components.map(c => c.id));
    const cards = new Map(catalog.components.map(c => [c.id, c]));
    for (const id of ids) if (!cards.has(id)) result.push(componentResult('component_uncurated', 'WARN', `${id}: uncurated；按需运行 /component-catalog-bootstrap`));
    for (const card of catalog.components) {
      if (!ids.has(card.id)) result.push(componentResult('component_catalog_dangling', 'WARN', `${card.id}: dangling；请人决定迁移或删除，保留原策展状态`));
      for (const other of card.easily_confused_with) {
        if (!ids.has(other)) result.push(componentResult('component_catalog_reference', 'WARN', `${card.id}: easily_confused_with 不存在：${other}`));
        else if (!cards.get(other)?.easily_confused_with.includes(card.id)) result.push(componentResult('component_catalog_reference', 'WARN', `${card.id} ↔ ${other} 缺互链；经确认补齐`));
      }
      if (card.golden) {
        const file = path.join(root, card.golden.file);
        if (!fs.existsSync(file) || !fs.statSync(file).isFile() || !fs.readFileSync(file, 'utf8').includes(card.golden.symbol)) result.push(componentResult('component_golden_missing', 'WARN', `${card.id}: golden 文件/符号不存在`));
      }
    }
    return result;
  } catch (error) { return [componentResult('component_index_fresh', 'FAIL', (error as Error).message)]; }
}
