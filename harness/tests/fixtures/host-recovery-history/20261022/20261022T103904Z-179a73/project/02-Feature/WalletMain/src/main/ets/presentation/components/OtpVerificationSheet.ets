import { AccountService } from '@aspect/AccountManager';
import { BankOpeningCoordinator } from '../../domain/service/BankOpeningCoordinator';
import { OtpController, OtpSession } from '../../domain/model/OtpSession';
import { showToast } from '@aspect/CommUI';

@Component
export struct OtpVerificationSheet {
  onClose: () => void = () => {};
  onSubmitted: () => void = () => {};
  @State code: string = '';
  @State remainingSeconds: number = 60;
  @State maskedPhone: string = '';
  @State submitting: boolean = false;
  @State ready: boolean = false;
  private active: boolean = false;
  private coordinator: BankOpeningCoordinator = BankOpeningCoordinator.getInstance();
  private inputController: TextInputController = new TextInputController();

  aboutToAppear(): void {
    this.active = true;
    void this.open();
  }

  aboutToDisappear(): void {
    this.active = false;
    this.inputController.stopEditing();
    this.coordinator.closeOtp();
  }

  private async open(): Promise<void> {
    try {
      const profile = await AccountService.getInstance().getUserProfile();
      if (!this.active) {
        return;
      }
      this.coordinator.openOtp(profile.mockPhone, (session: OtpSession) => {
        if (this.active) {
          this.remainingSeconds = session.remainingSeconds;
          this.maskedPhone = session.maskedPhone;
        }
      });
      this.ready = this.coordinator.phase === 'OTP_READY';
    } catch {
      if (this.active) {
        showToast(this.getUIContext().getHostContext()!.resourceManager.getStringSync($r('app.string.home_data_unavailable').id));
      }
    }
  }

  private handleClose(): void {
    if (!this.submitting) {
      this.coordinator.closeOtp();
      this.onClose();
    }
  }

  private async handleSubmit(): Promise<void> {
    if (!this.ready || this.submitting || !OtpController.isValidCode(this.code)) {
      return;
    }
    this.submitting = true;
    try {
      await this.coordinator.confirmOtp(this.code);
      this.code = '';
      this.inputController.stopEditing();
      if (this.active) {
        this.onSubmitted();
      }
    } catch {
      if (this.active) {
        this.submitting = false;
      }
    }
  }

  private phoneText(): string {
    return this.getUIContext().getHostContext()!.resourceManager.getStringSync($r('app.string.open_otp_phone').id, this.maskedPhone);
  }

  private countdownText(): ResourceStr {
    return this.remainingSeconds > 0
      ? this.getUIContext().getHostContext()!.resourceManager.getStringSync($r('app.string.open_otp_countdown').id, this.remainingSeconds)
      : $r('app.string.open_otp_resend');
  }

  build() {
    Column() {
      Row() {
        Text($r('app.string.open_otp_title')).fontSize(20).fontWeight(FontWeight.Bold).id('otp_title')
        Blank()
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.xmark')).fontSize(16).fontColor([$r('app.color.color_text_primary')])
        }
        .width(32).height(32).backgroundColor($r('app.color.color_nav_btn_bg'))
        .enabled(!this.submitting).id('otp_close').onClick(() => this.handleClose())
      }
      .width('100%').margin({ bottom: 28 })
      Text($r('app.string.open_otp_prompt')).fontSize(14).fontColor($r('app.color.color_text_secondary'))
        .width('100%').id('otp_prompt')
      Text(this.phoneText()).fontSize(14).fontColor($r('app.color.color_text_secondary'))
        .width('100%').margin({ top: 4, bottom: 20 }).id('otp_phone')
      Row() {
        TextInput({ text: this.code, placeholder: $r('app.string.open_otp_placeholder'), controller: this.inputController })
          .type(InputType.Number).maxLength(6).inputFilter('[0-9]*')
          .layoutWeight(1).height(48).fontSize(16).backgroundColor($r('app.color.color_card_bg'))
          .enabled(!this.submitting).defaultFocus(true).id('otp_input')
          .onChange((value: string) => { this.code = value.replace(/[^0-9]/g, '').slice(0, 6); })
        Button(this.countdownText(), { type: ButtonType.Normal })
          .fontSize(14).backgroundColor(Color.Transparent).fontColor($r('app.color.brand_primary'))
          .enabled(this.ready && this.remainingSeconds === 0 && !this.submitting)
          .id('otp_resend').onClick(() => this.coordinator.resendOtp())
      }
      .width('100%').borderRadius(12).backgroundColor($r('app.color.color_card_bg')).id('otp_field_row')
      Button($r('app.string.open_next')).width('100%').height(44)
        .backgroundColor($r('app.color.brand_primary')).margin({ top: 28 })
        .enabled(this.ready && OtpController.isValidCode(this.code) && !this.submitting)
        .id('otp_next').onClick(() => this.handleSubmit())
    }
    .width('100%').padding({ left: 16, right: 16, top: 20, bottom: 32 })
    .backgroundColor($r('app.color.color_page_bg')).id('otp_root')
  }
}

