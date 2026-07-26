import { BaseEntity } from "@dental/shared";

export interface PaymentMethod extends BaseEntity {
  name: string;
  code: string;
  parentId?: string | null;
  sortOrder?: number;
  isEnabled?: number;
  clinicId?: string | null;
  deletedAt?: string | null;
}
