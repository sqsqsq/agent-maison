import { BankInfo } from '../../data/model/BankInfo';
import { BankCardType } from '../../data/model/BankCardType';
import { BankOpeningCoordinator } from '../../domain/service/BankOpeningCoordinator';
import { showToast } from '@aspect/CommUI';

@Component
export struct CardTypeSheet {
  bank: BankInfo | null = null;
  onContinue: () => void = () => {};
  onClose: () => void = () => {};
  @State selectedType: BankCardType | null = null;
  @State loading: boolean = false;
  private coordinator: BankOpeningCoordinator = BankOpeningCoordinator.getInstance();
  private active: boolean = false;

  aboutToAppear(): void {
    this.active = true;
  }

  aboutToDisappear(): void {
    this.active = false;
  }

  private disclosure(): string {
    return this.getUIContext().getHostContext()!.resourceManager.getStringSync(
      $r('app.string.open_type_disclosure').id, this.bank?.name ?? '');
  }

  private async handleContinue(): Promise<void> {
    if (this.loading || this.selectedType === null) {
      return;
    }
    this.loading = true;
    try {
      const cards = await this.coordinator.selectCardType(this.selectedType);
      if (this.active && cards.length > 0) {
        this.onContinue();
      }
    } catch {
      if (this.active) {
        showToast(this.getUIContext().getHostContext()!.resourceManager.getStringSync($r('app.string.bank_list_load_failed').id));
      }
    } finally {
      if (this.active) {
        this.loading = false;
      }
    }
  }

  @Builder
  private typeRow(type: BankCardType) {
    Row() {
      Text(type === BankCardType.DEBIT ? $r('app.string.open_debit') : $r('app.string.open_credit'))
        .fontSize(16)
      Blank()
      Radio({ value: type, group: 'bank_card_type' })
        .checked(this.selectedType === type)
        .onChange((checked: boolean) => { if (checked) { this.selectedType = type; } })
    }
    .height(56).width('100%')
    .id(type === BankCardType.DEBIT ? 'type_savings' : 'type_credit')
    .onClick(() => { this.selectedType = type; })
  }

  build() {
    Column() {
      Row() {
        Text($r('app.string.open_type_title')).fontSize(20).fontWeight(FontWeight.Bold).id('type_title')
        Blank()
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.xmark')).fontSize(16).fontColor([$r('app.color.color_text_primary')])
        }
        .width(32).height(32).backgroundColor($r('app.color.color_nav_btn_bg'))
        .id('type_close').onClick(() => this.onClose())
      }
      .width('100%').margin({ bottom: 24 })
      Column() {
        Row({ space: 12 }) {
          Image(this.bank?.logo ?? $r('app.media.bank_logo_cmb')).width(28).height(28).id('type_bank_logo')
          Text(this.bank?.name ?? '').fontSize(16).id('type_bank_name')
        }
        .width('100%').height(56).id('type_bank_header')
        ForEach(this.bank?.supportedCardTypes ?? [], (type: BankCardType) => {
          Divider().color($r('app.color.color_line_divider')).strokeWidth(0.5)
          this.typeRow(type)
        }, (type: BankCardType) => type)
      }
      .padding({ left: 12, right: 12 }).width('100%').borderRadius(16)
      .backgroundColor($r('app.color.color_card_bg')).id('type_bank_surface')
      Text(this.disclosure()).fontSize(12).fontColor($r('app.color.color_text_secondary'))
        .width('100%').margin({ top: 16 }).id('type_disclosure')
      Blank()
      Text($r('app.string.open_type_agreement')).fontSize(12).fontColor($r('app.color.color_text_secondary'))
        .width('100%').margin({ top: 12, bottom: 24 }).id('type_agreement')
      Button($r('app.string.open_continue'))
        .width('56%').height(44).backgroundColor($r('app.color.brand_primary'))
        .enabled(this.selectedType !== null && !this.loading)
        .id('type_continue').onClick(() => this.handleContinue())
    }
    .width('100%').height('100%').padding({ left: 16, right: 16, top: 20, bottom: 32 })
    .backgroundColor($r('app.color.color_page_bg')).id('type_root')
  }
}

