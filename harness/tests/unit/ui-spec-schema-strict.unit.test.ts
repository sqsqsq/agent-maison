// ============================================================================
// ui-spec-schema-strict.unit.test.ts — P0-2（plan 7c4f2e9b）
// screen/componentNode 未知键硬拒 + did-you-mean + 三方漂移（schema↔validator↔TS 类型）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  validateUiSpecSchema,
  suggestLegalKey,
  SCREEN_ALLOWED_KEYS,
  COMPONENT_NODE_ALLOWED_KEYS,
} from '../../../profiles/hmos-app/harness/ui-spec-schema-validate';
import type { UiSpecDoc, UiSpecScreen, UiSpecComponentNode } from '../../scripts/utils/ui-spec-shared';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

// ---- 三方漂移的编译期锚：TS 类型键集（Record<keyof Required<T>, true> 强制穷举，
// 类型加字段没登记这里会编译失败）----
const TS_SCREEN_KEYS: Record<keyof Required<UiSpecScreen>, true> = {
  id: true,
  priority: true,
  ref_id: true,
  root: true,
  lightweight: true,
  must_have_elements: true,
  forbidden_overlap: true,
  protected_region: true,
};
const TS_NODE_KEYS: Record<keyof Required<UiSpecComponentNode>, true> = {
  id: true,
  type: true,
  block: true,
  layout: true,
  order: true,
  text: true,
  data_binding: true,
  style_ref: true,
  asset_ref: true,
  bbox: true,
  semantic_role: true,
  color_ref: true,
  icon: true,
  badge: true,
  source_ref: true,
  variant: true,
  layout_group: true,
  align: true,
  width_ratio: true,
  bg_color: true,
  fidelity_note: true,
  subtitle: true,
  subtitle_position: true,
  children: true,
};

const FIX = path.resolve(__dirname, '..', 'fixtures', 'cc-spec-deadlock');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const YAML = require('yaml') as { parse: (s: string) => unknown };

function baseDoc(): Record<string, unknown> {
  return {
    schema_version: '1.0',
    screens: [
      {
        id: 's1',
        priority: 'P0',
        must_have_elements: ['a'],
        root: { type: 'content_display', order: 0, text: 'x' },
      },
    ],
    tokens: { c1: { kind: 'color', value: '#fff' } },
    assets: [],
  };
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'strict: 事故键 must_have → FAIL + did-you-mean must_have_elements',
    run: () => {
      const doc = baseDoc();
      (doc.screens as Array<Record<string, unknown>>)[0].must_have = ['a'];
      const errs = validateUiSpecSchema(doc as unknown as UiSpecDoc);
      const hit = errs.find(e => e.includes('"must_have"'));
      if (!hit) throw new Error(`未拦 must_have：${JSON.stringify(errs)}`);
      if (!hit.includes('must_have_elements')) throw new Error(`无 did-you-mean：${hit}`);
    },
  },
  {
    name: 'strict: componentNode 未知键 props → FAIL',
    run: () => {
      const doc = baseDoc();
      ((doc.screens as Array<Record<string, unknown>>)[0].root as Record<string, unknown>).props = { a: 1 };
      const errs = validateUiSpecSchema(doc as unknown as UiSpecDoc);
      if (!errs.some(e => e.includes('"props"'))) throw new Error(`未拦 props：${JSON.stringify(errs)}`);
    },
  },
  {
    name: 'strict: 全部合法键（含 P0-2 补登记 semantic_role/color_ref/icon/badge/source_ref）→ 零未知键错误',
    run: () => {
      const doc = baseDoc();
      const s = (doc.screens as Array<Record<string, unknown>>)[0];
      Object.assign(s, {
        ref_id: 'r1', lightweight: false, forbidden_overlap: [['a', 'b']], protected_region: ['a'],
      });
      s.root = {
        type: 'action_button', order: 0, id: 'n1', layout: 'row', text: 't', data_binding: 'd',
        style_ref: 'st', asset_ref: 'ak', bbox: [0, 0, 0.5, 0.1], variant: 'filled',
        layout_group: 'g', align: 'start', width_ratio: 0.5, bg_color: 'bg', fidelity_note: 'f',
        subtitle: 'sub', subtitle_position: 'trailing', semantic_role: 'brand_primary',
        color_ref: 'brand.x', icon: { kind: 'brand_logo', ref: 'logo' }, badge: 'HOT', source_ref: 'el1',
        children: [],
      };
      const errs = validateUiSpecSchema(doc as unknown as UiSpecDoc);
      const unknown = errs.filter(e => e.includes('非法字段'));
      if (unknown.length) throw new Error(JSON.stringify(unknown));
    },
  },
  {
    name: 'strict: 三方漂移——validator 派生键集 ≡ schema properties ≡ TS 类型键集',
    run: () => {
      const tsScreen = Object.keys(TS_SCREEN_KEYS).sort();
      const tsNode = Object.keys(TS_NODE_KEYS).sort();
      const vScreen = [...SCREEN_ALLOWED_KEYS].sort();
      const vNode = [...COMPONENT_NODE_ALLOWED_KEYS].sort();
      if (JSON.stringify(tsScreen) !== JSON.stringify(vScreen)) {
        throw new Error(`screen 漂移：TS=${tsScreen} schema=${vScreen}`);
      }
      if (JSON.stringify(tsNode) !== JSON.stringify(vNode)) {
        throw new Error(`node 漂移：TS=${tsNode} schema=${vNode}`);
      }
    },
  },
  {
    name: 'strict: 事故终态 fixture（i3 错键 must_have）→ 拦截并给正名指引',
    run: () => {
      const raw = fs.readFileSync(path.join(FIX, 'i3-wrong-key-ui-spec.yaml'), 'utf-8');
      const doc = YAML.parse(raw) as UiSpecDoc;
      const errs = validateUiSpecSchema(doc);
      const hit = errs.find(e => e.includes('"must_have"') && e.includes('must_have_elements'));
      if (!hit) throw new Error(`事故 fixture 未拦：${JSON.stringify(errs.slice(0, 5))}`);
    },
  },
  {
    name: 'strict: i2-pass fixture 全合法（回放 A 前提）',
    run: () => {
      const raw = fs.readFileSync(path.join(FIX, 'i2-pass-artifacts', 'ui-spec.yaml'), 'utf-8');
      const doc = YAML.parse(raw) as UiSpecDoc;
      const errs = validateUiSpecSchema(doc);
      if (errs.length) throw new Error(JSON.stringify(errs));
    },
  },
  {
    name: 'suggestLegalKey: 前缀/编辑距离/无建议三形态',
    run: () => {
      if (suggestLegalKey('must_have', SCREEN_ALLOWED_KEYS) !== 'must_have_elements') throw new Error('前缀建议失败');
      if (suggestLegalKey('prority', SCREEN_ALLOWED_KEYS) !== 'priority') throw new Error('编辑距离建议失败');
      if (suggestLegalKey('zzzz_totally_alien', SCREEN_ALLOWED_KEYS) !== null) throw new Error('无关键不应有建议');
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

if (require.main === module) {
  const r = runAll();
  for (const x of r) {
    console.log(x.ok ? `PASS ${x.name}` : `FAIL ${x.name}: ${x.error}`);
  }
  process.exit(r.every(x => x.ok) ? 0 : 1);
}
