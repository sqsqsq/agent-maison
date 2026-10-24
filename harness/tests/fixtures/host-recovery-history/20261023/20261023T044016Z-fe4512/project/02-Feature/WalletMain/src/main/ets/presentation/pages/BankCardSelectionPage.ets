import { Logger, NavPathContext } from '@aspect/CommFunc';
import { BankCardCandidate, BankCardSelectionParams } from '../../data/model/BankCardCandidate';
import { BankInfo } from '../../data/model/BankInfo';
import { OpeningResult } from '../../data/model/OpeningResult';
import { BankRepository } from '../../data/repository/BankRepository';
import { BankCardOpeningService } from '../../domain/service/BankCardOpeningService';
import { BankConstants } from '../../shared/constant/BankConstants';
import { OtpVerificationSheet } from '../components/OtpVerificationSheet';

@Component
struct BankCardSelectionPage {
  @Prop routeParam: Object;
  @State candidates: BankCardCandidate[] = [];
  @State bank: BankInfo | null = null;
  @State selectedCandidate: BankCardCandidate | null = null;
  @State agreementAccepted: boolean = false;
  @State showOtpSheet: boolean = false;
  private readonly bankRepository: BankRepository = new BankRepository();
  private readonly openingService: BankCardOpeningService = new BankCardOpeningService();

  aboutToAppear(): void {
    void this.loadCandidates();
  }

  private params(): BankCardSelectionParams {
    return this.routeParam as BankCardSelectionParams;
  }

  private async loadCandidates(): Promise<void> {
    const params: BankCardSelectionParams = this.params();
    const banks: BankInfo[] = await this.bankRepository.getBanks();
    this.bank = banks.find((item: BankInfo) => item.code === params.bankCode) ?? null;
    this.candidates = await this.bankRepository.getCards(params.bankCode, params.cardType);
  }

  private selectCandidate(candidate: BankCardCandidate): void {
    this.selectedCandidate = candidate;
  }

  private openOtpVerificationSheet(): void {
    if (this.selectedCandidate === null || !this.agreementAccepted) {
      return;
    }
    this.showOtpSheet = true;
  }

  private handleOpeningResult(result: OpeningResult): void {
    this.showOtpSheet = false;
    try {
      NavPathContext.stack().pushPath({
        name: BankConstants.ROUTE_BANK_CARD_RESULT,
        param: result
      });
    } catch {
      Logger.error(BankConstants.LOG_TAG, 'push opening result page failed');
    }
  }

  private handleBack(): void {
    try {
      NavPathContext.stack().pop();
    } catch {
      Logger.error(BankConstants.LOG_TAG, 'pop from BankCardSelectionPage failed');
    }
  }

  @Builder
  private otpSheetBuilder() {
    if (this.selectedCandidate !== null) {
      OtpVerificationSheet({
        candidate: this.selectedCandidate,
        onFinished: (result: OpeningResult): void => {
          this.handleOpeningResult(result);
        },
        onClose: (): void => {
          this.showOtpSheet = false;
        }
      })
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
      .id('selection_back_btn')
      .onClick(() => {
        this.handleBack();
      })

      Text(this.bank?.name ?? '')
        .fontSize($r('app.float.bank_font_page_title'))
        .fontWeight(FontWeight.Bold)
        .fontColor($r('app.color.color_text_primary'))
        .margin({ left: 12 })
        .id('selection_nav_title')
    }
    .width('100%')
    .height(48)
    .alignItems(VerticalAlign.Center)
    .id('selection_nav_bar')
  }

  build() {
    NavDestination() {
      Column() {
        this.navBar()

        Text($r('app.string.selection_hint'))
          .fontSize(14)
          .fontColor($r('app.color.color_text_secondary'))
          .width('100%')
          .margin({ top: 42, bottom: 14 })
          .id('selection_hint')

        Column() {
          ForEach(this.candidates, (candidate: BankCardCandidate, index: number) => {
            Row() {
              if (this.bank !== null) {
                Image(this.bank.logo)
                  .width(34)
                  .height(34)
                  .objectFit(ImageFit.Contain)
                  .margin({ right: 12 })
              }
              Text(this.openingService.maskCardNumber(candidate.cardNumber))
                .fontSize(16)
                .fontColor($r('app.color.color_text_primary'))
                .layoutWeight(1)
              SymbolGlyph(this.selectedCandidate?.cardNumber === candidate.cardNumber
                ? $r('sys.symbol.checkmark_circle_fill')
                : $r('sys.symbol.circle'))
                .fontSize(22)
                .fontColor([this.selectedCandidate?.cardNumber === candidate.cardNumber
                  ? $r('app.color.brand_danger')
                  : $r('app.color.color_text_secondary')])
            }
            .width('100%')
            .height(58)
            .padding({ left: 16, right: 16 })
            .id(`bank_card_candidate_${index + 1}`)
            .onClick(() => {
              this.selectCandidate(candidate);
            })
          }, (candidate: BankCardCandidate) => candidate.cardNumber)
        }
        .width('100%')
        .backgroundColor($r('app.color.color_card_bg'))
        .borderRadius($r('app.float.bank_radius_card'))
        .id('selection_card_container')

        Row() {
          Toggle({ type: ToggleType.Checkbox, isOn: this.agreementAccepted })
            .selectedColor($r('app.color.brand_danger'))
            .id('selection_agreement_check')
            .onChange((isOn: boolean) => {
              this.agreementAccepted = isOn;
            })

          Text($r('app.string.selection_agreement'))
            .fontSize(13)
            .fontColor($r('app.color.color_text_secondary'))
            .layoutWeight(1)
            .margin({ left: 8 })
            .id('selection_agreement')
        }
        .width('100%')
        .alignItems(VerticalAlign.Top)
        .margin({ top: 12 })

        Button($r('app.string.opening_next'))
          .enabled(this.selectedCandidate !== null && this.agreementAccepted)
          .width('30%')
          .height(46)
          .fontSize(16)
          .fontColor(Color.White)
          .backgroundColor(this.selectedCandidate !== null && this.agreementAccepted
            ? $r('app.color.brand_danger')
            : $r('app.color.button_tonal_bg'))
          .margin({ top: 22 })
          .id('selection_next_btn')
          .onClick(() => {
            this.openOtpVerificationSheet();
          })
      }
      .width('100%')
      .height('100%')
      .padding({ left: 18, right: 18 })
      .alignItems(HorizontalAlign.Center)
      .backgroundColor($r('app.color.color_page_bg'))
      .id('bank_card_selection_root')
      .bindSheet($$this.showOtpSheet, this.otpSheetBuilder(), {
        height: SheetSize.FIT_CONTENT,
        showClose: false,
        dragBar: false,
        backgroundColor: $r('app.color.color_page_bg'),
        onDisappear: () => {
          this.showOtpSheet = false;
        }
      })
    }
    .hideTitleBar(true)
    .onBackPressed(() => {
      this.handleBack();
      return true;
    })
  }
}

@Builder
export function buildBankCardSelectionPage(param: Object) {
  BankCardSelectionPage({ routeParam: param });
}
