import { Context } from '@kit.AbilityKit';
import { Logger, NavPathContext } from '@aspect/CommFunc';
import { showToast } from '@aspect/CommUI';
import { BankInfo } from '../../data/model/BankInfo';
import { BankRepository } from '../../data/repository/BankRepository';
import { BankGroupService } from '../../domain/service/BankGroupService';
import { BankConstants } from '../../shared/constant/BankConstants';
import { BankListRow } from '../components/BankListRow';

/**
 * 添加银行卡页面：收起态与展开态是同一路由的两个形态（expanded 状态位切换，不入栈），
 * 从全部银行页返回后仍保持展开态（AC-12）。
 */
@Component
struct AddBankCardPage {
  @State banks: BankInfo[] = [];
  @State expanded: boolean = false;
  @State availableHeightVp: number = 0;
  @State loadFailed: boolean = false;
  private readonly bankRepo: BankRepository = new BankRepository();
  private lastNavAtMs: number = 0;
  private lastToastAtMs: number = 0;

  aboutToAppear(): void {
    void this.loadBanks();
  }

  /** 取数：本地常量数据源，异常降级为空态并提示一次（BD-2） */
  private async loadBanks(): Promise<void> {
    try {
      this.banks = await this.bankRepo.getBanks();
      this.loadFailed = false;
    } catch (err) {
      this.banks = [];
      this.loadFailed = true;
      Logger.error(BankConstants.LOG_TAG, 'load banks failed on AddBankCardPage');
      this.showTip($r('app.string.bank_list_load_failed'));
    }
  }

  /** 节流提示（BD-3）：同一窗口内只提示一次 */
  private showTip(res: Resource): void {
    const now: number = Date.now();
    if (now - this.lastToastAtMs < BankConstants.TOAST_THROTTLE_MS) {
      return;
    }
    this.lastToastAtMs = now;
    try {
      const ctx = this.getUIContext().getHostContext() as Context;
      showToast(ctx.resourceManager.getStringSync(res.id));
    } catch (err) {
      Logger.error(BankConstants.LOG_TAG, 'show toast failed on AddBankCardPage');
    }
  }

  /** 行点击：本轮无选择卡类型半模态页面，提示暂不支持且不跳转（AC-9） */
  private handleBankTap(bank: BankInfo): void {
    Logger.info(BankConstants.LOG_TAG, 'bank tapped: %{public}s', bank.code);
    this.showTip($r('app.string.not_supported'));
  }

  /** 「更多」：同页切换为展开态，不入栈（AC-4） */
  private handleMoreTap(): void {
    this.expanded = true;
  }

  /** 「查看全部银行」：入栈全部银行页面，带防重入窗口（AC-6 / BD-3） */
  private handleViewAllBanks(): void {
    const now: number = Date.now();
    if (now - this.lastNavAtMs < BankConstants.NAV_DEBOUNCE_MS) {
      return;
    }
    this.lastNavAtMs = now;
    try {
      NavPathContext.stack().pushPath({ name: BankConstants.ROUTE_ALL_BANKS });
    } catch (err) {
      Logger.error(BankConstants.LOG_TAG, 'push AllBanksPage failed');
      this.showTip($r('app.string.bank_nav_failed'));
    }
  }

  /** 返回上一页（AC-13） */
  private handleBack(): void {
    try {
      NavPathContext.stack().pop();
    } catch (err) {
      Logger.error(BankConstants.LOG_TAG, 'pop from AddBankCardPage failed');
      this.showTip($r('app.string.bank_nav_failed'));
    }
  }

  private visibleRowCount(): number {
    // 白卡不占满剩余屏高：先扣掉参考图版面里白卡下沿到容器下沿的留白，再按行高分配（AC-2 = 7 行）
    return BankGroupService.calcVisibleRowCount(
      this.availableHeightVp - BankConstants.CARD_BOTTOM_RESERVE_VP,
      BankConstants.ROW_HEIGHT_VP,
      BankConstants.PILL_BLOCK_HEIGHT_VP,
      this.banks.length
    );
  }

  private pillBanks(): BankInfo[] {
    const visible: number = this.visibleRowCount();
    const iconCount: number = BankGroupService.calcPillIconCount(
      this.banks.length,
      visible,
      BankConstants.MAX_PILL_ICONS
    );
    return this.banks.slice(visible, visible + iconCount);
  }

  @Builder
  private navBar(prefix: string) {
    Row() {
      // 返回按钮：浅灰圆底 + 左箭头（参考图形态）。刻意不用 Button 容器，避免与自绘圆底样式冲突。
      Row() {
        SymbolGlyph($r('sys.symbol.chevron_left'))
          .fontSize(20)
          .fontColor([$r('app.color.color_text_primary')])
      }
      .width(36)
      .height(36)
      .justifyContent(FlexAlign.Center)
      .backgroundColor($r('app.color.color_nav_btn_bg'))
      .borderRadius(18)
      .id(`${prefix}_back_btn`)
      .onClick(() => {
        this.handleBack();
      })

      Text($r('app.string.add_bank_card_title'))
        .fontSize($r('app.float.bank_font_page_title'))
        .fontWeight(FontWeight.Bold)
        .fontColor($r('app.color.color_text_primary'))
        .margin({ left: 12 })
        .id(`${prefix}_page_title`)
    }
    .width('100%')
    .height(48)
    .alignItems(VerticalAlign.Center)
    .id(`${prefix}_nav_bar`)
  }

