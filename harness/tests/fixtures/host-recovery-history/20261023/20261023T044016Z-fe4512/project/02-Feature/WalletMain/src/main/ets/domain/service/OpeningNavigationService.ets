import { BankOpeningCompletionContext } from '../../data/model/BankOpeningCompletionContext';
import { OpeningResult } from '../../data/model/OpeningResult';
import { BankConstants } from '../../shared/constant/BankConstants';

/** 开卡完成后的定向清栈规则。 */
export class OpeningNavigationService {
  finish(stack: NavPathStack, result: OpeningResult): void {
    if (result.success) {
      BankOpeningCompletionContext.publish(result.fullCardNumber);
      stack.clear(false);
      return;
    }
    BankOpeningCompletionContext.clear();
    stack.popToName(BankConstants.ROUTE_ADD_BANK_CARD, false);
  }
}
