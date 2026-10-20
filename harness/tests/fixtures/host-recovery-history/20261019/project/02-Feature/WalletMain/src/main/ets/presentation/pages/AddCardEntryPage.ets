import { NavPathContext } from '@aspect/CommFunc';
import { SectionCard } from '@aspect/CommUI';
import { CardCategory } from '../../data/model/CardCategory';
import { CardRepository } from '../../data/repository/CardRepository';
import { CardCategoryList } from '../components/CardCategoryList';
import { ManageNonLocalSheet } from '../components/ManageNonLocalSheet';

@Component
struct AddCardEntryPage {
  @State categories: CardCategory[] = [];
  @State nonLocalCount: number = 0;
  @State sheetVisible: boolean = false;
  private readonly cardRepo: CardRepository = new CardRepository();

  aboutToAppear(): void {
    void this.loadAddCardData();
  }

  private async loadAddCardData(): Promise<void> {
    this.categories = await this.cardRepo.getCardCategories();
    this.nonLocalCount = await this.cardRepo.getNonLocalCardCount();
  }

  /**
   * 页面标题改为自绘 @Builder：系统标题栏的 ResourceStr 文本节点无法挂 .id()，
   * 而 AC-11 / AC-13 的身份断言需要可 by_id 命中的 ac_page_title。文案与位置不变。
   */
  @Builder
  private pageTitleBuilder() {
    Row() {
      Text($r('app.string.add_card_title'))
        .fontSize(20)
        .fontWeight(FontWeight.Bold)
        .fontColor($r('app.color.color_text_primary'))
        .id('ac_page_title')
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
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
        SectionCard() {
          Row() {
            SymbolGlyph($r('sys.symbol.rectangle_stack'))
              .fontSize(22)
              .fontColor([$r('app.color.brand_primary')])
              .margin({ right: 12 })
            Text($r('app.string.non_local_cards'))
              .fontSize(16)
              .fontColor($r('app.color.text_primary'))
              .layoutWeight(1)
            Text(`${this.nonLocalCount}`)
              .fontSize(12)
              .fontColor(Color.White)
              .width(22)
              .height(22)
              .textAlign(TextAlign.Center)
              .borderRadius(11)
              .backgroundColor($r('app.color.wallet_badge_gray'))
            SymbolGlyph($r('sys.symbol.chevron_right'))
              .fontSize(16)
              .fontColor([$r('app.color.text_secondary')])
              .margin({ left: 8 })
          }
          .width('100%')
          .height(48)
          .padding({ left: 16, right: 16 })
          .id('ac_non_local_entry')
          .responseRegion({
            x: 0,
            y: 0,
            width: '100%',
            height: '100%'
          })
          .onClick(() => {
            this.sheetVisible = true;
          })
        }

        CardCategoryList({ categories: this.categories })
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
    .title(this.pageTitleBuilder())
    .onBackPressed(() => {
      NavPathContext.stack().pop();
      return true;
    })
  }
}

@Builder
export function buildAddCardEntryPage() {
  AddCardEntryPage();
}
