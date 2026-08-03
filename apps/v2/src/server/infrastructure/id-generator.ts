import { randomUUID } from 'node:crypto';

export class UuidGenerator {
  id(): string {
    return randomUUID();
  }
}

