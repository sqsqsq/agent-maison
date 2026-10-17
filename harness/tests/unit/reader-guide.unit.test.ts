import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { spawnSync } from 'child_process';
import { computeBlueprintReaderGuideSourceDigest, demoteBlueprintReaderHeadings, inspectBlueprintGraphDisplay, inspectBlueprintReaderGuide, resolveBlueprintReaderSource } from '../../scripts/utils/blueprint-reader-guide';
import { identityNeutralDigest } from '../../scripts/utils/identity-neutral-digest';
import { fixture } from './blueprint-skill-projection.unit.test';
import { clearFrameworkConfigCache } from '../../config';
import type { UnitCaseResult } from '../run-unit';

const section = { section: 'solution', title: '责任与协作', prose: '只解释已有设计。', source_refs: ['/title'] };
const blueprint = () => ({ revision: 1, title: '方案', review_summary: { background: '问题', reader_guide: {} }, generated_graphs: [{ graph_id: 'sequence:submit', content: 'original' }], contracts: [{ revision: 3, reader_guide: '业务字段', authored_by: '业务作者' }] });
const cases: Array<{ name: string; run(): void }> = [
  { name: 'graph display selects only parsed guide sections and preserves canonical data', run() {
    const bp: any = blueprint(); bp.generated_graphs = [{ graph_id: 'graph:journey', label: '用户旅程', format: 'mermaid', content: 'flowchart LR\nstart["进入页面"]', relation_refs: [] }];
    const place = (sources: string[], extra = {}) => {
      bp.review_summary.reader_guide = { source_digest: computeBlueprintReaderGuideSourceDigest(bp), sections: [{ ...section, source_refs: sources, graph_ids: ['graph:journey'], ...extra }] };
    };
    for (const sources of [['/title'], ['/missing', '/title']]) {
      place(sources); const before = JSON.stringify(bp); const display = inspectBlueprintGraphDisplay(bp);
      assert.equal(display.sectionGraphs.get(display.guide.sections[0])![0], bp.generated_graphs[0]);
      assert(!display.diagnostics.some(row => row.id === 'blueprint_generated_graph_not_displayed'));
      assert.equal(JSON.stringify(bp), before);
    }
    for (const configure of [() => place(['/missing']), () => place(['/title'], { section: 'invalid' }), () => { place(['/title']); bp.title += '!'; }]) {
      configure(); const before = JSON.stringify(bp); const display = inspectBlueprintGraphDisplay(bp);
      const omitted = display.diagnostics.filter(row => row.id === 'blueprint_generated_graph_not_displayed');
      assert.equal(display.sectionGraphs.size, 0); assert.equal(omitted.length, 1);
      assert.equal(omitted[0].path, '$.generated_graphs[0]'); assert.equal(omitted[0].severity, 'WARN');
      assert(omitted[0].message.includes('graph:journey') && omitted[0].message.includes('用户旅程'));
      assert.equal(JSON.stringify(bp), before);
    }
  } },
  { name: 'graph display ignores temporary generated graphs and preserves existing bad graph diagnostics', run() {
    const bp: any = blueprint(); bp.generated_graphs = []; delete bp.review_summary.reader_guide;
    assert(!inspectBlueprintGraphDisplay(bp).diagnostics.some(row => row.id === 'blueprint_generated_graph_not_displayed'));
    bp.generated_graphs = [{ graph_id: 'broken', format: 'mermaid', content: 'flowchart LR\nA --> Missing', node_refs: ['view:missing/node:missing'], relation_refs: [] }];
    const display = inspectBlueprintGraphDisplay(bp);
    assert(display.graphIssues.get(bp.generated_graphs[0])!.some(row => row.id === 'blueprint_generated_graph_ref_missing'));
    assert(!display.diagnostics.some(row => row.id === 'blueprint_generated_graph_not_displayed'));
  } },
  { name: 'reader source digest removes only the prescribed exact positions and preserves arrays', run() {
    const bp: any = blueprint(); const digest = computeBlueprintReaderGuideSourceDigest(bp);
    const changed = structuredClone(bp); changed.revision++; changed.derived_results = [{ status: 'new' }];
    Object.assign(changed.review_summary, { reader_guide: { arbitrary: 'new' }, authored_by: 'author', questioning: ['question'], admission: {}, reconciliation: {} });
    assert.equal(computeBlueprintReaderGuideSourceDigest(changed), digest);
    for (const mutate of [() => changed.title += '!', () => changed.review_summary.background += '!', () => changed.contracts[0].reader_guide += '!', () => changed.contracts[0].revision++, () => changed.generated_graphs[0].content += '!']) {
      const before = computeBlueprintReaderGuideSourceDigest(changed); mutate(); assert.notEqual(computeBlueprintReaderGuideSourceDigest(changed), before);
    }
    const ordered = { ...bp, rows: ['a', 'b'] }; assert.notEqual(computeBlueprintReaderGuideSourceDigest(ordered), computeBlueprintReaderGuideSourceDigest({ ...ordered, rows: ['b', 'a'] }));
    assert.deepStrictEqual(bp, blueprint(), 'digest must not mutate canonical data');
  } },
  { name: 'guide absence stale digest and malformed sections only diagnose and fall back', run() {
    const bp: any = blueprint(); delete bp.review_summary.reader_guide;
    assert.equal(inspectBlueprintReaderGuide(bp).status, 'missing');
    bp.review_summary.reader_guide = { sections: [section] };
    assert.equal(inspectBlueprintReaderGuide(bp).status, 'stale'); assert.equal(inspectBlueprintReaderGuide(bp).sections.length, 0);
    bp.review_summary.reader_guide.source_digest = computeBlueprintReaderGuideSourceDigest(bp);
    assert.equal(inspectBlueprintReaderGuide(bp).sections.length, 1);
    bp.title += '!'; const stale = inspectBlueprintReaderGuide(bp);
    assert.equal(stale.status, 'stale'); assert.equal(stale.sections.length, 0);
    bp.review_summary.reader_guide = { source_digest: computeBlueprintReaderGuideSourceDigest(bp), sections: [null, { ...section, section: 'custom' }, { ...section, source_refs: [] }, section] };
    const diagnosed = inspectBlueprintReaderGuide(bp);
    assert.equal(diagnosed.sections.length, 1); assert.equal(diagnosed.diagnostics.length, 3); assert(diagnosed.diagnostics.every(issue => issue.severity === 'WARN'));
  } },
  { name: 'JSON pointers resolve escaped exact keys and explicit empty values without prototype access', run() {
    const bp = { 'a/b': { '~value': [false, 0, null, ''] } };
    for (const [index, value] of [false, 0, null, ''].entries()) assert.deepStrictEqual(resolveBlueprintReaderSource(bp, `/a~1b/~0value/${index}`)?.value, value);
    for (const pointer of ['/a~2b', '/a~1b/~0value/01', '/a~1b/~0value/-', '/constructor', '/missing', 'title']) assert.equal(resolveBlueprintReaderSource(bp, pointer), undefined, pointer);
    assert.equal(resolveBlueprintReaderSource(bp, '')?.value, bp);
  } },
  { name: 'valid sections survive individual reference and graph gaps and retain source-qualified values', run() {
    const bp: any = blueprint();
    bp.review_summary.reader_guide = { source_digest: computeBlueprintReaderGuideSourceDigest(bp), sections: [{ ...section, source_refs: ['/title', '/missing'], graph_ids: ['sequence:submit', 'sequence:missing'] }, { ...section, source_refs: ['/missing'] }, section] };
    const before = structuredClone(bp); const inspected = inspectBlueprintReaderGuide(bp);
    assert.equal(inspected.status, 'current'); assert.equal(inspected.sections.length, 2);
    assert.deepStrictEqual(inspected.sections[0].resolvedSources, [{ pointer: '/title', value: '方案' }]);
    assert.deepStrictEqual(inspected.sections[0].graph_ids, ['sequence:submit']);
    assert.equal(inspected.diagnostics.length, 3); assert.deepStrictEqual(bp, before);
  } },
  { name: 'Markdown headings demote while fenced and indented literals remain unchanged', run() {
    const code = '```md\n# literal\nsetext literal\n---\n```\n~~~~md\n## tilde literal\n~~~~';
    const prose = '# 整体标题\n正文\n\n二级标题\n---\n\n' + code + '\n    # indented literal\n#not-a-heading';
    const actual = demoteBlueprintReaderHeadings(prose);
    assert(actual.changed); assert(actual.prose.startsWith('**整体标题**\n正文\n\n**二级标题**'));
    assert(actual.prose.includes(code)); assert(actual.prose.endsWith('    # indented literal\n#not-a-heading'));
    assert.deepStrictEqual(demoteBlueprintReaderHeadings(code), { prose: code, changed: false });
  } },
  { name: 'unclosed backtick and tilde fences close locally with WARN while retaining literal code', run() {
    for (const marker of ['```', '~~~~']) {
      const prose = `示例：\n${marker}ts\nfoo()\n# literal heading`;
      const normalized = demoteBlueprintReaderHeadings(prose);
      assert.equal(normalized.prose, `${prose}\n${marker}`);
      assert(normalized.changed && normalized.fenceClosed); assert(!normalized.headingsDemoted);
      const bp: any = blueprint();
      bp.review_summary.reader_guide = { source_digest: computeBlueprintReaderGuideSourceDigest(bp), sections: [{ ...section, prose }] };
      const inspection = inspectBlueprintReaderGuide(bp);
      assert.equal(inspection.sections[0].prose, normalized.prose);
      assert.equal(inspection.status, 'current'); assert.equal(inspection.diagnostics.length, 1);
      assert.equal(inspection.diagnostics[0].id, 'blueprint_reader_guide_fence_closed'); assert.equal(inspection.diagnostics[0].severity, 'WARN');
      assert.equal(bp.review_summary.reader_guide.sections[0].prose, prose, 'canonical prose must remain unchanged');
    }
  } },
  { name: 'CU and Feature whole-blueprint digests exclude only the explanation and retain real facts', run() {
    const f = fixture();
    try {
      const cu = YAML.parse(fs.readFileSync(f.cuFile, 'utf8'));
      const ref = { ...cu.component_blueprint_ref, target: { kind: 'blueprint', id: 'ledger-app-blueprint' } };
      cu.design_refs.push(ref); fs.writeFileSync(f.cuFile, YAML.stringify(cu));
      const digests = () => {
        const current = YAML.parse(fs.readFileSync(f.cuFile, 'utf8'));
        const whole = current.design_refs.find((row: any) => row.target.kind === 'blueprint');
        return [identityNeutralDigest(f.root, 'change-unit@1', current), identityNeutralDigest(f.root, 'acceptance@1', { feature: f.feature, design_ref: whole })];
      };
      const bp = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8')); bp.review_summary.reader_guide = { prose: '初稿' };
      fs.writeFileSync(f.blueprintFile, YAML.stringify(bp)); f.bind(); const original = digests(); assert(original.every(Boolean));
      bp.review_summary.reader_guide = { prose: '润色后的解释' }; fs.writeFileSync(f.blueprintFile, YAML.stringify(bp)); f.bind(); assert.deepStrictEqual(digests(), original);
      delete bp.review_summary.reader_guide; fs.writeFileSync(f.blueprintFile, YAML.stringify(bp)); f.bind(); assert.deepStrictEqual(digests(), original);
      bp.design_views[0].nodes[0].review_summary = { reader_guide: '真实业务同名键' }; fs.writeFileSync(f.blueprintFile, YAML.stringify(bp)); f.bind(); assert(digests().every((digest, i) => digest !== original[i]));
      const business = digests(); bp.design_views[0].nodes[0].review_summary.reader_guide += '!'; fs.writeFileSync(f.blueprintFile, YAML.stringify(bp)); f.bind(); assert(digests().every((digest, i) => digest !== business[i]));
      const previous = digests(); bp.design_views[0].nodes[0].acceptance.criteria[0].expected_result += ' amended'; fs.writeFileSync(f.blueprintFile, YAML.stringify(bp)); f.bind(); assert(digests().every((digest, i) => digest !== previous[i]));
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  } },
  { name: 'digest CLI reads current canonical source without validating writing or stamping', run() {
    const f = fixture();
    try {
      const before = fs.readFileSync(f.blueprintFile); const review = path.join(path.dirname(f.blueprintFile), 'component-blueprint.review.md'); const reviewBefore = fs.readFileSync(review);
      const args = ['-r', require.resolve('ts-node/register/transpile-only'), path.resolve(__dirname, '../../scripts/check-component-blueprint.ts'), '--project-root', f.root, '--blueprint', 'ledger-app-blueprint', '--reader-guide-digest'];
      const plain = spawnSync(process.execPath, args, { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' });
      assert.equal(plain.status, 0, plain.stderr); assert.equal(plain.stdout.trim(), computeBlueprintReaderGuideSourceDigest(YAML.parse(before.toString('utf8'))));
      const json = spawnSync(process.execPath, [...args, '--json'], { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' });
      assert.equal(json.status, 0, json.stderr); assert.equal(JSON.parse(json.stdout).reader_guide_source_digest, plain.stdout.trim());
      assert(fs.readFileSync(f.blueprintFile).equals(before)); assert(fs.readFileSync(review).equals(reviewBefore));
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  } },
];
export function runAll(): UnitCaseResult[] { return cases.map(test => { try { test.run(); return { name: test.name, ok: true }; } catch (error) { return { name: test.name, ok: false, error: (error as Error).stack }; } }); }
