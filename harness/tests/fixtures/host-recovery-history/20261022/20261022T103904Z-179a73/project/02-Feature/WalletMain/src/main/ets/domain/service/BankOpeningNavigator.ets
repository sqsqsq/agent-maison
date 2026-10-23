import { NavPathContext } from '@aspect/CommFunc';
import { BankOpeningResultPayload } from '../model/BankOpeningResultPayload';
import { BankOpeningCompletionBridge } from '../../shared/BankOpeningCompletionBridge';
import { BankConstants } from '../../shared/constant/BankConstants';

export class BankOpeningNavigator {
  private static activateHome: () => void = () => {};

  private readonly completion: BankOpeningCompletionBridge<BankOpeningResultPayload>;

  constructor(completion: BankOpeningCompletionBridge<BankOpeningResultPayload>) {
    this.completion = completion;
  }

  static setHomeActivator(callback: () => void): void {
    BankOpeningNavigator.activateHome = callback;
  }

  finish(payload: BankOpeningResultPayload): void {
    if (payload.result.success) {
      this.completion.publish(payload);
      BankOpeningNavigator.activateHome();
      NavPathContext.stack().clear(false);
    } else {
      NavPathContext.stack().clear(false);
      NavPathContext.stack().pushPath({ name: BankConstants.ROUTE_ADD_BANK_CARD }, false);
    }
  }
}
