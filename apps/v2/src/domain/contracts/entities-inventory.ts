// 库存与供应链实体（M-04：由 entities.ts 拆分）
import type { Entity, SoftDeletable, ID, UTCDateTime, ClinicDate, Cents } from './shared';
import type { StockActionType, ProcessingOrderStatus } from './enums';

// Inventory and supply chain
// ---------------------------------------------------------------------------

export interface Supplier extends Entity, SoftDeletable {
  code?: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  address?: string;
  bankAccount?: string;
  remark?: string;
}

export interface InventoryItem extends Entity, SoftDeletable {
  code: string;
  name: string;
  spec?: string;
  category: string;
  unit: string;
  stock: number;
  minStock: number;
  price: Cents;
  supplierId?: ID | null;
  expireDate?: ClinicDate | null;
  location?: string;
  remark?: string;
}

export interface InventoryTransaction extends Entity, SoftDeletable {
  itemId: ID;
  type: StockActionType;
  quantity: number;
  beforeStock: number;
  afterStock: number;
  referenceType?: string;
  referenceId?: ID | null;
  operatorId?: ID | null;
  remark?: string;
}

export interface PurchaseOrder extends Entity, SoftDeletable {
  number: string;
  supplierId: ID;
  totalAmount: Cents;
  status: string;
  receivedAt?: UTCDateTime | null;
}

export interface PurchaseOrderItem {
  id: ID;
  orderId: ID;
  itemId?: ID | null;
  name: string;
  spec?: string;
  quantity: number;
  unitPrice: Cents;
  subtotal: Cents;
}

export interface ProcessingOrder extends Entity, SoftDeletable {
  patientId: ID;
  visitId?: ID | null;
  factoryId?: ID | null;
  doctorId?: ID | null;
  number: string;
  shade?: string;
  teethNumbers: string[];
  totalFee: Cents;
  status: ProcessingOrderStatus;
  chargeId?: ID | null;
  sentAt?: UTCDateTime | null;
  expectedAt?: ClinicDate | null;
  receivedAt?: UTCDateTime | null;
  deliveredAt?: UTCDateTime | null;
  remark?: string;
}

export interface ReplenishmentSuggestion extends Entity, SoftDeletable {
  inventoryId: ID;
  avgDailyConsumption: number;
  leadTimeDays: number;
  safetyFactor: number;
  rop: number;
  suggestedQty: number;
  calculationSnapshotJson: string;
  status: 'OPEN' | 'APPLIED' | 'IGNORED';
  reason: string;
  supplierId?: ID | null;
  totalAmount: Cents;
}

