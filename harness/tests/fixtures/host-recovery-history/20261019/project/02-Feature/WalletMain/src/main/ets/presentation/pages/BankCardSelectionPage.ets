import { Context } from '@kit.AbilityKit';
import { Logger, NavPathContext } from '@aspect/CommFunc';
import { showToast } from '@aspect/CommUI';
import { BankCardInfo } from '../../data/model/BankCardInfo';
import { BankCardType } from '../../data/model/BankCardType';
import { BankInfo } from '../../data/model/BankInfo';
import { OpenCardSessionParams, OpenCardResultParams } from '../../data/model/OpenCardSessionParams';
import { BankRepository } from '../../data/repository/BankRepository';
import { BankCardMaskService } from '../../domain/service/BankCardMaskService';
import { OpenCardFlow } from '../../domain/service/OpenCardFlow';
import { BankConstants } from '../../shared/constant/BankConstants';
import { OtpVerificationSheet } from '../components/OtpVerificationSheet';

@Component
struct BankCardSelectionPage {
  @State candidates: BankCardInfo[] = [];
  @State bankName: string = '';
  @State bankLogo: Resource = $r('app.media.bank_logo_cmb');
  @State selectedId: string = '';
  @State agreementAccepted: boolean = false;
  @State otpVisible: boolean = false;
  @State saving: boolean = false;
  @State seconds: number = 0;
  @State loadFailed: boolean = false;
  private readonly flow: OpenCardFlow = new OpenCardFlow();
  private readonly bankRepo: BankRepository = new BankRepository();
  private alive: boolean = true;
  private submitting: boolean = false;
  private resultPushed: boolean = false;
  private failureTargetName: string = BankConstants.ROUTE_ADD_BANK_CARD;

  aboutToAppear(): void {
    this.alive = true;
    this.flow.onStateChanged = (): void => {
      this.saving = this.flow.phase === 'Saving';
      this.seconds = this.flow.otpSeconds;
      this.selectedId = this.flow.selectedCard?.cardId ?? '';
    };
  }

  aboutToDisappear(): void {
    this.alive = false;
    this.flow.dispose();
  }

  private async loadCandidates(context: NavDestinationContext): Promise<void> {
    try {
      const params = context.pathInfo.param as OpenCardSessionParams;
      if (!params || typeof params.bankCode !== 'string' ||
        (params.bankCardType !== BankCardType.DEBIT && params.bankCardType !== BankCardType.CREDIT) ||
        params.failureTargetName !== BankConstants.ROUTE_ADD_BANK_CARD) {
        throw new Error('invalid_session');
      }
      const banks: BankInfo[] = await this.bankRepo.getBanks();
      const bank = banks.find((item: BankInfo) => item.code === params.bankCode);
      if (bank === undefined || bank.supportedCardTypes.indexOf(params.bankCardType) < 0) {
        throw new Error('invalid_bank');
      }
      const candidates: BankCardInfo[] = await this.bankRepo.getCards(params.bankCode, params.bankCardType);
      if (!this.alive) { return; }
      this.bankName = bank.name;
      this.bankLogo = bank.logo;
      this.failureTargetName = params.failureTargetName;
      this.candidates = candidates;
      this.loadFailed = candidates.length === 0;
    } catch {
      this.loadFailed = true;
      Logger.error(BankConstants.LOG_TAG, 'load card candidates failed');
    }
  }

  private handleSelect(card: BankCardInfo): void {
    this.flow.selectCard(card);
  }

  private handleOpenOtp(): void {
    if (this.flow.selectedCard === null || !this.agreementAccepted || this.otpVisible) { return; }
    this.flow.openOtp();
    this.otpVisible = true;
  }

  private handleCloseOtp(): void {
    if (this.saving) { return; }
    this.flow.closeOtp();
    this.otpVisible = false;
  }

  private async handleSubmitOtp(otp: string): Promise<void> {
    if (this.submitting || this.resultPushed || !this.agreementAccepted || !/^\d{6}$/.test(otp)) { return; }
    this.submitting = true;
    try {
      const context = this.getUIContext().getHostContext() as Context;
      const result = await this.flow.submitOtp(context, otp);
      if (!this.alive || this.flow.phase !== 'Result') { return; }
      const params: OpenCardResultParams = { result: result, failureTargetName: this.failureTargetName };
      NavPathContext.stack().pushPath({ name: BankConstants.ROUTE_CARD_RESULT, param: params });
      this.resultPushed = true;
      this.otpVisible = false;
    } catch {
      this.showNavigationError();
    } finally {
      this.submitting = false;
    }
  }

