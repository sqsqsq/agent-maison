import { describe, it, expect, beforeEach } from '@ohos/hypium';
import { HomeRepository } from '../../../main/ets/data/repository/HomeRepository';
import { CardRepository } from '../../../main/ets/data/repository/CardRepository';
import { HomeCardDisplayMode } from '../../../main/ets/data/model/HomeCardState';
import { HomeConstants } from '../../../main/ets/shared/constant/HomeConstants';

export default function homePageUtTest(): void {
  describe('homepage repositories', () => {
    let homeRepo: HomeRepository;
    let cardRepo: CardRepository;

    beforeEach((): void => {
      homeRepo = new HomeRepository();
      cardRepo = new CardRepository();
    });

    it('[AC-2] HomeRepository 有卡标记驱动展示态', 0, async () => {
      const mode: HomeCardDisplayMode = await homeRepo.getCardDisplayMode();
      const expected: HomeCardDisplayMode = HomeConstants.SHOW_HAS_CARD_MOCK ?
        HomeCardDisplayMode.WITH_CARD : HomeCardDisplayMode.NO_CARD;
      expect(mode).assertEqual(expected);
      expect(mode === HomeCardDisplayMode.NO_CARD || mode === HomeCardDisplayMode.WITH_CARD).assertTrue();
    });

    it('[AC-16][BD-5] CardRepository 非本机卡计数为 0', 0, async () => {
      const count: number = await cardRepo.getNonLocalCardCount();
      expect(count).assertEqual(0);
      expect(count >= 0).assertTrue();
    });

    it('[AC-18][BD-1] Repository 离线仍返回本地 mock', 0, async () => {
      const mode: HomeCardDisplayMode = await homeRepo.getCardDisplayMode();
      const hasCard: boolean = mode === HomeCardDisplayMode.WITH_CARD;
      const services = await homeRepo.getServiceEntries(hasCard);
      const promos = await homeRepo.getPromoList(hasCard);
      const message = await homeRepo.getMessageInfo(mode);
      expect(services.length).assertEqual(3);
      expect(promos.length).assertEqual(3);
      expect(services[0].id).assertEqual('s1');
    });

    it('[AC-2][BD-2] 无本地卡时 hasLocalCards 为 false', 0, async () => {
      const hasCards: boolean = await cardRepo.hasLocalCards();
      expect(hasCards).assertEqual(HomeConstants.SHOW_LOCAL_CARD_SECTION);
      expect(hasCards).assertFalse();
    });

    it('[AC-2] HomeRepository 有卡态消息含未读点', 0, async () => {
      const msg = await homeRepo.getMessageInfo(HomeCardDisplayMode.WITH_CARD);
      expect(msg.showUnreadDot).assertTrue();
      expect(msg.timestamp !== undefined).assertTrue();
    });
  });
}
