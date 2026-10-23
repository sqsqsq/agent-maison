import { BankOpeningResultPayload } from '../../domain/model/BankOpeningResultPayload';
import { BankOpeningCoordinator } from '../../domain/service/BankOpeningCoordinator';

@Component
export struct BankCardResultPage {
  @State payload: BankOpeningResultPayload | null = null;
  @State finished: boolean = false;
  private coordinator: BankOpeningCoordinator = BankOpeningCoordinator.getInstance();

  private handleFinish(): void {
    if (!this.finished && this.payload !== null) {
      this.finished = true;
      this.payload = null;
      this.coordinator.finish();
    }
  }

  build() {
    NavDestination() {
      Column() {
        Blank().layoutWeight(0.18).id('result_top_space')
        SymbolGlyph(this.payload?.result.success
          ? $r('sys.symbol.checkmark_circle_fill') : $r('sys.symbol.xmark_circle_fill'))
          .fontSize(52)
          .fontColor([this.payload?.result.success ? $r('app.color.brand_fuel_green') : $r('app.color.brand_danger')])
          .id('result_status_icon')
        Text(this.payload?.result.success ? $r('app.string.open_result_success') : $r('app.string.open_result_failure'))
          .fontSize(22).fontWeight(FontWeight.Bold).margin({ top: 16 }).id('result_title')
        Text(this.payload?.result.success ? $r('app.string.open_result_message') : $r('app.string.open_save_failed'))
          .fontSize(12).fontColor($r('app.color.color_text_secondary'))
          .margin({ top: 16 }).textAlign(TextAlign.Center).id('result_message')
        Image($r('app.media.open_card_guide')).width('58%').height('36%').objectFit(ImageFit.Contain)
          .margin({ top: 32 }).id('result_guide')
        Blank().layoutWeight(0.25)
        Button($r('app.string.open_finish')).width('100%').height(44)
          .fontColor($r('app.color.brand_primary')).backgroundColor($r('app.color.button_tonal_bg'))
          .enabled(this.payload !== null && !this.finished)
          .id('result_finish').onClick(() => this.handleFinish())
      }
      .width('100%').height('100%').padding({ left: 16, right: 16, bottom: 32 })
      .backgroundColor($r('app.color.color_page_bg')).id('result_root')
    }
    .hideTitleBar(true)
    .hideBackButton(true)
    .onReady((context: NavDestinationContext) => {
      this.payload = context.pathInfo.param as BankOpeningResultPayload;
    })
    .onBackPressed(() => true)
  }
}

@Builder
export function buildBankCardResultPage() {
  BankCardResultPage();
}

