import { BaseEntity } from "@dental/shared";

export interface ChargeCombo extends BaseEntity {
  name: string;
  category?: string;
  isPublic?: number;
  creatorId?: string;
  clinicId?: string;
  deletedAt?: string;
}
