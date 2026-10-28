import { Message } from './Message';
import { MemoryStorage } from './MemoryStorage';
export class InboxStore {
  private messages: Message[];
  private listeners = new Set<(messages: Message[]) => void>();
  constructor(private storage: MemoryStorage) { this.messages = storage.load(); }
  list(): Message[] { return this.messages.map(message => ({ ...message })); }
  markRead(id: string): boolean {
    const message = this.messages.find(item => item.id === id);
    if (!message || message.read) return false;
    message.read = true; this.storage.save(this.messages);
    for (const listener of this.listeners) listener(this.list());
    return true;
  }
  subscribe(listener: (messages: Message[]) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
}
