import { describe, it, expect, MockKit, when } from '@ohos/hypium';

export default function demoMockkitNoPolicyFixture(): void {
  describe('demo_v24_mockkit_no_policy', () => {
    it('[AC-V24] uses MockKit without mock-plan mockkit strategy', 0, () => {
      expect(true).assertTrue();
    });
  });
}
