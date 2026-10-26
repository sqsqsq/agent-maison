import { AccountService, UserProfile } from '@aspect/AccountManager';
import { OpeningResult } from '../../data/model/OpeningResult';
import { BankCardOpeningService } from '../../domain/service/BankCardOpeningService';
import { BankConstants } from '../../shared/constant/BankConstants';

@Component
export struct OtpVerificationSheet {
  @State mobile: string = '';
  @State otp: string = '';
  @State countdownSeconds: number = 0;
  @State sending: boolean = false;
  @State saving: boolean = false;
  onFinished: (result: OpeningResult) => void = (_result: OpeningResult): void => {};
  onClose: () => void = (): void => {};
  openingService: BankCardOpeningService = new BankCardOpeningService();
  private timerId: number = -1;
  private isActive: boolean = false;

  aboutToAppear(): void {
    this.isActive = true;
    void this.loadMobileAndSend();
  }

  aboutToDisappear(): void {
    this.isActive = false;
    this.resetTransientState();
  }

  private async loadMobileAndSend(): Promise<void> {
    const profile: UserProfile = await AccountService.getInstance().getUserProfile();
    if (!this.isActive) {
      return;
    }
    this.mobile = profile.mobile;
    const sent: boolean = await this.openingService.startOtp(this.mobile);
    this.syncOtpState();
    if (sent) {
      this.startCountdownTimer();
    }
  }

  private async sendCode(): Promise<void> {
    const sent: boolean = await this.openingService.resendOtp();
    this.syncOtpState();
    if (sent && this.isActive) {
      this.startCountdownTimer();
    }
  }

  private startCountdownTimer(): void {
    this.stopCountdown();
    this.timerId = setInterval(() => {
      const remaining: number = this.openingService.tickOtp();
      this.syncOtpState();
      if (remaining === 0) {
        this.stopCountdown();
      }
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
    this.openingService.cancelOtp();
    this.syncOtpState();
    this.saving = false;
  }

  private handleOtpChange(value: string): void {
    this.openingService.updateOtp(value, BankConstants.OTP_LENGTH);
    this.syncOtpState();
  }

  private syncOtpState(): void {
    this.otp = this.openingService.otpValue();
    this.countdownSeconds = this.openingService.otpCountdownSeconds();
    this.sending = this.openingService.otpSending();
  }

  private canSubmit(): boolean {
    return this.openingService.canSubmit(BankConstants.OTP_LENGTH);
  }

  private isOtpComplete(): boolean {
    return /^\d{6}$/.test(this.otp);
  }

  private maskMobile(mobile: string): string {
    if (mobile.length < 7) {
      return mobile;
    }
    return `${mobile.substring(0, 3)}****${mobile.substring(mobile.length - 4)}`;
  }

  private async saveSelectedCard(): Promise<void> {
    if (this.saving || !this.canSubmit()) {
      return;
    }
    this.saving = true;
    const result: OpeningResult | null = await this.openingService.completeOpening(BankConstants.OTP_LENGTH);
    if (!this.isActive) {
      return;
    }
    this.saving = false;
    if (result === null) {
      return;
    }
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
        .enabled(!this.saving)
        .id('otp_sheet_close')
        .onClick(() => {
          if (this.saving) {
            return;
          }
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
        .enabled(this.isOtpComplete() && !this.saving)
        .width('88%')
        .height(48)
        .fontSize(16)
        .fontColor(this.isOtpComplete() ? Color.White : $r('app.color.brand_primary'))
        .backgroundColor(this.isOtpComplete()
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
