import { NavPathContext } from '@aspect/CommFunc';
import { OpeningResult } from '../../data/model/OpeningResult';
import { OpeningNavigationService } from '../../domain/service/OpeningNavigationService';

@Component
struct BankCardOpeningResultPage {
  @Prop routeParam: Object;
  private readonly navigationService: OpeningNavigationService = new OpeningNavigationService();

  private result(): OpeningResult {
    return this.routeParam as OpeningResult;
  }

  private finishOpeningFlow(): void {
    this.navigationService.finish(NavPathContext.stack(), this.result());
  }

  build() {
    NavDestination() {
      Column() {
        Column() {
          SymbolGlyph(this.result().success
            ? $r('sys.symbol.checkmark_circle_fill')
            : $r('sys.symbol.xmark_circle_fill'))
            .fontSize(64)
            .fontColor([this.result().success
              ? $r('app.color.brand_fuel_green')
              : $r('app.color.brand_danger')])
            .id('result_status_icon')

          Text(this.result().success
            ? $r('app.string.opening_result_success_title')
            : $r('app.string.opening_result_failure_title'))
            .fontSize(22)
            .fontWeight(FontWeight.Bold)
            .fontColor($r('app.color.color_text_primary'))
            .margin({ top: 14 })
            .id('result_title')

          Text(this.result().success
            ? $r('app.string.opening_result_success_description')
            : $r('app.string.opening_result_failure_description'))
            .fontSize(14)
            .fontColor($r('app.color.color_text_secondary'))
            .textAlign(TextAlign.Center)
            .margin({ top: 8 })
            .id('result_description')
        }
        .width('100%')
        .alignItems(HorizontalAlign.Center)
        .margin({ top: 96 })
        .id('result_state_group')

        Image($r('app.media.result_payment_guide_placeholder'))
          .width('58%')
          .height('33%')
          .objectFit(ImageFit.Contain)
          .margin({ top: 24 })
          .id('result_guide_illustration')

        Blank()

        Button($r('app.string.opening_finish'))
          .width('88%')
          .height(52)
          .fontSize(16)
          .fontColor($r('app.color.brand_primary'))
          .backgroundColor($r('app.color.button_tonal_bg'))
          .margin({ bottom: 28 })
          .id('result_finish_btn')
          .onClick(() => {
            this.finishOpeningFlow();
          })
      }
      .width('100%')
      .height('100%')
      .alignItems(HorizontalAlign.Center)
      .backgroundColor($r('app.color.color_page_bg'))
      .id('opening_result_root')
    }
    .hideTitleBar(true)
    .onBackPressed(() => {
      return true;
    })
  }
}

@Builder
export function buildBankCardOpeningResultPage(param: Object) {
  BankCardOpeningResultPage({ routeParam: param });
}
