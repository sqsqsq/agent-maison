// canary-fixture-key.ts — 测试专用固定金丝雀卷（b7e4d2a9 round9）
// 生产侧固定答案层已整体删除（随机卷唯一路径，answerKey 编译期必传）；测试的 canned
// stdout 夹具需要一张已知卷面——在测试侧自定义，不依赖任何生产默认值。
import type { CanaryAnswerKey } from '../../scripts/utils/vision-canary';

export const FIXTURE_CANARY_KEY: CanaryAnswerKey = {
  schema_version: '1.0',
  geometry_questions: [
    { id: 'TOP_LEFT_COLOR', expected_color: 'red' },
    { id: 'TOP_RIGHT_COLOR', expected_color: 'blue' },
    { id: 'BOTTOM_LEFT_COLOR', expected_color: 'green' },
    { id: 'BOTTOM_RIGHT_COLOR', expected_color: 'yellow' },
  ],
  text_token: 'MAISON7X3Q',
};
