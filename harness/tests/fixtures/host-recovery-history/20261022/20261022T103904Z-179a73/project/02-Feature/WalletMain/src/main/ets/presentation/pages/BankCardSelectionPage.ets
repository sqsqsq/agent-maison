import { Context } from '@kit.AbilityKit';
import { NavPathContext } from '@aspect/CommFunc';
import { MockBankCard, maskCardNumber } from '../../data/model/MockBankCard';
import { BankCardType } from '../../data/model/BankCardType';
import { BankCardRepository } from '../../data/repository/BankCardRepository';
import { BankOpeningCoordinator } from '../../domain/service/BankOpeningCoordinator';
import { BankConstants } from '../../shared/constant/BankConstants';
import { OtpVerificationSheet } from '../components/OtpVerificationSheet';

@Component
export struct BankCardSelectionPage {
  @State cards: MockBankCard[] = [];
  @State selectedIndex: number = -1;
  @State agreementAccepted: boolean = false;
  @State otpVisible: boolean = false;
  private coordinator: BankOpeningCoordinator = BankOpeningCoordinator.getInstance();
  private resultPushed: boolean = false;

  aboutToAppear(): void {
    BankCardRepository.getInstance(this.getUIContext().getHostContext() as Context);
    this.cards = this.coordinator.cards.slice();
  }

  aboutToDisappear(): void {
    this.coordinator.closeOtp();
    if (this.coordinator.phase !== 'RESULT') {
      this.coordinator.cancel();
    }
  }

  private handleCardTap(card: MockBankCard, index: number): void {
    this.coordinator.selectCard(card);
    this.selectedIndex = index;
  }

  private openOtp(): void {
    if (this.selectedIndex >= 0 && this.agreementAccepted) {
      this.otpVisible = true;
    }
  }

  private closeOtp(): void {
    if (this.coordinator.phase !== 'SAVING') {
      this.coordinator.closeOtp();
      this.otpVisible = false;
    }
  }

  private showResult(): void {
    if (this.coordinator.phase === 'RESULT' && !this.resultPushed) {
      this.resultPushed = true;
      NavPathContext.stack().pushPath({ name: BankConstants.ROUTE_BANK_CARD_RESULT, param: this.coordinator.payload });
    }
  }

  private handleBack(): void {
    if (this.coordinator.phase !== 'SAVING') {
      this.coordinator.cancel();
      NavPathContext.stack().pop();
    }
  }

  private agreementText(): string {
    const type: Resource = this.coordinator.cardType === BankCardType.DEBIT
      ? $r('app.string.open_debit') : $r('app.string.open_credit');
    const manager = this.getUIContext().getHostContext()!.resourceManager;
    return manager.getStringSync($r('app.string.open_selection_agreement').id,
      this.coordinator.bank?.name ?? '', manager.getStringSync(type.id));
  }

  @Builder
  private otpBuilder() {
    OtpVerificationSheet({
      onClose: () => this.closeOtp(),
      onSubmitted: () => { this.otpVisible = false; }
    })
  }

  build() {
    NavDestination() {
      Column() {
        Row({ space: 12 }) {
          Button({ type: ButtonType.Circle }) {
            SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(20).fontColor([$r('app.color.color_text_primary')])
          }
          .width(36).height(36).backgroundColor($r('app.color.color_nav_btn_bg'))
          .id('selection_back').onClick(() => this.handleBack())
          Text(this.coordinator.bank?.name ?? '').fontSize(22).fontWeight(FontWeight.Bold).id('selection_title')
        }
        .height(48).width('100%').id('selection_nav')
        Text($r('app.string.open_selection_prompt')).fontSize(14).fontColor($r('app.color.color_text_secondary'))
          .width('100%').margin({ top: 36, bottom: 16 }).id('selection_prompt')
        Column() {
          ForEach(this.cards, (card: MockBankCard, index: number) => {
            Row({ space: 16 }) {
              Image(this.coordinator.bank?.logo ?? $r('app.media.bank_logo_cmb'))
                .width(32).height(32).id(index === 0 ? 'selection_card_logo' : 'selection_card_logo_2')
              Text(maskCardNumber(card.cardNumber)).fontSize(17).layoutWeight(1)
                .id(index === 0 ? 'selection_card_number' : 'selection_card_number_2')
              Radio({ value: index.toString(), group: 'bank_card_selection' })
                .checked(this.selectedIndex === index)
                .id(index === 0 ? 'selection_card_check' : 'selection_card_check_2')
                .onChange((checked: boolean) => { if (checked) { this.handleCardTap(card, index); } })
            }
            .width('100%').height(64).padding({ left: 12, right: 12 })
            .id(index === 0 ? 'selection_card_1' : 'selection_card_2')
            .onClick(() => this.handleCardTap(card, index))
          }, (card: MockBankCard) => maskCardNumber(card.cardNumber))
        }
        .width('100%').backgroundColor($r('app.color.color_card_bg')).borderRadius(12).id('selection_cards')
        Row({ space: 8 }) {
          Checkbox().select(this.agreementAccepted).width(18).height(18)
            .id('selection_agreement_check').onChange((checked: boolean) => { this.agreementAccepted = checked; })
          Text(this.agreementText()).fontSize(12).fontColor($r('app.color.color_text_secondary'))
            .layoutWeight(1).id('selection_agreement')
        }
        .alignItems(VerticalAlign.Top).margin({ top: 20 }).width('100%').id('selection_agreement_row')
        Button($r('app.string.open_next')).width('32%').height(40)
          .margin({ top: 24 }).backgroundColor($r('app.color.brand_primary'))
          .enabled(this.selectedIndex >= 0 && this.agreementAccepted)
          .id('selection_next').onClick(() => this.openOtp())
        Blank()
      }
      .width('100%').height('100%').padding({ left: 16, right: 16, top: 8 })
      .backgroundColor($r('app.color.color_page_bg')).id('selection_root')
      .bindSheet($$this.otpVisible, this.otpBuilder(), {
        height: 300, showClose: false, dragBar: false,
        backgroundColor: $r('app.color.color_page_bg'),
        onWillDismiss: (action: DismissSheetAction) => {
          if (this.coordinator.phase !== 'SAVING') {
            this.closeOtp();
            action.dismiss();
          }
        },
        onDisappear: () => this.showResult()
      })
    }
    .hideTitleBar(true)
    .onReady(() => {
      if (this.coordinator.bank === null || this.cards.length === 0) {
        this.handleBack();
      }
    })
    .onBackPressed(() => { this.handleBack(); return true; })
  }
}

@Builder
export function buildBankCardSelectionPage() {
  BankCardSelectionPage();
}

