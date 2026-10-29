import { NavPathContext } from '@aspect/CommFunc';
import { SectionCard } from '@aspect/CommUI';
import { CardRepository } from '../../data/repository/CardRepository';
import { ManageNonLocalSheet } from '../components/ManageNonLocalSheet';

@Component
struct CardPackPage {
  @State sheetVisible: boolean = false;
  @State showLocalCards: boolean = false;
  private readonly cardRepo: CardRepository = new CardRepository();

  aboutToAppear(): void {
    void this.loadCardPackData();
  }

  private async loadCardPackData(): Promise<void> {
    this.showLocalCards = await this.cardRepo.hasLocalCards();
  }

  @Builder
  private manageSheetBuilder() {
    ManageNonLocalSheet({
      onClose: (): void => {
        this.sheetVisible = false;
      }
    })
  }

  build() {
    NavDestination() {
      Column({ space: 12 }) {
        Row() {
          SymbolGlyph($r('sys.symbol.chevron_left'))
            .fontSize(22)
            .fontColor([$r('app.color.text_primary')])
            .margin({ right: 8 })
            .onClick(() => {
              NavPathContext.stack().pop();
            })

          Text($r('app.string.card_pack_title'))
            .fontSize(20)
            .fontWeight(FontWeight.Bold)
            .fontColor($r('app.color.color_text_primary'))
            .layoutWeight(1)
            .id('cp_page_title')

          SymbolGlyph($r('sys.symbol.plus'))
            .fontSize(22)
            .fontColor([$r('app.color.text_primary')])
            .onClick(() => {
              NavPathContext.stack().pushPath({ name: 'AddCardEntryPage' });
            })
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)
        .padding({ top: 4, bottom: 4 })

        SectionCard() {
          Row() {
            SymbolGlyph($r('sys.symbol.plus_circle'))
              .fontSize(24)
              .fontColor([$r('app.color.brand_primary')])
              .margin({ right: 12 })
            Text($r('app.string.add_card_title'))
              .fontSize(17)
              .fontWeight(FontWeight.Medium)
              .fontColor($r('app.color.text_primary'))
              .layoutWeight(1)
            Text($r('app.string.add_card_desc'))
              .fontSize(13)
              .fontColor($r('app.color.text_secondary'))
              .margin({ right: 8 })
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            SymbolGlyph($r('sys.symbol.chevron_right'))
              .fontSize(18)
              .fontColor([$r('app.color.text_secondary')])
          }
          .width('100%')
          .padding({
            left: 12,
            right: 12,
            top: 12,
            bottom: 12
          })
          .id('cp_add_card_btn')
          .onClick(() => {
            NavPathContext.stack().pushPath({ name: 'AddCardEntryPage' });
          })
        }

        if (this.showLocalCards) {
          Column({ space: 8 }) {
            Text($r('app.string.local_cards_section'))
              .fontSize(14)
              .fontColor($r('app.color.text_secondary'))
              .width('100%')
            Text($r('app.string.local_cards_empty'))
              .fontSize(14)
              .fontColor($r('app.color.text_secondary'))
              .width('100%')
              .padding(16)
              .backgroundColor($r('app.color.bg_surface'))
              .borderRadius(12)
          }
        }

        SectionCard() {
          Row() {
            SymbolGlyph($r('sys.symbol.rectangle_stack'))
              .fontSize(22)
              .fontColor([$r('app.color.text_secondary')])
              .margin({ right: 12 })
            Text($r('app.string.manage_non_local'))
              .fontSize(16)
              .fontColor($r('app.color.text_primary'))
              .layoutWeight(1)
            SymbolGlyph($r('sys.symbol.chevron_right'))
              .fontSize(16)
              .fontColor([$r('app.color.text_secondary')])
          }
          .width('100%')
          .height(48)
          .padding({ left: 16, right: 16 })
          .onClick(() => {
            this.sheetVisible = true;
          })
        }
      }
      .width('100%')
      .height('100%')
      .padding(16)
      .alignItems(HorizontalAlign.Start)
      .backgroundColor($r('app.color.bg_page'))
      .bindSheet($$this.sheetVisible, this.manageSheetBuilder(), {
        height: SheetSize.LARGE,
        showClose: false,
        dragBar: true
      })
    }
    .hideTitleBar(true)
    .onBackPressed(() => {
      NavPathContext.stack().pop();
      return true;
    })
  }
}

@Builder
export function buildCardPackPage() {
  CardPackPage();
}
