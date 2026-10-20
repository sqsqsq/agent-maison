import { OpenCardCompletionBridge } from '../../shared/OpenCardCompletionBridge';
import { BankCardRepository } from '../../data/repository/BankCardRepository';
import { CardRecord } from '../../data/model/CardRecord';
import { Context } from '@kit.AbilityKit';
import { showToast } from '@aspect/CommUI';
import { HomeCardDisplayMode } from '../../data/model/HomeCardState';
import { MessageInfo } from '../../data/model/MessageInfo';
import { HomeRepository } from '../../data/repository/HomeRepository';
import { PromoInfo } from '../../data/model/PromoInfo';
import { ServiceEntry } from '../../data/model/ServiceEntry';
import { CardGuideSection } from '../components/CardGuideSection';
import { CardStackSection } from '../components/CardStackSection';
import { HomeTabHeader } from '../components/HomeTabHeader';
import { MessageCenterRow } from '../components/MessageCenterRow';
import { PromoSwiper } from '../components/PromoSwiper';
import { ServiceGridSwiper } from '../components/ServiceGridSwiper';

@Component
export struct HomeTabPage {
  /** NavPathStack 禁止 @Prop（真机 pushPath 会丢原生句柄 SIGSEGV），须与 Navigation 同源 @Link */
  @Link navPathStack: NavPathStack;
  @State services: ServiceEntry[] = [];
  @State promos: PromoInfo[] = [];
  @State cardMode: HomeCardDisplayMode = HomeCardDisplayMode.NO_CARD;
  @State message: MessageInfo = {
    text: $r('app.string.msg_center_welcome'),
    showUnreadDot: false
  };
  private readonly cardRepo: BankCardRepository = new BankCardRepository();
  private loadVersion: number = 0;
  private alive: boolean = false;
  private readonly completionListener: (fullCardNumber: string) => void = (fullCardNumber: string): void => {
    void this.loadHomeData(fullCardNumber);
  };
  private readonly homeRepo: HomeRepository = new HomeRepository();

  aboutToAppear(): void {
    this.alive = true;
    void this.loadHomeData();
    OpenCardCompletionBridge.subscribe(this.completionListener);
  }

  aboutToDisappear(): void {
    this.alive = false;
    this.loadVersion++;
    OpenCardCompletionBridge.unsubscribe(this.completionListener);
  }

  private handleTitleTap(): void {
    const nextMode = this.cardMode === HomeCardDisplayMode.WITH_CARD
      ? HomeCardDisplayMode.NO_CARD
      : HomeCardDisplayMode.WITH_CARD;
    HomeRepository.setLaunchCardModeOverride(nextMode);
    this.cardMode = nextMode;
    void this.loadHomeData();
  }

  private async loadHomeData(fullCardNumber: string = ''): Promise<void> {
    const version: number = ++this.loadVersion;
    try {
      const context = this.getUIContext().getHostContext() as Context;
      const mockMode: HomeCardDisplayMode = await this.homeRepo.getCardDisplayMode();
      let persistedCard: CardRecord | null = null;
      if (fullCardNumber.length > 0) {
        persistedCard = await this.cardRepo.findByFullCardNumber(context, fullCardNumber);
      } else {
        const cards: CardRecord[] = await this.cardRepo.listCards(context);
        persistedCard = cards.length > 0 ? cards[0] : null;
      }
      const mode: HomeCardDisplayMode = persistedCard !== null ? HomeCardDisplayMode.WITH_CARD : mockMode;
      const hasCard: boolean = mode === HomeCardDisplayMode.WITH_CARD;
      const services: ServiceEntry[] = await this.homeRepo.getServiceEntries(hasCard);
      const promos: PromoInfo[] = await this.homeRepo.getPromoList(hasCard);
      const message: MessageInfo = await this.homeRepo.getMessageInfo(mode);
      // 完成通知发起新一轮读库后，旧异步加载不能把首页覆盖回无卡态。
      if (!this.alive || version !== this.loadVersion) { return; }
      this.cardMode = mode;
      this.services = services;
      this.promos = promos;
      this.message = message;
    } catch {
      if (!this.alive || version !== this.loadVersion) { return; }
      try {
        const context = this.getUIContext().getHostContext() as Context;
        showToast(context.resourceManager.getStringSync($r('app.string.home_data_unavailable').id));
      } catch {
        // 保留当前页面内容，避免错误提示失败再次抛出。
      }
    }
  }

  build() {
    Column() {
      HomeTabHeader({
        onAddCard: () => {
          this.navPathStack.pushPath({ name: 'AddCardEntryPage' });
        },
        onTitleTap: (): void => {
          this.handleTitleTap();
        }
      })

      Scroll() {
        Column({ space: 16 }) {
          if (this.cardMode === HomeCardDisplayMode.NO_CARD) {
            CardGuideSection({
              onGoCardPack: () => {
                this.navPathStack.pushPath({ name: 'CardPackPage' });
              }
            })
          } else {
            CardStackSection({
              onGoCardPack: () => {
                this.navPathStack.pushPath({ name: 'CardPackPage' });
              }
            })
          }

          if (this.services.length > 0) {
            ServiceGridSwiper({ services: this.services })
          }

          MessageCenterRow({ message: this.message })

          if (this.promos.length > 0) {
            PromoSwiper({
              promos: this.promos,
              imageFirst: this.cardMode === HomeCardDisplayMode.NO_CARD
            })
              .key(this.cardMode === HomeCardDisplayMode.WITH_CARD ? 'promo_with_card' : 'promo_no_card')
          }
        }
        .width('100%')
        .padding({
          left: 16,
          right: 16,
          bottom: 24
        })
      }
      .layoutWeight(1)
      .scrollBar(BarState.Off)
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.bg_page'))
    .id('home_root')
  }
}
