import { InboxStore } from './src/main/ets/InboxStore';
import { MemoryStorage } from './src/main/ets/MemoryStorage';
export { InboxStore, MemoryStorage };
export { InboxProjection } from './src/main/ets/InboxProjection';
export type { Message } from './src/main/ets/Message';
export const createInbox = (storage: MemoryStorage): InboxStore => new InboxStore(storage);
