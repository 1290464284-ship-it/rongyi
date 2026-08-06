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
  memberCardId?: string | null;
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
  findById(id: string, clinicId?: string | null): ChargeRecord | null;
  create(input: CreateChargeInput): void;
  createItem(item: ChargeItemRecord): void;
  updatePayment(id: string, paidAmount: number, status: string, paidAt: string, payMethod?: string, memberCardId?: string | null, clinicId?: string | null): void;
  updateRefund(id: string, refundedAmount: number, status: string, updatedAt: string, clinicId?: string | null): void;
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
  create(input: MemberCardRecord): void;
  findById(id: string, clinicId?: string | null): MemberCardRecord | null;
  findByPatient(patientId: string, clinicId?: string | null): MemberCardRecord | null;
  findByPatientForRefund(patientId: string, clinicId?: string | null): MemberCardRecord | null;
  updateBalanceRefund(id: string, balance: number, updatedAt: string, clinicId?: string | null): void;
  updateRecharge(id: string, balance: number, amount: number, updatedAt: string, clinicId?: string | null): void;
  updateConsume(id: string, balance: number, amount: number, updatedAt: string, clinicId?: string | null): void;
  updatePoints(id: string, points: number, totalPoints: number, updatedAt: string, clinicId?: string | null): void;
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
  findItem(id: string, clinicId?: string | null): InventoryItemRecord | null;
  updateStock(id: string, stock: number, updatedAt: string, clinicId?: string | null): void;
  createTransaction(record: InventoryTransactionRecord): void;
  lowStock(clinicId?: string | null): InventoryItemRecord[];
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
  findById(id: string, clinicId?: string | null): DebtRecord | null;
  findByCharge(chargeId: string, clinicId?: string | null): DebtRecord | null;
  updatePaid(id: string, paidAmount: number, status: string, updatedAt: string, clinicId?: string | null): void;
}

export interface AuthUserRecord {
  id: string;
  clinicId?: string | null;
  currentClinicId?: string | null;
  username: string;
  passwordHash: string;
  name: string;
  role: string;
  phone?: string | null;
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
  clinicMemberships(userId: string): Array<{ clinicId: string; name: string; role: string }>;
  setCurrentClinic(userId: string, clinicId: string, updatedAt: string): void;
  addClinicMembership(userId: string, clinicId: string, role: string, createdAt: string, updatedAt: string): void;
  isRefreshTokenUsed(tokenHash: string): boolean;
  /** 查已使用的 refresh token 归属用户（重用吊销会话族用）。 */
  findUsedRefreshToken(tokenHash: string): { userId: string } | null;
  /** 吊销用户的整个会话族：清除当前 refresh token 并 bump tokenVersion（RFC 6819 重用应对）。 */
  revokeSessionFamily(userId: string, updatedAt: string): void;
  cleanupUsedRefreshTokens(before: string): number;
  insertUser(input: AuthUserRecord): void;
  updateUser(id: string, fields: { name?: string; phone?: string | null; role?: string; active?: boolean }, updatedAt: string, clinicId?: string | null): number;
  resetPassword(id: string, passwordHash: string, updatedAt: string, clinicId?: string | null): number;
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
  reviewStatus?: string | null;
  approvedById?: string | null;
  approvedAt?: string | null;
  rejectionReason?: string | null;
  receivedById?: string | null;
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
  findById(id: string, clinicId?: string | null): PurchaseOrderRecord | null;
  itemsByOrder(orderId: string, clinicId?: string | null): PurchaseOrderItemRecord[];
  createOrder(input: PurchaseOrderRecord): void;
  createItem(input: PurchaseOrderItemRecord): void;
  markReceived(id: string, receivedAt: string, updatedAt: string, clinicId?: string | null): void;
}

export interface ProcessingOrderRecord {
  id: string;
  clinicId?: string | null;
  patientId: string;
  visitId?: string | null;
  factoryId?: string | null;
  doctorId?: string | null;
  number: string;
  shade?: string | null;
  teethNumbers: string[];
  totalFee: number;
  status: string;
  settleStatus?: string | null;
  expectedAt?: string | null;
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface ProcessingOrderItemRecord {
  id: string;
  clinicId?: string | null;
  orderId: string;
  name: string;
  spec?: string | null;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface ProcessingOrderRepository {
  findById(id: string, clinicId?: string | null): { id: string; status: string; deletedAt?: string | null } | null;
  updateStatus(id: string, status: string, updatedAt: string, clinicId?: string | null): void;
  createOrder(input: ProcessingOrderRecord): void;
  createItem(input: ProcessingOrderItemRecord): void;
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
  reminders(clinicId?: string | null): Array<Record<string, unknown>>;
  insert(record: FollowUpRecord): void;
  complete(id: string, completedAt: string, updatedAt: string, clinicId?: string | null, result?: string | null): number;
}

export interface WechatMessageRepository {
  findById(id: string, clinicId?: string | null): {
    id: string;
    status: string;
    clinicId?: string | null;
    patientId?: string | null;
    type?: string | null;
    content?: string | null;
    templateId?: string | null;
  } | null;
  markSent(id: string, sentAt: string, updatedAt: string, clinicId?: string | null): number;
}

export interface AlertRepository {
  open(clinicId?: string | null): Array<Record<string, unknown>>;
  setStatus(id: string, status: string, userId: string | null, now: string, clinicId?: string | null): number;
}

export interface PatientRiskRepository {
  treatmentCount(patientId: string, clinicId?: string | null): number;
  periodontalCount(patientId: string, clinicId?: string | null): number;
  insert(input: Record<string, unknown>): void;
}

export interface AnalyticsRepository {
  rfm(clinicId: string | null): Array<Record<string, unknown>>;
  churn(clinicId: string | null): Array<Record<string, unknown>>;
  doctorAnomalies(clinicId: string | null): Array<Record<string, unknown>>;
}

export interface HrRepository {
  attendance(workDate?: string, clinicId?: string | null): Array<Record<string, unknown>>;
  approveLeave(id: string, status: string, reviewerId: string, now: string, clinicId?: string | null): number;
}

export interface ClinicalWorkflowRepository {
  getRow(table: string, id: string, clinicId?: string | null): Record<string, unknown> | null;
  updateStatus(table: string, id: string, status: string, now: string, extra?: Record<string, unknown>, clinicId?: string | null): void;
  createVisit(input: Record<string, unknown>): string;
  lockMedicalRecord(id: string, locked: boolean, userId: string, now: string, clinicId?: string | null): void;
}
