import { BankCardRepository } from '../../data/repository/BankCardRepository';
import { maskCardNumber } from '../../data/model/MockBankCard';
import { BankOpeningCoordinator } from '../../domain/service/BankOpeningCoordinator';
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
  @State savedBankName: string = '';
  @State savedCardLabel: string = '';
  @State promos: PromoInfo[] = [];
  @State cardMode: HomeCardDisplayMode = HomeCardDisplayMode.NO_CARD;
  @State message: MessageInfo = {
    text: $r('app.string.msg_center_welcome'),
    showUnreadDot: false
  };
  private readonly homeRepo: HomeRepository = new HomeRepository();

  private active: boolean = false;
  private loadVersion: number = 0;
  private completionListener: () => void = () => {
    BankOpeningCoordinator.completion.takePending();
    if (this.active) {
      void this.loadHomeData();
    }
  };
  private foregroundListener: () => void = () => {
    if (this.active) {
      void this.loadHomeData();
    }
  };

  aboutToAppear(): void {
    this.active = true;
    BankCardRepository.getInstance(this.getUIContext().getHostContext() as Context);
    BankOpeningCoordinator.completion.subscribe(this.completionListener);
    BankOpeningCoordinator.completion.takePending();
    this.getUIContext().getHostContext()?.eventHub.on('walletForeground', this.foregroundListener);
    void this.loadHomeData();
  }

  aboutToDisappear(): void {
    this.active = false;
    this.loadVersion++;
    BankOpeningCoordinator.completion.unsubscribe(this.completionListener);
    this.getUIContext().getHostContext()?.eventHub.off('walletForeground', this.foregroundListener);
  }

  private handleTitleTap(): void {
    const nextMode = this.cardMode === HomeCardDisplayMode.WITH_CARD
      ? HomeCardDisplayMode.NO_CARD
      : HomeCardDisplayMode.WITH_CARD;
    HomeRepository.setLaunchCardModeOverride(nextMode);
    this.cardMode = nextMode;
    void this.loadHomeData();
  }

  private async loadHomeData(): Promise<void> {
    const version: number = ++this.loadVersion;
    try {
      const records = await BankCardRepository.getInstance().list();
      const fallbackMode = await this.homeRepo.getCardDisplayMode();
      if (!this.active || version !== this.loadVersion) {
        return;
      }
      this.cardMode = records.length > 0 ? HomeCardDisplayMode.WITH_CARD : fallbackMode;
      this.savedBankName = records.length > 0 ? records[0].bankName : '';
      this.savedCardLabel = records.length > 0 ? maskCardNumber(records[0].cardNumber) : '';
      const hasCard: boolean = this.cardMode === HomeCardDisplayMode.WITH_CARD;
      this.promos = [];
      this.services = [];
      this.services = await this.homeRepo.getServiceEntries(hasCard);
      this.promos = await this.homeRepo.getPromoList(hasCard);
      this.message = await this.homeRepo.getMessageInfo(this.cardMode);
    } catch {
      if (!this.active || version !== this.loadVersion) { return; }
      this.services = [];
      this.promos = [];
      const ctx = this.getUIContext().getHostContext() as Context;
      showToast(ctx.resourceManager.getStringSync($r('app.string.home_data_unavailable').id));
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
              savedBankName: this.savedBankName,
              savedCardLabel: this.savedCardLabel,
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
