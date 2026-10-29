import { Context } from '@kit.AbilityKit';
import { Logger, NavPathContext } from '@aspect/CommFunc';
import { showToast } from '@aspect/CommUI';
import { BankGroup } from '../../data/model/BankGroup';
import { BankInfo } from '../../data/model/BankInfo';
import { BankRepository } from '../../data/repository/BankRepository';
import { BankGroupService } from '../../domain/service/BankGroupService';
import { BankConstants } from '../../shared/constant/BankConstants';
import { BankListRow } from '../components/BankListRow';

/**
 * 全部银行页面：A-Z 分组列表（每块「字母标签 + 白卡」）+ 右缘竖排字母索引条。
 * 内容列右内缩 40vp、索引条宽 16vp 距右 4vp，两者 bounds 零相交（AC-G1）。
 */
@Component
struct AllBanksPage {
  @State groups: BankGroup[] = [];
  @State indexLetters: string[] = [];
  @State loadFailed: boolean = false;
  private readonly bankRepo: BankRepository = new BankRepository();
  private readonly listScroller: Scroller = new Scroller();
  private lastToastAtMs: number = 0;

  aboutToAppear(): void {
    void this.loadGroups();
  }

  /** 取数 + 分组：异常降级为空态并提示一次（BD-2） */
  private async loadGroups(): Promise<void> {
    try {
      const banks: BankInfo[] = await this.bankRepo.getBanks();
      this.groups = BankGroupService.groupByInitial(banks);
      this.indexLetters = BankGroupService.collectIndexLetters(this.groups);
      this.loadFailed = false;
    } catch (err) {
      this.groups = [];
      this.indexLetters = [];
      this.loadFailed = true;
      Logger.error(BankConstants.LOG_TAG, 'load banks failed on AllBanksPage');
      this.showTip($r('app.string.bank_list_load_failed'));
    }
  }

  /** 节流提示（BD-3） */
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
      Logger.error(BankConstants.LOG_TAG, 'show toast failed on AllBanksPage');
    }
  }

  /** 行点击：提示暂不支持且不跳转（AC-10） */
  private handleBankTap(bank: BankInfo): void {
    Logger.info(BankConstants.LOG_TAG, 'bank tapped: %{public}s', bank.code);
    this.showTip($r('app.string.not_supported'));
  }

  /** 字母索引点击：同页定位到对应分块（AC-8） */
  private handleLetterTap(letter: string): void {
    const index: number = this.indexLetters.indexOf(letter);
    if (index < 0) {
      return;
    }
    this.listScroller.scrollToIndex(index);
  }

  /** 返回上一页（AC-12） */
  private handleBack(): void {
    try {
      NavPathContext.stack().pop();
    } catch (err) {
      Logger.error(BankConstants.LOG_TAG, 'pop from AllBanksPage failed');
      this.showTip($r('app.string.bank_nav_failed'));
    }
  }

  @Builder
  private navBar() {
    Row() {
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
      .id('ab_back_btn')
      .onClick(() => {
        this.handleBack();
      })

      Text($r('app.string.all_banks_title'))
        .fontSize($r('app.float.bank_font_page_title'))
        .fontWeight(FontWeight.Bold)
        .fontColor($r('app.color.color_text_primary'))
        .margin({ left: 12 })
        .id('ab_page_title')
    }
    .width('100%')
    .height(48)
    .alignItems(VerticalAlign.Center)
    .id('ab_nav_bar')
  }

  /** 右缘字母索引条：字母集合由分组结果派生，无对应银行的字母不展示（BD-7） */
  @Builder
  private letterIndex() {
    Column() {
      ForEach(this.indexLetters, (letter: string) => {
        Text(letter)
          .fontSize($r('app.float.bank_font_index_letter'))
          .fontColor($r('app.color.color_text_secondary'))
          .textAlign(TextAlign.Center)
          .width('100%')
          .padding({ top: 3, bottom: 3 })
          .id(`ab_index_letter_${letter}`)
          .onClick(() => {
            this.handleLetterTap(letter);
          })
      }, (letter: string) => letter)
    }
    .width($r('app.float.bank_space_ab_index_width'))
    .margin({ right: 4 })
    .id('ab_letter_index')
  }

  @Builder
  private groupBlock(group: BankGroup) {
    Column() {
      Text(group.letter)
        .fontSize($r('app.float.bank_font_caption'))
        .fontColor($r('app.color.color_text_secondary'))
        .width('100%')
        .height($r('app.float.bank_space_group_label_height'))
        .textAlign(TextAlign.Start)
        .id(`ab_group_label_${group.letter}`)

      Column() {
        ForEach(group.banks, (bank: BankInfo, index: number) => {
          BankListRow({
            bank: bank,
            idPrefix: 'ab',
            showDivider: index < group.banks.length - 1,
            onTap: (tapped: BankInfo): void => {
              this.handleBankTap(tapped);
            }
          })
        }, (bank: BankInfo) => bank.code)
      }
      .width('100%')
      .backgroundColor($r('app.color.color_card_bg'))
      .borderRadius($r('app.float.bank_radius_card'))
      .id(`ab_group_card_${group.letter}`)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  build() {
    NavDestination() {
      Stack({ alignContent: Alignment.End }) {
        Column() {
          this.navBar()

          if (this.groups.length === 0) {
            Text(this.loadFailed ? $r('app.string.bank_list_load_failed') : $r('app.string.bank_list_empty'))
              .fontSize($r('app.float.bank_font_caption'))
              .fontColor($r('app.color.color_text_secondary'))
              .width('100%')
              .textAlign(TextAlign.Center)
              .margin({ top: 48 })
          } else {
            List({ scroller: this.listScroller }) {
              ForEach(this.groups, (group: BankGroup) => {
                ListItem() {
                  this.groupBlock(group)
                }
              }, (group: BankGroup) => group.letter)
            }
            .width('100%')
            .layoutWeight(1)
            .scrollBar(BarState.Off)
            .id('ab_group_list')
          }
        }
        .width('100%')
        .height('100%')
        .alignItems(HorizontalAlign.Start)
        .padding({
          left: $r('app.float.bank_space_page_margin'),
          right: $r('app.float.bank_space_ab_content_right_margin')
        })

        this.letterIndex()
      }
      .width('100%')
      .height('100%')
      .backgroundColor($r('app.color.color_page_bg'))
      .id('ab_root')
    }
    .hideTitleBar(true)
    .onBackPressed(() => {
      this.handleBack();
      return true;
    })
  }
}

@Builder
export function buildAllBanksPage() {
  AllBanksPage();
}
