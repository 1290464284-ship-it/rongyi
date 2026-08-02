import { Global, Module } from '@nestjs/common';
import Database from 'better-sqlite3';
import { DbService } from '../db.service';
import { createTestDb, cleanupTestDb } from '../test-helpers';

type DbInstance = InstanceType<typeof Database>;

export const TEST_DB_INSTANCE = 'TEST_DB_INSTANCE';

@Global()
@Module({
  providers: [
    {
      provide: TEST_DB_INSTANCE,
      useFactory: () => {
        return createTestDb();
      },
    },
    {
      provide: DbService,
      useFactory: (db: DbInstance) => {
        const dbService = new DbService();
        (dbService as unknown as { database: DbInstance }).database = db;
        dbService.onModuleInit = async (): Promise<void> => {
          // 已在 createTestDb 中完成初始化
        };
        return dbService;
      },
      inject: [TEST_DB_INSTANCE],
    },
  ],
  exports: [DbService, TEST_DB_INSTANCE],
})
export class TestDbModule {
  static cleanup(db: DbInstance): void {
    cleanupTestDb(db);
  }
}
