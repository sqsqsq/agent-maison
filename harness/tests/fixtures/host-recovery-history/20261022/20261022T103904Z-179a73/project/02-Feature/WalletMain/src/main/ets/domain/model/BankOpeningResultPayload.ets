import { SaveBankCardResult } from '../../data/model/SaveBankCardResult';

export interface BankOpeningResultPayload {
  fullCardNumber: string;
  result: SaveBankCardResult;
}

