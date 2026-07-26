import { BaseEntity } from "@dental/shared";

export interface ChargeCombo extends BaseEntity {
  name: string;
  category?: string | null;
  isPublic?: number;
  creatorId?: string | null;
  clinicId?: string | null;
  deletedAt?: string | null;
}
