import { describe, it, expect } from '@ohos/hypium';

export default function demoTest(): void {
  describe('demo', () => {
    it('ac001/branch_main_should_pass', 0, () => {
      const x: number = 1 + 1;
      expect(x).assertEqual(2);
    });
  });
}