  @Builder
  private subtitleRow(prefix: string) {
    Row() {
      Text($r('app.string.add_bank_card_no_input'))
        .fontSize($r('app.float.bank_font_caption'))
        .fontColor($r('app.color.color_text_secondary'))
        .textAlign(TextAlign.Start)
        .id(`${prefix}_subtitle_left`)

      Blank()

      Text($r('app.string.add_bank_card_support_count'))
        .fontSize($r('app.float.bank_font_caption'))
        .fontColor($r('app.color.color_text_secondary'))
        .textAlign(TextAlign.End)
        .id(`${prefix}_subtitle_right`)
    }
    .width('100%')
    .padding({ left: 12, right: 12 })
    // 上留白 36vp：参考图 1-a 白卡上沿在 y=453px（3.0 px/vp），16vp 时白卡整体偏上 59px
    .margin({ top: 36, bottom: 12 })
  }

  /** 收起态白卡：按剩余屏高渲染的银行行 + 「更多」药丸 */
  @Builder
  private collapsedCard() {
    Column() {
      ForEach(this.banks.slice(0, this.visibleRowCount()), (bank: BankInfo, index: number) => {
        BankListRow({
          bank: bank,
          idPrefix: 'col',
          showDivider: index < this.visibleRowCount() - 1,
          onTap: (tapped: BankInfo): void => {
            this.handleBankTap(tapped);
          }
        })
      }, (bank: BankInfo) => bank.code)

      if (this.pillBanks().length > 0) {
        Row() {
          ForEach(this.pillBanks(), (bank: BankInfo) => {
            Image(bank.logo)
              .width(22)
              .height(22)
              .objectFit(ImageFit.Contain)
              .margin({ right: 6 })
              .id(`col_pill_icon_${bank.code}`)
          }, (bank: BankInfo) => bank.code)

          Text($r('app.string.bank_more'))
            .fontSize($r('app.float.bank_font_caption'))
            .fontColor($r('app.color.color_text_secondary'))
            .margin({ left: 2 })
            .id('col_more_text')

          SymbolGlyph($r('sys.symbol.chevron_down'))
            .fontSize(14)
            .fontColor([$r('app.color.color_text_secondary')])
            .margin({ left: 4 })
            .id('col_more_chevron')
        }
        .height($r('app.float.bank_space_pill_height'))
        .padding({ left: 12, right: 12 })
        .backgroundColor($r('app.color.color_pill_bg'))
        .borderRadius($r('app.float.bank_radius_pill'))
        // 24 + 32(药丸) + 12 = PILL_BLOCK_HEIGHT_VP，与参考图 1-a 的药丸块 206px 对齐
        .margin({ top: 24, bottom: 12 })
        .id('col_more_pill')
        .onClick(() => {
          this.handleMoreTap();
        })
      }
    }
    .width('100%')
    .backgroundColor($r('app.color.color_card_bg'))
    .borderRadius($r('app.float.bank_radius_card'))
    .id('col_bank_card')
  }

  /** 展开态白卡：20 行 + 卡内页脚「查看全部银行」 */
  @Builder
  private expandedCard() {
    Column() {
      ForEach(this.banks, (bank: BankInfo, index: number) => {
        BankListRow({
          bank: bank,
          idPrefix: 'exp',
          showDivider: index < this.banks.length - 1,
          onTap: (tapped: BankInfo): void => {
            this.handleBankTap(tapped);
          }
        })
      }, (bank: BankInfo) => bank.code)

      Text($r('app.string.bank_view_all_banks'))
        .fontSize($r('app.float.bank_font_caption'))
        .fontColor($r('app.color.color_link_blue'))
        .width('100%')
        .height(48)
        .textAlign(TextAlign.Center)
        .id('exp_view_all_banks_btn')
        .onClick(() => {
          this.handleViewAllBanks();
        })
    }
    .width('100%')
    .backgroundColor($r('app.color.color_card_bg'))
    .borderRadius($r('app.float.bank_radius_card'))
    .id('exp_bank_card')
  }

  @Builder
  private emptyState() {
    Text(this.loadFailed ? $r('app.string.bank_list_load_failed') : $r('app.string.bank_list_empty'))
      .fontSize($r('app.float.bank_font_caption'))
      .fontColor($r('app.color.color_text_secondary'))
      .width('100%')
      .textAlign(TextAlign.Center)
      .margin({ top: 48 })
  }

  @Builder
  private collapsedBody() {
    Column() {
      this.navBar('col')
      this.subtitleRow('col')

      Column() {
        if (this.banks.length === 0) {
          this.emptyState()
        } else {
          this.collapsedCard()
        }
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
      .onAreaChange((_oldValue: Area, newValue: Area) => {
        // 容器高由 layoutWeight 决定（父驱动），子元素变化不会回写高度，故无量测反馈环
        this.availableHeightVp = Number.parseFloat(newValue.height.toString());
      })
    }
    .width('100%')
    .height('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({
      left: $r('app.float.bank_space_page_margin'),
      right: $r('app.float.bank_space_page_margin')
    })
    .backgroundColor($r('app.color.color_page_bg'))
    .id('col_root')
  }

  @Builder
  private expandedBody() {
    Column() {
      this.navBar('exp')
      this.subtitleRow('exp')

      if (this.banks.length === 0) {
        this.emptyState()
      } else {
        List() {
          ListItem() {
            this.expandedCard()
          }
        }
        .width('100%')
        .layoutWeight(1)
        .scrollBar(BarState.Off)
      }
    }
    .width('100%')
    .height('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({
      left: $r('app.float.bank_space_page_margin'),
      right: $r('app.float.bank_space_page_margin')
    })
    .backgroundColor($r('app.color.color_page_bg'))
    .id('exp_root')
  }

  build() {
    NavDestination() {
      if (this.expanded) {
        this.expandedBody()
      } else {
        this.collapsedBody()
      }
    }
    .hideTitleBar(true)
    .onBackPressed(() => {
      this.handleBack();
      return true;
    })
  }
}

@Builder
export function buildAddBankCardPage() {
  AddBankCardPage();
}
