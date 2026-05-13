import { describe, it, expect } from '@ohos/hypium';

export default function brokenTest(): void {
  describe('broken', () => {
    it('ac001/branch_should_fail_tsc', 0, () => {
      // 故意类型错误：number 类型变量赋字符串字面量 → TS2322
      const x: number = "this should fail tsc";
      expect(x).assertEqual(2);
    });
  });
}