  private showNavigationError(): void {
    Logger.error(BankConstants.LOG_TAG, 'card selection navigation failed');
    try {
      const context = this.getUIContext().getHostContext() as Context;
      showToast(context.resourceManager.getStringSync($r('app.string.bank_nav_failed').id));
    } catch {
      Logger.error(BankConstants.LOG_TAG, 'navigation message unavailable');
    }
  }

  private handleBack(): void {
    if (this.saving) { return; }
    if (this.otpVisible) { this.handleCloseOtp(); return; }
    try { NavPathContext.stack().pop(); } catch { this.showNavigationError(); }
  }

  @Builder
  private otpSheet() {
    OtpVerificationSheet({ flow: this.flow, seconds: this.seconds, saving: this.saving,
      onSubmit: (otp: string): void => { void this.handleSubmitOtp(otp); },
      onClose: (): void => this.handleCloseOtp() })
  }

  build() {
    NavDestination() {
      Column() {
        Row({ space: 12 }) {
          Button({ type: ButtonType.Circle }) {
            SymbolGlyph($r('sys.symbol.chevron_left')).fontSize('20fp')
              .fontColor([$r('app.color.color_text_primary')])
          }.width(44).height(44).backgroundColor($r('app.color.color_nav_btn_bg'))
          .id('cs_back').onClick(() => this.handleBack())
          Text(this.bankName).fontSize('24fp').fontWeight(FontWeight.Bold)
            .fontColor($r('app.color.color_text_primary')).id('cs_bank_title')
        }.width('100%').height(52).id('cs_nav')
        Scroll() {
          Column() {
            Text($r('app.string.card_select_hint')).fontSize('12fp')
              .fontColor($r('app.color.color_text_secondary')).width('100%')
              .margin({ top: 48, bottom: 16 }).id('cs_hint')
            Column() {
              ForEach(this.candidates, (card: BankCardInfo, index: number) => {
                Row({ space: 12 }) {
                  Image(this.bankLogo).width(32).height(32).objectFit(ImageFit.Contain)
                  Text(BankCardMaskService.maskCardNumber(card.fullCardNumber)).fontSize('18fp')
                    .fontColor($r('app.color.color_text_primary')).layoutWeight(1)
                  Radio({ value: card.cardId, group: 'bank_card' }).checked(this.selectedId === card.cardId)
                    .radioStyle({ checkedBackgroundColor: $r('app.color.open_card_bank_accent') })
                    .width(24).height(24).onChange((checked: boolean) => {
                      if (checked) { this.handleSelect(card); }
                    })
                }.width('100%').height(72).padding({ left: 16, right: 12 })
                .id(index === 0 ? 'cs_card_1' : 'cs_card_2').onClick(() => this.handleSelect(card))
              }, (card: BankCardInfo) => card.cardId)
            }.width('100%').backgroundColor($r('app.color.color_card_bg')).borderRadius(16).id('cs_cards')
            if (this.loadFailed) {
              Text($r('app.string.bank_list_load_failed')).fontSize('14fp').margin({ top: 16 })
            }
            Row({ space: 8 }) {
              Checkbox({ name: 'card_agreement' }).select(this.agreementAccepted)
                .selectedColor($r('app.color.open_card_bank_accent')).width(24).height(24)
                .onChange((value: boolean) => { this.agreementAccepted = value; })
              Text($r('app.string.card_select_agreement', this.bankName)).fontSize('12fp')
                .fontColor($r('app.color.color_text_secondary')).layoutWeight(1)
            }.width('100%').alignItems(VerticalAlign.Top).margin({ top: 28, bottom: 32 }).id('cs_agreement')
            Button($r('app.string.open_card_next')).fontSize('16fp').width('50%').height(44)
              .backgroundColor($r('app.color.open_card_bank_accent')).fontColor($r('app.color.color_card_bg'))
              .enabled(this.selectedId.length > 0 && this.agreementAccepted && !this.saving)
              .id('cs_next').onClick(() => this.handleOpenOtp())
          }.width('100%')
        }.layoutWeight(1).scrollBar(BarState.Off)
      }.width('100%').height('100%').padding({ left: 16, right: 16 })
      .backgroundColor($r('app.color.color_page_bg')).id('cs_root')
      .bindSheet($$this.otpVisible, this.otpSheet(), {
        height: SheetSize.FIT_CONTENT, showClose: false, dragBar: false,
        backgroundColor: $r('app.color.color_page_bg'),
        onWillDismiss: (action: DismissSheetAction): void => {
          if (!this.saving) { this.flow.closeOtp(); action.dismiss(); }
        },
        onDisappear: (): void => { this.flow.closeOtp(); }
      })
    }.hideTitleBar(true)
    .onReady((context: NavDestinationContext) => { void this.loadCandidates(context); })
    .onBackPressed(() => { this.handleBack(); return true; })
  }
}

@Builder
export function buildBankCardSelectionPage() {
  BankCardSelectionPage();
}
