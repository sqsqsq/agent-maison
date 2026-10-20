import { BankCardType } from './BankCardType';
import { OpenCardResult } from './OpenCardResult';

export interface OpenCardSessionParams {
  bankCode: string;
  bankName: string;
  bankCardType: BankCardType;
  failureTargetName: string;
}

export interface OpenCardResultParams {
  result: OpenCardResult;
  failureTargetName: string;
}
