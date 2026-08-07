export interface PurchaseRow extends Record<string, unknown> {
  id: string;
  number?: string | null;
  supplierId?: string | null;
  supplierIdLabel?: string | null;
  totalAmount?: number | null;
  status?: string | null;
  reviewStatus?: string | null;
  rejectionReason?: string | null;
}

export interface PurchaseItemForm {
  id: string;
  itemId: string;
  name: string;
  spec: string;
  quantity: string;
  unitPrice: string;
  subtotal: string;
}

export interface PurchaseOrderItemRow extends Record<string, unknown> {
  id: string;
  itemId?: string | null;
  name?: string | null;
  spec?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  subtotal?: number | null;
}

export interface PurchaseOrderForm {
  number: string;
  supplierId: string;
  items: PurchaseItemForm[];
}

export interface ValidPurchaseItem {
  itemId?: string;
  name: string;
  quantity: number;
  unitPrice: number;
}
