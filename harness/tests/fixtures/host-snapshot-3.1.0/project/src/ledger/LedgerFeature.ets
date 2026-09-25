export class LedgerFeature {
  private entries: number[] = [];
  add(amount: number): number { this.entries.push(amount); return this.balance(); }
  balance(): number { return this.entries.reduce((a, b) => a + b, 0); }
  restore(saved: number[]): number { this.entries = [...saved]; return this.balance(); }
}
