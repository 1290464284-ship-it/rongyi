/**
 * Application repository ports.
 *
 * Application use cases depend on these interfaces instead of better-sqlite3.
 * Infrastructure provides SQLite implementations.
 */

export interface ChargeItemRecord {
  id: string;
  chargeId: string;
  treatmentId?: string | null;
  name: string;
  category: string;
  price: number;
  quantity: number;
  teethNumbers: string[];
  subtotal: number;
  clinicId?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface ChargeRecord {
  id: string;
  clinicId?: string | null;
  patientId: string;
  visitId?: string | null;
  doctorId?: string | null;
  number: string;
  totalAmount: number;
  paidAmount: number;
  refundedAmount: number;
  discount: number;
  status: string;
  payMethod?: string | null;
  paidAt?: string | null;
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface CreateChargeInput {
  id: string;
  clinicId?: string | null;
  patientId: string;
  visitId?: string | null;
  doctorId?: string | null;
  number: string;
  totalAmount: number;
  discount: number;
  status: string;
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChargeRepository {
  findById(id: string): ChargeRecord | null;
  create(input: CreateChargeInput): void;
  createItem(item: ChargeItemRecord): void;
  updatePayment(id: string, paidAmount: number, status: string, paidAt: string, payMethod?: string): void;
  updateRefund(id: string, refundedAmount: number, status: string, updatedAt: string): void;
}

export interface MemberCardRecord {
  id: string;
  clinicId?: string | null;
  patientId: string;
  cardNo: string;
  balance: number;
  totalRecharge: number;
  totalConsume: number;
  points: number;
  totalPoints: number;
  status: string;
  level: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface MemberCardRepository {
  findById(id: string): MemberCardRecord | null;
  findByPatient(patientId: string): MemberCardRecord | null;
  updateBalanceRefund(id: string, balance: number, updatedAt: string): void;
  updateRecharge(id: string, balance: number, amount: number, updatedAt: string): void;
  updateConsume(id: string, balance: number, amount: number, updatedAt: string): void;
  updatePoints(id: string, points: number, totalPoints: number, updatedAt: string): void;
  insertLog(input: Record<string, unknown>): void;
  insertPointLog(input: Record<string, unknown>): void;
}

export interface InventoryItemRecord {
  id: string;
  clinicId?: string | null;
  name: string;
  code: string;
  stock: number;
  minStock: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface InventoryTransactionRecord {
  id: string;
  clinicId?: string | null;
  itemId: string;
  type: string;
  quantity: number;
  beforeStock: number;
  afterStock: number;
  operatorId?: string | null;
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface InventoryRepository {
  findItem(id: string): InventoryItemRecord | null;
  updateStock(id: string, stock: number, updatedAt: string): void;
  createTransaction(record: InventoryTransactionRecord): void;
  lowStock(): InventoryItemRecord[];
}

export interface DebtRecord {
  id: string;
  clinicId?: string | null;
  chargeId: string;
  patientId: string;
  totalAmount: number;
  paidAmount: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface DebtRepository {
  findById(id: string): DebtRecord | null;
  findByCharge(chargeId: string): DebtRecord | null;
  updatePaid(id: string, paidAmount: number, status: string, updatedAt: string): void;
}

export interface AuthUserRecord {
  id: string;
  clinicId?: string | null;
  username: string;
  passwordHash: string;
  name: string;
  role: string;
  active: boolean;
  loginAttempts: number;
  lockedUntil?: string | null;
  tokenVersion: number;
  refreshToken?: string | null;
  refreshTokenExpiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface AuthRepository {
  findByUsername(username: string): AuthUserRecord | null;
  findById(id: string): AuthUserRecord | null;
  findByRefreshTokenHash(tokenHash: string): AuthUserRecord | null;
  updateLoginAttempts(id: string, attempts: number, lockedUntil: string | null, updatedAt: string): void;
  resetLoginAttempts(id: string, updatedAt: string): void;
  updatePassword(id: string, passwordHash: string, updatedAt: string): void;
  updateRefreshToken(id: string, tokenHash: string, expiresAt: string, updatedAt: string): void;
  clearRefreshToken(id: string, updatedAt: string): void;
  markRefreshTokenUsed(tokenHash: string, userId: string, usedAt: string): void;
}

export interface PurchaseOrderRecord {
  id: string;
  clinicId?: string | null;
  number: string;
  supplierId?: string | null;
  totalAmount: number;
  status: string;
  receivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface PurchaseOrderItemRecord {
  id: string;
  clinicId?: string | null;
  orderId: string;
  itemId?: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface PurchaseOrderRepository {
  findById(id: string): PurchaseOrderRecord | null;
  itemsByOrder(orderId: string): PurchaseOrderItemRecord[];
  createOrder(input: PurchaseOrderRecord): void;
  createItem(input: PurchaseOrderItemRecord): void;
  markReceived(id: string, receivedAt: string, updatedAt: string): void;
}

export interface ProcessingOrderRepository {
  findById(id: string): { id: string; status: string; deletedAt?: string | null } | null;
  updateStatus(id: string, status: string, updatedAt: string): void;
}

export interface FollowUpRecord {
  id: string;
  clinicId?: string | null;
  patientId: string;
  planDate: string;
  content?: string | null;
  status: string;
  assigneeId?: string | null;
  templateId?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface FollowUpRepository {
  reminders(): Array<Record<string, unknown>>;
  insert(record: FollowUpRecord): void;
}

export interface WechatMessageRepository {
  markSent(id: string, sentAt: string, updatedAt: string): void;
}

export interface AlertRepository {
  open(): Array<Record<string, unknown>>;
  setStatus(id: string, status: string, userId: string | null, now: string): void;
}

export interface PatientRiskRepository {
  treatmentCount(patientId: string): number;
  periodontalCount(patientId: string): number;
  insert(input: Record<string, unknown>): void;
}

export interface AnalyticsRepository {
  rfm(clinicId: string | null): Array<Record<string, unknown>>;
  churn(clinicId: string | null): Array<Record<string, unknown>>;
  doctorAnomalies(clinicId: string | null): Array<Record<string, unknown>>;
}

export interface HrRepository {
  attendance(workDate?: string): Array<Record<string, unknown>>;
  approveLeave(id: string, status: string, reviewerId: string, now: string): void;
}

export interface ClinicalWorkflowRepository {
  getRow(table: string, id: string): Record<string, unknown> | null;
  updateStatus(table: string, id: string, status: string, now: string, extra?: Record<string, unknown>): void;
  createVisit(input: Record<string, unknown>): string;
  lockMedicalRecord(id: string, locked: boolean, userId: string, now: string): void;
}
