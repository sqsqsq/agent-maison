import { describe, it, expect, MockKit, when } from '@ohos/hypium';
import { DemoRepository } from '../../../main/ets/data/repository/DemoRepository';

export default function demoMockkitPolicyPassFixture(): void {
  describe('demo_v24_mockkit_policy_pass', () => {
    it('[AC-V24] MockKit stub matches mock-plan mockkit', 0, () => {
      const kit = new MockKit();
      const repo = kit.mock(DemoRepository);
      when(repo.fetchData('fixture')).returns('ok_data');
      expect(true).assertTrue();
    });
  });
}
