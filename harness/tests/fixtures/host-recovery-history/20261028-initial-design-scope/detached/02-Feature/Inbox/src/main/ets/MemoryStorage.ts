import { Message } from './Message';
export class MemoryStorage {
  writes = 0;
  constructor(private messages: Message[] = []) {}
  load(): Message[] { return this.messages.map(message => ({ ...message })); }
  save(messages: Message[]): void { this.writes++; this.messages = messages.map(message => ({ ...message })); }
}
