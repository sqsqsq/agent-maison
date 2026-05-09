import { describe, it, expect } from '@ohos/hypium';

export default function demoTest(): void {
  describe('demo', () => {
    it('ac001/branch_main', 0, () => {
      expect(1 + 1).assertEqual(2);
    });
  });
}
