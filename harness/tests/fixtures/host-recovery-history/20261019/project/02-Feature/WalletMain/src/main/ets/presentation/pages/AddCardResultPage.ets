import { Context } from '@kit.AbilityKit';
import { NavPathContext, Logger } from '@aspect/CommFunc';
import { showToast } from '@aspect/CommUI';
import { OpenCardResult } from '../../data/model/OpenCardResult';
import { OpenCardResultParams } from '../../data/model/OpenCardSessionParams';
import { OpenCardCompletionBridge } from '../../shared/OpenCardCompletionBridge';
import { BankConstants } from '../../shared/constant/BankConstants';

@Component
struct AddCardResultPage {
  @State result: OpenCardResult = new OpenCardResult(false, '', 'invalid_result');
  @State completing: boolean = false;
  private failureTargetName: string = BankConstants.ROUTE_ADD_BANK_CARD;

  private loadResult(context: NavDestinationContext): void {
    const params = context.pathInfo.param as OpenCardResultParams;
    if (params && params.result && typeof params.result.success === 'boolean' &&
      typeof params.result.fullCardNumber === 'string' && params.result.fullCardNumber.length > 0 &&
      params.failureTargetName === BankConstants.ROUTE_ADD_BANK_CARD) {
      this.result = new OpenCardResult(params.result.success, params.result.fullCardNumber, params.result.failureReason);
      this.failureTargetName = params.failureTargetName;
    }
  }

  private handleComplete(): void {
    if (this.completing) { return; }
    this.completing = true;
    try {
      const stack = NavPathContext.stack();
      if (this.result.success) {
        OpenCardCompletionBridge.publish(this.result.fullCardNumber);
        stack.clear();
      } else if (stack.getAllPathName().indexOf(this.failureTargetName) >= 0) {
        stack.popToName(this.failureTargetName);
      } else {
        // 进程恢复或无效入参没有历史目标时，仍回安全入口且不恢复验证会话。
        stack.clear();
        stack.pushPath({ name: BankConstants.ROUTE_ADD_BANK_CARD });
      }
    } catch {
      this.completing = false;
      Logger.error(BankConstants.LOG_TAG, 'complete navigation failed');
      try {
        const context = this.getUIContext().getHostContext() as Context;
        showToast(context.resourceManager.getStringSync($r('app.string.bank_nav_failed').id));
      } catch {
        Logger.error(BankConstants.LOG_TAG, 'navigation message unavailable');
      }
    }
  }

  build() {
    NavDestination() {
      Column() {
        Column() {
          SymbolGlyph(this.result.success ? $r('sys.symbol.checkmark_circle') : $r('sys.symbol.xmark_circle'))
            .fontSize('56fp').fontColor([this.result.success ? $r('app.color.open_card_success') : $r('app.color.color_text_primary')])
            .id(this.result.success ? 'rs_icon' : 'rf_icon')
          Text(this.result.success ? $r('app.string.card_add_success') : $r('app.string.card_add_failed'))
            .fontSize('24fp').fontColor($r('app.color.color_text_primary')).margin({ top: 16 })
            .id(this.result.success ? 'rs_status' : 'rf_status')
          Text(this.result.success ? $r('app.string.card_add_success_hint') : $r('app.string.card_add_failure_hint'))
            .fontSize('14fp').fontColor($r('app.color.color_text_primary')).margin({ top: 16 })
            .textAlign(TextAlign.Center).id(this.result.success ? 'rs_hint' : 'rf_hint')
          // 显式插画占位，来源和视觉债务见 spec/asset-manifest.yaml。
          Image($r('app.media.card_open_result_guide')).width('80%').height(240).objectFit(ImageFit.Contain)
            .margin({ top: 24 }).id(this.result.success ? 'rs_guide' : 'rf_guide')
        }.width('100%').margin({ top: 72 })
        Blank()
        Button($r('app.string.open_card_complete')).width('92%').height(44).fontSize('16fp')
          .backgroundColor($r('app.color.color_nav_btn_bg')).fontColor($r('app.color.color_link_blue'))
          .enabled(!this.completing).margin({ bottom: 24 })
          .id(this.result.success ? 'rs_complete' : 'rf_complete').onClick(() => this.handleComplete())
      }.width('100%').height('100%').backgroundColor($r('app.color.color_page_bg'))
      .id(this.result.success ? 'rs_root' : 'rf_root')
    }.hideTitleBar(true).hideBackButton(true)
    .onReady((context: NavDestinationContext) => this.loadResult(context))
    .onBackPressed(() => true)
  }
}

@Builder
export function buildAddCardResultPage() {
  AddCardResultPage();
}
