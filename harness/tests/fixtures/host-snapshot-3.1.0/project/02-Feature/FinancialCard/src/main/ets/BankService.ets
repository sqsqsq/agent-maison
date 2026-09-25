export class BankService {
  openCard(id: string): Promise<boolean> { return Promise.resolve(!!id); }
}
