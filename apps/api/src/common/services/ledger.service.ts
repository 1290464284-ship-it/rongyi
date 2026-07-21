import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';

export type TransactionHandler<T> = (db: DbService['db']) => T;

@Injectable()
export class LedgerService {
  constructor(private dbService: DbService) {}

  transaction<T>(handler: TransactionHandler<T>): T {
    return this.dbService.transaction((db) => handler(db));
  }

  runWithCheckpoint<T>(handler: TransactionHandler<T>): T {
    const result = this.dbService.transaction((db) => handler(db));
    this.dbService.checkpoint();
    return result;
  }
}
