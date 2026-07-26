import { MockDbService, MockDbRow } from '../../db/__mocks__/db-service.mock';
import { IStatement, IDatabase } from '../../db/db.interface';
import { FaultInjector, FaultConfig } from './fault-injection';

export interface SqlFaultRule {
  match: RegExp | string;
  faultName: string;
  method?: 'get' | 'all' | 'run' | 'prepare';
}

interface SnapshotData {
  tables: Map<string, Map<string, MockDbRow>>;
}

export class FaultyMockDbService extends MockDbService {
  private faultInjector: FaultInjector;
  private rules: SqlFaultRule[] = [];
  private originalPrepare: (sql: string) => IStatement;
  private savepointStack: SnapshotData[] = [];
  private allTableNames: string[] = [];

  constructor(faultInjector: FaultInjector) {
    super();
    this.faultInjector = faultInjector;
    this.originalPrepare = super.prepare.bind(this);
    this.allTableNames = this.getAllTableNames();
  }

  addFaultRule(rule: SqlFaultRule): void {
    this.rules.push(rule);
  }

  clearFaultRules(): void {
    this.rules = [];
  }

  setFault(name: string, config: FaultConfig): void {
    this.faultInjector.setFault(name, config);
  }

  prepare(sql: string): IStatement {
    const matchingRule = this.findMatchingRule(sql, 'prepare');
    if (matchingRule) {
      this.faultInjector.triggerIfNeeded(matchingRule.faultName);
    }

    const stmt = this.originalPrepare(sql);

    return {
      get: (...params: unknown[]) => {
        const rule = this.findMatchingRule(sql, 'get');
        if (rule) {
          this.faultInjector.triggerIfNeeded(rule.faultName);
        }
        return stmt.get(...params);
      },
      all: (...params: unknown[]) => {
        const rule = this.findMatchingRule(sql, 'all');
        if (rule) {
          this.faultInjector.triggerIfNeeded(rule.faultName);
        }
        return stmt.all(...params);
      },
      run: (...params: unknown[]) => {
        const rule = this.findMatchingRule(sql, 'run');
        if (rule) {
          this.faultInjector.triggerIfNeeded(rule.faultName);
        }
        return stmt.run(...params);
      },
    };
  }

  transaction<T>(fn: (db: IDatabase) => T): T {
    const snapshot = this.createSnapshot();
    this.savepointStack.push(snapshot);

    try {
      const result = fn(this);
      this.savepointStack.pop();
      return result;
    } catch (err) {
      this.savepointStack.pop();
      this.restoreSnapshot(snapshot);
      throw err;
    }
  }

  private createSnapshot(): SnapshotData {
    const tables = new Map<string, Map<string, MockDbRow>>();
    for (const tableName of this.allTableNames) {
      const rows = this.getTableData(tableName);
      const rowMap = new Map<string, MockDbRow>();
      for (const row of rows) {
        rowMap.set(row.id as string, structuredClone(row));
      }
      tables.set(tableName, rowMap);
    }
    return { tables };
  }

  private restoreSnapshot(snapshot: SnapshotData): void {
    for (const tableName of this.allTableNames) {
      const rows = snapshot.tables.get(tableName);
      const seedData = rows ? Array.from(rows.values()) : [];
      this.clearTable(tableName);
      if (seedData.length > 0) {
        this.seed(tableName, seedData);
      }
    }
  }

  private clearTable(tableName: string): void {
    const rows = this.getTableData(tableName);
    for (const row of rows) {
      const sql = `DELETE FROM ${tableName} WHERE id = ?`;
      this.originalPrepare(sql).run(row.id);
    }
  }

  private getAllTableNames(): string[] {
    const testTableNames = [
      'Clinic', 'User', 'Patient', 'Charge', 'ChargeItem', 'DebtRecord', 'DebtPayment',
      'Refund', 'MemberCard', 'MemberCardLog', 'MemberPointLog', 'InventoryItem',
      'InventoryTransaction', 'Prescription', 'PrescriptionItem', 'Appointment',
      'Registration', 'MedicalRecord', 'TreatmentPlan', 'TreatmentPlanItem',
      'Treatment', 'TreatmentCatalog', 'ProcessingOrder', 'PurchaseOrder',
      'Supplier', 'IdempotencyRecord', 'UsedRefreshToken', 'OperationLog',
      'Setting', 'FirstExam', 'FirstExamTooth', 'FirstExamFollowUp',
      'FirstExamTrack', 'FollowUpTemplate', 'FollowUpTemplateItem',
      'AutoFollowUpRule', 'FollowUpStatsCache', 'FollowUpAssignment',
      'ProcessingOrderTemplate', 'ProcessingOrderTemplateItem', 'WechatMessage',
      'Imaging', 'ToothRecord', 'Visit', 'Equipment', 'schema_migrations',
      'ChargeCombo', 'PaymentMethod', 'DebtPaymentRecord',
      'ProcessingOrderItem', 'ProcessingFlowLog', 'ProcessingProduct', 'ProcessingFactory',
      'AuditLog',
    ];
    return testTableNames;
  }

  private findMatchingRule(sql: string, method: 'get' | 'all' | 'run' | 'prepare'): SqlFaultRule | undefined {
    return this.rules.find(rule => {
      if (rule.method && rule.method !== method) return false;

      if (typeof rule.match === 'string') {
        return sql.toUpperCase().includes(rule.match.toUpperCase());
      }
      return rule.match.test(sql);
    });
  }
}

export function createFaultyMockDb(faultInjector: FaultInjector): FaultyMockDbService {
  return new FaultyMockDbService(faultInjector);
}

export function createDbFaultWithSqlPattern(
  faultInjector: FaultInjector,
  sqlPattern: RegExp | string,
  faultName: string,
  config: FaultConfig,
): { db: FaultyMockDbService; cleanup: () => void } {
  const db = createFaultyMockDb(faultInjector);
  faultInjector.setFault(faultName, config);
  db.addFaultRule({ match: sqlPattern, faultName });

  const cleanup = () => {
    db.clearFaultRules();
    faultInjector.clearFault(faultName);
  };

  return { db, cleanup };
}
