// vision-canary.unit.test.ts — E1（多模态降级阶梯 plan d4a8f3c6）：视觉能力金丝雀

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  classifyCanaryResponse,
  isCanaryAnswerComplete,
  buildCanaryPrompt,
  generateRandomCanaryAnswerKey,
  renderCanaryImage,
  resolveCanaryCacheDecision,
} from '../../scripts/utils/vision-canary';
import { FIXTURE_CANARY_KEY } from '../utils/canary-fixture-key';
import type { UnitCaseResult } from '../run-unit';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const cases: Array<{ name: string; run: () => void | Promise<void> }> = [
  {
    name: 'classifyCanaryResponse: 全部几何题正确 → tool_read（真视觉实锤）',
    run: () => {
      const r = classifyCanaryResponse(
        'TOP_LEFT_COLOR=red\nTOP_RIGHT_COLOR=blue\nBOTTOM_LEFT_COLOR=green\nBOTTOM_RIGHT_COLOR=yellow\nTEXT_TOKEN=MAISON7X3Q',
        FIXTURE_CANARY_KEY,
      );
      assert(r.verdict === 'tool_read', JSON.stringify(r));
      assert(r.geometryCorrect === 4 && r.geometryTotal === 4, JSON.stringify(r));
      assert(r.textTokenMatched === true, JSON.stringify(r));
    },
  },
  {
    name: 'classifyCanaryResponse: 大小写不敏感（RED/Blue/GREEN/yellow 仍算对）',
    run: () => {
      const r = classifyCanaryResponse(
        'TOP_LEFT_COLOR=RED\nTOP_RIGHT_COLOR=Blue\nBOTTOM_LEFT_COLOR=GREEN\nBOTTOM_RIGHT_COLOR=yellow\nTEXT_TOKEN=maison7x3q',
        FIXTURE_CANARY_KEY,
      );
      assert(r.verdict === 'tool_read', JSON.stringify(r));
    },
  },
  {
    name: 'classifyCanaryResponse: 仅 3/4 几何题正确（非全对）→ 不判 tool_read（严格全对门槛，防蒙对）',
    run: () => {
      const r = classifyCanaryResponse(
        'TOP_LEFT_COLOR=red\nTOP_RIGHT_COLOR=blue\nBOTTOM_LEFT_COLOR=green\nBOTTOM_RIGHT_COLOR=purple\nTEXT_TOKEN=MAISON7X3Q',
        FIXTURE_CANARY_KEY,
      );
      assert(r.verdict !== 'tool_read', `3/4 不应判 tool_read：${JSON.stringify(r)}`);
      assert(r.geometryCorrect === 3, JSON.stringify(r));
      // 3/4 未全对但 TEXT_TOKEN 命中 → ocr_capable
      assert(r.verdict === 'ocr_capable', JSON.stringify(r));
    },
  },
  {
    name: 'classifyCanaryResponse: 几何题全错但 TEXT_TOKEN 命中 → ocr_capable（疑似 Bash/OCR 代答，vision 仍 none）',
    run: () => {
      const r = classifyCanaryResponse(
        'TOP_LEFT_COLOR=purple\nTOP_RIGHT_COLOR=orange\nBOTTOM_LEFT_COLOR=pink\nBOTTOM_RIGHT_COLOR=cyan\nTEXT_TOKEN=MAISON7X3Q',
        FIXTURE_CANARY_KEY,
      );
      assert(r.verdict === 'ocr_capable', JSON.stringify(r));
      assert(r.geometryCorrect === 0, JSON.stringify(r));
      assert(r.textTokenMatched === true, JSON.stringify(r));
    },
  },
  {
    name: 'classifyCanaryResponse: 明确声明看不见图片 → none',
    run: () => {
      const r = classifyCanaryResponse('CANNOT_SEE_IMAGE', FIXTURE_CANARY_KEY);
      assert(r.verdict === 'none', JSON.stringify(r));
      assert(/看不见/.test(r.reason), r.reason);
    },
  },
  {
    name: 'classifyCanaryResponse: 空输出 → none',
    run: () => {
      const r = classifyCanaryResponse('', FIXTURE_CANARY_KEY);
      assert(r.verdict === 'none', JSON.stringify(r));
      assert(/空输出/.test(r.reason), r.reason);
    },
  },
  {
    name: 'classifyCanaryResponse: 几何题全错 + TEXT_TOKEN 也不命中 → none（不是 ocr_capable）',
    run: () => {
      const r = classifyCanaryResponse(
        'TOP_LEFT_COLOR=purple\nTOP_RIGHT_COLOR=orange\nBOTTOM_LEFT_COLOR=pink\nBOTTOM_RIGHT_COLOR=cyan\nTEXT_TOKEN=WRONG',
        FIXTURE_CANARY_KEY,
      );
      assert(r.verdict === 'none', JSON.stringify(r));
      assert(r.textTokenMatched === false, JSON.stringify(r));
    },
  },
  {
    name: 'classifyCanaryResponse: externalToolSuspected 尽力而为扫描（tesseract/ocr 关键词命中）',
    run: () => {
      const withTool = classifyCanaryResponse(
        'Let me run tesseract to read this image.\nTOP_LEFT_COLOR=red\nTOP_RIGHT_COLOR=blue\nBOTTOM_LEFT_COLOR=green\nBOTTOM_RIGHT_COLOR=yellow\nTEXT_TOKEN=MAISON7X3Q',
        FIXTURE_CANARY_KEY,
      );
      assert(withTool.externalToolSuspected === true, JSON.stringify(withTool));
      const withoutTool = classifyCanaryResponse(
        'TOP_LEFT_COLOR=red\nTOP_RIGHT_COLOR=blue\nBOTTOM_LEFT_COLOR=green\nBOTTOM_RIGHT_COLOR=yellow\nTEXT_TOKEN=MAISON7X3Q',
        FIXTURE_CANARY_KEY,
      );
      assert(withoutTool.externalToolSuspected === false, JSON.stringify(withoutTool));
    },
  },
  {
    name: 'isCanaryAnswerComplete（codex P2 二轮）：半写入不完整 → false；全键齐/CANNOT_SEE_IMAGE → true；空 → false',
    run: () => {
      // 半写入：只落了第一行（codex 给的原例）→ 不完整，收卷器应继续等
      assert(isCanaryAnswerComplete('TOP_LEFT_COLOR=red\n', FIXTURE_CANARY_KEY) === false, '半写入非空内容不应算完整');
      assert(isCanaryAnswerComplete('TOP_LEFT_COLOR=red\nTOP_RIGHT_COLOR=blue\n', FIXTURE_CANARY_KEY) === false, '缺 BL/BR/TEXT_TOKEN 键不完整');
      // 全部 4 几何键 + TEXT_TOKEN → 完整（值不论）
      assert(
        isCanaryAnswerComplete('TOP_LEFT_COLOR=red\nTOP_RIGHT_COLOR=blue\nBOTTOM_LEFT_COLOR=green\nBOTTOM_RIGHT_COLOR=yellow\nTEXT_TOKEN=ABC', FIXTURE_CANARY_KEY) === true,
        '五键齐应完整',
      );
      // CANNOT_SEE_IMAGE 单独一行 → 完整
      assert(isCanaryAnswerComplete('CANNOT_SEE_IMAGE', FIXTURE_CANARY_KEY) === true, 'CANNOT_SEE_IMAGE 应完整');
      // 空/空白 → 不完整
      assert(isCanaryAnswerComplete('', FIXTURE_CANARY_KEY) === false, '空应不完整');
      assert(isCanaryAnswerComplete('   \n', FIXTURE_CANARY_KEY) === false, '纯空白应不完整');
    },
  },
  {
    name: 'b7e4d2a9 Todo4：随机卷渲染真实非空 PNG，答案零落盘（目录里绝无 answer-key 文件）',
    run: async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-canary-rand-'));
      try {
        const key = generateRandomCanaryAnswerKey();
        const out = path.join(dir, 'preflight-canary.png');
        await renderCanaryImage(out, key);
        assert(fs.existsSync(out) && fs.statSync(out).size > 0, 'PNG 应非空落盘');
        const leaked = fs.readdirSync(dir).filter(n => n.includes('answer-key'));
        assert(leaked.length === 0, `答案不得落盘：${leaked.join(',')}`);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'buildCanaryPrompt: 含图片路径、结构化答题格式、明确允许诚实答不可见',
    run: () => {
      const text = buildCanaryPrompt('/abs/path/to/canary.png');
      assert(text.includes('/abs/path/to/canary.png'), text);
      assert(/TOP_LEFT_COLOR/.test(text), text);
      assert(/CANNOT_SEE_IMAGE/.test(text), text);
      assert(/ONE-TIME/i.test(text), '应声明这是一次性探测非正式任务');
    },
  },
  {
    name: 'b7e4d2a9 Todo4：随机 answerKey 判卷闭环——按本卷作答判 tool_read；按他卷作答不得 tool_read（防"随机图+固定答案"漏传形态）',
    run: () => {
      const key = generateRandomCanaryAnswerKey();
      const correct = [
        ...key.geometry_questions.map(q => `${q.id}=${q.expected_color}`),
        `TEXT_TOKEN=${key.text_token}`,
      ].join('\n');
      const d1 = resolveCanaryCacheDecision({ stdout: correct, exitCode: 0 }, key);
      assert(d1.kind === 'valid' && d1.classify.verdict === 'tool_read',
        `随机卷正确作答须 tool_read：${JSON.stringify(d1)}`);
      // 他卷作答（确定性注入 rng 造两张不同卷——避免随机撞卷的概率性翻车）
      const keyA = generateRandomCanaryAnswerKey(() => 0);
      const answerFromOtherSheet = [
        // 颜色全部换成 keyA 未用的映射（旋转一位）→ 全错；token 也不同
        ...keyA.geometry_questions.map((q, i, arr) =>
          `${q.id}=${arr[(i + 1) % arr.length].expected_color}`),
        'TEXT_TOKEN=ZZZZ9999',
      ].join('\n');
      const d2 = resolveCanaryCacheDecision({ stdout: answerFromOtherSheet, exitCode: 0 }, keyA);
      assert(d2.kind === 'valid' && d2.classify.verdict !== 'tool_read',
        `他卷答案不得判 tool_read：${JSON.stringify(d2)}`);
    },
  },
  // ==========================================================================
  // plan c7d2e9a4 t2/t3：resolveCanaryCacheDecision——goal 路径唯一写盘判据
  // ==========================================================================
  {
    name: 'c7d2e9a4 resolveCanaryCacheDecision: 空输出 → invalid_answer（2026-07-12 事故形态，不落缓存）',
    run: () => {
      const d = resolveCanaryCacheDecision({ stdout: '', exitCode: 0 }, FIXTURE_CANARY_KEY);
      assert(d.kind === 'invalid_answer' && d.cache === false, JSON.stringify(d));
      assert(d.kind !== 'valid' && d.detail.includes('空输出'), JSON.stringify(d));
    },
  },
  {
    name: 'c7d2e9a4 resolveCanaryCacheDecision: 额度错误文本（非空、无答题键）→ invalid_answer',
    run: () => {
      const d = resolveCanaryCacheDecision({
        stdout: "ActionRequiredError: You've hit your usage limit. Get Cursor Pro for more Agent usage.",
        exitCode: 0,
      }, FIXTURE_CANARY_KEY);
      assert(d.kind === 'invalid_answer', JSON.stringify(d));
    },
  },
  {
    name: 'c7d2e9a4 resolveCanaryCacheDecision: 残卷（仅 1 键）→ invalid_answer（半写入/断流不判卷）',
    run: () => {
      const d = resolveCanaryCacheDecision({ stdout: 'TOP_LEFT_COLOR=red\n', exitCode: 0 }, FIXTURE_CANARY_KEY);
      assert(d.kind === 'invalid_answer', JSON.stringify(d));
    },
  },
  {
    name: 'c7d2e9a4 resolveCanaryCacheDecision: prompt echo 全文（含答题键行+CANNOT_SEE 字面）→ invalid_answer（防回显双杀）',
    run: () => {
      // 直接用真实 prompt 当 stdout——占位符 <color> 不算合法赋值、CANNOT_SEE 行有前缀不整行匹配
      const d = resolveCanaryCacheDecision({ stdout: buildCanaryPrompt('C:/tmp/canary.png'), exitCode: 0 }, FIXTURE_CANARY_KEY);
      assert(d.kind === 'invalid_answer', `prompt 回显必须判无效：${JSON.stringify(d)}`);
    },
  },
  {
    name: 'c7d2e9a4 resolveCanaryCacheDecision: 独立行 CANNOT_SEE_IMAGE → valid + none（真盲有效作答，该缓存）',
    run: () => {
      const d = resolveCanaryCacheDecision({ stdout: 'Let me check.\nCANNOT_SEE_IMAGE\n', exitCode: 0 }, FIXTURE_CANARY_KEY);
      assert(d.kind === 'valid' && d.cache === true, JSON.stringify(d));
      assert(d.kind === 'valid' && d.classify.verdict === 'none', JSON.stringify(d));
    },
  },
  {
    name: 'c7d2e9a4 resolveCanaryCacheDecision: 全键在场全错 → valid + none（答了题，结论可信可缓存）',
    run: () => {
      const d = resolveCanaryCacheDecision({
        stdout: 'TOP_LEFT_COLOR=purple\nTOP_RIGHT_COLOR=black\nBOTTOM_LEFT_COLOR=white\nBOTTOM_RIGHT_COLOR=gray\nTEXT_TOKEN=WRONG123',
        exitCode: 0,
      }, FIXTURE_CANARY_KEY);
      assert(d.kind === 'valid', JSON.stringify(d));
      assert(d.kind === 'valid' && d.classify.verdict === 'none', JSON.stringify(d));
    },
  },
  {
    name: 'c7d2e9a4 resolveCanaryCacheDecision: 全对 → valid + tool_read',
    run: () => {
      const d = resolveCanaryCacheDecision({
        stdout: 'TOP_LEFT_COLOR=red\nTOP_RIGHT_COLOR=blue\nBOTTOM_LEFT_COLOR=green\nBOTTOM_RIGHT_COLOR=yellow\nTEXT_TOKEN=MAISON7X3Q',
        exitCode: 0,
      }, FIXTURE_CANARY_KEY);
      assert(d.kind === 'valid' && d.classify.verdict === 'tool_read', JSON.stringify(d));
    },
  },
  {
    name: 'c7d2e9a4 resolveCanaryCacheDecision: prompt echo + 尾部真答卷 → valid 且最终 verdict=tool_read（canonical 穿透 classify）',
    run: () => {
      const stdout =
        `${buildCanaryPrompt('C:/tmp/canary.png')}\n\n` +
        'TOP_LEFT_COLOR=red\nTOP_RIGHT_COLOR=blue\nBOTTOM_LEFT_COLOR=green\nBOTTOM_RIGHT_COLOR=yellow\nTEXT_TOKEN=MAISON7X3Q\n';
      const d = resolveCanaryCacheDecision({ stdout, exitCode: 0 }, FIXTURE_CANARY_KEY);
      assert(d.kind === 'valid', JSON.stringify(d));
      // 关键（codex 三轮 P1）：canonical 重组隔离原始 stdout——否则旧 classifier 会被
      // echo 里的 CANNOT_SEE_IMAGE 子串污染直接判 none
      assert(d.kind === 'valid' && d.classify.verdict === 'tool_read', `echo 混排不得污染 verdict：${JSON.stringify(d)}`);
      assert(d.kind === 'valid' && !d.canonicalAnswer.includes('CANNOT_SEE_IMAGE'), 'canonical 不得携带 echo 的 CANNOT_SEE 字面');
    },
  },
  {
    name: 'c7d2e9a4 resolveCanaryCacheDecision: invoke 事实先行——非零退出/timed_out/silent_killed/skipped → invoke_failed（stdout 完美答卷也不缓存）',
    run: () => {
      const perfect = 'TOP_LEFT_COLOR=red\nTOP_RIGHT_COLOR=blue\nBOTTOM_LEFT_COLOR=green\nBOTTOM_RIGHT_COLOR=yellow\nTEXT_TOKEN=MAISON7X3Q';
      for (const facts of [
        { stdout: perfect, exitCode: 1 },
        { stdout: perfect, exitCode: 0, timed_out: true },
        { stdout: perfect, exitCode: 0, silent_killed: true },
        { stdout: perfect, exitCode: 0, skipped: true },
      ]) {
        const d = resolveCanaryCacheDecision(facts, FIXTURE_CANARY_KEY);
        assert(d.kind === 'invoke_failed' && d.cache === false, JSON.stringify({ facts, d }));
      }
    },
  },
  {
    name: 'c7d2e9a4 resolveCanaryCacheDecision: externalToolSuspected 从原始 stdout 提取（canonical 化不丢诊断信号）',
    run: () => {
      const d = resolveCanaryCacheDecision({
        stdout:
          'I ran tesseract on the image first.\n' +
          'TOP_LEFT_COLOR=red\nTOP_RIGHT_COLOR=blue\nBOTTOM_LEFT_COLOR=green\nBOTTOM_RIGHT_COLOR=yellow\nTEXT_TOKEN=MAISON7X3Q',
        exitCode: 0,
      }, FIXTURE_CANARY_KEY);
      assert(d.kind === 'valid', JSON.stringify(d));
      assert(d.kind === 'valid' && d.classify.externalToolSuspected === true, 'tesseract 迹象须保留（canonical 里没有）');
      assert(d.kind === 'valid' && d.classify.verdict === 'tool_read', JSON.stringify(d));
    },
  },
];

export function runAll(): Promise<UnitCaseResult[]> {
  return runVisionCanaryUnitTests();
}

async function runVisionCanaryUnitTests(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      await c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

if (require.main === module) {
  runVisionCanaryUnitTests().then(r => {
    for (const x of r) console.log(x.ok ? 'PASS' : 'FAIL', x.name, x.error ?? '');
    process.exit(r.every(x => x.ok) ? 0 : 1);
  });
}
