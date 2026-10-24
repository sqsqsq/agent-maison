import { Context } from '@kit.AbilityKit';
import { AccountService, UserProfile } from '@aspect/AccountManager';
import { BankCardCandidate } from '../../data/model/BankCardCandidate';
import { OpeningResult } from '../../data/model/OpeningResult';
import { BankCardRepository } from '../../data/repository/BankCardRepository';
import { BankCardOpeningService } from '../../domain/service/BankCardOpeningService';
import { OtpService } from '../../domain/service/OtpService';
import { BankConstants } from '../../shared/constant/BankConstants';

@Component
export struct OtpVerificationSheet {
  @Prop candidate: BankCardCandidate;
  @State mobile: string = '';
  @State otp: string = '';
  @State countdownSeconds: number = 0;
  @State sending: boolean = false;
  @State saving: boolean = false;
  onFinished: (result: OpeningResult) => void = (_result: OpeningResult): void => {};
  onClose: () => void = (): void => {};
  private readonly openingService: BankCardOpeningService = new BankCardOpeningService();
  private readonly otpService: OtpService = new OtpService();
  private timerId: number = -1;

  aboutToAppear(): void {
    void this.loadMobileAndSend();
  }

  aboutToDisappear(): void {
    this.resetTransientState();
  }

  private async loadMobileAndSend(): Promise<void> {
    const profile: UserProfile = await AccountService.getInstance().getUserProfile();
    this.mobile = profile.mobile;
    await this.sendCode();
  }

  private async sendCode(): Promise<void> {
    if (this.sending || this.countdownSeconds > 0 || this.mobile.length === 0) {
      return;
    }
    this.sending = true;
    try {
      await this.otpService.sendMockCode(this.mobile);
      this.startCountdown();
    } finally {
      this.sending = false;
    }
  }

  private startCountdown(): void {
    this.stopCountdown();
    this.countdownSeconds = BankConstants.OTP_COUNTDOWN_SECONDS;
    this.timerId = setInterval(() => {
      if (this.countdownSeconds <= 1) {
        this.countdownSeconds = 0;
        this.stopCountdown();
        return;
      }
      this.countdownSeconds -= 1;
    }, 1000);
  }

  private stopCountdown(): void {
    if (this.timerId >= 0) {
      clearInterval(this.timerId);
      this.timerId = -1;
    }
  }

  private resetTransientState(): void {
    this.stopCountdown();
    this.otp = '';
    this.countdownSeconds = 0;
    this.sending = false;
    this.saving = false;
  }

  private handleOtpChange(value: string): void {
    this.otp = value.replace(/[^0-9]/g, '').substring(0, BankConstants.OTP_LENGTH);
  }

  private maskMobile(mobile: string): string {
    if (mobile.length < 7) {
      return mobile;
    }
    return `${mobile.substring(0, 3)}****${mobile.substring(mobile.length - 4)}`;
  }

  private async saveSelectedCard(): Promise<void> {
    if (this.saving || !this.openingService.isValidOtp(this.otp)) {
      return;
    }
    this.saving = true;
    let result: OpeningResult;
    try {
      const context: Context = this.getUIContext().getHostContext() as Context;
      const repository: BankCardRepository = new BankCardRepository(context);
      await repository.save(this.openingService.toStoredCard(this.candidate));
      result = this.openingService.toOpeningResult(this.candidate, true);
    } catch {
      result = this.openingService.toOpeningResult(this.candidate, false, 'RDB_SAVE_FAILED');
    }
    this.saving = false;
    this.stopCountdown();
    this.onFinished(result);
  }

  build() {
    Column() {
      Row() {
        Text($r('app.string.otp_sheet_title'))
          .fontSize($r('app.float.bank_font_page_title'))
          .fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.color_text_primary'))
          .layoutWeight(1)
          .id('otp_sheet_title')

        Row() {
          SymbolGlyph($r('sys.symbol.xmark'))
            .fontSize(18)
            .fontColor([$r('app.color.color_text_primary')])
        }
        .width(36)
        .height(36)
        .justifyContent(FlexAlign.Center)
        .backgroundColor($r('app.color.color_nav_btn_bg'))
        .borderRadius(18)
        .id('otp_sheet_close')
        .onClick(() => {
          this.resetTransientState();
          this.onClose();
        })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      Text($r('app.string.otp_instruction'))
        .fontSize(14)
        .fontColor($r('app.color.color_text_secondary'))
        .width('100%')
        .margin({ top: 24 })
        .id('otp_instruction')

      Text($r('app.string.otp_phone_hint', this.maskMobile(this.mobile)))
        .fontSize(14)
        .fontColor($r('app.color.color_text_primary'))
        .width('100%')
        .margin({ top: 4 })
        .id('otp_phone_hint')

      Row() {
        TextInput({ text: this.otp, placeholder: $r('app.string.otp_input_placeholder') })
          .type(InputType.Number)
          .maxLength(BankConstants.OTP_LENGTH)
          .fontSize(16)
          .backgroundColor(Color.Transparent)
          .layoutWeight(1)
          .id('otp_input')
          .onChange((value: string) => {
            this.handleOtpChange(value);
          })

        Button(this.countdownSeconds > 0
          ? $r('app.string.otp_countdown', this.countdownSeconds)
          : $r('app.string.otp_resend'))
          .enabled(this.countdownSeconds === 0 && !this.sending)
          .width('30%')
          .height(44)
          .fontSize(14)
          .fontColor($r('app.color.brand_primary'))
          .backgroundColor(Color.Transparent)
          .id('otp_resend_action')
          .onClick(() => {
            void this.sendCode();
          })
      }
      .width('100%')
      .height(58)
      .padding({ left: 12, right: 8 })
      .backgroundColor($r('app.color.color_card_bg'))
      .borderRadius(12)
      .margin({ top: 18 })
      .id('otp_code_row')

      Button($r('app.string.opening_next'))
        .enabled(this.openingService.isValidOtp(this.otp) && !this.saving)
        .width('88%')
        .height(48)
        .fontSize(16)
        .fontColor(this.openingService.isValidOtp(this.otp) ? Color.White : $r('app.color.brand_primary'))
        .backgroundColor(this.openingService.isValidOtp(this.otp)
          ? $r('app.color.brand_primary')
          : $r('app.color.button_tonal_bg'))
        .margin({ top: 24, bottom: 18 })
        .id('otp_next_btn')
        .onClick(() => {
          void this.saveSelectedCard();
        })
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 18 })
    .alignItems(HorizontalAlign.Center)
    .backgroundColor($r('app.color.color_page_bg'))
    .id('otp_sheet_panel')
  }
}
