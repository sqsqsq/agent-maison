/**
 * device_test.visual_diff → provider `hylyre_visual_diff`
 */
import type { CapabilityProvider } from './types';

export const provider: CapabilityProvider = {
  id: 'hylyre_visual_diff',
  capability: 'device_test.visual_diff',
  // plan ab072691 t5：runVisualProviderReview = 只读视觉 provider 的逐屏评审接线
  // （capture 之后、严格 dispatch 之前）。与 checkVisualDiff 同能力键，因为它写的正是
  // visual-diff.json 的逐屏 must_fix/defects——同一份产物的同一层。
  exports: [
    'checkVisualDiff',
    'captureVisualDiff',
    'runVisualProviderReview',
    // plan ab072691 t5⑤（返修）：fail-open 路径仍须跑的确定性红线（复用既有 check id）
    'checkVisualDiffDeterministicOnly',
  ],
};

export { checkVisualDiff, checkVisualDiffDeterministicOnly } from '../visual-diff-check';
export { captureVisualDiff } from '../visual-diff-capture';
export { runVisualProviderReview } from '../visual-provider-review';
