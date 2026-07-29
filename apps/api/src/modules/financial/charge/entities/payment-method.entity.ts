import { BaseEntity } from "@dental/shared";

export interface PaymentMethod extends BaseEntity {
  name: string;
  code: string;
  parentId?: string;
  sortOrder?: number;
  isEnabled?: number;
  clinicId?: string;
  deletedAt?: string;
}
