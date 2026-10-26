import { HomeCardDisplayMode } from '../model/HomeCardState';
import { MessageInfo } from '../model/MessageInfo';
import { PromoInfo } from '../model/PromoInfo';
import { ServiceEntry } from '../model/ServiceEntry';
import { HomeConstants } from '../../shared/constant/HomeConstants';

export class HomeRepository {
  private static launchOverride: HomeCardDisplayMode | null = null;

  static setLaunchCardModeOverride(mode: HomeCardDisplayMode | null): void {
    HomeRepository.launchOverride = mode;
  }

  async getCardDisplayMode(): Promise<HomeCardDisplayMode> {
    if (HomeRepository.launchOverride !== null) {
      return HomeRepository.launchOverride;
    }
    // 未接入卡包真源前：无卡片则始终无卡态；有卡 UI 仅通过 launch 参数（visual-diff）注入
    return HomeConstants.SHOW_HAS_CARD_MOCK ? HomeCardDisplayMode.WITH_CARD : HomeCardDisplayMode.NO_CARD;
  }

  async getServiceEntries(hasCard: boolean): Promise<ServiceEntry[]> {
    const entries: ServiceEntry[] = [
      { id: 's1', name: $r('app.string.home_mock_service_s1_name'), icon: $r('app.media.huawei_card_logo') },
      { id: 's2', name: $r('app.string.home_mock_service_s2_name'), icon: $r('sys.symbol.creditcard') },
      { id: 's3', name: $r('app.string.home_mock_service_s3_name'), icon: $r('sys.symbol.car') }
    ];
    return entries;
  }

  async getPromoList(hasCard: boolean): Promise<PromoInfo[]> {
    const image = $r('app.media.promo_marketing_illustration');
    if (hasCard) {
      return [
        {
          id: 'wc_p1',
          title: $r('app.string.home_mock_promo_wc_p1_title'),
          description: $r('app.string.home_mock_promo_wc_p1_desc'),
          image
        },
        {
          id: 'wc_p2',
          title: $r('app.string.home_mock_promo_wc_p2_title'),
          description: $r('app.string.home_mock_promo_wc_p2_desc'),
          image
        },
        {
          id: 'wc_p3',
          title: $r('app.string.home_mock_promo_wc_p3_title'),
          description: $r('app.string.home_mock_promo_wc_p3_desc'),
          image
        }
      ];
    }
    const title = $r('app.string.home_mock_promo_p1_title');
    const description = $r('app.string.home_mock_promo_p1_desc');
    return [
      { id: 'p1', title, description, image },
      { id: 'p2', title, description, image },
      { id: 'p3', title, description, image }
    ];
  }

  async getMessageInfo(mode: HomeCardDisplayMode): Promise<MessageInfo> {
    if (mode === HomeCardDisplayMode.WITH_CARD) {
      return {
        text: $r('app.string.msg_center_charge_success'),
        timestamp: $r('app.string.msg_center_timestamp'),
        showUnreadDot: true
      };
    }
    return {
      text: $r('app.string.msg_center_welcome'),
      showUnreadDot: false
    };
  }
}
