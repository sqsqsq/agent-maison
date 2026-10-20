import { AccountService } from '@aspect/AccountManager';
import { MaskUtil, Logger } from '@aspect/CommFunc';
import { OpenCardFlow } from '../../domain/service/OpenCardFlow';

@Component
export struct OtpVerificationSheet {
  flow: OpenCardFlow = new OpenCardFlow();
  @Prop seconds: number = 60;
  @Prop saving: boolean = false;
  @State otpDigits: string = '';
  @State maskedPhone: string = '';
  @State phoneReady: boolean = false;
  private active: boolean = false;
  private focusTimer: number = -1;
  onSubmit: (otp: string) => void = (): void => {};
  onClose: () => void = (): void => {};

  aboutToAppear(): void {
    this.active = true;
    this.sendMockSms();
    void this.loadPhone();
    this.focusTimer = setTimeout(() => {
      if (this.active) {
        this.getUIContext().getFocusController().requestFocus('otp_input');
      }
    }, 200);
  }

  private sendMockSms(): void {
    // 演示发送由 Flow 的幂等 openOtp 启动一次计时，无真实短信请求。
    this.flow.openOtp();
  }

  private async loadPhone(): Promise<void> {
    try {
      const profile = await AccountService.getInstance().getUserProfile();
      if (this.active) {
        this.maskedPhone = MaskUtil.maskPhone(profile.phoneNumber);
        this.phoneReady = /^1\d{10}$/.test(profile.phoneNumber);
      }
    } catch {
      Logger.error('OpenCardOtp', 'account profile unavailable');
    }
  }

  aboutToDisappear(): void {
    this.active = false;
    clearTimeout(this.focusTimer);
    this.flow.closeOtp();
    this.otpDigits = '';
  }

  private handleClose(): void {
    if (!this.saving) {
      this.flow.closeOtp();
      this.onClose();
    }
  }

  private handleSubmit(): void {
    if (this.phoneReady && !this.saving && /^\d{6}$/.test(this.otpDigits)) {
      this.onSubmit(this.otpDigits);
    }
  }

  build() {
    Column() {
      Row() {
        Text($r('app.string.otp_title')).fontSize('22fp').fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.color_text_primary')).layoutWeight(1).id('otp_title')
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.xmark')).fontSize('18fp').fontColor([$r('app.color.color_text_primary')])
        }.width(44).height(44).backgroundColor($r('app.color.color_nav_btn_bg'))
        .accessibilityText($r('app.string.open_card_close')).enabled(!this.saving)
        .id('otp_close').onClick(() => this.handleClose())
      }.width('92%').margin({ bottom: 24 })
      Column() {
        Text($r('app.string.otp_phone_hint')).fontSize('14fp')
          .fontColor($r('app.color.color_text_secondary')).width('100%').id('otp_phone_hint')
        Text() {
          Span(this.maskedPhone).fontWeight(FontWeight.Medium)
          Span($r('app.string.otp_phone_suffix'))
        }.fontSize('14fp').fontColor($r('app.color.color_text_primary')).width('100%').id('otp_phone_suffix')
      }.width('85%').alignItems(HorizontalAlign.Start).margin({ bottom: 24 })
      Row() {
        TextInput({ text: this.otpDigits, placeholder: $r('app.string.otp_placeholder') })
          .type(InputType.Number).maxLength(6).fontSize('16fp').layoutWeight(1).height(52)
          .backgroundColor($r('app.color.color_card_bg')).enabled(!this.saving)
          .enableKeyboardOnFocus(true).id('otp_input')
          .onChange((value: string) => { this.otpDigits = this.flow.normalizeOtp(value); })
        Button(this.seconds > 0 ? $r('app.string.otp_countdown', this.seconds) : $r('app.string.otp_resend'))
          .fontSize('14fp').fontColor($r('app.color.color_link_blue'))
          .backgroundColor(Color.Transparent).height(48).padding({ left: 8, right: 12 })
          .enabled(this.seconds === 0 && !this.saving).id('otp_resend')
          .onClick(() => this.flow.resendOtp())
      }.width('85%').backgroundColor($r('app.color.color_card_bg')).borderRadius(16).id('otp_field')
      Button($r('app.string.open_card_next')).width('85%').height(44).fontSize('16fp')
        .backgroundColor($r('app.color.brand_primary')).fontColor($r('app.color.color_card_bg'))
        .enabled(this.phoneReady && !this.saving && this.otpDigits.length === 6)
        .margin({ top: 24 }).id('otp_next').onClick(() => this.handleSubmit())
    }.width('100%').padding({ top: 16, bottom: 28 })
    .backgroundColor($r('app.color.color_page_bg')).id('otp_root')
  }
}
