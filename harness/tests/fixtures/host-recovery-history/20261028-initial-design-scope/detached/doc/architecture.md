# Architecture

Inbox is an existing App-internal library. Public index.ts creates a store backed by MemoryStorage. InboxProjection consumes snapshots through subscribe(). The acceptance environment uses native TypeScript and Node without UI or device execution.
