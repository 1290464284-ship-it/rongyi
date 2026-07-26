export type PatientId = string & { __brand: 'PatientId' };
export type AppointmentId = string & { __brand: 'AppointmentId' };
export type ChargeId = string & { __brand: 'ChargeId' };
export type UserId = string & { __brand: 'UserId' };
export type ClinicId = string & { __brand: 'ClinicId' };
export type InventoryItemId = string & { __brand: 'InventoryItemId' };
export type MemberCardId = string & { __brand: 'MemberCardId' };
export type VisitId = string & { __brand: 'VisitId' };

export type UUID = string & { __brand: 'UUID' };

export type Cents = number & { __brand: 'Cents' };
export type Yuan = number & { __brand: 'Yuan' };

export function asPatientId(id: string): PatientId {
  return id as PatientId;
}

export function asAppointmentId(id: string): AppointmentId {
  return id as AppointmentId;
}

export function asChargeId(id: string): ChargeId {
  return id as ChargeId;
}

export function asUserId(id: string): UserId {
  return id as UserId;
}

export function asClinicId(id: string): ClinicId {
  return id as ClinicId;
}

export function asInventoryItemId(id: string): InventoryItemId {
  return id as InventoryItemId;
}

export function asMemberCardId(id: string): MemberCardId {
  return id as MemberCardId;
}

export function asVisitId(id: string): VisitId {
  return id as VisitId;
}

export function asUUID(id: string): UUID {
  return id as UUID;
}

export function asCents(value: number): Cents {
  return value as Cents;
}

export function asYuan(value: number): Yuan {
  return value as Yuan;
}
